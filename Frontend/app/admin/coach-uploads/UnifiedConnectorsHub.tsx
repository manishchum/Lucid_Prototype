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
  Users,
  Share2,
  Plus,
  Building2,
  UserCheck,
  ShieldAlert
} from "lucide-react"

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"

export interface ConnectorInfo {
  provider: string
  display_name: string
  integration_id?: string | null
  owner_user_id?: string | null
  connection_scope?: string
  assigned_team_id?: string | null
  visibility_mode?: string
  can_manage?: boolean
  is_owner?: boolean
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

interface ShareTargetOption {
  id: string
  name: string
  subject_type: "team" | "department" | "user"
  email?: string
}

interface SharedPermissionEntry {
  id: string
  subject_type: "team" | "department" | "user" | "company" | string
  subject_id: string
  subject_name: string
  subject_detail: string
  relation: string
  relation_label: string
  grant_source: string
  revocable: boolean
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
  isAdminOrAbove?: boolean
  onIngestionTriggered?: () => void
  onErrorToast?: (msg: string) => void
  onSuccessToast?: (msg: string) => void
}

export function UnifiedConnectorsHub({
  isAdminOrAbove = false,
  onIngestionTriggered,
  onErrorToast,
  onSuccessToast
}: UnifiedConnectorsHubProps) {
  const [connectors, setConnectors] = useState<ConnectorInfo[]>([])
  const [instances, setInstances] = useState<ConnectorInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [activeProvider, setActiveProvider] = useState<string>("google_drive")
  const [selectedIntegrationId, setSelectedIntegrationId] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({})

  // Connection Scope State
  const [connectScope, setConnectScope] = useState<"org" | "team" | "personal">(isAdminOrAbove ? "org" : "team")
  const [connectTeamId, setConnectTeamId] = useState<string>("")
  const [connectVisibility, setConnectVisibility] = useState<"acl_sync" | "team_only" | "company_wide">("acl_sync")

  // Teams / Users Share Targets & Active Permissions
  const [shareTargets, setShareTargets] = useState<ShareTargetOption[]>([])
  const [shareModalOpen, setShareModalOpen] = useState(false)
  const [shareSubjectKey, setShareSubjectKey] = useState("")
  const [shareRelation, setShareRelation] = useState<"viewer" | "deny_viewer">("viewer")
  const [savingShare, setSavingShare] = useState(false)
  const [containerPermissions, setContainerPermissions] = useState<SharedPermissionEntry[]>([])
  const [loadingPermissions, setLoadingPermissions] = useState(false)
  const [revokingPermissionKey, setRevokingPermissionKey] = useState<string | null>(null)

  // Universal Container Picker State
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerLoading, setPickerLoading] = useState(false)
  const [pickerProvider, setPickerProvider] = useState<string>("google_drive")
  const [pickerIntegrationId, setPickerIntegrationId] = useState<string | null>(null)
  const [containers, setContainers] = useState<ContainerItemData[]>([])
  const [selectedContainer, setSelectedContainer] = useState<ContainerItemData | null>(null)
  const [pickerSearch, setPickerSearch] = useState("")
  const [savingSelection, setSavingSelection] = useState(false)
  const [breadcrumbs, setBreadcrumbs] = useState<Array<{ id: string | null; name: string; drive_id?: string | null }>>([])

  useEffect(() => {
    setConnectScope(isAdminOrAbove ? "org" : "team")
  }, [isAdminOrAbove])

