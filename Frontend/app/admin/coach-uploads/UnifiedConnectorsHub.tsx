"use client"

import React, { useState, useEffect, useCallback } from "react"
import { fetchWithAuth } from "@/lib/fetch-with-auth"
import {
  FolderSync,
  FolderTree,
  ExternalLink,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  X,
  ChevronRight,
  Search,
  HardDrive,
  Folder,
  Radio,
  Check,
  ShieldCheck,
  MessageSquare,
  Video,
  Mail,
  Users
} from "lucide-react"

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"

export interface ConnectorInfo {
  provider: string
  display_name: string
  connected: boolean
  status: string
  account_identifier?: string | null
  monitored_source_id?: string | null
  monitored_source_name?: string | null
  monitored_source_path?: string | null
  monitored_source_type?: string | null
  is_recursive?: boolean
  webhook_active?: boolean
  last_synced_at?: string | null
  total_synced_files?: number
  error_message?: string | null
  connected_at?: string | null
}

export interface ContainerItemData {
  id: string
  name: string
  container_type: string
  parent_id?: string | null
  path: string
  drive_id?: string | null
  has_children?: boolean
  can_select?: boolean
  metadata?: Record<string, any>
}

interface UnifiedConnectorsHubProps {
  onIngestionTriggered?: () => void
  onErrorToast?: (msg: string) => void
  onSuccessToast?: (msg: string) => void
}

