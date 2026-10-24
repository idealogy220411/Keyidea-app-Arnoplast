import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import sharp from 'sharp';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';

/** Oltre questo lato (in pixel) non si tenta la lettura ingrandita: servirebbero centinaia di MB e a una foto non serve. */
const MAX_ENLARGE_SIDE = 1200;

const VIDEO_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);

/** Vero se `text` è un link http(s) a YouTube: è così che il catalogo stampato collega i video. */
export function isVideoUrl(text: string): boolean {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return false;
  }
  return (url.protocol === 'http:' || url.protocol === 'https:') && VIDEO_HOSTS.has(url.hostname);
}

let wasmReady = false;

/**
 * Di norma zxing-wasm scarica il file WASM da una CDN: qui lo si legge invece da `node_modules`,
 * così il convertitore funziona anche senza rete.
 */
function prepareWasm(): void {
  if (wasmReady) return;
  const wasmPath = createRequire(import.meta.url).resolve('zxing-wasm/reader/zxing_reader.wasm');
  const wasmBinary = new Uint8Array(readFileSync(wasmPath)).buffer;
  prepareZXingModule({ overrides: { wasmBinary } });
  wasmReady = true;
}

/** Cerca un QR code nei pixel RGBA grezzi e ne restituisce il testo. */
async function scan(data: Buffer, width: number, height: number): Promise<string | null> {
  const [result] = await readBarcodes(
    { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width, height },
    { formats: ['QRCode'], maxNumberOfSymbols: 1 },
  );
  return result?.text ?? null;
}

/**
 * Testo del primo QR code trovato nell'immagine, oppure `null` se non ce n'è uno leggibile
 * (o se il file non è un'immagine). Non lancia mai errori.
 *
 * I QR del catalogo sono piccoli, a volte in scala di grigi o CMYK e senza margine bianco:
 * se la lettura diretta fallisce se ne tenta una seconda su una copia ingrandita con bordo bianco.
 */
export async function decodeQr(filePath: string): Promise<string | null> {
  try {
    prepareWasm();
    // `flatten` mette uno sfondo bianco sotto i PNG trasparenti: i pixel trasparenti sono neri e nasconderebbero il QR.
    const { data, info } = await sharp(filePath)
      .flatten({ background: '#ffffff' })
      .toColorspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const text = await scan(data, info.width, info.height);
    if (text !== null || Math.max(info.width, info.height) > MAX_ENLARGE_SIDE) return text;

    const border = Math.ceil(Math.max(info.width, info.height) * 2 * 0.1);
    const enlarged = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
      .resize(info.width * 2, info.height * 2, { kernel: 'nearest' })
      .extend({ top: border, bottom: border, left: border, right: border, background: '#ffffff' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    return await scan(enlarged.data, enlarged.info.width, enlarged.info.height);
  } catch {
    return null;
  }
}
