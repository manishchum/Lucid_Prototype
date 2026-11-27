"use client"

import React, { useState, useEffect, useRef, useCallback } from "react"
import Link from "next/link"
import { useAuth } from "@/contexts/auth-context"
import { useTenant } from "@/contexts/tenant-context"
import { fetchWithAuth } from "@/lib/fetch-with-auth"
import { cn } from "@/lib/utils"
import { 
  Upload, 
  FileText, 
  FileSpreadsheet, 
  Presentation, 
  FileCheck, 
  AlertCircle, 
  Clock, 
  Sparkles, 
  CheckCircle2, 
  Trash2, 
  RefreshCw, 
  ExternalLink, 
  Layers, 
  Database, 
  Search, 
  Filter, 
  Info, 
  X,
  ChevronRight,
  ChevronLeft,
  ArrowRight,
  ArrowLeft,
  UserCheck,
  FolderSync,
  HardDrive,
  FolderOpen,
  Folder,
  FolderTree,
  Radio,
  Check,
  ShieldCheck,
  ShieldAlert,
  Users,
  Share2,
  Building2,
  File as FileIcon,
  Image as ImageIcon,
  Eye,
  Ban,
  Download,
  Copy,
  BookOpen,
  MoreHorizontal
} from "lucide-react"

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"
import { UnifiedConnectorsHub } from "./UnifiedConnectorsHub"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table"
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter } from "@/components/ui/sheet"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { 
  AlertDialog, 
  AlertDialogTrigger, 
  AlertDialogContent, 
  AlertDialogHeader, 
  AlertDialogTitle, 
  AlertDialogDescription, 
  AlertDialogFooter, 
  AlertDialogCancel, 
  AlertDialogAction 
} from "@/components/ui/alert-dialog"
import { 
  DropdownMenu, 
  DropdownMenuTrigger, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuGroup 
} from "@/components/ui/dropdown-menu"
import { 
  Breadcrumb, 
  BreadcrumbList, 
  BreadcrumbItem, 
  BreadcrumbLink, 
  BreadcrumbPage, 
  BreadcrumbSeparator 
} from "@/components/ui/breadcrumb"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"

interface CoachDocument {
  id: string
  file_name: string
  file_type: string
  file_size_bytes: number
  status: "pending" | "parsing" | "embedding" | "completed" | "failed"
  version?: number
  file_hash?: string
  error_message?: string | null
  description?: string | null
  manual_description?: string | null
  document_period?: string | null
  parsed_metadata?: {
    chunks_count?: number
    spreadsheet_rows_count?: number
    page_count?: number
    total_pages?: number
    sheet_names?: string[]
    total_rows?: number
    slide_count?: number
    format?: string
    columns_detected?: string[]
    header_row_detected?: number | string
    [key: string]: any
  }
  created_at: string
  target_employee_id?: string | null
  uploaded_by: string
  web_view_link?: string | null
  gdrive_file_id?: string | null
}

interface EmployeeOption {
  user_id: string
  name: string
  email: string
}

interface GoogleDriveIntegration {
  id: string
  google_account_email: string
  folder_id: string
  folder_name: string
  folder_path?: string
  is_recursive?: boolean
  sync_status: string
  webhook_active: boolean
  webhook_expiration?: string | null
  last_synced_at?: string | null
  total_synced_files: number
  error_message?: string | null
  connected_at?: string | null
}

interface DriveFolderItem {
  id: string
  name: string
  container_type: "folder" | "shared_drive"
  parent_id?: string | null
  path: string
  drive_id?: string | null
  drive_name?: string | null
  has_children?: boolean
  can_select?: boolean
  metadata?: any
}

interface DriveFileItem {
  id: string
  name: string
  mime_type: string
  extension?: string
  size_bytes?: number
  modified_time?: string
  icon_link?: string
  web_view_link?: string
  is_google_doc?: boolean
  is_supported?: boolean
  export_format?: string | null
  category?: "document" | "spreadsheet" | "presentation" | "image" | "video" | "archive" | "other"
}

interface PreflightConflict {
  file_name: string
  file_hash: string
  status: "clean" | "exists_identical" | "name_conflict"
  message: string
  existing_document?: {
    id: string
    file_name: string
    file_size_bytes: number
    status: string
    created_at: string
    version?: number
    parsed_metadata?: any
  }
}

interface LiveProgress {
  stage: string
  percent: number
  details?: {
    stage_text?: string
    chunks_count?: number
    spreadsheet_rows_count?: number
    error?: string
  }
}

interface DocumentChunk {
  id: string
  chunk_index: number
  chunk_type: string
  content: string
  citation: any
  created_at: string
}

interface DocShareTargetOption {
  id: string
  name: string
  subject_type: "team" | "department" | "user"
}

interface DocPermissionEntry {
  id: string
  subject_type: string
  subject_id: string
  subject_name: string
  subject_detail: string
  relation: string
  relation_label: string
  grant_source: string
  revocable: boolean
}

