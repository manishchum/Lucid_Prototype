'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Plus,
  Search,
  Edit3,
  Trash2,
  Copy,
  Check,
  Eye,
  Bell,
  Sparkles,
  X,
  ChevronDown,
  CheckCircle2,
  AlertCircle,
  Smartphone,
  ExternalLink,
  Filter,
  RefreshCw,
  Layers,
  GraduationCap,
  BookOpen,
  Flame,
  Award,
  Users,
  Compass,
  Radio,
  FileText,
  Megaphone,
} from 'lucide-react';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import { useAuth } from '@/contexts/auth-context';

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

export interface NotificationTemplate {
  id: string;
  template_name?: string;
  notification_type: string;
  category: string;
  channel: string;
  title_template: string;
  body_template: string;
  cta_label?: string;
  cta_url?: string;
  fallback_defaults?: Record<string, any>;
  version: number;
  status: 'DRAFT' | 'VALIDATED' | 'PUBLISHED' | 'ARCHIVED';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export const PREDEFINED_CATEGORIES = [
  { id: 'ANNOUNCEMENTS_INFO', label: 'Announcements & Info', icon: Megaphone, color: 'text-sky-600 bg-sky-50 border-sky-200' },
  { id: 'ONBOARDING', label: 'User Onboarding', icon: Users, color: 'text-emerald-600 bg-emerald-50 border-emerald-200' },
  { id: 'SPRINT_ASSIGNMENT', label: 'Sprint Assignment', icon: BookOpen, color: 'text-blue-600 bg-blue-50 border-blue-200' },
  { id: 'QUIZZES', label: 'Quizzes', icon: GraduationCap, color: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
  { id: 'GAMIFICATION', label: 'Gamification Arena', icon: Flame, color: 'text-amber-600 bg-amber-50 border-amber-200' },
  { id: 'DEADLINES', label: 'Deadlines', icon: Bell, color: 'text-rose-600 bg-rose-50 border-rose-200' },
  { id: 'TASKS', label: 'Tasks', icon: Layers, color: 'text-purple-600 bg-purple-50 border-purple-200' },
  { id: 'RE_ENGAGEMENT', label: 'Re-engagement Nudges', icon: Compass, color: 'text-cyan-600 bg-cyan-50 border-cyan-200' },
  { id: 'ROLEPLAY', label: 'Roleplay', icon: Award, color: 'text-violet-600 bg-violet-50 border-violet-200' },
  { id: 'CONTENT_LIBRARY', label: 'Content Library', icon: Radio, color: 'text-pink-600 bg-pink-50 border-pink-200' },
  { id: 'REPORTS', label: 'Reports', icon: FileText, color: 'text-slate-600 bg-slate-100 border-slate-200' },
];

export const SMART_TAG_NAMESPACES = [
  {
    namespace: 'system',
    label: 'System & Announcement',
    tags: [
      { key: 'system.title', label: 'Announcement Title', sample: 'Company All-Hands Scheduled' },
      { key: 'system.message', label: 'Message Text', sample: 'Please join us today at 3 PM for our quarterly update.' },
      { key: 'system.version', label: 'App Version', sample: 'v2.4.0' },
      { key: 'system.action_url', label: 'Action Deep Link', sample: '/employee/dashboard' },
      { key: 'system.timestamp', label: 'Dispatch Timestamp', sample: 'Today at 3:00 PM' },
      { key: 'custom.event_payload', label: 'Custom Hook Payload', sample: '{"status": "active"}' },
    ],
  },
  {
    namespace: 'subscriber',
    label: 'Learner Identity',
    tags: [
      { key: 'subscriber.first_name', label: 'First Name', sample: 'Alex' },
      { key: 'subscriber.full_name', label: 'Full Name', sample: 'Alex Mercer' },
      { key: 'subscriber.company_name', label: 'Company Name', sample: 'Acme Corp' },
      { key: 'subscriber.manager_name', label: 'Manager Name', sample: 'Sarah Connor' },
      { key: 'subscriber.role', label: 'Role / Designation', sample: 'Product Designer' },
      { key: 'subscriber.department', label: 'Department', sample: 'Core Engineering' },
    ],
  },
  {
    namespace: 'assessment',
    label: 'Assessment & Quizzes',
    tags: [
      { key: 'assessment.score', label: 'Score (%)', sample: '68%' },
      { key: 'assessment.passing_score', label: 'Passing Score', sample: '70%' },
      { key: 'assessment.confidence_score', label: 'Confidence Score (%)', sample: '85%' },
      { key: 'assessment.weak_topic', label: 'Weak Spot Topic', sample: 'Prompt Engineering' },
      { key: 'assessment.remediation_module', label: 'Remediation Module', sample: 'Advanced Prompting Micro-Drill' },
      { key: 'assessment.feedback_summary', label: 'AI Feedback Summary', sample: 'Strong conceptual grasp, needs practice on temperature tuning.' },
      { key: 'assessment.attempt_number', label: 'Attempt #', sample: '2' },
    ],
  },
  {
    namespace: 'curriculum',
    label: 'Curriculum & Sprints',
    tags: [
      { key: 'curriculum.module_name', label: 'Module / Sprint Title', sample: 'Sprint 2: Async Workflows' },
      { key: 'curriculum.due_date', label: 'Due Date', sample: 'Friday, Oct 24' },
      { key: 'curriculum.days_left', label: 'Days Remaining', sample: '2' },
      { key: 'curriculum.progress_percentage', label: 'Progress (%)', sample: '45%' },
      { key: 'curriculum.minutes_remaining', label: 'Estimated Mins Left', sample: '18' },
      { key: 'curriculum.action_url', label: 'Action Deep Link', sample: '/employee/modules/sprint-2' },
    ],
  },
  {
    namespace: 'gamification',
    label: 'Gamification & Streaks',
    tags: [
      { key: 'gamification.streak_days', label: 'Streak Days', sample: '5' },
      { key: 'gamification.xp_points', label: 'XP Points Earned', sample: '250' },
      { key: 'gamification.earned_xp', label: 'Earned XP', sample: '100 XP' },
      { key: 'gamification.leaderboard_rank', label: 'Leaderboard Rank', sample: '3' },
      { key: 'gamification.rival_name', label: 'Rival Competitor', sample: 'Jordan Hayes' },
      { key: 'gamification.points_to_next_rank', label: 'Points to Next Rank', sample: '45 XP' },
      { key: 'gamification.badge_name', label: 'Unlocked Badge', sample: 'Lightning Fast' },
      { key: 'gamification.streak_expiring_hours', label: 'Hours to Streak Expiry', sample: '4' },
    ],
  },
  {
    namespace: 'task',
    label: 'Workplace Tasks',
    tags: [
      { key: 'task.task_title', label: 'Task Title', sample: 'Customer Journey Map Review' },
      { key: 'task.due_date', label: 'Task Deadline', sample: 'Tomorrow at 5 PM' },
      { key: 'task.feedback_summary', label: 'Task Review Summary', sample: 'Clear stakeholder mapping.' },
      { key: 'task.task_status', label: 'Status', sample: 'Pending Review' },
    ],
  },
  {
    namespace: 'content',
    label: 'Content Library & Reports',
    tags: [
      { key: 'recommendations.content_name', label: 'Content Item Name', sample: 'Prompt Engineering Field Guide' },
      { key: 'recommendations.content_type', label: 'Content Type', sample: 'Audio Drill' },
    ],
  },
  {
    namespace: 'vark',
    label: 'VARK Learning Modality',
    tags: [
      { key: 'vark.primary_style', label: 'Dominant Modality', sample: 'Auditory' },
      { key: 'vark.recommended_cta_label', label: 'Personalized CTA Label', sample: 'Listen to 3-Min Audio Drill' },
      { key: 'vark.recommended_cta_url', label: 'Personalized CTA Link', sample: '/employee/podcast/recap' },
    ],
  },
];

export default function TemplateManagerTab() {
  const { user, employeeData } = useAuth();
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<NotificationTemplate | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Form Fields
  const [formCategory, setFormCategory] = useState<string>('ANNOUNCEMENTS_INFO');
  const [formName, setFormName] = useState('');
  const [formType, setFormType] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formBody, setFormBody] = useState('');
  const [formCtaLabel, setFormCtaLabel] = useState('');
  const [formCtaUrl, setFormCtaUrl] = useState('');
  const [formFallbackName, setFormFallbackName] = useState('Learner');

  // Smart Tag Dropdown
  const [tagPickerTarget, setTagPickerTarget] = useState<'title' | 'body' | null>(null);
  const [tagSearch, setTagSearch] = useState('');
  const [tagNamespaceFilter, setTagNamespaceFilter] = useState('ALL');
  const tagPickerRef = useRef<HTMLDivElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const bodyInputRef = useRef<HTMLTextAreaElement>(null);

  // Fetch templates
  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/templates`);
      if (res.ok) {
        const data = await res.json();
        setTemplates(data.templates || []);
      }
    } catch (err) {
      console.error('Failed to load templates:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
  }, []);

  // Close tag picker on outside click
  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (tagPickerRef.current && !tagPickerRef.current.contains(e.target as Node)) {
        setTagPickerTarget(null);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  // Open Create Modal
  const handleOpenCreate = () => {
    setEditingTemplate(null);
    setFormCategory('ANNOUNCEMENTS_INFO');
    setFormName('');
    setFormType('');
    setFormTitle('');
    setFormBody('');
    setFormCtaLabel('');
    setFormCtaUrl('');
    setFormFallbackName('Learner');
    setModalError(null);
    setIsModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEdit = (t: NotificationTemplate) => {
    setEditingTemplate(t);
    setFormCategory(t.category || 'ANNOUNCEMENTS_INFO');
    setFormName(t.template_name || t.notification_type || '');
    setFormType(t.notification_type || '');
    setFormTitle(t.title_template || '');
    setFormBody(t.body_template || '');
    setFormCtaLabel(t.cta_label || '');
    setFormCtaUrl(t.cta_url || '');
    setFormFallbackName(t.fallback_defaults?.['subscriber.first_name'] || 'Learner');
    setModalError(null);
    setIsModalOpen(true);
  };

  // Insert Smart Tag at cursor
  const handleInsertTag = (tagKey: string) => {
    const tagToken = `{{${tagKey}}}`;
    if (tagPickerTarget === 'title') {
      const el = titleInputRef.current;
      if (el) {
        const start = el.selectionStart || 0;
        const end = el.selectionEnd || 0;
        const updated = formTitle.substring(0, start) + tagToken + formTitle.substring(end);
        setFormTitle(updated);
        setTimeout(() => {
          el.focus();
          el.setSelectionRange(start + tagToken.length, start + tagToken.length);
        }, 50);
      } else {
        setFormTitle((prev) => prev + tagToken);
      }
    } else if (tagPickerTarget === 'body') {
      const el = bodyInputRef.current;
      if (el) {
        const start = el.selectionStart || 0;
        const end = el.selectionEnd || 0;
        const updated = formBody.substring(0, start) + tagToken + formBody.substring(end);
        setFormBody(updated);
        setTimeout(() => {
          el.focus();
          el.setSelectionRange(start + tagToken.length, start + tagToken.length);
        }, 50);
      } else {
        setFormBody((prev) => prev + tagToken);
      }
    }
    setTagPickerTarget(null);
  };

  // Save / Update Template
  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim() || !formBody.trim()) {
      setModalError('Message Title and Message Body are required.');
      return;
    }

    const typeSlug =
      formType.trim() ||
      formName
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') ||
      'CUSTOM_TEMPLATE';

    setSaving(true);
    setModalError(null);

    const payload = {
      notification_type: typeSlug,
      template_name: formName.trim() || typeSlug,
      category: formCategory,
      channel: 'ALL', // Strictly channel-agnostic template copy
      title_template: formTitle.trim(),
      body_template: formBody.trim(),
      cta_label: formCtaLabel.trim() || null,
      cta_url: formCtaUrl.trim() || null,
      fallback_defaults: {
        'subscriber.first_name': formFallbackName.trim() || 'Learner',
        'system.title': 'Important Announcement',
        'system.message': 'Please check your dashboard for details.',
      },
      status: 'PUBLISHED',
      is_active: true,
    };

    try {
      const url = editingTemplate
        ? `${API_BASE}/api/notifications/templates/${editingTemplate.id}`
        : `${API_BASE}/api/notifications/templates`;
      const method = editingTemplate ? 'PUT' : 'POST';

      const res = await fetchWithAuth(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        let errorMsg = 'Failed to save template';
        if (err.detail) {
          if (typeof err.detail === 'string') {
            errorMsg = err.detail;
          } else if (err.detail.hard_errors && Array.isArray(err.detail.hard_errors) && err.detail.hard_errors.length > 0) {
            errorMsg = `${err.detail.message || 'Validation error'}: ${err.detail.hard_errors.join('; ')}`;
          } else if (err.detail.message) {
            errorMsg = err.detail.message;
          }
        }
        throw new Error(errorMsg);
      }

      await fetchTemplates();
      setIsModalOpen(false);
      // Reset filter so newly created/updated template is immediately visible at the top
      setSelectedCategory('ALL');
      setSearchQuery('');
      setSuccessToast(`Template "${payload.template_name}" ${editingTemplate ? 'updated' : 'created'} successfully!`);
      setTimeout(() => setSuccessToast(null), 5000);
    } catch (err: any) {
      setModalError(err.message || 'An error occurred while saving.');
    } finally {
      setSaving(false);
    }
  };

  // Delete Template
  const handleDeleteTemplate = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to delete template "${name}"?`)) return;
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/templates/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setTemplates((prev) => prev.filter((t) => t.id !== id));
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  // Real-Time Live Preview Interpolation with Current Logged-in User
  const loggedInFirstName =
    employeeData?.name?.split(' ')[0] || user?.displayName?.split(' ')[0] || 'Learner';
  const loggedInFullName = employeeData?.name || user?.displayName || 'Learner User';
  const loggedInCompany = employeeData?.company_name || 'Acme Learning';

  const previewTitle = (formTitle || 'Notification Title')
    .replace(/\{\{subscriber\.first_name\}\}/g, loggedInFirstName)
    .replace(/\{\{subscriber\.full_name\}\}/g, loggedInFullName)
    .replace(/\{\{subscriber\.company_name\}\}/g, loggedInCompany)
    .replace(/\{\{system\.title\}\}/g, 'Quarterly Product & Learning All-Hands')
    .replace(/\{\{system\.message\}\}/g, 'Please join us today at 3:00 PM for our live roadmap update.')
    .replace(/\{\{system\.version\}\}/g, 'v2.4.0')
    .replace(/\{\{system\.action_url\}\}/g, '/employee/dashboard')
    .replace(/\{\{system\.timestamp\}\}/g, 'Today at 3:00 PM')
    .replace(/\{\{custom\.event_payload\}\}/g, '{"status": "active"}')
    .replace(/\{\{recommendations\.content_name\}\}/g, 'Prompt Engineering Field Guide')
    .replace(/\{\{assessment\.score\}\}/g, '68%')
    .replace(/\{\{assessment\.weak_topic\}\}/g, 'Prompt Engineering')
    .replace(/\{\{curriculum\.module_name\}\}/g, 'Sprint 2: Async Workflows')
    .replace(/\{\{gamification\.streak_days\}\}/g, '5')
    .replace(/\{\{gamification\.xp_points\}\}/g, '250')
    .replace(/\{\{.*?\}\}/g, 'sample_value');

  const previewBody = (formBody || 'Notification message body will appear here...')
    .replace(/\{\{subscriber\.first_name\}\}/g, loggedInFirstName)
    .replace(/\{\{subscriber\.full_name\}\}/g, loggedInFullName)
    .replace(/\{\{subscriber\.company_name\}\}/g, loggedInCompany)
    .replace(/\{\{system\.title\}\}/g, 'Quarterly Product & Learning All-Hands')
    .replace(/\{\{system\.message\}\}/g, 'Please join us today at 3:00 PM for our live roadmap update.')
    .replace(/\{\{system\.version\}\}/g, 'v2.4.0')
    .replace(/\{\{system\.action_url\}\}/g, '/employee/dashboard')
    .replace(/\{\{system\.timestamp\}\}/g, 'Today at 3:00 PM')
    .replace(/\{\{custom\.event_payload\}\}/g, '{"status": "active"}')
    .replace(/\{\{recommendations\.content_name\}\}/g, 'Prompt Engineering Field Guide')
    .replace(/\{\{assessment\.score\}\}/g, '68%')
    .replace(/\{\{assessment\.weak_topic\}\}/g, 'Prompt Engineering')
    .replace(/\{\{curriculum\.module_name\}\}/g, 'Sprint 2: Async Workflows')
    .replace(/\{\{gamification\.streak_days\}\}/g, '5')
    .replace(/\{\{gamification\.xp_points\}\}/g, '250')
    .replace(/\{\{.*?\}\}/g, 'sample_value');

  // Filter templates
  const filteredTemplates = templates.filter((t) => {
    const matchesCat = selectedCategory === 'ALL' || t.category === selectedCategory;
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !searchQuery ||
      (t.template_name && t.template_name.toLowerCase().includes(q)) ||
      (t.notification_type && t.notification_type.toLowerCase().includes(q)) ||
      (t.title_template && t.title_template.toLowerCase().includes(q)) ||
      (t.body_template && t.body_template.toLowerCase().includes(q));
    return matchesCat && matchesSearch;
  });

  return (
    <div className="space-y-6">
      {/* ─── TOP ACTION BAR ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <span>Notification Templates Catalog</span>
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
              {templates.length} Active
            </span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Channel-agnostic copy assets. Choose channels when building workflows. Auto-versioned on edit.
          </p>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <button
            type="button"
            onClick={fetchTemplates}
            className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors cursor-pointer"
            title="Refresh templates"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>

          <button
            type="button"
            onClick={handleOpenCreate}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-semibold shadow-xs hover:shadow-sm transition-all cursor-pointer"
          >
            <Plus size={15} />
            <span>Create Template</span>
          </button>
        </div>
      </div>

      {/* ─── SUCCESS TOAST BANNER ─────────────────────────────────── */}
      {successToast && (
        <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center justify-between shadow-2xs animate-in fade-in duration-200">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
            <span>{successToast}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessToast(null)}
            className="text-emerald-600 hover:text-emerald-800 p-1 cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* ─── SEARCH & CATEGORY FILTER BAR ──────────────────────────── */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search templates by notification type, title, or body keywords..."
            className="w-full pl-10 pr-9 py-2 bg-slate-50 hover:bg-slate-100/70 focus:bg-white rounded-xl border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-all font-medium"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded-full cursor-pointer transition-colors"
              title="Clear search"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Category Filter Dropdown */}
        <div className="flex items-center gap-1.5 px-3 py-2 bg-white rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:border-slate-300 transition-colors shrink-0">
          <Filter size={13} className="text-slate-400 shrink-0" />
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="bg-transparent text-xs font-semibold text-slate-700 focus:outline-none cursor-pointer pr-4"
          >
            <option value="ALL">All Categories ({templates.length})</option>
            {PREDEFINED_CATEGORIES.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.label} ({templates.filter((t) => t.category === cat.id).length})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ─── TEMPLATES DATA GRID ───────────────────────────────────── */}
      {loading ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-slate-200">
          <RefreshCw size={24} className="mx-auto text-indigo-600 animate-spin mb-3" />
          <p className="text-xs font-semibold text-slate-600">Loading notification copy catalog...</p>
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className="p-12 text-center bg-white rounded-2xl border border-slate-200">
          <Bell size={28} className="mx-auto text-slate-300 mb-3" />
          <h3 className="text-sm font-bold text-slate-700">No templates found</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            {searchQuery
              ? `No templates matched "${searchQuery}". Try clearing your search.`
              : 'Start by creating your first reusable notification template for automated workflows.'}
          </p>
          <button
            type="button"
            onClick={handleOpenCreate}
            className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition-all cursor-pointer"
          >
            Create Template Now
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredTemplates.map((t) => {
            const catMeta = PREDEFINED_CATEGORIES.find((c) => c.id === t.category) || {
              label: t.category || 'General',
              color: 'text-slate-600 bg-slate-100 border-slate-200',
              icon: Bell,
            };
            const CatIcon = catMeta.icon;

            return (
              <div
                key={t.id}
                className="group bg-white rounded-2xl border border-slate-200/90 hover:border-indigo-300 p-5 shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between"
              >
                <div>
                  {/* Card Header: Category & Version */}
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold border ${catMeta.color}`}
                    >
                      <CatIcon size={12} />
                      <span>{catMeta.label}</span>
                    </span>

                    <div className="flex items-center gap-1.5">
                      {t.created_at &&
                        Date.now() - new Date(t.created_at).getTime() < 1000 * 60 * 60 * 24 && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black tracking-wide bg-emerald-500 text-white shadow-2xs">
                            NEW
                          </span>
                        )}
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                        v{t.version || 1}
                      </span>
                    </div>
                  </div>

                  {/* Title & Slug */}
                  <h3 className="text-sm font-bold text-slate-900 group-hover:text-indigo-600 transition-colors line-clamp-1">
                    {t.template_name || t.notification_type}
                  </h3>
                  <p className="text-[11px] font-mono text-slate-400 mt-0.5 mb-3 line-clamp-1">
                    {t.notification_type}
                  </p>

                  {/* Message Title Preview */}
                  <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-100 mb-2">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                      Rendered Title
                    </div>
                    <p className="text-xs font-semibold text-slate-800 line-clamp-2">
                      {t.title_template || '(No title)'}
                    </p>
                  </div>

                  {/* Message Body Preview */}
                  <div className="bg-slate-50/80 rounded-xl p-3 border border-slate-100">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                      Message Body
                    </div>
                    <p className="text-xs text-slate-600 line-clamp-3 leading-relaxed">
                      {t.body_template}
                    </p>
                  </div>

                  {/* CTA link pill if exists */}
                  {t.cta_label && (
                    <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-medium text-indigo-600 bg-indigo-50/60 px-2.5 py-1 rounded-lg border border-indigo-100">
                      <ExternalLink size={12} />
                      <span>CTA: {t.cta_label}</span>
                    </div>
                  )}
                </div>

                {/* Card Footer Actions */}
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400">
                  <span>
                    Updated {new Date(t.updated_at || t.created_at).toLocaleDateString()}
                  </span>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleOpenEdit(t)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer"
                      title="Edit Template"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteTemplate(t.id, t.template_name || t.notification_type)}
                      className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                      title="Delete Template"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─── CREATE / EDIT TEMPLATE MODAL ──────────────────────────── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-4xl my-8 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-6 py-4.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center">
                  <Bell size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">
                    {editingTemplate
                      ? `Edit Template (v${editingTemplate.version})`
                      : 'Create Notification Template'}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    {editingTemplate
                      ? 'Saving will auto-increment to next published version'
                      : 'Standardized copy asset with live preview & smart tags'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body: Split 2 Columns (Left: Form, Right: Live Phone Preview) */}
            <form onSubmit={handleSaveTemplate}>
              <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-100">
                {/* ─── LEFT COLUMN: Inputs (7 Cols) ──────────────────── */}
                <div className="lg:col-span-7 p-6 space-y-4 max-h-[72vh] overflow-y-auto">
                  {modalError && (
                    <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                      <AlertCircle size={15} className="shrink-0" />
                      <span>{modalError}</span>
                    </div>
                  )}

                  {/* 1. Category / Domain */}
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1.5">
                      1. Event Domain / Category <span className="text-rose-500">*</span>
                    </label>
                    <select
                      value={formCategory}
                      onChange={(e) => setFormCategory(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                    >
                      {PREDEFINED_CATEGORIES.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.label} ({cat.id})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* 2. Template Name & Slug */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-bold text-slate-700 block mb-1.5">
                        Template Friendly Name <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={formName}
                        onChange={(e) => setFormName(e.target.value)}
                        placeholder="e.g. Quiz Remediation Nudge"
                        required
                        className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-slate-700 block mb-1.5">
                        Unique Slug / Identifier
                      </label>
                      <input
                        type="text"
                        value={formType}
                        onChange={(e) => setFormType(e.target.value)}
                        placeholder="e.g. QUIZ_REMEDIATION_NUDGE"
                        className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs font-mono text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                      />
                    </div>
                  </div>

                  {/* 3. Message Title */}
                  <div className="relative">
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-bold text-slate-700">
                        Message Title <span className="text-rose-500">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setTagPickerTarget(tagPickerTarget === 'title' ? null : 'title')
                        }
                        className="flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded-lg transition-colors cursor-pointer"
                      >
                        <Sparkles size={12} />
                        <span>Insert Smart Tag</span>
                      </button>
                    </div>
                    <input
                      ref={titleInputRef}
                      type="text"
                      value={formTitle}
                      onChange={(e) => setFormTitle(e.target.value)}
                      placeholder="e.g. {{subscriber.first_name}}, let's strengthen {{assessment.weak_topic}}"
                      required
                      className="w-full px-3.5 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                    />
                  </div>

                  {/* 4. Message Body */}
                  <div className="relative">
                    <div className="flex items-center justify-between mb-1.5">
                      <label className="text-xs font-bold text-slate-700">
                        Message Body <span className="text-rose-500">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={() =>
                          setTagPickerTarget(tagPickerTarget === 'body' ? null : 'body')
                        }
                        className="flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-2 py-0.5 rounded-lg transition-colors cursor-pointer"
                      >
                        <Sparkles size={12} />
                        <span>Insert Smart Tag</span>
                      </button>
                    </div>
                    <textarea
                      ref={bodyInputRef}
                      rows={4}
                      value={formBody}
                      onChange={(e) => setFormBody(e.target.value)}
                      placeholder="e.g. Hi {{subscriber.first_name}}, you scored {{assessment.score}} on your assessment. Review your tailored 3-minute practice drill to master this concept!"
                      required
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 leading-relaxed"
                    />
                  </div>

                  {/* 5. Optional Action CTA Button */}
                  <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3">
                    <div className="text-[11px] font-bold text-slate-700 flex items-center justify-between">
                      <span className="flex items-center gap-1.5">
                        <ExternalLink size={13} className="text-indigo-600" />
                        <span>Interactive Action Button (CTA) — Optional</span>
                      </span>
                      <span className="text-[10px] text-slate-400">Deep link for push & in-app</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                          Button Label
                        </label>
                        <input
                          type="text"
                          value={formCtaLabel}
                          onChange={(e) => setFormCtaLabel(e.target.value)}
                          placeholder="e.g. Start Practice Drill"
                          className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                          Target URL / Deep Link
                        </label>
                        <input
                          type="text"
                          value={formCtaUrl}
                          onChange={(e) => setFormCtaUrl(e.target.value)}
                          placeholder="e.g. {{curriculum.action_url}}"
                          className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 bg-white placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* 6. Fallback Default */}
                  <div>
                    <label className="text-xs font-bold text-slate-700 block mb-1">
                      Learner Fallback Name (if missing)
                    </label>
                    <input
                      type="text"
                      value={formFallbackName}
                      onChange={(e) => setFormFallbackName(e.target.value)}
                      placeholder="e.g. Learner"
                      className="w-full px-3.5 py-1.5 rounded-xl border border-slate-200 text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                    />
                  </div>
                </div>

                {/* ─── RIGHT COLUMN: Live Smartphone Preview (5 Cols) ─── */}
                <div className="lg:col-span-5 p-6 bg-slate-50/60 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                        <Smartphone size={15} className="text-indigo-600" />
                        <span>Live Real-Time Preview</span>
                      </span>
                      <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        Active User: {loggedInFirstName}
                      </span>
                    </div>

                    {/* Smartphone Mockup */}
                    <div className="max-w-[300px] mx-auto bg-slate-900 rounded-[36px] p-3 shadow-xl border-4 border-slate-800">
                      {/* Notch */}
                      <div className="w-24 h-4 bg-slate-800 rounded-full mx-auto mb-3" />

                      {/* Phone Screen Area */}
                      <div className="bg-gradient-to-b from-slate-100 to-slate-200 rounded-[28px] p-3.5 min-h-[320px] flex flex-col justify-start">
                        {/* Lockscreen Notification Bubble */}
                        <div className="bg-white/95 backdrop-blur-md rounded-2xl p-3.5 shadow-sm border border-slate-200/80 space-y-1.5">
                          {/* App Header */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <div className="w-4 h-4 rounded-md bg-indigo-600 flex items-center justify-center text-white text-[9px] font-black">
                                L
                              </div>
                              <span className="text-[10px] font-bold text-slate-700">
                                Lucid Learning
                              </span>
                            </div>
                            <span className="text-[9px] text-slate-400">now</span>
                          </div>

                          {/* Interpolated Title */}
                          <div className="text-xs font-bold text-slate-900 leading-snug">
                            {previewTitle}
                          </div>

                          {/* Interpolated Body */}
                          <div className="text-[11px] text-slate-600 leading-relaxed">
                            {previewBody}
                          </div>

                          {/* CTA Button */}
                          {formCtaLabel && (
                            <div className="pt-2">
                              <div className="w-full py-1.5 px-3 bg-indigo-600 rounded-lg text-white text-[11px] font-semibold text-center shadow-2xs">
                                {formCtaLabel}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* In-App Toast Simulation below */}
                        <div className="mt-4 p-2.5 rounded-xl bg-slate-900 text-white text-[10px] shadow-md flex items-center justify-between">
                          <span className="line-clamp-1">{previewTitle}</span>
                          <span className="text-indigo-400 font-semibold shrink-0 ml-2">Open</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <p className="text-[11px] text-center text-slate-400 mt-4">
                    Rendered live using your current authenticated profile details.
                  </p>
                </div>
              </div>

              {/* Modal Footer Actions */}
              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50/50 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs hover:shadow-sm transition-all cursor-pointer disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editingTemplate ? 'Publish New Version' : 'Create & Save Template'}
                </button>
              </div>
            </form>
          </div>

          {/* ─── SMART TAG FLOATING PICKER POPOVER ─────────────────── */}
          {tagPickerTarget && (
            <div
              ref={tagPickerRef}
              className="fixed z-60 bg-white rounded-2xl border border-slate-200 shadow-2xl w-80 max-h-[380px] p-3 flex flex-col top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 animate-in fade-in zoom-in-95 duration-100"
            >
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <Sparkles size={13} className="text-indigo-600" />
                  <span>Insert Smart Tag</span>
                </span>
                <button
                  type="button"
                  onClick={() => setTagPickerTarget(null)}
                  className="text-slate-400 hover:text-slate-600 p-1"
                >
                  <X size={14} />
                </button>
              </div>

              {/* Tag Search */}
              <div className="my-2">
                <input
                  type="text"
                  value={tagSearch}
                  onChange={(e) => setTagSearch(e.target.value)}
                  placeholder="Filter tags (e.g. score, name)..."
                  className="w-full px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  autoFocus
                />
              </div>

              {/* Tag List Grouped by Category */}
              <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                {SMART_TAG_NAMESPACES.map((group) => {
                  const filteredTags = group.tags.filter(
                    (t) =>
                      !tagSearch ||
                      t.key.toLowerCase().includes(tagSearch.toLowerCase()) ||
                      t.label.toLowerCase().includes(tagSearch.toLowerCase())
                  );
                  if (filteredTags.length === 0) return null;

                  return (
                    <div key={group.namespace}>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1">
                        {group.label}
                      </div>
                      <div className="space-y-1">
                        {filteredTags.map((tag) => (
                          <button
                            key={tag.key}
                            type="button"
                            onClick={() => handleInsertTag(tag.key)}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-indigo-50 border border-transparent hover:border-indigo-100 transition-colors flex items-center justify-between group cursor-pointer"
                          >
                            <div>
                              <div className="text-xs font-semibold text-slate-800 group-hover:text-indigo-600">
                                {tag.label}
                              </div>
                              <div className="text-[10px] font-mono text-slate-400">
                                {`{{${tag.key}}}`}
                              </div>
                            </div>
                            <span className="text-[10px] text-slate-400 italic">
                              "{tag.sample}"
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
