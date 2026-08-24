/**
 * Holds the server-issued session token (minted by /api/auth/validate,
 * /api/auth/create-profile, or /api/gatekeeper/enroll) that authorizes every
 * /api/db/query and /api/db/write call.
 *
 * Backed by sessionStorage, not localStorage — deliberately: sessionStorage is spec'd to
 * never persist to disk and to be scoped to one browsing-context lifetime, so it survives a
 * page reload/navigation within the same tab (matches localStorage there) but is cleared when
 * the tab/browser closes. In the Capacitor native app (same WebView-hosted code), this has the
 * same effect on a real app close/kill — unlike localStorage, which is backed by on-disk
 * storage the OS preserves across app restarts, which is what let a closed-and-reopened app
 * silently stay logged in. Backgrounding the app (switching away briefly, an incoming call)
 * does NOT tear down the WebView process, so sessionStorage — and the login — survives that,
 * same as before; only an actual close/kill clears it. This is a deliberate product decision,
 * not a bug fix — see [[project idle logout requirement]] memory for the related pending
 * idle-timeout work this doesn't replace.
 */
const STORAGE_KEY = 'session_token';

let cachedToken: string | null = (() => {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
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
      sessionStorage.setItem(STORAGE_KEY, token);
    } else {
      sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // sessionStorage unavailable (private browsing, etc.) — in-memory cache still works for this tab session.
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
