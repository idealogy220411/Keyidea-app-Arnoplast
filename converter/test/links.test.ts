import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveLink } from '../src/links';

const dirs: string[] = [];

/** Cartella `Links/` di prova con i file indicati. */
async function linksDir(...fileNames: string[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'arnoplast-links-'));
  dirs.push(dir);
  for (const name of fileNames) await writeFile(join(dir, name), 'x');
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('resolveLink', () => {
  it('resolves encoded and NFD file names', async () => {
    // Il Mac salva gli accenti in forma NFD: «e» + accento combinato.
    const stored = 'copripalo prisma è.jpg'.normalize('NFD');
    expect(stored).not.toBe(stored.normalize('NFC'));
    const dir = await linksDir(stored);

    const found = await resolveLink('file:/Users/grafico/Lavori/Links/copripalo%20prisma%20%C3%A8.jpg', dir);

    expect(found).toBe(join(dir, stored));
  });

  it('returns null for missing link', async () => {
    const dir = await linksDir('altro.jpg');

    expect(await resolveLink('file:/Users/grafico/Lavori/Links/assente.jpg', dir)).toBeNull();
  });

  it('returns an absolute path', async () => {
    const dir = await linksDir('foto.jpg');

    const found = await resolveLink('file:/Users/grafico/Links/foto.jpg', dir);

    expect(found).not.toBeNull();
    expect(isAbsolute(found as string)).toBe(true);
  });

  it('ignores case when matching file names', async () => {
    const dir = await linksDir('FOTO Prisma.JPG');

    expect(await resolveLink('file:/Users/grafico/Links/foto%20prisma.jpg', dir)).toBe(join(dir, 'FOTO Prisma.JPG'));
  });

  it('falls back to the raw file name when the escape is malformed', async () => {
    const dir = await linksDir('sconto 100%.jpg');

    expect(await resolveLink('file:/Users/grafico/Links/sconto 100%.jpg', dir)).toBe(join(dir, 'sconto 100%.jpg'));
  });

  it('returns null when the links folder does not exist', async () => {
    const dir = await linksDir();

    expect(await resolveLink('file:/Users/grafico/Links/foto.jpg', join(dir, 'non-esiste'))).toBeNull();
  });
});
