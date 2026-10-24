import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parseIndex, type IndexFile, type LineId } from '@arnoplast/schema';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildLine } from '../src/build';
import { publishLine, rollbackLine } from '../src/publish/publish';
import { LocalStore, storeFromEnv } from '../src/publish/store';
import { makeSampleInput } from './helpers/sample-input';

vi.setConfig({ testTimeout: 30_000 });

const run = promisify(execFile);

const CONFIG = fileURLToPath(new URL('../catalogo.config.yaml', import.meta.url));
const CONVERTER_DIR = fileURLToPath(new URL('..', import.meta.url));

const CONTACTS = { email: 'info@example.com', whatsapp: '+39 000 0000000' };
const EDITIONS = ['2026.1', '2026.2', '2026.3', '2026.4', '2026.5', '2026.6', '2026.7'];

const dirs: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'arnoplast-publish-'));
  dirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** Cartella di build condivisa: `agricoltura` in sette edizioni e `garden` 2026.1, prodotte da `buildLine`. */
let buildDir: string;

beforeAll(async () => {
  const input = await makeSampleInput(await tempDir());
  buildDir = await tempDir();
  const builds: Array<[LineId, string]> = [...EDITIONS.map((edition): [LineId, string] => ['agricoltura', edition]), ['garden', '2026.1']];
  for (const [line, edition] of builds) {
    const result = await buildLine({ line, edition, inputDir: input, outDir: buildDir, configPath: CONFIG });
    if (!result.ok) throw new Error(`build di prova non riuscita: ${line} ${edition}`);
  }
}, 120_000);

let siteDir: string;
let store: LocalStore;

