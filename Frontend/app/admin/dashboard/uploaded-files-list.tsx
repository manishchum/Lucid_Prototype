"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { FileText, Video, Music, File, Trash2, ExternalLink, Brain, Clock, CheckCircle, XCircle } from "lucide-react"
import { supabase } from "@/lib/supabase"
import { toast } from "react-hot-toast"
import { AIAnalysisView } from "./ai-analysis-view"
import { ProcessingStatusComponent } from "./processing-status"

interface TrainingModule {
  module_id: string
  title: string
  description: string | null
  content_type: string
  content_url: string
  created_at: string
  gpt_summary: string | null
  transcription: string | null
  ai_modules: string | null
  ai_topics: string | null
  ai_objectives: string | null
  processing_status: string
}

interface UploadedFilesListProps {
  modules: TrainingModule[]
  onModuleDeleted: () => void
}

const getFileIcon = (fileType: string) => {
  if (fileType.includes("pdf")) return <FileText className="w-5 h-5 text-red-500" />
  if (fileType.includes("word") || fileType.includes("document")) return <FileText className="w-5 h-5 text-blue-500" />
  if (fileType.includes("video")) return <Video className="w-5 h-5 text-purple-500" />
  if (fileType.includes("audio")) return <Music className="w-5 h-5 text-green-500" />
  return <File className="w-5 h-5 text-gray-500" />
}

const getProcessingStatusBadge = (status: string) => {
  switch (status) {
    case 'pending':
      return <Badge variant="secondary" className="flex items-center gap-1"><Clock className="w-3 h-3" />Pending</Badge>
    case 'transcribing':
      return <Badge variant="secondary" className="flex items-center gap-1"><Brain className="w-3 h-3" />Transcribing</Badge>
    case 'summarizing':
      return <Badge variant="secondary" className="flex items-center gap-1"><Brain className="w-3 h-3" />Analyzing</Badge>
    case 'completed':
      return <Badge variant="default" className="flex items-center gap-1"><CheckCircle className="w-3 h-3" />Complete</Badge>
    case 'failed':
      return <Badge variant="destructive" className="flex items-center gap-1"><XCircle className="w-3 h-3" />Failed</Badge>
    default:
      return <Badge variant="outline">Unknown</Badge>
  }
}

export function UploadedFilesList({ modules, onModuleDeleted }: UploadedFilesListProps) {
  const handleDelete = async (moduleId: string, contentUrl: string) => {
    if (!confirm("Are you sure you want to delete this module? This action cannot be undone.")) {
      return
    }

    try {
      // Extract file path from public URL
      const urlParts = contentUrl.split("training-content/")
      const filePath = urlParts.length > 1 ? `training-content/${urlParts[1]}` : null

      if (!filePath) {
        throw new Error("Could not determine file path from URL.")
      }

      // Delete from Supabase Storage
      const { error: storageError } = await supabase.storage.from("training-content").remove([filePath])
      if (storageError) {
        // Log error but don't block DB deletion if storage delete fails
        console.error("Failed to delete file from storage:", storageError.message)
      }

      // Delete from training_modules table
      const { error: dbError } = await supabase.from("training_modules").delete().eq("id", moduleId)
      if (dbError) throw dbError

      toast.success("Module deleted successfully!")
      onModuleDeleted() // Notify parent to refresh list
    } catch (error: any) {
      toast.error(`Failed to delete module: ${error.message}`)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Uploaded Training Modules ({modules.length})</CardTitle>
        <CardDescription>Manage your company's training content.</CardDescription>
      </CardHeader>
      <CardContent>
        {modules.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <File className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>No training modules uploaded yet.</p>
            <p className="text-sm">Use the section above to upload your first module.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {modules.map((module) => (
              <div key={module.module_id} className="flex items-start justify-between p-4 border rounded-lg bg-gray-50">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  {getFileIcon(module.content_type)}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                    <p className="font-medium text-gray-900 truncate">{module.title}</p>
                      <ProcessingStatusComponent 
                        moduleId={module.module_id} 
                        initialStatus={module.processing_status}
                        onStatusChange={(status) => {
                          // Refresh the list when status changes
                          if (status.status === 'completed' || status.status === 'failed') {
                            onModuleDeleted()
                          }
                        }}
                      />
                    </div>
                    {module.description && <p className="text-sm text-gray-600 truncate mb-1">{module.description}</p>}
                    <p className="text-xs text-gray-500">
                      Uploaded: {new Date(module.created_at).toLocaleDateString()}
                    </p>
                    
                    {/* AI Analysis Results */}
                    {module.processing_status === 'completed' && (
                      <div className="mt-3 space-y-2">
                        {module.gpt_summary && (
                          <div className="text-xs">
                            <span className="font-medium text-gray-700">Summary:</span>
                            <p className="text-gray-600 line-clamp-2">{module.gpt_summary}</p>
                          </div>
                        )}
                        {module.ai_modules && (
                          <div className="text-xs">
                            <span className="font-medium text-gray-700">Modules:</span>
                            <p className="text-gray-600">{JSON.parse(module.ai_modules).slice(0, 3).join(', ')}...</p>
                          </div>
                        )}
                        {module.ai_topics && (
                          <div className="text-xs">
                            <span className="font-medium text-gray-700">Topics:</span>
                            <p className="text-gray-600">{JSON.parse(module.ai_topics).slice(0, 5).join(', ')}...</p>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  {module.processing_status === 'completed' && (
                    <AIAnalysisView module={module} />
                  )}
                  <Button asChild variant="outline" size="icon" className="h-8 w-8 bg-transparent">
                    <a href={module.content_url} target="_blank" rel="noopener noreferrer" title="Preview File">
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </Button>
                  <Button
                    onClick={() => handleDelete(module.module_id, module.content_url)}
                    variant="outline"
                    size="icon"
                    className="h-8 w-8 text-red-600 hover:text-red-800"
                    title="Delete Module"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
