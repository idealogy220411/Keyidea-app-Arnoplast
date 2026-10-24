import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * Nome del file di un `LinkResourceURI`: la parte dopo l'ultimo «/», decodificata e in forma NFC.
 * Se la decodifica fallisce (per esempio un «%» isolato nel nome) resta il nome così com'è scritto.
 */
export function linkFileName(linkUri: string): string {
  const raw = linkUri.slice(linkUri.lastIndexOf('/') + 1);
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    // Escape non valido: si usa il nome grezzo.
  }
  return name.normalize('NFC');
}

/**
 * Percorso assoluto del file collegato dentro `linksDir`, oppure `null` se manca (o se la cartella non esiste).
 * Il confronto ignora maiuscole e minuscole e la forma Unicode: il Mac salva gli accenti in NFD.
 */
export async function resolveLink(linkUri: string, linksDir: string): Promise<string | null> {
  const wanted = linkFileName(linkUri).toLowerCase();
  let entries: string[];
  try {
    entries = await readdir(linksDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  const found = entries.find((entry) => entry.normalize('NFC').toLowerCase() === wanted);
  return found === undefined ? null : resolve(linksDir, found);
}
