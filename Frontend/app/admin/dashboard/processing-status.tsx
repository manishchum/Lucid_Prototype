"use client"

import { useState, useEffect } from "react"
import { Badge } from "@/components/ui/badge"
import { Brain, Clock, CheckCircle, XCircle } from "lucide-react"
import { AIService, ProcessingStatus } from "@/lib/ai-service"

interface ProcessingStatusProps {
  moduleId: string
  initialStatus: string
  onStatusChange?: (status: ProcessingStatus) => void
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

export function ProcessingStatusComponent({ moduleId, initialStatus, onStatusChange }: ProcessingStatusProps) {
  const [status, setStatus] = useState<string>(initialStatus)

  useEffect(() => {
    if (status === 'completed' || status === 'failed') {
      return // No need to poll if processing is done
    }

    const pollStatus = async () => {
      try {
        const currentStatus = await AIService.getProcessingStatus(moduleId)
        if (currentStatus && currentStatus.status !== status) {
          setStatus(currentStatus.status)
          onStatusChange?.(currentStatus)
        }
      } catch (error) {
        // console.error('Failed to get processing status:', error)
        // Don't stop polling on error, just log it
      }
    }

    // Poll every 5 seconds (reduced frequency to avoid overwhelming)
    const interval = setInterval(pollStatus, 5000)

    return () => clearInterval(interval)
  }, [moduleId, status, onStatusChange])

  return getProcessingStatusBadge(status)
}

interface ContentGenerationProgressProps {
  moduleId: string
}

export function ContentGenerationProgress({ moduleId }: ContentGenerationProgressProps) {
  const [progress, setProgress] = useState(0)
  const [completed, setCompleted] = useState(0)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let interval: NodeJS.Timeout
    const fetchProgress = async () => {
      try {
        const res = await fetch(`/api/content-generation-progress?module_id=${moduleId}`)
        const data = await res.json()
        setProgress(data.percent || 0)
        setCompleted(data.completed || 0)
        setTotal(data.total || 0)
        setLoading(false)
        if (data.percent >= 100 && interval) {
          clearInterval(interval)
        }
      } catch (err) {
        setLoading(false)
      }
    }
    fetchProgress()
    interval = setInterval(fetchProgress, 5000) // poll every 5 seconds
    return () => clearInterval(interval)
  }, [moduleId])

  return (
    <div style={{ margin: "1rem 0" }}>
      <h3>Content Generation Progress</h3>
      {loading ? (
        <p>Loading progress...</p>
      ) : (
        <>
          <progress value={progress} max={100} style={{ width: "100%" }} />
          <p>{progress}% ({completed} of {total} modules completed)</p>
        </>
      )}
    </div>
  )
}