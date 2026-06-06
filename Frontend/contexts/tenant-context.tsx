"use client"

import type React from "react"
import { createContext, useContext, useEffect, useMemo, useState } from "react"
import { useAuth } from "@/contexts/auth-context"
import { sharedDataClient } from "@/lib/data-client"
import { fetchWithAuth } from "@/lib/fetch-with-auth"

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL

type Company = {
  company_id: string
  name?: string
  domain?: string
  company_logo?: string
}

type TenantContextType = {
  activeCompanyId: string | null
  activeCompany: Company | null
  availableCompanies: Company[]
  loadingCompanies: boolean
  isDeveloperMode: boolean
  setActiveCompanyId: (companyId: string) => void
}

const TenantContext = createContext<TenantContextType>({
  activeCompanyId: null,
  activeCompany: null,
  availableCompanies: [],
  loadingCompanies: false,
  isDeveloperMode: false,
  setActiveCompanyId: () => {},
})

export const useTenant = () => {
  const context = useContext(TenantContext)
  if (!context) {
    throw new Error("useTenant must be used within a TenantProvider")
  }
  return context
}

const normalizeRole = (value: string) => value.toLowerCase().replace(/[-_\s]/g, "")

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const { userId, employeeData, userRoles, loading: authLoading, isDeveloper } = useAuth()
  const [activeCompanyId, setActiveCompanyIdState] = useState<string | null>(null)
  const [availableCompanies, setAvailableCompanies] = useState<Company[]>([])
  const [loadingCompanies, setLoadingCompanies] = useState(false)

  const isDeveloperMode = useMemo(() => {
    if (isDeveloper) return true
    return userRoles.some((r) => normalizeRole(r) === "developer")
  }, [isDeveloper, userRoles])

  const storageKey = useMemo(() => {
    return userId ? `lucid:active-company:${userId}` : null
  }, [userId])

  useEffect(() => {
    let ignore = false

    const initializeTenant = async () => {
      if (authLoading) return

      if (!userId || !employeeData?.company_id) {
        setAvailableCompanies([])
        setActiveCompanyIdState(null)
        return
      }

      const fallbackCompany: Company = {
        company_id: String(employeeData.company_id),
        name: employeeData.company_name || "My Company",
        company_logo: employeeData.company_logo || undefined,
      }

      if (!isDeveloperMode) {
        setAvailableCompanies([fallbackCompany])
        setActiveCompanyIdState(fallbackCompany.company_id)
        return
      }

      setLoadingCompanies(true)
      try {
        const res = await fetchWithAuth(`${API_BASE}/api/companies`)
        const payload = res.ok ? await res.json() : null
        const companiesList = payload?.data?.companies || payload?.companies || []
        const companies = companiesList.filter((c: Company) => c?.company_id)
        const resolvedCompanies: Company[] = companies.length > 0 ? companies : [fallbackCompany]

        if (ignore) return

        setAvailableCompanies(resolvedCompanies)

        const persisted = storageKey && typeof window !== "undefined"
          ? window.localStorage.getItem(storageKey)
          : null

        const persistedExists = persisted && resolvedCompanies.some((c) => c.company_id === persisted)
        const nextCompanyId = persistedExists
          ? persisted
          : resolvedCompanies[0]?.company_id || fallbackCompany.company_id

        setActiveCompanyIdState(nextCompanyId)
      } catch {
        if (!ignore) {
          setAvailableCompanies([fallbackCompany])
          setActiveCompanyIdState(fallbackCompany.company_id)
        }
      } finally {
        if (!ignore) setLoadingCompanies(false)
      }
    }

    initializeTenant()

    return () => {
      ignore = true
    }
  }, [authLoading, userId, employeeData?.company_id, isDeveloperMode, storageKey])

  useEffect(() => {
    if (!storageKey || !activeCompanyId || !isDeveloperMode || typeof window === "undefined") {
      return
    }
    window.localStorage.setItem(storageKey, activeCompanyId)
  }, [activeCompanyId, storageKey, isDeveloperMode])

  useEffect(() => {
    if (typeof window === "undefined") return

    const originalFetch = window.fetch.bind(window)

    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      if (!isDeveloperMode || !activeCompanyId) {
        return originalFetch(input, init)
      }

      const headers = new Headers(
        init?.headers || (input instanceof Request ? input.headers : undefined)
      )

      if (!headers.has("X-Company-ID")) {
        headers.set("X-Company-ID", activeCompanyId)
      }

      return originalFetch(input, { ...init, headers })
    }

    return () => {
      window.fetch = originalFetch
    }
  }, [isDeveloperMode, activeCompanyId])

  const setActiveCompanyId = (companyId: string) => {
    if (!companyId) return
    if (!isDeveloperMode) return
    if (!availableCompanies.some((c) => c.company_id === companyId)) return

    setActiveCompanyIdState((prev) => {
      if (prev === companyId) return prev
      sharedDataClient.clear()
      return companyId
    })
  }

  const activeCompany = useMemo(() => {
    if (!activeCompanyId) return null
    return availableCompanies.find((c) => c.company_id === activeCompanyId) || null
  }, [activeCompanyId, availableCompanies])

  return (
    <TenantContext.Provider
      value={{
        activeCompanyId,
        activeCompany,
        availableCompanies,
        loadingCompanies,
        isDeveloperMode,
        setActiveCompanyId,
      }}
    >
      {children}
    </TenantContext.Provider>
  )
}
