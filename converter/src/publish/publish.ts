import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  EDITION_RE,
  LINE_IDS,
  MAX_PREVIOUS_EDITIONS,
  parseIndex,
  parseLineData,
  type IndexFile,
  type LineData,
  type LineId,
} from '@arnoplast/schema';
import { ZodError } from 'zod';
import type { RemoteStore } from './store';

export const ENVIRONMENTS = ['prova', 'produzione'] as const;
export type PublishEnv = (typeof ENVIRONMENTS)[number];

export type Contacts = { email: string; whatsapp: string };

const ROOTS: Record<PublishEnv, string> = { prova: 'catalogo-prova', produzione: 'catalogo' };

/** Percorso di `index.json` sul sito, relativo alla radice del sito. */
export const indexPathOf = (env: PublishEnv): string => `${ROOTS[env]}/index.json`;

/**
 * Regole di cache per Apache 2.4 (il server tipico degli hosting WordPress). Si scrivono solo alla prima
 * pubblicazione: chi le modifica a mano non le trova sovrascritte.
 */
const HTACCESS = `# File generato dal convertitore del catalogo Arno Plast (comando "catalogo publish").
# Regole di cache per Apache 2.4: serve il modulo mod_headers.
# Se lo modifichi a mano, le pubblicazioni successive non lo sovrascrivono.

<IfModule mod_headers.c>
  # L'indice cambia a ogni pubblicazione: l'app deve chiedere sempre al server se ce n'è uno nuovo.
  <Files "index.json">
    Header set Cache-Control "no-cache"
  </Files>

  # Immagini e dati di un'edizione, una volta pubblicati, non cambiano più.
  <FilesMatch "^(data\\.json|.+\\.webp)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
</IfModule>
`;

const quote = (value: unknown) => `«${String(value)}»`;

/** Il motivo di un errore; per lo schema, un problema per campo. */
function reasonOf(error: unknown): string {
  if (error instanceof ZodError) {
    return error.issues
      .map(({ path, message }) => (path.length > 0 ? `${path.map(String).join('.')}: ${message}` : message))
      .join('; ');
  }
  return error instanceof Error ? error.message : String(error);
}

const sha256Of = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

function checkTarget(line: string, env: string): void {
  if (!(LINE_IDS as readonly string[]).includes(line)) {
    throw new Error(`linea sconosciuta: ${quote(line)} (ammesse: ${LINE_IDS.join(', ')})`);
  }
  if (!(ENVIRONMENTS as readonly string[]).includes(env)) {
    throw new Error(`ambiente sconosciuto: ${quote(env)} (ammessi: ${ENVIRONMENTS.join(', ')})`);
  }
}

/** L'indice sul sito, o `null` se non c'è ancora. Un indice illeggibile ferma tutto: riscriverlo farebbe perdere le altre linee. */
async function readIndex(store: RemoteStore, indexPath: string): Promise<IndexFile | null> {
  const text = await store.readText(indexPath);
  if (text === null) return null;
  try {
    return parseIndex(JSON.parse(text));
  } catch (error) {
    throw new Error(`index.json sul server non è valido (${indexPath}): ${reasonOf(error)}`);
  }
}

async function writeIndex(store: RemoteStore, indexPath: string, index: IndexFile): Promise<IndexFile> {
  const valid = parseIndex(index);
  await store.writeText(indexPath, `${JSON.stringify(valid, null, 2)}\n`);
  return valid;
}

/** I byte di `data.json` della build, dopo aver controllato che siano validi e che siano proprio di questa linea e di questa edizione. */
async function readBuiltData(dataPath: string, line: LineId, edition: string): Promise<Buffer> {
  const bytes = await readFile(dataPath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    throw new Error(`manca data.json (${dataPath}): esegui prima «catalogo build» per questa linea e questa edizione`);
  });

  let data: LineData;
  try {
    data = parseLineData(JSON.parse(bytes.toString('utf8')));
  } catch (error) {
    throw new Error(`data.json non valido (${dataPath}): ${reasonOf(error)}`);
  }
  if (data.line !== line) {
    throw new Error(`data.json è della linea ${quote(data.line)}, non ${quote(line)} (${dataPath})`);
  }
  if (data.edition !== edition) {
    throw new Error(`data.json è dell'edizione ${quote(data.edition)}, non ${quote(edition)} (${dataPath})`);
  }
  return bytes;
}

