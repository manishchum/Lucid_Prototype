import { auth } from "@/lib/firebase";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getDeviceId } from "@/lib/device";

/**
 * Normalizes HeadersInit into a mutable Headers instance.
 */
function toHeaders(headers?: HeadersInit): Headers {
  return new Headers(headers || {});
}

let inFlightAuthReady: Promise<User | null> | null = null;
let inFlightTokenPromise: Promise<string> | null = null;
let cachedIdToken: { token: string; expiresAt: number } | null = null;

export function invalidateCachedIdToken(): void {
  cachedIdToken = null;
}

export async function resolveCurrentUser(): Promise<User | null> {
  if (!auth) return null;
  if (auth.currentUser) return auth.currentUser;

  // Singleflight deduplication: all concurrent requests across the page share the same hydration promise
  if (inFlightAuthReady) return inFlightAuthReady;

  inFlightAuthReady = (async () => {
    try {
      if (typeof (auth as any).authStateReady === "function") {
        try {
          await (auth as any).authStateReady();
          if (auth.currentUser) return auth.currentUser;
        } catch {}
      }

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
    } finally {
      inFlightAuthReady = null;
    }
  })();

  return inFlightAuthReady;
}

/**
 * Returns an Authorization bearer token from Firebase auth when available.
 * Deduplicates in-flight calls and caches valid tokens in memory for 5 minutes.
 */
export async function getFirebaseIdToken(): Promise<string> {
  const now = Date.now();
  if (cachedIdToken && cachedIdToken.expiresAt > now) {
    return cachedIdToken.token;
  }

  if (inFlightTokenPromise) {
    return inFlightTokenPromise;
  }

  inFlightTokenPromise = (async () => {
    try {
      const user = await resolveCurrentUser();
      if (!user) {
        console.warn("[fetch-with-auth] No authenticated user found when attempting to get Firebase ID token");
        return "";
      }

      try {
        const token = await user.getIdToken();
        cachedIdToken = { token, expiresAt: Date.now() + 5 * 60 * 1000 };
        return token;
      } catch (error) {
        console.warn("[fetch-with-auth] Initial getIdToken failed, retrying forced refresh", error);
        try {
          const refreshedToken = await user.getIdToken(true);
          cachedIdToken = { token: refreshedToken, expiresAt: Date.now() + 5 * 60 * 1000 };
          return refreshedToken;
        } catch (refreshError) {
          console.error("[fetch-with-auth] Failed to retrieve Firebase ID token", refreshError);
          return "";
        }
      }
    } finally {
      inFlightTokenPromise = null;
    }
  })();

  return inFlightTokenPromise;
}

/**
 * Fetch wrapper that injects Firebase JWT into Authorization header.
 * Handles 401 Unauthorized by attempting a token refresh and retrying once.
 */
export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getFirebaseIdToken();
  const shouldRegisterSession = Boolean((options as any).registerSession);
  const headers = toHeaders(options.headers);
  headers.set("X-Device-ID", getDeviceId());
  headers.set("X-Platform", "web");
  if (shouldRegisterSession) {
    headers.set("X-Register-Session", "true");
  }
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

  // Ensure JSON content type is set by default when sending a serialized string body
  if (options.body && typeof options.body === "string" && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  delete (options as any).registerSession;

  let response = await fetch(url, {
    ...options,
    headers,
  });

  // console.log(
  //   "[FETCH]",
  //   options.method || "GET",
  //   url,
  //   response.status
  // );

  // Handle 401 Session_Replaced silently without dumping noisy red errors in console
  if (response.status === 401) {
    try {
      const errClone = response.clone();
      const errText = await errClone.text();
      if (errText.includes("Session_Replaced")) {
        console.info("[fetch-with-auth] Active session replaced by another login; revoking local session cleanly.", { url });
        window.dispatchEvent(
          new CustomEvent("lucid:auth:force-logout", {
            detail: { reason: "session_replaced" }
          })
        );
        return response;
      }
    } catch {
      // ignore clone read error
    }
  }

  if (!response.ok) {
    console.error(
      "[FETCH FAILED]",
      options.method || "GET",
      url,
      response.status,
      await response.clone().text()
    );
  }

  // If the backend says the token is invalid (401), force a refresh once
  if (response.status === 401) {

    invalidateCachedIdToken();
    console.warn("[fetch-with-auth] Received 401, forcing token refresh and retrying", { url });
    try {
      const currentUser = auth?.currentUser;

      if (!currentUser) {
        console.error(
          "[fetch-with-auth] Cannot refresh token because currentUser is null"
        );

        window.dispatchEvent(
          new CustomEvent("lucid:auth:force-logout", { detail: { reason: "unauthorized" } })
        );

        return response;
      }

      const refreshedToken =
        await currentUser.getIdToken(true);
      
      const retryHeaders =
        toHeaders(options.headers);

      retryHeaders.set("X-Device-ID", getDeviceId());
      retryHeaders.set("X-Platform", "web");
      if (shouldRegisterSession) {
        retryHeaders.set("X-Register-Session", "true");
      }
      retryHeaders.set(
        "Authorization",
        `Bearer ${refreshedToken}`
      );

      if (options.body && typeof options.body === "string" && !retryHeaders.has("Content-Type")) {
        retryHeaders.set("Content-Type", "application/json");
      }

      delete (options as any).registerSession;

      response = await fetch(url, {
        ...options,
        headers: retryHeaders,
      });

      console.log(
        "[FETCH RETRY]",
        options.method || "GET",
        url,
        response.status
      );

      let retryErrText = "";
      if (!response.ok) {
        try {
          retryErrText = await response.clone().text();
        } catch {}
        if (!retryErrText.includes("Session_Replaced")) {
          console.error(
            "[FETCH RETRY FAILED]",
            options.method || "GET",
            url,
            response.status,
            retryErrText
          );
        }
      }

      if (response.status === 401) {
        try {
          const errText = await response.clone().text();
          const isSessionReplaced = errText.includes("Session_Replaced");
          if (!auth?.currentUser || isSessionReplaced) {
            console.warn("[fetch-with-auth] Unrecoverable 401 detected, dispatching force-logout", { url, errText });
            window.dispatchEvent(
              new CustomEvent("lucid:auth:force-logout", {
                detail: { reason: isSessionReplaced ? "session_replaced" : "unauthorized" }
              })
            );
          } else {
            console.warn("[fetch-with-auth] Retry returned 401, preserving user session", { url, errText });
          }
        } catch {
          if (!auth?.currentUser) {
            window.dispatchEvent(
              new CustomEvent("lucid:auth:force-logout", { detail: { reason: "unauthorized" } })
            );
          }
        }
      }
    }
    catch (refreshErr) {
      console.error(
        "[fetch-with-auth] Retry token refresh failed",
        refreshErr
      );
      if (!auth?.currentUser) {
        window.dispatchEvent(
          new CustomEvent("lucid:auth:force-logout", { detail: { reason: "unauthorized" } })
        );
      }
    }
  }

  return response;
}