"use client"

import type React from "react"
import { createContext, useContext, useEffect, useRef, useState } from "react"
import { type User, onAuthStateChanged, signOut } from "firebase/auth"
import { auth } from "@/lib/firebase"
import { createCacheKey, sharedDataClient } from "@/lib/data-client"
import { fetchWithAuth, getFirebaseIdToken } from "@/lib/fetch-with-auth"
import { getDeviceId } from "@/lib/device"

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL
const MANUAL_AUTH_STORAGE_KEY = "lucid:manual-auth-user"
const MANUAL_PROFILE_STORAGE_KEY = "lucid:manual-auth-profile"
const LAST_ACTIVE_STORAGE_KEY = "lucid:last-active-at"
const INACTIVITY_TIMEOUT_MS = 60 * 60 * 1000 // 1 hour
const SESSION_COOKIE_NAME = "lucid_session_active"

export const isBrowserSessionActive = (): boolean => {
  if (typeof document === "undefined") return false
  return document.cookie.split(";").some((c) => c.trim().startsWith(`${SESSION_COOKIE_NAME}=`))
}

export const setBrowserSessionActive = (): void => {
  if (typeof document === "undefined") return
  document.cookie = `${SESSION_COOKIE_NAME}=1; path=/; SameSite=Lax`
}

export const clearBrowserSessionActive = (): void => {
  if (typeof document === "undefined") return
  document.cookie = `${SESSION_COOKIE_NAME}=; path=/; max-age=0; SameSite=Lax`
}

type AuthUserLike = {
  uid: string
  email?: string | null
  displayName?: string | null
  name?: string | null
}

let authSocketSingleton: WebSocket | null = null
let authSocketCurrentUserId: string | null = null

interface AuthContextType {
  user: User | null
  loading: boolean
  rolesLoaded: boolean
  userRoles: string[]
  isAdmin: boolean
  isSuperAdmin: boolean
  isDeveloper: boolean
  isManager: boolean
  isManagerofUsers: boolean
  userId: string | null
  employeeData: any | null
  initialTenantData?: any | null
  initialNotificationsData?: any | null
  login: (userData: any) => Promise<void>
  logout: (reason?: string) => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  rolesLoaded: false,
  userRoles: [],
  isAdmin: false,
  isSuperAdmin: false,
  isDeveloper: false,
  isManager: false,
  isManagerofUsers: false,
  userId: null,
  employeeData: null,
  initialTenantData: null,
  initialNotificationsData: null,
  login: async () => {},
  logout: async () => {},
  refreshProfile: async () => {},
})

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}

const fetchUserByEmail = async (email: string | undefined | null) => {
  if (!email) return null
  const res = await fetchWithAuth(`${API_BASE}/api/users/by-email/${encodeURIComponent(email)}`)
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error(`Failed to fetch user by email: ${res.status}`)
  }
  const payload = await res.json()
  let u = payload?.user ?? payload
  if (Array.isArray(u)) u = u[0]
  return u || null
}

const normalizeRoleName = (value: string) => value.toLowerCase().replace(/[-_\s]/g, '')

