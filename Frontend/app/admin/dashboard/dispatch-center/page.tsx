'use client'

import React, { useState, useEffect, useRef } from 'react';
import { ChevronDown, MessageSquare, Mail, Calendar, Clock, Check, Send, Loader2, X, Users, AlertCircle, FileJson, Music, Upload, RefreshCw, Pencil, Eye } from 'lucide-react';
import EmployeeNavigation from '@/components/employee-navigation';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

interface Sprint {
  module_id: string;
  title: string;
  description: string;
  processing_status: string;
  review_stage: string;
}

function useIllusionProgress(active: boolean) {
  const [progress, setProgress] = useState(12);
  const [show, setShow] = useState(active);

  useEffect(() => {
    if (!active) {
      setProgress(100);
      const timeout = setTimeout(() => setShow(false), 180);
      return () => clearTimeout(timeout);
    }

    setShow(true);
    setProgress(Math.min(25, 10 + Math.round(Math.random() * 12)));

    const id = setInterval(() => {
      setProgress((prev) => {
        const shouldHold = prev > 70 ? Math.random() < 0.45 : Math.random() < 0.25;
        if (shouldHold) return prev;
        const increment = Math.max(1, Math.round(Math.random() * 7));
        return Math.min(prev + increment, 93);
      });
    }, 420 + Math.round(Math.random() * 240));

    return () => clearInterval(id);
  }, [active]);

  return { progress: Math.min(progress, 100), show };
}