  // 1. Fetch All Connectors Status
  const fetchStatus = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetchWithAuth(`${API_BASE}/api/connectors/status`)
      if (res.ok) {
        const data = await res.json()
        setConnectors(data.connectors || [])
        setInstances(data.instances || [])
      }
    } catch (err) {
      console.warn("[UnifiedConnectorsHub] Failed to fetch statuses:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchShareTargets = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/rbac/teams`)
      if (res.ok) {
        const data = await res.json()
        const merged: ShareTargetOption[] = [
          ...(data.teams || []).map((t: any) => ({
            id: t.id,
            name: `${t.name} (${t.subject_type === "department" ? "Department" : "Team"})`,
            subject_type: t.subject_type,
          })),
          ...(data.users || []).map((u: any) => ({
            id: u.user_id,
            name: `${u.name || u.email} (User)`,
            email: u.email,
            subject_type: "user" as const,
          })),
        ]
        setShareTargets(merged)
      }
    } catch (err) {
      console.warn("[UnifiedConnectorsHub] Failed to fetch RBAC share targets:", err)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
    fetchShareTargets()
  }, [fetchStatus, fetchShareTargets])

  // Listen for OAuth Popups postMessage
  useEffect(() => {
    const handleMessage = (e: MessageEvent) => {
      if (e.data?.type === "CONNECTOR_OAUTH_SUCCESS") {
        const prov = e.data.provider || activeProvider
        const integId = e.data.integration_id || null
        if (e.data.provider) {
          setActionLoading(prev => ({ ...prev, [e.data.provider]: false }))
          setActiveProvider(e.data.provider)
        }
        if (integId) {
          setSelectedIntegrationId(integId)
        }
        fetchStatus()
        if (e.data.needs_source_selection) {
          if (onSuccessToast) {
            onSuccessToast(`Connected to ${prov}! Select the Drive or folder you want to sync.`)
          }
          handleOpenPicker(prov, integId)
        } else {
          if (onSuccessToast) onSuccessToast(`Successfully connected to ${prov}!`)
          if (onIngestionTriggered) onIngestionTriggered()
        }
      } else if (e.data?.type === "CONNECTOR_OAUTH_ERROR") {
        if (e.data.provider) {
          setActionLoading(prev => ({ ...prev, [e.data.provider]: false }))
        }
        if (e.data.cancelled) {
          console.log(`[UnifiedConnectorsHub] OAuth flow cancelled for ${e.data.provider}`)
        } else {
          if (onErrorToast) onErrorToast(`Authentication failed: ${e.data.error || "Unknown error"}`)
        }
      }
    }
    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [fetchStatus, onSuccessToast, onErrorToast, onIngestionTriggered])

  const formatProviderLabel = (provider: string) =>
    provider.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())

  const providerSummary: ConnectorInfo = connectors.find(c => c.provider === activeProvider) || {
    provider: activeProvider,
    display_name: formatProviderLabel(activeProvider),
    connected: false,
    status: "disconnected",
    can_manage: true,
  }
  const providerInstances = instances.filter(i => i.provider === activeProvider)
  const selectedInstance = selectedIntegrationId
    ? providerInstances.find(i => i.integration_id === selectedIntegrationId)
    : providerInstances[0]
  const activeConnector: ConnectorInfo = selectedInstance
    ? {
        ...selectedInstance,
        display_name:
          selectedInstance.display_name ||
          providerSummary.display_name ||
          formatProviderLabel(activeProvider),
      }
    : providerSummary
  const activeIntegrationId = activeConnector.integration_id || null
  const activeMonitoredSourceId = activeConnector.monitored_source_id || null
  const canManageActive = activeConnector.can_manage !== false

  const fetchContainerPermissions = useCallback(async (sourceId: string | null) => {
    if (!sourceId) {
      setContainerPermissions([])
      return
    }
    try {
      setLoadingPermissions(true)
      const res = await fetchWithAuth(
        `${API_BASE}/api/rbac/containers/${encodeURIComponent(sourceId)}/permissions`
      )
      if (res.ok) {
        const data = await res.json()
        setContainerPermissions(Array.isArray(data.permissions) ? data.permissions : [])
      } else {
        setContainerPermissions([])
      }
    } catch (err) {
      console.warn("[UnifiedConnectorsHub] Failed to fetch container permissions:", err)
    } finally {
      setLoadingPermissions(false)
    }
  }, [])

  useEffect(() => {
    fetchContainerPermissions(activeMonitoredSourceId)
  }, [activeMonitoredSourceId, fetchContainerPermissions])

  // Handle Connect
  const handleConnect = async (provider: string) => {
    try {
      setActionLoading(prev => ({ ...prev, [provider]: true }))
      const params = new URLSearchParams()
      params.append("connection_scope", isAdminOrAbove ? connectScope : (connectScope === "org" ? "team" : connectScope))
      params.append("visibility_mode", connectVisibility)
      if (connectScope === "team" && connectTeamId) {
        params.append("assigned_team_id", connectTeamId)
      }
      const res = await fetchWithAuth(`${API_BASE}/api/connectors/${provider}/auth-url?${params.toString()}`)
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
  const handleSyncNow = async (provider: string, integrationId?: string | null) => {
    try {
      setActionLoading(prev => ({ ...prev, [provider]: true }))
      const qs = integrationId ? `?integration_id=${encodeURIComponent(integrationId)}` : ""
      const res = await fetchWithAuth(`${API_BASE}/api/connectors/${provider}/sync-now${qs}`, {
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
  const handleDisconnect = async (provider: string, integrationId?: string | null) => {
    if (!confirm(`Are you sure you want to disconnect this ${activeConnector.display_name} instance? Live ingestion will stop.`)) {
      return
    }
    try {
      setActionLoading(prev => ({ ...prev, [provider]: true }))
      const qs = integrationId ? `?integration_id=${encodeURIComponent(integrationId)}` : ""
      const res = await fetchWithAuth(`${API_BASE}/api/connectors/${provider}/disconnect${qs}`, {
        method: "POST"
      })
      if (res.ok) {
        if (onSuccessToast) onSuccessToast(`Disconnected ${activeConnector.display_name}.`)
        setSelectedIntegrationId(null)
        fetchStatus()
      } else {
        const err = await res.json()
        if (onErrorToast) onErrorToast(err.detail || "Disconnect failed.")
      }
    } catch (err: any) {
      if (onErrorToast) onErrorToast(err.message || "Disconnect failed.")
    } finally {
      setActionLoading(prev => ({ ...prev, [provider]: false }))
    }
  }

  // Open Container Picker
  const handleOpenPicker = async (provider: string, integrationId?: string | null) => {
    const targetIntId = integrationId !== undefined ? integrationId : activeIntegrationId
    const displayLabel =
      connectors.find(c => c.provider === provider)?.display_name ||
      (provider === "google_drive" ? "Google Drive" : provider)
    setPickerProvider(provider)
    setPickerIntegrationId(targetIntId || null)
    setPickerOpen(true)
    setSelectedContainer(null)
    setPickerSearch("")
    setBreadcrumbs([{ id: null, name: displayLabel, drive_id: null }])
    await fetchContainers(provider, null, null, targetIntId || null)
  }

  const handleDrillIntoContainer = async (container: ContainerItemData) => {
    if (!container.has_children) return
    setSelectedContainer(null)
    setPickerSearch("")
    const nextDriveId = container.drive_id || (container.container_type === "shared_drive" ? container.id : null)
    setBreadcrumbs(prev => [...prev, { id: container.id, name: container.name, drive_id: nextDriveId }])
    await fetchContainers(pickerProvider, container.id, nextDriveId, pickerIntegrationId)
  }

  const handleBreadcrumbClick = async (idx: number) => {
    const target = breadcrumbs[idx]
    if (!target) return
    setSelectedContainer(null)
    setPickerSearch("")
    setBreadcrumbs(breadcrumbs.slice(0, idx + 1))
    await fetchContainers(pickerProvider, target.id, target.drive_id || null, pickerIntegrationId)
  }

  const fetchContainers = async (
    provider: string,
    parentId: string | null = null,
    driveId: string | null = null,
    integrationId: string | null = pickerIntegrationId || activeIntegrationId
  ) => {
    try {
      setPickerLoading(true)
      let url = `${API_BASE}/api/connectors/${provider}/containers`
      const params = new URLSearchParams()
      if (parentId) params.append("parent_id", parentId)
      if (driveId) params.append("drive_id", driveId)
      if (integrationId) params.append("integration_id", integrationId)
      if (params.toString()) url += `?${params.toString()}`

      const res = await fetchWithAuth(url)
      if (res.ok) {
        const data = await res.json()
        setContainers(data.containers || [])
      } else {
        const err = await res.json()
        if (onErrorToast) onErrorToast(err.detail || "Failed to load containers.")
      }
    } catch (err) {
      console.error("[UnifiedConnectorsHub] Failed to fetch containers:", err)
    } finally {
      setPickerLoading(false)
    }
  }

  const handleSelectContainer = async () => {
    if (!selectedContainer || selectedContainer.can_select === false) return
    const targetProvider = pickerProvider || activeProvider
    const targetIntId = pickerIntegrationId || activeIntegrationId
    try {
      setSavingSelection(true)
      const res = await fetchWithAuth(`${API_BASE}/api/connectors/${targetProvider}/select-container`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          integration_id: targetIntId,
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

  const handleGrantContainerShare = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeConnector.monitored_source_id || !shareSubjectKey) return
    const target = shareTargets.find(t => `${t.subject_type}:${t.id}` === shareSubjectKey)
    if (!target) return

    try {
      setSavingShare(true)
      const res = await fetchWithAuth(
        `${API_BASE}/api/rbac/containers/${encodeURIComponent(activeConnector.monitored_source_id)}/share`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            subject_type: target.subject_type,
            subject_id: target.id,
            relation: shareRelation,
          }),
        }
      )
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data.permissions)) {
          setContainerPermissions(data.permissions)
        } else {
          fetchContainerPermissions(activeConnector.monitored_source_id)
        }
        if (onSuccessToast) {
          onSuccessToast(
            `${shareRelation === "deny_viewer" ? "Applied deny override" : "Granted query access"} for ${target.name} on "${activeConnector.monitored_source_name || activeConnector.monitored_source_id}".`
          )
        }
        setShareSubjectKey("")
      } else {
        const err = await res.json()
        if (onErrorToast) onErrorToast(err.detail || "Failed to update container permissions.")
      }
    } catch (err: any) {
      if (onErrorToast) onErrorToast(err.message || "Error updating sharing permissions.")
    } finally {
      setSavingShare(false)
    }
  }

  const handleRevokeContainerShare = async (perm: SharedPermissionEntry) => {
    if (!activeConnector.monitored_source_id) return
    const rowKey = `${perm.subject_type}:${perm.subject_id}:${perm.relation}`
    try {
      setRevokingPermissionKey(rowKey)
      const params = new URLSearchParams({
        subject_type: perm.subject_type,
        subject_id: perm.subject_id,
        relation: perm.relation,
      })
      const res = await fetchWithAuth(
        `${API_BASE}/api/rbac/containers/${encodeURIComponent(activeConnector.monitored_source_id)}/share?${params.toString()}`,
        { method: "DELETE" }
      )
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data.permissions)) {
          setContainerPermissions(data.permissions)
        } else {
          setContainerPermissions(prev =>
            prev.filter(
              p => !(p.subject_type === perm.subject_type && p.subject_id === perm.subject_id && p.relation === perm.relation)
            )
          )
        }
        if (onSuccessToast) {
          onSuccessToast(`Revoked ${perm.relation_label} permission for ${perm.subject_name}.`)
        }
      } else {
        const err = await res.json()
        if (onErrorToast) onErrorToast(err.detail || "Failed to revoke permission.")
      }
    } catch (err: any) {
      if (onErrorToast) onErrorToast(err.message || "Error revoking permission.")
    } finally {
      setRevokingPermissionKey(null)
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
              onClick={() => {
                setActiveProvider(conn.provider)
                setSelectedIntegrationId(null)
              }}
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

      {/* Multi-Instance Selector Bar when 1+ instances exist for this provider */}
      {providerInstances.length > 0 && (
        <div className="px-6 py-2.5 bg-indigo-50/40 border-b border-slate-100 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Connected Accounts:
            </span>
            {providerInstances.map(inst => {
              const selected = inst.integration_id === activeIntegrationId
              return (
                <button
                  key={inst.integration_id || inst.account_identifier}
                  onClick={() => setSelectedIntegrationId(inst.integration_id || null)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium transition border ${
                    selected
                      ? "bg-white text-indigo-700 border-indigo-300 shadow-2xs"
                      : "bg-white/60 text-slate-600 border-slate-200 hover:bg-white"
                  }`}
                >
                  <span>{inst.account_identifier || "Account"}</span>
                  <span className={`text-[10px] font-bold uppercase px-1.5 py-0.2 rounded ${
                    inst.connection_scope === "org"
                      ? "bg-purple-100 text-purple-700"
                      : inst.connection_scope === "team"
                        ? "bg-sky-100 text-sky-700"
                        : "bg-slate-100 text-slate-600"
                  }`}>
                    {inst.connection_scope === "org" ? "Org-Wide" : inst.connection_scope === "team" ? "Team" : "Personal"}
                  </span>
                </button>
              )
            })}
          </div>
          <button
            onClick={() => handleConnect(activeProvider)}
            disabled={actionLoading[activeProvider]}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-indigo-700 bg-white border border-indigo-200 rounded-lg hover:bg-indigo-50 transition"
            title="Connect an additional team or manager instance"
          >
            <Plus className="w-3.5 h-3.5" />
            Add {connectScope === "org" ? "Org" : connectScope === "team" ? "Team" : "Personal"} Account
          </button>
        </div>
      )}

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
                  <>
                    {activeConnector.monitored_source_id ? (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        Live Sync Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
                        <AlertCircle className="w-3.5 h-3.5" />
                        Select Folder / Drive to Sync
                      </span>
                    )}
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                      {activeConnector.connection_scope === "org" ? <Building2 className="w-3 h-3" /> : <Users className="w-3 h-3" />}
                      {activeConnector.connection_scope === "org"
                        ? "Org-Wide"
                        : activeConnector.connection_scope === "team"
                          ? "Team Scope"
                          : "Manager Scope"}
                    </span>
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 border border-slate-200">
                    Disconnected
                  </span>
                )}
              </div>

              <p className="text-xs text-slate-500 mt-1 max-w-xl">
                {activeConnector.connected
                  ? `Documents and updates from ${activeConnector.display_name} are converted with dual-source ACL enforcement and PII redaction automatically.`
                  : `Connect ${activeConnector.display_name} to continuously auto-ingest documents, discussion digests, and meeting transcripts with team & role-based permissions.`}
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
              canManageActive ? (
                <>
                  <button
                    onClick={() => handleOpenPicker(activeConnector.provider, activeIntegrationId)}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl transition shadow-xs ${
                      activeConnector.monitored_source_id
                        ? "text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 hover:text-indigo-600 hover:border-indigo-200"
                        : "text-white bg-indigo-600 hover:bg-indigo-700 border border-indigo-600"
                    }`}
                  >
                    <FolderTree className={`w-3.5 h-3.5 ${activeConnector.monitored_source_id ? "text-indigo-600" : "text-white"}`} />
                    {activeConnector.monitored_source_id ? "Configure Source" : "Choose Drive / Folder"}
                  </button>

                  {activeConnector.monitored_source_id && (
                    <button
                      onClick={() => {
                        setShareModalOpen(true)
                        fetchContainerPermissions(activeConnector.monitored_source_id || null)
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl hover:bg-emerald-100 transition shadow-xs"
                      title="Grant or deny cross-team query access on this source"
                    >
                      <Share2 className="w-3.5 h-3.5" />
                      <span>Share Source</span>
                      {containerPermissions.length > 0 && (
                        <span className="ml-0.5 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-emerald-600 text-white">
                          {containerPermissions.length}
                        </span>
                      )}
                    </button>
                  )}

                  <button
                    onClick={() => handleSyncNow(activeConnector.provider, activeIntegrationId)}
                    disabled={actionLoading[activeConnector.provider] || !activeConnector.monitored_source_id}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-xl hover:bg-indigo-100 transition shadow-xs disabled:opacity-50"
                  >
                    <FolderSync className={`w-3.5 h-3.5 ${actionLoading[activeConnector.provider] ? "animate-spin text-indigo-600" : ""}`} />
                    {actionLoading[activeConnector.provider] ? "Syncing..." : "Sync Now"}
                  </button>

                  <button
                    onClick={() => handleDisconnect(activeConnector.provider, activeIntegrationId)}
                    disabled={actionLoading[activeConnector.provider]}
                    className="text-xs text-rose-500 hover:text-rose-700 font-medium px-2 py-1.5 rounded-lg hover:bg-rose-50 transition"
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-500 bg-slate-100 rounded-xl border border-slate-200">
                  <ShieldCheck className="w-3.5 h-3.5 text-slate-400" />
                  Managed by Org Admin
                </span>
              )
            ) : (
              <div className="flex items-center gap-2 flex-wrap">
                <select
                  value={connectScope}
                  onChange={e => setConnectScope(e.target.value as any)}
                  className="px-2.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl text-slate-700 focus:outline-none"
                  title="Connection governance scope"
                >
                  {isAdminOrAbove && <option value="org">Scope: Org-Wide</option>}
                  <option value="team">Scope: My Team</option>
                  <option value="personal">Scope: Manager Private</option>
                </select>
                <button
                  onClick={() => handleConnect(activeConnector.provider)}
                  disabled={actionLoading[activeConnector.provider]}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-md transition disabled:opacity-50"
                >
                  {getProviderIcon(activeConnector.provider)}
                  <span>Connect {activeConnector.display_name}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Connection Scope Options Bar when adding additional team/manager connections */}
        {activeConnector.connected && (
          <div className="mt-4 flex flex-wrap items-center gap-3 text-[11px] text-slate-500">
            <span className="font-semibold text-slate-600">New Connection Defaults:</span>
            <select
              value={connectScope}
              onChange={e => setConnectScope(e.target.value as any)}
              className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
            >
              {isAdminOrAbove && <option value="org">Org-Wide (Admin)</option>}
              <option value="team">Assigned Team</option>
              <option value="personal">Personal / Manager Subtree</option>
            </select>
            {connectScope === "team" && (
              <select
                value={connectTeamId}
                onChange={e => setConnectTeamId(e.target.value)}
                className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
              >
                <option value="">Default: My Sub-Function Team</option>
                {shareTargets
                  .filter(t => t.subject_type === "team" || t.subject_type === "department")
                  .map(t => (
                    <option key={`${t.subject_type}:${t.id}`} value={t.id}>
                      {t.name}
                    </option>
                  ))}
              </select>
            )}
            <select
              value={connectVisibility}
              onChange={e => setConnectVisibility(e.target.value as any)}
              className="px-2 py-1 bg-slate-50 border border-slate-200 rounded-lg text-slate-700"
            >
              <option value="acl_sync">ACL Mode: Cloud Permissions + Org Hierarchy</option>
              <option value="team_only">ACL Mode: Share with Assigned Team</option>
              {isAdminOrAbove && <option value="company_wide">ACL Mode: Company-Wide (Admin)</option>}
            </select>
          </div>
        )}

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
                {activeConnector.monitored_source_name || "Not selected yet"}
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

        {/* Active Shared Permissions Quick-View & One-Click Revoke Bar */}
        {activeConnector.connected && activeConnector.monitored_source_id && (containerPermissions.length > 0 || loadingPermissions) && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>Shared Permissions ({containerPermissions.length})</span>
              </div>
              {canManageActive && (
                <button
                  type="button"
                  onClick={() => setShareModalOpen(true)}
                  className="text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 transition"
                >
                  + Manage Access
                </button>
              )}
            </div>

            {loadingPermissions && containerPermissions.length === 0 ? (
              <div className="text-xs text-slate-400 flex items-center gap-1.5 py-1">
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-500" />
                Loading active permissions...
              </div>
            ) : (
              <div className="flex flex-wrap gap-2">
                {containerPermissions.map(perm => {
                  const rowKey = `${perm.subject_type}:${perm.subject_id}:${perm.relation}`
                  const isDeny = perm.relation === "deny_viewer" || perm.relation === "deny"
                  const isRevoking = revokingPermissionKey === rowKey
                  return (
                    <div
                      key={rowKey}
                      className={`inline-flex items-center gap-2 px-2.5 py-1.5 rounded-xl border text-xs transition ${
                        isDeny
                          ? "bg-rose-50/80 border-rose-200 text-rose-800"
                          : "bg-emerald-50/70 border-emerald-200 text-slate-800"
                      }`}
                    >
                      {perm.subject_type === "department" ? (
                        <Building2 className={`w-3.5 h-3.5 flex-shrink-0 ${isDeny ? "text-rose-600" : "text-indigo-600"}`} />
                      ) : perm.subject_type === "team" ? (
                        <Users className={`w-3.5 h-3.5 flex-shrink-0 ${isDeny ? "text-rose-600" : "text-sky-600"}`} />
                      ) : (
                        <UserCheck className={`w-3.5 h-3.5 flex-shrink-0 ${isDeny ? "text-rose-600" : "text-emerald-600"}`} />
                      )}
                      <span className="font-semibold">{perm.subject_name}</span>
                      <span className="text-[10px] text-slate-500">({perm.subject_detail})</span>
                      <span
                        className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                          isDeny
                            ? "bg-rose-100 text-rose-700"
                            : "bg-emerald-100 text-emerald-700"
                        }`}
                      >
                        {isDeny ? "Deny" : perm.relation === "editor" ? "Editor" : "Viewer"}
                      </span>
                      {canManageActive && perm.revocable && (
                        <button
                          type="button"
                          onClick={() => handleRevokeContainerShare(perm)}
                          disabled={isRevoking}
                          className="ml-0.5 p-0.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-100/70 transition disabled:opacity-50"
                          title={`Revoke ${perm.relation_label} for ${perm.subject_name}`}
                        >
                          {isRevoking ? (
                            <RefreshCw className="w-3 h-3 animate-spin text-rose-600" />
                          ) : (
                            <X className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Cross-Team / User Container Sharing Modal */}
      {shareModalOpen && activeConnector.monitored_source_id && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl max-w-lg w-full max-h-[85vh] flex flex-col overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center flex-shrink-0">
                  <Share2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Share "{activeConnector.monitored_source_name || "Source"}" Permissions
                  </h3>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Grant cross-team query access (Team A ↔ Team B) or apply explicit deny overrides.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShareModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1">
              <form onSubmit={handleGrantContainerShare} className="p-6 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                    Target Team, Department, or User
                  </label>
                  <select
                    value={shareSubjectKey}
                    onChange={e => setShareSubjectKey(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="">Select target...</option>
                    {shareTargets.map(t => (
                      <option key={`${t.subject_type}:${t.id}`} value={`${t.subject_type}:${t.id}`}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                    Permission Rule
                  </label>
                  <select
                    value={shareRelation}
                    onChange={e => setShareRelation(e.target.value as "viewer" | "deny_viewer")}
                    className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="viewer">Allow Querying (Viewer) — Inherits across folder documents</option>
                    <option value="deny_viewer">Explicit Deny Override — Blocks even if team/cloud grants access</option>
                  </select>
                </div>

                <div className="pt-1 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShareModalOpen(false)}
                    className="px-4 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 rounded-xl transition"
                  >
                    Done
                  </button>
                  <button
                    type="submit"
                    disabled={!shareSubjectKey || savingShare}
                    className="px-4 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl transition disabled:opacity-50"
                  >
                    {savingShare ? "Applying ACL..." : "Apply Permission Rule"}
                  </button>
                </div>
              </form>

              {/* Active Permissions List for Easy Identification & Quick Revoke */}
              <div className="px-6 pb-6 pt-4 border-t border-slate-100 bg-slate-50/50 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    Active Shared Permissions ({containerPermissions.length})
                  </span>
                  {loadingPermissions && (
                    <RefreshCw className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                  )}
                </div>

                {containerPermissions.length === 0 ? (
                  <p className="text-xs text-slate-400 py-3 text-center bg-white rounded-xl border border-dashed border-slate-200">
                    No custom team, department, or user shares added yet.
                  </p>
                ) : (
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {containerPermissions.map(perm => {
                      const rowKey = `${perm.subject_type}:${perm.subject_id}:${perm.relation}`
                      const isDeny = perm.relation === "deny_viewer" || perm.relation === "deny"
                      const isRevoking = revokingPermissionKey === rowKey
                      return (
                        <div
                          key={rowKey}
                          className="flex items-center justify-between gap-3 p-2.5 bg-white rounded-xl border border-slate-200/80 shadow-2xs"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                isDeny
                                  ? "bg-rose-50 text-rose-600"
                                  : "bg-emerald-50 text-emerald-600"
                              }`}
                            >
                              {perm.subject_type === "department" ? (
                                <Building2 className="w-4 h-4" />
                              ) : perm.subject_type === "team" ? (
                                <Users className="w-4 h-4" />
                              ) : (
                                <UserCheck className="w-4 h-4" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="text-xs font-semibold text-slate-900 truncate flex items-center gap-1.5">
                                <span className="truncate">{perm.subject_name}</span>
                                <span
                                  className={`text-[10px] font-bold px-1.5 py-0.2 rounded uppercase ${
                                    isDeny
                                      ? "bg-rose-100 text-rose-700"
                                      : "bg-emerald-100 text-emerald-700"
                                  }`}
                                >
                                  {perm.relation_label}
                                </span>
                              </div>
                              <div className="text-[11px] text-slate-500 truncate">
                                <span className="capitalize">{perm.subject_type}</span>
                                {perm.subject_detail && perm.subject_detail.toLowerCase() !== perm.subject_type.toLowerCase()
                                  ? ` · ${perm.subject_detail}`
                                  : ""}
                              </div>
                            </div>
                          </div>

                          {perm.revocable ? (
                            <button
                              type="button"
                              onClick={() => handleRevokeContainerShare(perm)}
                              disabled={isRevoking}
                              className="px-2.5 py-1.5 text-[11px] font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg transition disabled:opacity-50 flex-shrink-0"
                            >
                              {isRevoking ? "Revoking..." : "Revoke"}
                            </button>
                          ) : (
                            <span className="text-[10px] font-medium text-slate-400 px-2">
                              {perm.grant_source}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

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

            {/* Breadcrumbs Navigation */}
            {breadcrumbs.length > 0 && (
              <div className="px-6 py-2 bg-white border-b border-slate-100 flex items-center gap-1 overflow-x-auto text-xs">
                {breadcrumbs.map((bc, idx) => (
                  <React.Fragment key={`${bc.id || "root"}-${idx}`}>
                    {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-300 flex-shrink-0" />}
                    <button
                      type="button"
                      onClick={() => handleBreadcrumbClick(idx)}
                      className={`px-2 py-0.5 rounded-md truncate max-w-[160px] transition ${
                        idx === breadcrumbs.length - 1
                          ? "font-semibold text-indigo-700 bg-indigo-50"
                          : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                      }`}
                    >
                      {bc.name}
                    </button>
                  </React.Fragment>
                ))}
              </div>
            )}

            {/* Search */}
            <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-100 flex items-center gap-2">
              <Search className="w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search drives or folders..."
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
                  Loading drives &amp; folders...
                </div>
              ) : containers.length === 0 ? (
                <div className="p-8 text-center text-slate-400 text-xs">
                  No folders or containers found at this level.
                </div>
              ) : (
                containers
                  .filter(c => !pickerSearch || c.name.toLowerCase().includes(pickerSearch.toLowerCase()))
                  .map(c => {
                    const isSelectable = c.can_select !== false
                    const isSelected = selectedContainer?.id === c.id
                    return (
                      <div
                        key={c.id}
                        onClick={() => {
                          if (isSelectable) {
                            setSelectedContainer(c)
                          } else if (c.has_children) {
                            handleDrillIntoContainer(c)
                          }
                        }}
                        onDoubleClick={() => {
                          if (c.has_children) handleDrillIntoContainer(c)
                        }}
                        className={`flex items-center justify-between p-3 rounded-xl cursor-pointer text-xs transition border ${
                          isSelected
                            ? "bg-indigo-50/80 border-indigo-200 text-indigo-900"
                            : "hover:bg-slate-50 border-transparent text-slate-700"
                        }`}
                      >
                        <div className="flex items-center gap-2.5 truncate">
                          {c.container_type === "shared_drive" ? (
                            <HardDrive className={`w-4 h-4 flex-shrink-0 ${isSelected ? "text-indigo-600" : "text-sky-500"}`} />
                          ) : (
                            <Folder className={`w-4 h-4 flex-shrink-0 ${isSelected ? "text-indigo-600" : "text-slate-400"}`} />
                          )}
                          <span className="font-medium truncate">{c.name}</span>
                          <span className="text-[10px] uppercase font-semibold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                            {c.container_type === "shared_drive" ? "Shared Drive" : c.container_type}
                          </span>
                          {!isSelectable && (
                            <span className="text-[10px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
                              Open to browse
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {isSelected && <Check className="w-4 h-4 text-indigo-600" />}
                          {c.has_children && (
                            <button
                              type="button"
                              onClick={e => {
                                e.stopPropagation()
                                handleDrillIntoContainer(c)
                              }}
                              className="inline-flex items-center gap-0.5 px-2 py-1 text-[11px] font-semibold text-indigo-600 hover:bg-indigo-100/70 rounded-lg transition"
                              title={`Browse inside ${c.name}`}
                            >
                              Open
                              <ChevronRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
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

