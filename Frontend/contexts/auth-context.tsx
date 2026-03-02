"use client"

import type React from "react"
import { createContext, useContext, useEffect, useState } from "react"
import { type User, onAuthStateChanged, signOut } from "firebase/auth"
import { auth } from "@/lib/firebase"

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL

interface AuthContextType {
  user: User | null
  loading: boolean
  userRoles: string[]
  isAdmin: boolean
  userId: string | null
  employeeData: any | null
  login: (userData: any) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  userRoles: [],
  isAdmin: false,
  userId: null,
  employeeData: null,
  login: async () => {},
  logout: async () => {},
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

    return { roles: roleNames, isAdmin: hasAdminRole }
  } catch (e) {
    console.error('[auth-context] Error fetching user roles:', e)
    return { roles: [], isAdmin: false }
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [userRoles, setUserRoles] = useState<string[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [userId, setUserId] = useState<string | null>(null)
  const [employeeData, setEmployeeData] = useState<any | null>(null)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setUser(user)
      
      if (user?.email) {
        // Fetch employee data and roles once
        const empData = await fetchUserByEmail(user.email)
        if (empData) {
          setEmployeeData(empData)
          setUserId(empData.user_id)
          
          // Fetch roles for this user
          const { roles, isAdmin: adminStatus } = await fetchUserRoles(empData.user_id)
          setUserRoles(roles)
          setIsAdmin(adminStatus)
        }
      } else {
        // Reset all data on logout
        setEmployeeData(null)
        setUserId(null)
        setUserRoles([])
        setIsAdmin(false)
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
      setUser(userData)
      
      if (userData?.email) {
        const empData = await fetchUserByEmail(userData.email)
        if (empData) {
          setEmployeeData(empData)
          setUserId(empData.user_id)
          
          const { roles, isAdmin: adminStatus } = await fetchUserRoles(empData.user_id)
          setUserRoles(roles)
          setIsAdmin(adminStatus)
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
    setUser(null)
    setEmployeeData(null)
    setUserId(null)
    setUserRoles([])
    setIsAdmin(false)
  }

  return (
    <AuthContext.Provider 
      value={{ 
        user, 
        loading, 
        userRoles, 
        isAdmin, 
        userId, 
        employeeData, 
        login, 
        logout 
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