const fetchUserRoles = async (userId: string) => {
  // console.log(`[auth-context] Fetching roles for user ID: ${userId}`)
  const normalizedUserId = (userId || '').toString().trim()
  // console.log(`[auth-context] Normalized user ID: ${normalizedUserId}`)
  if (!normalizedUserId || normalizedUserId === 'undefined' || normalizedUserId === 'null') {
    return { roles: [], isAdmin: false, isSuperAdmin: false, isDeveloper: false, isManager: false }
  }
  try {
    // console.log("ROlES API URL", `${API_BASE}/api/roles/users/${encodeURIComponent(normalizedUserId)}`)
    const rolesRes = await fetchWithAuth(`${API_BASE}/api/roles/users/${encodeURIComponent(normalizedUserId)}`, {
      headers: { 'X-User-ID': normalizedUserId }
    })

    if (!rolesRes.ok) {
      throw new Error(`Failed to fetch user roles: ${rolesRes.status}`)
    }

    const payload = await rolesRes.json().catch(() => null)
    let assignments = payload?.assignments ?? payload?.data ?? payload ?? []

    if (!Array.isArray(assignments) || assignments.length === 0) {
      const fallbackRes = await fetchWithAuth(
        `${API_BASE}/api/users/${encodeURIComponent(normalizedUserId)}/roles`,
        { headers: { 'X-User-ID': normalizedUserId } }
      )
      if (fallbackRes.ok) {
        const fallbackPayload = await fallbackRes.json().catch(() => null)
        const fallbackAssignments =
          fallbackPayload?.roles ??
          fallbackPayload?.assignments ??
          fallbackPayload?.data ??
          []
        if (Array.isArray(fallbackAssignments) && fallbackAssignments.length > 0) {
          assignments = fallbackAssignments
        }
      }
    }

    // normalize and extract role objects from multiple payload shapes
    const normalizedRoles = (assignments || []).map((ra: any) => {
      const roleNode = ra?.role ?? ra?.roles ?? ra
      const r = Array.isArray(roleNode) ? (roleNode[0] ?? {}) : (roleNode ?? {})

      const rawName =
        r?.name ??
        r?.role_name ??
        ra?.role_name ??
        ra?.name ??
        ''

      const rawLevel =
        r?.level ??
        r?.role_level ??
        ra?.level ??
        ra?.role_level ??
        -1

      const parsedLevel = Number(rawLevel)

      return {
        name: String(rawName || '').trim(),
        level: Number.isFinite(parsedLevel) ? parsedLevel : -1,
        id: r?.role_id ?? r?.id ?? ra?.role_id ?? null
      }
    }).filter((r: any) => r.name || r.level >= 0)

    const roleNames = normalizedRoles.map((r: any) => r.name)

    // admin detection: role.level >= 3 OR known admin names
    const hasAdminRole = normalizedRoles.some((r: any) => {
      const name = normalizeRoleName(r.name || '')
      return r.level >= 3 || ['admin','superadmin','super_admin','ceo'].includes(name)
    })

    // super_admin detection: role.level >= 4 OR known super_admin names
    const hasSuperAdminRole = normalizedRoles.some((r: any) => {
      const name = normalizeRoleName(r.name || '')
      return r.level >= 4 || ['superadmin','super_admin','ceo'].includes(name)
    })

    const hasManagerRole = normalizedRoles.some((r: any) => {
      const name = normalizeRoleName(r.name || '')
      return r.level === 2 || name.includes('manager')
    })

    const hasDeveloperRole = normalizedRoles.some((r: any) => {
      const name = normalizeRoleName(r.name || '')
      return r.level >= 6 || ['developer'].includes(name)
    })

    return {
      roles: roleNames,
      isAdmin: hasAdminRole,
      isSuperAdmin: hasSuperAdminRole,
      isDeveloper: hasDeveloperRole,
      isManager: hasManagerRole
    }
  } catch (e) {
    console.error('[auth-context] Error fetching user roles:', e)
    return { roles: [], isAdmin: false, isSuperAdmin: false, isDeveloper: false, isManager: false }
  }
}

