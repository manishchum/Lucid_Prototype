import { auth } from "@/lib/firebase";
import { onAuthStateChanged, type User } from "firebase/auth";

/**
 * Normalizes HeadersInit into a mutable Headers instance.
 */
function toHeaders(headers?: HeadersInit): Headers {
  return new Headers(headers || {});
}

function getDeviceId(): string {
  let deviceId = localStorage.getItem("device_id");

  if (!deviceId) {
    deviceId = crypto.randomUUID();
    localStorage.setItem("device_id", deviceId);
  }

  return deviceId;
}

/**
 * Helper to resolve the authenticated Firebase user, waiting for hydration if a stored session exists.
 */
async function resolveCurrentUser(): Promise<User | null> {
  if (!auth) return null;
  if (auth.currentUser) return auth.currentUser;

  const hasStoredSession =
    typeof window !== "undefined" &&
    Boolean(
      window.localStorage.getItem("lucid:manual-auth-user") ||
      window.localStorage.getItem("lucid:auth:session-active") ||
      window.sessionStorage.getItem("lucid:manual-auth-user")
    );

  // If there is no stored session, do not stall requests on hydration timeouts
  if (!hasStoredSession) {
    return null;
  }

  // Modern Firebase Auth has authStateReady() which resolves when initial IndexedDB state is hydrated
  if (typeof (auth as any).authStateReady === "function") {
    try {
      await Promise.race([
        (auth as any).authStateReady(),
        new Promise((res) => setTimeout(res, 2500)),
      ]);
      if (auth.currentUser) return auth.currentUser;
    } catch {
      // ignore and fallback to onAuthStateChanged
    }
  }

  // On initial page load Firebase can still be hydrating auth state.
  // Wait for onAuthStateChanged to emit a valid user or timeout.
  return await new Promise<User | null>((resolve) => {
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      unsubscribe();
      resolve(auth.currentUser ?? null);
    }, 2500);

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (settled) return;
      if (user) {
        settled = true;
        clearTimeout(timeout);
        unsubscribe();
        resolve(user);
      }
    });
  });
}

/**
 * Returns an Authorization bearer token from Firebase auth when available.
 */
export async function getFirebaseIdToken(): Promise<string> {
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
  const shouldRegisterSession = Boolean((options as any).registerSession);
  const headers = toHeaders(options.headers);
  headers.set("X-Device-ID", getDeviceId());
  headers.set("X-Platform", "web");
  if (shouldRegisterSession) {
    headers.set("X-Register-Session", "true");
  }

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
    try {
      const errClone = response.clone();
      const errText = await errClone.text();
      if (errText.includes("Session_Replaced")) {
        console.warn("[fetch-with-auth] Session_Replaced detected on 401, logging out silently without retry", { url });
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

    console.warn("[fetch-with-auth] Received 401, attempting token refresh and retry", { url });
    try {
      let currentUser = auth?.currentUser;
      if (!currentUser) {
        currentUser = await resolveCurrentUser();
      }

      if (!currentUser) {
        console.warn(
          "[fetch-with-auth] Cannot refresh token because currentUser is null; preserving session",
          { url }
        );
        return response;
      }

      const refreshedToken = await currentUser.getIdToken(true);
      
      const retryHeaders = toHeaders(options.headers);
      retryHeaders.set("X-Device-ID", getDeviceId());
      retryHeaders.set("X-Platform", "web");
      if (shouldRegisterSession) {
        retryHeaders.set("X-Register-Session", "true");
      }
      retryHeaders.set("Authorization", `Bearer ${refreshedToken}`);

      if (options.body && typeof options.body === "string" && !retryHeaders.has("Content-Type")) {
        retryHeaders.set("Content-Type", "application/json");
      }

      delete (options as any).registerSession;

      response = await fetch(url, {
        ...options,
        headers: retryHeaders,
      });

      if (!response.ok) {
        console.warn(
          "[FETCH RETRY FAILED]",
          options.method || "GET",
          url,
          response.status
        );
      }

      if (response.status === 401) {
        try {
          const errText = await response.clone().text();
          if (errText.includes("Session_Replaced")) {
            console.warn("[fetch-with-auth] Session_Replaced detected on retry 401, dispatching force-logout", { url });
            window.dispatchEvent(
              new CustomEvent("lucid:auth:force-logout", {
                detail: { reason: "session_replaced" }
              })
            );
          }
        } catch {
          // ignore clone read error
        }
      }
    } catch (refreshErr) {
      console.warn("[fetch-with-auth] Retry token refresh failed", refreshErr);
    }
  }

  return response;
}