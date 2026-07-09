"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Building2, Check, ChevronRight, ShieldCheck, Sparkles, SlidersHorizontal, Wand2 } from "lucide-react"

import { useAuth } from "@/contexts/auth-context"
import { useTenant } from "@/contexts/tenant-context"
import { fetchWithAuth } from "@/lib/fetch-with-auth"
import { ALL_LANGUAGES, getCompanyEnabledLanguages, groupLanguages, type Language } from '@/lib/languages'
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL

type SubscriptionTier = "tier_1" | "tier_2" | "tier_3"
type AddonKey =
  | "lucid_studio"
  | "lucid_studio_textual"
  | "lucid_studio_podcast"
  | "lucid_studio_video"
  | "lucid_studio_mindmap"
  | "lucid_studio_infographic"
  | "lucid_studio_flashcard"
  | "chat_in_studio"
  | "task_management"
  | "kpi"
  | "role_play"

type CompanyRecord = {
  company_id: string
  name?: string
  domain?: string
  company_logo?: string
  subscription_tier?: SubscriptionTier | string | null
  subscription_addons?: string[] | null
}

type FeatureDefinition = {
  id: AddonKey
  label: string
  description: string
  category: "core" | "addon"
  parentId?: AddonKey
}

const FEATURE_DEFINITIONS: FeatureDefinition[] = [
  {
    id: "lucid_studio",
    label: "Lucid Studio",
    description: "Unlock the main Lucid Studio workspace.",
    category: "core",
  },
  {
    id: "lucid_studio_textual",
    label: "Textual",
    description: "Enable text-based Lucid Studio generation and insights.",
    category: "core",
    parentId: "lucid_studio",
  },
  {
    id: "lucid_studio_podcast",
    label: "Podcast",
    description: "Enable Lucid Studio audio/podcast generation.",
    category: "core",
    parentId: "lucid_studio",
  },
  {
    id: "lucid_studio_video",
    label: "Video",
    description: "Enable Lucid Studio video generation.",
    category: "core",
    parentId: "lucid_studio",
  },
  {
    id: "lucid_studio_mindmap",
    label: "Mindmap",
    description: "Enable Lucid Studio mindmap generation.",
    category: "core",
    parentId: "lucid_studio",
  },
  {
    id: "lucid_studio_infographic",
    label: "Infographic",
    description: "Enable Lucid Studio infographic generation.",
    category: "core",
    parentId: "lucid_studio",
  },
  {
    id: "lucid_studio_flashcard",
    label: "Flashcard",
    description: "Enable lucid studio flashcard generation.",
    category: "core",
    parentId: "lucid_studio",
  },
  {
    id: "chat_in_studio",
    label: "Chat in Studio",
    description: "Enable in-studio chat for guided conversations.",
    category: "core",
  },
  {
    id: "task_management",
    label: "Task Management",
    description: "Expose task planning and management tools.",
    category: "core",
  },
  {
    id: "kpi",
    label: "KPI",
    description: "Enable KPI intelligence and score tracking.",
    category: "addon",
  },
  {
    id: "role_play",
    label: "Role Play",
    description: "Enable AI role-play practice sessions.",
    category: "addon",
  },
]

const FEATURE_LABELS: Record<AddonKey, string> = FEATURE_DEFINITIONS.reduce((acc, feature) => {
  acc[feature.id] = feature.label
  return acc
}, {} as Record<AddonKey, string>)

const VALID_ADDON_KEYS = new Set<AddonKey>(FEATURE_DEFINITIONS.map((feature) => feature.id))

const LUCID_STUDIO_CHILDREN: AddonKey[] = [
  "lucid_studio_textual",
  "lucid_studio_podcast",
  "lucid_studio_video",
  "lucid_studio_mindmap",
  "lucid_studio_infographic",
  "lucid_studio_flashcard",
]

function normalizeAddonKey(value: string): AddonKey | null {
  const normalized = String(value || "").trim().toLowerCase().replace(/[-\s]+/g, "_")
  return VALID_ADDON_KEYS.has(normalized as AddonKey) ? (normalized as AddonKey) : null
}

