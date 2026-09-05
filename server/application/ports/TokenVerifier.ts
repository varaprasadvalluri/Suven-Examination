// Contract for verifying a client-supplied identity token, independent of who issues it.
// Routes depend on this interface, never on firebase-admin directly, so swapping the identity
// provider (or the whole backend) means writing one new adapter, not touching every route.
export interface VerifiedIdentity {
  uid: string;
  email: string | null;
  name: string | null;
}

export interface TokenVerifier {
  // Rejects by throwing: an unverifiable, expired, or wrong-audience token must never come
  // back as a null/partial identity that a caller could mistake for a successful verification.
  verifyIdToken(idToken: string): Promise<VerifiedIdentity>;
}
