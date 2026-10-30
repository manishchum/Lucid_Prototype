"use client"

import React, { useState, useEffect, useRef, useCallback } from "react"
import Link from "next/link"
import { useAuth } from "@/contexts/auth-context"
import { fetchWithAuth } from "@/lib/fetch-with-auth"
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
  File as FileIcon,
  Image as ImageIcon,
  Eye,
  Ban,
  Download,
  Copy
} from "lucide-react"

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"
import { UnifiedConnectorsHub } from "./UnifiedConnectorsHub"

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

export default function CoachUploadsPage() {
  const { employeeData, user: authUser } = useAuth()
  const companyId = employeeData?.company_id

  // Documents & Pagination State
  const [documents, setDocuments] = useState<CoachDocument[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [loading, setLoading] = useState(true)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [totalDocuments, setTotalDocuments] = useState(0)

  // Upload Form State (Multi-File)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [targetEmployeeId, setTargetEmployeeId] = useState<string>("")
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

  // Feedback Toasts
  const [errorToast, setErrorToast] = useState<string | null>(null)
  const [successToast, setSuccessToast] = useState<string | null>(null)

  // Search & Filtering State
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")
  const [sourceFilter, setSourceFilter] = useState<"all" | "gdrive" | "manual">("all")

  // Inspection Drawer State
  const [inspectDoc, setInspectDoc] = useState<CoachDocument | null>(null)
  const [inspectDrawerTab, setInspectDrawerTab] = useState<"overview" | "chunks">("overview")
  const [chunksForInspect, setChunksForInspect] = useState<DocumentChunk[]>([])
  const [loadingChunks, setLoadingChunks] = useState(false)
  const [chunkSearchQuery, setChunkSearchQuery] = useState("")
  const [downloadingUrl, setDownloadingUrl] = useState(false)
  const [isDeleting, setIsDeleting] = useState<string | null>(null)

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

  // Initial Load
  useEffect(() => {
    fetchDocuments(1, searchQuery, statusFilter, sourceFilter)
    fetchEmployees()
    fetchGDriveStatus()
  }, [fetchDocuments, fetchEmployees, fetchGDriveStatus])

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
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: preflightItems })
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
        if (targetEmployeeId && targetEmployeeId !== "general") {
          formData.append("target_employee_id", targetEmployeeId)
        }
        if (manualDescription.trim()) {
          formData.append("manual_description", manualDescription.trim())
        }
        formData.append("conflict_mode", mode)
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
      setTargetEmployeeId("")
      setManualDescription("")
      if (fileInputRef.current) fileInputRef.current.value = ""

      fetchDocuments(1, searchQuery, statusFilter, sourceFilter)
    } catch (err: any) {
      setErrorToast(err.message || "Batch upload encounterd an error.")
    } finally {
      setUploading(false)
      setUploadProgressText("")
    }
  }

  // Delete Document
  const handleDelete = async (docId: string, fileName: string) => {
    if (!confirm(`Are you sure you want to delete '${fileName}'? All associated vector chunks and evidence rows will be permanently removed.`)) {
      return
    }

    setIsDeleting(docId)
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/coach/documents/${docId}`, {
        method: "DELETE"
      })
      if (res.ok) {
        setDocuments(prev => prev.filter(d => d.id !== docId))
        if (inspectDoc?.id === docId) setInspectDoc(null)
        setSuccessToast(`Deleted '${fileName}' successfully.`)
        fetchDocuments(currentPage, searchQuery, statusFilter, sourceFilter)
      } else {
        const payload = await res.json()
        setErrorToast(payload.detail || "Failed to delete document.")
      }
    } catch (err: any) {
      setErrorToast(err.message || "Error deleting document.")
    } finally {
      setIsDeleting(null)
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

  // Format Helper
  const formatBytes = (bytes: number) => {
    if (!bytes || bytes === 0) return "0 Bytes"
    const k = 1024
    const sizes = ["Bytes", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
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
        <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 border border-rose-200 flex items-center justify-center flex-shrink-0">
          <FileText className="w-4 h-4" />
        </div>
      )
    }
    if (ext.includes("xls") || ext === "csv" || ext === "gsheet" || mime.includes("spreadsheet") || mime.includes("csv")) {
      return (
        <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-200 flex items-center justify-center flex-shrink-0">
          <FileSpreadsheet className="w-4 h-4" />
        </div>
      )
    }
    if (ext.includes("ppt") || ext === "gslides" || mime.includes("presentation")) {
      return (
        <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 border border-amber-200 flex items-center justify-center flex-shrink-0">
          <Presentation className="w-4 h-4" />
        </div>
      )
    }
    if (["png", "jpg", "jpeg", "svg", "webp", "gif"].includes(ext) || mime.includes("image")) {
      return (
        <div className="w-8 h-8 rounded-lg bg-purple-50 text-purple-600 border border-purple-200 flex items-center justify-center flex-shrink-0">
          <ImageIcon className="w-4 h-4" />
        </div>
      )
    }
    if (ext.includes("doc") || ext === "gdoc" || mime.includes("word") || mime.includes("document")) {
      return (
        <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 border border-blue-200 flex items-center justify-center flex-shrink-0">
          <FileText className="w-4 h-4" />
        </div>
      )
    }
    return (
      <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-600 border border-slate-200 flex items-center justify-center flex-shrink-0">
        <FileIcon className="w-4 h-4" />
      </div>
    )
  }

  const getStatusBadge = (status: CoachDocument["status"], docId?: string) => {
    const live = docId ? liveProgress[docId] : null

    switch (status) {
      case "completed":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Ready for AI
          </span>
        )
      case "parsing":
        return (
          <div className="flex flex-col gap-1 min-w-[140px]">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">
              <Layers className="w-3.5 h-3.5 text-blue-600 animate-spin" />
              {live?.details?.stage_text || "Parsing Content"}
            </span>
            {live && (
              <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                <div className="bg-blue-600 h-1.5 rounded-full transition-all duration-300" style={{ width: `${live.percent}%` }} />
              </div>
            )}
          </div>
        )
      case "embedding":
        return (
          <div className="flex flex-col gap-1 min-w-[140px]">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200 animate-pulse">
              <Sparkles className="w-3.5 h-3.5 text-purple-600 animate-spin" />
              {live?.details?.stage_text || "Vectorizing Chunks"}
            </span>
            {live && (
              <div className="w-full bg-slate-200 rounded-full h-1.5 overflow-hidden">
                <div className="bg-purple-600 h-1.5 rounded-full transition-all duration-300" style={{ width: `${live.percent}%` }} />
              </div>
            )}
          </div>
        )
      case "pending":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
            <Clock className="w-3.5 h-3.5 text-amber-600" /> Queued
          </span>
        )
      case "failed":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
            <AlertCircle className="w-3.5 h-3.5 text-rose-600" /> Ingestion Failed
          </span>
        )
      default:
        return null
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

  // Summary Metrics
  const totalDocs = totalDocuments || documents.length
  const completedDocs = documents.filter(d => d.status === "completed").length
  const totalChunks = documents.reduce((acc, d) => acc + (d.parsed_metadata?.chunks_count || 0), 0)
  const totalRows = documents.reduce((acc, d) => acc + (d.parsed_metadata?.spreadsheet_rows_count || 0), 0)

  // Filtered Chunks in Drawer
  const filteredChunks = chunksForInspect.filter(c =>
    !chunkSearchQuery.trim() || c.content.toLowerCase().includes(chunkSearchQuery.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-slate-50/60 p-6 md:p-10 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Top Back Navigation Bar */}
        <div className="flex items-center justify-between">
          <Link
            href="/employee/welcome"
            className="inline-flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white hover:text-indigo-600 hover:bg-indigo-50/70 border border-slate-200 rounded-lg transition shadow-2xs group"
          >
            <ArrowLeft className="w-3.5 h-3.5 text-slate-400 group-hover:text-indigo-600 transition-transform group-hover:-translate-x-0.5" />
            <span>Back to Lucid</span>
          </Link>

          <span className="px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200/80 rounded-full">
            Admin Console • Coach Knowledge Hub
          </span>
        </div>

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mt-2">
              Performance Coach — Document Ingestion Hub
            </h1>
            <p className="text-sm text-slate-600 mt-1 max-w-2xl">
              Upload performance reviews, KPI spreadsheets, sprint trackers, and 360 feedback decks. 
              The pipeline automatically extracts line-by-line citations and stores vector proof chunks.
            </p>
          </div>

          <div className="flex items-center gap-2.5 self-start md:self-auto">
            <Link
              href="/employee/welcome"
              className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 hover:text-indigo-600 transition shadow-sm group"
            >
              <ArrowLeft className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 transition-transform group-hover:-translate-x-0.5" />
              <span>Back to Lucid</span>
            </Link>

            <button
              onClick={() => fetchDocuments(currentPage, searchQuery, statusFilter, sourceFilter)}
              disabled={loading}
              className="inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition shadow-sm"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-indigo-600" : ""}`} />
              Refresh Status
            </button>
          </div>
        </div>

        {/* Toast Alerts */}
        {errorToast && (
          <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 flex items-start justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-2.5">
              <AlertCircle className="w-5 h-5 text-rose-600 flex-shrink-0" />
              <p className="text-sm font-medium">{errorToast}</p>
            </div>
            <button onClick={() => setErrorToast(null)} className="text-rose-500 hover:text-rose-800">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {successToast && (
          <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 flex items-start justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              <p className="text-sm font-medium">{successToast}</p>
            </div>
            <button onClick={() => setSuccessToast(null)} className="text-emerald-500 hover:text-emerald-800">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Top Metric Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Total Documents</div>
            <div className="text-2xl font-bold text-slate-900 mt-1">{totalDocs}</div>
            <div className="text-xs text-slate-500 mt-1">Uploaded to company vault</div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Indexed & Ready</div>
            <div className="text-2xl font-bold text-emerald-600 mt-1">{completedDocs}</div>
            <div className="text-xs text-slate-500 mt-1">Ready for Coach queries</div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Vector Chunks</div>
            <div className="text-2xl font-bold text-indigo-600 mt-1">{totalChunks.toLocaleString()}</div>
            <div className="text-xs text-slate-500 mt-1">1024-dim proof embeddings</div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
            <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Spreadsheet Rows</div>
            <div className="text-2xl font-bold text-purple-600 mt-1">{totalRows.toLocaleString()}</div>
            <div className="text-xs text-slate-500 mt-1">Exact JSONB tabular records</div>
          </div>
        </div>

        {/* Unified Enterprise Cloud Connectors Hub */}
        <UnifiedConnectorsHub
          onIngestionTriggered={() => fetchDocuments(1, searchQuery, statusFilter, sourceFilter)}
          onErrorToast={(msg) => setErrorToast(msg)}
          onSuccessToast={(msg) => setSuccessToast(msg)}
        />

        {/* Multi-File Upload Card with Drag & Drop */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 md:p-8">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Upload className="w-5 h-5 text-indigo-600" />
              <h2 className="text-lg font-bold text-slate-900">Upload Performance Evidence</h2>
            </div>
            <span className="text-xs text-slate-400">
              Bulk uploads up to 100MB per file
            </span>
          </div>

          <form onSubmit={handlePreflightAndUpload} className="space-y-6">
            {/* Drop Zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition flex flex-col items-center justify-center gap-3 ${
                isDragOver 
                  ? "border-indigo-500 bg-indigo-50/50" 
                  : selectedFiles.length > 0 
                    ? "border-emerald-400 bg-emerald-50/20" 
                    : "border-slate-300 hover:border-indigo-400 bg-slate-50/50"
              }`}
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
                <div className="w-full max-w-xl space-y-2">
                  <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider text-left mb-1">
                    Selected Documents ({selectedFiles.length})
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1.5 p-1">
                    {selectedFiles.map((file, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2.5 bg-white rounded-xl border border-slate-200 shadow-2xs"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-2.5 truncate">
                          {getFileIcon(file.name.split(".").pop() || "")}
                          <div className="truncate text-left">
                            <span className="text-xs font-semibold text-slate-800 truncate block">
                              {file.name}
                            </span>
                            <span className="text-[10px] text-slate-400">
                              {formatBytes(file.size)}
                            </span>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeSelectedFile(idx)}
                          className="text-slate-400 hover:text-rose-600 p-1"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <p className="text-[11px] text-indigo-600 font-medium text-center pt-1">
                    Click to browse more or drag additional files here
                  </p>
                </div>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center shadow-inner">
                    <Upload className="w-6 h-6" />
                  </div>
                  <div>
                    <span className="text-sm font-semibold text-indigo-600 hover:text-indigo-700">Click to browse files</span>
                    <span className="text-sm text-slate-600"> or drag and drop multiple documents here</span>
                  </div>
                  <div className="flex flex-wrap items-center justify-center gap-1.5 mt-1 text-xs text-slate-500">
                    <span className="px-2 py-0.5 bg-slate-100 rounded">PDF</span>
                    <span className="px-2 py-0.5 bg-slate-100 rounded">DOCX / DOC</span>
                    <span className="px-2 py-0.5 bg-slate-100 rounded">Excel (.xlsx, .xls)</span>
                    <span className="px-2 py-0.5 bg-slate-100 rounded">CSV</span>
                    <span className="px-2 py-0.5 bg-slate-100 rounded">PowerPoint (.pptx)</span>
                  </div>
                </>
              )}
            </div>

            {/* Scope & Description Inputs */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start pt-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Target Scope (Optional)
                </label>
                <select
                  value={targetEmployeeId}
                  onChange={(e) => setTargetEmployeeId(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                >
                  <option value="">🏢 General / Team-Wide Policy (Company Default)</option>
                  {employees.map(emp => (
                    <option key={emp.user_id} value={emp.user_id}>
                      👤 {emp.name} ({emp.email})
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-500 mt-1">
                  Tagging an employee restricts citation visibility to that employee and their manager.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 uppercase tracking-wider mb-1.5">
                  Document Description / Notes (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Q3 2024 Engineering performance appraisals and OKRs"
                  value={manualDescription}
                  onChange={(e) => setManualDescription(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Enables the AI Coach to quickly identify and route questions to this document.
                </p>
              </div>
            </div>

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-2 border-t border-slate-100">
              <div className="text-xs text-slate-400">
                Magic-byte verified formats: PDF, DOCX, DOC, Excel (.xlsx, .xls), CSV, PPTX
              </div>
              <button
                type="submit"
                disabled={selectedFiles.length === 0 || uploading}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-sm w-full md:w-auto"
              >
                {uploading ? (
                  <>
                    <Layers className="w-4 h-4 animate-spin" />
                    Ingesting Batch...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Upload & Ingest {selectedFiles.length > 0 ? `(${selectedFiles.length})` : ""}
                  </>
                )}
              </button>
            </div>
            {uploadProgressText && (
              <div className="text-xs text-indigo-600 font-medium text-right animate-pulse">
                {uploadProgressText}
              </div>
            )}
          </form>
        </div>

        {/* Documents Registry & Live Logs Table */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-200/80 flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Ingested Documents & Processing Logs</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Every file is parsed into semantic rows and vector chunks with page and cell citations.
              </p>
            </div>

            {/* Filter & Search Bar */}
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search file name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 pr-3.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 w-48"
                />
              </div>

              <select
                value={sourceFilter}
                onChange={(e) => setSourceFilter(e.target.value as "all" | "gdrive" | "manual")}
                className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none"
              >
                <option value="all">All Sources</option>
                <option value="gdrive">Google Drive</option>
                <option value="manual">Manual Uploads</option>
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none"
              >
                <option value="all">All Statuses</option>
                <option value="completed">Ready</option>
                <option value="parsing">Parsing</option>
                <option value="embedding">Embedding</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </div>

          {/* Table Content */}
          {loading && documents.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <RefreshCw className="w-6 h-6 mx-auto animate-spin mb-2" />
              Loading documents...
            </div>
          ) : documents.length === 0 ? (
            <div className="p-12 text-center">
              <Database className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <div className="text-sm font-semibold text-slate-700">No documents found</div>
              <p className="text-xs text-slate-400 mt-1 max-w-sm mx-auto">
                Upload your first performance review, sprint sheet, or OKR document above to get started.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50/75 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <tr>
                    <th className="py-3.5 px-6">Document</th>
                    <th className="py-3.5 px-4">Status</th>
                    <th className="py-3.5 px-4">Chunks / Rows</th>
                    <th className="py-3.5 px-4">Target Scope</th>
                    <th className="py-3.5 px-4">Uploaded</th>
                    <th className="py-3.5 px-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {documents.map((doc) => {
                    const meta = doc.parsed_metadata || {}
                    const chunksCount = meta.chunks_count ?? 0
                    const rowsCount = meta.spreadsheet_rows_count ?? 0
                    const empTarget = employees.find(e => e.user_id === doc.target_employee_id)

                    return (
                      <tr 
                        key={doc.id} 
                        className="hover:bg-slate-50/70 transition cursor-pointer"
                        onClick={() => {
                          setInspectDoc(doc)
                          setInspectDrawerTab("overview")
                          loadChunksForInspection(doc.id)
                        }}
                      >
                        <td className="py-4 px-6">
                          <div className="flex items-center gap-3">
                            <div className="p-2 bg-slate-100 rounded-lg">
                              {getFileIcon(doc.file_type)}
                            </div>
                            <div>
                              <div className="font-semibold text-slate-900 flex items-center gap-2">
                                {doc.file_name}
                                <span className="uppercase text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                                  {doc.file_type}
                                </span>
                                {doc.version && doc.version > 1 && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                                    v{doc.version}
                                  </span>
                                )}
                                {doc.manual_description?.toLowerCase().includes("google drive") && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-sky-50 text-sky-700 border border-sky-200">
                                    <FolderSync className="w-3 h-3 text-sky-600" />
                                    Google Drive
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-slate-400 mt-0.5">
                                {formatBytes(doc.file_size_bytes)}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="py-4 px-4 whitespace-nowrap">
                          {getStatusBadge(doc.status, doc.id)}
                        </td>

                        <td className="py-4 px-4 text-xs text-slate-600 whitespace-nowrap">
                          {chunksCount > 0 && (
                            <span className="font-medium text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded mr-1">
                              {chunksCount} vector chunks
                            </span>
                          )}
                          {rowsCount > 0 && (
                            <span className="font-medium text-purple-700 bg-purple-50 px-2 py-0.5 rounded">
                              {rowsCount} rows
                            </span>
                          )}
                          {chunksCount === 0 && rowsCount === 0 && doc.status === "completed" && (
                            <span className="text-slate-400">0 chunks</span>
                          )}
                        </td>

                        <td className="py-4 px-4 text-xs whitespace-nowrap">
                          {empTarget ? (
                            <span className="inline-flex items-center gap-1 text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                              <UserCheck className="w-3 h-3 text-indigo-500" />
                              {empTarget.name}
                            </span>
                          ) : (
                            <span className="text-slate-400">Team / Company</span>
                          )}
                        </td>

                        <td className="py-4 px-4 text-xs text-slate-500 whitespace-nowrap">
                          {new Date(doc.created_at).toLocaleDateString([], {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit"
                          })}
                        </td>

                        <td className="py-4 px-6 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1.5">
                            <button
                              onClick={() => {
                                setInspectDoc(doc)
                                setInspectDrawerTab("chunks")
                                loadChunksForInspection(doc.id)
                              }}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 rounded-lg transition"
                              title="Inspect Vector Chunks"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDownloadOriginal(doc.id)}
                              className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-slate-100 rounded-lg transition"
                              title="Download Original Document"
                            >
                              <Download className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDelete(doc.id, doc.file_name)}
                              disabled={isDeleting === doc.id}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition disabled:opacity-50"
                              title="Delete Document"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>

              {/* Server-Side Pagination Bar */}
              <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between text-xs text-slate-600">
                <div>
                  Showing {documents.length > 0 ? (currentPage - 1) * 25 + 1 : 0} to {Math.min(currentPage * 25, totalDocuments)} of {totalDocuments} document(s)
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => fetchDocuments(currentPage - 1, searchQuery, statusFilter, sourceFilter)}
                    disabled={currentPage <= 1 || loading}
                    className="px-3 py-1 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition disabled:opacity-50"
                  >
                    Previous
                  </button>
                  <span className="font-semibold text-slate-800">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    onClick={() => fetchDocuments(currentPage + 1, searchQuery, statusFilter, sourceFilter)}
                    disabled={currentPage >= totalPages || loading}
                    className="px-3 py-1 bg-white border border-slate-200 rounded-lg hover:bg-slate-100 transition disabled:opacity-50"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Interactive Conflict Resolution Modal */}
        {conflictModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl border border-slate-200/90 shadow-2xl max-w-2xl w-full flex flex-col overflow-hidden">
              <div className="p-6 border-b border-slate-100 flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center flex-shrink-0">
                    <ShieldAlert className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Document Conflict Detected</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      One or more files already exist in your coach knowledge base. Choose how to resolve each item.
                    </p>
                  </div>
                </div>
                <button onClick={() => setConflictModalOpen(false)} className="text-slate-400 hover:text-slate-600 p-1">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto">
                {preflightConflicts.map((c) => {
                  if (c.status === "clean") return null
                  const resMode = conflictResolutions[c.file_name] || (c.status === "exists_identical" ? "skip" : "overwrite")

                  return (
                    <div key={c.file_name} className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="font-semibold text-slate-900 text-sm flex items-center gap-2">
                            {c.file_name}
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                              c.status === "exists_identical" 
                                ? "bg-amber-100 text-amber-800 border border-amber-200" 
                                : "bg-blue-100 text-blue-800 border border-blue-200"
                            }`}>
                              {c.status === "exists_identical" ? "Identical Duplicate" : "Modified Version"}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-1">{c.message}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 text-xs">
                        <label className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition ${
                          resMode === "overwrite" ? "bg-indigo-50 border-indigo-400 text-indigo-900 font-semibold" : "bg-white border-slate-200 text-slate-700"
                        }`}>
                          <input
                            type="radio"
                            name={`resolution_${c.file_name}`}
                            value="overwrite"
                            checked={resMode === "overwrite"}
                            onChange={() => setConflictResolutions(prev => ({ ...prev, [c.file_name]: "overwrite" }))}
                            className="text-indigo-600"
                          />
                          <span>Overwrite in-place</span>
                        </label>

                        <label className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition ${
                          resMode === "version" ? "bg-indigo-50 border-indigo-400 text-indigo-900 font-semibold" : "bg-white border-slate-200 text-slate-700"
                        }`}>
                          <input
                            type="radio"
                            name={`resolution_${c.file_name}`}
                            value="version"
                            checked={resMode === "version"}
                            onChange={() => setConflictResolutions(prev => ({ ...prev, [c.file_name]: "version" }))}
                            className="text-indigo-600"
                          />
                          <span>Keep both (Version)</span>
                        </label>

                        <label className={`flex items-center gap-2 p-2.5 rounded-xl border cursor-pointer transition ${
                          resMode === "skip" ? "bg-indigo-50 border-indigo-400 text-indigo-900 font-semibold" : "bg-white border-slate-200 text-slate-700"
                        }`}>
                          <input
                            type="radio"
                            name={`resolution_${c.file_name}`}
                            value="skip"
                            checked={resMode === "skip"}
                            onChange={() => setConflictResolutions(prev => ({ ...prev, [c.file_name]: "skip" }))}
                            className="text-indigo-600"
                          />
                          <span>Skip file</span>
                        </label>
                      </div>
                    </div>
                  )
                })}
              </div>

              <div className="p-4 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-3 text-xs">
                <button
                  type="button"
                  onClick={() => setConflictModalOpen(false)}
                  className="px-4 py-2 bg-white border border-slate-200 text-slate-700 font-semibold rounded-xl hover:bg-slate-100 transition"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => executeUploadBatch(selectedFiles, conflictResolutions)}
                  className="px-5 py-2 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition shadow-sm"
                >
                  Apply & Upload Batch
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Vector Chunk Inspector Drawer */}
        {inspectDoc && (
          <div className="fixed inset-0 z-50 flex items-center justify-end bg-slate-950/40 backdrop-blur-xs animate-in fade-in duration-200">
            <div className="bg-white w-full max-w-2xl h-full shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-200">
              {/* Drawer Header */}
              <div className="p-6 border-b border-slate-200 flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    {getFileIcon(inspectDoc.file_type)}
                    <h3 className="text-base font-bold text-slate-900 truncate max-w-md">
                      {inspectDoc.file_name}
                    </h3>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-400 mt-1">
                    <span>{formatBytes(inspectDoc.file_size_bytes)}</span>
                    <span>•</span>
                    <span className="uppercase">{inspectDoc.file_type}</span>
                    {inspectDoc.version && inspectDoc.version > 1 && (
                      <>
                        <span>•</span>
                        <span className="text-indigo-600 font-semibold">Version {inspectDoc.version}</span>
                      </>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => handleDownloadOriginal(inspectDoc.id)}
                    disabled={downloadingUrl}
                    className="p-2 text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition"
                    title="Download Original"
                  >
                    <Download className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setInspectDoc(null)}
                    className="p-2 text-slate-400 hover:text-slate-600 rounded-lg transition"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Drawer Tabs */}
              <div className="px-6 border-b border-slate-200 flex items-center gap-4 text-xs font-semibold">
                <button
                  onClick={() => setInspectDrawerTab("overview")}
                  className={`py-3 border-b-2 transition ${
                    inspectDrawerTab === "overview" 
                      ? "border-indigo-600 text-indigo-600" 
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Overview & Metadata
                </button>
                <button
                  onClick={() => {
                    setInspectDrawerTab("chunks")
                    if (chunksForInspect.length === 0) loadChunksForInspection(inspectDoc.id)
                  }}
                  className={`py-3 border-b-2 transition flex items-center gap-1.5 ${
                    inspectDrawerTab === "chunks" 
                      ? "border-indigo-600 text-indigo-600" 
                      : "border-transparent text-slate-500 hover:text-slate-700"
                  }`}
                >
                  Vector Chunks ({inspectDoc.parsed_metadata?.chunks_count ?? 0})
                </button>
              </div>

              {/* Drawer Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {inspectDrawerTab === "overview" ? (
                  <>
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
                      <div className="text-slate-500 font-medium">Status & Verification</div>
                      <div className="flex items-center justify-between">
                        {getStatusBadge(inspectDoc.status, inspectDoc.id)}
                        <span className="text-slate-400 font-mono text-[11px]">
                          Uploaded {new Date(inspectDoc.created_at).toLocaleString()}
                        </span>
                      </div>
                    </div>

                    {(inspectDoc.manual_description || inspectDoc.description) && (
                      <div className="p-4 rounded-xl bg-indigo-50/60 border border-indigo-100 text-xs space-y-1">
                        <div className="font-semibold text-indigo-900 flex items-center gap-1.5">
                          <Info className="w-4 h-4 text-indigo-600" />
                          Document Description & Semantic Purpose
                        </div>
                        <p className="text-slate-700 leading-relaxed text-xs pt-1">
                          {inspectDoc.manual_description || inspectDoc.description}
                        </p>
                      </div>
                    )}

                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                        Extracted Structure & Metadata
                      </div>
                      <div className="bg-slate-900 text-slate-200 p-4 rounded-xl font-mono text-xs overflow-x-auto max-h-64">
                        <pre>{JSON.stringify(inspectDoc.parsed_metadata || {}, null, 2)}</pre>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="space-y-4">
                    <div className="relative">
                      <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search within chunks..."
                        value={chunkSearchQuery}
                        onChange={(e) => setChunkSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-3.5 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>

                    {loadingChunks ? (
                      <div className="p-12 text-center text-slate-400 text-xs">
                        <RefreshCw className="w-5 h-5 mx-auto animate-spin mb-2 text-indigo-600" />
                        Loading vector chunks and citation tags...
                      </div>
                    ) : filteredChunks.length === 0 ? (
                      <div className="p-8 text-center text-xs text-slate-400">
                        No vector chunks found matching query.
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {filteredChunks.map(chunk => (
                          <div key={chunk.id} className="p-3.5 rounded-xl border border-slate-200 bg-white space-y-2">
                            <div className="flex items-center justify-between text-[11px] text-slate-500 font-mono">
                              <span className="font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">
                                Chunk #{chunk.chunk_index} ({chunk.chunk_type})
                              </span>
                              {chunk.citation?.page_number && (
                                <span>Page {chunk.citation.page_number}</span>
                              )}
                              {chunk.citation?.sheet_name && (
                                <span>Sheet: {chunk.citation.sheet_name} (Row {chunk.citation.row_number})</span>
                              )}
                            </div>
                            <p className="text-xs text-slate-700 leading-relaxed font-sans whitespace-pre-wrap">
                              {chunk.content}
                            </p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Google Drive Workspace Explorer Modal (Preserved Two-Pane UX) */}
        {folderModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl border border-slate-200/90 shadow-2xl max-w-5xl w-full max-h-[88vh] flex flex-col overflow-hidden">
              {/* Header */}
              <div className="p-6 border-b border-slate-100 flex items-start justify-between gap-4 bg-white">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center shadow-inner flex-shrink-0">
                    <FolderTree className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Google Drive Workspace Explorer</h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Choose any folder in My Drive, Shared with me, or Shared Drives. All supported documents inside this folder and any nested subfolders will be auto-ingested.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setFolderModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Navigation Breadcrumb Bar */}
              <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-1.5 text-slate-600 overflow-x-auto">
                  {folderBreadcrumbs.map((crumb, idx) => {
                    const isLast = idx === folderBreadcrumbs.length - 1
                    return (
                      <React.Fragment key={crumb.id || "root"}>
                        {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />}
                        <button
                          type="button"
                          onClick={() => handleNavigateBreadcrumb(idx)}
                          className={`hover:text-indigo-600 transition truncate max-w-[150px] ${
                            isLast ? "font-bold text-slate-900" : "font-medium text-slate-600"
                          }`}
                        >
                          {crumb.name}
                        </button>
                      </React.Fragment>
                    )
                  })}
                </div>

                <div className="relative flex-shrink-0">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search folder contents..."
                    value={modalSearchQuery}
                    onChange={(e) => setModalSearchQuery(e.target.value)}
                    className="pl-8 pr-3 py-1 bg-white border border-slate-200 rounded-lg text-xs w-56 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Main Two-Pane Body */}
              <div className="flex-1 grid grid-cols-1 md:grid-cols-12 overflow-hidden min-h-[460px]">
                {/* Left Pane: Folders (Col 5) */}
                <div className="md:col-span-5 border-r border-slate-200 flex flex-col bg-slate-50/50 overflow-hidden">
                  <div className="p-3.5 border-b border-slate-200/80 bg-slate-100/70 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Folder className="w-4 h-4 text-indigo-600" />
                      <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                        Folders & Drives ({filteredModalFolders.length})
                      </span>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto p-2 space-y-1">
                    {folderLoading ? (
                      <div className="flex flex-col items-center justify-center h-48 gap-2 text-slate-400 text-xs">
                        <RefreshCw className="w-5 h-5 animate-spin text-indigo-600" />
                        <span>Loading Google Drive hierarchy...</span>
                      </div>
                    ) : filteredModalFolders.length === 0 ? (
                      <div className="text-center p-8 text-xs text-slate-400">
                        No folders found in this location.
                      </div>
                    ) : (
                      filteredModalFolders.map(item => {
                        const isSelected = selectedFolder?.id === item.id
                        const isSharedDrive = item.container_type === "shared_drive"
                        const canSelect = item.can_select !== false

                        return (
                          <div
                            key={item.id}
                            onClick={() => canSelect && handleSelectFolder(item)}
                            className={`p-2.5 rounded-xl border transition cursor-pointer flex items-center justify-between group ${
                              isSelected
                                ? "bg-indigo-50/80 border-indigo-400 shadow-2xs"
                                : "bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
                                {isSharedDrive ? <HardDrive className="w-4 h-4" /> : <Folder className="w-4 h-4" />}
                              </div>
                              <div className="truncate text-left">
                                <span className="text-xs font-semibold text-slate-800 truncate block">
                                  {item.name}
                                </span>
                                <span className="text-[10px] text-slate-400 font-mono truncate block">
                                  {item.path}
                                </span>
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {canSelect ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); handleEnterFolder(item); }}
                                    className="px-2 py-1 text-[11px] font-semibold text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg border border-slate-200 transition flex items-center gap-0.5"
                                  >
                                    <span>Open</span>
                                    <ChevronRight className="w-3 h-3" />
                                  </button>
                                  <div className={`w-5 h-5 rounded-full border flex items-center justify-center ${
                                    isSelected ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white"
                                  }`}>
                                    {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                                  </div>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); handleEnterFolder(item); }}
                                  className="px-2.5 py-1 text-[11px] font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg border border-sky-200"
                                >
                                  <span>Browse</span>
                                  <ChevronRight className="w-3 h-3" />
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>

                {/* Right Pane: Inspector & Files Preview (Col 7) */}
                <div className="md:col-span-7 flex flex-col bg-white overflow-hidden">
                  <div className="p-3.5 border-b border-slate-200 bg-white flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <FolderOpen className="w-4 h-4 text-indigo-600 flex-shrink-0" />
                        <span className="text-xs font-bold text-slate-900 truncate">
                          {activeInspectorFolder.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                          {eligibleFilesCount} Eligible
                        </span>
                        <span className="text-[10px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                          {excludedFilesCount} Excluded
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 pt-1 border-t border-slate-100 text-xs">
                      <button
                        onClick={() => setInspectorTab("all")}
                        className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                          inspectorTab === "all" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        All Files ({rawInspectorFiles.length})
                      </button>
                      <button
                        onClick={() => setInspectorTab("eligible")}
                        className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                          inspectorTab === "eligible" ? "bg-emerald-600 text-white" : "text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        Eligible Only ({eligibleFilesCount})
                      </button>
                      <button
                        onClick={() => setInspectorTab("excluded")}
                        className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                          inspectorTab === "excluded" ? "bg-slate-600 text-white" : "text-slate-600 hover:bg-slate-100"
                        }`}
                      >
                        Excluded ({excludedFilesCount})
                      </button>
                    </div>
                  </div>

                  {/* Inspector File Items */}
                  <div className="flex-1 overflow-y-auto p-3.5 space-y-2 bg-slate-50/20">
                    {loadingSelectedFiles ? (
                      <div className="flex flex-col items-center justify-center h-48 gap-2 text-slate-400 text-xs">
                        <RefreshCw className="w-5 h-5 animate-spin text-indigo-600" />
                        <span>Inspecting folder contents...</span>
                      </div>
                    ) : filteredInspectorFiles.length === 0 ? (
                      <div className="p-8 text-center text-xs text-slate-400">
                        No files in this folder. Nested subfolders will still be monitored recursively.
                      </div>
                    ) : (
                      filteredInspectorFiles.map(file => (
                        <div
                          key={file.id}
                          className="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 bg-white shadow-2xs"
                        >
                          <div className="flex items-center gap-2.5 truncate">
                            {getDriveItemFileIcon(file.mime_type, file.extension)}
                            <div className="truncate text-left">
                              <span className="text-xs font-semibold text-slate-800 truncate block">
                                {file.name}
                              </span>
                              <span className="text-[10px] text-slate-400">
                                {file.size_bytes ? formatBytes(file.size_bytes) : "Auto-converted"}
                              </span>
                            </div>
                          </div>
                          <div>
                            {file.is_supported ? (
                              <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                Ready for AI
                              </span>
                            ) : (
                              <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                                Excluded
                              </span>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Action Footer */}
              <div className="p-4 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                <div className="truncate max-w-md">
                  <span className="text-slate-400 block font-medium">Selected Target:</span>
                  {selectedFolder && selectedFolder.can_select !== false ? (
                    <div className="font-semibold text-indigo-700 truncate mt-0.5">
                      {selectedFolder.name} ({eligibleFilesCount} eligible documents ready)
                    </div>
                  ) : (
                    <span className="text-slate-500 italic mt-0.5 block">
                      Click any folder in the left pane to select it
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2.5">
                  <button
                    onClick={() => setFolderModalOpen(false)}
                    className="px-4 py-2 bg-white text-slate-700 font-semibold rounded-xl border border-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmFolderSelection}
                    disabled={!selectedFolder || selectedFolder.can_select === false || savingFolder}
                    className="px-5 py-2 bg-indigo-600 text-white font-bold rounded-xl disabled:opacity-50"
                  >
                    {savingFolder ? "Saving..." : "Confirm & Monitor Folder"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