function normalizeAddons(values?: string[] | string | null): AddonKey[] {
  const rawValues = Array.isArray(values)
    ? values
    : typeof values === "string"
      ? (() => {
          try {
            const parsed = JSON.parse(values)
            return Array.isArray(parsed) ? parsed : String(values).split(",")
          } catch {
            return String(values).split(",")
          }
        })()
      : []

  return Array.from(
    new Set(
      rawValues
        .map((value) => normalizeAddonKey(String(value)))
        .filter((value): value is AddonKey => Boolean(value))
    )
  )
}

// Extract language codes from subscription_addons
function extractLanguageCodes(values?: string[] | string | null): string[] {
  const rawValues = Array.isArray(values)
    ? values
    : typeof values === "string"
      ? (() => {
          try {
            const parsed = JSON.parse(values)
            return Array.isArray(parsed) ? parsed : String(values).split(",")
          } catch {
            return String(values).split(",")
          }
        })()
      : []

  const validLangCodes = new Set(ALL_LANGUAGES.map((l) => l.code))
  return Array.from(
    new Set(
      rawValues
        .map((value) => String(value || "").trim().toLowerCase())
        .filter((value) => validLangCodes.has(value))
    )
  )
}

function getEffectiveAddons(company?: CompanyRecord | null): AddonKey[] {
  if (!company) return ["lucid_studio", "lucid_studio_textual"]

  const effectiveAddons = new Set(normalizeAddons(company.subscription_addons))

  // Default Lucid Studio and Textual to enabled on the company access page
  effectiveAddons.add("lucid_studio")
  effectiveAddons.add("lucid_studio_textual")

  const hasLucidChild = [
    "lucid_studio_textual",
    "lucid_studio_podcast",
    "lucid_studio_video",
    "lucid_studio_mindmap",
    "lucid_studio_infographic",
    "lucid_studio_flashcard",
  ].some((child) => effectiveAddons.has(child as AddonKey))

  if (hasLucidChild) {
    effectiveAddons.add("lucid_studio")
  }

  return Array.from(effectiveAddons)
}

function deriveFrontendTier(addons: AddonKey[]): SubscriptionTier | null {
  const current = new Set(addons)
  if (current.has("task_management")) return "tier_3"
  if (current.has("chat_in_studio")) return "tier_2"
  if (current.has("lucid_studio")) return "tier_1"
  return null
}

function isLucidStudioEnabled(addons: AddonKey[]) {
  const current = new Set(addons)
  return current.has("lucid_studio")
}

