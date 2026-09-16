import { initializeApp as initializeAdminApp, getApps as getAdminApps } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { firebaseConfig } from '../../../config';
import { TokenVerifier, VerifiedIdentity } from '../../../application/ports/TokenVerifier';

// Firebase Admin is used ONLY to cryptographically verify client-supplied Firebase Auth ID
// tokens (via public certs, no service-account credential required for verification).
// Firestore access itself still goes through the REST client via ADC.
//
// In this environment, Firebase Auth and Firestore data can live in DIFFERENT GCP
// projects: the platform auto-provisions a `gen-lang-client-*` project for Auth, while
// Firestore data lives in whatever `firebaseConfig.projectId` points at. A token's "aud" claim
// must exactly match the project an admin app was initialized for, so we lazily create
// one admin app per project actually seen — but only for projects on this allowlist, so
// we never silently accept a validly-signed token from some unrelated Firebase project.
export const ALLOWED_AUTH_PROJECT_IDS = Array.from(
  new Set(
    [
      firebaseConfig.projectId,
      'gen-lang-client-0086284509',
      ...(process.env.FIREBASE_AUTH_PROJECT_ID ? [process.env.FIREBASE_AUTH_PROJECT_ID] : [])
    ].filter(Boolean)
  )
);

export class FirebaseTokenVerifier implements TokenVerifier {
  private readonly adminAppsByProject = new Map<string, ReturnType<typeof initializeAdminApp>>();

  // The allowlist is injected rather than read from module scope so the audience check is
  // testable without standing up a real Firebase project.
  constructor(private readonly allowedProjectIds: string[] = ALLOWED_AUTH_PROJECT_IDS) {}

  getAdminAppForProject(projectId: string) {
    let app = this.adminAppsByProject.get(projectId);
    if (app) return app;
    const appName = `verify-${projectId}`;
    app = getAdminApps().find((existingApp) => existingApp.name === appName) || initializeAdminApp({ projectId }, appName);
    this.adminAppsByProject.set(projectId, app);
    return app;
  }

  async verifyIdToken(idToken: string): Promise<VerifiedIdentity> {
    const parts = idToken.split('.');
    if (parts.length !== 3) throw new Error('Malformed ID token');
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const tokenProjectId = payload.aud;
    if (!tokenProjectId || !this.allowedProjectIds.includes(tokenProjectId)) {
      throw new Error(`ID token audience "${tokenProjectId}" is not an allowed project`);
    }

    // The audience pre-check above only picks WHICH admin app to verify against; this call is
    // what actually checks the signature, expiry, and issuer.
    const decoded = await getAdminAuth(this.getAdminAppForProject(tokenProjectId)).verifyIdToken(idToken);
    return { uid: decoded.uid, email: decoded.email || null, name: (decoded.name as string) || null };
  }
}

export const tokenVerifier: TokenVerifier = new FirebaseTokenVerifier();
