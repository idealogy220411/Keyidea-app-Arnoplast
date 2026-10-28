import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { loadConfig } from '../src/config';

const DEFAULT_CONFIG = fileURLToPath(new URL('../catalogo.config.yaml', import.meta.url));

const tempDirs: string[] = [];
afterAll(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function writeTempYaml(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'arnoplast-config-'));
  tempDirs.push(dir);
  const filePath = join(dir, 'catalogo.config.yaml');
  await writeFile(filePath, content);
  return filePath;
}

/** La configurazione predefinita, letta come oggetto, con una modifica. */
async function defaultConfigWith(change: (raw: Record<string, unknown>) => void): Promise<string> {
  const raw = parse(await readFile(DEFAULT_CONFIG, 'utf8')) as Record<string, unknown>;
  change(raw);
  return writeTempYaml(stringify(raw));
}

it('config: loads the default file', async () => {
  const config = await loadConfig(DEFAULT_CONFIG);
  expect(config.styles.product).toBe('TITOLO');
  expect(config.articleColumns.length).toBe(5);
  expect(config.styles).toEqual({
    product: 'TITOLO',
    entry: 'CARATTERTISTICHE',
    featuresHeading: { it: 'CARATTERISTICHE', en: 'FEATURES' },
    dimensionsHeading: { it: 'DIMENSIONI', en: 'DIMENSIONS' },
    optionalFixingHeading: { it: 'OPTIONAL DI FISSAGGIO', en: 'FIXING OPTIONS' },
  });
  expect(config.articleColumns).toEqual(['code', 'description', 'perPack', 'perBox', 'perPallet']);
  expect(config.languages).toEqual(['it', 'en']);
  expect(config.lines.agricoltura.name).toEqual({ it: 'Agricoltura', en: 'Agriculture' });
  expect(config.lines.garden.name).toEqual({ it: 'Garden', en: 'Garden' });
  expect(config.lines.olive.name).toEqual({ it: 'Raccolta olive', en: 'Olive harvesting' });
  expect(config.categories.agricoltura).toHaveLength(1);
  expect(config.categories.agricoltura[0]).toEqual({ id: 'copripalo', name: { it: 'Copripalo', en: 'Post caps' } });
  expect(config.drawingExtensions).toEqual(['.ai', '.pdf', '.eps', '.svg']);
  expect(new RegExp(config.optionalPattern, 'i').test('Dado a griffe M6 (optional)')).toBe(true);
  expect(config.qrFilenamePattern).toBe('qr');
});

it('config: qrFilenamePattern defaults to "qr" and can be overridden', async () => {
  const defaultFile = await defaultConfigWith(() => {});
  const defaultConfig = await loadConfig(defaultFile);
  expect(new RegExp(defaultConfig.qrFilenamePattern, 'i').test('QR-codice.png')).toBe(true);
  expect(new RegExp(defaultConfig.qrFilenamePattern, 'i').test('foto.png')).toBe(false);

  const custom = await defaultConfigWith((raw) => {
    raw.qrFilenamePattern = 'codice';
  });
  const config = await loadConfig(custom);
  expect(config.qrFilenamePattern).toBe('codice');
});

it('config: reports an invalid qrFilenamePattern', async () => {
  const file = await defaultConfigWith((raw) => {
    raw.qrFilenamePattern = '(';
  });
  await expect(loadConfig(file)).rejects.toThrow(/qrFilenamePattern/);
});

it('config: reports invalid file in italian', async () => {
  const file = await defaultConfigWith((raw) => {
    delete raw.styles;
  });
  const error = await loadConfig(file).then(
    () => undefined,
    (e: unknown) => e as Error,
  );
  expect(error).toBeInstanceOf(Error);
  expect(error?.message).toContain('styles');
  expect(error?.message).toContain('Configurazione non valida');
  expect(error?.message).toContain(file);
});

it('config: reports every wrong value with its position', async () => {
  const file = await defaultConfigWith((raw) => {
    raw.languages = ['en'];
    raw.articleColumns = ['code', 'description', 'prezzo'];
    raw.optionalPattern = '(';
    raw.overrides = { materials: { 'COPRIPALO PRISMA': ['ABS'] } };
    raw.contatti = {};
  });
  const message = await loadConfig(file).then(
    () => '',
    (e: unknown) => (e as Error).message,
  );
  expect(message).toContain('languages');
  expect(message).toContain('articleColumns.2');
  expect(message).toContain('optionalPattern');
  expect(message).toContain('overrides.materials.COPRIPALO PRISMA.0');
  expect(message).toContain('contatti');
});

it('config: requires the code and description columns', async () => {
  const file = await defaultConfigWith((raw) => {
    raw.articleColumns = ['ignore', 'description', 'perPack'];
  });
  await expect(loadConfig(file)).rejects.toThrow(/articleColumns.*code/);
});

it('config: reports missing and malformed files in italian', async () => {
  const missing = join(tmpdir(), 'arnoplast-non-esiste', 'catalogo.config.yaml');
  await expect(loadConfig(missing)).rejects.toThrow(/File di configurazione non leggibile/);

  const malformed = await writeTempYaml('languages: [it, en\nstyles: {');
  await expect(loadConfig(malformed)).rejects.toThrow(/YAML non valido/);
});
