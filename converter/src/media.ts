import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import type { ImageRef } from '@arnoplast/schema';
import { initializeCanvas, readPsd } from 'ag-psd';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);

const THUMB_SIDE = 400;
const DETAIL_SIDE = 1600;
/** Risoluzione a cui si rasterizzano i disegni vettoriali. */
const VECTOR_DPI = '200';
/** Oltre questo tempo `pdftoppm` si considera bloccato: il processo si uccide e il disegno diventa un avviso. */
const RASTERIZE_TIMEOUT_MS = 60_000;

/** Formati raster che il convertitore accetta (nomi di sharp). EPS e simili restano fuori. */
const RASTER_FORMATS = new Set(['jpeg', 'png', 'tiff', 'webp', 'gif']);
/** Formati vettoriali che `pdftoppm` sa aprire (le `.ai` moderne sono PDF). */
const VECTOR_EXTENSIONS = new Set(['.pdf', '.ai']);

// ag-psd chiede una fabbrica per il suo oggetto "ImageData": di norma usa un <canvas> del DOM
// (o il pacchetto nativo `canvas` in Node). A noi serve solo il buffer di pixel dell'immagine
// composita, quindi forniamo un'implementazione minima che non richiede compilazione nativa.
initializeCanvas(
  () => {
    throw new Error('ag-psd: creazione canvas non attesa (si legge solo image data grezza)');
  },
  (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
);

/**
 * Decodifica l'immagine composita (il risultato finale "appiattito") di un file Photoshop in pixel
 * RGBA grezzi. Restituisce `null` se il file non è un .psd leggibile o non ha un'immagine composita
 * salvata (puramente teorico: InDesign stesso richiede che ce ne sia una per mostrare l'anteprima).
 */
function decodePsd(bytes: Buffer): { data: Buffer; width: number; height: number } | null {
  try {
    const psd = readPsd(bytes, { skipLayerImageData: true, skipThumbnail: true, useImageData: true });
    if (!psd.imageData) return null;
    const { width, height, data } = psd.imageData;
    return { data: Buffer.from(data.buffer, data.byteOffset, data.byteLength), width, height };
  } catch {
    return null;
  }
}

/** Il file non è in un formato che il convertitore sa trasformare in immagine (o non si riesce a leggerlo). */
export class UnsupportedImageError extends Error {
  override name = 'UnsupportedImageError';

  constructor(public file: string) {
    super(`formato immagine non supportato: ${basename(file)}`);
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Dimensioni di un WebP già scritto, oppure `null` se il file non si legge (per esempio perché un'esecuzione precedente è stata interrotta). */
async function readSize(path: string): Promise<{ width: number; height: number } | null> {
  try {
    const { width, height } = await sharp(path).metadata();
    return width !== undefined && height !== undefined ? { width, height } : null;
  } catch {
    return null;
  }
}

/**
 * Crea in `imgDir` la miniatura (lato lungo 400 px) e il dettaglio (lato lungo 1600 px) WebP di `src`,
 * senza ingrandire le immagini più piccole. I file prendono il nome dall'hash del sorgente, quindi
 * la stessa immagine non viene mai elaborata due volte: se esistono già (e si leggono) non si riscrivono.
 *
 * I percorsi restituiti sono relativi alla cartella della linea (`img/<nome>`), qualunque sia `imgDir`.
 * `width` e `height` sono quelli della versione dettaglio.
 */
export async function processImage(src: string, imgDir: string): Promise<ImageRef> {
  const bytes = await readFile(src);
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const thumbName = `${hash}-${THUMB_SIDE}.webp`;
  const detailName = `${hash}-${DETAIL_SIDE}.webp`;
  const thumbPath = join(imgDir, thumbName);
  const detailPath = join(imgDir, detailName);
  const ref = { thumb: `img/${thumbName}`, detail: `img/${detailName}` };

  if ((await exists(thumbPath)) && (await exists(detailPath))) {
    const size = await readSize(detailPath);
    if (size) return { ...ref, ...size };
  }

  // I .psd si decodificano a parte (ag-psd): il resto arriva a `sharp` come file originale.
  const isPsd = extname(src).toLowerCase() === '.psd';
  const psd = isPsd ? decodePsd(bytes) : null;
  if (isPsd && !psd) throw new UnsupportedImageError(src);
  const decoded = () =>
    psd ? sharp(psd.data, { raw: { width: psd.width, height: psd.height, channels: 4 } }) : sharp(bytes);

  // Foto su fondo bianco: la trasparenza va appiattita sul bianco, altrimenti i PNG diventano neri.
  // `.rotate()` applica l'orientamento EXIF; `srgb` serve ai JPEG CMYK di InDesign.
  const encode = (side: number) =>
    decoded()
      .rotate()
      .flatten({ background: '#ffffff' })
      .toColorspace('srgb')
      .resize(side, side, { fit: 'inside', withoutEnlargement: true })
      .webp()
      .toBuffer({ resolveWithObject: true });

  // Solo la lettura dell'immagine è un problema del file; gli errori di scrittura più sotto restano errori veri.
  let thumb: Buffer;
  let detail: { data: Buffer; info: { width: number; height: number } };
  try {
    if (!psd) {
      const format = (await sharp(bytes).metadata()).format;
      if (format === undefined || !RASTER_FORMATS.has(format)) throw new UnsupportedImageError(src);
    }
    thumb = (await encode(THUMB_SIDE)).data;
    detail = await encode(DETAIL_SIDE);
  } catch (error) {
    throw error instanceof UnsupportedImageError ? error : new UnsupportedImageError(src);
  }

  await mkdir(imgDir, { recursive: true });
  await writeFile(thumbPath, thumb);
  await writeFile(detailPath, detail.data);
  return { ...ref, width: detail.info.width, height: detail.info.height };
}

/**
 * Rasterizza a 200 dpi la prima pagina di un disegno vettoriale (`.pdf`, `.ai`) e restituisce il PNG.
 * Gli altri formati vettoriali (EPS, SVG…) non sono supportati. Se `pdftoppm` non riesce a leggere
 * il file, non risponde entro un minuto, o esce senza scrivere il PNG, si lancia lo stesso
 * `UnsupportedImageError`, così la build lo segnala come avviso.
 */
export async function rasterizeVector(src: string): Promise<Buffer> {
  if (!VECTOR_EXTENSIONS.has(extname(src).toLowerCase())) throw new UnsupportedImageError(src);

  const dir = await mkdtemp(join(tmpdir(), 'arnoplast-vector-'));
  try {
    const prefix = join(dir, 'page');
    try {
      await execFileAsync('pdftoppm', ['-png', '-r', VECTOR_DPI, '-singlefile', src, prefix], {
        timeout: RASTERIZE_TIMEOUT_MS,
      });
    } catch (error) {
      const { code, killed, signal } = error as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null };
      if (code === 'ENOENT') {
        throw new Error('pdftoppm non trovato: installa poppler (su Mac: brew install poppler) e riprova');
      }
      // Codice numerico = `pdftoppm` è partito ed è uscito con errore (file illeggibile).
      // Ucciso da un segnale (anche dal timeout di `execFile`, che manda SIGTERM) = non ha finito in tempo.
      if (typeof code === 'number' || killed || signal) throw new UnsupportedImageError(src);
      throw error;
    }
    if (!(await exists(`${prefix}.png`))) throw new UnsupportedImageError(src);
    return await readFile(`${prefix}.png`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