export default function CompanyAccessPage() {
  const router = useRouter()
  const { user, loading: authLoading, isDeveloper, userId } = useAuth()
  const { availableCompanies, loadingCompanies, isDeveloperMode, activeCompanyId, setActiveCompanyId } = useTenant()

  const [companies, setCompanies] = useState<CompanyRecord[]>([])
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("")
  const [draftAddons, setDraftAddons] = useState<AddonKey[]>([])
  const [draftLanguages, setDraftLanguages] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [searchTerm, setSearchTerm] = useState("")
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")

  useEffect(() => {
    if (!authLoading && (!user || !isDeveloper)) {
      router.replace("/admin/dashboard/analytics")
    }
  }, [authLoading, user, isDeveloper, router])

  useEffect(() => {
    setCompanies((availableCompanies as CompanyRecord[]).map((company) => {
      const rawAddons = Array.isArray(company.subscription_addons) ? company.subscription_addons : []
      return {
        ...company,
        subscription_addons: normalizeAddons(rawAddons),
        enabled_languages: extractLanguageCodes(rawAddons),
      }
    }))
  }, [availableCompanies])

  useEffect(() => {
    if (!companies.length) return

    const preferredId =
      (activeCompanyId && companies.some((company) => company.company_id === activeCompanyId) && activeCompanyId) ||
      companies[0]?.company_id ||
      ""

    if (preferredId && preferredId !== selectedCompanyId) {
      setSelectedCompanyId(preferredId)
      return
    }
  }, [companies, selectedCompanyId, activeCompanyId])

  const selectedCompany = useMemo(
    () => companies.find((company) => company.company_id === selectedCompanyId) || null,
    [companies, selectedCompanyId]
  )

  useEffect(() => {
    if (!selectedCompany) return
    setDraftAddons(getEffectiveAddons(selectedCompany))
    // Extract language codes directly from subscription_addons
    const langs = extractLanguageCodes(selectedCompany.subscription_addons)
    setDraftLanguages(langs)
  }, [selectedCompany])

  const filteredCompanies = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    if (!term) return companies
    return companies.filter((company) => {
      return [company.name, company.domain, company.company_id].some((value) =>
        String(value || "").toLowerCase().includes(term)
      )
    })
  }, [companies, searchTerm])

  const selectedFeatures = useMemo(
    () => FEATURE_DEFINITIONS.filter((feature) => draftAddons.includes(feature.id)),
    [draftAddons]
  )

  const frontendTierLabel = useMemo(() => deriveFrontendTier(draftAddons), [draftAddons])

  const handleToggleAddon = (addon: AddonKey, enabled: boolean) => {
    setDraftAddons((current) => {
      const next = new Set(current)

      if (enabled) {
        next.add(addon)
        if (LUCID_STUDIO_CHILDREN.includes(addon)) {
          next.add("lucid_studio")
        }
      } else {
        next.delete(addon)
        if (addon === "lucid_studio") {
          LUCID_STUDIO_CHILDREN.forEach((child) => next.delete(child))
        }
      }

      return Array.from(next)
    })
  }
  console.log("Draft Addons:", draftAddons);

  console.log(
    JSON.stringify({
      subscription_addons: draftAddons,
    })
  );

  const handleSave = async () => {
    if (!selectedCompanyId || !userId) return

    setSaving(true)
    setError("")
    setSuccess("")

    try {
      const res = await fetchWithAuth(`${API_BASE}/api/companies/${encodeURIComponent(selectedCompanyId)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-User-ID": userId,
        },
        body: JSON.stringify({
          subscription_addons: Array.from(
            new Set([
              ...draftAddons,
              "lucid_studio",
              "lucid_studio_textual",
              // append selected language codes so backend stores them in same column
              ...draftLanguages,
            ])
          ),
        }),
      })

      const payload = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(payload?.detail || payload?.error || "Failed to save company access")
      }

      const updatedCompany = Array.isArray(payload?.data)
        ? payload.data[0]
        : payload?.data || payload?.company || null

      if (updatedCompany?.company_id) {
        // Extract addons and languages separately from raw subscription_addons
        const allItems = Array.isArray(updatedCompany.subscription_addons) ? updatedCompany.subscription_addons : []
        const normalizedAddons = normalizeAddons(allItems)
        const savedLangs = extractLanguageCodes(allItems)
        
        setCompanies((current) =>
          current.map((company) =>
            company.company_id === updatedCompany.company_id
              ? {
                  ...company,
                  ...updatedCompany,
                  subscription_addons: normalizeAddons(allItems), // normalized addons only for logic
                  enabled_languages: savedLangs, // preserve languages separately
                }
              : company
          )
        )
        setDraftLanguages(savedLangs)
      }

      setSuccess("Company access saved successfully.")
    } catch (err: any) {
      setError(err?.message || "Failed to save company access")
    } finally {
      setSaving(false)
    }
  }

  if (authLoading || loadingCompanies) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.15),_transparent_35%),radial-gradient(circle_at_bottom_right,_rgba(15,23,42,0.12),_transparent_30%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)] flex items-center justify-center px-4">
        <Card className="w-full max-w-lg border-slate-200 shadow-xl">
          <CardContent className="p-8 text-center space-y-4">
            <div className="mx-auto h-14 w-14 rounded-2xl bg-slate-900 text-white flex items-center justify-center">
              <Building2 className="h-7 w-7" />
            </div>
            <div>
              <p className="text-lg font-semibold text-slate-900">Loading company access console</p>
              <p className="text-sm text-slate-500">Preparing developer tools and company list.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!isDeveloper || !isDeveloperMode) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center px-4">
        <Card className="w-full max-w-lg border-slate-200 shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-slate-900">
              <ShieldCheck className="h-5 w-5 text-slate-700" />
              Developer access only
            </CardTitle>
            <CardDescription>This page is restricted to the developer role.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.replace("/admin/dashboard/analytics")} className="w-full">
              Go to analytics
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(56,189,248,0.18),_transparent_28%),radial-gradient(circle_at_top_right,_rgba(15,23,42,0.12),_transparent_25%),linear-gradient(180deg,_#f8fafc_0%,_#eef2ff_100%)]">
      <div className="mx-auto max-w-7xl px-4 py-6 md:px-6 lg:px-8">
        <div className="mb-6 overflow-hidden rounded-3xl border border-slate-200 bg-white/85 shadow-xl backdrop-blur">
          <div className="flex flex-col gap-4 p-6 md:p-8 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl space-y-3">
              <Badge variant="outline" className="border-slate-200 bg-slate-50 text-slate-700">
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                Developer console
              </Badge>
              <div>
                <h1 className="text-3xl font-black tracking-tight text-slate-950 md:text-4xl">
                  Company access plans
                </h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600 md:text-base">
                  Toggle each feature independently. Tiers are now a frontend-only summary derived from the selected features.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              {FEATURE_DEFINITIONS.map((feature) => (
                <div
                  key={feature.id}
                  className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700"
                >
                  {feature.label}
                </div>
              ))}
            </div>
          </div>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {success && (
          <Alert className="mb-4 border-emerald-200 bg-emerald-50 text-emerald-900">
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          <Card className="border-slate-200 shadow-lg">
            <CardHeader className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-slate-950">Companies</CardTitle>
                  <CardDescription>Select a company to configure access.</CardDescription>
                </div>
                <Badge variant="outline">{filteredCompanies.length}</Badge>
              </div>

              <div className="space-y-2">
                <Label htmlFor="company-search" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Search
                </Label>
                <Input
                  id="company-search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="Search by company name or domain"
                  className="bg-white"
                />
              </div>
            </CardHeader>

            <CardContent className="space-y-3">
              {filteredCompanies.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
                  No companies match your search.
                </div>
              ) : (
                filteredCompanies.map((company) => {
                  const addons = getEffectiveAddons(company)
                  const selected = company.company_id === selectedCompanyId

                  return (
                    <button
                      key={company.company_id}
                      type="button"
                      onClick={() => {
                        setActiveCompanyId(company.company_id)
                        setSelectedCompanyId(company.company_id)
                      }}
                      className={`w-full rounded-2xl border px-4 py-4 text-left transition-all ${
                        selected
                          ? "border-slate-950 bg-slate-950 text-white shadow-lg"
                          : "border-slate-200 bg-white hover:border-slate-400 hover:bg-slate-50"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Building2 className={`h-4 w-4 ${selected ? "text-white" : "text-slate-500"}`} />
                            <p className="truncate font-semibold">{company.name || company.company_id}</p>
                          </div>
                          <p className={`mt-1 truncate text-xs ${selected ? "text-slate-300" : "text-slate-500"}`}>
                            {company.domain || company.company_id}
                          </p>
                        </div>
                        <ChevronRight className={`h-4 w-4 ${selected ? "text-white" : "text-slate-400"}`} />
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2">
                        <Badge variant={selected ? "secondary" : "outline"} className={selected ? "text-slate-900" : ""}>
                          {addons.length}/{FEATURE_DEFINITIONS.length} features
                        </Badge>
                      </div>
                    </button>
                  )
                })
              )}
            </CardContent>
          </Card>            

          <Card className="border-slate-200 shadow-lg">
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-slate-950">
                    {selectedCompany?.name || "Select a company"}
                  </CardTitle>
                  <CardDescription>
                    {selectedCompany?.domain || selectedCompany?.company_id || "Choose a company from the list"}
                  </CardDescription>
                </div>
                <Badge variant="outline" className="border-slate-300">
                  <SlidersHorizontal className="mr-1.5 h-3.5 w-3.5" />
                  Addon-driven access
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                {FEATURE_DEFINITIONS.map((feature) => {
                  const checked = draftAddons.includes(feature.id)
                  const isLucidChild = feature.parentId === "lucid_studio"
                  const parentEnabled = draftAddons.includes("lucid_studio")

                  if (isLucidChild && !parentEnabled) {
                    return null
                  }

                  const isMandatory =
                    feature.id === "lucid_studio" ||
                    feature.id === "lucid_studio_textual";

                  return (
                    <div
                      key={feature.id}
                      className={`rounded-3xl border p-5 transition-all ${
                        checked ? "border-slate-950 bg-slate-950 text-white" : "border-slate-200 bg-white"
                      } ${isLucidChild ? "ml-8 md:ml-0" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <Wand2 className={`h-4 w-4 ${checked ? "text-cyan-300" : "text-slate-500"}`} />
                            <p className="font-semibold">{feature.label}</p>
                            <Badge
                              variant="outline"
                              className={`ml-1 border-transparent text-[10px] uppercase tracking-wide ${
                                checked ? "bg-white/10 text-slate-200" : "bg-slate-100 text-slate-500"
                              }`}
                            >
                              {feature.category}
                            </Badge>
                          </div>
                          <p className={`mt-1 text-sm ${checked ? "text-slate-300" : "text-slate-500"}`}>
                            {feature.description}
                          </p>
                        </div>
                        <Switch
                          checked={checked}
                          onCheckedChange={(value) => {
                            if (!isMandatory) {
                              handleToggleAddon(feature.id, Boolean(value))
                            }
                          }}
                          disabled={isMandatory || (isLucidChild && !parentEnabled)}
                        />
                      </div>
                      {isLucidChild && !parentEnabled && (
                        <p className="mt-2 text-xs text-slate-500">Enable Lucid Studio to unlock this feature.</p>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-4">
                <p className="font-semibold text-slate-900">Allowed Languages for Lucid Studio</p>
                <p className="text-sm text-slate-500">Select which languages this company can generate audio/video/translations in.</p>
                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(() => {
                    const grouped = groupLanguages(ALL_LANGUAGES);
                    return (
                      <>
                        <div>
                          <div className="text-xs font-semibold text-slate-500 mb-2">International</div>
                          <div className="grid grid-cols-2 gap-2">
                            {grouped.international.map((lang) => (
                              <label key={lang.code} className="inline-flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={draftLanguages.includes(lang.code)}
                                  onChange={(e) => {
                                    setDraftLanguages((cur) => {
                                      const next = new Set(cur);
                                      if (e.target.checked) next.add(lang.code);
                                      else next.delete(lang.code);
                                      return Array.from(next);
                                    });
                                  }}
                                />
                                <span className="text-slate-700">{lang.name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="text-xs font-semibold text-slate-500 mb-2">Indian Languages</div>
                          <div className="grid grid-cols-2 gap-2">
                            {grouped.indian.map((lang) => (
                              <label key={lang.code} className="inline-flex items-center gap-2 text-sm">
                                <input
                                  type="checkbox"
                                  checked={draftLanguages.includes(lang.code)}
                                  onChange={(e) => {
                                    setDraftLanguages((cur) => {
                                      const next = new Set(cur);
                                      if (e.target.checked) next.add(lang.code);
                                      else next.delete(lang.code);
                                      return Array.from(next);
                                    });
                                  }}
                                />
                                <span className="text-slate-700">{lang.name}</span>
                              </label>
                            ))}
                          </div>
                        </div>
                      </>
                    )
                  })()}
                </div>
              </div>

              <Separator />

              <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-slate-900">Frontend tier preview</p>
                    <p className="text-sm text-slate-500">This is only for display. Save actions write add-ons only.</p>
                  </div>
                  {/* <Badge variant="outline">
                    {frontendTierLabel ? frontendTierLabel.toUpperCase() : "CUSTOM"}
                  </Badge> */}
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {selectedFeatures.length === 0 ? (
                    <Badge variant="outline">No features selected</Badge>
                  ) : (
                    selectedFeatures.map((feature) => (
                      <Badge key={feature.id} variant="secondary" className="bg-white text-slate-800">
                        <Check className="mr-1 h-3.5 w-3.5" />
                        {FEATURE_LABELS[feature.id]}
                      </Badge>
                    ))
                  )}
                </div>
              </div>

              <div className="sticky bottom-0 flex flex-col gap-3 rounded-3xl border border-slate-200 bg-white/95 p-4 shadow-lg backdrop-blur sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-slate-500">
                  Changes are saved to the selected company record.
                </div>
                <div className="flex gap-3">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      if (!selectedCompany) return
                      setDraftAddons(getEffectiveAddons(selectedCompany))
                      setDraftLanguages(extractLanguageCodes(selectedCompany.subscription_addons))
                    }}
                    disabled={!selectedCompany || saving}
                    className="shrink-0"
                  >
                    Reset
                  </Button>
                   
                  <Button
                    type="button"
                    
                    onClick={handleSave}
                    disabled={!selectedCompanyId || saving}
                    className="shrink-0 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? "Saving..." : "Save Access"}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
