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
  Users,
  File as FileIcon,
  Image as ImageIcon,
  Eye,
  Ban
} from "lucide-react"

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"

interface CoachDocument {
  id: string
  file_name: string
  file_type: string
  file_size_bytes: number
  status: "pending" | "parsing" | "embedding" | "completed" | "failed"
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

export default function CoachUploadsPage() {
  const { employeeData, user: authUser } = useAuth()
  const companyId = employeeData?.company_id

  // State
  const [documents, setDocuments] = useState<CoachDocument[]>([])
  const [employees, setEmployees] = useState<EmployeeOption[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadProgressText, setUploadProgressText] = useState("")
  const [errorToast, setErrorToast] = useState<string | null>(null)
  const [successToast, setSuccessToast] = useState<string | null>(null)

  // Upload Form State
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [targetEmployeeId, setTargetEmployeeId] = useState<string>("")
  const [manualDescription, setManualDescription] = useState<string>("")
  const [isDragOver, setIsDragOver] = useState(false)

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<string>("all")

  // Inspection Drawer/Modal State
  const [inspectDoc, setInspectDoc] = useState<CoachDocument | null>(null)
  const [isDeleting, setIsDeleting] = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Google Drive State
  const [gdriveStatus, setGdriveStatus] = useState<{ connected: boolean; integration?: GoogleDriveIntegration } | null>(null)
  const [gdriveLoading, setGdriveLoading] = useState(true)
  const [syncingGDrive, setSyncingGDrive] = useState(false)
  const [disconnectingGDrive, setDisconnectingGDrive] = useState(false)

  // 1. Fetch Ingested Documents
  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/coach/documents`)
      if (res.ok) {
        const payload = await res.json()
        setDocuments(payload.documents || [])
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

  // Fetch Google Drive Status
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

  const handleConnectGDrive = async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/integrations/google-drive/auth-url`)
      if (res.ok) {
        const data = await res.json()
        if (data.auth_url) {
          // Open OAuth consent in a centered popup browser window
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
            // Popup blocker prevented popup window, fallback to full page redirect
            window.location.href = data.auth_url
          } else {
            popup.focus()
          }
        }
      } else {
        const err = await res.json()
        setErrorToast(err.detail || "Failed to initialize Google Drive connection.")
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
        await fetchDocuments()
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
      } else {
        const err = await res.json()
        setErrorToast(err.detail || "Failed to disconnect.")
      }
    } catch (err: any) {
      setErrorToast(err.message || "Failed to disconnect.")
    } finally {
      setDisconnectingGDrive(false)
    }
  }

  // Folder Picker Modal State
  const [folderModalOpen, setFolderModalOpen] = useState(false)
  const [folderLoading, setFolderLoading] = useState(false)
  const [folderItems, setFolderItems] = useState<DriveFolderItem[]>([])
  const [folderFiles, setFolderFiles] = useState<DriveFileItem[]>([])
  const [selectedFolder, setSelectedFolder] = useState<DriveFolderItem | null>(null)
  const [selectedFolderFiles, setSelectedFolderFiles] = useState<DriveFileItem[]>([])
  const [loadingSelectedFiles, setLoadingSelectedFiles] = useState(false)
  const [folderFilterTab, setFolderFilterTab] = useState<"all" | "folders" | "files">("all")
  const [modalSearchQuery, setModalSearchQuery] = useState("")
  const [inspectorTab, setInspectorTab] = useState<"all" | "eligible" | "excluded">("all")
  const [folderBreadcrumbs, setFolderBreadcrumbs] = useState<Array<{ id: string | null; name: string; drive_id?: string | null }>>([
    { id: null, name: "Google Drive" }
  ])
  const [savingFolder, setSavingFolder] = useState(false)
  const [sourceFilter, setSourceFilter] = useState<"all" | "gdrive" | "manual">("all")

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
    setFolderFilterTab("all")
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

    // Preview files inside this selected folder
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
    setFolderFilterTab("all")
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
    setFolderFilterTab("all")
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
        await fetchDocuments()
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

  // Handle OAuth messages from popup window & fallback URL query parameters
  useEffect(() => {
    // 1. Listen for postMessage from popup window
    const handleOAuthMessage = (event: MessageEvent) => {
      if (event.data?.type === "GOOGLE_DRIVE_OAUTH_SUCCESS") {
        const email = event.data.email || ""
        setSuccessToast(`Google Drive ${email ? `(${email}) ` : ""}connected successfully! Live ingestion is active for 'Lucid Coach Ingestion'.`)
        fetchGDriveStatus()
        fetchDocuments()
      } else if (event.data?.type === "GOOGLE_DRIVE_OAUTH_ERROR") {
        setErrorToast(`Google Drive connection error: ${event.data.error || "Unknown error"}`)
      }
    }

    window.addEventListener("message", handleOAuthMessage)

    // 2. Fallback: inspect URL query params if user completed full-page redirect
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search)
      if (params.get("gdrive_connected") === "true") {
        const email = params.get("email") || ""
        setSuccessToast(`Google Drive ${email ? `(${email}) ` : ""}connected successfully! Live ingestion is active for 'Lucid Coach Ingestion'.`)
        window.history.replaceState({}, "", window.location.pathname)
        fetchGDriveStatus()
        fetchDocuments()
      } else if (params.get("gdrive_error")) {
        setErrorToast(`Google Drive connection error: ${params.get("gdrive_error")}`)
        window.history.replaceState({}, "", window.location.pathname)
      }
    }

    return () => window.removeEventListener("message", handleOAuthMessage)
  }, [fetchGDriveStatus, fetchDocuments])

  useEffect(() => {
    fetchDocuments()
    fetchEmployees()
    fetchGDriveStatus()
  }, [fetchDocuments, fetchEmployees, fetchGDriveStatus])

  // 3. Auto-poll if any document is in progress (pending, parsing, embedding)
  useEffect(() => {
    const hasActiveJobs = documents.some(d => 
      d.status === "pending" || d.status === "parsing" || d.status === "embedding"
    )

    if (!hasActiveJobs) return

    const interval = setInterval(() => {
      fetchDocuments()
    }, 3500)

    return () => clearInterval(interval)
  }, [documents, fetchDocuments])

  // File Selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0])
      setErrorToast(null)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragOver(false)
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      setSelectedFile(e.dataTransfer.files[0])
      setErrorToast(null)
    }
  }

  // Upload Submission
  const handleUpload = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedFile) {
      setErrorToast("Please select a file to upload.")
      return
    }

    setUploading(true)
    setUploadProgressText("Uploading document to storage...")
    setErrorToast(null)
    setSuccessToast(null)

    try {
      const formData = new FormData()
      formData.append("file", selectedFile)
      if (targetEmployeeId && targetEmployeeId !== "general") {
        formData.append("target_employee_id", targetEmployeeId)
      }
      if (manualDescription.trim()) {
        formData.append("manual_description", manualDescription.trim())
      }

      setUploadProgressText("Registering document and starting background ingestion...")
      const res = await fetchWithAuth(`${API_BASE}/api/coach/upload`, {
        method: "POST",
        body: formData
      })

      const payload = await res.json()

      if (!res.ok) {
        throw new Error(payload.detail || payload.message || "Failed to upload file")
      }

      setSuccessToast(`Document '${selectedFile.name}' queued! Live parsing & embedding started.`)
      setSelectedFile(null)
      setTargetEmployeeId("")
      setManualDescription("")
      if (fileInputRef.current) fileInputRef.current.value = ""
      
      // Refresh list immediately
      await fetchDocuments()
    } catch (err: any) {
      console.error("[coach-upload] Upload failed:", err)
      setErrorToast(err.message || "Upload failed. Please check backend connection.")
    } finally {
      setUploading(false)
      setUploadProgressText("")
    }
  }

  // Delete Document
  const handleDelete = async (docId: string, fileName: string) => {
    if (!confirm(`Are you sure you want to delete '${fileName}'? All associated vector chunks and evidence rows will be removed.`)) {
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
      } else {
        const payload = await res.json()
        setErrorToast(payload.detail || "Failed to delete document")
      }
    } catch (err: any) {
      setErrorToast(err.message || "Error deleting document")
    } finally {
      setIsDeleting(null)
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

  const getStatusBadge = (status: CoachDocument["status"]) => {
    switch (status) {
      case "completed":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Ready for AI
          </span>
        )
      case "parsing":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 animate-pulse">
            <Layers className="w-3.5 h-3.5 text-blue-600 animate-spin" /> Parsing Content
          </span>
        )
      case "embedding":
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200 animate-pulse">
            <Sparkles className="w-3.5 h-3.5 text-purple-600 animate-spin" /> Vectorizing
          </span>
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

  // Format Google Drive sync date as dd - month (in alphabet) - yyyy, hh:mm AM/PM
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

  // Summary Metrics
  const totalDocs = documents.length
  const completedDocs = documents.filter(d => d.status === "completed").length
  const totalChunks = documents.reduce((acc, d) => acc + (d.parsed_metadata?.chunks_count || 0), 0)
  const totalRows = documents.reduce((acc, d) => acc + (d.parsed_metadata?.spreadsheet_rows_count || 0), 0)

  // Filtered Documents
  const filteredDocs = documents.filter(doc => {
    const matchesSearch = doc.file_name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesStatus = statusFilter === "all" || doc.status === statusFilter
    const isGDriveDoc = Boolean(doc.manual_description?.toLowerCase().includes("google drive"))
    const matchesSource = sourceFilter === "all" || (sourceFilter === "gdrive" ? isGDriveDoc : !isGDriveDoc)
    return matchesSearch && matchesStatus && matchesSource
  })

  // Filtered Modal Items
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
              onClick={() => { setLoading(true); fetchDocuments(); }}
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

        {/* Google Drive Connector Card */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 md:p-8 overflow-hidden relative">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-blue-50 via-indigo-50 to-emerald-50 border border-slate-200/60 flex items-center justify-center flex-shrink-0 shadow-sm">
                <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                  <path d="M8.2 2L15.8 2L23.4 15L15.8 15L8.2 2Z" fill="#FFC107" />
                  <path d="M0.6 15L8.2 2L12 8.5L4.4 21.5L0.6 15Z" fill="#0066DA" />
                  <path d="M4.4 21.5L12 8.5L19.6 21.5L4.4 21.5Z" fill="#00AC47" />
                  <path d="M12 8.5L15.8 15L23.4 15L19.6 21.5L12 8.5Z" fill="#2684FC" />
                </svg>
              </div>

              <div>
                <div className="flex items-center gap-2.5">
                  <h2 className="text-lg font-bold text-slate-900">Google Drive Real-Time Ingestion</h2>
                  {gdriveStatus?.connected && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                      Live Sync Active
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-1 max-w-xl">
                  {gdriveStatus?.connected
                    ? "Files placed into the dedicated Google Drive folder are automatically converted (Google Docs/Sheets -> PDF/Excel), indexed, and vectorized into the Coach vault."
                    : "Connect your organization's Google Drive. Files uploaded to the dedicated 'Lucid Coach Ingestion' folder are ingested automatically in real time."}
                </p>
              </div>
            </div>

            {/* Actions / Status Controls */}
            <div className="flex items-center gap-2.5 self-start md:self-auto flex-shrink-0 flex-wrap">
              {gdriveLoading ? (
                <div className="text-xs text-slate-400 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                  Checking connection...
                </div>
              ) : gdriveStatus?.connected ? (
                <>
                  <button
                    onClick={handleOpenFolderPicker}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:text-indigo-600 hover:border-indigo-200 transition shadow-sm"
                  >
                    <FolderTree className="w-3.5 h-3.5 text-indigo-600" />
                    Select Folder
                  </button>

                  <a
                    href={gdriveStatus.integration?.folder_id ? `https://drive.google.com/drive/folders/${gdriveStatus.integration.folder_id}` : "https://drive.google.com"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:text-indigo-600 hover:border-indigo-200 transition shadow-sm"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                    Open in Drive
                  </a>

                  <button
                    onClick={handleSyncGDriveNow}
                    disabled={syncingGDrive}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-xl hover:bg-indigo-100 transition shadow-sm disabled:opacity-50"
                  >
                    <FolderSync className={`w-3.5 h-3.5 ${syncingGDrive ? "animate-spin text-indigo-600" : ""}`} />
                    {syncingGDrive ? "Syncing..." : "Sync Now"}
                  </button>

                  <button
                    onClick={handleDisconnectGDrive}
                    disabled={disconnectingGDrive}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-rose-600 bg-rose-50/70 border border-rose-200 rounded-xl hover:bg-rose-100 transition disabled:opacity-50"
                  >
                    Disconnect
                  </button>
                </>
              ) : (
                <button
                  onClick={handleConnectGDrive}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl transition shadow-sm"
                >
                  <HardDrive className="w-4 h-4" />
                  Connect Google Drive
                </button>
              )}
            </div>
          </div>

          {/* Connected Details Bar */}
          {gdriveStatus?.connected && gdriveStatus.integration && (
            <div className="mt-5 pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 bg-slate-50/50 p-4 rounded-xl text-xs">
              <div>
                <span className="text-slate-400 font-medium block">Google Account</span>
                <span className="text-slate-800 font-semibold truncate block mt-0.5">
                  {gdriveStatus.integration.google_account_email}
                </span>
                <span className="text-[11px] text-slate-500 block mt-0.5">
                  OAuth Vault Encrypted
                </span>
              </div>
              <div>
                <span className="text-slate-400 font-medium block">Monitored Root</span>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <a
                    href={gdriveStatus.integration.folder_id ? `https://drive.google.com/drive/folders/${gdriveStatus.integration.folder_id}` : "https://drive.google.com"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-indigo-600 hover:text-indigo-800 hover:underline font-semibold inline-flex items-center gap-1 group truncate"
                    title="Open folder in Google Drive"
                  >
                    <FolderOpen className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="truncate">{gdriveStatus.integration.folder_name}</span>
                    <ExternalLink className="w-3 h-3 opacity-60 group-hover:opacity-100 flex-shrink-0" />
                  </a>
                  <button
                    onClick={handleOpenFolderPicker}
                    className="ml-auto text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50/80 px-2 py-0.5 rounded border border-indigo-200/60"
                  >
                    Change
                  </button>
                </div>
                <span className="text-[11px] text-slate-500 font-mono block mt-0.5 truncate">
                  {gdriveStatus.integration.folder_path || `/${gdriveStatus.integration.folder_name}`}
                </span>
              </div>
              <div>
                <span className="text-slate-400 font-medium block">Ingestion Scope</span>
                <div className="mt-0.5 flex items-center gap-1.5">
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Full Subtree (Recursive)
                  </span>
                </div>
                <span className="text-[11px] text-slate-500 block mt-0.5">
                  {gdriveStatus.integration.total_synced_files} file(s) ingested
                </span>
              </div>
              <div>
                <span className="text-slate-400 font-medium block">Last Synced</span>
                <span className="text-slate-700 font-semibold block mt-0.5">
                  {formatGDriveSyncDate(gdriveStatus.integration.last_synced_at)}
                </span>
                <span className="text-[11px] text-slate-500 block mt-0.5">
                  {gdriveStatus.integration.webhook_active ? "Push Webhook Active" : "Polling Active"}
                </span>
              </div>
            </div>
          )}

          {gdriveStatus?.connected && gdriveStatus.integration?.error_message && (
            <div className="mt-3 p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
              <span>{gdriveStatus.integration.error_message}</span>
            </div>
          )}
        </div>

        {/* Drag & Drop Upload Card */}
        <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-6 md:p-8">
          <div className="flex items-center gap-2 mb-4">
            <Upload className="w-5 h-5 text-indigo-600" />
            <h2 className="text-lg font-bold text-slate-900">Upload Performance Evidence</h2>
          </div>

          <form onSubmit={handleUpload} className="space-y-6">
            {/* Drop Zone */}
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition flex flex-col items-center justify-center gap-3 ${
                isDragOver 
                  ? "border-indigo-500 bg-indigo-50/50" 
                  : selectedFile 
                    ? "border-emerald-400 bg-emerald-50/20" 
                    : "border-slate-300 hover:border-indigo-400 bg-slate-50/50"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                onChange={handleFileChange}
                accept=".pdf,.docx,.doc,.csv,.xlsx,.xls,.pptx,.ppt"
                className="hidden"
              />

              {selectedFile ? (
                <div className="flex items-center gap-3 p-3 bg-white rounded-xl border border-emerald-200 shadow-sm max-w-md">
                  {getFileIcon(selectedFile.name.split(".").pop() || "")}
                  <div className="text-left overflow-hidden">
                    <div className="text-sm font-semibold text-slate-900 truncate">{selectedFile.name}</div>
                    <div className="text-xs text-slate-500">{formatBytes(selectedFile.size)}</div>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); setSelectedFile(null); }}
                    className="ml-auto text-slate-400 hover:text-slate-600 p-1"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center shadow-inner">
                    <Upload className="w-6 h-6" />
                  </div>
                  <div>
                    <span className="text-sm font-semibold text-indigo-600 hover:text-indigo-700">Click to browse</span>
                    <span className="text-sm text-slate-600"> or drag and drop files here</span>
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
                  Tagging a specific employee allows the coach to restrict citation visibility to that employee and their manager.
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
                Supported formats: PDF, DOCX, DOC, Excel (.xlsx, .xls), CSV, PPTX
              </div>
              <button
                type="submit"
                disabled={!selectedFile || uploading}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-sm w-full md:w-auto"
              >
                {uploading ? (
                  <>
                    <Layers className="w-4 h-4 animate-spin" />
                    Ingesting...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    Upload & Ingest for Coach
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
          ) : filteredDocs.length === 0 ? (
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
                  {filteredDocs.map((doc) => {
                    const meta = doc.parsed_metadata || {}
                    const chunksCount = meta.chunks_count ?? 0
                    const rowsCount = meta.spreadsheet_rows_count ?? 0
                    const empTarget = employees.find(e => e.user_id === doc.target_employee_id)

                    return (
                      <tr key={doc.id} className="hover:bg-slate-50/60 transition">
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
                              {(doc.manual_description || doc.description) && (
                                <div className="text-xs text-slate-600 italic line-clamp-1 mt-1 max-w-sm">
                                  {doc.manual_description || doc.description}
                                </div>
                              )}
                            </div>
                          </div>
                        </td>

                        <td className="py-4 px-4 whitespace-nowrap">
                          {getStatusBadge(doc.status)}
                        </td>

                        <td className="py-4 px-4 text-xs text-slate-600 whitespace-nowrap">
                          {chunksCount > 0 ? (
                            <span className="font-medium text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded mr-1">
                              {chunksCount} vector chunks
                            </span>
                          ) : null}
                          {rowsCount > 0 ? (
                            <span className="font-medium text-purple-700 bg-purple-50 px-2 py-0.5 rounded">
                              {rowsCount} rows
                            </span>
                          ) : null}
                          {chunksCount === 0 && rowsCount === 0 && doc.status === "completed" && (
                            <span className="text-slate-400">0 chunks</span>
                          )}
                          {doc.status === "failed" && (
                            <span className="text-rose-600 font-medium truncate max-w-xs block">
                              {doc.error_message || "Error"}
                            </span>
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

                        <td className="py-4 px-6 text-right whitespace-nowrap">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setInspectDoc(doc)}
                              className="px-2.5 py-1 text-xs font-medium text-slate-600 hover:text-indigo-600 bg-slate-100 hover:bg-indigo-50 rounded-lg transition"
                            >
                              Inspect Logs
                            </button>
                            <button
                              onClick={() => handleDelete(doc.id, doc.file_name)}
                              disabled={isDeleting === doc.id}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
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
            </div>
          )}
        </div>

        {/* Detailed Ingestion Log Inspection Modal */}
        {inspectDoc && (
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl border border-slate-200 shadow-2xl max-w-2xl w-full p-6 space-y-5 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-slate-100 rounded-xl">
                    {getFileIcon(inspectDoc.file_type)}
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-slate-900">{inspectDoc.file_name}</h3>
                    <div className="text-xs text-slate-500">ID: {inspectDoc.id}</div>
                  </div>
                </div>
                <button
                  onClick={() => setInspectDoc(null)}
                  className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Status Banner */}
              <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                <div className="text-xs font-medium text-slate-600">Current Status</div>
                {getStatusBadge(inspectDoc.status)}
              </div>

              {/* Description & Summary Section */}
              {(inspectDoc.manual_description || inspectDoc.description) && (
                <div className="p-4 rounded-xl bg-indigo-50/70 border border-indigo-100 text-xs space-y-1">
                  <div className="font-semibold text-indigo-900 flex items-center gap-1.5">
                    <Info className="w-4 h-4 text-indigo-600" />
                    Document Description & Summary
                  </div>
                  <p className="text-slate-700 leading-relaxed text-xs pt-1">
                    {inspectDoc.manual_description || inspectDoc.description}
                  </p>
                </div>
              )}

              {/* Error Message Display if Failed */}
              {inspectDoc.status === "failed" && (
                <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs space-y-1">
                  <div className="font-bold flex items-center gap-1.5">
                    <AlertCircle className="w-4 h-4 text-rose-600" />
                    Failure Trace
                  </div>
                  <pre className="font-mono text-[11px] whitespace-pre-wrap overflow-x-auto">
                    {inspectDoc.error_message || "Unknown error during ingestion."}
                  </pre>
                </div>
              )}

              {/* Detected Columns & Header Banner */}
              {inspectDoc.parsed_metadata?.columns_detected && inspectDoc.parsed_metadata.columns_detected.length > 0 && (
                <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-2">
                  <div className="flex items-center justify-between text-slate-700 font-semibold">
                    <span>Detected Columns ({inspectDoc.parsed_metadata.columns_detected.length})</span>
                    {inspectDoc.parsed_metadata?.header_row_detected && (
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                        Header at Excel Row {inspectDoc.parsed_metadata.header_row_detected}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pt-1">
                    {inspectDoc.parsed_metadata.columns_detected.map((col: string, idx: number) => (
                      <span key={idx} className="px-2 py-0.5 bg-white border border-slate-200 rounded text-[11px] font-mono text-slate-700">
                        {col}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Parsed Metadata Breakdown */}
              <div className="space-y-2">
                <div className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                  Ingestion Metadata & Proof Citations
                </div>
                <div className="bg-slate-900 text-slate-200 p-4 rounded-xl font-mono text-xs overflow-x-auto max-h-64">
                  <pre>{JSON.stringify(inspectDoc.parsed_metadata || {}, null, 2)}</pre>
                </div>
              </div>

              <div className="flex justify-between items-center text-xs text-slate-500 pt-2 border-t border-slate-100">
                <span>Created at: {new Date(inspectDoc.created_at).toLocaleString()}</span>
                <button
                  onClick={() => setInspectDoc(null)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium rounded-lg transition"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Google Drive Folder Picker Modal - Two-Pane Workspace Explorer */}
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
                  title="Close Explorer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Navigation Strip & Search Bar */}
              <div className="px-6 py-2.5 bg-slate-50 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                {/* Breadcrumbs */}
                <div className="flex items-center gap-1.5 text-slate-600 overflow-x-auto">
                  {folderBreadcrumbs.map((crumb, idx) => {
                    const isLast = idx === folderBreadcrumbs.length - 1
                    return (
                      <React.Fragment key={idx}>
                        {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-slate-400 flex-shrink-0" />}
                        <button
                          onClick={() => handleNavigateBreadcrumb(idx)}
                          disabled={isLast || folderLoading}
                          className={`hover:underline flex items-center gap-1 flex-shrink-0 font-medium ${
                            isLast ? "text-indigo-600 font-semibold" : "text-slate-600 hover:text-slate-900"
                          }`}
                        >
                          {idx === 0 ? (
                            <HardDrive className="w-3.5 h-3.5 text-slate-500" />
                          ) : crumb.id === "shared_with_me" ? (
                            <Users className="w-3.5 h-3.5 text-sky-500" />
                          ) : (
                            <Folder className="w-3.5 h-3.5 text-indigo-500" />
                          )}
                          <span>{crumb.name}</span>
                        </button>
                      </React.Fragment>
                    )
                  })}
                </div>

                {/* Instant Search */}
                <div className="relative flex-shrink-0">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search folders & files..."
                    value={modalSearchQuery}
                    onChange={(e) => setModalSearchQuery(e.target.value)}
                    className="pl-8 pr-3 py-1 text-xs bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full sm:w-48 shadow-2xs"
                  />
                </div>
              </div>

              {/* Active Monitored Folder Banner if connected */}
              {gdriveStatus?.integration?.folder_name && (
                <div className="px-6 py-2 bg-indigo-50/40 border-b border-indigo-100/60 flex items-center justify-between text-xs text-indigo-900">
                  <div className="flex items-center gap-2 truncate">
                    <span className="text-slate-500 font-medium flex-shrink-0">Currently Monitored:</span>
                    <span className="font-semibold text-indigo-700 flex items-center gap-1 truncate">
                      <FolderOpen className="w-3.5 h-3.5 flex-shrink-0" />
                      {gdriveStatus.integration.folder_name}
                    </span>
                    <span className="text-[10px] bg-indigo-100 text-indigo-800 font-bold px-1.5 py-0.5 rounded flex-shrink-0">
                      Recursive Subtree
                    </span>
                  </div>
                  <span className="text-[11px] text-slate-500 hidden md:inline flex-shrink-0">
                    Switching folders preserves historical documents as detached
                  </span>
                </div>
              )}

              {/* Main Two-Pane Explorer Body */}
              <div className="flex-1 grid grid-cols-1 md:grid-cols-12 overflow-hidden min-h-[460px]">
                {/* Left Pane: Folders & Subtrees (Col 5) */}
                <div className="md:col-span-5 border-r border-slate-200 flex flex-col bg-slate-50/50 overflow-hidden">
                  <div className="p-3.5 border-b border-slate-200/80 bg-slate-100/70 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Folder className="w-4 h-4 text-indigo-600" />
                      <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                        Folders & Drives ({filteredModalFolders.length})
                      </span>
                    </div>
                    <span className="text-[11px] text-slate-400">
                      Click to inspect
                    </span>
                  </div>

                  <div className="flex-1 overflow-y-auto p-3 space-y-2">
                    {folderLoading ? (
                      <div className="flex flex-col items-center justify-center h-48 gap-3 text-slate-400 text-xs">
                        <RefreshCw className="w-6 h-6 animate-spin text-indigo-600" />
                        <span>Browsing Google Drive folders...</span>
                      </div>
                    ) : filteredModalFolders.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-48 text-center p-6 bg-white rounded-2xl border border-dashed border-slate-200">
                        <Folder className="w-8 h-8 text-slate-300 mb-2" />
                        <p className="text-xs font-semibold text-slate-700">No subfolders in this location</p>
                        <p className="text-[11px] text-slate-400 mt-1">
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
                                ? "bg-indigo-50/80 border-indigo-400 shadow-sm ring-1 ring-indigo-300"
                                : isSharedWithMeRoot
                                  ? "bg-sky-50/40 hover:bg-sky-50/80 border-sky-200"
                                  : "bg-white hover:bg-slate-100/70 border-slate-200"
                            }`}
                          >
                            <div className="flex items-center justify-between gap-3">
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                  isSharedDrive 
                                    ? "bg-emerald-50 text-emerald-600 border border-emerald-200" 
                                    : isSharedWithMeRoot
                                      ? "bg-sky-100 text-sky-700 border border-sky-200"
                                      : isSharedFolder
                                        ? "bg-blue-50 text-blue-600 border border-blue-200"
                                        : "bg-indigo-50 text-indigo-600 border border-indigo-100"
                                }`}>
                                  {isSharedDrive ? (
                                    <HardDrive className="w-4 h-4" />
                                  ) : isSharedWithMeRoot ? (
                                    <Users className="w-4 h-4" />
                                  ) : isSharedFolder ? (
                                    <FolderSync className="w-4 h-4" />
                                  ) : (
                                    <Folder className="w-4 h-4" />
                                  )}
                                </div>
                                <div className="truncate">
                                  <div className="flex items-center gap-1.5">
                                    <span className={`text-xs font-semibold truncate ${
                                      isSelected ? "text-indigo-900 font-bold" : "text-slate-800"
                                    }`}>
                                      {item.name}
                                    </span>
                                  </div>
                                  <span className="text-[10px] text-slate-400 font-mono block truncate">
                                    {item.path}
                                  </span>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                {canSelect ? (
                                  <>
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation()
                                        handleEnterFolder(item)
                                      }}
                                      className="px-2 py-1 text-[11px] font-semibold text-slate-600 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg border border-slate-200 transition flex items-center gap-0.5 shadow-2xs"
                                      title="Open subfolder"
                                    >
                                      <span>Open</span>
                                      <ChevronRight className="w-3 h-3" />
                                    </button>

                                    <div className={`w-5 h-5 rounded-full border flex items-center justify-center transition ${
                                      isSelected
                                        ? "border-indigo-600 bg-indigo-600 text-white shadow-sm"
                                        : "border-slate-300 group-hover:border-slate-400 bg-white"
                                    }`}>
                                      {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                                    </div>
                                  </>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      handleEnterFolder(item)
                                    }}
                                    className="px-2.5 py-1 text-[11px] font-semibold text-sky-700 bg-sky-50 hover:bg-sky-100 rounded-lg border border-sky-200 transition flex items-center gap-1"
                                  >
                                    <span>Browse</span>
                                    <ChevronRight className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>

                {/* Right Pane: Folder Inspector & Files Preview (Col 7) */}
                <div className="md:col-span-7 flex flex-col bg-white overflow-hidden">
                  {/* Inspector Subheader */}
                  <div className="p-3.5 border-b border-slate-200 bg-white flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2 min-w-0">
                        <FolderOpen className="w-4 h-4 text-indigo-600 flex-shrink-0" />
                        <span className="text-xs font-bold text-slate-900 truncate">
                          {activeInspectorFolder.name}
                        </span>
                        {isInspectingSelectedSubfolder && (
                          <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.2 rounded flex-shrink-0">
                            Selected
                          </span>
                        )}
                      </div>

                      {/* Metrics Pills */}
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          {eligibleFilesCount} Eligible
                        </span>
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-200">
                          <Ban className="w-2.5 h-2.5 text-slate-400" />
                          {excludedFilesCount} Excluded
                        </span>
                        {totalInspectorBytes > 0 && (
                          <span className="text-[10px] text-slate-500 bg-slate-50 px-2 py-0.5 rounded border border-slate-200 font-mono">
                            {formatBytes(totalInspectorBytes)}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Filter Tabs for Inspector */}
                    <div className="flex items-center gap-1.5 pt-1">
                      <button
                        type="button"
                        onClick={() => setInspectorTab("all")}
                        className={`px-2.5 py-0.5 rounded-md text-[11px] font-semibold transition ${
                          inspectorTab === "all"
                            ? "bg-slate-900 text-white"
                            : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
                        }`}
                      >
                        All Files ({rawInspectorFiles.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setInspectorTab("eligible")}
                        className={`px-2.5 py-0.5 rounded-md text-[11px] font-semibold transition flex items-center gap-1 ${
                          inspectorTab === "eligible"
                            ? "bg-emerald-600 text-white"
                            : "text-emerald-700 hover:bg-emerald-50"
                        }`}
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        Eligible Only ({eligibleFilesCount})
                      </button>
                      <button
                        type="button"
                        onClick={() => setInspectorTab("excluded")}
                        className={`px-2.5 py-0.5 rounded-md text-[11px] font-semibold transition flex items-center gap-1 ${
                          inspectorTab === "excluded"
                            ? "bg-slate-700 text-white"
                            : "text-slate-500 hover:bg-slate-100"
                        }`}
                      >
                        <Ban className="w-2.5 h-2.5" />
                        Excluded ({excludedFilesCount})
                      </button>
                    </div>
                  </div>

                  {/* Inspector File Items */}
                  <div className="flex-1 overflow-y-auto p-3.5 space-y-2 bg-slate-50/20">
                    {loadingSelectedFiles ? (
                      <div className="flex flex-col items-center justify-center h-48 gap-2.5 text-slate-400 text-xs">
                        <RefreshCw className="w-5 h-5 animate-spin text-indigo-600" />
                        <span>Inspecting folder contents...</span>
                      </div>
                    ) : filteredInspectorFiles.length === 0 ? (
                      <div className="flex flex-col items-center justify-center h-48 text-center p-6 bg-white rounded-2xl border border-dashed border-slate-200">
                        <FileIcon className="w-8 h-8 text-slate-300 mb-2" />
                        <p className="text-xs font-semibold text-slate-700">No files found</p>
                        <p className="text-[11px] text-slate-400 mt-1 max-w-xs">
                          {modalSearchQuery.trim()
                            ? "No files match your current search query."
                            : "No files directly in this folder. Any nested subfolders will still be auto-scanned recursively."}
                        </p>
                      </div>
                    ) : (
                      filteredInspectorFiles.map(file => (
                        <div
                          key={file.id}
                          className="flex items-center justify-between p-2.5 rounded-xl border border-slate-200 bg-white hover:border-slate-300 transition shadow-2xs"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            {getDriveItemFileIcon(file.mime_type, file.extension)}
                            <div className="truncate">
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-semibold text-slate-800 truncate" title={file.name}>
                                  {file.name}
                                </span>
                                {file.extension && (
                                  <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">
                                    {file.extension}
                                  </span>
                                )}
                                {file.is_google_doc && (
                                  <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                                    Workspace
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5">
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

                          <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                            {file.is_supported ? (
                              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                                Ready for AI
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                                <Ban className="w-2.5 h-2.5 text-slate-400" />
                                Excluded
                              </span>
                            )}

                            {file.web_view_link && (
                              <a
                                href={file.web_view_link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="p-1 text-slate-400 hover:text-indigo-600 rounded transition"
                                title="Open in Google Drive"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Selection Summary & Action Footer */}
              <div className="p-4 border-t border-slate-200 bg-slate-50 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                <div className="truncate max-w-md">
                  <span className="text-slate-400 block font-medium">Selected Target Folder:</span>
                  {selectedFolder && selectedFolder.can_select !== false ? (
                    <div>
                      <div className="flex items-center gap-1.5 text-indigo-700 font-semibold truncate mt-0.5">
                        <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0 text-emerald-600" />
                        <span className="truncate">{selectedFolder.name}</span>
                        <span className="text-[10px] text-emerald-700 font-bold bg-emerald-100 px-1.5 py-0.5 rounded border border-emerald-200 flex-shrink-0">
                          Recursive Subtree
                        </span>
                        <span className="text-[10px] text-slate-600 bg-slate-200/80 px-1.5 py-0.5 rounded font-mono flex-shrink-0">
                          {selectedFolder.path}
                        </span>
                      </div>
                      <span className="text-[11px] text-emerald-700 font-medium block mt-0.5">
                        {eligibleFilesCount} eligible document(s) ready • Historical documents preserved as detached
                      </span>
                    </div>
                  ) : (
                    <span className="text-slate-500 italic mt-0.5 block">
                      Click any folder in the left pane to select it for AI ingestion
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2.5 self-end sm:self-auto flex-shrink-0">
                  <button
                    onClick={() => setFolderModalOpen(false)}
                    className="px-4 py-2 bg-white hover:bg-slate-100 text-slate-700 font-semibold rounded-xl border border-slate-200 transition shadow-2xs"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmFolderSelection}
                    disabled={!selectedFolder || selectedFolder.can_select === false || savingFolder}
                    className="inline-flex items-center gap-2 px-5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition shadow-sm disabled:opacity-50"
                  >
                    {savingFolder ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Saving & Syncing...
                      </>
                    ) : (
                      <>
                        <Check className="w-4 h-4" />
                        Confirm & Monitor Folder
                      </>
                    )}
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
