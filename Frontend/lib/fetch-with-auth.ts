import { auth } from "@/lib/firebase";
import { onAuthStateChanged, type User } from "firebase/auth";
import { getDeviceId } from "@/lib/device";

/**
 * Normalizes HeadersInit into a mutable Headers instance.
 */
function toHeaders(headers?: HeadersInit): Headers {
  return new Headers(headers || {});
}

/**
 * Safely parses the payload of a JWT string.
 */
export function parseJwtPayload(token: string): Record<string, any> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split("")
        .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
        .join("")
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

/**
 * Safely parses the expiration timestamp (in milliseconds) from a JWT string.
 */
export function parseJwtExpMs(token: string): number | null {
  const payload = parseJwtPayload(token);
  return typeof payload?.exp === "number" ? payload.exp * 1000 : null;
}

/**
 * Checks whether an error from Firebase or network fetch is a transient network failure.
 */
export function isTransientNetworkError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || "").toLowerCase();
  const message = String(err.message || "").toLowerCase();
  return (
    code === "auth/network-request-failed" ||
    code === "auth/timeout" ||
    message.includes("network-request-failed") ||
    message.includes("failed to fetch") ||
    message.includes("networkerror") ||
    message.includes("load failed") ||
    message.includes("timeout") ||
    message.includes("aborted")
  );
}

function waitMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Waits for browser connectivity if navigator.onLine is false, up to maxWaitMs.
 */
async function waitForOnline(maxWaitMs: number = 3000): Promise<boolean> {
  if (typeof navigator === "undefined" || navigator.onLine) {
    return true;
  }
  return new Promise((resolve) => {
    let resolved = false;
    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(false);
    }, maxWaitMs);

    const onOnline = () => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(true);
    };

    const cleanup = () => {
      clearTimeout(timer);
      if (typeof window !== "undefined") {
        window.removeEventListener("online", onOnline);
      }
    };

    if (typeof window !== "undefined") {
      window.addEventListener("online", onOnline);
    }
  });
}

/**
 * Calls user.getIdToken() with exponential backoff and jitter on transient network errors.
 */
async function fetchUserTokenWithRetry(
  user: User,
  forceRefresh: boolean,
  maxRetries: number = 3
): Promise<string> {
  let baseDelay = 400;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (typeof navigator !== "undefined" && !navigator.onLine) {
        await waitForOnline(3000);
      }
      return await user.getIdToken(forceRefresh);
    } catch (err: any) {
      const isTransient = isTransientNetworkError(err);
      if (!isTransient || attempt === maxRetries) {
        throw err;
      }

      // Exponential backoff with ±25% random jitter
      const jittered = baseDelay * (0.75 + Math.random() * 0.5);
      console.warn(
        `[fetch-with-auth] getIdToken(force=${forceRefresh}) network glitch (attempt ${attempt}/${maxRetries}), retrying in ${Math.round(jittered)}ms:`,
        err?.message || err
      );
      await waitMs(jittered);
      baseDelay *= 2;
    }
  }

  throw new Error("Failed to retrieve ID token after retries");
}

let inFlightAuthReady: Promise<User | null> | null = null;
let inFlightTokenPromise: Promise<string> | null = null;
let inFlightRefreshPromise: Promise<string> | null = null;
const SESSION_CACHED_ID_TOKEN_KEY = "lucid:cached-id-token";

export type CachedTokenEntry = { token: string; expiresAt: number };

let cachedIdToken: CachedTokenEntry | null = null;

function readCachedTokenFromStorage(): CachedTokenEntry | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(SESSION_CACHED_ID_TOKEN_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedTokenEntry;
    if (!parsed || typeof parsed.token !== "string" || !parsed.token) {
      window.sessionStorage.removeItem(SESSION_CACHED_ID_TOKEN_KEY);
      return null;
    }
    const exp = parseJwtExpMs(parsed.token);
    // If the JWT itself is already expired (with 10s buffer), purge and return null
    if (!exp || exp <= Date.now() + 10_000) {
      window.sessionStorage.removeItem(SESSION_CACHED_ID_TOKEN_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCachedTokenToStorage(entry: CachedTokenEntry): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(SESSION_CACHED_ID_TOKEN_KEY, JSON.stringify(entry));
  } catch {
    // ignore quota/private mode errors
  }
}

function removeCachedTokenFromStorage(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(SESSION_CACHED_ID_TOKEN_KEY);
  } catch {
    // ignore
  }
}

export function setCachedIdToken(token: string, expiresAt: number): void {
  const entry: CachedTokenEntry = { token, expiresAt };
  cachedIdToken = entry;
  writeCachedTokenToStorage(entry);
}

