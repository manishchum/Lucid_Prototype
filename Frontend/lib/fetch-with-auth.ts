import { auth } from "@/lib/firebase";

/**
 * Normalizes HeadersInit into a mutable Headers instance.
 */
function toHeaders(headers?: HeadersInit): Headers {
  return new Headers(headers || {});
}

/**
 * Returns an Authorization bearer token from Firebase auth when available.
 */
export async function getFirebaseIdToken(): Promise<string> {
  const user = auth?.currentUser;
  if (!user) {
    return "";
  }

  try {
    // getIdToken() auto-refreshes when the token is expired.
    return await user.getIdToken();
  } catch (error) {
    console.warn("[fetch-with-auth] Initial getIdToken failed, retrying forced refresh", error);
    try {
      // Force refresh once to handle stale in-memory token edge cases.
      return await user.getIdToken(true);
    } catch (refreshError) {
      console.error("[fetch-with-auth] Failed to retrieve Firebase ID token", refreshError);
      return "";
    }
  }
}

/**
 * Fetch wrapper that injects Firebase JWT into Authorization header.
 */
export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getFirebaseIdToken();
  const headers = toHeaders(options.headers);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  // If a Firebase user exists locally, also set X-User-ID so the backend
  // can fall back to header-based auth when Firebase Admin SDK is not
  // available or for faster local dev flows.
  try {
    const user = auth?.currentUser;
    if (user && user.uid) {
      // Only set X-User-ID if the caller hasn't already provided one.
      // Some callers explicitly pass the internal user_id (UUID) and we
      // must not overwrite that with the Firebase uid.
      if (!headers.has("X-User-ID")) {
        headers.set("X-User-ID", user.uid);
      }
    }
  } catch (err) {
    // Non-fatal: if auth is not available, continue without the header.
    // This helper intentionally keeps failures silent for dev environments.
    // eslint-disable-next-line no-console
    console.debug("[fetch-with-auth] could not set X-User-ID header", err);
  }

  return fetch(url, {
    ...options,
    headers,
  });
}