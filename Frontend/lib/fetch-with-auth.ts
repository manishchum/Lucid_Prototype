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

  let user = await resolveCurrentUser();
  if(!user && auth){
    await new Promise(resolve => setTimeout(resolve, 1000));
    user = auth.currentUser;
  }
  if(!user){
    console.warn("[fetch-with-auth] No authenticated user found when attempting to get Firebase ID token");
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
  // console.log(
  //   "[AUTH CHECK]",
  //   {
  //     currentUser: !!auth?.currentUser,
  //     tokenExists: !!token
  //   }
  // );

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
  if (response.status === 401) {
    console.warn("[fetch-with-auth] Received 401, forcing token refresh and retrying", { url });
    try {
      const currentUser = auth?.currentUser;

      if (!currentUser) {
        console.error(
          "[fetch-with-auth] Cannot refresh token because currentUser is null"
        );

        window.dispatchEvent(
          new Event("lucid:auth:force-logout")
        );

        return response;
      }

      const refreshedToken =
        await currentUser.getIdToken(true);

      const retryHeaders =
        toHeaders(options.headers);

      retryHeaders.set(
        "Authorization",
        `Bearer ${refreshedToken}`
      );

      response = await fetch(url, {
        ...options,
        headers: retryHeaders,
      });

      if (response.status === 401) {
        window.dispatchEvent(
          new Event("lucid:auth:force-logout")
        );
      }
    }
    catch (refreshErr) {
      console.error(
        "[fetch-with-auth] Retry token refresh failed",
        refreshErr
      );

      // Provide clearer diagnostics when securetoken API is blocked by API key restrictions.
      try {
        const msg = (refreshErr as any)?.message || (refreshErr as any)?.code || String(refreshErr);
        if (typeof msg === "string" && msg.toLowerCase().includes("securetoken")) {
          console.error(
            "[fetch-with-auth] Token refresh blocked. Check Google Cloud API key restrictions:\n" +
              " - Console: Credentials -> API keys -> select key\n" +
              " - Either remove API restrictions or add identitytoolkit.googleapis.com\n" +
              " - If using HTTP referrer restrictions, add http://localhost:3000 (and any other dev hosts)\n" +
              " - Ensure Identity Toolkit API (Secure Token) is enabled for the Firebase project."
          );

          // Dispatch a specific event so UI can surface a friendly modal if desired.
          window.dispatchEvent(new CustomEvent("lucid:auth:securetoken-blocked", { detail: { message: msg } }));
        }
      } catch (diagErr) {
        // ignore diagnostic errors
      }

      window.dispatchEvent(
        new Event("lucid:auth:force-logout")
      );
    }
  }

  return response;
}