export function invalidateCachedIdToken(): void {
  cachedIdToken = null;
  removeCachedTokenFromStorage();
}

/**
 * Returns a valid cached token entry (from memory or sessionStorage fallback).
 * Optionally verifies that the token belongs to the expected user UID.
 */
export function getValidCachedToken(expectedUid?: string | null): CachedTokenEntry | null {
  const validateEntry = (entry: CachedTokenEntry | null): CachedTokenEntry | null => {
    if (!entry || !entry.token) return null;
    const payload = parseJwtPayload(entry.token);
    if (!payload) return null;

    const exp = typeof payload.exp === "number" ? payload.exp * 1000 : null;
    if (!exp || exp <= Date.now() + 10_000) {
      return null;
    }

    if (expectedUid) {
      const tokenUid = payload.user_id || payload.sub;
      if (tokenUid && tokenUid !== expectedUid) {
        return null;
      }
    }

    return entry;
  };

  const validMem = validateEntry(cachedIdToken);
  if (validMem) {
    return validMem;
  }

  const fromStorage = readCachedTokenFromStorage();
  const validStorage = validateEntry(fromStorage);
  if (validStorage) {
    cachedIdToken = validStorage;
    return validStorage;
  } else if (fromStorage) {
    removeCachedTokenFromStorage();
  }

  cachedIdToken = null;
  return null;
}

