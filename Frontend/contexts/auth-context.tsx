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
  login: (userData: any) => Promise<void>
  logout: () => Promise<void>
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

const loadCachedFullProfile = async (authUser: AuthUserLike, throwOnError = false) => {
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
        const res = await fetchWithAuth(`${API_BASE}/api/auth/me`)
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

const readManualAuthUser = (): AuthUserLike | null => {
  if (typeof window === "undefined") return null
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

const writeManualAuthUser = (user: AuthUserLike): void => {
  if (typeof window === "undefined") return
  try {
    const val = JSON.stringify(user)
    window.sessionStorage.setItem(MANUAL_AUTH_STORAGE_KEY, val)
    window.localStorage.setItem(MANUAL_AUTH_STORAGE_KEY, val)
  } catch {
    // no-op
  }
}

const clearManualAuthUser = (): void => {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.removeItem(MANUAL_AUTH_STORAGE_KEY)
    window.sessionStorage.removeItem(MANUAL_PROFILE_STORAGE_KEY)
    window.localStorage.removeItem(MANUAL_AUTH_STORAGE_KEY)
    window.localStorage.removeItem(MANUAL_PROFILE_STORAGE_KEY)
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
  try {
    const raw = window.sessionStorage.getItem(MANUAL_PROFILE_STORAGE_KEY) ||
                window.localStorage.getItem(MANUAL_PROFILE_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

let hasRegisteredSessionForUser: string | null = null

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
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
      const effectiveUser = firebaseUser ?? readManualAuthUser()
      setUser((effectiveUser as User) || null)

      const pathname =
        typeof window !== "undefined"
          ? window.location.pathname
          : "";

      const isAuthPage =
        pathname === "/login" ||
        pathname === "/signup" ||
        pathname === "/forgot-password";

      if (effectiveUser?.email) {
        if (!isAuthPage) {
          setRolesLoaded(false)
          if (hasRegisteredSessionForUser !== effectiveUser.uid) {
            try {
              await fetchWithAuth(`${API_BASE}/api/auth/session`, {
                method: "POST",
                registerSession: true as any,
              } as any);
              hasRegisteredSessionForUser = effectiveUser.uid;
            } catch (err) {
              console.error("[auth-context] Failed to register session:", err);
            }
          } 
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
      console.info("[auth-context] Graceful session revocation in progress", event);

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
      if (typeof window !== 'undefined') {
        try {
          window.sessionStorage.setItem("lucid:displaced-session", "1");
        } catch {}
      }

      // Run background signOut without blocking redirect
      try {
        signOut(auth).catch(() => {});
      } catch {}

      if (typeof window !== 'undefined') {
        window.location.replace('/login');
      }
    };
    
    if (typeof window !== 'undefined') {
      window.addEventListener('lucid:auth:force-logout', forceLogoutListener);
    }

    return () => {
      unsubscribe();
      if (typeof window !== 'undefined') {
        window.removeEventListener('lucid:auth:force-logout', forceLogoutListener);
      }
    };
  }, [])

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

        writeManualAuthUser(authUserObj)
        hasRegisteredSessionForUser = authUserObj.uid

        // Invalidate stale cache for fresh login validation
        sharedDataClient.invalidateByPrefix("v1|auth")
        if (typeof window !== "undefined") {
          window.sessionStorage.removeItem(MANUAL_PROFILE_STORAGE_KEY)
          window.localStorage.removeItem(MANUAL_PROFILE_STORAGE_KEY)
        }

        // 1. Authoritatively register session FIRST (ensures Redis is updated with new device ID before profile fetch)
        const sessionRes = await fetchWithAuth(
          `${API_BASE}/api/auth/session`,
          {
            method: "POST",
            registerSession: true as any,
          } as any
        );

        if (!sessionRes.ok) {
          console.warn("[auth-context] Session registration non-200:", sessionRes.status);
        }

        // 2. Fetch full profile (device session is now guaranteed to match registered device ID)
        const profile = await loadCachedFullProfile(authUserObj, true);

        if (!sessionRes.ok) {
          console.warn("[auth-context] Session registration non-200:", sessionRes.status);
        }

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
          throw new Error("Access denied. Your email is not in the allowed users list.")
        }
      }

      setLoading(false)
    } catch (error) {
      console.error("Login failed:", error)
      throw error
    }
  }

  const logout = async () => {
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
    await signOut(auth)
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
        login, 
        logout,
        refreshProfile
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