function LoadingProgress({ label, progress }: { label: string; progress: number }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-lg border border-slate-100 p-6 space-y-4">
        <div className="flex items-center justify-between text-sm font-semibold text-slate-700">
          <span>{label}</span>
          <span className="text-slate-900 text-base font-black">{progress}%</span>
        </div>
        <div className="relative h-3 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="absolute left-0 top-0 h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-cyan-400 transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-slate-500 font-medium">Preparing dispatch center. This may take a moment.</p>
      </div>
    </div>
  );
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
  // ── Recurring schedule state ─────────────────────────────────
  const [scheduleMode, setScheduleMode] = useState<'once' | 'recurring'>('recurring');
  const [selectedDays, setSelectedDays] = useState<string[]>([]);
  const [recurringTime, setRecurringTime] = useState('09:00');

  // ── Multi-module stagger state ───────────────────────────────
  // When multiple modules are selected with recurring, we show a per-module
  // stagger preview and use the dedicated schedule-multi-module endpoint.
  interface StaggerJob {
    week: number;
    module_id: string;
    module_title: string;
    run_date: string;
    recipient_count: number;
    job_id: string | null;
    warning?: string;
  }
  const [multiModuleResult, setMultiModuleResult] = useState<{
    status: string;
    scheduled_day: string;
    scheduled_time: string;
    total_modules: number;
    jobs: StaggerJob[];
  } | null>(null);

  // ── Content selector state ───────────────────────────────────
  const [selectedContent, setSelectedContent] = useState<string[]>([]);

  // Flashcard import
  const [flashcardMode, setFlashcardMode] = useState<'existing' | 'import'>('existing');
  const [customFlashcards, setCustomFlashcards] = useState<{ heading: string; points: string[] }[] | null>(null);
  const [flashcardImportError, setFlashcardImportError] = useState('');
  const [flashcardImportSuccess, setFlashcardImportSuccess] = useState('');
  const flashcardFileRef = useRef<HTMLInputElement>(null);

  // Audio import
  const [audioMode, setAudioMode] = useState<'existing' | 'import'>('existing');
  const [customAudioUrl, setCustomAudioUrl] = useState<string | null>(null);
  const [audioFileName, setAudioFileName] = useState('');
  const [audioFileSize, setAudioFileSize] = useState('');
  const [audioUploadProgress, setAudioUploadProgress] = useState(0);
  const [audioUploading, setAudioUploading] = useState(false);
  const [audioUploadError, setAudioUploadError] = useState('');
  const audioFileRef = useRef<HTMLInputElement>(null);

  // Sprint image
  const [sprintImageUrl, setSprintImageUrl] = useState('');
  const [loadingImage, setLoadingImage] = useState(false);

  // Email draft state
  const [draftedEmail, setDraftedEmail] = useState<{ subject: string; body: string } | null>(null);
  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [editSubject, setEditSubject] = useState('');
  const [editBodyText, setEditBodyText] = useState('');
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<{
    message: string;
    sent_count?: number;
    failed?: string[];
    status?: string;
    scheduled_at?: string;
    recipient_count?: number;
    // recurring schedule
    scheduled_emails_id?: string;
    days_of_week?: string[];
    scheduled_time?: string;
  } | null>(null);

  // Assigned users
  const [assignedUsers, setAssignedUsers] = useState<AssignedUser[]>([]);

  // Loading states
  const [loadingSprints, setLoadingSprints] = useState(false);
  const [loadingSubModules, setLoadingSubModules] = useState(false);
  const { progress: loadingProgress, show: showLoadingProgress } = useIllusionProgress(authLoading || !currentUser);

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
      setMultiModuleResult(null);
      setSprintImageUrl('');
      return;
    }

    const fetchData = async () => {
      setLoadingSubModules(true);
      setLoadingImage(true);
      setDraftedEmail(null);
      setSendResult(null);
      setMultiModuleResult(null);
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
    setMultiModuleResult(null);
  };

  const selectAllSubModules = () => {
    if (selectedSubModuleIds.length === subModules.length) {
      setSelectedSubModuleIds([]);
    } else {
      setSelectedSubModuleIds(subModules.map((m) => m.processed_module_id));
    }
    setDraftedEmail(null);
    setSendResult(null);
    setMultiModuleResult(null);
  };

  // ── Flashcard JSON import ────────────────────────────────────
  const handleFlashcardFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFlashcardImportError('');
    setFlashcardImportSuccess('');
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        if (
          !Array.isArray(parsed) ||
          parsed.length === 0 ||
          !parsed.every(
            (c: any) =>
              typeof c.heading === 'string' && Array.isArray(c.points)
          )
        ) {
          setFlashcardImportError('Invalid format. Expected [{ heading, points[] }]');
          setCustomFlashcards(null);
          return;
        }
        setCustomFlashcards(parsed);
        setFlashcardImportSuccess(`✓ ${parsed.length} card${parsed.length !== 1 ? 's' : ''} imported`);
      } catch {
        setFlashcardImportError('Could not parse file. Make sure it is valid JSON.');
        setCustomFlashcards(null);
      }
    };
    reader.readAsText(file);
    // reset input so same file can be re-selected
    e.target.value = '';
  };

  // ── Audio file upload to Supabase ────────────────────────────
  const handleAudioFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAudioUploadError('');
    setCustomAudioUrl(null);
    setAudioFileName(file.name);
    setAudioFileSize((file.size / (1024 * 1024)).toFixed(1) + ' MB');
    setAudioUploading(true);
    setAudioUploadProgress(10);

    try {
      const path = `custom-audio/${selectedSprintId}/${Date.now()}_${file.name}`;
      // Simulate incremental progress while uploading
      const progressInterval = setInterval(() => {
        setAudioUploadProgress((p) => Math.min(p + 15, 85));
      }, 300);

      const { error } = await supabase.storage
        .from('module_audio')
        .upload(path, file, { upsert: true });

      clearInterval(progressInterval);

      if (error) {
        setAudioUploadError(`Upload failed: ${error.message}`);
        setAudioUploading(false);
        setAudioUploadProgress(0);
        return;
      }

      const { data: urlData } = supabase.storage
        .from('module_audio')
        .getPublicUrl(path);

      setCustomAudioUrl(urlData.publicUrl);
      setAudioUploadProgress(100);
    } catch (err: any) {
      setAudioUploadError(`Upload failed: ${err.message ?? 'Unknown error'}`);
      setAudioUploadProgress(0);
    } finally {
      setAudioUploading(false);
      e.target.value = '';
    }
  };

  // ── Toggle content item ──────────────────────────────────────
  const toggleContent = (key: string) => {
    setSelectedContent((prev) =>
      prev.includes(key) ? prev.filter((x) => x !== key) : [...prev, key]
    );
  };

  // ── Edit mode helpers ────────────────────────────────────────
  /**
   * Extract the visible plain text from the HTML body so the user can
   * edit it as a simple string. We strip all HTML tags and decode entities.
   * We preserve the full HTML structure — edits are applied back via
   * patchEmailBody().
   */
  const getEditableText = (html: string): string => {
    // Only extract the "editable" region: everything between the two
    // <!-- CONTENT BLOCKS --> / <!-- DIVIDER --> markers (or before them).
    // Simpler approach: strip ALL tags, collapse whitespace, let the user
    // see the readable text of the Gemini-written body rows.
    const div = document.createElement('div');
    div.innerHTML = html;
    // Remove script/style noise
    div.querySelectorAll('script,style').forEach((el) => el.remove());
    return (div.textContent || div.innerText || '')
      .replace(/\s+/g, ' ')
      .trim();
  };

  /**
   * We don't try to re-inject the edited text into the raw HTML directly
   * (too fragile). Instead we keep a separate `editBodyText` string that
   * the user edits, and when they save we rebuild just the <p> text nodes
   * inside the three body <td> rows using a regex replacement on the known
   * pattern from the Gemini template.
   *
   * Strategy: replace the text content of every <p> tag inside the
   * "EMAIL BODY TEXT" section. We identify that section by the comment
   * <!-- EMAIL BODY TEXT --> … up to <!-- DIVIDER -->.
   */
  const patchEmailBody = (originalHtml: string, newText: string): string => {
    // Split the user's edited text into paragraphs on blank lines
    const paragraphs = newText.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    if (paragraphs.length === 0) return originalHtml;

    // Find the EMAIL BODY TEXT section
    const bodyStart = originalHtml.indexOf('<!-- EMAIL BODY TEXT -->');
    const dividerMark = originalHtml.indexOf('<!-- DIVIDER -->');

    // If the markers don't exist fall back to returning the original
    if (bodyStart === -1 || dividerMark === -1) return originalHtml;

    const beforeBody = originalHtml.slice(0, bodyStart);
    const bodySection = originalHtml.slice(bodyStart, dividerMark);
    const afterDivider = originalHtml.slice(dividerMark);

    // Replace all <p ...>...</p> blocks in the body section with the new paragraphs
    let idx = 0;
    const patchedBody = bodySection.replace(
      /<p(\s[^>]*)?>[\s\S]*?<\/p>/g,
      (match) => {
        // Keep style attributes, replace inner text
        const styleMatch = match.match(/<p([^>]*)>/);
        const attrs = styleMatch ? styleMatch[1] : '';
        const replacement = `<p${attrs}>${paragraphs[idx] ?? ''}</p>`;
        idx++;
        return replacement;
      }
    );

    return beforeBody + patchedBody + afterDivider;
  };

  const handleEnterEditMode = () => {
    if (!draftedEmail) return;
    setEditSubject(draftedEmail.subject);

    // Extract only the plain-text paragraphs from the EMAIL BODY TEXT section
    // so the user edits readable sentences, not raw HTML.
    const html = draftedEmail.body;
    const bodyStart = html.indexOf('<!-- EMAIL BODY TEXT -->');
    const dividerMark = html.indexOf('<!-- DIVIDER -->');

    if (bodyStart !== -1 && dividerMark !== -1) {
      const bodySection = html.slice(bodyStart, dividerMark);
      // Pull out the inner text of every <p> tag in that section
      const matches = [...bodySection.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)];
      const paragraphs = matches
        .map((m) => {
          // Strip any inner HTML tags and decode basic entities
          return m[1]
            .replace(/<[^>]+>/g, '')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&#39;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&#8594;/g, '→')
            .replace(/&nbsp;/g, ' ')
            .trim();
        })
        .filter(Boolean);
      setEditBodyText(paragraphs.join('\n\n'));
    } else {
      // Fallback: strip all tags from the full body
      const div = document.createElement('div');
      div.innerHTML = html;
      div.querySelectorAll('script,style').forEach((el) => el.remove());
      setEditBodyText((div.textContent || '').replace(/\s+/g, ' ').trim());
    }

    setIsEditingEmail(true);
  };

  const handleSaveEdit = () => {
    if (!draftedEmail) return;
    // Patch the plain-text edits back into the original HTML structure
    const patched = patchEmailBody(draftedEmail.body, editBodyText);
    setDraftedEmail({ subject: editSubject, body: patched });
    setIsEditingEmail(false);
  };

  const handleCancelEdit = () => {
    setIsEditingEmail(false);
    setEditSubject('');
    setEditBodyText('');
  };

  // ── Generate email via Gemini ────────────────────────────────
  const handleGenerateEmail = async () => {
    if (!selectedSprint || selectedSubModuleIds.length === 0) return;
    setGenerating(true);
    setDraftedEmail(null);
    setSendResult(null);
    setMultiModuleResult(null);
    setIsEditingEmail(false);
    setEditBodyText('');
    setEditSubject('');

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
        const geminiEmail = data.email;

        // If content blocks are selected, fetch the raw flashcard/audio HTML and
        // inject it into the Gemini email — so the final email has BOTH the
        // Gemini-written message AND the real flashcard/audio content
        if (selectedContent.length > 0 && selectedSprintId) {
          try {
            const notifyRes = await fetch(`${API_BASE}/api/dispatch/notify-email`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-User-ID': currentUser.user_id },
              body: JSON.stringify({
                module_id: selectedSprintId,
                selected_content: selectedContent,
                blocks_only: true,
                ...(customFlashcards ? { customFlashcards } : {}),
                ...(customAudioUrl ? { customAudioUrl } : {}),
              }),
            });
            if (notifyRes.ok) {
              const { blocks_html } = await notifyRes.json();
              if (blocks_html) {
                // Inject the blocks right before <!-- DIVIDER --> in the Gemini email
                const injectedRow = `
          <!-- CONTENT BLOCKS -->
          <tr>
            <td style="padding:0 36px 24px;">
              ${blocks_html}
            </td>
          </tr>

          <!-- DIVIDER -->`;
                const enrichedBody = geminiEmail.body.replace('<!-- DIVIDER -->', injectedRow);
                setDraftedEmail({ subject: geminiEmail.subject, body: enrichedBody });
              } else {
                // blocks_html was empty (no flashcards/audio found) — just show Gemini email
                setDraftedEmail(geminiEmail);
              }
            } else {
              setDraftedEmail(geminiEmail);
            }
          } catch {
            setDraftedEmail(geminiEmail);
          }
        } else {
          setDraftedEmail(geminiEmail);
        }
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

    const notifyPayload: Record<string, any> = {
      module_id: selectedSprintId,
      subject: draftedEmail.subject,
      body: draftedEmail.body,
      selected_content: selectedContent,
      ...(customFlashcards ? { customFlashcards } : {}),
      ...(customAudioUrl ? { customAudioUrl } : {}),
    };

    try {
      if (scheduleEnabled && scheduleMode === 'recurring') {
        // ── Save recurring schedule to DB ───────────────────────
        if (selectedDays.length === 0) {
          alert('Please select at least one day of the week.');
          setSending(false);
          return;
        }
        // Convert the user's local HH:MM to UTC HH:MM before storing,
        // so the cron worker (which operates in UTC) compares apples to apples.
        const [localH, localM] = recurringTime.split(':').map(Number);
        const localDate = new Date();
        localDate.setHours(localH, localM, 0, 0);
        const utcTime = `${String(localDate.getUTCHours()).padStart(2, '0')}:${String(localDate.getUTCMinutes()).padStart(2, '0')}`;

        const res = await fetch(`/api/dispatch/save-schedule`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...notifyPayload,
            days_of_week: selectedDays,
            scheduled_time: utcTime,          // stored & read as UTC
            company_id: currentUser.company_id,
            recipient_user_ids: assignedUsers.map((u) => ({ user_id: u.user_id, email: u.email })),
          }),
        });
        if (res.ok) {
          setSendResult(await res.json());
        } else {
          const err = await res.json().catch(() => null);
          alert(err?.error || 'Failed to save schedule');
        }
      } else if (scheduleEnabled && scheduleMode === 'once') {
        // ── Schedule one-time future delivery ───────────────────
        if (!scheduledDate || !scheduledTime) {
          alert('Please pick a date and time before scheduling.');
          setSending(false);
          return;
        }
        const res = await fetch(`${API_BASE}/api/dispatch/schedule-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-ID': currentUser.user_id },
          body: JSON.stringify({
            ...notifyPayload,
            scheduled_date: scheduledDate,
            scheduled_time: scheduledTime,
          }),
        });
        if (res.ok) {
          setSendResult(await res.json());
        } else {
          const err = await res.json().catch(() => null);
          alert(err?.detail || 'Failed to schedule email');
        }
      } else {
        // ── Send immediately ────────────────────────────────────
        const res = await fetch(`${API_BASE}/api/dispatch/send-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-User-ID': currentUser.user_id },
          body: JSON.stringify(notifyPayload),
        });
        if (res.ok) {
          setSendResult(await res.json());
        } else {
          const err = await res.json().catch(() => null);
          alert(err?.detail || 'Failed to send email');
        }
      }
    } catch (e) {
      console.error('Error sending/scheduling email:', e);
      alert('Failed to send/schedule email');
    } finally {
      setSending(false);
    }
  };

  // ── Multi-module stagger scheduler ───────────────────────────
  // Called when: ≥2 modules selected + recurring mode + at least one day chosen.
  // Each module gets its own flashcard email on a successive week:
  //   Module 1 → first upcoming <day> at <time> UTC
  //   Module 2 → one week later … etc.
  const handleScheduleMultiModule = async () => {
    if (selectedSubModuleIds.length < 2 || selectedDays.length === 0) return;
    setSending(true);
    setMultiModuleResult(null);
    setSendResult(null);

    // Convert local time → UTC HH:MM (same logic as existing recurring path)
    const [localH, localM] = recurringTime.split(':').map(Number);
    const localDate = new Date();
    localDate.setHours(localH, localM, 0, 0);
    const utcTime = `${String(localDate.getUTCHours()).padStart(2, '0')}:${String(localDate.getUTCMinutes()).padStart(2, '0')}`;

    // Use the first selected day
    const scheduledDay = selectedDays[0];

    try {
      const res = await fetch(`${API_BASE}/api/dispatch/schedule-multi-module`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-User-ID': currentUser.user_id },
        body: JSON.stringify({
          module_ids: selectedSubModuleIds,
          selected_content: selectedContent,
          scheduled_day: scheduledDay,
          scheduled_time: utcTime,
          ...(customFlashcards ? { customFlashcards } : {}),
          ...(customAudioUrl ? { customAudioUrl } : {}),
        }),
      });
      if (res.ok) {
        setMultiModuleResult(await res.json());
      } else {
        const err = await res.json().catch(() => null);
        alert(err?.detail || 'Failed to schedule multi-module dispatch');
      }
    } catch (e) {
      console.error('Error scheduling multi-module dispatch:', e);
      alert('Failed to schedule multi-module dispatch');
    } finally {
      setSending(false);
    }
  };

  // ── Loading state ────────────────────────────────────────────
  if (!currentUser) {
    return (
      showLoadingProgress
        ? <LoadingProgress label="Loading dispatch center..." progress={loadingProgress} />
        : (
          <div className="flex min-h-screen bg-[#FAFBFC]">
            <EmployeeNavigation />
            <main className="flex-1 lg:ml-[280px] p-8 flex items-center justify-center">
              <div className="w-10 h-10 border-4 border-[#3B66F5]/20 border-t-[#3B66F5] rounded-full animate-spin" />
            </main>
          </div>
        )
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

              {/* 5. Content to Include */}
              {selectedSprintId && (
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 block">
                    5. Content to Include
                  </label>
                  <div className="space-y-3">

                    {/* ── Flashcard card ── */}
                    <div className={`rounded-xl border-2 transition-all overflow-hidden ${
                      selectedContent.includes('flashcards')
                        ? 'border-purple-400 bg-purple-50'
                        : 'border-slate-200 bg-white'
                    }`}>
                      <button
                        onClick={() => toggleContent('flashcards')}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left"
                      >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                          selectedContent.includes('flashcards') ? 'bg-purple-500' : 'bg-slate-100'
                        }`}>
                          <FileJson size={16} className={selectedContent.includes('flashcards') ? 'text-white' : 'text-slate-500'} />
                        </div>
                        <div className="flex-1">
                          <p className="font-semibold text-sm text-slate-800">Flashcards</p>
                          <p className="text-xs text-slate-500">Embed flashcard cards from the module</p>
                        </div>
                        {selectedContent.includes('flashcards') && (
                          <Check size={16} className="text-purple-500 shrink-0" />
                        )}
                      </button>

                      {/* Flashcard sub-options */}
                      {selectedContent.includes('flashcards') && (
                        <div className="px-4 pb-4 space-y-3">
                          {/* Toggle pill */}
                          <div className="inline-flex rounded-full bg-slate-100 p-1 gap-1">
                            <button
                              onClick={() => { setFlashcardMode('existing'); setCustomFlashcards(null); setFlashcardImportError(''); setFlashcardImportSuccess(''); }}
                              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                                flashcardMode === 'existing'
                                  ? 'bg-white shadow text-slate-800'
                                  : 'text-slate-500 hover:text-slate-700'
                              }`}
                            >
                              Use Existing
                            </button>
                            <button
                              onClick={() => setFlashcardMode('import')}
                              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                                flashcardMode === 'import'
                                  ? 'bg-white shadow text-slate-800'
                                  : 'text-slate-500 hover:text-slate-700'
                              }`}
                            >
                              Import JSON
                            </button>
                          </div>

                          {/* Import JSON panel */}
                          {flashcardMode === 'import' && (
                            <div className="space-y-2">
                              <input
                                ref={flashcardFileRef}
                                type="file"
                                accept=".json"
                                className="hidden"
                                onChange={handleFlashcardFileChange}
                              />
                              <button
                                onClick={() => flashcardFileRef.current?.click()}
                                className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-purple-300 bg-white text-purple-600 text-xs font-semibold hover:bg-purple-50 transition-all w-full justify-center"
                              >
                                <Upload size={14} /> Choose .json file
                              </button>
                              {flashcardImportSuccess && (
                                <p className="text-xs font-semibold text-green-600 flex items-center gap-1">
                                  <Check size={12} /> {flashcardImportSuccess}
                                </p>
                              )}
                              {flashcardImportError && (
                                <p className="text-xs text-red-500">{flashcardImportError}</p>
                              )}
                              <p className="text-[11px] text-slate-400">
                                Expected format: <code className="bg-slate-100 px-1 rounded">{'[{ "heading": "...", "points": ["..."] }]'}</code>
                              </p>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* ── Audio card ── */}
                    <div className={`rounded-xl border-2 transition-all overflow-hidden ${
                      selectedContent.includes('audio')
                        ? 'border-orange-400 bg-orange-50'
                        : 'border-slate-200 bg-white'
                    }`}>
                      <button
                        onClick={() => toggleContent('audio')}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left"
                      >
                        <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                          selectedContent.includes('audio') ? 'bg-orange-500' : 'bg-slate-100'
                        }`}>
                          <Music size={16} className={selectedContent.includes('audio') ? 'text-white' : 'text-slate-500'} />
                        </div>
                        <div className="flex-1">
                          <p className="font-semibold text-sm text-slate-800">Audio Lesson</p>
                          <p className="text-xs text-slate-500">Embed a listen link for the module audio</p>
                        </div>
                        {selectedContent.includes('audio') && (
                          <Check size={16} className="text-orange-500 shrink-0" />
                        )}
                      </button>

                      {/* Audio sub-options */}
                      {selectedContent.includes('audio') && (
                        <div className="px-4 pb-4 space-y-3">
                          {/* Toggle pill */}
                          <div className="inline-flex rounded-full bg-slate-100 p-1 gap-1">
                            <button
                              onClick={() => { setAudioMode('existing'); setCustomAudioUrl(null); setAudioFileName(''); setAudioFileSize(''); setAudioUploadError(''); setAudioUploadProgress(0); }}
                              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                                audioMode === 'existing'
                                  ? 'bg-white shadow text-slate-800'
                                  : 'text-slate-500 hover:text-slate-700'
                              }`}
                            >
                              Use Existing
                            </button>
                            <button
                              onClick={() => setAudioMode('import')}
                              className={`px-3 py-1 rounded-full text-xs font-semibold transition-all ${
                                audioMode === 'import'
                                  ? 'bg-white shadow text-slate-800'
                                  : 'text-slate-500 hover:text-slate-700'
                              }`}
                            >
                              Import Audio
                            </button>
                          </div>

                          {/* Import Audio panel */}
                          {audioMode === 'import' && (
                            <div className="space-y-2">
                              <input
                                ref={audioFileRef}
                                type="file"
                                accept=".mp3,.wav"
                                className="hidden"
                                onChange={handleAudioFileChange}
                              />
                              {!audioFileName ? (
                                <button
                                  onClick={() => audioFileRef.current?.click()}
                                  disabled={audioUploading}
                                  className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-orange-300 bg-white text-orange-600 text-xs font-semibold hover:bg-orange-50 transition-all w-full justify-center disabled:opacity-50"
                                >
                                  <Upload size={14} /> Choose .mp3 or .wav
                                </button>
                              ) : (
                                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-slate-200 text-sm">
                                  <span className="text-lg">🎵</span>
                                  <span className="font-medium text-slate-700 truncate flex-1">{audioFileName}</span>
                                  <span className="text-slate-400 text-xs shrink-0">{audioFileSize}</span>
                                  {!audioUploading && !customAudioUrl && (
                                    <button onClick={() => audioFileRef.current?.click()} className="text-orange-500 hover:text-orange-700 ml-1">
                                      <Upload size={13} />
                                    </button>
                                  )}
                                </div>
                              )}

                              {/* Upload progress bar */}
                              {audioUploading && (
                                <div className="space-y-1">
                                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                                    <div
                                      className="h-full bg-orange-400 transition-all duration-300 ease-out rounded-full"
                                      style={{ width: `${audioUploadProgress}%` }}
                                    />
                                  </div>
                                  <p className="text-xs text-slate-400">Uploading… {audioUploadProgress}%</p>
                                </div>
                              )}

                              {/* Success */}
                              {customAudioUrl && !audioUploading && (
                                <p className="text-xs font-semibold text-green-600 flex items-center gap-1">
                                  <Check size={12} /> Uploaded successfully
                                </p>
                              )}

                              {/* Error */}
                              {audioUploadError && (
                                <p className="text-xs text-red-500">{audioUploadError}</p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                  </div>
                </div>
              )}

              {/* 6. Sprint Image */}
              {selectedSprintId && (
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 block">
                    6. Sprint Image (for email hero)
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

              {/* 7. Dispatch Scheduling */}
              {selectedSprintId && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-2">
                      <Calendar size={14} />
                      7. Dispatch Scheduling
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

                      {/* Mode toggle: Once vs Recurring — One-time hidden */}
                      {/* <div className="inline-flex rounded-full bg-slate-200 p-1 gap-1">
                        <button
                          onClick={() => setScheduleMode('once')}
                          className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all ${
                            scheduleMode === 'once'
                              ? 'bg-white shadow text-slate-800'
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          One-time
                        </button>
                        <button
                          onClick={() => setScheduleMode('recurring')}
                          className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-all flex items-center gap-1.5 ${
                            scheduleMode === 'recurring'
                              ? 'bg-white shadow text-slate-800'
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          <RefreshCw size={11} /> Recurring
                        </button>
                      </div> */}

                      {/* ONE-TIME: date + time */}
                      {scheduleMode === 'once' && (
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
                      )}

                      {/* RECURRING: days of week + time */}
                      {scheduleMode === 'recurring' && (() => {
                        const days = [
                          { key: 'Mon', label: 'Mon' },
                          { key: 'Tue', label: 'Tue' },
                          { key: 'Wed', label: 'Wed' },
                          { key: 'Thu', label: 'Thu' },
                          { key: 'Fri', label: 'Fri' },
                          { key: 'Sat', label: 'Sat' },
                          { key: 'Sun', label: 'Sun' },
                        ];
                        const toggleDay = (key: string) => {
                          setSelectedDays((prev) =>
                            prev.includes(key) ? prev.filter((d) => d !== key) : [...prev, key]
                          );
                        };
                        return (
                          <div className="space-y-4">
                            <div>
                              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 block">
                                Days of Week
                              </label>
                              <div className="flex gap-1.5 flex-wrap">
                                {days.map((d) => (
                                  <button
                                    key={d.key}
                                    onClick={() => toggleDay(d.key)}
                                    className={`w-11 h-11 rounded-xl text-xs font-bold transition-all border-2 ${
                                      selectedDays.includes(d.key)
                                        ? 'bg-blue-500 border-blue-500 text-white shadow'
                                        : 'bg-white border-slate-200 text-slate-500 hover:border-blue-300 hover:text-blue-500'
                                    }`}
                                  >
                                    {d.label}
                                  </button>
                                ))}
                              </div>
                              {selectedDays.length > 0 && (
                                <p className="text-xs text-blue-600 font-semibold mt-2">
                                  Sends every: {selectedDays.join(', ')}
                                </p>
                              )}
                            </div>
                            <div>
                              <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 block">
                                Time (your local time)
                              </label>
                              <div className="relative w-44">
                                <Clock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                                <input
                                  type="time"
                                  value={recurringTime}
                                  onChange={(e) => setRecurringTime(e.target.value)}
                                  className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium focus:outline-none focus:border-blue-500"
                                />
                              </div>
                              {recurringTime && (
                                <p className="text-xs text-slate-400 mt-1.5">
                                  Emails will be sent at <span className="font-semibold text-slate-600">{recurringTime} IST</span>
                                </p>
                              )}
                            </div>

                            {/* ── Stagger preview (multi-module) ── */}
                            {selectedSubModuleIds.length >= 2 && selectedDays.length > 0 && (() => {
                              // Mirror exactly what handleScheduleMultiModule sends to the backend:
                              // 1. Convert local recurringTime → UTC HH:MM
                              // 2. Use UTC HH:MM for date arithmetic (same as Python _next_weekday)
                              const [lh, lm] = recurringTime.split(':').map(Number);
                              const localDate = new Date();
                              localDate.setHours(lh, lm, 0, 0);
                              const utcH = localDate.getUTCHours();
                              const utcM = localDate.getUTCMinutes();

                              // Python weekday: Mon=0 … Sun=6  (same as JS getUTCDay offset below)
                              const dayMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
                              // JS getUTCDay: Sun=0, Mon=1 … Sat=6  → map to Python weekday
                              const jsDayToPython: Record<number, number> = { 0: 6, 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, 6: 5 };

                              const targetPythonDay = dayMap[selectedDays[0]] ?? 0;

                              const getNextWeekday = (offset: number): Date => {
                                const now = new Date();
                                // Build today's candidate at utcH:utcM UTC
                                const candidate = new Date(Date.UTC(
                                  now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
                                  utcH, utcM, 0
                                ));
                                const currentPythonDay = jsDayToPython[now.getUTCDay()];
                                let daysAhead = (targetPythonDay - currentPythonDay + 7) % 7;
                                candidate.setUTCDate(candidate.getUTCDate() + daysAhead);
                                // If not strictly in the future, push one week
                                if (candidate <= now) candidate.setUTCDate(candidate.getUTCDate() + 7);
                                // Apply weekly offset for subsequent modules
                                candidate.setUTCDate(candidate.getUTCDate() + offset * 7);
                                return candidate;
                              };

                              const selectedModules = subModules.filter((m) =>
                                selectedSubModuleIds.includes(m.processed_module_id)
                              );
                              const istTimeLabel = `${recurringTime} IST`;

                              return (
                                <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 overflow-hidden">
                                  <div className="px-4 py-2.5 bg-blue-500 flex items-center gap-2">
                                    <Calendar size={14} className="text-white" />
                                    <span className="text-xs font-bold text-white uppercase tracking-wide">
                                      Staggered Send Plan — {selectedModules.length} modules
                                    </span>
                                  </div>
                                  <div className="divide-y divide-blue-100">
                                    {selectedModules.map((mod, idx) => {
                                      const runDate = getNextWeekday(idx);
                                      const dateLabel = runDate.toLocaleDateString('en-GB', {
                                        weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
                                      });
                                      return (
                                        <div key={mod.processed_module_id} className="flex items-center gap-3 px-4 py-2.5">
                                          <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center text-[11px] font-bold text-white shrink-0">
                                            {idx + 1}
                                          </div>
                                          <span className="text-sm font-semibold text-slate-800 flex-1 truncate">
                                            {mod.title}
                                          </span>
                                          <span className="text-xs font-semibold text-blue-700 shrink-0">
                                            {dateLabel} · {istTimeLabel}
                                          </span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                  <div className="px-4 py-2 bg-blue-50 border-t border-blue-100">
                                    <p className="text-[11px] text-blue-500">
                                      Each module's flashcards will be sent on successive {selectedDays[0]}s at {istTimeLabel}, one week apart.
                                    </p>
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })()}

                    </div>
                  )}
                </div>
              )}

              {/* Draft Button — always visible so admin can preview the email */}
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
                      <Mail size={18} />
                      Draft Email Snippet
                    </>
                  )}
                </button>
              )}

              {/* Multi-module stagger schedule button — shown alongside Draft when applicable */}
              {canDraft && scheduleEnabled && scheduleMode === 'recurring' && selectedSubModuleIds.length >= 2 && selectedDays.length > 0 && (
                <button
                  onClick={handleScheduleMultiModule}
                  disabled={sending}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-bold py-3.5 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-500/30"
                >
                  {sending ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      Scheduling…
                    </>
                  ) : (
                    <>
                      <Calendar size={18} />
                      Schedule Staggered Send ({selectedSubModuleIds.length} modules)
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
                <h3 className="text-lg font-bold text-slate-900 mb-4">Email Draft</h3>

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
                    {/* Subject — always editable */}
                    <div>
                      <label className="text-xs font-semibold text-slate-500 uppercase mb-1 block">Subject</label>
                      <input
                        type="text"
                        value={isEditingEmail ? editSubject : draftedEmail.subject}
                        onChange={(e) =>
                          isEditingEmail
                            ? setEditSubject(e.target.value)
                            : setDraftedEmail({ ...draftedEmail, subject: e.target.value })
                        }
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm font-semibold text-slate-800 focus:outline-none focus:border-blue-500"
                      />
                    </div>

                    {/* Body — iframe in preview mode, textarea in edit mode */}
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs font-semibold text-slate-500 uppercase">Body</label>
                        <div className="flex items-center gap-2">
                          {isEditingEmail ? (
                            <>
                              <button
                                onClick={handleCancelEdit}
                                className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold text-slate-500 border border-slate-200 bg-white hover:border-slate-300 transition-all"
                              >
                                <X size={12} /> Cancel
                              </button>
                              <button
                                onClick={handleSaveEdit}
                                className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold text-white bg-blue-500 hover:bg-blue-600 transition-all"
                              >
                                <Check size={12} /> Save
                              </button>
                            </>
                          ) : (
                            <button
                              onClick={handleEnterEditMode}
                              className="flex items-center gap-1 px-3 py-1 rounded-lg text-xs font-semibold text-slate-600 border border-slate-200 bg-white hover:border-blue-400 hover:text-blue-600 transition-all"
                            >
                              <Pencil size={12} /> Edit
                            </button>
                          )}
                        </div>
                      </div>

                      {isEditingEmail ? (
                        <div className="space-y-2">
                          <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                            ✏️ Edit the email text below. Each paragraph on a new blank line will appear as a separate paragraph in the email. Flashcards and audio blocks are kept automatically.
                          </p>
                          <textarea
                            value={editBodyText}
                            onChange={(e) => setEditBodyText(e.target.value)}
                            placeholder="Write your email message here…&#10;&#10;Use a blank line between paragraphs."
                            className="w-full rounded-lg border border-blue-300 bg-white text-sm text-slate-800 focus:outline-none focus:border-blue-500 resize-y leading-relaxed p-4"
                            style={{ height: '400px', minHeight: '200px', fontFamily: 'inherit' }}
                            spellCheck={true}
                          />
                        </div>
                      ) : (
                        <iframe
                          srcDoc={draftedEmail.body}
                          className="w-full rounded-lg border border-slate-200 bg-white"
                          style={{ height: '600px' }}
                          sandbox="allow-same-origin allow-scripts"
                          title="Email Preview"
                        />
                      )}
                    </div>

                    {/* Send button only (no Regenerate) */}
                    <div className="pt-2">
                      <button
                        onClick={handleSendEmail}
                        disabled={sending || assignedUsers.length === 0 || isEditingEmail}
                        className="w-full py-3 rounded-xl bg-green-500 hover:bg-green-600 disabled:bg-green-300 text-white font-bold transition-all flex items-center justify-center gap-2 text-sm shadow-lg shadow-green-500/30"
                      >
                        {sending ? (
                          <>
                            <Loader2 size={16} className="animate-spin" />
                            {scheduleEnabled && scheduleMode === 'recurring' ? 'Saving…' : scheduleEnabled ? 'Scheduling…' : 'Sending…'}
                          </>
                        ) : scheduleEnabled && scheduleMode === 'recurring' ? (
                          <>
                            <RefreshCw size={16} /> Save Recurring Schedule ({assignedUsers.length})
                          </>
                        ) : scheduleEnabled ? (
                          <>
                            <Calendar size={16} /> Schedule Email ({assignedUsers.length})
                          </>
                        ) : (
                          <>
                            <Send size={16} /> Send Email ({assignedUsers.length})
                          </>
                        )}
                      </button>
                      {isEditingEmail && (
                        <p className="text-xs text-center text-slate-500 mt-2 font-medium">
                          Click <span className="font-bold text-blue-600">Save</span> above to apply your edits, then send.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Send Result */}
              {sendResult && (
                <div className={`rounded-xl p-5 border-2 ${
                  sendResult.status === 'scheduled' || sendResult.status === 'saved_recurring'
                    ? 'bg-blue-50 border-blue-200'
                    : (sendResult.failed?.length ?? 0) === 0
                      ? 'bg-green-50 border-green-200'
                      : 'bg-yellow-50 border-yellow-200'
                }`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
                      sendResult.status === 'scheduled' || sendResult.status === 'saved_recurring'
                        ? 'bg-blue-500'
                        : (sendResult.failed?.length ?? 0) === 0
                          ? 'bg-green-500'
                          : 'bg-yellow-500'
                    }`}>
                      {sendResult.status === 'scheduled' ? (
                        <Calendar size={20} className="text-white" />
                      ) : sendResult.status === 'saved_recurring' ? (
                        <RefreshCw size={20} className="text-white" />
                      ) : (sendResult.failed?.length ?? 0) === 0 ? (
                        <Check size={20} className="text-white" />
                      ) : (
                        <AlertCircle size={20} className="text-white" />
                      )}
                    </div>
                    <div>
                      {sendResult.status === 'scheduled' ? (
                        <>
                          <h4 className="font-bold text-slate-900 text-sm">
                            Email scheduled for {sendResult.recipient_count} recipient{sendResult.recipient_count !== 1 ? 's' : ''}
                          </h4>
                          <p className="text-xs text-slate-500 mt-1">
                            Delivery time: {sendResult.scheduled_at ? new Date(sendResult.scheduled_at).toLocaleString() : '—'}
                          </p>
                        </>
                      ) : sendResult.status === 'saved_recurring' ? (
                        <>
                          <h4 className="font-bold text-slate-900 text-sm">
                            Recurring schedule saved for {sendResult.recipient_count} recipient{sendResult.recipient_count !== 1 ? 's' : ''}
                          </h4>
                          <p className="text-xs text-slate-500 mt-1">
                            Sends every: {sendResult.days_of_week?.join(', ')} at {sendResult.scheduled_time} UTC
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            Schedule ID: <code className="bg-slate-100 px-1 rounded">{sendResult.scheduled_emails_id}</code>
                          </p>
                        </>
                      ) : (
                        <>
                          <h4 className="font-bold text-slate-900 text-sm">{sendResult.message}</h4>
                          {(sendResult.failed?.length ?? 0) > 0 && (
                            <div className="mt-2">
                              <p className="text-xs font-semibold text-red-600 mb-1">Failed to deliver to:</p>
                              {sendResult.failed!.map((email) => (
                                <p key={email} className="text-xs text-red-500">{email}</p>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <button onClick={() => setSendResult(null)} className="ml-auto text-slate-400 hover:text-slate-600">
                      <X size={16} />
                    </button>
                  </div>
                </div>
              )}

              {/* Multi-module stagger result */}
              {multiModuleResult && (
                <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50 overflow-hidden">
                  <div className="flex items-center justify-between px-5 py-3 bg-indigo-500">
                    <div className="flex items-center gap-2">
                      <Calendar size={16} className="text-white" />
                      <span className="text-sm font-bold text-white">
                        Staggered Schedule Confirmed — {multiModuleResult.total_modules} modules
                      </span>
                    </div>
                    <button onClick={() => setMultiModuleResult(null)} className="text-indigo-200 hover:text-white">
                      <X size={16} />
                    </button>
                  </div>
                  <div className="divide-y divide-indigo-100">
                    {multiModuleResult.jobs.map((job) => (
                      <div key={job.job_id ?? job.module_id} className="flex items-center gap-3 px-5 py-3">
                        <div className="w-7 h-7 rounded-full bg-indigo-500 flex items-center justify-center text-xs font-bold text-white shrink-0">
                          {job.week}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">{job.module_title}</p>
                          <p className="text-xs text-slate-500">
                            {new Date(job.run_date).toLocaleDateString('en-GB', {
                              weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata',
                            })} · {new Date(job.run_date).toLocaleTimeString('en-GB', {
                              hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata',
                            })} IST · {job.recipient_count} recipient{job.recipient_count !== 1 ? 's' : ''}
                          </p>
                          {job.warning && (
                            <p className="text-xs text-amber-600 font-medium mt-0.5">⚠ {job.warning}</p>
                          )}
                        </div>
                        {job.job_id ? (
                          <Check size={16} className="text-indigo-500 shrink-0" />
                        ) : (
                          <AlertCircle size={16} className="text-amber-400 shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>
                  <div className="px-5 py-2.5 bg-indigo-50 border-t border-indigo-100">
                    <p className="text-xs text-indigo-600 font-medium">
                      Each module's flashcard email will be sent on successive {multiModuleResult.scheduled_day}s at {recurringTime} IST.
                    </p>
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
