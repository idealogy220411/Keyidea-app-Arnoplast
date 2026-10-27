import { afterEach, describe, expect, it, vi } from 'vitest';
import { sha256Fingerprint } from '../src/publish/fingerprint';

// Una chiave host finta: basta che `hostVerifier` riceva un Buffer, non serve una vera chiave SSH.
const FAKE_HOST_KEY = Buffer.from('finta chiave host del server di prova');
const FAKE_FINGERPRINT = sha256Fingerprint(FAKE_HOST_KEY);

const { connectMock, instances } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  instances: [] as Array<{ name: string }>,
}));

vi.mock('ssh2-sftp-client', () => {
  class FakeSftpClient {
    name: string;
    constructor(name: string) {
      this.name = name;
      instances.push(this);
    }
    connect(options: Record<string, unknown>) {
      return connectMock(options);
    }
    end(): Promise<boolean> {
      return Promise.resolve(true);
    }
  }
  return { default: FakeSftpClient };
});

const { SftpStore } = await import('../src/publish/store');

const BASE_ENV = {
  ARNO_SFTP_HOST: 'sftp.example.test',
  ARNO_SFTP_USER: 'utente',
  ARNO_SFTP_ROOT: '/www',
  ARNO_SFTP_PASSWORD: 'segreto',
};

/** Come ssh2: chiama `hostVerifier` con la chiave finta, e si collega solo se risponde vero. */
function respondToHostVerifier() {
  connectMock.mockImplementation((options: { hostVerifier: (key: Buffer) => boolean }) => {
    const ok = options.hostVerifier(FAKE_HOST_KEY);
    return ok ? Promise.resolve() : Promise.reject(new Error('host verification failed'));
  });
}

afterEach(() => {
  connectMock.mockReset();
  instances.length = 0;
});

describe('SftpStore.connect — impronta SSH del server (Ruling 16)', () => {
  it('refuses and shows the server fingerprint when ARNO_SFTP_HOST_FINGERPRINT is missing', async () => {
    respondToHostVerifier();

    await expect(SftpStore.connect(BASE_ENV)).rejects.toThrow(/ARNO_SFTP_HOST_FINGERPRINT/);
    await expect(SftpStore.connect(BASE_ENV)).rejects.toThrow(new RegExp(FAKE_FINGERPRINT.replace(/[:+/]/g, '\\$&')));
  });

  it('refuses and shows expected vs received when the fingerprint does not match', async () => {
    respondToHostVerifier();
    const env = { ...BASE_ENV, ARNO_SFTP_HOST_FINGERPRINT: 'SHA256:qualcosaDiDiverso' };

    const error: unknown = await SftpStore.connect(env).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('SHA256:qualcosaDiDiverso');
    expect((error as Error).message).toContain(FAKE_FINGERPRINT);
  });

  it('connects when the fingerprint matches, with a keepalive and a ready timeout', async () => {
    respondToHostVerifier();
    const env = { ...BASE_ENV, ARNO_SFTP_HOST_FINGERPRINT: FAKE_FINGERPRINT };

    const store = await SftpStore.connect(env);
    await store.close();

    expect(connectMock).toHaveBeenCalledTimes(1);
    const options = connectMock.mock.calls[0][0] as Record<string, unknown>;
    expect(options.keepaliveInterval).toBe(10_000);
    expect(options.readyTimeout).toBe(20_000);
    expect(typeof options.hostVerifier).toBe('function');
  });
});