const loadCachedFullProfile = async (
  authUser: AuthUserLike,
  throwOnError = false,
  registerSession = false
) => {
  if (!authUser?.email) return null

  // Check if a valid Firebase token exists before attempting to fetch
  const token = await getFirebaseIdToken()
  if (!token) {
    return null
  }

  const key = createCacheKey({
    namespace: "auth",
    tenantId: "global",
    userId: authUser.uid,
    path: "/auth/full-profile"
  })

  try {
    const result = await sharedDataClient.query(
      key,
      async () => {
        const fetchOpts: any = registerSession ? { registerSession: true } : {}
        const res = await fetchWithAuth(`${API_BASE}/api/auth/me`, fetchOpts)
        if (!res.ok) {
          let errText = ""
          try {
            const errJson = await res.json()
            errText = errJson?.detail || ""
          } catch {
            errText = await res.text().catch(() => "")
          }
          if (res.status === 403 || res.status === 404) {
            throw new Error(errText || "Access denied. Your email is not in the allowed users list.")
          }
          if (res.status === 401 && (errText.includes("bearer token") || errText.includes("Missing"))) {
            return null
          }
          throw new Error(errText || `Failed to fetch profile: ${res.status}`)
        }

        const payload = await res.json()
        return {
          employeeData: payload.employeeData,
          userId: payload.userId,
          userRoles: payload.userRoles || [],
          isAdmin: Boolean(payload.isAdmin),
          isSuperAdmin: Boolean(payload.isSuperAdmin),
          isDeveloper: Boolean(payload.isDeveloper),
          isManager: Boolean(payload.isManager),
          isManagerofUsers: Boolean(payload.isManagerofUsers),
          tenant: payload.tenant,
          notifications: payload.notifications,
        }
      },
      {
        ttlMs: 60 * 60 * 1000,
        swr: true,
        swrMs: 5 * 60 * 1000
      }
    )

    return result.data
  } catch (error: any) {
    console.error("[auth-context] Profile fetch failed:", error)
    if (throwOnError || (error.message && (
      error.message.includes("Access denied") ||
      error.message.includes("deactivated") ||
      error.message.includes("organization")
    ))) {
      throw error
    }
    return undefined // Use undefined to explicitly indicate non-access system failure
  }
}

export const readManualAuthUser = (): AuthUserLike | null => {
  if (typeof window === "undefined") return null
  if (!isBrowserSessionActive()) return null
  try {
    const raw = window.sessionStorage.getItem(MANUAL_AUTH_STORAGE_KEY) ||
                window.localStorage.getItem(MANUAL_AUTH_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as AuthUserLike
    if (!parsed?.uid || !parsed?.email) return null
    return parsed
  } catch {
    return null
  }
}

export const hasActiveSession = (): boolean => {
  if (typeof window === "undefined") return false
  if (!isBrowserSessionActive()) return false
  try {
    const isDisplaced = window.sessionStorage.getItem("lucid:displaced-session") === "1"
    if (isDisplaced) return false
    const user = readManualAuthUser()
    return Boolean(user?.uid && user?.email)
  } catch {
    return false
  }
}

const writeManualAuthUser = (user: AuthUserLike): void => {
  if (typeof window === "undefined") return
  try {
    const val = JSON.stringify(user)
    window.sessionStorage.setItem(MANUAL_AUTH_STORAGE_KEY, val)
    window.localStorage.setItem(MANUAL_AUTH_STORAGE_KEY, val)
    setBrowserSessionActive()
  } catch {
    // no-op
  }
}

export const clearManualAuthUser = (): void => {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.removeItem(MANUAL_AUTH_STORAGE_KEY)
    window.sessionStorage.removeItem(MANUAL_PROFILE_STORAGE_KEY)
    window.sessionStorage.removeItem(LAST_ACTIVE_STORAGE_KEY)
    window.localStorage.removeItem(MANUAL_AUTH_STORAGE_KEY)
    window.localStorage.removeItem(MANUAL_PROFILE_STORAGE_KEY)
    clearBrowserSessionActive()
  } catch {
    // no-op
  }
}

const writeCachedProfile = (profile: any): void => {
  if (typeof window === "undefined") return
  try {
    const val = JSON.stringify(profile)
    window.sessionStorage.setItem(MANUAL_PROFILE_STORAGE_KEY, val)
    window.localStorage.setItem(MANUAL_PROFILE_STORAGE_KEY, val)
  } catch {
    // no-op
  }
}

