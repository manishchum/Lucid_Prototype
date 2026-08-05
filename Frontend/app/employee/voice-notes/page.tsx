"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import VoiceInput from "@/components/VoiceInput";
import { useAuth } from "@/contexts/auth-context";
import { fetchWithAuth } from "@/lib/fetch-with-auth";
import { CheckCircle2, Edit, RefreshCcw, Trash2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

interface Transcript {
  transcript_id: string;
  title: string;
  raw_transcript: string;
  edited_transcript?: string;
  transcript_date: string;
  created_at: string;
  updated_at: string;
}

function formatTime(timestamp: string) {
  try {
    return new Date(timestamp).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return timestamp;
  }
}

function renderRenderableContent(renderableContent: any) {
  if (!renderableContent) {
    return <p className="text-sm text-slate-500">No rendered report content available.</p>;
  }

  if (renderableContent.type === "xlsx") {
    return (
      <div className="space-y-4">
        {renderableContent.sheets?.map((sheet: any, idx: number) => (
          <div key={`${sheet.name || idx}-${idx}`} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold text-slate-900">{sheet.name || `Sheet ${idx + 1}`}</div>
            {sheet.columns?.length ? (
              <div className="mt-2 text-xs uppercase tracking-[0.2em] text-slate-500">{sheet.columns.join(" · ")}</div>
            ) : null}
            <div className="mt-3 space-y-2 text-sm text-slate-700">
              {sheet.rows?.map((row: any[], rowIndex: number) => (
                <div key={rowIndex} className="rounded-2xl bg-slate-50 p-3">
                  {row.join(" | ")}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {renderableContent.title ? (
        <div className="text-sm font-semibold text-slate-900">{renderableContent.title}</div>
      ) : null}
      {renderableContent.sections?.map((section: any, idx: number) => (
        <div key={idx} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">{section.heading || `Section ${idx + 1}`}</div>
          {section.body ? (
            <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">{section.body}</p>
          ) : null}
          {section.bullets?.length ? (
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
              {section.bullets.map((bullet: string, bulletIndex: number) => (
                <li key={bulletIndex}>{bullet}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
      {renderableContent.tables?.map((table: any, idx: number) => (
        <div key={idx} className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">{table.name || `Table ${idx + 1}`}</div>
          <div className="mt-2 text-sm text-slate-700">
            {table.columns?.join(" · ")}
          </div>
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            {table.rows?.map((row: any[], rowIndex: number) => (
              <div key={rowIndex} className="rounded-2xl bg-slate-50 p-3">{row.join(" | ")}</div>
            ))}
          </div>
        </div>
      ))}
      {renderableContent.action_items?.length ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Action Items</div>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
            {renderableContent.action_items.map((item: any, idx: number) => (
                <li key={idx} className="rounded-xl bg-slate-50 p-3">
                    <div className="font-medium">{item.task}</div>

                    <div className="mt-1 text-xs text-slate-500 space-x-4">
                    <span>Status: {item.status ?? "-"}</span>

                    {item.owner && <span>Owner: {item.owner}</span>}

                    {item.due_date && <span>Due: {item.due_date}</span>}
                    </div>
                </li>
                ))}
          </ul>
        </div>
      ) : null}
      {renderableContent.risks?.length ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Risks</div>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
            {renderableContent.risks.map((item: any, idx: number) => (
                <li key={idx} className="rounded-xl bg-slate-50 p-3">
                    <div className="font-medium">{item.risk}</div>

                    {item.mitigation && (
                    <div className="mt-1 text-sm text-slate-600">
                        Mitigation: {item.mitigation}
                    </div>
                    )}

                    {item.owner && (
                    <div className="mt-1 text-xs text-slate-500">
                        Owner: {item.owner}
                    </div>
                    )}
                </li>
                ))}
          </ul>
        </div>
      ) : null}
      {renderableContent.follow_ups?.length ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Follow Ups</div>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-slate-700">
            {renderableContent.follow_ups.map((item: any, idx: number) => (
              <li key={idx}>{item}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export default function VoiceNotesPage() {
  const router = useRouter();
  const { user, loading: authLoading, isManagerofUsers } = useAuth();
  const { toast } = useToast();
  
  // Debug logging
  useEffect(() => {
    console.log('[voice-notes] Auth state:', { user: user?.email, authLoading, isManagerofUsers });
  }, [user, authLoading, isManagerofUsers]);
  const [liveTranscript, setLiveTranscript] = useState("");
  const [title, setTitle] = useState("");
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [activeTab, setActiveTab] = useState<'notes' | 'reports' | 'manager'>('notes');
  const [reports, setReports] = useState<any[]>([]);
  const [teamReports, setTeamReports] = useState<any[]>([]);
  const [teamInsights, setTeamInsights] = useState<any | null>(null);
  const [managerSummary, setManagerSummary] = useState<any | null>(null);
  const [selectedReport, setSelectedReport] = useState<any | null>(null);
  const [editReportTitle, setEditReportTitle] = useState("");
  const [editReportSummary, setEditReportSummary] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generatingTeamReport, setGeneratingTeamReport] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editTranscript, setEditTranscript] = useState("");
  const [reportSummary, setReportSummary] = useState<string | null>(null);

  const today = useMemo(() => new Date().toISOString().split("T")[0], []);
  const [teamReportDate, setTeamReportDate] = useState<string>(today);
  const [displayedReportDate, setDisplayedReportDate] = useState<string>(today);
  const [loadingTeamReports, setLoadingTeamReports] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [authLoading, user, router]);

  useEffect(() => {
    if (user) {
      fetchTranscripts();
      fetchReports();
    }
  }, [user]);

  useEffect(() => {
    if (user && isManagerofUsers) {
      fetchTeamReports();
    }
  }, [user, isManagerofUsers, teamReportDate]);

  const fetchTranscripts = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/voice-transcripts?transcript_date=${today}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data?.detail || "Unable to load transcripts.");
        setTranscripts([]);
      } else {
        setTranscripts(data.transcripts || []);
      }
    } catch (err) {
      setError("Unable to fetch transcripts.");
    } finally {
      setLoading(false);
    }
  };

  const handleAddTranscript = async () => {
    setError(null);
    setMessage(null);
    if (!title.trim()) {
      setError("Please add a title before saving your voice note.");
      return;
    }
    if (!liveTranscript.trim()) {
      setError("No live transcript available to save.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/voice-transcripts`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: title.trim(),
          raw_transcript: liveTranscript.trim(),
          transcript_date: today,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.detail || "Unable to save transcript.");
      } else {
        // setMessage("Transcript saved successfully.");
        toast({
          title: "Transcript saved",
          description: "Your voice note has been saved successfully.",
        });
        setTitle("");
        setLiveTranscript("");
        fetchTranscripts();
      }
    } catch (err) {
      setError("Unable to save transcript.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async (transcriptId: string) => {
    setError(null);
    setMessage(null);
    if (!editTitle.trim() || !editTranscript.trim()) {
      setError("Title and transcript text are required to save edits.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/voice-transcripts/${transcriptId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: editTitle.trim(),
          edited_transcript: editTranscript.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.detail || "Unable to update transcript.");
      } else {
        // setMessage("Transcript updated.");
        toast({
          title: "Transcript updated",
          description: `Transcript - ${editTitle.trim()} is updated successfully.`,
        });
        setEditingId(null);
        setEditTitle("");
        setEditTranscript("");
        fetchTranscripts();
      }
    } catch (err) {
      setError("Unable to update transcript.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (transcriptId: string) => {
    setError(null);
    setMessage(null);
    setSaving(true);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/voice-transcripts/${transcriptId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.detail || "Unable to delete transcript.");
      } else {
        // setMessage("Transcript deleted.");
        toast({
          title: "Transcript deleted",
          description: "The voice note has been removed.",
        });
        if (editingId === transcriptId) {
          setEditingId(null);
        }
        fetchTranscripts();
      }
    } catch (err) {
      setError("Unable to delete transcript.");
    } finally {
      setSaving(false);
    }
  };

  const handleGenerateReport = async () => {
    setError(null);
    setMessage(null);
    setGenerating(true);
    setReportSummary(null);
    toast({
      title: "Generating report",
      description: "Daily report is getting generated...",
    });
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/voice-transcripts/daily-reports/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          report_date: today,
          report_title: `Daily Report ${today}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.detail || "Unable to generate daily report.");
      } else {
        // setMessage("Daily report generated successfully.");
        toast({
          title: "Report generated",
          description: "Daily report is generated successfully.",
        });
        setReportSummary(data.report?.summary_text || "Report generated.");
        fetchTranscripts();
        fetchReports();
      }
    } catch (err) {
      setError("Unable to generate daily report.");
    } finally {
      setGenerating(false);
    }
  };

  const fetchReports = async () => {
    setError(null);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/voice-transcripts/daily-reports?report_date=${today}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data?.detail || "Unable to load reports.");
        setReports([]);
      } else {
        setReports(data.reports || []);
      }
    } catch (err) {
      setError("Unable to fetch reports.");
    }
  };

  const fetchTeamReports = async () => {
    if (!isManagerofUsers) return;
    setError(null);
    setLoadingTeamReports(true);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/voice-transcripts/manager/team-reports?report_date=${teamReportDate}`);
      const data = await res.json();
      setDisplayedReportDate(teamReportDate);
      if (!res.ok) {
        setError(data?.detail || "Unable to load team reports.");
        setTeamReports([]);
        setTeamInsights(null);
        setManagerSummary(null);
      } else {
        setTeamReports(data.reports || []);
        setTeamInsights(data.insights || null);
        setManagerSummary(data.manager_summary || null);
      }
    } catch (err) {
      setError("Unable to fetch team reports.");
    } finally {
      setLoadingTeamReports(false);
    }
  };

  const handleGenerateTeamReport = async () => {
    setError(null);
    setMessage(null);
    setGeneratingTeamReport(true);
    toast({
      title: "Generating team report",
      description: "Aggregating team reports and sending email...",
    });
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/voice-transcripts/manager/team-reports/generate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          report_date: teamReportDate,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.detail || "Unable to generate team report.");
      } else {
        toast({
          title: "Team report generated",
          description: "Team report is generated and emailed successfully.",
        });
        fetchTeamReports();
      }
    } catch (err) {
      setError("Unable to generate team report.");
    } finally {
      setGeneratingTeamReport(false);
    }
  };

  const openReport = (report: any) => {
    setSelectedReport(report);
    setEditReportTitle(report.report_title || "");
    setEditReportSummary(report.summary_text || "");
  };

  const closeReportEditor = () => {
    setSelectedReport(null);
    setEditReportTitle("");
    setEditReportSummary("");
  };

  const saveReportEdits = async () => {
    if (!selectedReport) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/voice-transcripts/daily-reports/${selectedReport.report_id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report_title: editReportTitle, summary_text: editReportSummary }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.detail || 'Unable to save report edits.');
      } else {
        // setMessage('Report saved.');
        toast({
          title: "Report updated",
          description: "Your report edits have been saved.",
        });
        fetchReports();
        closeReportEditor();
      }
    } catch (err) {
      setError('Unable to save report edits.');
    } finally {
      setSaving(false);
    }
  };

  const beginEdit = (transcript: Transcript) => {
    setEditingId(transcript.transcript_id);
    setEditTitle(transcript.title);
    setEditTranscript(transcript.edited_transcript || transcript.raw_transcript || "");
    setMessage(null);
    setError(null);
  };

  return (
    <div className="space-y-6 p-4 lg:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-semibold">Voice Notes</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Record multiple voice notes, save live transcripts as titled notes, and generate a daily report from today's entries.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="secondary" onClick={() => {
            fetchTranscripts();
            fetchReports();
            if (isManagerofUsers) fetchTeamReports();
          }} disabled={loading || saving || generating}>
            <RefreshCcw className="h-4 w-4" /> Refresh
          </Button>
          <Button variant="secondary" onClick={handleGenerateReport} disabled={generating || loading || saving}>
            {generating ? "Generating Daily Report..." : "Generate Daily Report"}
          </Button>
        </div>
      </div>

      {(error || message) && (
        <div className={`rounded-lg border p-4 ${error ? "border-destructive bg-destructive/10 text-destructive" : "border-emerald-400 bg-emerald-50 text-emerald-900"}`}>
          {error || message}
        </div>
      )}

      {reportSummary ? (
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <CheckCircle2 className="h-4 w-4" /> Today's report summary
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{reportSummary}</p>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Record Voice Note</h2>
              <p className="text-sm text-slate-500">Tap speak, review live transcript, add a title, then save it.</p>
            </div>
            <span className="rounded-full bg-slate-100 px-5 py-1 text-[10px] font-medium uppercase tracking-[0.2em] text-slate-600 whitespace-nowrap">
              {today}
              {/* {today.split('-').reverse().join('-')} */}
            </span>
          </div>

          <div className="space-y-4">
            <div className="rounded-3xl border border-slate-200 p-4 text-center">
              <VoiceInput onTranscription={setLiveTranscript} />
              <div className="mt-4 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-left text-sm text-slate-600">
                {liveTranscript ? (
                  <pre className="whitespace-pre-wrap text-sm leading-6">{liveTranscript}</pre>
                ) : (
                  <p className="text-slate-400">Live transcript will appear here after you stop recording.</p>
                )}
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-900">Voice Note Title</label>
                <Input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Enter a title for this note"
                />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-900">Transcript</label>
                <Textarea
                  value={liveTranscript}
                  onChange={(event) => setLiveTranscript(event.target.value)}
                  placeholder="Use the Speak button to generate a live transcript here"
                />
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-slate-500">
                Save your note when it is ready. You can edit or delete it later from the timeline.
              </div>
              <Button variant="secondary" onClick={handleAddTranscript} disabled={saving || generating || !liveTranscript.trim()} className="bg-blue-600 hover:bg-blue-700 text-white disabled:bg-gray-400">
                Save Transcript 
              </Button>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-4">
                <button
                  className={`px-3 py-1 rounded-md ${activeTab === 'notes' ? 'bg-blue-600 text-white' : 'bg-transparent text-slate-700'}`}
                  onClick={() => setActiveTab('notes')}
                >
                  Notes
                </button>
                <button
                  className={`px-3 py-1 rounded-md ${activeTab === 'reports' ? 'bg-blue-600 text-white' : 'bg-transparent text-slate-700'}`}
                  onClick={() => setActiveTab('reports')}
                >
                  Reports
                </button>
                {isManagerofUsers && (
                  <button
                    className={`px-3 py-1 rounded-md ${activeTab === 'manager' ? 'bg-blue-600 text-white' : 'bg-transparent text-slate-700'}`}
                    onClick={() => setActiveTab('manager')}
                  >
                    Manager
                  </button>
                )}
              </div>
              <p className="text-sm text-slate-500 mt-2">
                {/* {activeTab === 'notes' ? `Saved voice notes for ${today}.` : activeTab === 'reports' ? `Daily reports for ${today}.` : `Team reports for ${today}.`} */}
              </p>
            </div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium uppercase tracking-[0.2em] text-slate-600">
              {activeTab === 'notes' ? `${transcripts.length} notes` : activeTab === 'reports' ? `${reports.length} reports` : `${teamReports.length} team reports`}
            </span>
          </div>

          <div className="space-y-4">
            {activeTab === 'notes' ? (
              loading ? (
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                  Loading transcripts...
                </div>
              ) : transcripts.length === 0 ? (
                <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                  No saved transcripts for today yet.
                </div>
              ) : (
                transcripts.map((transcript) => {
                  const isEditing = editingId === transcript.transcript_id;
                  return (
                    <div key={transcript.transcript_id} className="rounded-3xl border border-slate-200 p-4 shadow-sm">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 text-sm text-slate-500">
                            <span className="rounded-full bg-slate-100 px-2 py-1">{formatTime(transcript.created_at)}</span>
                            <span>{transcript.transcript_date}</span>
                          </div>
                          {isEditing ? (
                            <Input
                              value={editTitle}
                              onChange={(event) => setEditTitle(event.target.value)}
                              className="text-base font-semibold"
                            />
                          ) : (
                            <h3 className="text-base font-semibold text-slate-900">{transcript.title}</h3>
                          )}
                        </div>

                        <div className="flex items-center gap-2 text-slate-500">
                          {isEditing ? null : (
                            <Button variant="outline" size="sm" onClick={() => beginEdit(transcript)}>
                              <Edit className="h-4 w-4" /> Edit
                            </Button>
                          )}
                          <Button variant="destructive" size="sm" onClick={() => handleDelete(transcript.transcript_id)}>
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      <div className="mt-4 text-sm text-slate-700">
                        {isEditing ? (
                          <Textarea
                            value={editTranscript}
                            onChange={(event) => setEditTranscript(event.target.value)}
                            className="min-h-[160px]"
                          />
                        ) : (
                          <pre className="whitespace-pre-wrap text-sm leading-6 text-slate-600">{transcript.edited_transcript || transcript.raw_transcript}</pre>
                        )}
                      </div>

                      {isEditing ? (
                        <div className="mt-4 flex flex-wrap gap-2">
                          <Button variant="secondary" size="sm" onClick={() => handleSaveEdit(transcript.transcript_id)} disabled={saving}>
                            Save
                          </Button>
                          <Button variant="secondary" size="sm" onClick={() => setEditingId(null)}>
                            Cancel
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  );
                })
              )
            ) : activeTab === 'reports' ? (
              // Reports tab
              <div>
                {selectedReport ? (
                  <div className="rounded-2xl border border-slate-200 p-4 mb-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-semibold">Edit Report</h3>
                      <div className="flex gap-2">
                        <Button variant="secondary" size="sm" onClick={closeReportEditor}>Close</Button>
                        <Button variant="secondary" size="sm" onClick={saveReportEdits} disabled={saving} >Save</Button>
                      </div>
                    </div>
                    <div className="mt-3">
                      <label className="block text-sm font-medium text-slate-700">Title</label>
                      <Input value={editReportTitle} onChange={(e) => setEditReportTitle(e.target.value)} />
                    </div>
                    <div className="mt-3">
                      <label className="block text-sm font-medium text-slate-700">Summary</label>
                      <Textarea value={editReportSummary} onChange={(e) => setEditReportSummary(e.target.value)} className="min-h-[140px]" />
                    </div>
                    <div className="mt-4 border-t border-slate-200 pt-4">
                      <div className="mb-2 text-sm font-semibold text-slate-900">Rendered Report Preview</div>
                      {renderRenderableContent(selectedReport.renderable_content)}
                    </div>
                  </div>
                ) : null}

                {reports.length === 0 ? (
                  <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">No reports for today.</div>
                ) : (
                  reports.map((report) => (
                    <div key={report.report_id} className="rounded-3xl border border-slate-200 p-4 shadow-sm mb-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-sm text-slate-500">{report.report_date}</div>
                          <h4 className="font-semibold text-slate-900">{report.report_title}</h4>
                        </div>
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => openReport(report)}>Open</Button>
                        </div>
                      </div>
                      <div className="mt-3 text-sm text-slate-600 whitespace-pre-wrap">{report.summary_text}</div>
                    </div>
                  ))
                )}
              </div>
            ) : (
              // Manager tab
              <div className="space-y-6">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    <h2 className="text-lg font-semibold text-slate-900">Team Insights & Reports</h2>
                    {loadingTeamReports && <span className="text-sm text-black-600 animate-pulse font-medium">Loading...</span>}
                  </div>
                  <div className="flex items-center space-x-2">
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={handleGenerateTeamReport}
                      disabled={generatingTeamReport || loadingTeamReports}
                    >
                      {generatingTeamReport ? "Generating..." : "Generate Report and send over mail"}
                    </Button>
                    <label htmlFor="team-report-date" className="text-sm text-slate-600 font-medium ml-4">Select Date:</label>
                    <input 
                      type="date" 
                      id="team-report-date"
                      value={teamReportDate} 
                      onChange={(e) => setTeamReportDate(e.target.value)} 
                      max={today}
                      className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div className={`transition-opacity duration-300 ${loadingTeamReports ? 'opacity-50 pointer-events-none' : 'opacity-100'}`}>
                  {teamInsights ? (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 mb-4">
                      <h3 className="text-base font-semibold text-slate-900 mb-3">{displayedReportDate.split('-').reverse().join('-')}</h3>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                      <div className="rounded-lg bg-white p-3 shadow-sm">
                        <div className="text-xs text-slate-500 uppercase tracking-wider">Team Members</div>
                        <div className="mt-1 text-2xl font-bold text-slate-900">{teamInsights.team_members}</div>
                      </div>
                      <div className="rounded-lg bg-white p-3 shadow-sm">
                        <div className="text-xs text-slate-500 uppercase tracking-wider">Reports Submitted</div>
                        <div className="mt-1 text-2xl font-bold text-slate-900">{teamInsights.report_count}</div>
                      </div>
                      <div className="rounded-lg bg-white p-3 shadow-sm">
                        <div className="text-xs text-slate-500 uppercase tracking-wider">Missing Reports</div>
                        <div className="mt-1 text-2xl font-bold text-slate-900">{teamInsights.missing_reports_count || 0}</div>
                      </div>
                      <div className="rounded-lg bg-white p-3 shadow-sm">
                        <div className="text-xs text-slate-500 uppercase tracking-wider">Open Action Items</div>
                        <div className="mt-1 text-2xl font-bold text-slate-900">{teamInsights.open_action_items_count || 0}</div>
                      </div>
                    </div>
                    <div className="mt-3 rounded-lg bg-white p-3 border border-slate-200">
                      <div className="text-sm text-slate-700">
                        {managerSummary ? (
                          <div>
                            {managerSummary.executive_summary && Array.isArray(managerSummary.executive_summary) ? (
                              <div className="mb-2">
                                <div className="text-sm font-semibold">Executive Summary</div>
                                <ul className="list-disc list-inside text-sm text-slate-700">
                                  {managerSummary.executive_summary.map((b: any, i: number) => (
                                    <li key={i}>{b}</li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}

                            {managerSummary.top_action_items && managerSummary.top_action_items.length > 0 ? (
                              <div className="mb-2">
                                <div className="text-sm font-semibold">Top Action Items</div>
                                <div className="mt-2 text-sm">
                                  <div className="grid grid-cols-12 gap-2 text-xs font-medium text-slate-500 border-b pb-2">
                                    <div className="col-span-3">Owner</div>
                                    <div className="col-span-7">Task</div>
                                    <div className="col-span-2">Due</div>
                                  </div>
                                  {managerSummary.top_action_items.map((ai: any, idx: number) => (
                                    <div key={idx} className="grid grid-cols-12 gap-2 py-2 text-sm border-b">
                                      <div className="col-span-3 text-slate-700">{ai.owner || 'Unassigned'}</div>
                                      <div className="col-span-7 text-slate-700">{ai.task}</div>
                                      <div className="col-span-2 text-slate-700">{ai.due_date || 'no_due_date'}</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}

                            {managerSummary.top_risks && managerSummary.top_risks.length > 0 ? (
                              <div className="mb-2">
                                <div className="text-sm font-semibold">Top Risks</div>
                                <ul className="list-disc list-inside text-sm text-rose-600">
                                  {managerSummary.top_risks.map((r: any, i: number) => (
                                    <li key={i}>{r.risk}{r.severity ? ` — ${r.severity}` : ''}{r.mitigation ? `; Mitigation: ${r.mitigation}` : ''}</li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}

                            {managerSummary.follow_ups && managerSummary.follow_ups.length > 0 ? (
                              <div className="mb-2">
                                <div className="text-sm font-semibold">Follow Ups</div>
                                <ul className="list-disc list-inside text-sm text-slate-700">
                                  {managerSummary.follow_ups.map((f: any, i: number) => (
                                    <li key={i}>{f.text || f}</li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}

                            {managerSummary.text && (!managerSummary.executive_summary && !managerSummary.top_action_items && !managerSummary.top_risks) ? (
                              <div className="mt-2 text-sm text-slate-700">{managerSummary.text}</div>
                            ) : null}
                          </div>
                        ) : (
                          <div>
                            <div><strong>Reports:</strong> {teamInsights.report_count} submitted</div>
                            <div><strong>Missing:</strong> {teamInsights.missing_reports_count}</div>
                            <div><strong>Risks:</strong> {teamInsights.total_risks || 0} • <strong>Follow-ups:</strong> {teamInsights.total_follow_ups || 0}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500 mb-4">
                    No aggregated insights available for {displayedReportDate}. Click "Generate Report" to create them.
                  </div>
                )}

                {teamReports.length === 0 ? (
                  <div className="rounded-3xl border border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">No team reports found for {displayedReportDate}.</div>
                ) : (
                  <div>
                    <h3 className="text-sm font-semibold text-slate-900 mb-3">Team Member Reports</h3>
                    {teamReports.map((report, idx) => (
                      <div key={idx} className="rounded-3xl border border-slate-200 p-4 shadow-sm mb-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <div className="text-xs text-slate-500 uppercase">{report.report_date}</div>
                            <h4 className="font-semibold text-slate-900">{report.report_title || "Team Report"}</h4>
                            <div className="text-xs text-slate-500 mt-1">User: {report.user_name || report.user_id}</div>
                          </div>
                        </div>
                        <div className="mt-3 text-sm text-slate-600 whitespace-pre-wrap">{report.summary_text || "No summary available."}</div>
                      </div>
                    ))}
                  </div>
                )}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
