"use client"

import React, { useState, useEffect, useRef, useCallback } from "react"
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
  UserCheck,
  FolderSync,
  HardDrive,
  FolderOpen
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
  sync_status: string
  webhook_active: boolean
  webhook_expiration?: string | null
  last_synced_at?: string | null
  total_synced_files: number
  error_message?: string | null
  connected_at?: string | null
}

export default function CoachUploadsPage() {
  const { employeeData, user: authUser, isAdmin, isSuperAdmin, isDeveloper, rolesLoaded, loading: authLoading } = useAuth()
  const companyId = employeeData?.company_id
  const hasAccess = isAdmin || isSuperAdmin || isDeveloper

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
    if (rolesLoaded && hasAccess) {
      fetchDocuments()
      fetchEmployees()
      fetchGDriveStatus()
    } else if (rolesLoaded && !hasAccess) {
      setLoading(false)
    }
  }, [rolesLoaded, hasAccess, fetchDocuments, fetchEmployees, fetchGDriveStatus])

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

  if (rolesLoaded && !hasAccess) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-6">
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm max-w-md w-full p-8 text-center space-y-4">
          <div className="w-14 h-14 bg-rose-50 text-rose-500 rounded-full flex items-center justify-center mx-auto">
            <AlertCircle className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Access Restricted</h2>
          <p className="text-sm text-slate-500 leading-relaxed">
            Performance Coach Ingestion is restricted to <strong>Admin</strong> and <strong>Developer</strong> roles. Please contact your workspace administrator if you require access.
          </p>
          <div className="pt-2">
            <a
              href="/employee/welcome"
              className="inline-flex items-center justify-center px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-medium text-sm rounded-xl transition-colors shadow-sm"
            >
              Return to Dashboard
            </a>
          </div>
        </div>
      </div>
    )
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
    return matchesSearch && matchesStatus
  })

  return (
    <div className="min-h-screen bg-slate-50/60 p-6 md:p-10 font-sans">
      <div className="max-w-6xl mx-auto space-y-8">
        
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            {/* <div className="flex items-center gap-2">
              <span className="px-3 py-1 text-xs font-semibold uppercase tracking-wider text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full">
                AI Knowledge Ingestion
              </span>
              <span className="text-xs text-slate-500">Multi-Tenant Scoped</span>
            </div> */}
            <h1 className="text-2xl md:text-3xl font-bold text-slate-900 mt-2">
              Performance Coach — Document Ingestion Hub
            </h1>
            <p className="text-sm text-slate-600 mt-1 max-w-2xl">
              Upload performance reviews, KPI spreadsheets, sprint trackers, and 360 feedback decks. 
              The pipeline automatically extracts line-by-line citations and stores vector proof chunks.
            </p>
          </div>

          <button
            onClick={() => { setLoading(true); fetchDocuments(); }}
            disabled={loading}
            className="self-start md:self-auto inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin text-indigo-600" : ""}`} />
            Refresh Status
          </button>
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
            <div className="flex items-center gap-2.5 self-start md:self-auto flex-shrink-0">
              {gdriveLoading ? (
                <div className="text-xs text-slate-400 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                  Checking connection...
                </div>
              ) : gdriveStatus?.connected ? (
                <>
                  <a
                    href={gdriveStatus.integration?.folder_id ? `https://drive.google.com/drive/folders/${gdriveStatus.integration.folder_id}` : "https://drive.google.com"}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:text-indigo-600 hover:border-indigo-200 transition shadow-sm"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                    Open Folder in Drive
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
              </div>
              <div>
                <span className="text-slate-400 font-medium block">Monitored Folder</span>
                <a
                  href={gdriveStatus.integration.folder_id ? `https://drive.google.com/drive/folders/${gdriveStatus.integration.folder_id}` : "https://drive.google.com"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-indigo-600 hover:text-indigo-800 hover:underline font-semibold inline-flex items-center gap-1 mt-0.5 group"
                  title="Open folder in Google Drive"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  <span>{gdriveStatus.integration.folder_name}</span>
                  <ExternalLink className="w-3 h-3 opacity-60 group-hover:opacity-100" />
                </a>
              </div>
              <div>
                <span className="text-slate-400 font-medium block">Auto-Ingested Files</span>
                <span className="text-slate-800 font-semibold block mt-0.5">
                  {gdriveStatus.integration.total_synced_files} file(s) processed
                </span>
              </div>
              <div>
                <span className="text-slate-400 font-medium block">Last Synced</span>
                <span className="text-slate-700 block mt-0.5">
                  {formatGDriveSyncDate(gdriveStatus.integration.last_synced_at)}
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
                  Target Scope 
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
                  Document Description
                </label>
                <input
                  type="text"
                  placeholder="e.g. Q3 2024 Engineering performance appraisals and OKRs"
                  value={manualDescription}
                  onChange={(e) => setManualDescription(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-sm"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Give a good detailed description of the document for agent understanding.
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
                              <div className="font-semibold text-slate-900 flex items-center gap-2 flex-wrap">
                                {doc.file_name}
                                <span className="uppercase text-[10px] font-bold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                                  {doc.file_type}
                                </span>
                                {meta.category && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded bg-violet-50 text-violet-700 border border-violet-200">
                                    <Sparkles className="w-2.5 h-2.5 text-violet-500" />
                                    {meta.category}
                                  </span>
                                )}
                                {doc.document_period && (
                                  <span className="inline-flex items-center text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                                    {doc.document_period}
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
                              {(doc.manual_description || doc.description) && (
                                <div className="text-xs text-slate-600 mt-1 max-w-md line-clamp-2">
                                  {doc.description ? (
                                    <span className="flex items-start gap-1">
                                      <span className="shrink-0 text-[9px] font-bold tracking-wider text-violet-600 uppercase bg-violet-50 px-1 py-0.5 rounded border border-violet-100">AI</span>
                                      <span>{doc.description}</span>
                                    </span>
                                  ) : (
                                    <span className="italic">{doc.manual_description}</span>
                                  )}
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

              {/* Description, Summary & Category Section */}
              {(inspectDoc.manual_description || inspectDoc.description || inspectDoc.parsed_metadata?.category) && (
                <div className="p-4 rounded-xl bg-indigo-50/70 border border-indigo-100 text-xs space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-indigo-900 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4 text-indigo-600" />
                      Document Summary & Classification
                    </div>
                    {inspectDoc.parsed_metadata?.category && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-violet-100 text-violet-800 border border-violet-200">
                        {inspectDoc.parsed_metadata.category}
                      </span>
                    )}
                  </div>
                  {inspectDoc.description && (
                    <p className="text-slate-700 leading-relaxed text-xs">
                      {inspectDoc.description}
                    </p>
                  )}
                  {inspectDoc.manual_description && (
                    <p className="text-slate-500 italic text-[11px] border-t border-indigo-100 pt-1">
                      Notes: {inspectDoc.manual_description}
                    </p>
                  )}
                  {inspectDoc.parsed_metadata?.key_topics && inspectDoc.parsed_metadata.key_topics.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1.5 border-t border-indigo-100">
                      {inspectDoc.parsed_metadata.key_topics.map((topic: string, i: number) => (
                        <span key={i} className="px-2 py-0.5 bg-white/80 border border-indigo-200/60 rounded text-[10px] font-medium text-indigo-700">
                          #{topic}
                        </span>
                      ))}
                    </div>
                  )}
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

      </div>
    </div>
  )
}