const readCachedProfile = (): any | null => {
  if (typeof window === "undefined") return null
  if (!isBrowserSessionActive()) return null
  try {
    const raw = window.sessionStorage.getItem(MANUAL_PROFILE_STORAGE_KEY) ||
                window.localStorage.getItem(MANUAL_PROFILE_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export const isSessionExpiredDueToInactivity = (): boolean => {
  if (typeof window === "undefined") return false
  try {
    const lastActiveStr = window.localStorage.getItem(LAST_ACTIVE_STORAGE_KEY) ||
                          window.sessionStorage.getItem(LAST_ACTIVE_STORAGE_KEY)
    if (!lastActiveStr) return false
    const lastActive = parseInt(lastActiveStr, 10)
    if (isNaN(lastActive)) return false
    return Date.now() - lastActive > INACTIVITY_TIMEOUT_MS
  } catch {
    return false
  }
}

export const updateLastActiveTimestamp = (): void => {
  if (typeof window === "undefined") return
  try {
    const now = Date.now().toString()
    window.localStorage.setItem(LAST_ACTIVE_STORAGE_KEY, now)
    window.sessionStorage.setItem(LAST_ACTIVE_STORAGE_KEY, now)
  } catch {}
}

let hasRegisteredSessionForUser: string | null = null

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    if (isSessionExpiredDueToInactivity()) {
      clearManualAuthUser();
      return null;
    }
    return (readManualAuthUser() as User) || null
  })
  const [loading, setLoading] = useState<boolean>(() => {
    return !readManualAuthUser()
  })
  const [rolesLoaded, setRolesLoaded] = useState(false)
  const [userRoles, setUserRoles] = useState<string[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [isDeveloper, setIsDeveloper] = useState(false)
  const [isManager, setIsManager] = useState(false)
  const [isManagerofUsers, setIsManagerofUsers] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [employeeData, setEmployeeData] = useState<any | null>(null)
  const [initialTenantData, setInitialTenantData] = useState<any | null>(() => {
    const p = readCachedProfile()
    return p?.tenant ?? null
  })
  const [initialNotificationsData, setInitialNotificationsData] = useState<any | null>(() => {
    const p = readCachedProfile()
    return p?.notifications ?? null
  })

  useEffect(() => {
    if (typeof window === "undefined") return;

    const pathname = window.location.pathname;

    const isAuthPage =
        pathname === "/login" ||
        pathname === "/signup" ||
        pathname === "/forgot-password";

    if (isAuthPage) {
        if (authSocketSingleton) {
            try {
                authSocketSingleton.close();
            } catch {}

            authSocketSingleton = null;
            authSocketCurrentUserId = null;
        }

        return;
    }

    if (!user?.uid || !API_BASE) {
        if (authSocketSingleton) {
            try {
                authSocketSingleton.close();
            } catch {}

            authSocketSingleton = null;
            authSocketCurrentUserId = null;
        }

        return;
    }

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const connectAuthSocket = async () => {
      try {
        const token = await getFirebaseIdToken()
        if (!token) return

        if (
          authSocketSingleton &&
          (authSocketSingleton.readyState === WebSocket.OPEN ||
            authSocketSingleton.readyState === WebSocket.CONNECTING)
        ) {
          return
        }

        const deviceId = getDeviceId()

        const wsBase = API_BASE.replace(/^https/, "wss").replace(/^http/, "ws")
        if (authSocketSingleton) {
          try {
            authSocketSingleton.close()
          } catch {
            // no-op
          }
        }

        const socket = new WebSocket(
          `${wsBase}/api/auth/ws?token=${encodeURIComponent(token)}&device_id=${encodeURIComponent(deviceId)}&platform=web`
        )

        authSocketSingleton = socket
        authSocketCurrentUserId = user.uid

        socket.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data)
            if (payload?.type === "force_logout" || payload?.type === "session_replaced") {
              const platform = String(payload?.platform || "web").toLowerCase()
              if (platform !== "web") {
                return // Mobile displacement does not affect web
              }
              const keepDevId = payload?.keep_device_id
              const currentDevId = getDeviceId()
              if (keepDevId && currentDevId && keepDevId === currentDevId) {
                // Kept device must not logout
                return
              }
              if (keepDevId && currentDevId && keepDevId !== currentDevId) {
                window.dispatchEvent(
                  new CustomEvent("lucid:auth:force-logout", { detail: { reason: "session_replaced" } })
                )
              }
            }
          } catch {
            // ignore malformed payloads
          }
        }

        socket.onclose = () => {
          if (authSocketSingleton === socket) {
            authSocketSingleton = null
            authSocketCurrentUserId = null
          }
          if (auth?.currentUser) {
            reconnectTimer = setTimeout(connectAuthSocket, 3000)
          }
        }
      } catch (error) {
        console.warn("[auth-context] Failed to open auth websocket", error)
      }
    }

    void connectAuthSocket()

    return () => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
      }
    }
  }, [user?.uid])

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      const pathname =
        typeof window !== "undefined"
          ? window.location.pathname
          : "";

      const isAuthPage =
        pathname === "/login" ||
        pathname === "/signup" ||
        pathname === "/forgot-password";

      // 1. If user is currently on an auth page and firebaseUser authenticated, activate browser session
      if (isAuthPage && firebaseUser) {
        setBrowserSessionActive();
        updateLastActiveTimestamp();
      }

      // 2. If NOT on an auth page and browser session is NOT active, user opened browser fresh after close
      if (!isAuthPage && !isBrowserSessionActive()) {
        if (firebaseUser) {
          try {
            await signOut(auth);
          } catch {}
        }
        clearManualAuthUser();
        clearBrowserSessionActive();
        setUser(null);
        setLoading(false);
        if (typeof window !== "undefined") {
          window.location.replace("/login");
        }
        return;
      }

      // 3. Check 1-hour inactivity
      if (isSessionExpiredDueToInactivity()) {
        await logout("inactivity");
        if (typeof window !== "undefined") {
          window.location.replace("/login?reason=inactivity");
        }
        return;
      }

      const effectiveUser = firebaseUser ?? readManualAuthUser()
      setUser((effectiveUser as User) || null)

      if (effectiveUser?.email) {
        if (!isAuthPage) {
          setRolesLoaded(false)

          let profile = readCachedProfile();

          if (!profile) {
              profile = await loadCachedFullProfile(effectiveUser);

              if (profile) {
                  writeCachedProfile(profile);
              }
          }

          if (profile !== undefined) {
            if (profile) {
              writeCachedProfile(profile)
              setEmployeeData(profile.employeeData)
              setUserId(profile.userId)
              setUserRoles(profile.userRoles)
              setIsAdmin(profile.isAdmin)
              setIsSuperAdmin(profile.isSuperAdmin)
              setIsDeveloper(Boolean(profile.isDeveloper))
              setIsManager(Boolean(profile.isManager))
              setIsManagerofUsers(Boolean(profile.isManagerofUsers))
              if (profile.tenant) setInitialTenantData(profile.tenant)
              if (profile.notifications) setInitialNotificationsData(profile.notifications)
              setRolesLoaded(true)
            } else {
              setEmployeeData(null)
              setUserId(null)
              setUserRoles([])
              setIsAdmin(false)
              setIsSuperAdmin(false)
              setIsDeveloper(false)
              setIsManager(false)
              setIsManagerofUsers(false)
              setRolesLoaded(false)
            }
          }

          if (!firebaseUser) {
            writeManualAuthUser(effectiveUser)
          }
        } else {
          // If on an auth page but already authenticated, restore cached profile
          const profile = readCachedProfile();
          if (profile) {
            setEmployeeData(profile.employeeData);
            setUserId(profile.userId);
            setUserRoles(profile.userRoles);
            setIsAdmin(profile.isAdmin);
            setIsSuperAdmin(profile.isSuperAdmin);
            setIsDeveloper(Boolean(profile.isDeveloper));
            setIsManager(Boolean(profile.isManager));
            setIsManagerofUsers(Boolean(profile.isManagerofUsers));
            setRolesLoaded(true);
          }
        }
      } else {
        // Reset all data on logout
        clearManualAuthUser()
        sharedDataClient.clear()
        setEmployeeData(null)
        setUserId(null)
        setUserRoles([])
        setIsAdmin(false)
        setIsSuperAdmin(false)
        setIsDeveloper(false)
        setIsManager(false)
        setIsManagerofUsers(false)
        setRolesLoaded(false)
      }
      
      setLoading(false)
    })

    let isDisplacing = false;
    const forceLogoutListener = async (event?: Event) => {
      if (isDisplacing) return;
      isDisplacing = true;
      const customEvt = event as CustomEvent;
      const reason = customEvt?.detail?.reason;
      console.info("[auth-context] Graceful session revocation in progress", reason, event);

      if (authSocketSingleton) {
        try {
          authSocketSingleton.close();
        } catch {}
        authSocketSingleton = null;
        authSocketCurrentUserId = null;
      }

      // Synchronously clear local auth tokens & user state immediately to halt all in-flight polling
      clearManualAuthUser();
      sharedDataClient.clear();
      clearBrowserSessionActive();
      if (typeof window !== 'undefined') {
        try {
          if (reason === "session_replaced") {
            window.sessionStorage.setItem("lucid:displaced-session", "1");
          } else {
            window.sessionStorage.removeItem("lucid:displaced-session");
          }
        } catch {}
      }

      // Run background signOut without blocking redirect
      try {
        signOut(auth).catch(() => {});
      } catch {}

      try {
        if (typeof BroadcastChannel !== "undefined") {
          const ch = new BroadcastChannel("lucid:auth-sync");
          ch.postMessage({
            type: "LUCID_SESSION_LOGOUT",
            payload: { reason: "displaced" },
          });
          ch.close();
        }
      } catch {}

      if (typeof window !== 'undefined') {
        window.location.replace('/login');
      }
    };
    
    // Option 2 (Approved): Cross-tab BroadcastChannel synchronization
    let authChannel: BroadcastChannel | null = null;
    if (typeof BroadcastChannel !== "undefined") {
      try {
        authChannel = new BroadcastChannel("lucid:auth-sync");
        authChannel.onmessage = (event) => {
          const { type, payload } = event.data || {};

          if (type === "LUCID_SESSION_PROBE") {
            const currentManual = readManualAuthUser();
            const currentProf = readCachedProfile();
            const lastActive = typeof window !== "undefined" ? window.sessionStorage.getItem(LAST_ACTIVE_STORAGE_KEY) : null;
            if (currentManual && !isSessionExpiredDueToInactivity()) {
              authChannel?.postMessage({
                type: "LUCID_SESSION_RESPONSE",
                payload: {
                  user: currentManual,
                  profile: currentProf,
                  lastActive: lastActive || Date.now().toString(),
                },
              });
            }
          } else if (type === "LUCID_SESSION_RESPONSE" || type === "LUCID_SESSION_LOGIN") {
            if (payload?.user) {
              writeManualAuthUser(payload.user);
              if (payload.profile) {
                writeCachedProfile(payload.profile);
                setEmployeeData(payload.profile.employeeData);
                setUserId(payload.profile.userId);
                setUserRoles(payload.profile.userRoles);
                setIsAdmin(payload.profile.isAdmin);
                setIsSuperAdmin(payload.profile.isSuperAdmin);
                setIsDeveloper(Boolean(payload.profile.isDeveloper));
                setIsManager(Boolean(payload.profile.isManager));
                setIsManagerofUsers(Boolean(payload.profile.isManagerofUsers));
                setRolesLoaded(true);
              }
              if (payload.lastActive && typeof window !== "undefined") {
                window.sessionStorage.setItem(LAST_ACTIVE_STORAGE_KEY, String(payload.lastActive));
              }
              setUser(payload.user as User);
              setLoading(false);
              if (typeof window !== "undefined" && (window.location.pathname === "/login" || window.location.pathname === "/")) {
                window.location.replace("/employee/welcome");
              }
            }
          } else if (type === "LUCID_SESSION_LOGOUT") {
            clearManualAuthUser();
            sharedDataClient.clear();
            setUser(null);
            setEmployeeData(null);
            setUserId(null);
            setUserRoles([]);
            setIsAdmin(false);
            setIsSuperAdmin(false);
            setIsDeveloper(false);
            setIsManager(false);
            setIsManagerofUsers(false);
            setRolesLoaded(false);
            setLoading(false);
            const reason = payload?.reason || "manual";
            if (typeof window !== "undefined") {
              const path = window.location.pathname;
              if (path !== "/login" && path !== "/" && path !== "/signup") {
                const target = reason === "inactivity" ? "/login?reason=inactivity" : "/login";
                window.location.replace(target);
              }
            }
          } else if (type === "LUCID_ACTIVITY_PING") {
            if (payload?.timestamp && typeof window !== "undefined") {
              window.sessionStorage.setItem(LAST_ACTIVE_STORAGE_KEY, String(payload.timestamp));
            }
          }
        };

        if (!readManualAuthUser()) {
          authChannel.postMessage({ type: "LUCID_SESSION_PROBE" });
        }
      } catch (err) {
        console.warn("[auth-context] BroadcastChannel init error:", err);
      }
    }

    if (typeof window !== 'undefined') {
      window.addEventListener('lucid:auth:force-logout', forceLogoutListener);
    }

    return () => {
      unsubscribe();
      if (typeof window !== 'undefined') {
        window.removeEventListener('lucid:auth:force-logout', forceLogoutListener);
      }
      if (authChannel) {
        try {
          authChannel.close();
        } catch {}
      }
    };
  }, [])

  // Inactivity tracking (1-hour idle timeout)
  useEffect(() => {
    if (typeof window === "undefined" || !user) return;

    if (!window.sessionStorage.getItem(LAST_ACTIVE_STORAGE_KEY)) {
      updateLastActiveTimestamp();
    }

    let lastWrite = 0;
    let lastBroadcast = 0;

    const recordActivity = () => {
      const now = Date.now();
      if (now - lastWrite > 15_000) {
        lastWrite = now;
        try {
          window.localStorage.setItem(LAST_ACTIVE_STORAGE_KEY, now.toString());
          window.sessionStorage.setItem(LAST_ACTIVE_STORAGE_KEY, now.toString());
        } catch {}
      }

      if (now - lastBroadcast > 30_000) {
        lastBroadcast = now;
        try {
          if (typeof BroadcastChannel !== "undefined") {
            const ch = new BroadcastChannel("lucid:auth-sync");
            ch.postMessage({ type: "LUCID_ACTIVITY_PING", payload: { timestamp: now } });
            ch.close();
          }
        } catch {}
      }
    };

    const activityEvents = ["mousedown", "keydown", "scroll", "touchstart"];
    activityEvents.forEach((evt) => window.addEventListener(evt, recordActivity, { passive: true }));

    const checkInactivity = async () => {
      if (isSessionExpiredDueToInactivity()) {
        console.info("[auth-context] Session expired due to 1 hour of inactivity");
        await logout("inactivity");
        if (typeof window !== "undefined") {
          window.location.replace("/login?reason=inactivity");
        }
      }
    };

    const intervalId = setInterval(checkInactivity, 30_000);
    window.addEventListener("focus", checkInactivity);
    document.addEventListener("visibilitychange", checkInactivity);

    return () => {
      activityEvents.forEach((evt) => window.removeEventListener(evt, recordActivity));
      clearInterval(intervalId);
      window.removeEventListener("focus", checkInactivity);
      document.removeEventListener("visibilitychange", checkInactivity);
    };
  }, [user?.uid]);

  // Login function for email/password authentication
  const login = async (userData: any) => {
    try {
      setUser(userData as User)

      if (userData?.email && userData?.uid) {
        const authUserObj = {
          uid: userData.uid,
          email: userData.email,
          displayName: userData.displayName ?? userData.name ?? null,
          name: userData.name ?? userData.displayName ?? null,
        }

        setBrowserSessionActive();
        updateLastActiveTimestamp();
        writeManualAuthUser(authUserObj);
        hasRegisteredSessionForUser = authUserObj.uid;

        // Invalidate stale cache for fresh login validation
        sharedDataClient.invalidateByPrefix("v1|auth")
        if (typeof window !== "undefined") {
          window.sessionStorage.removeItem(MANUAL_PROFILE_STORAGE_KEY)
    window.sessionStorage.removeItem(LAST_ACTIVE_STORAGE_KEY)
          window.localStorage.removeItem(MANUAL_PROFILE_STORAGE_KEY)
        }

        // Consolidated bootstrap: /api/auth/me registers device session on login and returns user + roles + tenant + notifications atomically
        const profile = await loadCachedFullProfile(authUserObj, true, true);

        if (profile) {
          writeCachedProfile(profile)
          setEmployeeData(profile.employeeData)
          setUserId(profile.userId)
          setUserRoles(profile.userRoles)
          setIsAdmin(profile.isAdmin)
          setIsSuperAdmin(profile.isSuperAdmin)
          setIsDeveloper(Boolean(profile.isDeveloper))
          setIsManager(Boolean(profile.isManager))
          setIsManagerofUsers(Boolean(profile.isManagerofUsers))
          if (profile.tenant) setInitialTenantData(profile.tenant)
          if (profile.notifications) setInitialNotificationsData(profile.notifications)
          setRolesLoaded(true)
          try {
            if (typeof BroadcastChannel !== "undefined") {
              const ch = new BroadcastChannel("lucid:auth-sync");
              ch.postMessage({
                type: "LUCID_SESSION_LOGIN",
                payload: {
                  user: authUserObj,
                  profile,
                  lastActive: Date.now().toString(),
                },
              });
              ch.close();
            }
          } catch {}
        } else {
          setEmployeeData(null)
          setUserId(null)
          setUserRoles([])
          setIsAdmin(false)
          setIsSuperAdmin(false)
          setIsDeveloper(false)
          setIsManager(false)
          setIsManagerofUsers(false)
          setRolesLoaded(false)
          throw new Error("Access denied. Your email is not in the allowed users list.")
        }
      }

      setLoading(false)
    } catch (error) {
      console.error("Login failed:", error)
      throw error
    }
  }

  const logout = async (reason?: string) => {
    if (authSocketSingleton) {
      try {
        authSocketSingleton.close()
      } catch {
        // no-op
      }
    }
    authSocketSingleton = null
    authSocketCurrentUserId = null
    hasRegisteredSessionForUser = null
    try {
      await signOut(auth)
    } catch {}
    clearManualAuthUser()
    sharedDataClient.invalidateByPrefix("v1|auth")
    sharedDataClient.clear()
    setUser(null)
    setEmployeeData(null)
    setUserId(null)
    setUserRoles([])
    setIsAdmin(false)
    setIsSuperAdmin(false)
    setIsDeveloper(false)
    setIsManager(false)
    setIsManagerofUsers(false)
    setRolesLoaded(false)

    try {
      if (typeof BroadcastChannel !== "undefined") {
        const ch = new BroadcastChannel("lucid:auth-sync");
        ch.postMessage({
          type: "LUCID_SESSION_LOGOUT",
          payload: { reason: reason || "manual" },
        });
        ch.close();
      }
    } catch {}
  }

  const refreshProfile = async () => {
    if (user?.email) {
      sharedDataClient.invalidateByPrefix("v1|auth")
      sharedDataClient.invalidateByPrefix("v1|users")
      
      const authUserLike = user as AuthUserLike
      const effectiveUser = authUserLike.email ? authUserLike : readManualAuthUser()
      
      if (effectiveUser && effectiveUser.email) {
        const profile = await loadCachedFullProfile(effectiveUser)
        
        if (profile !== undefined) {
          if (profile) {
            writeCachedProfile(profile)
            setEmployeeData(profile.employeeData)
            setUserId(profile.userId)
            setUserRoles(profile.userRoles)
            setIsAdmin(profile.isAdmin)
            setIsSuperAdmin(profile.isSuperAdmin)
            setIsDeveloper(Boolean(profile.isDeveloper))
            setIsManager(Boolean(profile.isManager))
            setIsManagerofUsers(Boolean(profile.isManagerofUsers))
            if (profile.tenant) setInitialTenantData(profile.tenant)
            if (profile.notifications) setInitialNotificationsData(profile.notifications)
            setRolesLoaded(true)
          } else {
            setEmployeeData(null)
            setUserId(null)
            setUserRoles([])
            setIsAdmin(false)
            setIsSuperAdmin(false)
            setIsDeveloper(false)
            setIsManager(false)
            setIsManagerofUsers(false)
            setRolesLoaded(false)
          }
        }
      }
    }
  }

  return (
    <AuthContext.Provider 
      value={{ 
        user, 
        loading, 
        rolesLoaded,
        userRoles, 
        isAdmin, 
        isSuperAdmin,
        isDeveloper,
        isManager,
        isManagerofUsers,
        userId, 
        employeeData, 
        initialTenantData,
        initialNotificationsData,
        login, 
        logout,
        refreshProfile
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
