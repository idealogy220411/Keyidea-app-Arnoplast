import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { REFERENCE_LANG, type ImageRef, type Product } from '@arnoplast/schema';
import { linkFileName, resolveLink } from './links';
import type { MergedCategory, MergedProduct } from './merge';
import { processImage, rasterizeVector, UnsupportedImageError } from './media';
import { decodeQr, isVideoUrl } from './qr';
import type { Issue } from './types';

const quote = (value: unknown) => `«${String(value)}»`;

/**
 * Dove cercare i file collegati e dove scrivere le immagini; i problemi trovati si accodano a `issues`.
 * `qrFilenamePattern` segna i nomi di file da considerare QR code anche quando la lettura non riesce
 * (Ruling 19): quel file non diventa né foto né disegno, solo un avviso.
 */
export type ImageContext = { linksDir: string; imgDir: string; issues: Issue[]; qrFilenamePattern: RegExp };

/** Percorso del file collegato; se manca segnala un errore bloccante e restituisce `null`. */
async function locate(linkUri: string, where: string, { linksDir, issues }: ImageContext): Promise<string | null> {
  const path = await resolveLink(linkUri, linksDir);
  if (path === null) {
    issues.push({ level: 'error', message: `immagine collegata mancante: ${linkFileName(linkUri)}`, where });
  }
  return path;
}

/** Esegue la conversione; un formato non supportato è solo un avviso e il risultato è `null`. */
async function convert(produce: () => Promise<ImageRef>, where: string, { issues }: ImageContext): Promise<ImageRef | null> {
  try {
    return await produce();
  } catch (error) {
    if (!(error instanceof UnsupportedImageError)) throw error;
    issues.push({ level: 'warning', message: error.message.normalize('NFC'), where });
    return null;
  }
}

/**
 * Rasterizza il disegno in una cartella temporanea (sempre ripulita) e vi cerca anche un QR code (Ruling 19):
 * un disegno può incorporare il QR del video del prodotto invece di essere lui stesso un'immagine da mostrare.
 * Se il QR non si legge ma il nome del file è quello di un QR code (`qrFilenamePattern`), il disegno non si
 * converte: non è né un disegno né una foto valida.
 */
async function processDrawing(
  src: string,
  fileName: string,
  ctx: Pick<ImageContext, 'imgDir' | 'qrFilenamePattern'>,
): Promise<{ qr: string | null; ref: ImageRef | null }> {
  const png = await rasterizeVector(src);
  const dir = await mkdtemp(join(tmpdir(), 'arnoplast-drawing-'));
  try {
    const file = join(dir, 'disegno.png');
    await writeFile(file, png);
    const qr = await decodeQr(file);
    if (qr !== null || ctx.qrFilenamePattern.test(fileName)) return { qr, ref: null };
    return { qr: null, ref: await processImage(file, ctx.imgDir) };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Immagine di apertura di una categoria (senza lettura di QR code), o `null` se non c'è o non si può usare. */
export async function processCategoryImage(
  { id, imageLink }: Pick<MergedCategory, 'id' | 'imageLink'>,
  ctx: ImageContext,
): Promise<ImageRef | null> {
  if (imageLink === null) return null;
  const path = await locate(imageLink, id, ctx);
  return path === null ? null : convert(() => processImage(path, ctx.imgDir), id, ctx);
}

/** Foto, disegni e video di un prodotto. I file si elaborano uno alla volta, per non riempire la memoria. */
export async function processProduct(
  product: MergedProduct,
  ctx: ImageContext,
): Promise<Pick<Product, 'images' | 'drawings' | 'videoUrl'>> {
  const media: Pick<Product, 'images' | 'drawings' | 'videoUrl'> = { images: [], drawings: [], videoUrl: null };
  const name = product.name[REFERENCE_LANG] ?? product.id;
  const add = (list: ImageRef[], ref: ImageRef | null): void => {
    if (ref && !list.some((other) => other.detail === ref.detail)) list.push(ref);
  };

  /** Un QR code letto in una foto o in un disegno: diventa il video del prodotto, oppure un avviso. */
  const useQr = (qr: string): void => {
    if (!isVideoUrl(qr)) {
      ctx.issues.push({ level: 'warning', message: `QR code non riconosciuto come video: ${qr}`, where: product.id });
    } else if (media.videoUrl === null) {
      media.videoUrl = qr;
    } else if (media.videoUrl !== qr) {
      ctx.issues.push({
        level: 'warning',
        message: `più di un video per il prodotto ${quote(name)}: ${qr} ignorato`,
        where: product.id,
      });
    }
  };

  /** Il file è nominato come un QR code (Ruling 19) ma non si legge, o non si può convertire: non si usa. */
  const unreadableQr = (fileName: string): void => {
    ctx.issues.push({ level: 'warning', message: `QR code non leggibile: ${fileName}`, where: product.id });
  };

  for (const linkUri of product.imageLinks) {
    const path = await locate(linkUri, product.id, ctx);
    if (path === null) continue;
    const fileName = linkFileName(linkUri);
    const qr = await decodeQr(path);
    if (qr !== null) useQr(qr);
    else if (ctx.qrFilenamePattern.test(fileName)) unreadableQr(fileName);
    else add(media.images, await convert(() => processImage(path, ctx.imgDir), product.id, ctx));
  }

  for (const linkUri of product.drawingLinks) {
    const path = await locate(linkUri, product.id, ctx);
    if (path === null) continue;
    const fileName = linkFileName(linkUri);
    let result: { qr: string | null; ref: ImageRef | null };
    try {
      result = await processDrawing(path, fileName, ctx);
    } catch (error) {
      if (!(error instanceof UnsupportedImageError)) throw error;
      if (ctx.qrFilenamePattern.test(fileName)) unreadableQr(fileName);
      else ctx.issues.push({ level: 'warning', message: error.message.normalize('NFC'), where: product.id });
      continue;
    }
    if (result.qr !== null) useQr(result.qr);
    else if (result.ref === null) unreadableQr(fileName);
    else add(media.drawings, result.ref);
  }

  return media;
}