export default function CoachUploadsPage() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  const { employeeData, user: authUser, isAdmin, isSuperAdmin, isDeveloper, isManager, isManagerofUsers, rolesLoaded, loading: authLoading } = useAuth()
  const { activeCompanyId } = useTenant()
  const companyId = activeCompanyId || employeeData?.company_id
  const isAdminOrAbove = isAdmin || isSuperAdmin || isDeveloper
  const isManagerOrAbove = isAdminOrAbove || isManager || isManagerofUsers
  const hasAccess = isManagerOrAbove
  const hydratedAdminOrAbove = mounted && isAdminOrAbove
  const hydratedManagerOrAbove = mounted && isManagerOrAbove

  // Documents & Pagination State
  const [documents, setDocuments] = useState<CoachDocument[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalDocuments, setTotalDocuments] = useState(0)
  const [companyStats, setCompanyStats] = useState<{
    total_documents: number
    completed_documents: number
    total_chunks: number
    total_spreadsheet_rows: number
  } | null>(null)

  // Upload Form State (Multi-File)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [targetEmployeeId, setTargetEmployeeId] = useState<string>("general")
  const [isPrivateManagerNote, setIsPrivateManagerNote] = useState<boolean>(false)
  const [isPlaybook, setIsPlaybook] = useState<boolean>(false)
  const [manualDescription, setManualDescription] = useState<string>("")
  const [isDragOver, setIsDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgressText, setUploadProgressText] = useState("")

  // Preflight Conflict Resolution Modal
  const [preflightConflicts, setPreflightConflicts] = useState<PreflightConflict[]>([])
  const [conflictModalOpen, setConflictModalOpen] = useState(false)
  const [conflictResolutions, setConflictResolutions] = useState<Record<string, "overwrite" | "version" | "skip">>({})

  // Real-Time SSE Progress Map: document_id -> LiveProgress
  const [liveProgress, setLiveProgress] = useState<Record<string, LiveProgress>>({})

  // shadcn Toast & Alert Dialog Confirmation State
  const { toast } = useToast()
  const [docToDelete, setDocToDelete] = useState<{ id: string; fileName: string } | null>(null)

  // Multi-File Selection & Batch Operations State
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set())
  const [isBatchDeleting, setIsBatchDeleting] = useState(false)
  const [isBatchUpdatingPlaybook, setIsBatchUpdatingPlaybook] = useState(false)
  const [batchDeleteDialogOpen, setBatchDeleteDialogOpen] = useState(false)

  // Dynamic Connectors for Source Filter
  const [dynamicConnectors, setDynamicConnectors] = useState<Array<{ provider: string; display_name: string; connected: boolean }>>([
    { provider: "gdrive", display_name: "Google Drive", connected: false },
    { provider: "onedrive", display_name: "Microsoft OneDrive", connected: false },
    { provider: "teams", display_name: "Microsoft Teams", connected: false },
    { provider: "slack", display_name: "Slack", connected: false },
    { provider: "zoom", display_name: "Zoom", connected: false },
    { provider: "meet", display_name: "Google Meet", connected: false },
    { provider: "gmail", display_name: "Gmail", connected: false },
  ])

  // Toast Dispatchers (floating notifications, zero page displacement)
  const setSuccessToast = (msg: string | null) => {
    if (msg) {
      toast({
        title: "Success",
        description: msg,
      })
    }
  }

  const setErrorToast = (msg: string | null) => {
    if (msg) {
      toast({
        title: "Notice",
        description: msg,
        variant: "destructive",
      })
    }
  }

  // Hub Navigation Tab & Slide-Over Drawer State
  const [activeHubTab, setActiveHubTab] = useState<"documents" | "connectors" | "logs">("documents")
  const [isUploadDrawerOpen, setIsUploadDrawerOpen] = useState(false)

  // Search & Filtering State
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [sourceFilter, setSourceFilter] = useState<string>("all")

  // Inspection Drawer State
  const [inspectDoc, setInspectDoc] = useState<CoachDocument | null>(null)
  const [inspectDrawerTab, setInspectDrawerTab] = useState<"overview" | "chunks" | "permissions">("overview")
  const [chunksForInspect, setChunksForInspect] = useState<DocumentChunk[]>([])
  const [loadingChunks, setLoadingChunks] = useState(false)
  const [chunkSearchQuery, setChunkSearchQuery] = useState("")
  const [docPermissions, setDocPermissions] = useState<DocPermissionEntry[]>([])
  const [docShareTargets, setDocShareTargets] = useState<DocShareTargetOption[]>([])
  const [loadingDocPerms, setLoadingDocPerms] = useState(false)
  const [docShareSubjectKey, setDocShareSubjectKey] = useState("")
  const [docShareRelation, setDocShareRelation] = useState<"viewer" | "deny_viewer">("viewer")
  const [savingDocShare, setSavingDocShare] = useState(false)
  const [revokingDocPermKey, setRevokingDocPermKey] = useState<string | null>(null)
  const [downloadingUrl, setDownloadingUrl] = useState(false)
  const [isDeleting, setIsDeleting] = useState<string | null>(null)

  const loadDocPermissions = useCallback(async (docId: string) => {
    try {
      setLoadingDocPerms(true)
      const [permRes, teamsRes] = await Promise.all([
        fetchWithAuth(`${API_BASE}/api/rbac/documents/${encodeURIComponent(docId)}/permissions`),
        docShareTargets.length === 0
          ? fetchWithAuth(`${API_BASE}/api/rbac/teams`)
          : Promise.resolve(null),
      ])
      if (permRes.ok) {
        const permData = await permRes.json()
        setDocPermissions(Array.isArray(permData.permissions) ? permData.permissions : [])
      } else {
        setDocPermissions([])
      }
      if (teamsRes && teamsRes.ok) {
        const data = await teamsRes.json()
        const merged: DocShareTargetOption[] = [
          ...(data.teams || []).map((t: any) => ({
            id: t.id,
            name: `${t.name} (${t.subject_type === "department" ? "Department" : "Team"})`,
            subject_type: t.subject_type,
          })),
          ...(data.users || []).map((u: any) => ({
            id: u.user_id,
            name: `${u.name || u.email} (User)`,
            subject_type: "user" as const,
          })),
        ]
        setDocShareTargets(merged)
      }
    } catch (err) {
      console.warn("[CoachUploads] Failed to load document permissions:", err)
    } finally {
      setLoadingDocPerms(false)
    }
  }, [docShareTargets.length])

  const handleGrantDocShare = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!inspectDoc || !docShareSubjectKey) return
    const target = docShareTargets.find(t => `${t.subject_type}:${t.id}` === docShareSubjectKey)
    if (!target) return
    try {
      setSavingDocShare(true)
      const res = await fetchWithAuth(`${API_BASE}/api/rbac/documents/${encodeURIComponent(inspectDoc.id)}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject_type: target.subject_type,
          subject_id: target.id,
          relation: docShareRelation,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data.permissions)) {
          setDocPermissions(data.permissions)
        } else {
          loadDocPermissions(inspectDoc.id)
        }
        setDocShareSubjectKey("")
        setSuccessToast(`Updated permission for ${target.name} on "${inspectDoc.file_name}".`)
      } else {
        const err = await res.json()
        setErrorToast(err.detail || "Failed to update document permission.")
      }
    } catch (err: any) {
      setErrorToast(err.message || "Error updating document permission.")
    } finally {
      setSavingDocShare(false)
    }
  }

  const handleRevokeDocShare = async (perm: DocPermissionEntry) => {
    if (!inspectDoc) return
    const rowKey = `${perm.subject_type}:${perm.subject_id}:${perm.relation}`
    try {
      setRevokingDocPermKey(rowKey)
      const params = new URLSearchParams({
        subject_type: perm.subject_type,
        subject_id: perm.subject_id,
        relation: perm.relation,
      })
      const res = await fetchWithAuth(
        `${API_BASE}/api/rbac/documents/${encodeURIComponent(inspectDoc.id)}/share?${params.toString()}`,
        { method: "DELETE" }
      )
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data.permissions)) {
          setDocPermissions(data.permissions)
        } else {
          setDocPermissions(prev =>
            prev.filter(
              p => !(p.subject_type === perm.subject_type && p.subject_id === perm.subject_id && p.relation === perm.relation)
            )
          )
        }
        setSuccessToast(`Revoked permission for ${perm.subject_name}.`)
      } else {
        const err = await res.json()
        setErrorToast(err.detail || "Failed to revoke permission.")
      }
    } catch (err: any) {
      setErrorToast(err.message || "Error revoking document permission.")
    } finally {
      setRevokingDocPermKey(null)
    }
  }

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Google Drive State
  const [gdriveStatus, setGdriveStatus] = useState<{ connected: boolean; integration?: GoogleDriveIntegration } | null>(null)
  const [gdriveLoading, setGdriveLoading] = useState(true)
  const [syncingGDrive, setSyncingGDrive] = useState(false)
  const [disconnectingGDrive, setDisconnectingGDrive] = useState(false)

  // Folder Picker Modal State
  const [folderModalOpen, setFolderModalOpen] = useState(false)
  const [folderLoading, setFolderLoading] = useState(false)
  const [folderItems, setFolderItems] = useState<DriveFolderItem[]>([])
  const [folderFiles, setFolderFiles] = useState<DriveFileItem[]>([])
  const [selectedFolder, setSelectedFolder] = useState<DriveFolderItem | null>(null)
  const [selectedFolderFiles, setSelectedFolderFiles] = useState<DriveFileItem[]>([])
  const [loadingSelectedFiles, setLoadingSelectedFiles] = useState(false)
  const [modalSearchQuery, setModalSearchQuery] = useState("")
  const [inspectorTab, setInspectorTab] = useState<"all" | "eligible" | "excluded">("all")
  const [folderBreadcrumbs, setFolderBreadcrumbs] = useState<Array<{ id: string | null; name: string; drive_id?: string | null }>>([
    { id: null, name: "Google Drive" }
  ])
  const [savingFolder, setSavingFolder] = useState(false)

  // 1. Fetch Ingested Documents (Paginated & Filtered)
  const fetchDocuments = useCallback(async (
    page = 1,
    query = "",
    status = "all",
    source = "all"
  ) => {
    try {
      setLoading(true)
      const params = new URLSearchParams()
      params.append("page", String(page))
      params.append("limit", "25")
      if (query.trim()) params.append("search", query.trim())
      if (status !== "all") params.append("status", status)
      if (source !== "all") params.append("source", source)

      const res = await fetchWithAuth(`${API_BASE}/api/coach/documents?${params.toString()}`)
      if (res.ok) {
        const payload = await res.json()
        setDocuments(payload.documents || [])
        setTotalDocuments(payload.total || 0)
        setCurrentPage(payload.page || 1)
        setTotalPages(payload.total_pages || 1)
        if (payload.stats) {
          setCompanyStats(payload.stats)
        }
      }
    } catch (err) {
      console.error("[coach-upload] Failed to fetch documents:", err)
    } finally {
      setLoading(false)
    }
  }, [])

  // 2. Fetch Employee Roster for Scoping Dropdown
  const fetchEmployees = useCallback(async () => {
    if (!companyId) return
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/employees/bootstrap/${companyId}`)
      if (res.ok) {
        const payload = await res.json()
        const usersList: EmployeeOption[] = (payload.users || []).map((u: any) => ({
          user_id: u.user_id,
          name: u.name || u.email,
          email: u.email
        }))
        setEmployees(usersList)
      }
    } catch (err) {
      console.warn("[coach-upload] Failed to fetch employees list for dropdown:", err)
    }
  }, [companyId])

  // 3. Fetch Google Drive Status
  const fetchGDriveStatus = useCallback(async () => {
    try {
      setGdriveLoading(true)
      const res = await fetchWithAuth(`${API_BASE}/api/integrations/google-drive/status`)
      if (res.ok) {
        const data = await res.json()
        setGdriveStatus(data)
      }
    } catch (err) {
      console.warn("[coach-upload] Failed to fetch Google Drive status:", err)
    } finally {
      setGdriveLoading(false)
    }
  }, [])

  // Standalone Company Stats Fetcher
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/coach/stats`)
      if (res.ok) {
        const data = await res.json()
        setCompanyStats(data)
      }
    } catch (err) {
      console.warn("[coach-upload] Failed to fetch company stats:", err)
    }
  }, [])

  // Fetch Dynamic Connectors for Filter Dropdown
  useEffect(() => {
    const fetchConnectors = async () => {
      try {
        const res = await fetchWithAuth(`${API_BASE}/api/connectors/status`)
        if (res.ok) {
          const data = await res.json()
          if (Array.isArray(data.connectors) && data.connectors.length > 0) {
            setDynamicConnectors(data.connectors.map((c: any) => ({
              provider: c.provider === "google_drive" ? "gdrive" : c.provider,
              display_name: c.display_name || c.provider,
              connected: Boolean(c.connected)
            })))
          }
        }
      } catch (err) {
        console.warn("[CoachUploads] Failed to fetch dynamic connectors:", err)
      }
    }
    fetchConnectors()
  }, [])

  // Initial Load
  useEffect(() => {
    fetchDocuments(1, searchQuery, statusFilter, sourceFilter)
    fetchStats()
    if (rolesLoaded && isManagerOrAbove) {
      fetchEmployees()
      fetchGDriveStatus()
    } else {
      setGdriveLoading(false)
    }
  }, [fetchDocuments, fetchStats, fetchEmployees, fetchGDriveStatus, rolesLoaded, isManagerOrAbove])

  // Keep latest search and pagination params in a ref to avoid reconnecting SSE on keystroke
  const fetchParamsRef = useRef({ currentPage, searchQuery, statusFilter, sourceFilter })
  useEffect(() => {
    fetchParamsRef.current = { currentPage, searchQuery, statusFilter, sourceFilter }
  }, [currentPage, searchQuery, statusFilter, sourceFilter])

  const fetchDocsRef = useRef(fetchDocuments)
  useEffect(() => {
    fetchDocsRef.current = fetchDocuments
  }, [fetchDocuments])

  // Real-Time Server-Sent Events (SSE) Stream
  useEffect(() => {
    if (!companyId) return

    let active = true
    let retryTimeout: NodeJS.Timeout | null = null
    const abortController = new AbortController()

    const connectSSE = async () => {
      try {
        const sseUrl = `${API_BASE}/api/coach/events`
        const response = await fetchWithAuth(sseUrl, { signal: abortController.signal })
        if (!response.ok || !response.body) {
          if (active) retryTimeout = setTimeout(connectSSE, 5000)
          return
        }

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (active) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const parts = buffer.split("\n\n")
          buffer = parts.pop() || ""

          for (const chunk of parts) {
            const trimmed = chunk.trim()
            if (trimmed.startsWith("data:")) {
              const dataStr = trimmed.replace("data:", "").trim()
              try {
                const data = JSON.parse(dataStr)
                if (data.event === "DOCUMENT_PROGRESS") {
                  setLiveProgress(prev => ({
                    ...prev,
                    [data.document_id]: {
                      stage: data.stage,
                      percent: data.percent,
                      details: data.details
                    }
                  }))
                  if (data.stage === "completed" || data.stage === "failed") {
                    const p = fetchParamsRef.current
                    fetchDocsRef.current(p.currentPage, p.searchQuery, p.statusFilter, p.sourceFilter)
                  }
                }
              } catch {
                // Heartbeat comment
              }
            }
          }
        }
      } catch (err: any) {
        if (err?.name === "AbortError") return
        if (active) {
          retryTimeout = setTimeout(connectSSE, 5000)
        }
      }
    }

    connectSSE()

    return () => {
      active = false
      if (retryTimeout) clearTimeout(retryTimeout)
      abortController.abort()
    }
  }, [companyId])

  // Debounced Search Query Trigger
  useEffect(() => {
    const handler = setTimeout(() => {
      fetchDocuments(1, searchQuery, statusFilter, sourceFilter)
    }, 300)
    return () => clearTimeout(handler)
  }, [searchQuery, statusFilter, sourceFilter, fetchDocuments])

  // File Selection Handlers (Multi-File)
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const incoming = Array.from(e.target.files)
      setSelectedFiles(prev => [...prev, ...incoming])
      setErrorToast(null)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const incoming = Array.from(e.dataTransfer.files)
      setSelectedFiles(prev => [...prev, ...incoming])
      setErrorToast(null)
    }
  }

  const removeSelectedFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index))
  }

  // Pre-flight Conflict Check & Batch Upload Handler
  const handlePreflightAndUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    if (selectedFiles.length === 0) {
      setErrorToast("Please select at least one file to upload.")
      return
    }

    // Check size limit: 100MB per file
    const oversized = selectedFiles.find(f => f.size > 100 * 1024 * 1024)
    if (oversized) {
      setErrorToast(`File '${oversized.name}' exceeds the 100MB limit. Please compress or select a smaller file.`)
      return
    }

    setUploading(true)
    setUploadProgressText("Analyzing file signatures and checking vault conflicts...")
    setErrorToast(null)
    setSuccessToast(null)

    try {
      // 1. Calculate SHA-256 hash in browser
      const preflightItems = await Promise.all(
        selectedFiles.map(async file => {
          const buffer = await file.arrayBuffer()
          const hashBuffer = await crypto.subtle.digest("SHA-256", buffer)
          const hashArray = Array.from(new Uint8Array(hashBuffer))
          const hash = hashArray.map(b => b.toString(16).padStart(2, "0")).join("")
          return {
            file_name: file.name,
            file_size: file.size,
            file_hash: hash
          }
        })
      )

      // 2. Query Preflight Check API
      const preflightRes = await fetchWithAuth(`${API_BASE}/api/coach/preflight-check`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(companyId ? { "X-Company-ID": companyId } : {})
        },
        body: JSON.stringify({ items: preflightItems, company_id: companyId })
      })

      if (!preflightRes.ok) {
        throw new Error("Conflict detection service returned an error.")
      }

      const preflightData = await preflightRes.json()
      const conflicts: PreflightConflict[] = preflightData.results || []

      const hasConflicts = conflicts.some(c => c.status !== "clean")
      if (hasConflicts) {
        setPreflightConflicts(conflicts)
        const initialResolutions: Record<string, "overwrite" | "version" | "skip"> = {}
        for (const c of conflicts) {
          if (c.status === "exists_identical") {
            initialResolutions[c.file_name] = "skip"
          } else if (c.status === "name_conflict") {
            initialResolutions[c.file_name] = "overwrite"
          }
        }
        setConflictResolutions(initialResolutions)
        setConflictModalOpen(true)
        setUploading(false)
        setUploadProgressText("")
        return
      }

      // No conflicts, execute upload directly
      await executeUploadBatch(selectedFiles, {})
    } catch (err: any) {
      setErrorToast(err.message || "Upload preparation failed.")
      setUploading(false)
      setUploadProgressText("")
    }
  }

  // Execute Upload Batch with Chosen Conflict Modes
  const executeUploadBatch = async (
    filesToUpload: File[],
    resolutions: Record<string, "overwrite" | "version" | "skip">
  ) => {
    setUploading(true)
    setConflictModalOpen(false)
    let queuedCount = 0
    let skippedCount = 0

    try {
      for (let i = 0; i < filesToUpload.length; i++) {
        const file = filesToUpload[i]
        const mode = resolutions[file.name] || "fail_on_conflict"
        if (mode === "skip") {
          skippedCount++
          continue
        }

        const conflictInfo = preflightConflicts.find(c => c.file_name === file.name)
        const existingDocId = conflictInfo?.existing_document?.id

        setUploadProgressText(`Uploading ${file.name} (${i + 1}/${filesToUpload.length})...`)

        const formData = new FormData()
        formData.append("file", file)
        if (targetEmployeeId && targetEmployeeId !== "general" && !isPlaybook) {
          formData.append("target_employee_id", targetEmployeeId)
          formData.append("is_private_manager_note", isPrivateManagerNote ? "true" : "false")
        }
        if (isPlaybook) {
          formData.append("is_playbook", "true")
        }
        if (manualDescription.trim()) {
          formData.append("manual_description", manualDescription.trim())
        }
        formData.append("conflict_mode", mode)
        if (companyId) {
          formData.append("company_id", companyId)
        }
        if (existingDocId && mode === "overwrite") {
          formData.append("existing_doc_id", existingDocId)
        }

        const res = await fetchWithAuth(`${API_BASE}/api/coach/upload`, {
          method: "POST",
          body: formData
        })

        if (res.ok) {
          queuedCount++
        } else {
          const err = await res.json()
          console.error(`Upload error for ${file.name}:`, err)
        }
      }

      setSuccessToast(`Queued ${queuedCount} document(s) for live ingestion.${skippedCount > 0 ? ` (${skippedCount} skipped)` : ""}`)
      setSelectedFiles([])
      setPreflightConflicts([])
      setTargetEmployeeId("general")
      setIsPrivateManagerNote(false)
      setIsPlaybook(false)
      setManualDescription("")
      if (fileInputRef.current) fileInputRef.current.value = ""
      setIsUploadDrawerOpen(false)

      fetchDocuments(1, searchQuery, statusFilter, sourceFilter)
    } catch (err: any) {
      setErrorToast(err.message || "Batch upload encounterd an error.")
    } finally {
      setUploading(false)
      setUploadProgressText("")
    }
  }

  // Delete Document Confirmation via shadcn AlertDialog
  const handleDelete = (docId: string, fileName: string) => {
    setDocToDelete({ id: docId, fileName })
  }

  const executeDelete = async () => {
    if (!docToDelete) return
    const { id: docId, fileName } = docToDelete
    setDocToDelete(null)
    setIsDeleting(docId)
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/coach/documents/${docId}`, {
        method: "DELETE"
      })
      if (res.ok) {
        setDocuments(prev => prev.filter(d => d.id !== docId))
        if (inspectDoc?.id === docId) setInspectDoc(null)
        setSelectedDocIds(prev => {
          const next = new Set(prev)
          next.delete(docId)
          return next
        })
        setSuccessToast(`Deleted '${fileName}' successfully.`)
        fetchDocuments(currentPage, searchQuery, statusFilter, sourceFilter)
      } else {
        const payload = await res.json()
        const errMsg = payload.detail || "Failed to delete document."
        setErrorToast(errMsg)
      }
    } catch (err: any) {
      const errMsg = err.message || "Error deleting document."
      setErrorToast(errMsg)
    } finally {
      setIsDeleting(null)
    }
  }

  // Selection Helpers
  const isAllCurrentPageSelected = documents.length > 0 && documents.every(d => selectedDocIds.has(d.id))
  const isSomeCurrentPageSelected = documents.some(d => selectedDocIds.has(d.id)) && !isAllCurrentPageSelected

  const handleToggleSelectAll = () => {
    if (isAllCurrentPageSelected) {
      setSelectedDocIds(prev => {
        const next = new Set(prev)
        documents.forEach(d => next.delete(d.id))
        return next
      })
    } else {
      setSelectedDocIds(prev => {
        const next = new Set(prev)
        documents.forEach(d => next.add(d.id))
        return next
      })
    }
  }

  const handleToggleSelectDoc = (docId: string) => {
    setSelectedDocIds(prev => {
      const next = new Set(prev)
      if (next.has(docId)) {
        next.delete(docId)
      } else {
        next.add(docId)
      }
      return next
    })
  }

  const handleClearSelection = () => {
    setSelectedDocIds(new Set())
  }

  // Batch Operations
  const handleBatchPlaybook = async (isPlaybookVal: boolean) => {
    if (selectedDocIds.size === 0) return
    setIsBatchUpdatingPlaybook(true)
    try {
      const ids = Array.from(selectedDocIds)
      const results = await Promise.allSettled(
        ids.map(id =>
          fetchWithAuth(`${API_BASE}/api/coach/documents/${id}/playbook-toggle`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ is_playbook: isPlaybookVal })
          })
        )
      )
      const successCount = results.filter(r => r.status === "fulfilled" && (r.value as Response).ok).length
      toast({
        title: isPlaybookVal ? "Playbooks Designated" : "Playbooks Revoked",
        description: `Updated ${successCount} of ${ids.length} selected document(s).`
      })
      handleClearSelection()
      fetchDocuments(currentPage, searchQuery, statusFilter, sourceFilter)
    } catch (err: any) {
      toast({
        title: "Batch Update Failed",
        description: err.message || "Failed to update selected documents.",
        variant: "destructive"
      })
    } finally {
      setIsBatchUpdatingPlaybook(false)
    }
  }

  const executeBatchDelete = async () => {
    if (selectedDocIds.size === 0) return
    setIsBatchDeleting(true)
    setBatchDeleteDialogOpen(false)
    try {
      const ids = Array.from(selectedDocIds)
      const results = await Promise.allSettled(
        ids.map(id =>
          fetchWithAuth(`${API_BASE}/api/coach/documents/${id}`, {
            method: "DELETE"
          })
        )
      )
      const successCount = results.filter(r => r.status === "fulfilled" && (r.value as Response).ok).length
      toast({
        title: "Documents Deleted",
        description: `Permanently removed ${successCount} document(s) and their vector chunk embeddings.`
      })
      handleClearSelection()
      fetchDocuments(currentPage, searchQuery, statusFilter, sourceFilter)
    } catch (err: any) {
      toast({
        title: "Batch Delete Error",
        description: err.message || "An error occurred during batch deletion.",
        variant: "destructive"
      })
    } finally {
      setIsBatchDeleting(false)
    }
  }

  // Load Vector Chunks for Inspection
  const loadChunksForInspection = async (docId: string) => {
    try {
      setLoadingChunks(true)
      const res = await fetchWithAuth(`${API_BASE}/api/coach/documents/${docId}/chunks?limit=50`)
      if (res.ok) {
        const data = await res.json()
        setChunksForInspect(data.chunks || [])
      }
    } catch (err) {
      console.warn("Could not load chunks for inspection:", err)
    } finally {
      setLoadingChunks(false)
    }
  }

  // Download Signed URL
  const handleDownloadOriginal = async (docId: string) => {
    try {
      setDownloadingUrl(true)
      const res = await fetchWithAuth(`${API_BASE}/api/coach/documents/${docId}/download-url`)
      if (res.ok) {
        const data = await res.json()
        if (data.download_url) {
          window.open(data.download_url, "_blank")
        }
      } else {
        const err = await res.json()
        setErrorToast(err.detail || "Failed to generate download URL.")
      }
    } catch (err: any) {
      setErrorToast(err.message || "Failed to generate download URL.")
    } finally {
      setDownloadingUrl(false)
    }
  }

  // Toggle Playbook Designation
  const handleTogglePlaybook = async (docId: string, currentStatus: boolean) => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/coach/documents/${docId}/playbook-toggle`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_playbook: !currentStatus })
      })
      if (res.ok) {
        const data = await res.json()
        setSuccessToast(data.message || "Playbook designation updated.")
        fetchDocuments(currentPage, searchQuery, statusFilter, sourceFilter)
      } else {
        const err = await res.json()
        setErrorToast(err.detail || "Failed to update playbook designation.")
      }
    } catch (err: any) {
      setErrorToast(err.message || "Failed to toggle playbook designation.")
    }
  }

  // Format Helper
  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return "0 Bytes"
    const k = 1024
    const sizes = ["Bytes", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
  }

  const getCleanFileName = (fileName: string) => {
    if (!fileName) return ""
    // Strip trailing extension(s) like .pdf, .docx, .xlsx, or accidental double .xlsx.xlsx
    const clean = fileName.replace(/(\.[a-zA-Z0-9]+)+$/, "")
    return clean.trim() ? clean : fileName
  }

  const getFileIcon = (type: string) => {
    const ext = type.toLowerCase()
    if (ext === "pdf") return <FileText className="w-5 h-5 text-rose-500" />
    if (ext.includes("xls") || ext === "csv") return <FileSpreadsheet className="w-5 h-5 text-emerald-500" />
    if (ext.includes("ppt")) return <Presentation className="w-5 h-5 text-amber-500" />
    return <FileCheck className="w-5 h-5 text-blue-500" />
  }

  const getDriveItemFileIcon = (mimeType: string = "", extension: string = "") => {
    const ext = (extension || "").toLowerCase()
    const mime = (mimeType || "").toLowerCase()

    if (ext === "pdf" || mime.includes("pdf")) {
      return (
        <div className="size-8 rounded-lg bg-rose-50 text-rose-600 border border-rose-200 dark:bg-rose-950/40 dark:border-rose-900 flex items-center justify-center flex-shrink-0">
          <FileText className="size-4" />
        </div>
      )
    }
    if (ext.includes("xls") || ext === "csv" || ext === "gsheet" || mime.includes("spreadsheet") || mime.includes("csv")) {
      return (
        <div className="size-8 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-900 flex items-center justify-center flex-shrink-0">
          <FileSpreadsheet className="size-4" />
        </div>
      )
    }
    if (ext.includes("ppt") || ext === "gslides" || mime.includes("presentation")) {
      return (
        <div className="size-8 rounded-lg bg-amber-50 text-amber-600 border border-amber-200 dark:bg-amber-950/40 dark:border-amber-900 flex items-center justify-center flex-shrink-0">
          <Presentation className="size-4" />
        </div>
      )
    }
    if (["png", "jpg", "jpeg", "svg", "webp", "gif"].includes(ext) || mime.includes("image")) {
      return (
        <div className="size-8 rounded-lg bg-purple-50 text-purple-600 border border-purple-200 dark:bg-purple-950/40 dark:border-purple-900 flex items-center justify-center flex-shrink-0">
          <ImageIcon className="size-4" />
        </div>
      )
    }
    if (ext.includes("doc") || ext === "gdoc" || mime.includes("word") || mime.includes("document")) {
      return (
        <div className="size-8 rounded-lg bg-blue-50 text-blue-600 border border-blue-200 dark:bg-blue-950/40 dark:border-blue-900 flex items-center justify-center flex-shrink-0">
          <FileText className="size-4" />
        </div>
      )
    }
    return (
      <div className="size-8 rounded-lg bg-muted text-muted-foreground border border-border flex items-center justify-center flex-shrink-0">
        <FileIcon className="size-4" />
      </div>
    )
  }

  const getStatusBadge = (status: CoachDocument["status"], docId?: string) => {
    const live = docId ? liveProgress[docId] : null

    switch (status) {
      case "completed":
        return (
          <span className="inline-flex items-center gap-1.5 text-xs text-foreground font-medium">
            <span className="size-2 rounded-full bg-emerald-500" />
            <span>Ready</span>
          </span>
        )
      case "parsing":
        return (
          <div className="flex flex-col gap-1 min-w-[100px]">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <span className="size-2 rounded-full bg-blue-500 animate-pulse" />
              <span>{live?.details?.stage_text || "Parsing"}</span>
            </span>
            {live && <Progress value={live.percent} className="h-1" />}
          </div>
        )
      case "embedding":
        return (
          <div className="flex flex-col gap-1 min-w-[100px]">
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
              <span className="size-2 rounded-full bg-purple-500 animate-pulse" />
              <span>{live?.details?.stage_text || "Embedding"}</span>
            </span>
            {live && <Progress value={live.percent} className="h-1" />}
          </div>
        )
      case "pending":
        return (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
            <span className="size-2 rounded-full bg-amber-500" />
            <span>Queued</span>
          </span>
        )
      case "failed":
        return (
          <span className="inline-flex items-center gap-1.5 text-xs text-destructive font-medium">
            <span className="size-2 rounded-full bg-destructive" />
            <span>Failed</span>
          </span>
        )
      default:
        return (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground font-medium">
            <span className="size-2 rounded-full bg-muted-foreground/40" />
            <span>{status}</span>
          </span>
        )
    }
  }

  const formatGDriveSyncDate = (isoString?: string | null) => {
    if (!isoString) return "Pending initial scan"
    const d = new Date(isoString)
    if (isNaN(d.getTime())) return "Pending initial scan"

    const day = String(d.getDate()).padStart(2, "0")
    const month = d.toLocaleString("en-US", { month: "long" })
    const year = d.getFullYear()
    const time = d.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    })

    return `${day} - ${month} - ${year}, ${time}`
  }

  // Google Drive Modal Functions
  const fetchDriveFolders = async (parentId: string | null = null, driveId: string | null = null) => {
    try {
      setFolderLoading(true)
      let url = `${API_BASE}/api/integrations/google-drive/folders`
      const params = new URLSearchParams()
      if (parentId) params.append("parent_id", parentId)
      if (driveId) params.append("drive_id", driveId)
      if (params.toString()) url += `?${params.toString()}`

      const res = await fetchWithAuth(url)
      if (res.ok) {
        const data = await res.json()
        setFolderItems(data.folders || [])
        setFolderFiles(data.files || [])
      } else {
        const err = await res.json()
        setErrorToast(err.detail || "Failed to load folders from Google Drive.")
      }
    } catch (err: any) {
      setErrorToast(err.message || "Failed to load folders.")
    } finally {
      setFolderLoading(false)
    }
  }

  const handleOpenFolderPicker = () => {
    setFolderModalOpen(true)
    setSelectedFolder(null)
    setFolderFiles([])
    setSelectedFolderFiles([])
    setModalSearchQuery("")
    setInspectorTab("all")
    setFolderBreadcrumbs([{ id: null, name: "Google Drive" }])
    fetchDriveFolders(null, null)
  }

  const handleSelectFolder = async (item: DriveFolderItem) => {
    if (item.can_select === false) {
      handleEnterFolder(item)
      return
    }
    setSelectedFolder(item)

    try {
      setLoadingSelectedFiles(true)
      const res = await fetchWithAuth(
        `${API_BASE}/api/integrations/google-drive/folder-files?folder_id=${item.id}${item.drive_id ? `&drive_id=${item.drive_id}` : ""}`
      )
      if (res.ok) {
        const data = await res.json()
        setSelectedFolderFiles(data.files || [])
      }
    } catch (err) {
      console.warn("Could not preview selected folder files:", err)
    } finally {
      setLoadingSelectedFiles(false)
    }
  }

  const handleEnterFolder = (item: DriveFolderItem) => {
    const isSharedDrive = item.container_type === "shared_drive"
    const nextDriveId = isSharedDrive ? item.id : (item.drive_id || null)
    setFolderBreadcrumbs(prev => [...prev, { id: item.id, name: item.name, drive_id: nextDriveId }])
    setSelectedFolder(item.can_select !== false ? item : null)
    setSelectedFolderFiles([])
    setModalSearchQuery("")
    setInspectorTab("all")
    fetchDriveFolders(item.id, nextDriveId)
  }

  const handleNavigateBreadcrumb = (index: number) => {
    const target = folderBreadcrumbs[index]
    const newCrumbs = folderBreadcrumbs.slice(0, index + 1)
    setFolderBreadcrumbs(newCrumbs)
    setSelectedFolder(null)
    setSelectedFolderFiles([])
    setModalSearchQuery("")
    setInspectorTab("all")
    fetchDriveFolders(target.id, target.drive_id || null)
  }

  const handleConfirmFolderSelection = async () => {
    if (!selectedFolder || selectedFolder.can_select === false) return
    try {
      setSavingFolder(true)
      const pathParts = folderBreadcrumbs
        .filter(b => b.id !== null)
        .map(b => b.name)
      if (!pathParts.includes(selectedFolder.name)) {
        pathParts.push(selectedFolder.name)
      }
      const fullPath = `/${pathParts.join("/")}`

      const res = await fetchWithAuth(`${API_BASE}/api/integrations/google-drive/select-folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          folder_id: selectedFolder.id,
          folder_name: selectedFolder.name,
          folder_path: fullPath,
          drive_id: selectedFolder.drive_id || (selectedFolder.container_type === "shared_drive" ? selectedFolder.id : null)
        })
      })

      if (res.ok) {
        const data = await res.json()
        setSuccessToast(data.message || `Monitored folder set to "${selectedFolder.name}". Ingestion started!`)
        setFolderModalOpen(false)
        await fetchGDriveStatus()
        await fetchDocuments(1, searchQuery, statusFilter, sourceFilter)
      } else {
        const err = await res.json()
        setErrorToast(err.detail || "Failed to update monitored folder.")
      }
    } catch (err: any) {
      setErrorToast(err.message || "Failed to save monitored folder.")
    } finally {
      setSavingFolder(false)
    }
  }

  const handleConnectGDrive = async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/integrations/google-drive/auth-url`)
      if (res.ok) {
        const data = await res.json()
        if (data.auth_url) {
          const width = 600
          const height = 720
          const left = window.screenX + Math.max(0, (window.outerWidth - width) / 2)
          const top = window.screenY + Math.max(0, (window.outerHeight - height) / 2)

          const popup = window.open(
            data.auth_url,
            "GoogleDriveOAuthPopup",
            `width=${width},height=${height},left=${left},top=${top},status=no,toolbar=no,menubar=no,location=yes,resizable=yes,scrollbars=yes`
          )

          if (!popup || popup.closed || typeof popup.closed === "undefined") {
            window.location.href = data.auth_url
          } else {
            popup.focus()
          }
        }
      }
    } catch (err: any) {
      setErrorToast(err.message || "Failed to connect Google Drive.")
    }
  }

  const handleSyncGDriveNow = async () => {
    try {
      setSyncingGDrive(true)
      const res = await fetchWithAuth(`${API_BASE}/api/integrations/google-drive/sync-now`, {
        method: "POST"
      })
      if (res.ok) {
        const data = await res.json()
        setSuccessToast(data.message || "Google Drive synchronized successfully.")
        await fetchDocuments(1, searchQuery, statusFilter, sourceFilter)
        await fetchGDriveStatus()
      } else {
        const err = await res.json()
        setErrorToast(err.detail || "Sync failed.")
      }
    } catch (err: any) {
      setErrorToast(err.message || "Failed to trigger sync.")
    } finally {
      setSyncingGDrive(false)
    }
  }

  const handleDisconnectGDrive = async () => {
    if (!confirm("Are you sure you want to disconnect Google Drive? Automatic real-time ingestion will stop.")) {
      return
    }
    try {
      setDisconnectingGDrive(true)
      const res = await fetchWithAuth(`${API_BASE}/api/integrations/google-drive/disconnect`, {
        method: "POST"
      })
      if (res.ok) {
        setSuccessToast("Google Drive disconnected successfully.")
        await fetchGDriveStatus()
      }
    } catch (err: any) {
      setErrorToast(err.message || "Failed to disconnect.")
    } finally {
      setDisconnectingGDrive(false)
    }
  }

  // Filtered Modal Folders
  const filteredModalFolders = folderItems.filter(f =>
    !modalSearchQuery.trim() || f.name.toLowerCase().includes(modalSearchQuery.toLowerCase())
  )

  // Active Inspector Folder & Files Calculation
  const currentBreadcrumb = folderBreadcrumbs[folderBreadcrumbs.length - 1]
  const isInspectingSelectedSubfolder = Boolean(
    selectedFolder &&
    selectedFolder.id !== currentBreadcrumb?.id
  )

  const activeInspectorFolder = isInspectingSelectedSubfolder && selectedFolder
    ? selectedFolder
    : {
        id: currentBreadcrumb?.id || "root",
        name: currentBreadcrumb?.name || "Google Drive",
        path: "/" + folderBreadcrumbs.filter(b => b.id !== null).map(b => b.name).join("/"),
        container_type: "folder" as const,
        can_select: currentBreadcrumb?.id !== "shared_with_me" && currentBreadcrumb?.id !== null
      }

  const rawInspectorFiles = isInspectingSelectedSubfolder
    ? selectedFolderFiles
    : folderFiles

  const eligibleFilesCount = rawInspectorFiles.filter(f => f.is_supported).length
  const excludedFilesCount = rawInspectorFiles.filter(f => !f.is_supported).length
  const totalInspectorBytes = rawInspectorFiles.reduce((acc, f) => acc + (f.size_bytes || 0), 0)

  const filteredInspectorFiles = rawInspectorFiles.filter(f => {
    const matchesSearch = !modalSearchQuery.trim() || f.name.toLowerCase().includes(modalSearchQuery.toLowerCase())
    const matchesTab = inspectorTab === "all" || (inspectorTab === "eligible" ? f.is_supported : !f.is_supported)
    return matchesSearch && matchesTab
  })

  // Summary Metrics: Global company totals from backend, with local fallback
  const totalDocs = companyStats?.total_documents ?? (totalDocuments || documents.length)
  const completedDocs = companyStats?.completed_documents ?? documents.filter(d => d.status === "completed").length
  const totalChunks = companyStats?.total_chunks ?? documents.reduce((acc, d) => acc + (d.parsed_metadata?.chunks_count || 0), 0)
  const totalRows = companyStats?.total_spreadsheet_rows ?? documents.reduce((acc, d) => acc + (d.parsed_metadata?.spreadsheet_rows_count || 0), 0)

  // Filtered Chunks in Drawer
  const filteredChunks = chunksForInspect.filter(c =>
    !chunkSearchQuery.trim() || c.content.toLowerCase().includes(chunkSearchQuery.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-background p-6 md:p-10 font-sans">
      <div className="max-w-7xl mx-auto flex flex-col gap-8">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
                Performance Coach — Document Ingestion Hub
              </h1>
            </div>
            <p className="text-sm text-muted-foreground max-w-2xl">
              Upload performance reviews, KPI spreadsheets, sprint trackers, and 360 feedback decks. Line-by-line citations and vector proof chunks.
            </p>
          </div>

          <div className="flex items-center gap-2.5 self-start md:self-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fetchDocuments(currentPage, searchQuery, statusFilter, sourceFilter)}
              disabled={loading}
              className="gap-2 text-xs"
            >
              <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
              <span>Refresh Status</span>
            </Button>

            {hydratedManagerOrAbove && (
              <Button
                size="sm"
                onClick={() => setIsUploadDrawerOpen(true)}
                className="gap-2 text-xs shadow-sm"
              >
                <Upload className="size-3.5" />
                <span>+ Ingest Evidence</span>
              </Button>
            )}
          </div>
        </div>



        {/* Top Metric Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card className="shadow-2xs">
            <CardHeader className="p-4 pb-1">
              <CardDescription className="text-[11px] font-semibold uppercase tracking-wider">Total Documents</CardDescription>
              <CardTitle className="text-2xl font-bold text-foreground">{totalDocs}</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-1 text-xs text-muted-foreground">
              Uploaded to company vault
            </CardContent>
          </Card>

          <Card className="shadow-2xs">
            <CardHeader className="p-4 pb-1">
              <CardDescription className="text-[11px] font-semibold uppercase tracking-wider">Indexed & Ready</CardDescription>
              <CardTitle className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{completedDocs}</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-1 text-xs text-muted-foreground">
              Ready for Coach queries
            </CardContent>
          </Card>

          <Card className="shadow-2xs">
            <CardHeader className="p-4 pb-1">
              <CardDescription className="text-[11px] font-semibold uppercase tracking-wider">Vector Chunks</CardDescription>
              <CardTitle className="text-2xl font-bold text-primary">{totalChunks.toLocaleString()}</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-1 text-xs text-muted-foreground">
              1024-dim proof embeddings
            </CardContent>
          </Card>

          <Card className="shadow-2xs">
            <CardHeader className="p-4 pb-1">
              <CardDescription className="text-[11px] font-semibold uppercase tracking-wider">Spreadsheet Rows</CardDescription>
              <CardTitle className="text-2xl font-bold text-purple-600 dark:text-purple-400">{totalRows.toLocaleString()}</CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-1 text-xs text-muted-foreground">
              Exact JSONB tabular records
            </CardContent>
          </Card>
        </div>

        {/* Primary Navigation Tabs */}
        <Tabs value={activeHubTab} onValueChange={(val) => setActiveHubTab(val as any)} className="w-full flex flex-col gap-6">
          <TabsList className="w-full justify-start border-b rounded-none h-auto p-0 bg-transparent gap-4">
            <TabsTrigger
              value="documents"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none pb-3 px-2 gap-2 text-xs font-bold"
            >
              <FileText className="size-4" />
              <span>All Documents</span>
              <Badge variant="secondary" className="px-1.5 py-0.2 text-[10px]">
                {totalDocuments}
              </Badge>
            </TabsTrigger>

            {hydratedManagerOrAbove && (
              <TabsTrigger
                value="connectors"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none pb-3 px-2 gap-2 text-xs font-bold"
              >
                <FolderSync className="size-4" />
                <span>Cloud Integrations</span>
                {gdriveStatus?.connected && (
                  <Badge variant="outline" className="border-emerald-300 text-emerald-700 bg-emerald-50 px-1.5 py-0.2 text-[10px]">
                    1 Active
                  </Badge>
                )}
              </TabsTrigger>
            )}

            <TabsTrigger
              value="logs"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none pb-3 px-2 gap-2 text-xs font-bold"
            >
              <Clock className="size-4" />
              <span>Processing Queue & Logs</span>
              {Object.keys(liveProgress).length > 0 && (
                <Badge variant="outline" className="border-amber-300 text-amber-700 bg-amber-50 px-1.5 py-0.2 text-[10px] animate-pulse">
                  Live
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* Tab 1: All Documents */}
          <TabsContent value="documents" className="mt-0 flex flex-col gap-6">
            {/* Non-Manager Role Alert */}
            {!hydratedManagerOrAbove && (
              <Card className="border-border/80 shadow-2xs">
                <CardContent className="p-4 flex items-start gap-3.5">
                  <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                    <ShieldCheck className="size-4" />
                  </div>
                  <div>
                    <h3 className="text-xs font-bold text-foreground">Role-Scoped Document Vault</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Viewing personal coaching feedback, shared manager reviews, and team documents authorized for your account. Ingestion and cloud source management require manager privileges.
                    </p>
                  </div>
                </CardContent>
              </Card>
            )}


            {/* Documents Registry Table Card */}
            <Card className="overflow-hidden shadow-sm">
              <CardHeader className="p-5 border-b flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <CardTitle className="text-base font-bold">Ingested Documents & Citations</CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    Every file is parsed into semantic rows and vector chunks with page and cell citations.
                  </CardDescription>
                </div>

                {/* Filter Toolbar */}
                <div className="flex flex-wrap items-center gap-2.5">
                  <div className="relative">
                    <Search className="size-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      placeholder="Search file name..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="pl-8 text-xs h-8 w-44 sm:w-56"
                    />
                  </div>

                  {/* Dynamic Select for Source Filter */}
                  <Select value={sourceFilter} onValueChange={(val) => setSourceFilter(val)}>
                    <SelectTrigger className="text-xs h-8 w-44">
                      <SelectValue placeholder="All Sources" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="all">All Sources</SelectItem>
                        <SelectItem value="manual">Manual Upload</SelectItem>
                        {dynamicConnectors.map((c) => (
                          <SelectItem key={c.provider} value={c.provider}>
                            {c.display_name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>

                  {/* Select for Status Filter */}
                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger className="text-xs h-8 w-36">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="all">All Statuses</SelectItem>
                        <SelectItem value="completed">Ready for AI</SelectItem>
                        <SelectItem value="parsing">Parsing</SelectItem>
                        <SelectItem value="embedding">Embedding</SelectItem>
                        <SelectItem value="failed">Failed</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>

              {/* Table Content */}
              {!loading && documents.length === 0 ? (
                <div className="p-12 text-center flex flex-col items-center justify-center">
                  <div className="size-12 rounded-2xl bg-muted/60 border flex items-center justify-center text-muted-foreground mb-3">
                    <Database className="size-6 text-muted-foreground/60" />
                  </div>
                  <div className="text-sm font-semibold text-foreground">No documents found</div>
                  <p className="text-xs text-muted-foreground mt-1 max-w-sm mb-4">
                    {searchQuery || statusFilter !== "all" || sourceFilter !== "all"
                      ? "No documents match your active filters. Try adjusting your search or filters."
                      : "Upload your first performance review, sprint sheet, or OKR document to get started."}
                  </p>
                  {hydratedManagerOrAbove && (
                    <Button
                      size="sm"
                      onClick={() => setIsUploadDrawerOpen(true)}
                      className="gap-2 text-xs font-semibold"
                    >
                      <Upload className="size-3.5" />
                      <span>Ingest Your First Document</span>
                    </Button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader className="bg-muted/40">
                      <TableRow>
                        <TableHead className="w-10 py-3 px-3 text-center">
                          <Checkbox
                            checked={isAllCurrentPageSelected ? true : isSomeCurrentPageSelected ? "indeterminate" : false}
                            onCheckedChange={handleToggleSelectAll}
                            aria-label="Select all documents on this page"
                          />
                        </TableHead>
                        <TableHead className="py-3 px-4">Document</TableHead>
                        <TableHead className="py-3 px-4">Source</TableHead>
                        <TableHead className="py-3 px-4">Category</TableHead>
                        <TableHead className="py-3 px-4">Status</TableHead>
                        <TableHead className="py-3 px-4">Chunks / Rows</TableHead>
                        <TableHead className="py-3 px-4">Target Scope</TableHead>
                        <TableHead className="py-3 px-4">Uploaded</TableHead>
                        <TableHead className="py-3 px-4 text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? (
                        Array.from({ length: 5 }).map((_, i) => (
                          <TableRow key={i} className="hover:bg-transparent">
                            <TableCell className="w-10 py-3.5 px-3 text-center">
                              <Skeleton className="size-4 rounded" />
                            </TableCell>
                            <TableCell className="py-3.5 px-4">
                              <div className="flex items-center gap-3">
                                <Skeleton className="size-8 rounded-lg shrink-0" />
                                <div className="flex flex-col gap-1.5 flex-1">
                                  <Skeleton className="h-4 w-40" />
                                  <Skeleton className="h-3 w-16" />
                                </div>
                              </div>
                            </TableCell>
                            <TableCell className="py-3.5 px-4"><Skeleton className="h-5 w-20 rounded-md" /></TableCell>
                            <TableCell className="py-3.5 px-4"><Skeleton className="h-5 w-20 rounded-md" /></TableCell>
                            <TableCell className="py-3.5 px-4"><Skeleton className="h-5 w-20 rounded-md" /></TableCell>
                            <TableCell className="py-3.5 px-4"><Skeleton className="h-5 w-16 rounded-md" /></TableCell>
                            <TableCell className="py-3.5 px-4"><Skeleton className="h-5 w-16 rounded-md" /></TableCell>
                            <TableCell className="py-3.5 px-4"><Skeleton className="h-4 w-24" /></TableCell>
                            <TableCell className="py-3.5 px-4 text-right"><Skeleton className="h-8 w-8 rounded-md ml-auto" /></TableCell>
                          </TableRow>
                        ))
                      ) : (
                        <TooltipProvider>
                          {documents.map((doc) => {
                          const meta = doc.parsed_metadata || {}
                          const chunksCount = meta.chunks_count ?? meta.total_chunks ?? meta.chunk_count ?? 0
                          const rowsCount = meta.spreadsheet_rows_count ?? meta.total_rows ?? meta.stored_rows ?? 0
                          const empTarget = employees.find(e => e.user_id === doc.target_employee_id)
                          const isGoogleDrive = doc.manual_description?.toLowerCase().includes("google drive") || doc.gdrive_file_id || meta.source === "google_drive" || meta.is_google_doc
                          const isPlaybookDoc = Boolean(meta.is_playbook || meta.category === "Playbook" || doc.manual_description?.toLowerCase().includes("playbook"))

                          const isSelected = selectedDocIds.has(doc.id)

                          return (
                            <TableRow 
                              key={doc.id} 
                              className={cn(
                                "cursor-pointer transition-colors",
                                isSelected && "bg-muted/40"
                              )}
                              onClick={() => {
                                setInspectDoc(doc)
                                setInspectDrawerTab("overview")
                                loadChunksForInspection(doc.id)
                                if (hydratedManagerOrAbove) loadDocPermissions(doc.id)
                              }}
                            >
                              {/* Row Selection Checkbox */}
                              <TableCell className="w-10 py-3.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={() => handleToggleSelectDoc(doc.id)}
                                  aria-label={`Select ${doc.file_name}`}
                                />
                              </TableCell>

                              {/* Document Column: Extension stripped from displayed name, [TYPE] badge kept */}
                              <TableCell className="py-3.5 px-4">
                                <div className="flex items-center gap-3">
                                  {getFileIcon(doc.file_type)}
                                  <div className="flex flex-col gap-0.5 min-w-0">
                                    <div className="font-semibold text-foreground flex items-center gap-2 flex-wrap">
                                      <span className="truncate max-w-xs" title={doc.file_name}>
                                        {getCleanFileName(doc.file_name)}
                                      </span>
                                      <Badge variant="secondary" className="uppercase text-[9px] font-bold px-1.5 py-0 tracking-wider">
                                        {doc.file_type}
                                      </Badge>
                                      {doc.version && doc.version > 1 && (
                                        <Badge variant="outline" className="border-primary/40 text-primary text-[9px] font-bold px-1.5 py-0">
                                          v{doc.version}
                                        </Badge>
                                      )}
                                    </div>
                                    <div className="text-[11px] text-muted-foreground font-mono">
                                      {formatBytes(doc.file_size_bytes)}
                                    </div>
                                  </div>
                                </div>
                              </TableCell>

                              {/* Dedicated Source Column: Subtle Muted Icon & Text (Not Fancy) */}
                              <TableCell className="py-3.5 px-4 whitespace-nowrap">
                                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                  {isGoogleDrive ? (
                                    <>
                                      <FolderSync className="size-3.5 text-muted-foreground" />
                                      <span>Google Drive</span>
                                    </>
                                  ) : (
                                    <>
                                      <Upload className="size-3.5 text-muted-foreground" />
                                      <span>Manual</span>
                                    </>
                                  )}
                                </div>
                              </TableCell>

                              {/* Dedicated Category Column: Clean Subtle Label */}
                              <TableCell className="py-3.5 px-4 whitespace-nowrap">
                                {isPlaybookDoc ? (
                                  <span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                                    <BookOpen className="size-3 text-emerald-600 dark:text-emerald-400" />
                                    <span>Playbook</span>
                                  </span>
                                ) : (
                                  <span className="text-xs text-muted-foreground">Evidence</span>
                                )}
                              </TableCell>

                              {/* Status Column */}
                              <TableCell className="py-3.5 px-4 whitespace-nowrap">
                                {getStatusBadge(doc.status, doc.id)}
                              </TableCell>

                              {/* Chunks / Rows Column: Singular/Plural Grammar */}
                              <TableCell className="py-3.5 px-4 text-xs whitespace-nowrap">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {chunksCount > 0 && (
                                    <Badge variant="secondary" className="font-medium text-primary text-[10px] px-2 py-0.5">
                                      {chunksCount} {chunksCount === 1 ? "chunk" : "chunks"}
                                    </Badge>
                                  )}
                                  {rowsCount > 0 && (
                                    <Badge variant="secondary" className="font-medium text-purple-600 dark:text-purple-400 text-[10px] px-2 py-0.5">
                                      {rowsCount} {rowsCount === 1 ? "row" : "rows"}
                                    </Badge>
                                  )}
                                  {chunksCount === 0 && rowsCount === 0 && doc.status === "completed" && (
                                    <span className="text-muted-foreground text-xs">—</span>
                                  )}
                                </div>
                              </TableCell>

                              {/* Target Scope Column: Subtle Org-wide badge */}
                              <TableCell className="py-3.5 px-4 text-xs whitespace-nowrap">
                                {empTarget ? (
                                  <Badge variant="outline" className="gap-1 font-medium text-foreground bg-background">
                                    <UserCheck className="size-3 text-primary" />
                                    <span className="truncate max-w-[120px]">{empTarget.name}</span>
                                  </Badge>
                                ) : (
                                  <Badge variant="secondary" className="text-[10px] font-normal text-muted-foreground bg-muted/60 border-transparent">
                                    Org-wide
                                  </Badge>
                                )}
                              </TableCell>

                              <TableCell className="py-3.5 px-4 text-xs text-muted-foreground whitespace-nowrap">
                                {new Date(doc.created_at).toLocaleDateString([], {
                                  month: "short",
                                  day: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit"
                                })}
                              </TableCell>

                              <TableCell className="py-3.5 px-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="size-8 text-muted-foreground hover:text-foreground"
                                    >
                                      <MoreHorizontal className="size-4" />
                                      <span className="sr-only">Document Options</span>
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-56">
                                    <DropdownMenuLabel className="text-xs">Document Options</DropdownMenuLabel>
                                    <DropdownMenuGroup>
                                      <DropdownMenuItem
                                        onClick={() => {
                                          setInspectDoc(doc)
                                          setInspectDrawerTab("chunks")
                                          loadChunksForInspection(doc.id)
                                        }}
                                      >
                                        <Eye className="size-4 mr-2 text-primary" />
                                        <span>Inspect Vector Chunks</span>
                                      </DropdownMenuItem>

                                      {hydratedManagerOrAbove && (
                                        <DropdownMenuItem
                                          onClick={() => {
                                            handleTogglePlaybook(doc.id, Boolean(meta.is_playbook || meta.category === "Playbook"))
                                          }}
                                        >
                                          <BookOpen className="size-4 mr-2 text-emerald-600" />
                                          <span>
                                            {meta.is_playbook || meta.category === "Playbook"
                                              ? "Revoke Playbook"
                                              : "Mark as Playbook"}
                                          </span>
                                        </DropdownMenuItem>
                                      )}

                                      <DropdownMenuItem
                                        onClick={() => {
                                          setInspectDoc(doc)
                                          setInspectDrawerTab("overview")
                                          loadChunksForInspection(doc.id)
                                        }}
                                      >
                                        <FileText className="size-4 mr-2 text-muted-foreground" />
                                        <span>Overview & Details</span>
                                      </DropdownMenuItem>

                                      <DropdownMenuItem onClick={() => handleDownloadOriginal(doc.id)}>
                                        <Download className="size-4 mr-2 text-muted-foreground" />
                                        <span>Download Original</span>
                                      </DropdownMenuItem>

                                      {hydratedManagerOrAbove && (
                                        <DropdownMenuItem
                                          onClick={() => {
                                            setInspectDoc(doc)
                                            setInspectDrawerTab("permissions")
                                            loadDocPermissions(doc.id)
                                          }}
                                        >
                                          <Share2 className="size-4 mr-2 text-emerald-600" />
                                          <span>Access Permissions</span>
                                        </DropdownMenuItem>
                                      )}

                                      {doc.web_view_link && (
                                        <DropdownMenuItem asChild>
                                          <a href={doc.web_view_link} target="_blank" rel="noopener noreferrer">
                                            <ExternalLink className="size-4 mr-2 text-sky-600" />
                                            <span>Open in Google Drive</span>
                                          </a>
                                        </DropdownMenuItem>
                                      )}
                                    </DropdownMenuGroup>

                                    {hydratedAdminOrAbove && (
                                      <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuItem
                                          className="text-destructive focus:text-destructive focus:bg-destructive/10"
                                          onClick={() => handleDelete(doc.id, doc.file_name)}
                                        >
                                          <Trash2 className="size-4 mr-2" />
                                          <span>Delete Document</span>
                                        </DropdownMenuItem>
                                      </>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </TableCell>
                            </TableRow>
                          )
                        })}
                      </TooltipProvider>
                    )}
                  </TableBody>
                  </Table>

                  {/* Server-Side Pagination Bar */}
                  <CardFooter className="p-4 border-t bg-muted/20 flex items-center justify-between text-xs text-muted-foreground">
                    <div>
                      Showing {documents.length > 0 ? (currentPage - 1) * 25 + 1 : 0} to {Math.min(currentPage * 25, totalDocuments)} of {totalDocuments} document(s)
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fetchDocuments(currentPage - 1, searchQuery, statusFilter, sourceFilter)}
                        disabled={currentPage <= 1 || loading}
                        className="h-8 text-xs"
                      >
                        Previous
                      </Button>
                      <span className="font-semibold text-foreground px-1">
                        Page {currentPage} of {totalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => fetchDocuments(currentPage + 1, searchQuery, statusFilter, sourceFilter)}
                        disabled={currentPage >= totalPages || loading}
                        className="h-8 text-xs"
                      >
                        Next
                      </Button>
                    </div>
                  </CardFooter>
                </div>
              )}
            </Card>
          </TabsContent>

          {/* Tab 2: Cloud Integrations */}
          {hydratedManagerOrAbove && (
            <TabsContent value="connectors" className="mt-0">
              {!mounted || (!rolesLoaded && authLoading) ? (
                <Card>
                  <CardContent className="p-8 text-center text-xs text-muted-foreground flex flex-col items-center justify-center gap-2">
                    <RefreshCw className="size-5 animate-spin text-primary" />
                    <span>Verifying workspace permissions...</span>
                  </CardContent>
                </Card>
              ) : (
                <UnifiedConnectorsHub
                  isAdminOrAbove={hydratedAdminOrAbove}
                  onIngestionTriggered={() => fetchDocuments(1, searchQuery, statusFilter, sourceFilter)}
                  onErrorToast={(msg) => setErrorToast(msg)}
                  onSuccessToast={(msg) => setSuccessToast(msg)}
                />
              )}
            </TabsContent>
          )}

          {/* Tab 3: Processing Queue & Logs */}
          <TabsContent value="logs" className="mt-0 flex flex-col gap-6">
            <Card>
              <CardHeader className="p-5 border-b flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-base font-bold">Live Ingestion Queue</CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    Real-time SSE event pipeline for document parsing and vector chunk embeddings
                  </CardDescription>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => fetchDocuments(1, searchQuery, statusFilter, sourceFilter)}
                  className="gap-1.5 text-xs h-8"
                >
                  <RefreshCw className="size-3.5" />
                  <span>Refresh Queue</span>
                </Button>
              </CardHeader>
              <CardContent className="p-6">
                {Object.keys(liveProgress).length === 0 ? (
                  <div className="py-12 text-center text-muted-foreground flex flex-col items-center justify-center gap-2">
                    <Clock className="size-8 text-muted-foreground/30" />
                    <p className="text-xs font-semibold text-foreground">No active background tasks in progress</p>
                    <p className="text-[11px] text-muted-foreground">When documents are uploaded or cloud sync starts, progress tracks here in real time.</p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {Object.entries(liveProgress).map(([docId, prog]) => {
                      const doc = documents.find(d => d.id === docId)
                      return (
                        <Card key={docId} className="border-border/80">
                          <CardContent className="p-4 flex flex-col gap-2">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-semibold text-foreground">{doc?.file_name || `Document ID: ${docId}`}</span>
                              <Badge variant="outline" className="font-mono text-primary font-bold">
                                {prog.percent}%
                              </Badge>
                            </div>
                            <Progress value={prog.percent} className="h-2" />
                            <div className="text-[11px] text-muted-foreground flex items-center justify-between">
                              <span>Stage: {prog.details?.stage_text || prog.stage}</span>
                              <span className="font-mono text-[10px]">{prog.stage}</span>
                            </div>
                          </CardContent>
                        </Card>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="p-5 border-b">
                <CardTitle className="text-base font-bold">Vault Health Summary</CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Diagnostic status breakdown of all files in company vault
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <Card className="border-emerald-200/80 bg-emerald-50/50 dark:bg-emerald-950/20 shadow-none">
                    <CardHeader className="p-4 pb-1">
                      <CardDescription className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">Ready for AI Coach</CardDescription>
                      <CardTitle className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">{completedDocs}</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-1 text-[11px] text-emerald-600 dark:text-emerald-300">
                      Vectors and citations generated
                    </CardContent>
                  </Card>

                  <Card className="border-amber-200/80 bg-amber-50/50 dark:bg-amber-950/20 shadow-none">
                    <CardHeader className="p-4 pb-1">
                      <CardDescription className="text-xs font-semibold text-amber-800 dark:text-amber-300">In Pipeline / Queued</CardDescription>
                      <CardTitle className="text-2xl font-bold text-amber-700 dark:text-amber-400">
                        {documents.filter(d => d.status === "pending" || d.status === "parsing" || d.status === "embedding").length}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-1 text-[11px] text-amber-600 dark:text-amber-300">
                      Currently being processed
                    </CardContent>
                  </Card>

                  <Card className="border-rose-200/80 bg-rose-50/50 dark:bg-rose-950/20 shadow-none">
                    <CardHeader className="p-4 pb-1">
                      <CardDescription className="text-xs font-semibold text-rose-800 dark:text-rose-300">Ingestion Errors</CardDescription>
                      <CardTitle className="text-2xl font-bold text-rose-700 dark:text-rose-400">
                        {documents.filter(d => d.status === "failed").length}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="p-4 pt-1 text-[11px] text-rose-600 dark:text-rose-300">
                      Failed parsing or signature check
                    </CardContent>
                  </Card>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Slide-Over Ingestion Drawer using shadcn Sheet */}
        <Sheet open={isUploadDrawerOpen} onOpenChange={setIsUploadDrawerOpen}>
          <SheetContent side="right" className="w-full sm:max-w-xl flex flex-col gap-0 p-0 overflow-hidden">
            <SheetHeader className="p-6 border-b">
              <SheetTitle className="flex items-center gap-2.5 text-base">
                <div className="size-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center flex-shrink-0">
                  <Upload className="size-4.5" />
                </div>
                <span>Upload Performance Evidence</span>
              </SheetTitle>
              <SheetDescription className="text-xs">
                Bulk upload reviews, OKRs, spreadsheets & decks with line citations
              </SheetDescription>
            </SheetHeader>

            <ScrollArea className="flex-1 p-6">
              <form onSubmit={handlePreflightAndUpload} className="flex flex-col gap-5">
              {/* Drop Zone */}
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition flex flex-col items-center justify-center gap-3",
                  isDragOver
                    ? "border-primary bg-primary/5"
                    : selectedFiles.length > 0
                      ? "border-emerald-400 bg-emerald-50/20 dark:bg-emerald-950/20"
                      : "border-border hover:border-primary/50 bg-muted/30"
                )}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleFileChange}
                  accept=".pdf,.docx,.doc,.csv,.xlsx,.xls,.pptx,.ppt"
                  className="hidden"
                />

                {selectedFiles.length > 0 ? (
                  <div className="w-full flex flex-col gap-2">
                    <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider text-left">
                      Selected Documents ({selectedFiles.length})
                    </div>
                    <div className="max-h-44 overflow-y-auto flex flex-col gap-1.5 p-1">
                      {selectedFiles.map((file, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between p-2.5 bg-background rounded-lg border border-border shadow-2xs"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex items-center gap-2.5 truncate">
                            {getFileIcon(file.name.split(".").pop() || "")}
                            <div className="truncate text-left">
                              <span className="text-xs font-semibold text-foreground truncate block">
                                {file.name}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {formatBytes(file.size)}
                              </span>
                            </div>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeSelectedFile(idx)}
                            className="size-6 text-muted-foreground hover:text-destructive"
                          >
                            <X className="size-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-primary font-medium text-center pt-1">
                      Click to browse more or drag additional files here
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="size-11 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                      <Upload className="size-5" />
                    </div>
                    <div>
                      <span className="text-sm font-semibold text-primary">Click to browse files</span>
                      <span className="text-sm text-muted-foreground"> or drag and drop</span>
                    </div>
                    <div className="flex flex-wrap items-center justify-center gap-1.5 mt-1 text-[11px] text-muted-foreground">
                      <Badge variant="secondary" className="text-[10px]">PDF</Badge>
                      <Badge variant="secondary" className="text-[10px]">DOCX</Badge>
                      <Badge variant="secondary" className="text-[10px]">Excel</Badge>
                      <Badge variant="secondary" className="text-[10px]">CSV</Badge>
                      <Badge variant="secondary" className="text-[10px]">PowerPoint</Badge>
                    </div>
                  </>
                )}
              </div>

              {/* Target Scope */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="target-scope" className="text-xs font-semibold">Target Scope</Label>
                <Select value={targetEmployeeId} onValueChange={setTargetEmployeeId}>
                  <SelectTrigger id="target-scope" className="text-xs">
                    <SelectValue placeholder="General / Team-Wide Policy" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectGroup>
                      <SelectItem value="general">🏢 General / Team-Wide Policy (Company Default)</SelectItem>
                      {employees.map(emp => (
                        <SelectItem key={emp.user_id} value={emp.user_id}>
                          👤 {emp.name} ({emp.email})
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Tagging an employee scopes citations to that employee and their reporting hierarchy.
                </p>
              </div>

              {/* Playbook Checkbox */}
              <div className="p-3.5 rounded-xl border bg-muted/30 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <BookOpen className={cn("size-4", isPlaybook ? "text-primary" : "text-muted-foreground")} />
                  <div>
                    <Label htmlFor="playbook-toggle" className="text-xs font-semibold cursor-pointer">Company Playbook / SOP</Label>
                    <p className="text-[10px] text-muted-foreground">Expose in Chat Playbooks directory for all employees</p>
                  </div>
                </div>
                <Checkbox
                  id="playbook-toggle"
                  checked={isPlaybook}
                  onCheckedChange={(checked) => {
                    setIsPlaybook(Boolean(checked))
                    if (checked) {
                      setTargetEmployeeId("general")
                      setIsPrivateManagerNote(false)
                    }
                  }}
                />
              </div>

              {/* Private Manager Note */}
              {targetEmployeeId && targetEmployeeId !== "general" && !isPlaybook && (
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="private-note"
                    checked={isPrivateManagerNote}
                    onCheckedChange={(checked) => setIsPrivateManagerNote(Boolean(checked))}
                  />
                  <Label htmlFor="private-note" className="text-xs cursor-pointer">
                    <strong>Private Manager Note</strong> (hide from employee; visible only to management)
                  </Label>
                </div>
              )}

              {/* Document Description */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="manual-description" className="text-xs font-semibold">Document Description</Label>
                <Input
                  id="manual-description"
                  placeholder="e.g. Q3 2024 Engineering performance appraisals and OKRs"
                  value={manualDescription}
                  onChange={(e) => setManualDescription(e.target.value)}
                  className="text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Detailed summary for semantic retrieval and agent reasoning.
                </p>
              </div>

              {uploadProgressText && (
                <p className="text-xs text-primary font-medium text-right animate-pulse">
                  {uploadProgressText}
                </p>
              )}
            </form>
            </ScrollArea>

            <SheetFooter className="p-4 border-t bg-muted/20 flex sm:flex-row sm:items-center sm:justify-between gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setIsUploadDrawerOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handlePreflightAndUpload}
                disabled={selectedFiles.length === 0 || uploading}
                className="gap-2 shadow-sm font-semibold"
              >
                {uploading ? (
                  <>
                    <Layers className="size-3.5 animate-spin" />
                    <span>Ingesting Batch...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="size-3.5" />
                    <span>Upload & Ingest {selectedFiles.length > 0 ? `(${selectedFiles.length})` : ""}</span>
                  </>
                )}
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>

        {/* Interactive Conflict Resolution Modal */}
        <Dialog open={conflictModalOpen} onOpenChange={setConflictModalOpen}>
          <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col gap-0 p-0 overflow-hidden">
            <DialogHeader className="p-6 border-b pb-4">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-600 flex items-center justify-center shrink-0">
                  <ShieldAlert className="size-5" />
                </div>
                <div className="flex flex-col gap-1 text-left">
                  <DialogTitle className="text-base font-bold text-foreground">
                    Document Conflict Detected
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground">
                    One or more files already exist in your coach knowledge base. Choose how to resolve each item.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <ScrollArea className="p-6 max-h-[55vh]">
              <div className="flex flex-col gap-4">
              {preflightConflicts.map((c) => {
                if (c.status === "clean") return null
                const resMode = conflictResolutions[c.file_name] || (c.status === "exists_identical" ? "skip" : "overwrite")

                return (
                  <div key={c.file_name} className="p-4 rounded-xl border bg-muted/30 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col gap-1">
                        <div className="font-semibold text-foreground text-sm flex items-center gap-2">
                          <span className="truncate max-w-sm">{c.file_name}</span>
                          <Badge 
                            variant={c.status === "exists_identical" ? "outline" : "secondary"}
                            className={c.status === "exists_identical" 
                              ? "bg-amber-50 text-amber-700 border-amber-200 text-[10px]" 
                              : "bg-blue-50 text-blue-700 border-blue-200 text-[10px]"}
                          >
                            {c.status === "exists_identical" ? "Identical Duplicate" : "Modified Version"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">{c.message}</p>
                      </div>
                    </div>

                    <RadioGroup
                      value={resMode}
                      onValueChange={(val) => setConflictResolutions(prev => ({ ...prev, [c.file_name]: val as "overwrite" | "version" | "skip" }))}
                      className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-xs"
                    >
                      <label className={`flex items-center gap-2.5 p-3 rounded-lg border cursor-pointer transition ${
                        resMode === "overwrite" ? "bg-primary/5 border-primary text-primary font-semibold" : "bg-card border-border text-foreground hover:bg-muted/50"
                      }`}>
                        <RadioGroupItem value="overwrite" id={`overwrite_${c.file_name}`} />
                        <span className="text-xs">Overwrite in-place</span>
                      </label>

                      <label className={`flex items-center gap-2.5 p-3 rounded-lg border cursor-pointer transition ${
                        resMode === "version" ? "bg-primary/5 border-primary text-primary font-semibold" : "bg-card border-border text-foreground hover:bg-muted/50"
                      }`}>
                        <RadioGroupItem value="version" id={`version_${c.file_name}`} />
                        <span className="text-xs">Keep both (Version)</span>
                      </label>

                      <label className={`flex items-center gap-2.5 p-3 rounded-lg border cursor-pointer transition ${
                        resMode === "skip" ? "bg-primary/5 border-primary text-primary font-semibold" : "bg-card border-border text-foreground hover:bg-muted/50"
                      }`}>
                        <RadioGroupItem value="skip" id={`skip_${c.file_name}`} />
                        <span className="text-xs">Skip file</span>
                      </label>
                    </RadioGroup>
                  </div>
                )
              })}
              </div>
            </ScrollArea>

            <DialogFooter className="p-4 border-t bg-muted/20 flex flex-row items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConflictModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => executeUploadBatch(selectedFiles, conflictResolutions)}
                className="font-semibold shadow-xs"
              >
                Apply & Upload Batch
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Vector Chunk Inspector Drawer */}
        <Sheet open={Boolean(inspectDoc)} onOpenChange={(open) => !open && setInspectDoc(null)}>
          <SheetContent side="right" className="w-full sm:max-w-2xl p-0 flex flex-col gap-0 h-full overflow-hidden">
            {inspectDoc && (
              <>
                {/* Drawer Header */}
                <SheetHeader className="p-6 border-b pb-4 flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex flex-col gap-1 min-w-0 text-left">
                      <div className="flex items-center gap-2">
                        {getFileIcon(inspectDoc.file_type)}
                        <SheetTitle className="text-base font-bold text-foreground truncate max-w-md">
                          {inspectDoc.file_name}
                        </SheetTitle>
                      </div>
                      <SheetDescription className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{formatBytes(inspectDoc.file_size_bytes)}</span>
                        <span>•</span>
                        <span className="uppercase">{inspectDoc.file_type}</span>
                        {inspectDoc.version && inspectDoc.version > 1 && (
                          <>
                            <span>•</span>
                            <span className="text-primary font-semibold">Version {inspectDoc.version}</span>
                          </>
                        )}
                      </SheetDescription>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0 pr-6">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8"
                        onClick={() => handleDownloadOriginal(inspectDoc.id)}
                        disabled={downloadingUrl}
                        title="Download Original"
                      >
                        <Download className="size-4" />
                      </Button>
                    </div>
                  </div>
                </SheetHeader>

                {/* Drawer Tabs */}
                <Tabs 
                  value={inspectDrawerTab} 
                  onValueChange={(val) => {
                    const tabVal = val as "overview" | "chunks" | "permissions"
                    setInspectDrawerTab(tabVal)
                    if (tabVal === "chunks" && chunksForInspect.length === 0) {
                      loadChunksForInspection(inspectDoc.id)
                    } else if (tabVal === "permissions") {
                      loadDocPermissions(inspectDoc.id)
                    }
                  }} 
                  className="flex-1 flex flex-col overflow-hidden"
                >
                  <div className="px-6 border-b">
                    <TabsList className="bg-transparent h-11 p-0 gap-6">
                      <TabsTrigger 
                        value="overview" 
                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-1 text-xs font-semibold"
                      >
                        Overview & Metadata
                      </TabsTrigger>
                      <TabsTrigger 
                        value="chunks" 
                        className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-1 text-xs font-semibold"
                      >
                        Vector Chunks ({inspectDoc.parsed_metadata?.chunks_count ?? inspectDoc.parsed_metadata?.total_chunks ?? inspectDoc.parsed_metadata?.chunk_count ?? chunksForInspect.length})
                      </TabsTrigger>
                      {hydratedManagerOrAbove && (
                        <TabsTrigger 
                          value="permissions" 
                          className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-1 text-xs font-semibold flex items-center gap-1.5"
                        >
                          <Share2 className="size-3.5" />
                          Permissions ({docPermissions.length})
                        </TabsTrigger>
                      )}
                    </TabsList>
                  </div>

                  <ScrollArea className="flex-1 p-6">
                    <TabsContent value="permissions" className="mt-0 flex flex-col gap-5">
                      <form onSubmit={handleGrantDocShare} className="p-4 rounded-xl border bg-muted/40 flex flex-col gap-3">
                        <div className="text-xs font-bold text-foreground">Grant or Deny Access</div>
                        <div className="flex flex-col gap-1.5">
                          <Label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                            Target Team, Department, or User
                          </Label>
                          <select
                            value={docShareSubjectKey}
                            onChange={e => setDocShareSubjectKey(e.target.value)}
                            required
                            className="w-full px-3 py-2 bg-background border rounded-lg text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                          >
                            <option value="">Select target...</option>
                            {docShareTargets.map(t => (
                              <option key={`${t.subject_type}:${t.id}`} value={`${t.subject_type}:${t.id}`}>
                                {t.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex items-center gap-2">
                          <select
                            value={docShareRelation}
                            onChange={e => setDocShareRelation(e.target.value as "viewer" | "deny_viewer")}
                            className="flex-1 px-3 py-2 bg-background border rounded-lg text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-primary"
                          >
                            <option value="viewer">Allow Querying (Viewer)</option>
                            <option value="deny_viewer">Explicit Deny Override</option>
                          </select>
                          <Button
                            type="submit"
                            size="sm"
                            disabled={!docShareSubjectKey || savingDocShare}
                            className="font-semibold text-xs"
                          >
                            {savingDocShare ? "Applying..." : "Apply"}
                          </Button>
                        </div>
                      </form>

                      <div className="flex flex-col gap-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                            Active Shared Permissions ({docPermissions.length})
                          </span>
                          {loadingDocPerms && <RefreshCw className="size-3.5 animate-spin text-primary" />}
                        </div>

                        {docPermissions.length === 0 ? (
                          <div className="p-6 text-center text-xs text-muted-foreground bg-muted/30 rounded-xl border border-dashed">
                            No explicit document-level shares added yet.
                          </div>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {docPermissions.map(perm => {
                              const rowKey = `${perm.subject_type}:${perm.subject_id}:${perm.relation}`
                              const isDeny = perm.relation === "deny_viewer" || perm.relation === "deny"
                              const isRevoking = revokingDocPermKey === rowKey
                              return (
                                <div
                                  key={rowKey}
                                  className="flex items-center justify-between gap-3 p-3 bg-card rounded-xl border shadow-2xs"
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <div
                                      className={`size-8 rounded-lg flex items-center justify-center shrink-0 ${
                                        isDeny ? "bg-rose-50 text-rose-600" : "bg-emerald-50 text-emerald-600"
                                      }`}
                                    >
                                      {perm.subject_type === "department" ? (
                                        <Building2 className="size-4" />
                                      ) : perm.subject_type === "team" ? (
                                        <Users className="size-4" />
                                      ) : (
                                        <UserCheck className="size-4" />
                                      )}
                                    </div>
                                    <div className="min-w-0">
                                      <div className="text-xs font-semibold text-foreground truncate flex items-center gap-1.5">
                                        <span className="truncate">{perm.subject_name}</span>
                                        <Badge
                                          variant="outline"
                                          className={`text-[10px] font-bold px-1.5 py-0 uppercase ${
                                            isDeny ? "bg-rose-50 text-rose-700 border-rose-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"
                                          }`}
                                        >
                                          {perm.relation_label}
                                        </Badge>
                                      </div>
                                      <div className="text-[11px] text-muted-foreground truncate">
                                        <span className="capitalize">{perm.subject_type}</span>
                                        {perm.subject_detail && perm.subject_detail.toLowerCase() !== perm.subject_type.toLowerCase()
                                          ? ` · ${perm.subject_detail}`
                                          : ""}
                                      </div>
                                    </div>
                                  </div>
                                  {perm.revocable ? (
                                    <Button
                                      type="button"
                                      variant="destructive"
                                      size="sm"
                                      onClick={() => handleRevokeDocShare(perm)}
                                      disabled={isRevoking}
                                      className="h-7 text-[11px] px-2.5 shrink-0"
                                    >
                                      {isRevoking ? "Revoking..." : "Revoke"}
                                    </Button>
                                  ) : (
                                    <span className="text-[10px] text-muted-foreground px-2">{perm.grant_source}</span>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </TabsContent>

                    <TabsContent value="overview" className="mt-0 flex flex-col gap-4">
                      <div className="p-4 rounded-xl bg-muted/40 border text-xs flex flex-col gap-2">
                        <div className="text-muted-foreground font-medium">Status & Verification</div>
                        <div className="flex items-center justify-between">
                          {getStatusBadge(inspectDoc.status, inspectDoc.id)}
                          <span className="text-muted-foreground font-mono text-[11px]">
                            Uploaded {new Date(inspectDoc.created_at).toLocaleString()}
                          </span>
                        </div>
                      </div>

                      {(inspectDoc.manual_description || inspectDoc.description) && (
                        <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 text-xs flex flex-col gap-1.5">
                          <div className="font-semibold text-primary flex items-center gap-1.5">
                            <Info className="size-4" />
                            Document Description & Semantic Purpose
                          </div>
                          <p className="text-foreground leading-relaxed text-xs pt-0.5">
                            {inspectDoc.manual_description || inspectDoc.description}
                          </p>
                        </div>
                      )}

                      <div className="flex flex-col gap-2">
                        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                          Extracted Structure & Metadata
                        </div>
                        <div className="bg-slate-950 text-slate-200 p-4 rounded-xl font-mono text-xs overflow-x-auto max-h-64 border">
                          <pre>{JSON.stringify(inspectDoc.parsed_metadata || {}, null, 2)}</pre>
                        </div>
                      </div>
                    </TabsContent>

                    <TabsContent value="chunks" className="mt-0 flex flex-col gap-4">
                      <div className="relative">
                        <Search className="size-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="text"
                          placeholder="Search within chunks..."
                          value={chunkSearchQuery}
                          onChange={(e) => setChunkSearchQuery(e.target.value)}
                          className="pl-9 text-xs h-9"
                        />
                      </div>

                      {loadingChunks ? (
                        <div className="flex flex-col gap-3">
                          {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="p-3.5 rounded-xl border bg-card flex flex-col gap-2">
                              <div className="flex justify-between items-center">
                                <Skeleton className="h-4 w-28 rounded-md" />
                                <Skeleton className="h-3 w-16" />
                              </div>
                              <Skeleton className="h-3 w-full" />
                              <Skeleton className="h-3 w-4/5" />
                            </div>
                          ))}
                        </div>
                      ) : filteredChunks.length === 0 ? (
                        <div className="p-8 text-center text-xs text-muted-foreground border rounded-xl bg-muted/20">
                          No vector chunks found matching query.
                        </div>
                      ) : (
                        <div className="flex flex-col gap-3">
                          {filteredChunks.map(chunk => (
                            <div key={chunk.id} className="p-3.5 rounded-xl border bg-card flex flex-col gap-2">
                              <div className="flex items-center justify-between text-[11px] text-muted-foreground font-mono">
                                <Badge variant="secondary" className="font-semibold text-primary bg-primary/10 border-none">
                                  Chunk #{chunk.chunk_index} ({chunk.chunk_type})
                                </Badge>
                                {chunk.citation?.page_number && (
                                  <span>Page {chunk.citation.page_number}</span>
                                )}
                                {chunk.citation?.sheet_name && (
                                  <span>Sheet: {chunk.citation.sheet_name} (Row {chunk.citation.row_number})</span>
                                )}
                              </div>
                              <p className="text-xs text-foreground leading-relaxed font-sans whitespace-pre-wrap">
                                {chunk.content}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </TabsContent>
                  </ScrollArea>
                </Tabs>
              </>
            )}
          </SheetContent>
        </Sheet>

        {/* Google Drive Folder Picker Modal - Two-Pane Workspace Explorer */}
        <Dialog open={folderModalOpen} onOpenChange={setFolderModalOpen}>
          <DialogContent className="max-w-5xl h-[88vh] flex flex-col gap-0 p-0 overflow-hidden">
            {/* Header */}
            <DialogHeader className="p-6 border-b pb-4 flex flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-xl bg-primary/10 border border-primary/20 text-primary flex items-center justify-center shrink-0 shadow-inner">
                  <FolderTree className="size-5" />
                </div>
                <div className="flex flex-col gap-1 text-left">
                  <DialogTitle className="text-base font-bold text-foreground">
                    Google Drive Workspace Explorer
                  </DialogTitle>
                  <DialogDescription className="text-xs text-muted-foreground">
                    Choose any folder in My Drive, Shared with me, or Shared Drives. All supported documents inside this folder and any nested subfolders will be auto-ingested.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            {/* Navigation Strip & Search Bar */}
            <div className="px-6 py-2.5 bg-muted/40 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
              {/* Breadcrumbs */}
              <Breadcrumb className="overflow-x-auto">
                <BreadcrumbList className="text-xs flex-nowrap">
                  {folderBreadcrumbs.map((crumb, idx) => {
                    const isLast = idx === folderBreadcrumbs.length - 1
                    return (
                      <React.Fragment key={crumb.id || idx}>
                        {idx > 0 && <BreadcrumbSeparator className="size-3 text-muted-foreground/60 shrink-0" />}
                        <BreadcrumbItem className="shrink-0">
                          {isLast ? (
                            <BreadcrumbPage className="font-semibold text-primary flex items-center gap-1.5">
                              {idx === 0 ? (
                                <HardDrive className="size-3.5 text-muted-foreground" />
                              ) : crumb.id === "shared_with_me" ? (
                                <Users className="size-3.5 text-sky-500" />
                              ) : (
                                <Folder className="size-3.5 text-primary" />
                              )}
                              <span>{crumb.name}</span>
                            </BreadcrumbPage>
                          ) : (
                            <BreadcrumbLink asChild>
                              <button
                                type="button"
                                onClick={() => handleNavigateBreadcrumb(idx)}
                                disabled={folderLoading}
                                className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition font-medium"
                              >
                                {idx === 0 ? (
                                  <HardDrive className="size-3.5 text-muted-foreground" />
                                ) : crumb.id === "shared_with_me" ? (
                                  <Users className="size-3.5 text-sky-500" />
                                ) : (
                                  <Folder className="size-3.5 text-primary" />
                                )}
                                <span>{crumb.name}</span>
                              </button>
                            </BreadcrumbLink>
                          )}
                        </BreadcrumbItem>
                      </React.Fragment>
                    )
                  })}
                </BreadcrumbList>
              </Breadcrumb>

              {/* Instant Search */}
              <div className="relative shrink-0">
                <Search className="size-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search folders & files..."
                  value={modalSearchQuery}
                  onChange={(e) => setModalSearchQuery(e.target.value)}
                  className="pl-8 text-xs h-8 w-full sm:w-48 shadow-2xs"
                />
              </div>
            </div>

            {/* Active Monitored Folder Banner if connected */}
            {gdriveStatus?.integration?.folder_name && (
              <div className="px-6 py-2 bg-primary/5 border-b flex items-center justify-between text-xs text-primary">
                <div className="flex items-center gap-2 truncate">
                  <span className="text-muted-foreground font-medium shrink-0">Currently Monitored:</span>
                  <span className="font-semibold text-primary flex items-center gap-1 truncate">
                    <FolderOpen className="size-3.5 shrink-0" />
                    {gdriveStatus.integration.folder_name}
                  </span>
                  <Badge variant="secondary" className="text-[10px] bg-primary/10 text-primary font-bold px-1.5 py-0.5 shrink-0">
                    Recursive Subtree
                  </Badge>
                </div>
                <span className="text-[11px] text-muted-foreground hidden md:inline shrink-0">
                  Switching folders preserves historical documents as detached
                </span>
              </div>
            )}

            {/* Main Two-Pane Explorer Body */}
            <div className="flex-1 grid grid-cols-1 md:grid-cols-12 overflow-hidden min-h-[460px]">
              {/* Left Pane: Folders & Subtrees (Col 5) */}
              <div className="md:col-span-5 border-r flex flex-col bg-muted/20 overflow-hidden">
                <div className="p-3.5 border-b bg-muted/40 flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <Folder className="size-4 text-primary" />
                    <span className="text-xs font-bold text-foreground uppercase tracking-wider">
                      Folders & Drives ({filteredModalFolders.length})
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    Click to inspect
                  </span>
                </div>

                <ScrollArea className="flex-1 p-3">
                  <div className="flex flex-col gap-2">
                  {folderLoading ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="p-3 rounded-xl border bg-card flex items-center gap-3">
                        <Skeleton className="size-8 rounded-lg shrink-0" />
                        <div className="flex flex-col gap-1.5 flex-1">
                          <Skeleton className="h-3.5 w-32" />
                          <Skeleton className="h-2.5 w-20" />
                        </div>
                      </div>
                    ))
                  ) : filteredModalFolders.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-center p-6 bg-card rounded-2xl border border-dashed">
                      <Folder className="size-8 text-muted-foreground/40 mb-2" />
                      <p className="text-xs font-semibold text-foreground">No subfolders in this location</p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        You can select this folder as your root for automated ingestion.
                      </p>
                    </div>
                  ) : (
                    filteredModalFolders.map(item => {
                      const isSelected = selectedFolder?.id === item.id
                      const isSharedDrive = item.container_type === "shared_drive"
                      const isSharedWithMeRoot = item.id === "shared_with_me"
                      const isSharedFolder = item.parent_id === "shared_with_me" || item.metadata?.is_shared_with_me === true
                      const canSelect = item.can_select !== false

                      return (
                        <div
                          key={item.id}
                          onClick={() => handleSelectFolder(item)}
                          className={`p-3 rounded-xl border transition cursor-pointer group ${
                            isSelected
                              ? "bg-primary/10 border-primary shadow-xs ring-1 ring-primary/40"
                              : isSharedWithMeRoot
                                ? "bg-sky-50/40 hover:bg-sky-50/80 border-sky-200"
                                : "bg-card hover:bg-muted/50 border-border"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className={`size-8 rounded-lg flex items-center justify-center shrink-0 ${
                                isSharedDrive 
                                  ? "bg-emerald-50 text-emerald-600 border border-emerald-200" 
                                  : isSharedWithMeRoot
                                    ? "bg-sky-100 text-sky-700 border border-sky-200"
                                    : isSharedFolder
                                      ? "bg-blue-50 text-blue-600 border border-blue-200"
                                      : "bg-primary/10 text-primary border border-primary/20"
                              }`}>
                                {isSharedDrive ? (
                                  <HardDrive className="size-4" />
                                ) : isSharedWithMeRoot ? (
                                  <Users className="size-4" />
                                ) : isSharedFolder ? (
                                  <FolderSync className="size-4" />
                                ) : (
                                  <Folder className="size-4" />
                                )}
                              </div>
                              <div className="truncate">
                                <div className="flex items-center gap-1.5">
                                  <span className={`text-xs font-semibold truncate ${
                                    isSelected ? "text-primary font-bold" : "text-foreground"
                                  }`}>
                                    {item.name}
                                  </span>
                                </div>
                                <span className="text-[10px] text-muted-foreground font-mono block truncate">
                                  {item.path}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                              {canSelect ? (
                                <>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleEnterFolder(item)
                                    }}
                                    className="h-7 px-2 text-[11px] font-semibold flex items-center gap-0.5 shadow-2xs"
                                    title="Open subfolder"
                                  >
                                    <span>Open</span>
                                    <ChevronRight className="size-3" />
                                  </Button>

                                  <div className={`size-5 rounded-full border flex items-center justify-center transition ${
                                    isSelected
                                      ? "border-primary bg-primary text-primary-foreground shadow-xs"
                                      : "border-muted-foreground/30 group-hover:border-muted-foreground/60 bg-background"
                                  }`}>
                                    {isSelected && <Check className="size-3 stroke-[3]" />}
                                  </div>
                                </>
                              ) : (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    handleEnterFolder(item)
                                  }}
                                  className="h-7 px-2.5 text-[11px] font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 border-sky-200 flex items-center gap-1"
                                >
                                  <span>Browse</span>
                                  <ChevronRight className="size-3" />
                                </Button>
                              )}
                            </div>
                          </div>
                        </div>
                      )
                    })
                  )}
                  </div>
                </ScrollArea>
              </div>

              {/* Right Pane: Folder Inspector & Files Preview (Col 7) */}
              <div className="md:col-span-7 flex flex-col bg-card overflow-hidden">
                {/* Inspector Subheader */}
                <div className="p-3.5 border-b bg-card flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <FolderOpen className="size-4 text-primary shrink-0" />
                      <span className="text-xs font-bold text-foreground truncate">
                        {activeInspectorFolder.name}
                      </span>
                      {isInspectingSelectedSubfolder && (
                        <Badge variant="outline" className="text-[10px] font-semibold text-primary bg-primary/10 border-primary/20 px-1.5 py-0 shrink-0">
                          Selected
                        </Badge>
                      )}
                    </div>

                    {/* Metrics Pills */}
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant="outline" className="gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border-emerald-200">
                        <CheckCircle2 className="size-3 text-emerald-600" />
                        {eligibleFilesCount} Eligible
                      </Badge>
                      <Badge variant="outline" className="gap-1 text-[10px] font-medium text-muted-foreground bg-muted">
                        <Ban className="size-2.5 text-muted-foreground/60" />
                        {excludedFilesCount} Excluded
                      </Badge>
                      {totalInspectorBytes > 0 && (
                        <Badge variant="outline" className="text-[10px] font-mono text-muted-foreground">
                          {formatBytes(totalInspectorBytes)}
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Filter Tabs for Inspector using ToggleGroup */}
                  <div className="pt-1">
                    <ToggleGroup 
                      type="single" 
                      value={inspectorTab} 
                      onValueChange={(val) => val && setInspectorTab(val as "all" | "eligible" | "excluded")}
                      size="sm"
                      className="justify-start gap-1"
                    >
                      <ToggleGroupItem value="all" className="h-6 px-2.5 text-[11px] font-semibold data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
                        All Files ({rawInspectorFiles.length})
                      </ToggleGroupItem>
                      <ToggleGroupItem value="eligible" className="h-6 px-2.5 text-[11px] font-semibold text-emerald-700 data-[state=on]:bg-emerald-600 data-[state=on]:text-white">
                        <CheckCircle2 className="size-3 mr-1" />
                        Eligible Only ({eligibleFilesCount})
                      </ToggleGroupItem>
                      <ToggleGroupItem value="excluded" className="h-6 px-2.5 text-[11px] font-semibold text-muted-foreground data-[state=on]:bg-muted-foreground data-[state=on]:text-background">
                        <Ban className="size-2.5 mr-1" />
                        Excluded ({excludedFilesCount})
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </div>
                </div>

                {/* Inspector File Items */}
                <ScrollArea className="flex-1 p-3.5 bg-muted/10">
                  <div className="flex flex-col gap-2">
                  {loadingSelectedFiles ? (
                    Array.from({ length: 4 }).map((_, i) => (
                      <div key={i} className="p-2.5 rounded-xl border bg-card flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Skeleton className="size-7 rounded-lg shrink-0" />
                          <div className="flex flex-col gap-1.5">
                            <Skeleton className="h-3.5 w-36" />
                            <Skeleton className="h-2.5 w-16" />
                          </div>
                        </div>
                        <Skeleton className="h-5 w-20 rounded-md" />
                      </div>
                    ))
                  ) : filteredInspectorFiles.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-48 text-center p-6 bg-card rounded-2xl border border-dashed">
                      <FileIcon className="size-8 text-muted-foreground/30 mb-2" />
                      <p className="text-xs font-semibold text-foreground">No files found</p>
                      <p className="text-[11px] text-muted-foreground mt-1 max-w-xs">
                        {modalSearchQuery.trim()
                          ? "No files match your current search query."
                          : "No files directly in this folder. Any nested subfolders will still be auto-scanned recursively."}
                      </p>
                    </div>
                  ) : (
                    filteredInspectorFiles.map(file => (
                      <div
                        key={file.id}
                        className="flex items-center justify-between p-2.5 rounded-xl border bg-card hover:border-border transition shadow-2xs"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {getDriveItemFileIcon(file.mime_type, file.extension)}
                          <div className="truncate">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-semibold text-foreground truncate" title={file.name}>
                                {file.name}
                              </span>
                              {file.extension && (
                                <Badge variant="secondary" className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0">
                                  {file.extension}
                                </Badge>
                              )}
                              {file.is_google_doc && (
                                <Badge variant="outline" className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0 bg-primary/10 text-primary border-primary/20">
                                  Workspace
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                              <span>{file.size_bytes ? formatBytes(file.size_bytes) : "Auto-converted"}</span>
                              {file.modified_time && (
                                <>
                                  <span>•</span>
                                  <span>Updated {new Date(file.modified_time).toLocaleDateString()}</span>
                                </>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0 ml-3">
                          {file.is_supported ? (
                            <Badge variant="outline" className="gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border-emerald-200">
                              <CheckCircle2 className="size-3 text-emerald-600" />
                              Ready for AI
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="gap-1 text-[10px] font-medium text-muted-foreground">
                              <Ban className="size-2.5 text-muted-foreground/60" />
                              Excluded
                            </Badge>
                          )}

                          {file.web_view_link && (
                            <a
                              href={file.web_view_link}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="p-1 text-muted-foreground hover:text-primary rounded transition"
                              title="Open in Google Drive"
                            >
                              <ExternalLink className="size-3.5" />
                            </a>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                  </div>
                </ScrollArea>
              </div>
            </div>

            {/* Selection Summary & Action Footer */}
            <DialogFooter className="p-4 border-t bg-muted/20 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs sm:space-x-0">
              <div className="truncate max-w-md text-left">
                <span className="text-muted-foreground block font-medium">Selected Target Folder:</span>
                {selectedFolder && selectedFolder.can_select !== false ? (
                  <div>
                    <div className="flex items-center gap-1.5 text-primary font-semibold truncate mt-0.5">
                      <CheckCircle2 className="size-3.5 shrink-0 text-emerald-600" />
                      <span className="truncate">{selectedFolder.name}</span>
                      <Badge variant="outline" className="text-[10px] text-emerald-700 font-bold bg-emerald-50 border-emerald-200 shrink-0">
                        Recursive Subtree
                      </Badge>
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono shrink-0">
                        {selectedFolder.path}
                      </span>
                    </div>
                    <span className="text-[11px] text-emerald-700 font-medium block mt-0.5">
                      {eligibleFilesCount} eligible document(s) ready • Historical documents preserved as detached
                    </span>
                  </div>
                ) : (
                  <span className="text-muted-foreground italic mt-0.5 block">
                    Click any folder in the left pane to select it for AI ingestion
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setFolderModalOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={handleConfirmFolderSelection}
                  disabled={!selectedFolder || selectedFolder.can_select === false || savingFolder}
                  className="font-semibold shadow-xs flex items-center gap-2"
                >
                  {savingFolder ? (
                    <>
                      <RefreshCw className="size-3.5 animate-spin" />
                      <span>Saving & Syncing...</span>
                    </>
                  ) : (
                    <>
                      <Check className="size-4" />
                      <span>Confirm & Monitor Folder</span>
                    </>
                  )}
                </Button>
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Modern Deletion Confirmation Alert Dialog */}
        <AlertDialog open={Boolean(docToDelete)} onOpenChange={(open) => !open && setDocToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
                  <Trash2 className="size-5" />
                </div>
                <div className="flex flex-col gap-1 text-left">
                  <AlertDialogTitle>Permanently Delete Document?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to delete <span className="font-semibold text-foreground">{docToDelete?.fileName}</span>? This will permanently remove the source file, all associated vector chunk embeddings, and page citations from the coach memory. This action cannot be undone.
                  </AlertDialogDescription>
                </div>
              </div>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={executeDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-semibold"
              >
                Delete Document
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Floating Batch Selection Action Bar */}
        {selectedDocIds.size > 0 && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 bg-foreground text-background px-4 py-2.5 rounded-2xl shadow-2xl border border-border flex items-center gap-3 animate-in fade-in slide-in-from-bottom-4 duration-200">
            <div className="flex items-center gap-2 pr-2 border-r border-background/20 text-xs font-semibold">
              <span className="bg-background text-foreground font-mono text-xs px-2 py-0.5 rounded-full font-bold">
                {selectedDocIds.size}
              </span>
              <span>Selected</span>
            </div>

            <div className="flex items-center gap-1.5">
              {hydratedManagerOrAbove && (
                <>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleBatchPlaybook(true)}
                    disabled={isBatchUpdatingPlaybook}
                    className="text-xs text-background hover:text-background hover:bg-background/20 h-8 gap-1.5"
                  >
                    <BookOpen className="size-3.5 text-emerald-400" />
                    <span>Mark Playbook</span>
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => handleBatchPlaybook(false)}
                    disabled={isBatchUpdatingPlaybook}
                    className="text-xs text-background hover:text-background hover:bg-background/20 h-8 gap-1.5"
                  >
                    <span>Revoke Playbook</span>
                  </Button>
                </>
              )}

              {hydratedAdminOrAbove && (
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={() => setBatchDeleteDialogOpen(true)}
                  disabled={isBatchDeleting}
                  className="text-xs h-8 gap-1.5 font-semibold"
                >
                  <Trash2 className="size-3.5" />
                  <span>Delete ({selectedDocIds.size})</span>
                </Button>
              )}

              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleClearSelection}
                className="size-7 text-background/60 hover:text-background hover:bg-background/20 rounded-lg ml-1"
                title="Clear Selection"
              >
                <X className="size-3.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Batch Deletion Confirmation Alert Dialog */}
        <AlertDialog open={batchDeleteDialogOpen} onOpenChange={setBatchDeleteDialogOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <div className="flex items-center gap-3">
                <div className="size-10 rounded-xl bg-destructive/10 text-destructive flex items-center justify-center shrink-0">
                  <Trash2 className="size-5" />
                </div>
                <div className="flex flex-col gap-1 text-left">
                  <AlertDialogTitle>Delete {selectedDocIds.size} Selected Documents?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure you want to permanently delete these <span className="font-semibold text-foreground">{selectedDocIds.size}</span> selected documents? All associated vector chunks, metadata, and evidence page citations will be purged from the coach knowledge base. This action cannot be undone.
                  </AlertDialogDescription>
                </div>
              </div>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={executeBatchDelete}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90 font-semibold"
              >
                Delete Selected Documents
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

      </div>
    </div>
  )
}
