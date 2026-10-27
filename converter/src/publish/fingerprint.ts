import { createHash } from 'node:crypto';

/**
 * Impronta SHA256 di una chiave host SSH, nello stesso formato che stampa `ssh-keygen -lf`
 * (`SHA256:<base64 senza il riempimento finale>`). Funzione pura, per poterla collaudare senza un server.
 */
export function sha256Fingerprint(hostKey: Buffer): string {
  const digest = createHash('sha256').update(hostKey).digest('base64');
  return `SHA256:${digest.replace(/=+$/, '')}`;
}

/**
 * Il problema (in italiano) di collegarsi con questa impronta, oppure `null` se combacia con quella attesa
 * (Ruling 16): senza `ARNO_SFTP_HOST_FINGERPRINT` si rifiuta mostrando l'impronta del server, da verificare
 * con il gestore dell'hosting; con un'impronta diversa da quella attesa si rifiuta per sicurezza.
 */
export function fingerprintProblem(expected: string | undefined, actual: string): string | null {
  if (expected === undefined) {
    return (
      `manca la variabile d'ambiente ARNO_SFTP_HOST_FINGERPRINT: impronta del server ${actual}. ` +
      "Verificala con il gestore dell'hosting, poi impostala con questo valore per collegarti."
    );
  }
  if (actual !== expected) {
    return (
      `impronta SSH del server diversa da quella attesa (attesa ${expected}, ricevuta ${actual}): ` +
      "connessione rifiutata per sicurezza. Verifica l'impronta con il gestore dell'hosting prima di aggiornarla."
    );
  }
  return null;
}
