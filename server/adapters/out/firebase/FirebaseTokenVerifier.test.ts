import { describe, it, expect, vi, beforeEach } from 'vitest';

// The audience allowlist is the only thing stopping a validly-signed token from an unrelated
// Firebase project from being accepted as one of ours. It had no tests because it used to read
// a module-scope constant; the injected allowlist makes it reachable.
vi.mock('../../../config', () => ({
  firebaseConfig: { projectId: 'proj-1', apiKey: 'k', firestoreDatabaseId: '(default)', storageBucket: '' }
}));

const verifyIdTokenSpy = vi.fn();
const initializeApp = vi.fn((_opts: any, name: string) => ({ name }));

vi.mock('firebase-admin/app', () => ({
  initializeApp: (opts: any, name: string) => initializeApp(opts, name),
  getApps: (): unknown[] => []
}));
vi.mock('firebase-admin/auth', () => ({ getAuth: () => ({ verifyIdToken: verifyIdTokenSpy }) }));

function idTokenWithAudience(aud: unknown): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ aud, sub: 'uid_1' })).toString('base64url');
  return `${header}.${payload}.signature-not-checked-by-the-allowlist`;
}

describe('FirebaseTokenVerifier', () => {
  beforeEach(() => {
    verifyIdTokenSpy.mockReset();
    initializeApp.mockClear();
  });

  it('verifies a token whose audience is on the allowlist', async () => {
    const { FirebaseTokenVerifier } = await import('./FirebaseTokenVerifier');
    verifyIdTokenSpy.mockResolvedValue({ uid: 'uid_1', email: 'a@b.test', name: 'Ada' });

    const verifier = new FirebaseTokenVerifier(['proj-1']);

    await expect(verifier.verifyIdToken(idTokenWithAudience('proj-1'))).resolves.toEqual({
      uid: 'uid_1',
      email: 'a@b.test',
      name: 'Ada'
    });
  });

  // The whole point of the allowlist: another project's tokens verify fine against THEIR certs.
  it('rejects a token from a project that is not allowlisted, without calling firebase-admin', async () => {
    const { FirebaseTokenVerifier } = await import('./FirebaseTokenVerifier');
    const verifier = new FirebaseTokenVerifier(['proj-1']);

    await expect(verifier.verifyIdToken(idTokenWithAudience('someone-elses-project'))).rejects.toThrow(/not an allowed project/);
    expect(verifyIdTokenSpy).not.toHaveBeenCalled();
  });

  it('rejects a token with no audience claim at all', async () => {
    const { FirebaseTokenVerifier } = await import('./FirebaseTokenVerifier');
    const verifier = new FirebaseTokenVerifier(['proj-1']);

    await expect(verifier.verifyIdToken(idTokenWithAudience(undefined))).rejects.toThrow(/not an allowed project/);
    expect(verifyIdTokenSpy).not.toHaveBeenCalled();
  });

  it.each([['garbage'], [''], ['a.b'], ['a.b.c.d']])('rejects the malformed token %j', async (bad) => {
    const { FirebaseTokenVerifier } = await import('./FirebaseTokenVerifier');
    const verifier = new FirebaseTokenVerifier(['proj-1']);

    await expect(verifier.verifyIdToken(bad)).rejects.toThrow(/Malformed ID token/);
    expect(verifyIdTokenSpy).not.toHaveBeenCalled();
  });

  // Auth and Firestore can live in different GCP projects, so more than one admin app is
  // legitimate — but re-initializing one per request would leak apps on the hottest path.
  it('reuses one admin app per project across calls', async () => {
    const { FirebaseTokenVerifier } = await import('./FirebaseTokenVerifier');
    verifyIdTokenSpy.mockResolvedValue({ uid: 'uid_1', email: null, name: null });

    const verifier = new FirebaseTokenVerifier(['proj-1', 'proj-2']);
    await verifier.verifyIdToken(idTokenWithAudience('proj-1'));
    await verifier.verifyIdToken(idTokenWithAudience('proj-1'));
    await verifier.verifyIdToken(idTokenWithAudience('proj-2'));

    expect(initializeApp).toHaveBeenCalledTimes(2);
    expect(initializeApp.mock.calls.map((c) => c[1])).toEqual(['verify-proj-1', 'verify-proj-2']);
  });

  it('normalizes a missing email/name to null', async () => {
    const { FirebaseTokenVerifier } = await import('./FirebaseTokenVerifier');
    verifyIdTokenSpy.mockResolvedValue({ uid: 'uid_1' });

    const verifier = new FirebaseTokenVerifier(['proj-1']);

    await expect(verifier.verifyIdToken(idTokenWithAudience('proj-1'))).resolves.toEqual({
      uid: 'uid_1',
      email: null,
      name: null
    });
  });
});
