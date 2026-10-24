import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ImageRef, Product } from '@arnoplast/schema';
import { linkFileName, resolveLink } from './links';
import type { MergedCategory, MergedProduct } from './merge';
import { processImage, rasterizeVector, UnsupportedImageError } from './media';
import { decodeQr, isVideoUrl } from './qr';
import type { Issue } from './types';

/** Dove cercare i file collegati e dove scrivere le immagini; i problemi trovati si accodano a `issues`. */
export type ImageContext = { linksDir: string; imgDir: string; issues: Issue[] };

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

/** Rasterizza il disegno in una cartella temporanea (sempre ripulita) e ne ricava miniatura e dettaglio. */
async function processDrawing(src: string, imgDir: string): Promise<ImageRef> {
  const png = await rasterizeVector(src);
  const dir = await mkdtemp(join(tmpdir(), 'arnoplast-drawing-'));
  try {
    const file = join(dir, 'disegno.png');
    await writeFile(file, png);
    return await processImage(file, imgDir);
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
  const add = (list: ImageRef[], ref: ImageRef | null): void => {
    if (ref && !list.some((other) => other.detail === ref.detail)) list.push(ref);
  };

  for (const linkUri of product.imageLinks) {
    const path = await locate(linkUri, product.id, ctx);
    if (path === null) continue;
    const qr = await decodeQr(path);
    if (qr === null) add(media.images, await convert(() => processImage(path, ctx.imgDir), product.id, ctx));
    else if (isVideoUrl(qr)) media.videoUrl ??= qr;
    else ctx.issues.push({ level: 'warning', message: `QR code non riconosciuto come video: ${qr}`, where: product.id });
  }
  for (const linkUri of product.drawingLinks) {
    const path = await locate(linkUri, product.id, ctx);
    if (path !== null) add(media.drawings, await convert(() => processDrawing(path, ctx.imgDir), product.id, ctx));
  }
  return media;
}
