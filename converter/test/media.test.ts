import { createHash } from 'node:crypto';
import { copyFile, mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writePsdBuffer } from 'ag-psd';
import sharp from 'sharp';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { processImage, rasterizeVector, UnsupportedImageError } from '../src/media';

const PDF_FIXTURE = fileURLToPath(new URL('./fixtures/disegno.pdf', import.meta.url));

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'arnoplast-media-'));
  dirs.push(dir);
  return dir;
}

/** Scrive `content` in un file temporaneo e ne restituisce il percorso. */
async function tempFile(name: string, content: Buffer | string): Promise<string> {
  const filePath = join(await tempDir(), name);
  await writeFile(filePath, content);
  return filePath;
}

/** PNG di un solo colore, con le dimensioni indicate. */
function solidPng(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#336699' } })
    .png()
    .toBuffer();
}

/** .psd minimo e valido (nessun livello, solo l'immagine composita), di un solo colore opaco. */
function solidPsd(width: number, height: number, [r, g, b]: [number, number, number]): Buffer {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return Buffer.from(writePsdBuffer({ width, height, imageData: { width, height, data }, children: [] }));
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('processImage', () => {
  it('creates thumb and detail webp', async () => {
    const src = await tempFile('foto.png', await solidPng(3000, 2000));
    const outDir = join(await tempDir(), 'garden', 'img');

    const ref = await processImage(src, outDir);

    expect(ref.thumb).toMatch(/^img\/[0-9a-f]{16}-400\.webp$/);
    expect(ref.detail).toMatch(/^img\/[0-9a-f]{16}-1600\.webp$/);
    expect(ref.width).toBe(1600);
    expect(ref.height).toBe(1067);

    const thumb = await sharp(join(outDir, ref.thumb.replace('img/', ''))).metadata();
    expect(thumb).toMatchObject({ format: 'webp', width: 400, height: 267 });
    const detail = await sharp(join(outDir, ref.detail.replace('img/', ''))).metadata();
    expect(detail).toMatchObject({ format: 'webp', width: 1600, height: 1067 });
  });

  it('does not upscale small images', async () => {
    const src = await tempFile('piccola.png', await solidPng(300, 200));
    const outDir = await tempDir();

    const ref = await processImage(src, outDir);

    expect(ref.width).toBe(300);
    expect(ref.height).toBe(200);
    for (const file of [ref.thumb, ref.detail]) {
      const meta = await sharp(join(outDir, file.replace('img/', ''))).metadata();
      expect(meta).toMatchObject({ width: 300, height: 200 });
    }
  });

  it('names files by content hash', async () => {
    const png = await solidPng(500, 500);
    const a = await tempFile('prima.png', png);
    const b = await tempFile('seconda.png', png);
    const outDir = await tempDir();

    const refA = await processImage(a, outDir);
    const refB = await processImage(b, outDir);

    const hash = createHash('sha256').update(png).digest('hex').slice(0, 16);
    expect(refA.thumb).toBe(`img/${hash}-400.webp`);
    expect(refA.detail).toBe(`img/${hash}-1600.webp`);
    expect(refB).toEqual(refA);
  });

  it('does not rewrite files that already exist', async () => {
    const src = await tempFile('foto.png', await solidPng(2000, 1000));
    const outDir = await tempDir();
    const first = await processImage(src, outDir);

    // Date vecchie ai file: se vengono riscritti, la data cambia.
    const old = new Date('2001-01-01T00:00:00Z');
    const paths = [first.thumb, first.detail].map((file) => join(outDir, file.replace('img/', '')));
    await Promise.all(paths.map((path) => utimes(path, old, old)));

    const second = await processImage(src, outDir);

    expect(second).toEqual(first);
    expect(second).toMatchObject({ width: 1600, height: 800 });
    for (const path of paths) {
      expect((await stat(path)).mtimeMs).toBe(old.getTime());
    }
  });

  it('regenerates an unreadable file left by an interrupted run', async () => {
    const src = await tempFile('foto.png', await solidPng(2000, 1000));
    const outDir = await tempDir();
    const first = await processImage(src, outDir);
    const detailPath = join(outDir, first.detail.replace('img/', ''));
    await writeFile(detailPath, 'troncato');

    const second = await processImage(src, outDir);

    expect(second).toEqual(first);
    expect(await sharp(detailPath).metadata()).toMatchObject({ format: 'webp', width: 1600, height: 800 });
  });

  it('rejects unsupported formats with a typed error', async () => {
    const name = 'disegno.eps';
    const src = await tempFile(name, '8BPS finto: nessun lettore sa aprirlo');

    const error = await processImage(src, await tempDir()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnsupportedImageError);
    expect(error).toMatchObject({
      name: 'UnsupportedImageError',
      file: src,
      message: `formato immagine non supportato: ${name}`,
    });
  });

  it('rejects images that sharp cannot decode', async () => {
    const src = await tempFile('rotta.png', 'questo non è un PNG');

    await expect(processImage(src, await tempDir())).rejects.toBeInstanceOf(UnsupportedImageError);
  });

  it('converts cmyk jpeg to srgb webp', async () => {
    const cmyk = await sharp({ create: { width: 400, height: 300, channels: 3, background: '#cc3322' } })
      .toColorspace('cmyk')
      .jpeg()
      .toBuffer();
    expect((await sharp(cmyk).metadata()).space).toBe('cmyk');
    const src = await tempFile('cmyk.jpg', cmyk);
    const outDir = await tempDir();

    const ref = await processImage(src, outDir);

    const meta = await sharp(join(outDir, ref.detail.replace('img/', ''))).metadata();
    expect(meta).toMatchObject({ format: 'webp', space: 'srgb' });
    // Il rosso di partenza deve restare rosso, non diventare un colore a caso.
    const data = await sharp(join(outDir, ref.detail.replace('img/', ''))).raw().toBuffer();
    expect(data[0]).toBeGreaterThan(150);
    expect(data[1]).toBeLessThan(100);
    expect(data[2]).toBeLessThan(100);
  });

  it('flattens transparency onto white', async () => {
    const transparent = await sharp({
      create: { width: 200, height: 200, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const src = await tempFile('trasparente.png', transparent);
    const outDir = await tempDir();

    const ref = await processImage(src, outDir);

    const { data, info } = await sharp(join(outDir, ref.detail.replace('img/', '')))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.channels).toBe(3);
    for (const value of data.subarray(0, 3)) expect(value).toBeGreaterThan(245);
  });

  it('applies the exif orientation', async () => {
    const jpeg = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#336699' } })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    const src = await tempFile('ruotata.jpg', jpeg);

    const ref = await processImage(src, await tempDir());

    expect(ref.width).toBe(200);
    expect(ref.height).toBe(300);
  });

  it('converts a photoshop psd (flattened composite image) to webp', async () => {
    const src = await tempFile('foto.psd', solidPsd(400, 300, [51, 102, 153]));
    const outDir = await tempDir();

    const ref = await processImage(src, outDir);

    expect(ref.width).toBe(400);
    expect(ref.height).toBe(300);
    const { data } = await sharp(join(outDir, ref.detail.replace('img/', '')))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[0]).toBeCloseTo(51, -1);
    expect(data[1]).toBeCloseTo(102, -1);
    expect(data[2]).toBeCloseTo(153, -1);
  });

  it('rejects a psd without a readable composite image with a typed error', async () => {
    const src = await tempFile('rotto.psd', '8BPS finto: nessun lettore sa aprirlo');

    const error = await processImage(src, await tempDir()).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnsupportedImageError);
    expect(error).toMatchObject({ message: 'formato immagine non supportato: rotto.psd' });
  });
});

describe('rasterizeVector', () => {
  it('rasterizes pdf drawings', async () => {
    const png = await rasterizeVector(PDF_FIXTURE);

    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    // 100 pt a 200 dpi.
    expect(await sharp(png).metadata()).toMatchObject({ format: 'png', width: 278, height: 278 });
  });

  it('accepts the pdf extension in any case', async () => {
    const src = join(await tempDir(), 'DISEGNO.PDF');
    await copyFile(PDF_FIXTURE, src);

    const png = await rasterizeVector(src);

    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('rejects eps, svg and other formats with a typed error', async () => {
    for (const name of ['disegno.eps', 'disegno.svg', 'disegno.dxf']) {
      const src = await tempFile(name, 'contenuto qualsiasi');

      await expect(rasterizeVector(src)).rejects.toBeInstanceOf(UnsupportedImageError);
    }
  });

  it('reports a broken pdf as unsupported', async () => {
    const src = await tempFile('rotto.pdf', 'questo non è un PDF');

    const error = await rasterizeVector(src).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnsupportedImageError);
    expect(error).toMatchObject({ message: 'formato immagine non supportato: rotto.pdf' });
  });

  it('does not hide a missing pdftoppm as an unsupported image', async () => {
    vi.stubEnv('PATH', '');

    const error = await rasterizeVector(PDF_FIXTURE).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(UnsupportedImageError);
    expect((error as Error).message).toBe('pdftoppm non trovato: installa poppler (su Mac: brew install poppler) e riprova');
  });

  /** Un finto `pdftoppm` nel PATH, per simulare senza il programma vero un processo ucciso da un segnale o che esce senza errore. */
  async function fakePdftoppm(script: string): Promise<string> {
    const dir = await tempDir();
    const path = join(dir, 'pdftoppm');
    await writeFile(path, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
    return dir;
  }

  it('reports a pdftoppm killed by a signal (as a timeout would) as an unsupported image', async () => {
    vi.stubEnv('PATH', await fakePdftoppm('kill -TERM "$$"'));

    const error = await rasterizeVector(PDF_FIXTURE).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnsupportedImageError);
  });

  it('reports a pdftoppm that exits without writing a PNG as an unsupported image', async () => {
    vi.stubEnv('PATH', await fakePdftoppm('exit 0'));

    const error = await rasterizeVector(PDF_FIXTURE).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UnsupportedImageError);
  });

  it('leaves no temporary files behind', async () => {
    const broken = await tempFile('rotto.pdf', 'questo non è un PDF');
    // Cartella temporanea privata: altri test (anche di altri worker) creano file temporanei nello stesso momento.
    const privateTmp = await tempDir();
    vi.stubEnv('TMPDIR', privateTmp);

    await rasterizeVector(PDF_FIXTURE);
    await rasterizeVector(broken).catch(() => undefined);

    expect(await readdir(privateTmp)).toEqual([]);
  });
});
