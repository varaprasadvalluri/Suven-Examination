/**
 * Holds the server-issued session token (minted by /api/auth/validate,
 * /api/auth/create-profile, or /api/gatekeeper/enroll) that authorizes every
 * /api/db/query and /api/db/write call. Backed by localStorage so it survives reloads.
 */
const STORAGE_KEY = 'session_token';

let cachedToken: string | null = (() => {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
})();

export function getSessionToken(): string | null {
  return cachedToken;
}

export function setSessionToken(token: string | null) {
  cachedToken = token;
  try {
    if (token) {
      localStorage.setItem(STORAGE_KEY, token);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage unavailable (private browsing, etc.) — in-memory cache still works for this tab session.
  }
}

export function clearSessionToken() {
  setSessionToken(null);
}

// Convenience for call sites using raw fetch() instead of the apiService/api.ts wrappers.
export function authHeaders(): Record<string, string> {
  const token = getSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
