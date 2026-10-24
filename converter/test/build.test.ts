import { execFile } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseLineData, type LineData, type LineId } from '@arnoplast/schema';
import QRCode from 'qrcode';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLine, type BuildResult } from '../src/build';
import { buildIdml } from './helpers/build-idml';
import { makeSampleInput, type SampleInputOptions } from './helpers/sample-input';

vi.setConfig({ testTimeout: 30_000 });

const run = promisify(execFile);

const CONFIG = fileURLToPath(new URL('../catalogo.config.yaml', import.meta.url));
const CONVERTER_DIR = fileURLToPath(new URL('..', import.meta.url));

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'arnoplast-build-'));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Costruisce la linea `garden` 2026.1 dalla cartella di input indicata. */
async function build(inputDir: string, overrides: Partial<Parameters<typeof buildLine>[0]> = {}): Promise<BuildResult> {
  return buildLine({
    line: 'garden',
    edition: '2026.1',
    inputDir,
    outDir: await tempDir(),
    configPath: CONFIG,
    ...overrides,
  });
}

/** Crea l'input di prova e lo costruisce. */
async function buildSample(options?: SampleInputOptions): Promise<{ input: string; result: BuildResult }> {
  const input = await makeSampleInput(await tempDir(), options);
  return { input, result: await build(input) };
}

const readData = async (result: BuildResult): Promise<LineData> => JSON.parse(await readFile(result.dataPath, 'utf8'));

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

const errorsOf = (result: BuildResult) => result.issues.filter((issue) => issue.level === 'error');
const warningsOf = (result: BuildResult) => result.issues.filter((issue) => issue.level === 'warning');

