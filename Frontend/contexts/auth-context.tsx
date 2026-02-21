"use client"

import type React from "react"
import { createContext, useContext, useEffect, useState } from "react"
import { type User, onAuthStateChanged, signOut } from "firebase/auth"
import { auth } from "@/lib/firebase"

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

interface AuthContextType {
  user: User | null
  internalUser: any | null
  isAdmin: boolean
  loading: boolean
  login: (userData: any) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  internalUser: null,
  isAdmin: false,
  loading: true,
  login: async () => { },
  logout: async () => { },
})

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider")
  }
  return context
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [internalUser, setInternalUser] = useState<any | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [loading, setLoading] = useState(true)

  const fetchInternalProfile = async (email: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/users/by-email/${encodeURIComponent(email)}`);
      if (!res.ok) return null;
      const payload = await res.json();
      let u = payload?.user ?? payload;
      if (Array.isArray(u)) u = u[0];
      if (!u) return null;

      setInternalUser(u);

      // Fetch roles
      try {
        const rolesRes = await fetch(`${API_BASE}/api/roles/users/${u.user_id}`, {
          headers: { 'X-User-ID': u.user_id }
        });

        if (rolesRes.ok) {
          const rolesPayload = await rolesRes.json().catch(() => null);
          const assignments = rolesPayload?.assignments ?? rolesPayload?.data ?? rolesPayload ?? [];
          const normalizedRoles = (assignments || []).map((ra: any) => {
            const r = ra.role ?? ra.roles ?? ra;
            return {
              name: (r?.name ?? '').toString(),
              level: Number(r?.level ?? -1),
              id: r?.role_id ?? r?.id ?? null
            };
          }).filter((r: any) => r.name || r.level >= 0);

          const hasAdmin = normalizedRoles.some((r: any) => {
            const name = (r.name || '').toLowerCase().replace(/[-_\s]/g, '');
            return r.level >= 3 || ['admin', 'superadmin', 'super_admin', 'ceo'].includes(name);
          });
          setIsAdmin(hasAdmin);
        }
      } catch (e) {
        console.error('[AuthProvider] Error fetching roles:', e);
      }

      return u;
    } catch (e) {
      console.error('[AuthProvider] Error fetching profile:', e);
      return null;
    }
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser)
      if (firebaseUser?.email) {
        await fetchInternalProfile(firebaseUser.email);
      } else {
        setInternalUser(null);
        setIsAdmin(false);
      }
      setLoading(false)
    })

    return unsubscribe
  }, [])

  // Login function for email/password authentication
  const login = async (userData: any) => {
    try {
      setUser(userData)
      if (userData?.email) {
        await fetchInternalProfile(userData.email);
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
    setInternalUser(null)
    setIsAdmin(false)
  }

  return (
    <AuthContext.Provider value={{ user, internalUser, isAdmin, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

