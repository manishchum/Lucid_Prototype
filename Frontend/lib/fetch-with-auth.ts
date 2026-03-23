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
    console.error("[fetch-with-auth] Failed to retrieve Firebase ID token", error);
    return "";
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