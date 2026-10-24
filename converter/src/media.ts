import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import type { ImageRef } from '@arnoplast/schema';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);

const THUMB_SIDE = 400;
const DETAIL_SIDE = 1600;
/** Risoluzione a cui si rasterizzano i disegni vettoriali. */
const VECTOR_DPI = '200';

/** Formati raster che il convertitore accetta (nomi di sharp). PSD, EPS e simili restano fuori. */
const RASTER_FORMATS = new Set(['jpeg', 'png', 'tiff', 'webp', 'gif']);
/** Formati vettoriali che `pdftoppm` sa aprire (le `.ai` moderne sono PDF). */
const VECTOR_EXTENSIONS = new Set(['.pdf', '.ai']);

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

  // Foto su fondo bianco: la trasparenza va appiattita sul bianco, altrimenti i PNG diventano neri.
  // `.rotate()` applica l'orientamento EXIF; `srgb` serve ai JPEG CMYK di InDesign.
  const encode = (side: number) =>
    sharp(bytes)
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
    const format = (await sharp(bytes).metadata()).format;
    if (format === undefined || !RASTER_FORMATS.has(format)) throw new UnsupportedImageError(src);
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
 * il file si lancia lo stesso `UnsupportedImageError`, così la build lo segnala come avviso.
 */
export async function rasterizeVector(src: string): Promise<Buffer> {
  if (!VECTOR_EXTENSIONS.has(extname(src).toLowerCase())) throw new UnsupportedImageError(src);

  const dir = await mkdtemp(join(tmpdir(), 'arnoplast-vector-'));
  try {
    const prefix = join(dir, 'page');
    try {
      await execFileAsync('pdftoppm', ['-png', '-r', VECTOR_DPI, '-singlefile', src, prefix]);
    } catch (error) {
      // Codice numerico = `pdftoppm` è partito ed è uscito con errore (file illeggibile).
      // Altrimenti (es. ENOENT: poppler non installato) è un problema dell'ambiente, non del file.
      if (typeof (error as { code?: unknown }).code === 'number') throw new UnsupportedImageError(src);
      throw error;
    }
    return await readFile(`${prefix}.png`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
