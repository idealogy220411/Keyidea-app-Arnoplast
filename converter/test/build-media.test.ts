import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImageContext } from '../src/build-media';
import type { MergedProduct } from '../src/merge';
import type { Issue } from '../src/types';

vi.mock('../src/media', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/media')>();
  return { ...actual, processImage: vi.fn(), rasterizeVector: vi.fn() };
});
vi.mock('../src/qr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/qr')>();
  return { ...actual, decodeQr: vi.fn() };
});

const { processImage, rasterizeVector } = await import('../src/media');
const { decodeQr } = await import('../src/qr');
const { processProduct } = await import('../src/build-media');

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'arnoplast-build-media-'));
  dirs.push(dir);
  return dir;
}
afterEach(async () => {
  vi.mocked(processImage).mockReset();
  vi.mocked(rasterizeVector).mockReset();
  vi.mocked(decodeQr).mockReset();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

const REF = { thumb: 'img/a-400.webp', detail: 'img/a-1600.webp', width: 10, height: 10 };

/** Prodotto di prova con i collegamenti indicati; gli altri campi non contano per `processProduct`. */
function product(overrides: Partial<MergedProduct> = {}): MergedProduct {
  return {
    id: 'agricoltura/copripalo-prisma',
    categoryId: 'copripalo',
    name: { it: 'COPRIPALO PRISMA' },
    materials: [],
    features: { it: [] },
    dimensions: { it: [] },
    articles: [],
    optionalCodes: [],
    fixingOptions: { it: [] },
    imageLinks: [],
    drawingLinks: [],
    ...overrides,
  };
}

/** Un `ImageContext` con una cartella `Links` reale (i file bastano vuoti: le letture sono finte). */
async function contextWith(fileNames: string[], qrFilenamePattern = /qr/i): Promise<{ ctx: ImageContext; issues: Issue[] }> {
  const linksDir = await tempDir();
  for (const name of fileNames) await writeFile(join(linksDir, name), '');
  const issues: Issue[] = [];
  return { ctx: { linksDir, imgDir: await tempDir(), issues, qrFilenamePattern }, issues };
}

describe('processProduct — video QR da un disegno rasterizzato (Ruling 19a)', () => {
  it('reads a QR on the rasterized drawing and uses a video it finds as the product video, not a drawing', async () => {
    vi.mocked(rasterizeVector).mockResolvedValue(Buffer.from('finto-png'));
    vi.mocked(decodeQr).mockResolvedValue('https://youtu.be/dal-disegno');

    const { ctx } = await contextWith(['disegno.pdf']);
    const result = await processProduct(product({ drawingLinks: ['file:/a/disegno.pdf'] }), ctx);

    expect(result.videoUrl).toBe('https://youtu.be/dal-disegno');
    expect(result.drawings).toEqual([]);
    expect(processImage).not.toHaveBeenCalled();
    expect(ctx.issues).toEqual([]);
  });

  it('keeps a drawing without a QR as a drawing, as before', async () => {
    vi.mocked(rasterizeVector).mockResolvedValue(Buffer.from('finto-png'));
    vi.mocked(decodeQr).mockResolvedValue(null);
    vi.mocked(processImage).mockResolvedValue(REF);

    const { ctx } = await contextWith(['disegno.pdf']);
    const result = await processProduct(product({ drawingLinks: ['file:/a/disegno.pdf'] }), ctx);

    expect(result.drawings).toEqual([REF]);
    expect(result.videoUrl).toBeNull();
  });
});

describe('processProduct — QR non leggibile per nome file (Ruling 19b)', () => {
  it('warns and uses neither as photo nor drawing when a file named like a QR does not decode', async () => {
    vi.mocked(decodeQr).mockResolvedValue(null);

    const { ctx } = await contextWith(['qr-rotto.png']);
    const result = await processProduct(product({ imageLinks: ['file:/a/qr-rotto.png'] }), ctx);

    expect(result.images).toEqual([]);
    expect(processImage).not.toHaveBeenCalled();
    expect(ctx.issues).toEqual([{ level: 'warning', message: 'QR code non leggibile: qr-rotto.png', where: 'agricoltura/copripalo-prisma' }]);
  });

  it('warns on an unsupported drawing format named like a QR instead of the generic warning', async () => {
    const { UnsupportedImageError } = await import('../src/media');
    vi.mocked(rasterizeVector).mockRejectedValue(new UnsupportedImageError('qr-vettoriale.eps'));

    const { ctx } = await contextWith(['qr-vettoriale.eps']);
    const result = await processProduct(product({ drawingLinks: ['file:/a/qr-vettoriale.eps'] }), ctx);

    expect(result.drawings).toEqual([]);
    expect(ctx.issues).toEqual([
      { level: 'warning', message: 'QR code non leggibile: qr-vettoriale.eps', where: 'agricoltura/copripalo-prisma' },
    ]);
  });

  it('does not flag a normal photo whose name does not match the pattern', async () => {
    vi.mocked(decodeQr).mockResolvedValue(null);
    vi.mocked(processImage).mockResolvedValue(REF);

    const { ctx } = await contextWith(['foto.png']);
    const result = await processProduct(product({ imageLinks: ['file:/a/foto.png'] }), ctx);

    expect(result.images).toEqual([REF]);
    expect(ctx.issues).toEqual([]);
  });
});

describe('processProduct — più di un video (Ruling 19c)', () => {
  it('warns when a second, different video QR is found and keeps the first video', async () => {
    vi.mocked(decodeQr).mockResolvedValueOnce('https://youtu.be/primo').mockResolvedValueOnce('https://youtu.be/secondo');

    const { ctx } = await contextWith(['video1.png', 'video2.png']);
    const result = await processProduct(
      product({ imageLinks: ['file:/a/video1.png', 'file:/a/video2.png'] }),
      ctx,
    );

    expect(result.videoUrl).toBe('https://youtu.be/primo');
    expect(ctx.issues).toEqual([
      {
        level: 'warning',
        message: 'più di un video per il prodotto «COPRIPALO PRISMA»: https://youtu.be/secondo ignorato',
        where: 'agricoltura/copripalo-prisma',
      },
    ]);
  });

  it('does not warn when the same video QR repeats', async () => {
    vi.mocked(decodeQr).mockResolvedValue('https://youtu.be/uguale');

    const { ctx } = await contextWith(['video1.png', 'video2.png']);
    const result = await processProduct(
      product({ imageLinks: ['file:/a/video1.png', 'file:/a/video2.png'] }),
      ctx,
    );

    expect(result.videoUrl).toBe('https://youtu.be/uguale');
    expect(ctx.issues).toEqual([]);
  });
});
