import { auth } from "@/lib/firebase";
import { onAuthStateChanged, type User } from "firebase/auth";

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
  const resolveCurrentUser = async (): Promise<User | null> => {
    if (!auth) return null;
    if (auth.currentUser) return auth.currentUser;

    // On initial page load Firebase can still be hydrating auth state.
    // Wait briefly so we don't silently drop Authorization on first requests.
    return await new Promise<User | null>((resolve) => {
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        unsubscribe();
        resolve(auth.currentUser ?? null);
      }, 1200);

      const unsubscribe = onAuthStateChanged(auth, (user) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        unsubscribe();
        resolve(user ?? null);
      });
    });
  };

  const user = await resolveCurrentUser();
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
 * Handles 401 Unauthorized by attempting a token refresh and retrying once.
 */
export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getFirebaseIdToken();
  const headers = toHeaders(options.headers);

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  } else if (headers.has("X-User-ID")) {
    console.warn("[fetch-with-auth] Missing Firebase token for request that includes X-User-ID", { url });
  }

  let response = await fetch(url, {
    ...options,
    headers,
  });

  // If the backend says the token is invalid (401), force a refresh once
  if (response.status === 401 && auth.currentUser) {
    console.warn("[fetch-with-auth] Received 401, forcing token refresh and retrying", { url });
    try {
      const refreshedToken = await auth.currentUser.getIdToken(true);
      if (refreshedToken && refreshedToken !== token) {
        const retryHeaders = toHeaders(options.headers);
        retryHeaders.set("Authorization", `Bearer ${refreshedToken}`);
        response = await fetch(url, {
          ...options,
          headers: retryHeaders,
        });
        
        // If still 401 after retry, dispatch global logout
        if (response.status === 401) {
          window.dispatchEvent(new Event("lucid:auth:force-logout"));
        }
      } else {
        window.dispatchEvent(new Event("lucid:auth:force-logout"));
      }
    } catch (refreshErr) {
      console.error("[fetch-with-auth] Retry token refresh failed", refreshErr);
      window.dispatchEvent(new Event("lucid:auth:force-logout"));
    }
  }

  return response;
}