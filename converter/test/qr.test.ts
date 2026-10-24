import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import QRCode from 'qrcode';
import sharp from 'sharp';
import { afterEach, describe, expect, it } from 'vitest';
import { decodeQr, isVideoUrl } from '../src/qr';

const dirs: string[] = [];

/** Scrive `content` in un file temporaneo e ne restituisce il percorso. */
async function tempFile(name: string, content: Buffer | string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'arnoplast-qr-'));
  dirs.push(dir);
  const filePath = join(dir, name);
  await writeFile(filePath, content);
  return filePath;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('decodeQr', () => {
  it('decodes a youtube qr', async () => {
    const png = await QRCode.toBuffer('https://youtu.be/abc123', { type: 'png', width: 300 });
    const file = await tempFile('qr.png', png);

    expect(await decodeQr(file)).toBe('https://youtu.be/abc123');
  });

  it('decodes a small qr without quiet zone', async () => {
    // Come nel catalogo stampato: immagine piccola e QR a filo del bordo.
    const png = await QRCode.toBuffer('https://youtu.be/abc123', { type: 'png', margin: 0, width: 90 });
    const file = await tempFile('qr-piccolo.png', png);

    expect(await decodeQr(file)).toBe('https://youtu.be/abc123');
  });

  it('decodes a tiny qr only readable after enlarging it', async () => {
    // A 53 px il QR (25 moduli) ha moduli di ~2 px: la lettura diretta fallisce, quella sulla copia ingrandita riesce.
    const png = await QRCode.toBuffer('https://youtu.be/abc123', { type: 'png', margin: 0, width: 53 });
    const file = await tempFile('qr-minuscolo.png', png);

    expect(await decodeQr(file)).toBe('https://youtu.be/abc123');
  });

  it('decodes a qr on a transparent background', async () => {
    const png = await QRCode.toBuffer('https://youtu.be/abc123', {
      type: 'png',
      width: 300,
      color: { dark: '#000000ff', light: '#00000000' },
    });
    const file = await tempFile('qr-trasparente.png', png);

    expect(await decodeQr(file)).toBe('https://youtu.be/abc123');
  });

  it('returns null for a photo', async () => {
    const png = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 120, g: 90, b: 60 } },
    })
      .png()
      .toBuffer();
    const file = await tempFile('foto.png', png);

    expect(await decodeQr(file)).toBeNull();
  });

  it('returns null for unreadable file', async () => {
    const file = await tempFile('rotto.jpg', 'questo non è un file immagine');

    expect(await decodeQr(file)).toBeNull();
  });
});

describe('isVideoUrl', () => {
  it('recognizes video urls', () => {
    expect(isVideoUrl('https://www.youtube.com/watch?v=x')).toBe(true);
    expect(isVideoUrl('https://example.com')).toBe(false);
    expect(isVideoUrl('ftp://youtu.be/x')).toBe(false);
  });
});