describe('buildLine', () => {
  it('builds a valid line end to end', async () => {
    const { result } = await buildSample();

    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.dataPath).toBe(join(result.outDir, 'garden', '2026.1', 'data.json'));
    expect(result.reportPath).toBe(join(result.outDir, 'garden', '2026.1', 'report.html'));

    const raw = await readFile(result.dataPath, 'utf8');
    expect(raw).toMatch(/^\{\n {2}"format": 1,\n/);
    expect(raw.endsWith('}\n')).toBe(true);
    expect(() => parseLineData(JSON.parse(raw))).not.toThrow();

    const data = await readData(result);
    expect(data).toMatchObject({
      format: 1,
      line: 'garden',
      edition: '2026.1',
      languages: ['it', 'en'],
      name: { it: 'Garden', en: 'Garden' },
    });
    expect(data.categories).toHaveLength(1);
    expect(data.categories[0]).toMatchObject({ id: 'copripalo', name: { it: 'COPRIPALO', en: 'POST CAPS' } });
    expect(data.categories[0].image).not.toBeNull();

    expect(data.products).toHaveLength(1);
    const [product] = data.products;
    expect(product).toMatchObject({
      id: 'copripalo-prisma',
      categoryId: 'copripalo',
      name: { it: 'COPRIPALO PRISMA', en: 'POST CAP PRISMA' },
      materials: ['PP'],
      videoUrl: 'https://youtu.be/abc123',
    });
    expect(product.articles.map((article) => article.code)).toEqual(['1807-1351', '1807-1352']);
    expect(product.articles[0].description).toEqual({ it: 'Copripalo Prisma 7x7 cm', en: 'Post cap Prisma 7x7 cm' });
    expect(product.images).toHaveLength(1);
    expect(product.drawings).toHaveLength(1);

    // Foto del prodotto, disegno e immagine di apertura: tre immagini, ognuna con miniatura e dettaglio.
    const files = (await readdir(join(result.outDir, 'garden', 'img'))).sort();
    expect(files).toHaveLength(6);
    expect(files.every((file) => file.endsWith('.webp'))).toBe(true);
    for (const ref of [product.images[0], product.drawings[0], data.categories[0].image!]) {
      expect(files).toContain(ref.thumb.replace('img/', ''));
      expect(files).toContain(ref.detail.replace('img/', ''));
    }
  });

  it('reports missing link as error and unsupported format as warning', async () => {
    const { result } = await buildSample({
      extraLinks: ['manca.jpg', 'foto.psd'],
      extraFiles: { 'foto.psd': '8BPS finto: nessun lettore sa aprirlo' },
    });

    expect(result.ok).toBe(false);
    const errors = errorsOf(result);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toBe('immagine collegata mancante: manca.jpg');
    expect(errors[0].where).toBe('copripalo-prisma');
    const warnings = warningsOf(result);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toBe('formato immagine non supportato: foto.psd');
    expect(warnings[0].where).toBe('copripalo-prisma');

    // Con errori bloccanti il rapporto c'è, i dati no: la pubblicazione non può partire da una build fallita.
    expect(await exists(result.reportPath)).toBe(true);
    expect(await exists(result.dataPath)).toBe(false);
  });

  it('fails without italian', async () => {
    const input = await makeSampleInput(await tempDir());
    await rm(join(input, 'it'), { recursive: true });

    const result = await build(input);

    expect(result.ok).toBe(false);
    expect(errorsOf(result)).toHaveLength(1);
    expect(errorsOf(result)[0].message).toContain('italiano');
    expect(await exists(result.dataPath)).toBe(false);
  });

  it('writes report next to data', async () => {
    const { result } = await buildSample();

    expect(result.ok).toBe(true);
    expect(dirname(result.reportPath)).toBe(dirname(result.dataPath));
    expect(await exists(result.dataPath)).toBe(true);
    const report = await readFile(result.reportPath, 'utf8');
    expect(report).toContain('COPRIPALO PRISMA');
    expect(report).toContain('Pronto per la pubblicazione');
  });

  it('counts categories, products, articles, images and videos in the report', async () => {
    const { result } = await buildSample();

    const report = await readFile(result.reportPath, 'utf8');
    const stat = (value: number, label: string) => `<span class="value">${value}</span><span class="label">${label}</span>`;
    expect(report).toContain(stat(1, 'Categorie'));
    expect(report).toContain(stat(1, 'Prodotti'));
    expect(report).toContain(stat(2, 'Articoli'));
    expect(report).toContain(stat(3, 'Immagini'));
    expect(report).toContain(stat(1, 'Video'));
  });

  it('lists the products with their counts in the report', async () => {
    const { result } = await buildSample();

    const report = await readFile(result.reportPath, 'utf8');
    expect(report).toContain('<h2>Prodotti (1)</h2>');
    expect(report).toContain(
      '<tr><td>COPRIPALO</td><td>COPRIPALO PRISMA</td><td class="num">2</td><td class="num">1</td><td class="num">1</td><td>sì</td></tr>',
    );
  });

  it('removes the previous data and report when a step throws', async () => {
    const input = await makeSampleInput(await tempDir());
    const outDir = await tempDir();
    const good = await build(input, { outDir });
    expect(good.ok).toBe(true);
    expect(await exists(good.dataPath)).toBe(true);
    expect(await exists(good.reportPath)).toBe(true);

    // Senza pdftoppm nel PATH la rasterizzazione del disegno lancia ENOENT: un'eccezione, non un problema del file.
    vi.stubEnv('PATH', '');
    const error = await build(input, { outDir }).catch((e: unknown) => e);
    vi.unstubAllEnvs();

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ code: 'ENOENT' });
    expect(await exists(good.dataPath)).toBe(false);
    expect(await exists(good.reportPath)).toBe(false);
  });

  it('removes a stale data.json when the build fails', async () => {
    const input = await makeSampleInput(await tempDir(), { extraLinks: ['manca.jpg'] });
    const outDir = await tempDir();
    const stale = join(outDir, 'garden', '2026.1', 'data.json');
    await mkdir(dirname(stale), { recursive: true });
    await writeFile(stale, '{"vecchia": true}\n');

    const result = await build(input, { outDir });

    expect(result.ok).toBe(false);
    expect(result.dataPath).toBe(stale);
    expect(await exists(stale)).toBe(false);
    expect(await exists(result.reportPath)).toBe(true);
  });

  it('reports a missing category image as error', async () => {
    const input = await makeSampleInput(await tempDir());
    await rm(join(input, 'it', 'Links', 'apertura.png'));

    const result = await build(input);

    expect(result.ok).toBe(false);
    expect(errorsOf(result)).toEqual([
      { level: 'error', message: 'immagine collegata mancante: apertura.png', where: 'copripalo' },
    ]);
  });

  it('uses only the first video and warns about other qr codes', async () => {
    const { result } = await buildSample({
      extraLinks: ['altro-qr.png', 'seconda.png'],
      extraFiles: {
        'altro-qr.png': await QRCode.toBuffer('https://example.com/pagina', { type: 'png', width: 300 }),
        'seconda.png': await QRCode.toBuffer('https://youtu.be/seconda', { type: 'png', width: 300 }),
      },
    });

    expect(result.ok).toBe(true);
    expect(warningsOf(result)).toEqual([
      {
        level: 'warning',
        message: 'QR code non riconosciuto come video: https://example.com/pagina',
        where: 'copripalo-prisma',
      },
    ]);
    const [product] = (await readData(result)).products;
    expect(product.videoUrl).toBe('https://youtu.be/abc123');
    expect(product.images).toHaveLength(1);
  });

  it('keeps one copy of an identical image in a product', async () => {
    const input = await makeSampleInput(await tempDir(), { extraLinks: ['foto-copia.png'] });
    await copyFile(join(input, 'it', 'Links', 'foto.png'), join(input, 'it', 'Links', 'foto-copia.png'));

    const result = await build(input);

    expect(result.issues).toEqual([]);
    const [product] = (await readData(result)).products;
    expect(product.images).toHaveLength(1);
  });

  it('warns about an unsupported drawing and keeps the others', async () => {
    const { result } = await buildSample({
      extraLinks: ['figura.eps'],
      extraFiles: { 'figura.eps': '%!PS-Adobe finto' },
    });

    expect(result.ok).toBe(true);
    expect(warningsOf(result).map((issue) => issue.message)).toEqual(['formato immagine non supportato: figura.eps']);
    const [product] = (await readData(result)).products;
    expect(product.drawings).toHaveLength(1);
  });

  it('leaves no temporary files behind', async () => {
    const root = await tempDir();
    vi.stubEnv('TMPDIR', root);
    try {
      const { result } = await buildSample();
      expect(result.ok).toBe(true);
    } finally {
      vi.unstubAllEnvs();
    }

    const leftovers = (await readdir(root)).filter((name) => /^arnoplast-(vector|drawing)-/.test(name));
    expect(leftovers).toEqual([]);
  });
});