export function UnifiedConnectorsHub({
  onIngestionTriggered,
  onErrorToast,
  onSuccessToast
}: UnifiedConnectorsHubProps) {
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [activeProvider, setActiveProvider] = useState<string>("google_drive")
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})

  // Universal Container Picker State
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerLoading, setPickerLoading] = useState(false)
  const [containers, setContainers] = useState<ContainerItemData[]>([])
  const [selectedContainer, setSelectedContainer] = useState<ContainerItemData | null>(null)
  const [pickerSearch, setPickerSearch] = useState("")
  const [savingSelection, setSavingSelection] = useState(false)
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ id: string | null; name: string; drive_id?: string | null }>>([])

  // 1. Fetch All Connectors Status
  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetchWithAuth(`${API_BASE}/api/connectors/status`)
      if (res.ok) {
        const data = await res.json()
        setConnectors(data.connectors || [])
      }
    } catch (err) {
      console.warn("[UnifiedConnectorsHub] Failed to fetch statuses:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  // Listen for OAuth Popups postMessage
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === "CONNECTOR_OAUTH_SUCCESS") {
        if (onSuccessToast) onSuccessToast(`Successfully connected to ${e.data.provider}!`)
        fetchStatus()
        if (onIngestionTriggered) onIngestionTriggered()
      } else if (e.data?.type === "CONNECTOR_OAUTH_ERROR") {
        if (onErrorToast) onErrorToast(`Authentication failed: ${e.data.error || "Unknown error"}`)
      }
    }
    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [fetchStatus, onSuccessToast, onErrorToast, onIngestionTriggered])

  const activeConnector = connectors.find(c => c.provider === activeProvider) || {
    provider: activeProvider,
    display_name: activeProvider,
    connected: false,
    status: "disconnected"
  }

  // Handle Connect
  const handleConnect = async (provider: string) => {
    try {
      setActionLoading(prev => ({ ...prev, [provider]: true }))
      const res = await fetchWithAuth(`${API_BASE}/api/connectors/${provider}/auth-url`)
      if (res.ok) {
        const data = await res.json()
        if (data.auth_url) {
          const width = 600
          const height = 740
          const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2)
          const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2)
          const popup = window.open(
            data.auth_url,
            `${provider}OAuthPopup`,
            `width=${width},height=${height},left=${left},top=${top},status=no,toolbar=no,menubar=no,location=yes,resizable=yes,scrollbars=yes`
          )
          if (!popup || popup.closed || typeof popup.closed === "undefined") {
            window.location.href = data.auth_url
          } else {
            popup.focus()
          }
        }
      } else {
        const err = await res.json()
        if (onErrorToast) onErrorToast(err.detail || `Failed to initiate ${provider} connection.`)
      }
    } catch (err: any) {
      if (onErrorToast) onErrorToast(err.message || "Failed to initiate connection.")
    } finally {
      setActionLoading(prev => ({ ...prev, [provider]: false }))
    }
  }

  // Handle Sync Now
  const handleSyncNow = async (provider: string) => {
    try {
      setActionLoading(prev => ({ ...prev, [provider]: true }))
      const res = await fetchWithAuth(`${API_BASE}/api/connectors/${provider}/sync-now`, {
        method: "POST"
      })
      if (res.ok) {
        const data = await res.json()
        if (onSuccessToast) onSuccessToast(data.message || `Synchronized ${activeConnector.display_name} successfully!`)
        fetchStatus()
        if (onIngestionTriggered) onIngestionTriggered()
      } else {
        const err = await res.json()
        if (onErrorToast) onErrorToast(err.detail || "Sync failed.")
      }
    } catch (err: any) {
      if (onErrorToast) onErrorToast(err.message || "Sync failed.")
    } finally {
      setActionLoading(prev => ({ ...prev, [provider]: false }))
    }
  }

  // Handle Disconnect
  const handleDisconnect = async (provider: string) => {
    if (!confirm(`Are you sure you want to disconnect ${activeConnector.display_name}? Live ingestion will stop.`)) {
      return
    }
    try {
      setActionLoading(prev => ({ ...prev, [provider]: true }))
      const res = await fetchWithAuth(`${API_BASE}/api/connectors/${provider}/disconnect`, {
        method: "POST"
      })
      if (res.ok) {
        if (onSuccessToast) onSuccessToast(`Disconnected ${activeConnector.display_name}.`)
        fetchStatus()
      }
    } catch (err: any) {
      if (onErrorToast) onErrorToast(err.message || "Disconnect failed.")
    } finally {
      setActionLoading(prev => ({ ...prev, [provider]: false }))
    }
  }

  // Open Container Picker
  const handleOpenPicker = async (provider: string) => {
    setPickerOpen(true)
    setSelectedContainer(null)
    setPickerSearch("")
    setBreadcrumbs([{ id: null, name: activeConnector.display_name }])
    await fetchContainers(provider, null, null)
  }

  const fetchContainers = async (provider: string, parentId: string | null = null, driveId: string | null = null) => {
    try {
      setPickerLoading(true)
      let url = `${API_BASE}/api/connectors/${provider}/containers`
      const params = new URLSearchParams()
      if (parentId) params.append("parent_id", parentId)
      if (driveId) params.append("drive_id", driveId)
      if (params.toString()) url += `?${params.toString()}`

      const res = await fetchWithAuth(url)
      if (res.ok) {
        const data = await res.json()
        setContainers(data.containers || [])
      }
    } catch (err) {
      console.error("[UnifiedConnectorsHub] Failed to fetch containers:", err)
    } finally {
      setPickerLoading(false)
    }
  }

  const handleSelectContainer = async () => {
    if (!selectedContainer) return
    try {
      setSavingSelection(true)
      const res = await fetchWithAuth(`${API_BASE}/api/connectors/${activeProvider}/select-container`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          container_id: selectedContainer.id,
          container_name: selectedContainer.name,
          container_path: selectedContainer.path,
          container_type: selectedContainer.container_type,
          drive_id: selectedContainer.drive_id
        })
      })
      if (res.ok) {
        if (onSuccessToast) onSuccessToast(`Now monitoring "${selectedContainer.name}". Ingestion started!`)
        setPickerOpen(false)
        fetchStatus()
        if (onIngestionTriggered) onIngestionTriggered()
      } else {
        const err = await res.json()
        if (onErrorToast) onErrorToast(err.detail || "Failed to set monitored source.")
      }
    } catch (err: any) {
      if (onErrorToast) onErrorToast(err.message || "Error saving selection.")
    } finally {
      setSavingSelection(false)
    }
  }

  // Icons Helper
  const getProviderIcon = (provider: string) => {
    switch (provider) {
      case "google_drive":
        return (
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
            <path d="M8.2 2L15.8 2L23.4 15L15.8 15L8.2 2Z" fill="#FFC107" />
            <path d="M0.6 15L8.2 2L12 8.5L4.4 21.5L0.6 15Z" fill="#0066DA" />
            <path d="M4.4 21.5L12 8.5L19.6 21.5L4.4 21.5Z" fill="#00AC47" />
            <path d="M12 8.5L15.8 15L23.4 15L19.6 21.5L12 8.5Z" fill="#2684FC" />
          </svg>
        )
      case "onedrive":
        return (
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
            <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96z" fill="#0078D4" />
          </svg>
        )
      case "teams":
        return (
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
            <path d="M19.5 7.5a2.5 2.5 0 1 0-5 0 2.5 2.5 0 0 0 5 0z" fill="#5059C9" />
            <path d="M12 11.5v9h8.5a1.5 1.5 0 0 0 1.5-1.5v-6a1.5 1.5 0 0 0-1.5-1.5H12z" fill="#5059C9" />
            <path d="M8.5 4.5a3.5 3.5 0 1 0-7 0 3.5 3.5 0 0 0 7 0z" fill="#7B83EB" />
            <path d="M1 9.5a1.5 1.5 0 0 0-1 1.5v8a1.5 1.5 0 0 0 1.5 1.5H10v-11H1z" fill="#7B83EB" />
          </svg>
        )
      case "slack":
        return (
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
            <path d="M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zm1.271 0a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313z" fill="#E01E5A" />
            <path d="M8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52h-2.521zm0 1.271a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312z" fill="#36C5F0" />
            <path d="M18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zm-1.27 0a2.528 2.528 0 0 1-2.522 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.164 0a2.528 2.528 0 0 1 2.522 2.522v6.312z" fill="#2EB67D" />
            <path d="M15.164 18.956a2.528 2.528 0 0 1 2.522 2.522A2.528 2.528 0 0 1 15.164 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zm0-1.27a2.528 2.528 0 0 1-2.52-2.522 2.528 2.528 0 0 1 2.52-2.522h6.314A2.528 2.528 0 0 1 24 15.164a2.528 2.528 0 0 1-2.522 2.522h-6.314z" fill="#ECB22E" />
          </svg>
        )
      case "zoom":
        return (
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
            <rect width="24" height="24" rx="5" fill="#2D8CFF" />
            <path d="M5 8.5C5 7.67 5.67 7 6.5 7h7c.83 0 1.5.67 1.5 1.5v7c0 .83-.67 1.5-1.5 1.5h-7A1.5 1.5 0 0 1 5 15.5v-7zm11 1.75l3-2.25v8l-3-2.25v-3.5z" fill="#fff" />
          </svg>
        )
      case "google_meet":
        return (
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
            <path d="M12 7v10l6.5-5L12 7z" fill="#00832D" />
            <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h6.5v14H5.5A2.5 2.5 0 0 1 3 16.5v-9z" fill="#00AC47" />
            <path d="M18.5 7.5v9l4.5 3.5V4L18.5 7.5z" fill="#2684FC" />
          </svg>
        )
      case "gmail":
        return (
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
            <path d="M22 6.5l-10 7-10-7V5l10 7 10-7v1.5z" fill="#EA4335" />
            <path d="M22 6.5L12 13.5 2 6.5V19h20V6.5z" fill="#FBBC04" />
            <path d="M22 6.5L12 13.5 2 6.5V5h20v1.5z" fill="#EA4335" />
            <path d="M2 19V6.5l10 7V19H2z" fill="#4285F4" />
            <path d="M22 19V6.5l-10 7V19h10z" fill="#34A853" />
          </svg>
        )
      default:
        return <FolderSync className="w-5 h-5 text-indigo-600" />
    }
  }

  const formatSyncDate = (isoString?: string | null) => {
    if (!isoString) return "Pending initial scan"
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return "Pending initial scan"
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    })
  }

  return (
    <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm overflow-hidden">
      {/* Provider Selector Tabs */}
      <div className="px-6 pt-5 pb-3 border-b border-slate-100 flex items-center gap-2 overflow-x-auto scrollbar-none bg-slate-50/50">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400 mr-2 flex-shrink-0">
          Cloud Connectors:
        </span>
        {connectors.map(conn => {
          const isActive = conn.provider === activeProvider
          return (
            <button
              key={conn.provider}
              onClick={() => setActiveProvider(conn.provider)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition flex-shrink-0 ${
                isActive
                  ? "bg-white text-slate-900 shadow-sm border border-slate-200"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/70"
              }`}
            >
              {getProviderIcon(conn.provider)}
              <span>{conn.display_name}</span>
              {conn.connected ? (
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" title="Connected" />
              ) : (
                <span className="w-2 h-2 rounded-full bg-slate-300" title="Not connected" />
              )}
            </button>
          )
        })}
      </div>

      {/* Active Connector Detail Panel */}
      <div className="p-6 md:p-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="flex items-start gap-4">
            <div className="w-14 h-14 rounded-2xl bg-slate-50 border border-slate-200/70 flex items-center justify-center flex-shrink-0 shadow-xs">
              {getProviderIcon(activeConnector.provider)}
            </div>

            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-lg font-bold text-slate-900">
                  {activeConnector.display_name} Ingestion Engine
                </h2>
                {activeConnector.connected ? (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    Live Sync Active
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                    Disconnected
                  </span>
                )}
              </div>

              <p className="text-xs text-slate-500 mt-1 max-w-xl">
                {activeConnector.connected
                  ? `Documents and updates from ${activeConnector.display_name} are converted and indexed into vector proof chunks automatically.`
                  : `Connect ${activeConnector.display_name} to continuously auto-ingest documents, discussion digests, and meeting transcripts.`}
              </p>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2.5 flex-wrap self-start md:self-auto">
            {loading ? (
              <div className="text-xs text-slate-400 flex items-center gap-2">
                <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                Checking status...
              </div>
            ) : activeConnector.connected ? (
              <>
                <button
                  onClick={() => handleOpenPicker(activeConnector.provider)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:text-indigo-600 hover:border-indigo-200 transition shadow-xs"
                >
                  <FolderTree className="w-3.5 h-3.5 text-indigo-600" />
                  Configure Source
                </button>

                <button
                  onClick={() => handleSyncNow(activeConnector.provider)}
                  disabled={actionLoading[activeConnector.provider]}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-xl hover:bg-indigo-100 transition shadow-xs disabled:opacity-50"
                >
                  <FolderSync className={`w-3.5 h-3.5 ${actionLoading[activeConnector.provider] ? "animate-spin text-indigo-600" : ""}`} />
                  {actionLoading[activeConnector.provider] ? "Syncing..." : "Sync Now"}
                </button>

                <button
                  onClick={() => handleDisconnect(activeConnector.provider)}
                  disabled={actionLoading[activeConnector.provider]}
                  className="text-xs text-rose-500 hover:text-rose-700 font-medium px-2 py-1.5 rounded-lg hover:bg-rose-50 transition"
                >
                  Disconnect
                </button>
              </>
            ) : (
              <button
                onClick={() => handleConnect(activeConnector.provider)}
                disabled={actionLoading[activeConnector.provider]}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md transition disabled:opacity-50"
              >
                {getProviderIcon(activeConnector.provider)}
                <span>Connect {activeConnector.display_name}</span>
              </button>
            )}
          </div>
        </div>

        {/* Live Metrics Strip when connected */}
        {activeConnector.connected && (
          <div className="mt-6 pt-5 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
            <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-200/60">
              <span className="text-slate-400 block font-medium">Identity</span>
              <span className="text-slate-900 font-semibold truncate block mt-0.5" title={activeConnector.account_identifier || ""}>
                {activeConnector.account_identifier || "Authenticated"}
              </span>
            </div>

            <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-200/60">
              <span className="text-slate-400 block font-medium">Monitored Source</span>
              <span className="text-slate-900 font-semibold truncate block mt-0.5">
                {activeConnector.monitored_source_name || "Root Workspace"}
              </span>
            </div>

            <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-200/60">
              <span className="text-slate-400 block font-medium">Total Ingested</span>
              <span className="text-indigo-600 font-semibold block mt-0.5">
                {activeConnector.total_synced_files ?? 0} files / transcripts
              </span>
            </div>

            <div className="bg-slate-50/80 p-3 rounded-xl border border-slate-200/60">
              <span className="text-slate-400 block font-medium">Last Synced</span>
              <span className="text-slate-700 font-semibold block mt-0.5">
                {formatSyncDate(activeConnector.last_synced_at)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Universal Container / Channel / Label Picker Modal */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden">
            {/* Header */}
            <div className="p-6 border-b border-slate-100 flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center flex-shrink-0">
                  <FolderTree className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Select {activeConnector.display_name} Source
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Choose a folder, channel, or label to continuously ingest and vectorize into Coach.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setPickerOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Search */}
            <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search sources..."
                value={pickerSearch}
                onChange={e => setPickerSearch(e.target.value)}
                className="w-full bg-transparent text-xs text-slate-800 placeholder-slate-400 focus:outline-none"
              />
            </div>

            {/* List */}
            <div className="p-4 overflow-y-auto max-h-96 space-y-1.5">
              {pickerLoading ? (
                <div className="p-8 text-center text-slate-400 text-xs">
                  <RefreshCw className="w-5 h-5 mx-auto animate-spin mb-2 text-indigo-600" />
                  Loading containers...
                </div>
              ) : containers.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs">
                  No containers found for this provider.
                </div>
              ) : (
                containers
                  .filter(c => !pickerSearch || c.name.toLowerCase().includes(pickerSearch.toLowerCase()))
                  .map(c => {
                    const isSelected = selectedContainer?.id === c.id
                    return (
                      <div
                        key={c.id}
                        onClick={() => setSelectedContainer(c)}
                        className={`flex items-center justify-between p-3 rounded-xl cursor-pointer text-xs transition border ${
                          isSelected
                            ? "bg-indigo-50/80 border-indigo-200 text-indigo-900"
                            : "hover:bg-slate-50 border-transparent text-slate-700"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 truncate">
                          <Folder className={`w-4 h-4 ${isSelected ? "text-indigo-600" : "text-slate-400"}`} />
                          <span className="font-medium truncate">{c.name}</span>
                          <span className="text-[10px] uppercase font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                            {c.container_type}
                          </span>
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-indigo-600 flex-shrink-0" />}
                      </div>
                    )
                  })
              )}
            </div>

            {/* Footer */}
            <div className="p-4 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
              <span className="text-xs text-slate-500">
                {selectedContainer ? `Selected: ${selectedContainer.name}` : "Please select a container"}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setPickerOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-200/60 rounded-xl transition"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSelectContainer}
                  disabled={!selectedContainer || savingSelection}
                  className="px-4 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition disabled:opacity-50"
                >
                  {savingSelection ? "Saving..." : "Start Monitoring"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