/** Le immagini WebP della linea, in ordine alfabetico; senza cartella `img` non ce n'è nessuna. */
async function listImages(imgDir: string): Promise<string[]> {
  const entries = await readdir(imgDir, { withFileTypes: true }).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.webp'))
    .map((entry) => entry.name)
    .sort();
}

export type PublishOptions = {
  line: LineId;
  edition: string;
  /** Cartella delle build (`--out` di `build`): contiene `<linea>/img` e `<linea>/<edizione>`. */
  buildDir: string;
  env: PublishEnv;
  /** Dalla configurazione: se manca, non si pubblica. */
  contacts: Contacts | undefined;
  now: Date;
};

/**
 * Pubblica una linea già costruita. Prima controlla tutto (nome della linea, edizione, contatti, `data.json`),
 * poi carica le immagini mancanti, `data.json` e `report.html` e solo alla fine aggiorna `index.json`: se un
 * caricamento fallisce l'indice resta com'era, e rilanciare il comando riprende senza danni.
 */
export async function publishLine(store: RemoteStore, opts: PublishOptions): Promise<IndexFile> {
  const { line, edition, buildDir, env, contacts, now } = opts;
  checkTarget(line, env);
  if (!EDITION_RE.test(edition)) {
    throw new Error(`edizione non valida: ${quote(edition)} (formato atteso anno.numero, per esempio 2026.1)`);
  }
  if (!contacts?.email || !contacts.whatsapp) {
    throw new Error('mancano email e WhatsApp in catalogo.config.yaml');
  }
  const editionDir = join(buildDir, line, edition);
  const dataPath = join(editionDir, 'data.json');
  const dataBytes = await readBuiltData(dataPath, line, edition);

  const root = ROOTS[env];
  const imgDir = join(buildDir, line, 'img');
  for (const name of await listImages(imgDir)) {
    const remote = `${root}/${line}/img/${name}`;
    if (!(await store.exists(remote))) await store.upload(join(imgDir, name), remote);
  }
  await store.upload(dataPath, `${root}/${line}/${edition}/data.json`);
  await store.upload(join(editionDir, 'report.html'), `${root}/${line}/${edition}/report.html`);
  if (!(await store.exists(`${root}/.htaccess`))) await store.writeText(`${root}/.htaccess`, HTACCESS);

  // L'indice si legge solo adesso, subito prima di riscriverlo: così non perde le linee pubblicate nel frattempo.
  const indexPath = indexPathOf(env);
  const stamp = now.toISOString();
  const index = (await readIndex(store, indexPath)) ?? { format: 1 as const, generatedAt: stamp, contacts, lines: {} };
  const current = index.lines[line];
  const carried = current && current.edition !== edition ? [current.edition, ...current.previous] : (current?.previous ?? []);
  const previous = [...new Set(carried)].filter((old) => old !== edition).slice(0, MAX_PREVIOUS_EDITIONS);

  return writeIndex(store, indexPath, {
    ...index,
    generatedAt: stamp,
    contacts,
    lines: {
      ...index.lines,
      [line]: {
        edition,
        path: `${line}/${edition}/data.json`,
        sha256: sha256Of(dataBytes),
        publishedAt: stamp,
        previous,
      },
    },
  });
}

export type RollbackOptions = { line: LineId; env: PublishEnv; now: Date };

/**
 * Riporta una linea all'edizione precedente (la prima di `previous`). Non carica nulla: l'edizione deve essere
 * ancora sul server. L'edizione da cui si torna indietro non entra in `previous`.
 */
export async function rollbackLine(store: RemoteStore, opts: RollbackOptions): Promise<IndexFile> {
  const { line, env, now } = opts;
  checkTarget(line, env);

  const indexPath = indexPathOf(env);
  const index = await readIndex(store, indexPath);
  const entry = index?.lines[line];
  const edition = entry?.previous[0];
  if (!index || !entry || edition === undefined) throw new Error(`nessuna edizione precedente per ${line}`);

  const path = `${line}/${edition}/data.json`;
  const text = await store.readText(`${ROOTS[env]}/${path}`);
  if (text === null) throw new Error(`l'edizione ${edition} non è più sul server`);

  return writeIndex(store, indexPath, {
    ...index,
    generatedAt: now.toISOString(),
    lines: {
      ...index.lines,
      [line]: {
        edition,
        path,
        sha256: sha256Of(Buffer.from(text, 'utf8')),
        publishedAt: now.toISOString(),
        previous: entry.previous.slice(1),
      },
    },
  });
}