export async function resolveCurrentUser(): Promise<User | null> {
  if (!auth) return null;
  if (auth.currentUser) return auth.currentUser;

  // Singleflight deduplication: all concurrent requests share the same hydration promise
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
 * Orchestrates a forced token refresh across in-flight calls and browser tabs.
 * Uses Web Locks API (lucid:token-refresh) with double-check pattern so only one tab hits Google.
 */
async function executeTokenRefresh(user: User): Promise<string> {
  if (inFlightRefreshPromise) {
    return inFlightRefreshPromise;
  }

  inFlightRefreshPromise = (async () => {
    try {
      let refreshed = "";

      if (typeof navigator !== "undefined" && (navigator as any).locks?.request) {
        refreshed = await (navigator as any).locks.request("lucid:token-refresh", async () => {
          // Double-check: another tab might have refreshed it while this tab waited for the lock
          try {
            const candidate = await user.getIdToken(false);
            const exp = parseJwtExpMs(candidate);
            if (exp && exp - Date.now() > 60_000) {
              return candidate;
            }
          } catch {}

          return await fetchUserTokenWithRetry(user, true);
        });
      } else {
        refreshed = await fetchUserTokenWithRetry(user, true);
      }

      const exp = parseJwtExpMs(refreshed);
      // Cache for at most 5 minutes, but never beyond (exp - 60 seconds)
      const safeExpiry = exp
        ? Math.min(Date.now() + 5 * 60 * 1000, exp - 60_000)
        : Date.now() + 5 * 60 * 1000;

      setCachedIdToken(refreshed, safeExpiry);
      return refreshed;
    } finally {
      inFlightRefreshPromise = null;
    }
  })();

  return inFlightRefreshPromise;
}

/**
 * Returns an Authorization bearer token from Firebase auth when available.
 * Deduplicates in-flight calls, proactively refreshes expiring tokens,
 * and retries on transient network errors.
 */
export async function getFirebaseIdToken(forceRefresh: boolean = false): Promise<string> {
  const now = Date.now();
  if (!forceRefresh) {
    const memoryCached = getValidCachedToken();
    if (memoryCached && memoryCached.expiresAt > now) {
      return memoryCached.token;
    }
  }

  if (inFlightTokenPromise) {
    return inFlightTokenPromise;
  }

  inFlightTokenPromise = (async () => {
    try {
      const user = await resolveCurrentUser();
      if (!user) {
        return "";
      }

      // Check storage cache with expectedUid if not forcing refresh
      if (!forceRefresh) {
        const existing = getValidCachedToken(user.uid);
        if (existing && existing.expiresAt > now) {
          return existing.token;
        }
      }

      if (forceRefresh) {
        return await executeTokenRefresh(user);
      }

      try {
        const token = await fetchUserTokenWithRetry(user, false);
        const exp = parseJwtExpMs(token);

        // Proactive refresh: if token has < 60 seconds remaining or is expired, refresh now
        if (exp && exp - Date.now() <= 60_000) {
          return await executeTokenRefresh(user);
        }

        const safeExpiry = exp
          ? Math.min(Date.now() + 5 * 60 * 1000, exp - 60_000)
          : Date.now() + 5 * 60 * 1000;

        setCachedIdToken(token, safeExpiry);
        return token;
      } catch (err: any) {
        if (isTransientNetworkError(err)) {
          // If we have a cached token in memory or sessionStorage whose JWT is not expired yet, fall back to it
          const fallbackEntry = getValidCachedToken(user.uid);
          if (fallbackEntry?.token) {
            const exp = parseJwtExpMs(fallbackEntry.token);
            if (!exp || exp > Date.now()) {
              console.warn(
                "[fetch-with-auth] Network error refreshing token, falling back to persistent cached token from sessionStorage"
              );
              return fallbackEntry.token;
            }
          }
          // Do NOT return empty string if the user is authenticated! Re-throw so callers don't make unauthenticated requests
          throw err;
        }

        console.warn("[fetch-with-auth] Terminal auth error during token retrieval:", err);
        invalidateCachedIdToken();
        return "";
      }
    } finally {
      inFlightTokenPromise = null;
    }
  })();

  return inFlightTokenPromise;
}

/**
 * Fetch wrapper that injects Firebase JWT into Authorization header.
 * Handles proactive refresh, network retry, and 401 Unauthorized token recovery.
 */
export async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  let token = "";
  try {
    token = await getFirebaseIdToken();
  } catch (tokenErr: any) {
    if (isTransientNetworkError(tokenErr)) {
      console.warn("[fetch-with-auth] Aborting request due to network error obtaining token:", { url, error: tokenErr.message });
      throw new TypeError(`Failed to fetch: Network offline or error while refreshing token (${tokenErr.message})`);
    }
    throw tokenErr;
  }

  const shouldRegisterSession = Boolean((options as any).registerSession);
  const headers = toHeaders(options.headers);
  headers.set("X-Device-ID", getDeviceId());
  headers.set("X-Platform", "web");
  if (shouldRegisterSession) {
    headers.set("X-Register-Session", "true");
  }

  // Ensure active tenant company header is forwarded if available in localStorage
  if (!headers.has("X-Company-ID") && typeof window !== "undefined") {
    try {
      let activeCompany = window.localStorage.getItem("lucid:active-company");
      if (!activeCompany) {
        for (let i = 0; i < window.localStorage.length; i++) {
          const key = window.localStorage.key(i);
          if (key && key.startsWith("lucid:active-company:")) {
            const val = window.localStorage.getItem(key);
            if (val) {
              activeCompany = val;
              break;
            }
          }
        }
      }
      if (activeCompany) {
        headers.set("X-Company-ID", activeCompany);
      }
    } catch {}
  }

  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem("lucid:last-active-at", Date.now().toString());
        window.sessionStorage.setItem("lucid:last-active-at", Date.now().toString());
      } catch {}
    }
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

  // Handle 401 Session_Replaced or Session_Expired cleanly without retry loops
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
      if (errText.includes("Session_Expired")) {
        console.info("[fetch-with-auth] Session expired due to inactivity.", { url });
        window.dispatchEvent(
          new CustomEvent("lucid:auth:force-logout", {
            detail: { reason: "inactivity" }
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

  // If the backend returns 401, force a refresh once with retry & locks
  if (response.status === 401) {
    invalidateCachedIdToken();
    console.warn("[fetch-with-auth] Received 401, forcing token refresh and retrying", { url });

    const currentUser = auth?.currentUser;
    if (!currentUser) {
      console.error("[fetch-with-auth] Cannot refresh token because currentUser is null");
      if (typeof window !== "undefined") {
        const path = window.location.pathname;
        if (path !== "/login" && path !== "/" && path !== "/signup") {
          window.dispatchEvent(
            new CustomEvent("lucid:auth:force-logout", { detail: { reason: "unauthorized" } })
          );
        }
      }
      return response;
    }

    let refreshedToken = "";
    try {
      refreshedToken = await executeTokenRefresh(currentUser);
    } catch (refreshErr: any) {
      console.error("[fetch-with-auth] Retry token refresh failed:", refreshErr);
      if (isTransientNetworkError(refreshErr)) {
        // DO NOT log out user on network connection drops!
        console.warn("[fetch-with-auth] Preserving session despite refresh error (transient network failure)");
        return response;
      }
      // If it is an explicit auth revocation error from Firebase, force logout
      if (!auth?.currentUser || refreshErr?.code?.startsWith("auth/")) {
        window.dispatchEvent(
          new CustomEvent("lucid:auth:force-logout", { detail: { reason: "unauthorized" } })
        );
      }
      return response;
    }

    if (!refreshedToken) {
      return response;
    }

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
          console.warn("[fetch-with-auth] Unrecoverable 401 detected on retry, dispatching force-logout", { url, errText });
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

  return response;
}
