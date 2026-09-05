// The verified identity of whoever is making a call, as the application layer sees it.
//
// Lives here, not in the HTTP middleware that happens to populate it today, because every
// authorization decision in application/services is expressed in terms of it — a scheduled
// job or a gRPC entry point would carry the same shape without an Express request in sight.
export interface RequestAuth {
  uid: string;
  email: string | null;
  role: 'admin' | 'school' | 'student' | string;
  schoolId: string | null;
  // One-device-at-a-time enforcement: each fresh login writes a new random sessionId here AND
  // to users/{uid}.activeSessionId. A token whose sessionId no longer matches the user doc's
  // activeSessionId was superseded by a later login elsewhere and is treated as invalid, even
  // though its JWT signature still verifies fine.
  sessionId: string;
}