beforeEach(async () => {
  siteDir = await tempDir();
  store = new LocalStore(siteDir);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Un istante diverso per ogni numero: le date dell'indice si distinguono tra una pubblicazione e l'altra. */
const at = (minute: number): Date => new Date(Date.UTC(2026, 2, 1, 10, minute));

const sha256 = (bytes: Buffer | string): string => createHash('sha256').update(bytes).digest('hex');

function publish(
  target: LocalStore,
  line: LineId,
  edition: string,
  overrides: Partial<Parameters<typeof publishLine>[1]> = {},
): Promise<IndexFile> {
  return publishLine(target, { line, edition, buildDir, env: 'prova', contacts: CONTACTS, now: at(0), ...overrides });
}

const readIndex = async (root = 'catalogo-prova'): Promise<IndexFile> =>
  parseIndex(JSON.parse(await readFile(join(siteDir, root, 'index.json'), 'utf8')));

const readSite = (...path: string[]): Promise<string> => readFile(join(siteDir, ...path), 'utf8');

const exists = (...path: string[]): Promise<boolean> =>
  readFile(join(siteDir, ...path)).then(
    () => true,
    () => false,
  );

/** Un `LocalStore` il cui N-esimo caricamento fallisce, come una connessione che cade a metà. */
class FailingStore extends LocalStore {
  uploads = 0;
  readonly failAt: number;

  constructor(rootDir: string, failAt: number) {
    super(rootDir);
    this.failAt = failAt;
  }

  override async upload(localPath: string, remotePath: string): Promise<void> {
    this.uploads += 1;
    if (this.uploads === this.failAt) throw new Error('connessione interrotta');
    await super.upload(localPath, remotePath);
  }
}

describe('publishLine', () => {
  it('publishes images, data and index', async () => {
    const index = await publish(store, 'agricoltura', '2026.1', { now: at(5) });

    const localImages = (await readdir(join(buildDir, 'agricoltura', 'img'))).sort();
    expect(localImages.length).toBeGreaterThan(0);
    expect(localImages.every((name) => name.endsWith('.webp'))).toBe(true);
    expect((await readdir(join(siteDir, 'catalogo-prova', 'agricoltura', 'img'))).sort()).toEqual(localImages);

    const localData = await readFile(join(buildDir, 'agricoltura', '2026.1', 'data.json'));
    const remoteData = await readFile(join(siteDir, 'catalogo-prova', 'agricoltura', '2026.1', 'data.json'));
    expect(remoteData.equals(localData)).toBe(true);
    expect(await exists('catalogo-prova', 'agricoltura', '2026.1', 'report.html')).toBe(true);

    const published = await readIndex();
    expect(published).toEqual(index);
    expect(published.lines.agricoltura).toEqual({
      edition: '2026.1',
      path: 'agricoltura/2026.1/data.json',
      sha256: sha256(localData),
      publishedAt: at(5).toISOString(),
      previous: [],
    });
    expect(published.generatedAt).toBe(at(5).toISOString());
    expect(published.contacts).toEqual(CONTACTS);
  });

  it('publishes to catalogo/ in production', async () => {
    await publish(store, 'agricoltura', '2026.1', { env: 'produzione' });

    expect((await readIndex('catalogo')).lines.agricoltura?.edition).toBe('2026.1');
    expect(await exists('catalogo', 'agricoltura', '2026.1', 'data.json')).toBe(true);
    expect(await exists('catalogo-prova')).toBe(false);
  });

  it('does not touch index when an upload fails', async () => {
    const failing = new FailingStore(siteDir, 3);

    await expect(publish(failing, 'agricoltura', '2026.1')).rejects.toThrow('connessione interrotta');

    expect(failing.uploads).toBe(3);
    expect(await exists('catalogo-prova', 'index.json')).toBe(false);
  });

  it('leaves an existing index unchanged when an upload fails', async () => {
    await publish(store, 'agricoltura', '2026.1');
    const before = await readSite('catalogo-prova', 'index.json');

    // Le immagini ci sono già: il primo caricamento è il data.json della nuova edizione.
    await expect(publish(new FailingStore(siteDir, 1), 'agricoltura', '2026.2', { now: at(9) })).rejects.toThrow(
      'connessione interrotta',
    );

    expect(await readSite('catalogo-prova', 'index.json')).toBe(before);
  });

  it('resumes after an interrupted publish', async () => {
    await expect(publish(new FailingStore(siteDir, 3), 'agricoltura', '2026.1')).rejects.toThrow();

    const index = await publish(store, 'agricoltura', '2026.1');

    expect(index.lines.agricoltura?.edition).toBe('2026.1');
    expect(index.lines.agricoltura?.previous).toEqual([]);
    const names = await readdir(join(siteDir, 'catalogo-prova', 'agricoltura', 'img'));
    expect(names.every((name) => name.endsWith('.webp'))).toBe(true);
  });

  it('is idempotent when re-run', async () => {
    const first = await publish(store, 'agricoltura', '2026.1', { now: at(1) });
    const second = await publish(store, 'agricoltura', '2026.1', { now: at(2) });

    expect(second.lines.agricoltura?.previous).toEqual([]);
    expect({
      ...second,
      generatedAt: first.generatedAt,
      lines: { agricoltura: { ...second.lines.agricoltura, publishedAt: first.lines.agricoltura?.publishedAt } },
    }).toEqual(first);
    expect(await readIndex()).toEqual(second);
  });

  it('keeps previous editions', async () => {
    await publish(store, 'agricoltura', '2026.1');
    const second = await publish(store, 'agricoltura', '2026.2');
    expect(second.lines.agricoltura?.edition).toBe('2026.2');
    expect(second.lines.agricoltura?.previous).toEqual(['2026.1']);

    for (const edition of EDITIONS.slice(2)) await publish(store, 'agricoltura', edition);

    const last = (await readIndex()).lines.agricoltura;
    expect(last?.edition).toBe('2026.7');
    expect(last?.previous.length).toBe(5);
    expect(last?.previous).toEqual(['2026.6', '2026.5', '2026.4', '2026.3', '2026.2']);
  });

  it('never lists the current edition in previous', async () => {
    await publish(store, 'agricoltura', '2026.1');
    await publish(store, 'agricoltura', '2026.2');

    const index = await publish(store, 'agricoltura', '2026.1');

    expect(index.lines.agricoltura?.edition).toBe('2026.1');
    expect(index.lines.agricoltura?.previous).toEqual(['2026.2']);
  });

  it('refuses invalid build', async () => {
    const broken = await tempDir();
    await cp(buildDir, broken, { recursive: true });
    const dataPath = join(broken, 'agricoltura', '2026.1', 'data.json');
    const data = JSON.parse(await readFile(dataPath, 'utf8'));
    data.products[0].articles = [];
    await writeFile(dataPath, JSON.stringify(data));

    await expect(publish(store, 'agricoltura', '2026.1', { buildDir: broken })).rejects.toThrow(/data\.json non valido/);

    expect(await readdir(siteDir)).toEqual([]);
  });

  it('refuses a build without data.json', async () => {
    const empty = await tempDir();

    await expect(publish(store, 'agricoltura', '2026.1', { buildDir: empty })).rejects.toThrow(/manca data\.json/);

    expect(await readdir(siteDir)).toEqual([]);
  });

  it('refuses a data.json that is not JSON', async () => {
    const broken = await tempDir();
    await mkdir(join(broken, 'agricoltura', '2026.1'), { recursive: true });
    await writeFile(join(broken, 'agricoltura', '2026.1', 'data.json'), '{ non è json');

    await expect(publish(store, 'agricoltura', '2026.1', { buildDir: broken })).rejects.toThrow(/data\.json non valido/);

    expect(await readdir(siteDir)).toEqual([]);
  });

  it('refuses a data.json of another line or edition', async () => {
    const other = await tempDir();
    await cp(buildDir, other, { recursive: true });
    // Il data.json di garden messo nella cartella di agricoltura, e quello della 2026.2 nella 2026.1.
    await cp(join(buildDir, 'garden', '2026.1', 'data.json'), join(other, 'agricoltura', '2026.1', 'data.json'));
    await cp(join(buildDir, 'agricoltura', '2026.2', 'data.json'), join(other, 'agricoltura', '2026.3', 'data.json'));

    await expect(publish(store, 'agricoltura', '2026.1', { buildDir: other })).rejects.toThrow(/linea «garden».*«agricoltura»/);
    await expect(publish(store, 'agricoltura', '2026.3', { buildDir: other })).rejects.toThrow(/edizione «2026\.2».*«2026\.3»/);

    expect(await readdir(siteDir)).toEqual([]);
  });

  it('refuses an unknown line or a malformed edition before anything else', async () => {
    await expect(publish(store, 'tetti' as LineId, '2026.1')).rejects.toThrow(/linea sconosciuta/);
    await expect(publish(store, 'agricoltura', '2026')).rejects.toThrow(/edizione non valida/);
    await expect(publish(store, 'agricoltura', '../2026.1')).rejects.toThrow(/edizione non valida/);

    expect(await readdir(siteDir)).toEqual([]);
  });

  it('refuses to publish without contacts', async () => {
    await expect(publish(store, 'agricoltura', '2026.1', { contacts: undefined })).rejects.toThrow(
      'mancano email e WhatsApp in catalogo.config.yaml',
    );
    await expect(
      publish(store, 'agricoltura', '2026.1', { contacts: { email: '', whatsapp: CONTACTS.whatsapp } }),
    ).rejects.toThrow('mancano email e WhatsApp');

    expect(await readdir(siteDir)).toEqual([]);
  });

  it('refuses a corrupted index on the server instead of overwriting it', async () => {
    await mkdir(join(siteDir, 'catalogo-prova'));
    await writeFile(join(siteDir, 'catalogo-prova', 'index.json'), '{ rovinato');

    await expect(publish(store, 'agricoltura', '2026.1')).rejects.toThrow(/index\.json sul server non è valido/);

    expect(await readSite('catalogo-prova', 'index.json')).toBe('{ rovinato');
  });

  it('lines are independent', async () => {
    const first = await publish(store, 'agricoltura', '2026.1', { now: at(1) });
    const second = await publish(store, 'garden', '2026.1', { now: at(2) });

    expect(second.lines.agricoltura).toEqual(first.lines.agricoltura);
    expect(second.lines.garden?.edition).toBe('2026.1');
    expect(second.lines.garden?.path).toBe('garden/2026.1/data.json');
    expect(second.lines.garden?.sha256).not.toBe(second.lines.agricoltura?.sha256);

    const third = await publish(store, 'agricoltura', '2026.2', { now: at(3) });
    expect(third.lines.garden).toEqual(second.lines.garden);
    expect(third.lines.agricoltura?.previous).toEqual(['2026.1']);
  });

  it('writes cache rules once', async () => {
    await publish(store, 'agricoltura', '2026.1');

    const rules = await readSite('catalogo-prova', '.htaccess');
    expect(rules).toContain('<IfModule mod_headers.c>');
    expect(rules).toMatch(/index\.json[\s\S]*Header set Cache-Control "no-cache"/);
    expect(rules).toMatch(/webp[\s\S]*Header set Cache-Control "public, max-age=31536000, immutable"/);
    expect(rules).toContain('data');

    await writeFile(join(siteDir, 'catalogo-prova', '.htaccess'), '# modificato a mano\n');
    await publish(store, 'agricoltura', '2026.2');

    expect(await readSite('catalogo-prova', '.htaccess')).toBe('# modificato a mano\n');
  });
});

describe('rollbackLine', () => {
  it('rolls back to previous edition', async () => {
    await publish(store, 'agricoltura', '2026.1');
    await publish(store, 'agricoltura', '2026.2');
    const dataOf = (edition: string) => readFile(join(siteDir, 'catalogo-prova', 'agricoltura', edition, 'data.json'));

    const index = await rollbackLine(store, { line: 'agricoltura', env: 'prova', now: at(30) });

    expect(index.lines.agricoltura).toEqual({
      edition: '2026.1',
      path: 'agricoltura/2026.1/data.json',
      sha256: sha256(await dataOf('2026.1')),
      publishedAt: at(30).toISOString(),
      previous: [],
    });
    expect(index.lines.agricoltura?.sha256).not.toBe(sha256(await dataOf('2026.2')));
    expect(index.generatedAt).toBe(at(30).toISOString());
    expect(index.contacts).toEqual(CONTACTS);
    expect(await readIndex()).toEqual(index);
  });

  it('goes back one edition at a time', async () => {
    for (const edition of ['2026.1', '2026.2', '2026.3']) await publish(store, 'agricoltura', edition);

    const first = await rollbackLine(store, { line: 'agricoltura', env: 'prova', now: at(1) });
    expect(first.lines.agricoltura?.edition).toBe('2026.2');
    expect(first.lines.agricoltura?.previous).toEqual(['2026.1']);

    const second = await rollbackLine(store, { line: 'agricoltura', env: 'prova', now: at(2) });
    expect(second.lines.agricoltura?.edition).toBe('2026.1');
    expect(second.lines.agricoltura?.previous).toEqual([]);
  });

  it('leaves other lines alone', async () => {
    await publish(store, 'agricoltura', '2026.1');
    await publish(store, 'agricoltura', '2026.2');
    const before = await publish(store, 'garden', '2026.1');

    const index = await rollbackLine(store, { line: 'agricoltura', env: 'prova', now: at(30) });

    expect(index.lines.garden).toEqual(before.lines.garden);
  });

  it('refuses rollback without previous', async () => {
    await publish(store, 'agricoltura', '2026.1');
    const before = await readSite('catalogo-prova', 'index.json');

    await expect(rollbackLine(store, { line: 'agricoltura', env: 'prova', now: at(1) })).rejects.toThrow(
      'nessuna edizione precedente per agricoltura',
    );
    // Linea mai pubblicata, e server senza indice.
    await expect(rollbackLine(store, { line: 'garden', env: 'prova', now: at(1) })).rejects.toThrow(
      'nessuna edizione precedente per garden',
    );
    await expect(rollbackLine(new LocalStore(await tempDir()), { line: 'garden', env: 'prova', now: at(1) })).rejects.toThrow(
      'nessuna edizione precedente',
    );

    expect(await readSite('catalogo-prova', 'index.json')).toBe(before);
  });

  it('refuses rollback when the previous edition is gone from the server', async () => {
    await publish(store, 'agricoltura', '2026.1');
    await publish(store, 'agricoltura', '2026.2');
    await rm(join(siteDir, 'catalogo-prova', 'agricoltura', '2026.1'), { recursive: true });
    const before = await readSite('catalogo-prova', 'index.json');

    await expect(rollbackLine(store, { line: 'agricoltura', env: 'prova', now: at(1) })).rejects.toThrow(
      "l'edizione 2026.1 non è più sul server",
    );

    expect(await readSite('catalogo-prova', 'index.json')).toBe(before);
  });
});

describe('storeFromEnv', () => {
  it('storeFromEnv lists missing variables', async () => {
    // Nessuna connessione: le variabili si controllano prima di aprirla.
    const error = await storeFromEnv({}).then(
      () => undefined,
      (e: unknown) => e as Error,
    );

    expect(error?.message).toContain('ARNO_SFTP_HOST');
    expect(error?.message).toContain('ARNO_SFTP_USER');
    expect(error?.message).toContain('ARNO_SFTP_ROOT');
    expect(error?.message).toContain('ARNO_SFTP_PASSWORD');
    expect(error?.message).toContain('ARNO_SFTP_KEY_PATH');
    expect(error?.message).toContain('ARNO_STORE_LOCAL_DIR');
  });

  it('names only the variables that are missing', async () => {
    const env = { ARNO_SFTP_HOST: 'sftp.example.test', ARNO_SFTP_ROOT: '/www', ARNO_SFTP_KEY_PATH: '/chiavi/prova' };

    const error = await storeFromEnv(env).then(
      () => undefined,
      (e: unknown) => e as Error,
    );

    expect(error?.message).toContain('ARNO_SFTP_USER');
    expect(error?.message).not.toContain('ARNO_SFTP_HOST');
    expect(error?.message).not.toContain('ARNO_SFTP_ROOT');
    expect(error?.message).not.toContain('ARNO_SFTP_PASSWORD');
  });

  it('rejects an invalid port before connecting', async () => {
    const env = { ARNO_SFTP_HOST: 'sftp.example.test', ARNO_SFTP_USER: 'utente', ARNO_SFTP_ROOT: '/www', ARNO_SFTP_PASSWORD: 'x', ARNO_SFTP_PORT: 'venti' };

    await expect(storeFromEnv(env)).rejects.toThrow('ARNO_SFTP_PORT');
  });

  it('publishes to a local folder when ARNO_STORE_LOCAL_DIR is set', async () => {
    const chosen = await storeFromEnv({ ARNO_STORE_LOCAL_DIR: siteDir });

    expect(chosen).toBeInstanceOf(LocalStore);
    await chosen.writeText('prova.txt', 'ciao');
    expect(await readSite('prova.txt')).toBe('ciao');
    await chosen.close();
  });
});

describe('LocalStore', () => {
  it('reads, writes and uploads under the root', async () => {
    expect(await store.exists('a/b.txt')).toBe(false);
    expect(await store.readText('a/b.txt')).toBeNull();

    await store.writeText('a/b.txt', 'uno');
    await store.writeText('a/b.txt', 'due');
    const source = join(await tempDir(), 'sorgente.bin');
    await writeFile(source, 'dati');
    await store.upload(source, 'c/d/e.bin');

    expect(await store.exists('a/b.txt')).toBe(true);
    expect(await store.readText('a/b.txt')).toBe('due');
    expect(await readSite('c', 'd', 'e.bin')).toBe('dati');
    // Scrittura atomica: nessun file temporaneo resta accanto al risultato.
    expect(await readdir(join(siteDir, 'a'))).toEqual(['b.txt']);
    expect(await readdir(join(siteDir, 'c', 'd'))).toEqual(['e.bin']);
  });

  it('local store rejects paths outside the root', async () => {
    const outside = join(siteDir, '..', 'fuori.txt');
    const source = join(await tempDir(), 'sorgente.bin');
    await writeFile(source, 'dati');

    for (const path of ['../fuori.txt', 'a/../../fuori.txt', '/etc/passwd', 'a\\..\\..\\fuori.txt']) {
      await expect(store.exists(path), path).rejects.toThrow('dentro la radice');
      await expect(store.readText(path), path).rejects.toThrow('dentro la radice');
      await expect(store.upload(source, path), path).rejects.toThrow('dentro la radice');
      await expect(store.writeText(path, 'x'), path).rejects.toThrow('dentro la radice');
    }

    expect(await readFile(outside).then(() => true, () => false)).toBe(false);
    expect(await readdir(siteDir)).toEqual([]);
  });
});

describe('catalogo publish e rollback', () => {
  const catalogo = (args: string[], env: Record<string, string | undefined> = {}) =>
    run('pnpm', ['--dir', CONVERTER_DIR, 'catalogo', ...args], {
      env: {
        ...process.env,
        ARNO_STORE_LOCAL_DIR: undefined,
        ARNO_SFTP_HOST: undefined,
        ARNO_SFTP_USER: undefined,
        ARNO_SFTP_ROOT: undefined,
        ARNO_SFTP_PASSWORD: undefined,
        ARNO_SFTP_KEY_PATH: undefined,
        ...env,
      },
    });

  const failure = (promise: Promise<unknown>) =>
    promise.then(
      () => undefined,
      (e: unknown) => e as { code: number; stdout: string; stderr: string },
    );

  let configWithContacts: string;

  beforeAll(async () => {
    configWithContacts = join(await tempDir(), 'catalogo.config.yaml');
    const base = await readFile(CONFIG, 'utf8');
    await writeFile(configWithContacts, `${base}\ncontacts:\n  email: ${CONTACTS.email}\n  whatsapp: "${CONTACTS.whatsapp}"\n`);
  });

  const publishArgs = (edition: string, extra: string[] = []) => [
    'publish',
    '--linea',
    'agricoltura',
    '--edizione',
    edition,
    '--out',
    buildDir,
    '--config',
    configWithContacts,
    ...extra,
  ];

  it('cli publishes to the test environment by default and rolls back', { timeout: 90_000 }, async () => {
    const env = { ARNO_STORE_LOCAL_DIR: siteDir };

    const first = await catalogo(publishArgs('2026.1'), env);
    expect(first.stdout).toContain('2026.1');
    expect(first.stdout).toContain('catalogo-prova/index.json');
    expect((await readIndex()).lines.agricoltura?.edition).toBe('2026.1');

    const second = await catalogo(publishArgs('2026.2'), env);
    expect(second.stdout).toContain('2026.2');

    const back = await catalogo(['rollback', '--linea', 'agricoltura'], env);
    expect(back.stdout).toContain('2026.1');
    expect(back.stdout).toContain('catalogo-prova/index.json');
    expect((await readIndex()).lines.agricoltura?.edition).toBe('2026.1');
  });

  it('cli publishes to production with --ambiente', { timeout: 60_000 }, async () => {
    const { stdout } = await catalogo(publishArgs('2026.1', ['--ambiente', 'produzione']), { ARNO_STORE_LOCAL_DIR: siteDir });

    expect(stdout).toContain('catalogo/index.json');
    expect((await readIndex('catalogo')).lines.agricoltura?.edition).toBe('2026.1');
  });

  it('cli exits 1 when contacts are missing from the configuration', { timeout: 60_000 }, async () => {
    const error = await failure(catalogo(publishArgs('2026.1', ['--config', CONFIG]), { ARNO_STORE_LOCAL_DIR: siteDir }));

    expect(error?.code).toBe(1);
    expect(error?.stderr).toContain('mancano email e WhatsApp in catalogo.config.yaml');
    expect(await readdir(siteDir)).toEqual([]);
  });

  it('cli exits 1 and lists the missing variables', { timeout: 60_000 }, async () => {
    const error = await failure(catalogo(publishArgs('2026.1')));

    expect(error?.code).toBe(1);
    expect(error?.stderr).toContain('ARNO_SFTP_HOST');
    expect(error?.stderr).toContain('ARNO_SFTP_USER');
  });

  it('cli exits 1 on rollback without previous editions', { timeout: 60_000 }, async () => {
    const error = await failure(catalogo(['rollback', '--linea', 'agricoltura'], { ARNO_STORE_LOCAL_DIR: siteDir }));

    expect(error?.code).toBe(1);
    expect(error?.stderr).toContain('nessuna edizione precedente per agricoltura');
  });

  it('cli explains an invalid --ambiente in Italian', { timeout: 60_000 }, async () => {
    const error = await failure(catalogo(['rollback', '--linea', 'agricoltura', '--ambiente', 'test']));

    expect(error?.code).toBe(1);
    expect(error?.stderr).toContain('prova, produzione');
    expect(error?.stderr).not.toContain('Allowed choices');
  });
});
