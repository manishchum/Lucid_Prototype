"use client"

import type React from "react"
import { createContext, useContext, useEffect, useRef, useState } from "react"
import { type User, onAuthStateChanged, signOut } from "firebase/auth"
import { auth } from "@/lib/firebase"
import { createCacheKey, sharedDataClient } from "@/lib/data-client"
import { fetchWithAuth, getFirebaseIdToken } from "@/lib/fetch-with-auth"

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

const loadCachedFullProfile = async (authUser: AuthUserLike) => {
  if (!authUser?.email) return null

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
        const empData = await fetchUserByEmail(authUser.email)
        // console.log(
        //   "EMPLOYEE DATA",
        //   empData
        // )

        // console.log(
        //   "USER ID",
        //   empData?.user_id
        // )
        if (!empData) return null

        const resolvedUserId = (empData.user_id || '').toString().trim()
        if (!resolvedUserId || resolvedUserId === 'undefined' || resolvedUserId === 'null') {
          return null
        }

        const rolesData = await fetchUserRoles(resolvedUserId)
        
        // Fetch actual manager status from backend (has direct reports)
        let isActualManager = rolesData.isManager
        try {
          const managerStatusRes = await fetchWithAuth(`${API_BASE}/api/voice-transcripts/check-manager-status`, {
            headers: { 'X-User-ID': resolvedUserId }
          })
          if (managerStatusRes.ok) {
            const statusData = await managerStatusRes.json()
            isActualManager = Boolean(statusData.is_manager || rolesData.isManager)
            console.log('[auth-context] Manager status check:', { statusData, isActualManager, userId: resolvedUserId })
          }
        } catch (err) {
          console.warn('[auth-context] Failed to fetch actual manager status, falling back to role-based check', err)
          // Fall back to role-based check if endpoint fails
          isActualManager = rolesData.isManager
        }

        return {
          employeeData: empData,
          userId: resolvedUserId,
          userRoles: rolesData.roles,
          isAdmin: rolesData.isAdmin,
          isSuperAdmin: rolesData.isSuperAdmin,
          isDeveloper: rolesData.isDeveloper,
          isManager: rolesData.isManager,
          isManagerofUsers: isActualManager
        }
      },
      {
        ttlMs: 60 * 60 * 1000,
        swr: true,
        swrMs: 5 * 60 * 1000
      }
    )

    return result.data
  } catch (error) {
    console.error("[auth-context] Profile fetch failed:", error)
    return undefined // Use undefined to explicitly indicate a failure/error (vs null = not found)
  }
}

const readManualAuthUser = (): AuthUserLike | null => {
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(MANUAL_AUTH_STORAGE_KEY)
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
    window.sessionStorage.setItem(MANUAL_AUTH_STORAGE_KEY, JSON.stringify(user))
  } catch {
    // no-op
  }
}

const clearManualAuthUser = (): void => {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.removeItem(MANUAL_AUTH_STORAGE_KEY)
    window.sessionStorage.removeItem(MANUAL_PROFILE_STORAGE_KEY)
  } catch {
    // no-op
  }
}

const writeCachedProfile = (profile: any): void => {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.setItem(MANUAL_PROFILE_STORAGE_KEY, JSON.stringify(profile))
  } catch {
    // no-op
  }
}

const readCachedProfile = (): any | null => {
  if (typeof window === "undefined") return null
  try {
    const raw = window.sessionStorage.getItem(MANUAL_PROFILE_STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
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
    if (typeof window === "undefined") return

    if (!user?.uid || !API_BASE) {
      if (authSocketSingleton) {
        try {
          authSocketSingleton.close()
        } catch {
          // no-op
        }
      }
      authSocketSingleton = null
      authSocketCurrentUserId = null
      return
    }

    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const connectAuthSocket = async () => {
      try {
        const token = await getFirebaseIdToken()
        if (!token || authSocketCurrentUserId === user.uid) return

        const deviceId = localStorage.getItem("device_id") || (() => {
          const generatedId = crypto.randomUUID()
          localStorage.setItem("device_id", generatedId)
          return generatedId
        })()

        const wsBase = API_BASE
        if (authSocketSingleton && authSocketSingleton.readyState === WebSocket.OPEN) {
          if (authSocketCurrentUserId === user.uid) {
            return
          }
          try {
            authSocketSingleton.close()
          } catch {
            // no-op
          }
        }

        const socket = new WebSocket(
          `${wsBase}/api/auth/ws?token=${encodeURIComponent(token)}&device_id=${encodeURIComponent(deviceId)}`
        )

        authSocketSingleton = socket
        authSocketCurrentUserId = user.uid

        socket.onmessage = (event) => {
          try {
            const payload = JSON.parse(event.data)
            if (payload?.type === "force_logout" || payload?.type === "session_replaced") {
              window.dispatchEvent(new Event("lucid:auth:force-logout"))
            }
          } catch {
            // ignore malformed payloads
          }
        }

        socket.onclose = () => {
          if (auth.currentUser) {
            reconnectTimer = setTimeout(connectAuthSocket, 3000)
          } else if (authSocketSingleton === socket) {
            authSocketSingleton = null
            authSocketCurrentUserId = null
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
      
      if (effectiveUser?.email) {
        setRolesLoaded(false)
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

        if (!firebaseUser) {
          writeManualAuthUser(effectiveUser)
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

    const forceLogoutListener = async () => {
      console.warn("[auth-context] Handling lucid:auth:force-logout event");
      await logout();
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
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
      // Set user data in state for email/password login
      // This simulates what Firebase does automatically for Google sign-in
      setUser(userData as User)
      await fetchWithAuth(
        `${API_BASE}/api/auth/session`,
        {
          method: "POST",
          registerSession: true as any,
        } as any
      );
      
      if (userData?.email && userData?.uid) {
        writeManualAuthUser({
          uid: userData.uid,
          email: userData.email,
          displayName: userData.displayName ?? userData.name ?? null,
          name: userData.name ?? userData.displayName ?? null,
        })

        const profile = await loadCachedFullProfile({
          uid: userData.uid,
          email: userData.email,
          displayName: userData.displayName ?? userData.name ?? null,
          name: userData.name ?? userData.displayName ?? null,
        })

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
