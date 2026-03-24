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

  return fetch(url, {
    ...options,
    headers,
  });
}