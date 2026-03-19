"use client"

import type React from "react"
import { createContext, useContext, useEffect, useState } from "react"
import { type User, onAuthStateChanged, signOut } from "firebase/auth"
import { auth } from "@/lib/firebase"
import { createCacheKey, sharedDataClient } from "@/lib/data-client"

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL
const MANUAL_AUTH_STORAGE_KEY = "lucid:manual-auth-user"

type AuthUserLike = {
  uid: string
  email?: string | null
  displayName?: string | null
  name?: string | null
}

interface AuthContextType {
  user: User | null
  loading: boolean
  userRoles: string[]
  isAdmin: boolean
  isSuperAdmin: boolean
  userId: string | null
  employeeData: any | null
  login: (userData: any) => Promise<void>
  logout: () => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  userRoles: [],
  isAdmin: false,
  isSuperAdmin: false,
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
  try {
    const res = await fetch(`${API_BASE}/api/users/by-email/${encodeURIComponent(email)}`)
    if (!res.ok) {
      console.error('[auth-context] Failed to fetch user by email:', res.status)
      return null
    }
    const payload = await res.json()
    let u = payload?.user ?? payload
    if (Array.isArray(u)) u = u[0]
    return u || null
  } catch (e) {
    console.error('[auth-context] Error fetching user:', e)
    return null
  }
}

const fetchUserRoles = async (userId: string) => {
  try {
    const rolesRes = await fetch(`${API_BASE}/api/roles/users/${userId}`, {
      headers: { 'X-User-ID': userId }
    })

    if (!rolesRes.ok) {
      console.error('[auth-context] Failed to fetch user roles:', rolesRes.status)
      return { roles: [], isAdmin: false }
    }

    const payload = await rolesRes.json().catch(() => null)
    const assignments = payload?.assignments ?? payload?.data ?? payload ?? []

    // normalize and extract role objects
    const normalizedRoles = (assignments || []).map((ra: any) => {
      const r = ra.role ?? ra.roles ?? ra
      return {
        name: (r?.name ?? '').toString(),
        level: Number(r?.level ?? -1),
        id: r?.role_id ?? r?.id ?? null
      }
    }).filter((r: any) => r.name || r.level >= 0)

    const roleNames = normalizedRoles.map((r: any) => r.name)

    // admin detection: role.level >= 3 OR known admin names
    const hasAdminRole = normalizedRoles.some((r: any) => {
      const name = (r.name || '').toLowerCase().replace(/[-_\s]/g, '')
      return r.level >= 3 || ['admin','superadmin','super_admin','ceo'].includes(name)
    })

    // super_admin detection: role.level >= 4 OR known super_admin names
    const hasSuperAdminRole = normalizedRoles.some((r: any) => {
      const name = (r.name || '').toLowerCase().replace(/[-_\s]/g, '')
      return r.level >= 4 || ['superadmin','super_admin','ceo'].includes(name)
    })

    return { roles: roleNames, isAdmin: hasAdminRole, isSuperAdmin: hasSuperAdminRole }
  } catch (e) {
    console.error('[auth-context] Error fetching user roles:', e)
    return { roles: [], isAdmin: false }
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

  const result = await sharedDataClient.query(
    key,
    async () => {
      const empData = await fetchUserByEmail(authUser.email)
      if (!empData) return null

      const rolesData = await fetchUserRoles(empData.user_id)

      return {
        employeeData: empData,
        userId: empData.user_id,
        userRoles: rolesData.roles,
        isAdmin: rolesData.isAdmin,
        isSuperAdmin: rolesData.isSuperAdmin
      }
    },
    {
      ttlMs: 2 * 60 * 1000,
      swr: true,
      swrMs: 5 * 60 * 1000
    }
  )

  return result.data
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
  } catch {
    // no-op
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [userRoles, setUserRoles] = useState<string[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [isSuperAdmin, setIsSuperAdmin] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [employeeData, setEmployeeData] = useState<any | null>(null)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      const effectiveUser = firebaseUser ?? readManualAuthUser()
      setUser((effectiveUser as User) || null)
      
      if (effectiveUser?.email) {
        const profile = await loadCachedFullProfile(effectiveUser)

        if (profile) {
          setEmployeeData(profile.employeeData)
          setUserId(profile.userId)
          setUserRoles(profile.userRoles)
          setIsAdmin(profile.isAdmin)
          setIsSuperAdmin(profile.isSuperAdmin)
        } else {
          setEmployeeData(null)
          setUserId(null)
          setUserRoles([])
          setIsAdmin(false)
          setIsSuperAdmin(false)
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
      }
      
      setLoading(false)
    })

    return unsubscribe
  }, [])

  // Login function for email/password authentication
  const login = async (userData: any) => {
    try {
      // Set user data in state for email/password login
      // This simulates what Firebase does automatically for Google sign-in
      setUser(userData as User)
      
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

        if (profile) {
          setEmployeeData(profile.employeeData)
          setUserId(profile.userId)
          setUserRoles(profile.userRoles)
          setIsAdmin(profile.isAdmin)
          setIsSuperAdmin(profile.isSuperAdmin)
        } else {
          setEmployeeData(null)
          setUserId(null)
          setUserRoles([])
          setIsAdmin(false)
          setIsSuperAdmin(false)
        }
      }
      
      setLoading(false)
    } catch (error) {
      console.error("Login failed:", error)
      throw error
    }
  }

  const logout = async () => {
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
  }

  const refreshProfile = async () => {
    if (user?.email) {
      sharedDataClient.invalidateByPrefix("v1|auth")
      sharedDataClient.invalidateByPrefix("v1|users")
      
      const authUserLike = user as AuthUserLike
      const effectiveUser = authUserLike.email ? authUserLike : readManualAuthUser()
      
      if (effectiveUser && effectiveUser.email) {
        const profile = await loadCachedFullProfile(effectiveUser)
        if (profile) {
          setEmployeeData(profile.employeeData)
          setUserId(profile.userId)
          setUserRoles(profile.userRoles)
          setIsAdmin(profile.isAdmin)
          setIsSuperAdmin(profile.isSuperAdmin)
        }
      }
    }
  }

  return (
    <AuthContext.Provider 
      value={{ 
        user, 
        loading, 
        userRoles, 
        isAdmin, 
        isSuperAdmin,
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
