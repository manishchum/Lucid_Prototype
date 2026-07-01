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
  subscription_tier?: string
  subscription_addons?: string[]
}

export type Tier = 'tier_1' | 'tier_2' | 'tier_3'
export type Addon =
  | 'lucid_studio'
  | 'chat_in_studio'
  | 'task_management'
  | 'kpi'
  | 'role_play'

// Feature constants - single source of truth for feature names
export const FEATURES = {
  LUCID_STUDIO: "lucidStudio",
  CHAT_IN_STUDIO: "chatInStudio",
  TASK_MANAGEMENT: "taskManagement",
  KPI: "kpi",
  ROLE_PLAY: "rolePlay",
} as const

export type FeatureName = typeof FEATURES[keyof typeof FEATURES]

// Feature to requirement mapping
const FEATURE_CONFIG: Record<FeatureName, { requiredAddons?: Addon[] }> = {
  [FEATURES.LUCID_STUDIO]: { requiredAddons: ["lucid_studio"] },
  [FEATURES.CHAT_IN_STUDIO]: { requiredAddons: ["chat_in_studio"] },
  [FEATURES.TASK_MANAGEMENT]: { requiredAddons: ["task_management"] },
  [FEATURES.KPI]: { requiredAddons: ["kpi"] },
  [FEATURES.ROLE_PLAY]: { requiredAddons: ["role_play"] },
}

// Tier hierarchy - which tiers can ACCESS each tier level
// To access tier_1 features: anyone (tier_1, tier_2, tier_3)
// To access tier_2 features: only tier_2 and tier_3
// To access tier_3 features: only tier_3
const TIER_ACCESS: Record<Tier, Tier[]> = {
  tier_1: ["tier_1", "tier_2", "tier_3"],  // All tiers can access tier_1
  tier_2: ["tier_2", "tier_3"],             // Only tier_2+ can access tier_2
  tier_3: ["tier_3"],                       // Only tier_3 can access tier_3
}

interface FeatureConfig {
  requiredTier?: Tier
  requiredAddons?: Addon[]
  requiresAnyAddon?: boolean
}

type TenantContextType = {
  activeCompanyId: string | null
  activeCompany: Company | null
  availableCompanies: Company[]
  loadingCompanies: boolean
  isDeveloperMode: boolean
  setActiveCompanyId: (companyId: string) => void
  // Feature gating methods
  getAvailableTier: () => Tier | null
  getAvailableAddons: () => Addon[]
  isFeatureAvailable: (config: FeatureConfig) => boolean
  hasFeature: (featureName: FeatureName | string) => boolean
}

const TenantContext = createContext<TenantContextType>({
  activeCompanyId: null,
  activeCompany: null,
  availableCompanies: [],
  loadingCompanies: false,
  isDeveloperMode: false,
  setActiveCompanyId: () => {},
  getAvailableTier: () => null,
  getAvailableAddons: () => [],
  isFeatureAvailable: () => false,
  hasFeature: () => false,
})

export const useTenant = () => {
  const context = useContext(TenantContext)
  if (!context) {
    throw new Error("useTenant must be used within a TenantProvider")
  }
  return context
}

const normalizeRole = (value: string) => value.toLowerCase().replace(/[-_\s]/g, "")
const normalizeAddonKey = (value: string) => String(value || "").trim().toLowerCase().replace(/[-\s]+/g, "_")

const isAddon = (value: string): value is Addon => {
  return [
    "lucid_studio",
    "chat_in_studio",
    "task_management",
    "kpi",
    "role_play",
  ].includes(value)
}

const deriveFrontendTier = (addons: Addon[]): Tier | null => {
  const current = new Set(addons)
  if (current.has("task_management")) return "tier_3"
  if (current.has("chat_in_studio")) return "tier_2"
  if (current.has("lucid_studio")) return "tier_1"
  return null
}

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
        subscription_tier: employeeData.subscription_tier || undefined,
        subscription_addons: Array.isArray(employeeData.subscription_addons)
          ? employeeData.subscription_addons
          : undefined,
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
        // console.log(payload)
        const companies = (payload?.companies || payload?.data?.companies || []).filter((c: Company) => c?.company_id)
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

  // Feature gating helpers
  const getAvailableTier = () => {
    const derivedTier = deriveFrontendTier(getAvailableAddons())
    return derivedTier
  }

  const getAvailableAddons = () => {
    const subscriptionAddons = (activeCompany?.subscription_addons || [])
      .map((addon) => normalizeAddonKey(String(addon)))
      .filter((addon): addon is Addon => isAddon(addon))
    return Array.from(new Set(subscriptionAddons))
  }

  const isFeatureAvailable = (config: FeatureConfig) => {
    const currentTier = getAvailableTier()
    const currentAddons = getAvailableAddons()

    // Check tier requirement
    if (config.requiredTier) {
      if (!currentTier) return false
      const accessibleTiers = TIER_ACCESS[config.requiredTier]
      if (!accessibleTiers.includes(currentTier)) return false
    }

    // Check addon requirement
    if (config.requiredAddons && config.requiredAddons.length > 0) {
      if (config.requiresAnyAddon) {
        // Requires at least one of the specified addons
        return config.requiredAddons.some((addon) => currentAddons.includes(addon))
      } else {
        // Requires all specified addons
        return config.requiredAddons.every((addon) => currentAddons.includes(addon))
      }
    }

    return true
  }

  const hasFeature = (featureName: FeatureName | string) => {
    const config = FEATURE_CONFIG[featureName as FeatureName]
    if (!config) {
      console.warn(`Unknown feature: ${featureName}`)
      return false
    }
    return isFeatureAvailable(config)
  }

  return (
    <TenantContext.Provider
      value={{
        activeCompanyId,
        activeCompany,
        availableCompanies,
        loadingCompanies,
        isDeveloperMode,
        setActiveCompanyId,
        getAvailableTier,
        getAvailableAddons,
        isFeatureAvailable,
        hasFeature,
      }}
    >
      {children}
    </TenantContext.Provider>
  )
}
