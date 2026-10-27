import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { fingerprintProblem, sha256Fingerprint } from '../src/publish/fingerprint';

describe('sha256Fingerprint', () => {
  it('matches the format printed by ssh-keygen -lf: "SHA256:<base64 without padding>"', () => {
    const key = Buffer.from('una chiave host di prova, non una vera chiave SSH');
    const expectedBase64 = createHash('sha256').update(key).digest('base64');

    expect(sha256Fingerprint(key)).toBe(`SHA256:${expectedBase64.replace(/=+$/, '')}`);
  });

  it('never ends with "=" padding', () => {
    // Una chiave il cui digest termina tipicamente con due «=» di riempimento in base64 standard.
    const key = Buffer.from('x');

    expect(sha256Fingerprint(key)).not.toMatch(/=$/);
  });

  it('is deterministic and distinguishes different keys', () => {
    const a = Buffer.from('chiave a');
    const b = Buffer.from('chiave b');

    expect(sha256Fingerprint(a)).toBe(sha256Fingerprint(a));
    expect(sha256Fingerprint(a)).not.toBe(sha256Fingerprint(b));
  });
});

describe('fingerprintProblem', () => {
  const actual = 'SHA256:abcDEF123';

  it('reports the missing variable with the server fingerprint when none was set', () => {
    const problem = fingerprintProblem(undefined, actual);

    expect(problem).toContain('ARNO_SFTP_HOST_FINGERPRINT');
    expect(problem).toContain(actual);
  });

  it('reports a mismatch with both fingerprints', () => {
    const expected = 'SHA256:xyz789';

    const problem = fingerprintProblem(expected, actual);

    expect(problem).toContain(expected);
    expect(problem).toContain(actual);
  });

  it('returns null when the fingerprint matches', () => {
    expect(fingerprintProblem(actual, actual)).toBeNull();
  });
});