describe('buildLine input validation', () => {
  it('rejects an unknown line or a malformed edition before doing any work', async () => {
    const input = await makeSampleInput(await tempDir());
    const cases: Array<[Partial<Parameters<typeof buildLine>[0]>, string]> = [
      [{ line: 'giardino' as LineId }, 'giardino'],
      [{ edition: '2026' }, '2026'],
      [{ edition: '../fuori' }, '../fuori'],
    ];

    for (const [overrides, wanted] of cases) {
      const outDir = join(await tempDir(), 'out');

      const result = await build(input, { outDir, ...overrides });

      expect(result.ok).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0]).toMatchObject({ level: 'error' });
      expect(result.issues[0].message).toContain(wanted);
      expect(await exists(outDir)).toBe(false);
    }
  });

  it('fails when the input folder is missing', async () => {
    const missing = join(await tempDir(), 'non-esiste');

    const result = await build(missing);

    expect(result.ok).toBe(false);
    expect(errorsOf(result)).toHaveLength(1);
    expect(errorsOf(result)[0].message).toContain(missing);
    expect(await exists(result.reportPath)).toBe(true);
  });

  it('fails when a language folder has no idml or several', async () => {
    const input = await makeSampleInput(await tempDir());
    await rm(join(input, 'en', 'catalogo.idml'));
    const none = await build(input);

    await copyFile(join(input, 'it', 'catalogo.idml'), join(input, 'en', 'uno.idml'));
    await copyFile(join(input, 'it', 'catalogo.idml'), join(input, 'en', 'due.idml'));
    const several = await build(input);

    for (const result of [none, several]) {
      expect(result.ok).toBe(false);
      expect(errorsOf(result)).toHaveLength(1);
      expect(errorsOf(result)[0]).toMatchObject({ where: 'en' });
      expect(errorsOf(result)[0].message).toContain('«en»');
      expect(await exists(result.dataPath)).toBe(false);
    }
  });

  it('warns about language folders that are not in the configuration', async () => {
    const input = await makeSampleInput(await tempDir());
    await mkdir(join(input, 'fr'));

    const result = await build(input);

    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([{ level: 'warning', message: 'cartella lingua ignorata: fr', where: 'fr' }]);
    expect((await readData(result)).languages).toEqual(['it', 'en']);
  });

  it('warns when a configured language has no folder and builds the others', async () => {
    const input = await makeSampleInput(await tempDir());
    await rm(join(input, 'en'), { recursive: true });

    const result = await build(input);

    expect(result.ok).toBe(true);
    expect(warningsOf(result)).toHaveLength(1);
    expect(warningsOf(result)[0].message).toContain('en');
    expect((await readData(result)).languages).toEqual(['it']);
  });

  it('fails when a language has no products', async () => {
    const input = await makeSampleInput(await tempDir());
    const unstyled = await buildIdml({
      spreads: [
        {
          frames: [
            { kind: 'text', x: 0, y: 0, w: 300, h: 100, items: [{ kind: 'paragraph', style: 'Altro stile', text: 'Testo' }] },
          ],
        },
      ],
    });
    await copyFile(unstyled, join(input, 'en', 'catalogo.idml'));

    const result = await build(input);

    expect(result.ok).toBe(false);
    expect(errorsOf(result)).toEqual([
      {
        level: 'error',
        message: 'nessun prodotto trovato in en: controlla gli stili in catalogo.config.yaml',
        where: 'en',
      },
    ]);
    expect(await exists(result.dataPath)).toBe(false);
  });

  it('reports an unreadable idml as an error', async () => {
    const input = await makeSampleInput(await tempDir());
    await writeFile(join(input, 'en', 'catalogo.idml'), 'questo non è uno zip');

    const result = await build(input);

    expect(result.ok).toBe(false);
    expect(errorsOf(result)).toHaveLength(1);
    expect(errorsOf(result)[0].where).toBe('en');
    expect(errorsOf(result)[0].message).toContain('File IDML non leggibile');
  });

  it('reports a configuration error as an issue', async () => {
    const input = await makeSampleInput(await tempDir());

    const result = await build(input, { configPath: join(await tempDir(), 'manca.yaml') });

    expect(result.ok).toBe(false);
    expect(errorsOf(result)).toHaveLength(1);
    expect(errorsOf(result)[0].message).toContain('File di configurazione non leggibile');
  });
});

