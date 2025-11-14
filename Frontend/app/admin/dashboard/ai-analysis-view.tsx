"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Brain, FileText, Target, BookOpen, Clock, CheckCircle, XCircle } from "lucide-react"

interface Module {
  title: string
  topics: string[]
  objectives: string[]
}

interface TrainingModule {
  module_id: string
  title: string
  description: string | null
  content_type: string
  content_url: string
  created_at: string
  gpt_summary: string | null
  transcription: string | null
  ai_modules: string | null // JSON stringified array of Module
  ai_topics: string | null // (deprecated)
  ai_objectives: string | null // (deprecated)
  processing_status: string
}

interface AIAnalysisViewProps {
  module: TrainingModule
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

export function AIAnalysisView({ module }: AIAnalysisViewProps) {
  const [isOpen, setIsOpen] = useState(false)

  // Parse modules as array of objects, with debug output
  let modules: Module[] = [];
  let modulesParseError: string | null = null;
  let rawModules: any = null;
  try {
    if (module.ai_modules) {
      rawModules = module.ai_modules;
      const parsed = typeof rawModules === 'string' ? JSON.parse(rawModules) : rawModules;
      if (Array.isArray(parsed) && parsed[0]?.title) {
        modules = parsed;
      } else {
        modulesParseError = 'Parsed ai_modules is not an array of objects with title.';
      }
    } else {
      modulesParseError = 'ai_modules is empty or null.';
    }
  } catch (e: any) {
    modulesParseError = 'Failed to parse ai_modules: ' + (e?.message || e);
    modules = [];
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="flex items-center gap-2">
          <Brain className="w-4 h-4" />
          View AI Analysis
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Brain className="w-5 h-5" />
            AI Analysis: {module.title}
          </DialogTitle>
          <DialogDescription>
            Detailed analysis of the training content including transcription, summary, modules, topics, and learning objectives.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Processing Status */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Processing Status</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                {getProcessingStatusBadge(module.processing_status)}
                <span className="text-sm text-gray-600">
                  {module.processing_status === 'completed' && 'AI analysis completed successfully'}
                  {module.processing_status === 'failed' && 'AI analysis failed'}
                  {module.processing_status === 'pending' && 'Waiting to start AI processing'}
                  {module.processing_status === 'transcribing' && 'Converting audio/video to text'}
                  {module.processing_status === 'summarizing' && 'Analyzing content and generating insights'}
                </span>
              </div>
            </CardContent>
          </Card>

          {module.processing_status === 'completed' && (
            <>
              {/* Transcription */}
              {module.transcription && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="w-5 h-5" />
                      Transcription
                    </CardTitle>
                    <CardDescription>
                      Full text transcription of the audio/video content
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-gray-50 p-4 rounded-lg max-h-40 overflow-y-auto">
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{module.transcription}</p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Summary */}
              {module.gpt_summary ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Brain className="w-5 h-5" />
                      Content Summary
                    </CardTitle>
                    <CardDescription>
                      AI-generated summary of the training content
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-gray-700 leading-relaxed">{module.gpt_summary}</p>
                  </CardContent>
                </Card>
              ) : module.transcription ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="w-5 h-5" />
                      Extracted Content
                    </CardTitle>
                    <CardDescription>
                      This is the raw extracted text from your uploaded file. No AI summary was generated.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-gray-50 p-4 rounded-lg max-h-60 overflow-y-auto">
                      <pre className="text-xs text-gray-700 whitespace-pre-wrap">{module.transcription}</pre>
                    </div>
                  </CardContent>
                </Card>
              ) : null}

              {/* Structured Analysis */}
              <Card>
                <CardHeader>
                  <CardTitle>Structured Analysis</CardTitle>
                  <CardDescription>
                    AI-generated learning structure with modules, topics, and objectives
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Tabs defaultValue="modules" className="w-full">
                    <TabsList className="grid w-full grid-cols-3">
                      <TabsTrigger value="modules" className="flex items-center gap-2">
                        <BookOpen className="w-4 h-4" />
                        Modules
                      </TabsTrigger>
                      <TabsTrigger value="topics" className="flex items-center gap-2">
                        <FileText className="w-4 h-4" />
                        Topics
                      </TabsTrigger>
                      <TabsTrigger value="objectives" className="flex items-center gap-2">
                        <Target className="w-4 h-4" />
                        Objectives
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="modules" className="mt-4">
                      <div className="space-y-3">
                        {modules.length === 0 && (
                          <div className="text-gray-500">
                            No modules found.<br />
                            {modulesParseError && (
                              <span className="text-xs text-red-500">{modulesParseError}</span>
                            )}
                            {rawModules && (
                              <details className="mt-2">
                                <summary className="cursor-pointer text-xs text-gray-400">Show raw ai_modules</summary>
                                <pre className="text-xs text-gray-400 bg-gray-100 p-2 rounded max-h-40 overflow-y-auto">{typeof rawModules === 'string' ? rawModules : JSON.stringify(rawModules, null, 2)}</pre>
                              </details>
                            )}
                          </div>
                        )}
                        {modules.map((mod, index) => (
                          <div key={index} className="flex flex-col gap-1 p-3 bg-gray-50 rounded-lg">
                            <div className="font-medium text-gray-900">{mod.title}</div>
                            {mod.topics && mod.topics.length > 0 && (
                              <div className="text-xs text-gray-700">Topics: {mod.topics.join(", ")}</div>
                            )}
                            {mod.objectives && mod.objectives.length > 0 && (
                              <div className="text-xs text-gray-700">Objectives: {mod.objectives.join(", ")}</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </TabsContent>

                    <TabsContent value="topics" className="mt-4">
                      <div className="space-y-3">
                        {modules.length === 0 && <div className="text-gray-500">No topics found.</div>}
                        {modules.flatMap((mod) => mod.topics || []).map((topic, idx) => (
                          <div key={idx} className="p-3 bg-blue-50 rounded-lg border border-blue-200 text-sm font-medium text-blue-800">
                            {topic}
                          </div>
                        ))}
                      </div>
                    </TabsContent>

                    <TabsContent value="objectives" className="mt-4">
                      <div className="space-y-3">
                        {modules.length === 0 && <div className="text-gray-500">No objectives found.</div>}
                        {modules.flatMap((mod) => mod.objectives || []).map((objective, idx) => (
                          <div key={idx} className="flex items-start gap-3 p-3 bg-green-50 rounded-lg border border-green-200">
                            <div className="w-6 h-6 bg-green-500 text-white rounded-full flex items-center justify-center text-xs font-bold mt-0.5">
                              {idx + 1}
                            </div>
                            <p className="text-sm text-green-800">{objective}</p>
                          </div>
                        ))}
                      </div>
                    </TabsContent>
                  </Tabs>
                </CardContent>
              </Card>
            </>
          )}

          {module.processing_status === 'failed' && (
            <Card>
              <CardHeader>
                <CardTitle className="text-red-600">Processing Failed</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600">
                  The AI processing failed for this module. The content was uploaded successfully, but the analysis could not be completed.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}