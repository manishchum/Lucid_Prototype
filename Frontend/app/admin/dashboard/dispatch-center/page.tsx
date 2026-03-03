'use client'

import React, { useState, useEffect } from 'react';
import { ChevronDown, MessageSquare, Mail, Calendar, Clock, Check, Send, Loader2, Sparkles, X, Users, AlertCircle } from 'lucide-react';
import EmployeeNavigation from '@/components/employee-navigation';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

interface Sprint {
  module_id: string;
  title: string;
  description: string;
  processing_status: string;
  review_stage: string;
}

interface SubModule {
  processed_module_id: string;
  title: string;
  section_type: string;
  order_index: number;
}

interface AssignedUser {
  user_id: string;
  name: string;
  email: string;
}

const fetchUserByEmail = async (email: string | null) => {
  if (!email) return null;
  try {
    const res = await fetch(`${API_BASE}/api/users/by-email/${encodeURIComponent(email)}`);
    if (!res.ok) return null;
    const payload = await res.json();
    let u = payload?.user ?? payload;
    if (Array.isArray(u)) u = u[0];
    return u || null;
  } catch {
    return null;
  }
};

export default function AdminDispatchCenterPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();

  // Auth state
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Step state
  const [selectedChannel, setSelectedChannel] = useState<'whatsapp' | 'email'>('email');
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [selectedSprintId, setSelectedSprintId] = useState('');
  const [subModules, setSubModules] = useState<SubModule[]>([]);
  const [selectedSubModuleIds, setSelectedSubModuleIds] = useState<string[]>([]);
  const [engagementQuestion, setEngagementQuestion] = useState('');
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('09:00');

  // Sprint image
  const [sprintImageUrl, setSprintImageUrl] = useState('');
  const [loadingImage, setLoadingImage] = useState(false);

  // Email draft state
  const [draftedEmail, setDraftedEmail] = useState<{ subject: string; body: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{ message: string; sent_count: number; failed: string[] } | null>(null);

  // Assigned users
  const [assignedUsers, setAssignedUsers] = useState<AssignedUser[]>([]);

  // Loading states
  const [loadingSprints, setLoadingSprints] = useState(false);
  const [loadingSubModules, setLoadingSubModules] = useState(false);

  // ── Auth bootstrap ───────────────────────────────────────────
  useEffect(() => {
    if (!authLoading && !user) router.push('/login');
  }, [user, authLoading, router]);

  useEffect(() => {
    if (user?.email) {
      fetchUserByEmail(user.email).then((emp) => {
        if (emp) setCurrentUser(emp);
      });
    }
  }, [user]);

  // ── Fetch sprints once we know company_id ────────────────────
  useEffect(() => {
    if (!currentUser?.company_id || !currentUser?.user_id) return;
    const fetchSprints = async () => {
      setLoadingSprints(true);
      try {
        const res = await fetch(`${API_BASE}/api/dispatch/sprints/${currentUser.company_id}`, {
          headers: { 'X-User-ID': currentUser.user_id },
        });
        if (res.ok) {
          const data = await res.json();
          setSprints(data.sprints || []);
        }
      } catch (e) {
        console.error('Error fetching sprints:', e);
      } finally {
        setLoadingSprints(false);
      }
    };
    fetchSprints();
  }, [currentUser]);

  // ── Fetch sub-modules & assigned users when sprint changes ───
  useEffect(() => {
    if (!selectedSprintId || !currentUser?.user_id) {
      setSubModules([]);
      setSelectedSubModuleIds([]);
      setAssignedUsers([]);
      setDraftedEmail(null);
      setSendResult(null);
      setSprintImageUrl('');
      return;
    }

    const fetchData = async () => {
      setLoadingSubModules(true);
      setLoadingImage(true);
      setDraftedEmail(null);
      setSendResult(null);
      try {
        const [subRes, usersRes, imageRes] = await Promise.all([
          fetch(`${API_BASE}/api/dispatch/sub-modules/${selectedSprintId}`, {
            headers: { 'X-User-ID': currentUser.user_id },
          }),
          fetch(`${API_BASE}/api/dispatch/assigned-users/${selectedSprintId}`, {
            headers: { 'X-User-ID': currentUser.user_id },
          }),
          fetch(`${API_BASE}/api/dispatch/sprint-image/${selectedSprintId}`, {
            headers: { 'X-User-ID': currentUser.user_id },
          }),
        ]);
        if (subRes.ok) {
          const subData = await subRes.json();
          setSubModules(subData.sub_modules || []);
        }
        if (usersRes.ok) {
          const usersData = await usersRes.json();
          setAssignedUsers(usersData.users || []);
        }
        if (imageRes.ok) {
          const imageData = await imageRes.json();
          setSprintImageUrl(imageData.image_url || '');
        }
      } catch (e) {
        console.error('Error fetching sub-modules / users / image:', e);
      } finally {
        setLoadingSubModules(false);
        setLoadingImage(false);
      }
    };
    fetchData();
  }, [selectedSprintId, currentUser]);

  // ── Helpers ──────────────────────────────────────────────────
  const selectedSprint = sprints.find((s) => s.module_id === selectedSprintId);

  const toggleSubModule = (id: string) => {
    setSelectedSubModuleIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
    setDraftedEmail(null);
    setSendResult(null);
  };

  const selectAllSubModules = () => {
    if (selectedSubModuleIds.length === subModules.length) {
      setSelectedSubModuleIds([]);
    } else {
      setSelectedSubModuleIds(subModules.map((m) => m.processed_module_id));
    }
    setDraftedEmail(null);
    setSendResult(null);
  };

  // ── Generate email via Gemini ────────────────────────────────
  const handleGenerateEmail = async () => {
    if (!selectedSprint || selectedSubModuleIds.length === 0) return;
    setGenerating(true);
    setDraftedEmail(null);
    setSendResult(null);

    const selectedTitles = subModules
      .filter((m) => selectedSubModuleIds.includes(m.processed_module_id))
      .map((m) => m.title);

    try {
      const res = await fetch(`${API_BASE}/api/dispatch/generate-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': currentUser.user_id,
        },
        body: JSON.stringify({
          sprint_title: selectedSprint.title,
          sub_module_titles: selectedTitles,
          engagement_question: engagementQuestion || undefined,
          scheduled_date: scheduleEnabled ? scheduledDate : undefined,
          scheduled_time: scheduleEnabled ? scheduledTime : undefined,
          sprint_image_url: sprintImageUrl || undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setDraftedEmail(data.email);
      } else {
        const err = await res.json().catch(() => null);
        alert(err?.detail || 'Failed to generate email');
      }
    } catch (e) {
      console.error('Error generating email:', e);
      alert('Failed to generate email');
    } finally {
      setGenerating(false);
    }
  };

  // ── Send email ───────────────────────────────────────────────
  const handleSendEmail = async () => {
    if (!draftedEmail || !selectedSprintId) return;
    setSending(true);
    setSendResult(null);

    try {
      const res = await fetch(`${API_BASE}/api/dispatch/send-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-User-ID': currentUser.user_id,
        },
        body: JSON.stringify({
          module_id: selectedSprintId,
          subject: draftedEmail.subject,
          body: draftedEmail.body,
          scheduled_date: scheduleEnabled ? scheduledDate : undefined,
          scheduled_time: scheduleEnabled ? scheduledTime : undefined,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSendResult(data);
      } else {
        const err = await res.json().catch(() => null);
        alert(err?.detail || 'Failed to send email');
      }
    } catch (e) {
      console.error('Error sending email:', e);
      alert('Failed to send email');
    } finally {
      setSending(false);
    }
  };

  // ── Loading state ────────────────────────────────────────────
  if (!currentUser) {
    return (
      <div className="flex min-h-screen bg-[#FAFBFC]">
        <EmployeeNavigation />
        <main className="flex-1 lg:ml-[280px] p-8 flex items-center justify-center">
          <div className="w-10 h-10 border-4 border-[#3B66F5]/20 border-t-[#3B66F5] rounded-full animate-spin" />
        </main>
      </div>
    );
  }

  const canDraft = selectedSprintId && selectedSubModuleIds.length > 0;

  return (
    <div className="flex min-h-screen bg-[#FAFBFC]">
      <EmployeeNavigation />

      <main className="flex-1  p-8">
        <div className="max-w-[2000px] mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-[#1E293B] flex items-center gap-3 mb-2">
              <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center">
                <MessageSquare className="text-white" size={20} />
              </div>
              Admin Dispatch Center
            </h1>
            <p className="text-slate-500">
              Send nudge emails to employees assigned to a sprint.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* ─── LEFT COLUMN: Configuration ─────────────────── */}
            <div className="space-y-6">
              {/* 1. Delivery Channel */}
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 block">
                  1. Delivery Channel
                </label>
                <div className="flex gap-3">
                  <button
                    onClick={() => setSelectedChannel('whatsapp')}
                    className={`flex-1 px-4 py-3 rounded-xl border-2 transition-all flex items-center justify-center gap-2 ${
                      selectedChannel === 'whatsapp'
                        ? 'border-green-500 bg-green-50 text-green-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <MessageSquare size={18} />
                    <span className="font-semibold">WhatsApp</span>
                  </button>
                  <button
                    onClick={() => setSelectedChannel('email')}
                    className={`flex-1 px-4 py-3 rounded-xl border-2 transition-all flex items-center justify-center gap-2 ${
                      selectedChannel === 'email'
                        ? 'border-blue-500 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    <Mail size={18} />
                    <span className="font-semibold">Email</span>
                  </button>
                </div>
              </div>

              {/* 2. Target Sprint */}
              <div>
                <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 block">
                  2. Target Sprint
                </label>
                <div className="relative">
                  {loadingSprints ? (
                    <div className="flex items-center gap-2 px-4 py-3.5 text-slate-400">
                      <Loader2 size={16} className="animate-spin" /> Loading sprints…
                    </div>
                  ) : (
                    <>
                      <select
                        value={selectedSprintId}
                        onChange={(e) => setSelectedSprintId(e.target.value)}
                        className="w-full px-4 py-3.5 rounded-xl border-2 border-slate-200 bg-slate-900 text-white font-semibold appearance-none cursor-pointer hover:border-slate-300 transition-all focus:outline-none focus:border-blue-500"
                      >
                        <option value="">Select a sprint…</option>
                        {sprints.map((s) => (
                          <option key={s.module_id} value={s.module_id}>
                            {s.title}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-white pointer-events-none" size={18} />
                    </>
                  )}
                </div>
              </div>

              {/* 3. Sub-Module Selection (multi) */}
              {selectedSprintId && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      3. Sub-Module Selection
                    </label>
                    {subModules.length > 0 && (
                      <button
                        onClick={selectAllSubModules}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-800 transition-colors"
                      >
                        {selectedSubModuleIds.length === subModules.length ? 'Deselect All' : 'Select All'}
                      </button>
                    )}
                  </div>

                  {loadingSubModules ? (
                    <div className="flex items-center gap-2 px-4 py-3 text-slate-400">
                      <Loader2 size={16} className="animate-spin" /> Loading sub-modules…
                    </div>
                  ) : subModules.length === 0 ? (
                    <div className="flex items-center gap-2 px-4 py-4 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 text-sm">
                      <AlertCircle size={16} /> No sub-modules found for this sprint.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-[280px] overflow-y-auto pr-1">
                      {subModules.map((mod) => {
                        const selected = selectedSubModuleIds.includes(mod.processed_module_id);
                        return (
                          <button
                            key={mod.processed_module_id}
                            onClick={() => toggleSubModule(mod.processed_module_id)}
                            className={`px-4 py-3 rounded-xl border-2 transition-all text-sm font-semibold text-left flex items-center justify-between gap-2 ${
                              selected
                                ? 'border-blue-500 bg-blue-50 text-blue-700'
                                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                            }`}
                          >
                            <span className="truncate">{mod.title}</span>
                            {selected && <Check size={16} className="shrink-0 text-blue-500" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* 4. Engagement Question */}
              {selectedSprintId && (
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 block">
                    4. Engagement Question (optional)
                  </label>
                  <div className="bg-red-50 border-2 border-red-100 rounded-xl p-4">
                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-8 h-8 bg-red-500 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-white font-bold text-lg">?</span>
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 text-sm mb-1">Engagement Question</h4>
                        <p className="text-xs text-slate-600">Include a challenge or thought-provoking question in the email</p>
                      </div>
                    </div>
                    <textarea
                      value={engagementQuestion}
                      onChange={(e) => { setEngagementQuestion(e.target.value); setDraftedEmail(null); setSendResult(null); }}
                      rows={2}
                      placeholder="e.g. What's one compliance risk you've encountered this quarter?"
                      className="w-full px-3 py-2 rounded-lg border border-red-200 bg-white text-sm focus:outline-none focus:border-red-400 resize-none"
                    />
                  </div>
                </div>
              )}

              {/* 5. Sprint Image */}
              {selectedSprintId && (
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 block">
                    5. Sprint Image (for email hero)
                  </label>
                  <div className="space-y-3">
                    {/* Auto-fetched preview or loading */}
                    {loadingImage ? (
                      <div className="flex items-center gap-2 text-sm text-slate-400">
                        <Loader2 size={14} className="animate-spin" /> Looking for sprint image…
                      </div>
                    ) : sprintImageUrl ? (
                      <div className="relative rounded-xl overflow-hidden border border-slate-200 bg-slate-50">
                        <img
                          src={sprintImageUrl}
                          alt="Sprint image preview"
                          className="w-full h-36 object-cover"
                        />
                        <button
                          onClick={() => { setSprintImageUrl(''); setDraftedEmail(null); }}
                          className="absolute top-2 right-2 w-7 h-7 bg-white/90 hover:bg-white rounded-full flex items-center justify-center shadow text-slate-600 hover:text-red-500 transition-colors"
                          title="Remove image"
                        >
                          <X size={14} />
                        </button>
                        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/40 to-transparent px-3 py-2">
                          <p className="text-[11px] text-white/90 font-medium truncate">
                            {sprintImageUrl.length > 60 ? sprintImageUrl.slice(0, 60) + '…' : sprintImageUrl}
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 text-sm">
                        <span>🖼️</span> No image found for this sprint — paste a URL below.
                      </div>
                    )}
                    {/* Manual URL override */}
                    <input
                      type="url"
                      value={sprintImageUrl}
                      onChange={(e) => { setSprintImageUrl(e.target.value); setDraftedEmail(null); }}
                      placeholder="Paste an image URL to use in the email…"
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm focus:outline-none focus:border-blue-400 text-slate-700"
                    />
                  </div>
                </div>
              )}

              {/* 6. Dispatch Scheduling */}
              {selectedSprintId && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-2">
                      <Calendar size={14} />
                      6. Dispatch Scheduling
                    </label>
                    <button
                      onClick={() => setScheduleEnabled(!scheduleEnabled)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        scheduleEnabled ? 'bg-blue-500' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          scheduleEnabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  {scheduleEnabled && (
                    <div className="space-y-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 block">Date</label>
                          <input
                            type="date"
                            value={scheduledDate}
                            onChange={(e) => setScheduledDate(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium focus:outline-none focus:border-blue-500"
                          />
                        </div>
                        <div>
                          <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 block">Time</label>
                          <div className="relative">
                            <Clock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                            <input
                              type="time"
                              value={scheduledTime}
                              onChange={(e) => setScheduledTime(e.target.value)}
                              className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium focus:outline-none focus:border-blue-500"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Draft Button */}
              {canDraft && (
                <button
                  onClick={handleGenerateEmail}
                  disabled={generating}
                  className="w-full bg-blue-500 hover:bg-blue-600 disabled:bg-blue-300 text-white font-bold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/30"
                >
                  {generating ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Generating Email…
                    </>
                  ) : (
                    <>
                      <Sparkles size={18} />
                      Draft Email Snippet
                    </>
                  )}
                </button>
              )}
            </div>

            {/* ─── RIGHT COLUMN: Preview & Send ───────────────── */}
            <div className="space-y-6">
              {/* Assigned Users Card */}
              {selectedSprintId && (
                <div className="bg-white rounded-xl p-5 border border-slate-200">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                      <Users size={16} className="text-purple-600" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Recipients</h3>
                      <p className="text-xs text-slate-500">{assignedUsers.length} user{assignedUsers.length !== 1 ? 's' : ''} assigned to this sprint</p>
                    </div>
                  </div>
                  {assignedUsers.length > 0 ? (
                    <div className="max-h-[120px] overflow-y-auto space-y-1.5">
                      {assignedUsers.map((u) => (
                        <div key={u.user_id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-50 text-sm">
                          <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-[10px] font-bold text-blue-700 shrink-0">
                            {u.name?.charAt(0)?.toUpperCase() || '?'}
                          </div>
                          <span className="font-medium text-slate-700 truncate">{u.name}</span>
                          <span className="text-slate-400 text-xs truncate ml-auto">{u.email}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400 text-center py-4">No users assigned yet.</p>
                  )}
                </div>
              )}

              {/* Email Preview */}
              <div className="bg-gradient-to-br from-slate-50 to-blue-50 rounded-xl p-6 border border-slate-200 min-h-[300px]">
                <h3 className="text-lg font-bold text-slate-900 mb-4">Email Preview</h3>

                {!draftedEmail && !generating && (
                  <div className="text-center py-16">
                    <div className="w-16 h-16 bg-white rounded-full mx-auto mb-4 flex items-center justify-center shadow-sm">
                      <span className="text-3xl">📧</span>
                    </div>
                    <p className="text-sm text-slate-600 font-medium">
                      Select a sprint &amp; sub-modules, then click
                    </p>
                    <p className="text-sm font-bold text-blue-600">&ldquo;Draft Email Snippet&rdquo;</p>
                    <p className="text-sm text-slate-600 font-medium">to generate a preview.</p>
                  </div>
                )}

                {generating && (
                  <div className="text-center py-16">
                    <Loader2 size={36} className="animate-spin text-blue-500 mx-auto mb-4" />
                    <p className="text-sm font-semibold text-slate-600">Generating email with AI…</p>
                  </div>
                )}

                {draftedEmail && !generating && (
                  <div className="space-y-4">
                    {/* Subject */}
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">Subject</label>
                      <input
                        type="text"
                        value={draftedEmail.subject}
                        onChange={(e) => setDraftedEmail({ ...draftedEmail, subject: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-800 focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    {/* Body */}
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">Body Preview</label>
                      <iframe
                        srcDoc={draftedEmail.body}
                        className="w-full rounded-lg border border-slate-200 bg-white"
                        style={{ height: '480px' }}
                        sandbox="allow-same-origin"
                        title="Email Preview"
                      />
                    </div>

                    {/* Send / Regenerate buttons */}
                    <div className="flex gap-3 pt-2">
                      <button
                        onClick={handleGenerateEmail}
                        disabled={generating}
                        className="flex-1 py-3 rounded-xl border-2 border-slate-200 bg-white text-slate-700 font-semibold hover:border-slate-300 transition-all flex items-center justify-center gap-2 text-sm"
                      >
                        <Sparkles size={16} /> Regenerate
                      </button>
                      <button
                        onClick={handleSendEmail}
                        disabled={sending || assignedUsers.length === 0}
                        className="flex-1 py-3 rounded-xl bg-green-500 hover:bg-green-600 disabled:bg-green-300 text-white font-bold transition-all flex items-center justify-center gap-2 text-sm shadow-lg shadow-green-500/30"
                      >
                        {sending ? (
                          <>
                            <Loader2 size={16} className="animate-spin" /> Sending…
                          </>
                        ) : (
                          <>
                            <Send size={16} /> Send Email ({assignedUsers.length})
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Send Result */}
              {sendResult && (
                <div className={`rounded-xl p-5 border-2 ${sendResult.failed.length === 0 ? 'bg-green-50 border-green-200' : 'bg-yellow-50 border-yellow-200'}`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${sendResult.failed.length === 0 ? 'bg-green-500' : 'bg-yellow-500'}`}>
                      {sendResult.failed.length === 0 ? (
                        <Check size={20} className="text-white" />
                      ) : (
                        <AlertCircle size={20} className="text-white" />
                      )}
                    </div>
                    <div>
                      <h4 className="font-bold text-slate-900 text-sm">{sendResult.message}</h4>
                      {sendResult.failed.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs font-semibold text-red-600 mb-1">Failed to deliver to:</p>
                          {sendResult.failed.map((email) => (
                            <p key={email} className="text-xs text-red-500">{email}</p>
                          ))}
                        </div>
                      )}
                    </div>
                    <button onClick={() => setSendResult(null)} className="ml-auto text-slate-400 hover:text-slate-600">
                      <X size={16} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