describe('catalogo build', () => {
  const catalogo = (input: string, out: string) =>
    run('pnpm', [
      '--dir',
      CONVERTER_DIR,
      'catalogo',
      'build',
      '--linea',
      'garden',
      '--edizione',
      '2026.1',
      '--input',
      input,
      '--out',
      out,
      '--config',
      CONFIG,
    ]);

  it('cli exits 1 on errors', { timeout: 60_000 }, async () => {
    const input = await makeSampleInput(await tempDir(), { extraLinks: ['manca.jpg'] });
    const out = await tempDir();

    const error = await catalogo(input, out).then(
      () => undefined,
      (e: unknown) => e as { code: number; stdout: string },
    );

    expect(error).toBeDefined();
    expect(error!.code).toBe(1);
    expect(error!.stdout).toContain('Errori: 1');
    expect(error!.stdout).toContain('manca.jpg');
    expect(error!.stdout).toContain(join(out, 'garden', '2026.1', 'report.html'));
  });

  it('cli exits 0 and prints the report path on a valid build', { timeout: 60_000 }, async () => {
    const input = await makeSampleInput(await tempDir());
    const out = await tempDir();

    const { stdout } = await catalogo(input, out);

    expect(stdout).toContain('Errori: 0');
    expect(stdout).toContain('Avvisi: 0');
    expect(stdout).toContain(join(out, 'garden', '2026.1', 'report.html'));
    expect(await exists(join(out, 'garden', '2026.1', 'data.json'))).toBe(true);
  });
});
