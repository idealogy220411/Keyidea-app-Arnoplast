import { copyFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import SftpClient from 'ssh2-sftp-client';

/**
 * Il posto in cui si pubblica il catalogo. I percorsi sono relativi alla radice del sito, con `/` come separatore.
 * `upload` e `writeText` sostituiscono il file in un colpo solo: chi legge vede il file vecchio o quello nuovo, mai uno a metà.
 */
export interface RemoteStore {
  exists(path: string): Promise<boolean>;
  /** Il contenuto del file in UTF-8, oppure `null` se il file non esiste. */
  readText(path: string): Promise<string | null>;
  upload(localPath: string, remotePath: string): Promise<void>;
  writeText(remotePath: string, text: string): Promise<void>;
  close(): Promise<void>;
}

/** I segmenti di un percorso relativo alla radice; con `..` o `/` iniziale il percorso uscirebbe dalla radice. */
function segmentsOf(remotePath: string): string[] {
  const segments = remotePath.split(/[\\/]/);
  if (remotePath.startsWith('/') || segments.includes('..')) {
    throw new Error(
      `percorso remoto non valido: «${remotePath}» (deve restare dentro la radice del sito, senza «..» e senza «/» iniziale)`,
    );
  }
  return segments.filter((segment) => segment !== '' && segment !== '.');
}

const reason = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const isMissing = (error: unknown): boolean => ['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '');

/** Una cartella del disco al posto dell'hosting, per le prove a secco. */
export class LocalStore implements RemoteStore {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = rootDir;
  }

  private resolve(remotePath: string): string {
    return join(this.rootDir, ...segmentsOf(remotePath));
  }

  /** Scrive su `<file>.tmp` e poi rinomina: il file di destinazione non resta mai a metà. */
  private async replace(remotePath: string, write: (tmpPath: string) => Promise<void>): Promise<void> {
    const target = this.resolve(remotePath);
    const tmp = `${target}.tmp`;
    await mkdir(dirname(target), { recursive: true });
    await write(tmp);
    await rename(tmp, target);
  }

  async exists(remotePath: string): Promise<boolean> {
    const target = this.resolve(remotePath);
    return stat(target).then(
      () => true,
      (error: unknown) => {
        if (isMissing(error)) return false;
        throw error;
      },
    );
  }

  async readText(remotePath: string): Promise<string | null> {
    const target = this.resolve(remotePath);
    return readFile(target, 'utf8').catch((error: unknown) => {
      if (isMissing(error)) return null;
      throw error;
    });
  }

  upload(localPath: string, remotePath: string): Promise<void> {
    return this.replace(remotePath, (tmp) => copyFile(localPath, tmp));
  }

  writeText(remotePath: string, text: string): Promise<void> {
    return this.replace(remotePath, (tmp) => writeFile(tmp, text, 'utf8'));
  }

  async close(): Promise<void> {}
}

type SftpSettings = { host: string; port: number; username: string; root: string; password?: string; keyPath?: string };

/** Legge le variabili d'ambiente dell'hosting. Se ne mancano, lo dice prima di aprire qualunque connessione. */
function readSftpSettings(env: NodeJS.ProcessEnv): SftpSettings {
  const { ARNO_SFTP_HOST: host, ARNO_SFTP_USER: username, ARNO_SFTP_ROOT: root } = env;
  const password = env.ARNO_SFTP_PASSWORD || undefined;
  const keyPath = env.ARNO_SFTP_KEY_PATH || undefined;

  const missing = [
    ...(host ? [] : ['ARNO_SFTP_HOST']),
    ...(username ? [] : ['ARNO_SFTP_USER']),
    ...(root ? [] : ['ARNO_SFTP_ROOT']),
    ...(password || keyPath ? [] : ['ARNO_SFTP_PASSWORD oppure ARNO_SFTP_KEY_PATH']),
  ];
  if (!host || !username || !root || missing.length > 0) {
    throw new Error(
      `Mancano le variabili d'ambiente per accedere all'hosting: ${missing.join(', ')}. ` +
        'Per una prova a secco imposta ARNO_STORE_LOCAL_DIR con una cartella locale.',
    );
  }

  const rawPort = env.ARNO_SFTP_PORT || '22';
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || port < 1 || port > 65535) {
    throw new Error(`ARNO_SFTP_PORT non valida: «${rawPort}» (serve un numero da 1 a 65535)`);
  }
  return { host, port, username, root, password, keyPath };
}

/** L'hosting raggiunto con SFTP. Ogni metodo è una chiamata diretta a `ssh2-sftp-client`. */
export class SftpStore implements RemoteStore {
  private readonly client: SftpClient;
  private readonly root: string;

  private constructor(client: SftpClient, root: string) {
    this.client = client;
    this.root = root;
  }

  static async connect(env: NodeJS.ProcessEnv): Promise<SftpStore> {
    const { host, port, username, root, password, keyPath } = readSftpSettings(env);
    let privateKey: Buffer | undefined;
    if (keyPath) {
      privateKey = await readFile(keyPath).catch((error: unknown) => {
        throw new Error(`ARNO_SFTP_KEY_PATH: impossibile leggere la chiave (${keyPath}): ${reason(error)}`);
      });
    }

    // Di serie la libreria scrive sullo schermo a ogni chiusura della connessione; gli errori arrivano comunque
    // alla chiamata che li causa.
    const client = new SftpClient('arnoplast', { error: () => {}, end: () => {}, close: () => {} });
    try {
      await client.connect({ host, port, username, password, privateKey });
    } catch (error) {
      throw new Error(`connessione SFTP a ${host}:${port} non riuscita: ${reason(error)}`);
    }
    return new SftpStore(client, root);
  }

  private resolve(remotePath: string): string {
    return posix.join(this.root, ...segmentsOf(remotePath));
  }

  /** Carica su `<file>.tmp` e poi rinomina (rinomina POSIX, che sostituisce il file esistente). */
  private async replace(remotePath: string, write: (tmpPath: string) => Promise<unknown>): Promise<void> {
    const target = this.resolve(remotePath);
    const tmp = `${target}.tmp`;
    await this.client.mkdir(posix.dirname(target), true);
    await write(tmp);
    await this.client.posixRename(tmp, target);
  }

  async exists(remotePath: string): Promise<boolean> {
    return (await this.client.exists(this.resolve(remotePath))) !== false;
  }

  async readText(remotePath: string): Promise<string | null> {
    const target = this.resolve(remotePath);
    if ((await this.client.exists(target)) === false) return null;
    return ((await this.client.get(target)) as Buffer).toString('utf8');
  }

  upload(localPath: string, remotePath: string): Promise<void> {
    return this.replace(remotePath, (tmp) => this.client.fastPut(localPath, tmp));
  }

  writeText(remotePath: string, text: string): Promise<void> {
    return this.replace(remotePath, (tmp) => this.client.put(Buffer.from(text, 'utf8'), tmp));
  }

  async close(): Promise<void> {
    await this.client.end();
  }
}

/** Con `ARNO_STORE_LOCAL_DIR` si pubblica su una cartella locale, altrimenti sull'hosting via SFTP. */
export async function storeFromEnv(env: NodeJS.ProcessEnv): Promise<RemoteStore> {
  if (env.ARNO_STORE_LOCAL_DIR) return new LocalStore(env.ARNO_STORE_LOCAL_DIR);
  return SftpStore.connect(env);
}
