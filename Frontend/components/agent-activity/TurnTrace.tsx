"use client"

import * as React from "react"
import {
  Brain,
  ChevronDown,
  Database,
  FileText,
  Lightbulb,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Search,
  Sparkles,
  Layers,
  Check,
} from "lucide-react"
import {
  Trace,
  TraceLine,
  TraceIcon,
  TraceTitle,
  TraceDescription,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
} from "@/components/ui/trace"
import { cn } from "@/lib/utils"

export interface TurnTraceStep {
  id: string
  stage: string
  title: string
  message: string
  status: "running" | "completed" | "failed" | "retrying" | "pending"
  duration_ms?: number
  evidence?: Record<string, any>
  planned_actions?: string[]
  timestamp?: number
}

interface TurnTraceProps {
  steps: TurnTraceStep[]
  isGenerating?: boolean
  durationSeconds?: number
  defaultExpanded?: boolean
  className?: string
}

function getStageIcon(stage: string, status: string) {
  if (status === "running") {
    return (
      <span className="relative flex h-2 w-2 mr-0.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
      </span>
    )
  }
  if (status === "retrying") {
    return <RefreshCw className="w-3.5 h-3.5 text-amber-500 animate-spin" />
  }
  if (status === "failed") {
    return <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
  }

  const s = stage.toLowerCase()
  if (s.includes("sql") || s.includes("database")) {
    return <Database className="w-3.5 h-3.5 text-indigo-500" />
  }
  if (s.includes("rag") || s.includes("document") || s.includes("file")) {
    return <FileText className="w-3.5 h-3.5 text-emerald-500" />
  }
  if (s.includes("crm") || s.includes("pipeline")) {
    return <Layers className="w-3.5 h-3.5 text-violet-500" />
  }
  if (s.includes("plan") || s.includes("cognition")) {
    return <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
  }
  if (s.includes("synthesiz")) {
    return <Sparkles className="w-3.5 h-3.5 text-cyan-500" />
  }

  return <CheckCircle2 className="w-3.5 h-3.5 text-slate-400" />
}

export function TurnTrace({
  steps,
  isGenerating = false,
  durationSeconds,
  defaultExpanded = true,
  className,
}: TurnTraceProps) {
  const [isOpen, setIsOpen] = React.useState<boolean>(defaultExpanded)

  // Keep open while generating, close automatically when generation completes if needed
  React.useEffect(() => {
    if (isGenerating) {
      setIsOpen(true)
    }
  }, [isGenerating])

  if (!steps || steps.length === 0) {
    if (!isGenerating) return null
  }

  const durationLabel = durationSeconds
    ? `${durationSeconds.toFixed(1)}s`
    : undefined

  // Find active step for header display
  const activeStep = steps.find((s) => s.status === "running" || s.status === "retrying")
  const headerTitle = isGenerating
    ? activeStep?.title || "Thinking..."
    : "Thought"

  return (
    <div className={cn("w-full mb-3 select-none", className)}>
      <TraceCollapsible open={isOpen} onOpenChange={setIsOpen}>
        {/* Main Turn Trigger Line */}
        <TraceCollapsibleTrigger asChild>
          <TraceLine status={isGenerating ? "running" : "success"}>
            <TraceIcon>
              {isGenerating ? (
                <span className="relative flex h-2 w-2 mr-0.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
                </span>
              ) : (
                <Brain className="w-3.5 h-3.5 text-slate-400 group-hover/trace-line:text-slate-600 transition" />
              )}
            </TraceIcon>

            <TraceTitle className="font-serif italic">
              {headerTitle}
            </TraceTitle>

            {durationLabel && (
              <TraceDescription>{durationLabel}</TraceDescription>
            )}

            <ChevronDown
              className={cn(
                "w-3.5 h-3.5 text-slate-400 group-hover/trace-line:text-slate-600 transition-transform duration-200 ml-1.5",
                isOpen && "rotate-180"
              )}
            />
          </TraceLine>
        </TraceCollapsibleTrigger>

        {/* Expandable Turn Content */}
        <TraceCollapsibleContent>
          <div className="border-l-2 border-slate-200/90 pl-3.5 py-1.5 my-1.5 space-y-3 text-xs sm:text-[13px] text-slate-600 leading-relaxed select-text">
            {steps.map((step) => {
              const evidence = step.evidence || {}
              const files = evidence.files || []
              const hasEvidence = Object.keys(evidence).length > 0 || (step.planned_actions && step.planned_actions.length > 0)

              return (
                <div key={step.id} className="space-y-1.5">
                  <div className="flex items-center gap-1.5 font-medium text-slate-700">
                    <TraceIcon className="shrink-0">
                      {getStageIcon(step.stage, step.status)}
                    </TraceIcon>
                    <span className="font-semibold text-slate-800 text-xs sm:text-[13px]">
                      {step.title}
                    </span>
                    {step.duration_ms && (
                      <span className="text-[10px] text-slate-400 font-mono ml-auto">
                        {(step.duration_ms / 1000).toFixed(2)}s
                      </span>
                    )}
                  </div>

                  {/* Natural Language Explanation Message */}
                  {step.message && (
                    <p className="text-slate-600 text-xs sm:text-[12.5px] pl-5 leading-normal">
                      {step.message}
                    </p>
                  )}

                  {/* Planned Actions Checklist (if present) */}
                  {step.planned_actions && step.planned_actions.length > 0 && (
                    <div className="pl-5 pt-1 space-y-1">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">
                        Planned Actions
                      </span>
                      <ul className="space-y-1 pl-0 list-none">
                        {step.planned_actions.map((action, aIdx) => (
                          <li key={aIdx} className="flex items-start gap-1.5 text-slate-600 text-xs">
                            <Check className="w-3 h-3 text-indigo-500 mt-0.5 shrink-0" />
                            <span>{action}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Evidence & Findings Tags (Row counts, Files) */}
                  {hasEvidence && (evidence.rowCount !== undefined || evidence.row_count !== undefined || files.length > 0) && (
                    <div className="pl-5 pt-0.5 flex flex-wrap items-center gap-1.5">
                      {(evidence.rowCount !== undefined || evidence.row_count !== undefined) && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                          <Database className="w-3 h-3 text-indigo-500" />
                          <span className="font-medium">{evidence.rowCount ?? evidence.row_count} records</span>
                        </span>
                      )}

                      {files.length > 0 && files.map((f: any, fIdx: number) => (
                        <span
                          key={fIdx}
                          className="inline-flex items-center gap-1 text-[11px] text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200"
                        >
                          <FileText className="w-3 h-3 text-emerald-500" />
                          <span className="font-medium truncate max-w-[160px]">{f.filename || f.file_name}</span>
                          {f.page && <span className="text-slate-400 text-[10px]">p.{f.page}</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </div>
  )
}
