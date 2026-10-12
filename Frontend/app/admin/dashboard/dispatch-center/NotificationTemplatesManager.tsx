'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Plus,
  Search,
  Send,
  Smartphone,
  Bell,
  Mail,
  MessageSquare,
  Layers,
  Sparkles,
  Copy,
  Trash2,
  Edit3,
  Check,
  AlertCircle,
  AlertTriangle,
  Loader2,
  Eye,
  RefreshCw,
  Tag,
  Info,
  X,
  CheckCircle2,
  HelpCircle,
  Sliders,
  History,
  Database,
  LayoutList,
  LayoutGrid,
  ChevronDown,
  ChevronRight,
  ShieldCheck,
  CheckCircle,
  Award,
  Clock,
  Flame,
  GraduationCap,
  ArrowUpRight,
  User,
  Code2
} from 'lucide-react';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import { useAuth } from '@/contexts/auth-context';

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

export interface NotificationTemplate {
  id: string;
  notification_type: string;
  channel: 'IN_APP' | 'PUSH' | 'EMAIL' | 'WHATSAPP' | 'ALL';
  variation_index: number;
  title_template: string | null;
  body_template: string;
  cta_label: string | null;
  language: string;
  version: number;
  status: 'DRAFT' | 'VALIDATED' | 'PUBLISHED' | 'ARCHIVED';
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface VariableContract {
  id: string;
  key: string;
  label: string;
  description: string | null;
  data_type: 'string' | 'number' | 'date' | 'url' | 'percentage' | 'boolean';
  namespace: string;
  source_path: string | null;
  is_required: boolean;
  default_fallback: string | null;
  sample_value: string;
  is_system: boolean;
}

export interface EventPreset {
  id: string;
  key: string;
  label: string;
  category: string;
  description: string | null;
  default_channels: string[];
  recommended_variables: string[];
  is_system: boolean;
}

export interface DispatchAuditRecord {
  id: string;
  correlation_id: string;
  template_id: string | null;
  notification_type: string;
  channel: string;
  recipient_user_id: string | null;
  status: string;
  resolved_variables: Record<string, any> | null;
  rendered_title: string | null;
  rendered_body: string | null;
  validation_errors: string[] | null;
  provider_response: Record<string, any> | null;
  failure_reason: string | null;
  is_test: boolean;
  created_at: string;
  users?: { name: string; email: string };
}

export interface LintReport {
  valid: boolean;
  hard_errors: string[];
  warnings: string[];
  tokens_found: string[];
  unknown_tokens: string[];
  metrics: {
    channel: string;
    title_rendered_length: number;
    title_recommended: number;
    title_hard: number;
    body_rendered_length: number;
    body_recommended: number;
    body_hard: number;
  };
  rendered_preview: {
    title: string;
    body: string;
  };
}

export default function NotificationTemplatesManager() {
  const { user, userId, isDeveloper, employeeData } = useAuth();

  // Core Data
  const [templates, setTemplates] = useState<NotificationTemplate[]>([]);
  const [variables, setVariables] = useState<VariableContract[]>([]);
  const [presets, setPresets] = useState<EventPreset[]>([]);
  const [sampleContext, setSampleContext] = useState<Record<string, string>>({});
  const [auditLogs, setAuditLogs] = useState<DispatchAuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Main Screen Navigation Tabs: 'templates' | 'variables' | 'presets' | 'audit'
  const [activeMainTab, setActiveMainTab] = useState<'templates' | 'variables' | 'presets' | 'audit'>('templates');

  // Templates View Controls
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedChannelFilter, setSelectedChannelFilter] = useState<string>('ALL');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // Variables View Controls
  const [varSearchQuery, setVarSearchQuery] = useState('');
  const [varNamespaceFilter, setVarNamespaceFilter] = useState<string>('ALL');
  const [showAddVarForm, setShowAddVarForm] = useState(false);
  const [copiedVarKey, setCopiedVarKey] = useState<string | null>(null);

  // Presets View Controls
  const [presetSearchQuery, setPresetSearchQuery] = useState('');
  const [presetCategoryFilter, setPresetCategoryFilter] = useState<string>('ALL');
  const [showAddPresetForm, setShowAddPresetForm] = useState(false);

  // Audit View Controls
  const [auditSearchQuery, setAuditSearchQuery] = useState('');
  const [auditStatusFilter, setAuditStatusFilter] = useState<string>('ALL');
  const [selectedAuditLog, setSelectedAuditLog] = useState<DispatchAuditRecord | null>(null);

  // Editor Modal State
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<NotificationTemplate | null>(null);
  const [formType, setFormType] = useState('');
  const [formChannel, setFormChannel] = useState<'IN_APP' | 'PUSH' | 'EMAIL' | 'WHATSAPP' | 'ALL'>('ALL');
  const [formVariationIndex, setFormVariationIndex] = useState(0);
  const [formStatus, setFormStatus] = useState<'DRAFT' | 'VALIDATED' | 'PUBLISHED' | 'ARCHIVED'>('PUBLISHED');
  const [formTitle, setFormTitle] = useState('');
  const [formBody, setFormBody] = useState('');
  const [formCta, setFormCta] = useState('');
  const [formIsActive, setFormIsActive] = useState(true);
  const [saving, setSaving] = useState(false);

  // Variable Picker Dropdown inside editor
  const [isTokenDropdownOpen, setIsTokenDropdownOpen] = useState(false);
  const [tokenSearch, setTokenSearch] = useState('');
  const tokenDropdownRef = useRef<HTMLDivElement>(null);
  const [lastFocusedField, setLastFocusedField] = useState<'title' | 'body'>('body');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Real-Time Linter
  const [lintReport, setLintReport] = useState<LintReport | null>(null);
  const [linting, setLinting] = useState(false);
  const lintDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Visual Simulator mode: 'push' | 'in_app' | 'whatsapp' | 'email'
  const [simulatorMode, setSimulatorMode] = useState<'push' | 'in_app' | 'whatsapp' | 'email'>('push');

  // Custom Variable Form state
  const [newVarKey, setNewVarKey] = useState('');
  const [newVarLabel, setNewVarLabel] = useState('');
  const [newVarDesc, setNewVarDesc] = useState('');
  const [newVarType, setNewVarType] = useState<'string' | 'number' | 'date' | 'url' | 'percentage'>('string');
  const [newVarSample, setNewVarSample] = useState('');
  const [newVarFallback, setNewVarFallback] = useState('');
  const [newVarRequired, setNewVarRequired] = useState(false);
  const [savingVar, setSavingVar] = useState(false);
  const [varError, setVarError] = useState<string | null>(null);

  // Custom Event Preset Form state
  const [newPresetKey, setNewPresetKey] = useState('');
  const [newPresetLabel, setNewPresetLabel] = useState('');
  const [newPresetCategory, setNewPresetCategory] = useState('CUSTOM');
  const [newPresetDesc, setNewPresetDesc] = useState('');
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetError, setPresetError] = useState<string | null>(null);

  // Test Dispatch state
  const [testingTemplateId, setTestingTemplateId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    message: string;
    correlation_id?: string;
    rendered_title?: string;
    rendered_body?: string;
    developer_profile?: any;
    lifecycle?: any[];
  } | null>(null);

  // Developer Persona for Preview
  const devProfile = {
    name: user?.displayName || employeeData?.name || 'Developer',
    firstName: (user?.displayName || employeeData?.name || 'Developer').split(' ')[0],
    email: user?.email || 'dev@lucid.ai',
    company: employeeData?.company_name || 'Lucid Platform',
  };

  useEffect(() => {
    fetchVariables();
    fetchPresets();
    fetchTemplates();
    fetchAuditLogs();
  }, []);

  // Sync simulator mode when channel selection changes
  useEffect(() => {
    if (formChannel === 'PUSH') setSimulatorMode('push');
    else if (formChannel === 'IN_APP') setSimulatorMode('in_app');
    else if (formChannel === 'WHATSAPP') setSimulatorMode('whatsapp');
    else if (formChannel === 'EMAIL') setSimulatorMode('email');
    else if (formChannel === 'ALL') setSimulatorMode('push');
  }, [formChannel]);

  // Run Real-Time Linter on Title, Body, or Channel change
  useEffect(() => {
    if (!isEditorOpen) return;
    if (lintDebounceRef.current) clearTimeout(lintDebounceRef.current);

    lintDebounceRef.current = setTimeout(() => {
      runRealtimeLint();
    }, 250);

    return () => {
      if (lintDebounceRef.current) clearTimeout(lintDebounceRef.current);
    };
  }, [formTitle, formBody, formChannel, isEditorOpen]);

  // Click outside to close token popover
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (tokenDropdownRef.current && !tokenDropdownRef.current.contains(event.target as Node)) {
        setIsTokenDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // API Fetchers
  const fetchVariables = async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/registry/variables`);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.variables)
          ? data.variables
          : [];
        setVariables(list);
        setSampleContext(data?.sample_context || {});
      } else {
        setVariables([]);
      }
    } catch (err) {
      console.error('Failed to load variables:', err);
      setVariables([]);
    }
  };

  const fetchPresets = async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/registry/presets`);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.presets)
          ? data.presets
          : [];
        setPresets(list);
      } else {
        setPresets([]);
      }
    } catch (err) {
      console.error('Failed to load notification triggers:', err);
      setPresets([]);
    }
  };

  const fetchTemplates = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/templates`);
      if (!res.ok) throw new Error('Failed to fetch notification templates');
      const data = await res.json();
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.templates)
        ? data.templates
        : [];
      setTemplates(list);
    } catch (err: any) {
      setError(err.message || 'Failed to load templates');
      setTemplates([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchAuditLogs = async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/audit/dispatches?limit=30`);
      if (res.ok) {
        const data = await res.json();
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.audit_logs)
          ? data.audit_logs
          : Array.isArray(data?.records)
          ? data.records
          : [];
        setAuditLogs(list);
      } else {
        setAuditLogs([]);
      }
    } catch (err) {
      console.error('Failed to load audit logs:', err);
      setAuditLogs([]);
    }
  };

  // Real-Time Linter Client
  const runRealtimeLint = async () => {
    if (!formBody.trim()) {
      setLintReport(null);
      return;
    }
    setLinting(true);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/templates/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title_template: formTitle || null,
          body_template: formBody,
          channel: formChannel,
          preview_context: {
            ...sampleContext,
            'subscriber.first_name': devProfile.firstName,
            'subscriber.email': devProfile.email,
          },
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const rawReport = data.lint || data;
        if (rawReport && typeof rawReport === 'object') {
          setLintReport({
            ...rawReport,
            valid: rawReport.valid ?? true,
            hard_errors: Array.isArray(rawReport.hard_errors) ? rawReport.hard_errors : [],
            warnings: Array.isArray(rawReport.warnings) ? rawReport.warnings : [],
          });
        }
      }
    } catch (err) {
      console.error('Linter validation error:', err);
    } finally {
      setLinting(false);
    }
  };

  // CRUD Handlers
  const handleOpenCreate = () => {
    setEditingTemplate(null);
    setFormType('');
    setFormChannel('ALL');
    setFormVariationIndex(0);
    setFormStatus('PUBLISHED');
    setFormTitle('');
    setFormBody('');
    setFormCta('');
    setFormIsActive(true);
    setLintReport(null);
    setIsEditorOpen(true);
  };

  const handleOpenEdit = (t: NotificationTemplate) => {
    setEditingTemplate(t);
    setFormType(t.notification_type);
    setFormChannel(t.channel);
    setFormVariationIndex(t.variation_index);
    setFormStatus(t.status || 'PUBLISHED');
    setFormTitle(t.title_template || '');
    setFormBody(t.body_template);
    setFormCta(t.cta_label || '');
    setFormIsActive(t.is_active);
    setLintReport(null);
    setIsEditorOpen(true);
  };

  const handleOpenNewVariation = (baseTemplate: NotificationTemplate) => {
    setEditingTemplate(null);
    setFormType(baseTemplate.notification_type);
    setFormChannel(baseTemplate.channel);
    const existingCount = safeTemplates.filter((t) => t.notification_type === baseTemplate.notification_type).length;
    setFormVariationIndex(existingCount);
    setFormStatus('DRAFT');
    setFormTitle(baseTemplate.title_template ? `${baseTemplate.title_template} (Var)` : '');
    setFormBody(baseTemplate.body_template);
    setFormCta(baseTemplate.cta_label || '');
    setFormIsActive(false);
    setLintReport(null);
    setIsEditorOpen(true);
  };

  const handleInsertToken = (tokenKey: string) => {
    const tokenText = `{{${tokenKey}}}`;
    if (lastFocusedField === 'title') {
      const input = titleInputRef.current;
      if (input) {
        const start = input.selectionStart || 0;
        const end = input.selectionEnd || 0;
        const updated = formTitle.substring(0, start) + tokenText + formTitle.substring(end);
        setFormTitle(updated);
        setTimeout(() => {
          input.focus();
          input.setSelectionRange(start + tokenText.length, start + tokenText.length);
        }, 50);
      } else {
        setFormTitle((prev) => prev + tokenText);
      }
    } else {
      const textarea = bodyTextareaRef.current;
      if (textarea) {
        const start = textarea.selectionStart || 0;
        const end = textarea.selectionEnd || 0;
        const updated = formBody.substring(0, start) + tokenText + formBody.substring(end);
        setFormBody(updated);
        setTimeout(() => {
          textarea.focus();
          textarea.setSelectionRange(start + tokenText.length, start + tokenText.length);
        }, 50);
      } else {
        setFormBody((prev) => prev + tokenText);
      }
    }
    setIsTokenDropdownOpen(false);
  };

  const handleSaveTemplate = async () => {
    if (!formType.trim()) {
      alert('Please enter an Event Type');
      return;
    }
    if (!formBody.trim()) {
      alert('Please enter a Body Template');
      return;
    }
    if (lintReport && lintReport.valid === false && (lintReport.hard_errors || []).length > 0) {
      alert('Please resolve validation errors before publishing.');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        notification_type: formType.trim().toUpperCase(),
        channel: formChannel,
        variation_index: formVariationIndex,
        title_template: formTitle.trim() || null,
        body_template: formBody.trim(),
        cta_label: formCta.trim() || null,
        language: 'en',
        status: formStatus,
        is_active: formIsActive,
      };

      if (editingTemplate) {
        const res = await fetchWithAuth(`${API_BASE}/api/notifications/templates/${editingTemplate.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.detail?.message || errData?.detail || 'Failed to update template');
        }
      } else {
        const res = await fetchWithAuth(`${API_BASE}/api/notifications/templates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          throw new Error(errData?.detail?.message || errData?.detail || 'Failed to create template');
        }
      }

      setIsEditorOpen(false);
      await fetchTemplates();
    } catch (err: any) {
      alert(err.message || 'Error saving template');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteTemplate = async (templateId: string) => {
    if (!confirm('Are you sure you want to delete this notification template?')) return;
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/templates/${templateId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setTemplates((prev) => (Array.isArray(prev) ? prev.filter((item) => item.id !== templateId) : []));
      }
    } catch (err: any) {
      alert(err.message || 'Failed to delete template');
    }
  };

  const handleToggleActive = async (t: NotificationTemplate) => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/templates/${t.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !t.is_active }),
      });
      if (res.ok) {
        setTemplates((prev) =>
          Array.isArray(prev)
            ? prev.map((item) => (item.id === t.id ? { ...item, is_active: !item.is_active } : item))
            : []
        );
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateCustomVariable = async () => {
    if (!newVarKey.trim() || !newVarLabel.trim() || !newVarSample.trim()) {
      setVarError('Key, Label, and Sample value are required');
      return;
    }

    setSavingVar(true);
    setVarError(null);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/registry/variables`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: newVarKey.trim().toLowerCase(),
          label: newVarLabel.trim(),
          description: newVarDesc.trim() || null,
          data_type: newVarType,
          namespace: 'custom',
          sample_value: newVarSample.trim(),
          default_fallback: newVarFallback.trim() || null,
          is_required: newVarRequired,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.detail || 'Failed to create variable');
      }

      setNewVarKey('');
      setNewVarLabel('');
      setNewVarDesc('');
      setNewVarSample('');
      setNewVarFallback('');
      setNewVarRequired(false);
      setShowAddVarForm(false);
      await fetchVariables();
    } catch (err: any) {
      setVarError(err.message || 'Failed to register variable');
    } finally {
      setSavingVar(false);
    }
  };

  const handleDeleteVariable = async (varId: string) => {
    if (!confirm('Are you sure you want to delete this custom variable?')) return;
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/registry/variables/${varId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setVariables((prev) => (Array.isArray(prev) ? prev.filter((v) => v.id !== varId) : []));
      }
    } catch (err: any) {
      alert(err.message || 'Failed to delete variable');
    }
  };

  const handleCreateEventPreset = async () => {
    if (!newPresetKey.trim() || !newPresetLabel.trim()) {
      setPresetError('Preset Event Key and Label are required');
      return;
    }

    setSavingPreset(true);
    setPresetError(null);
    try {
      const cleanKey = newPresetKey.trim().toUpperCase().replace(/\s+/g, '_');
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/registry/presets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: cleanKey,
          label: newPresetLabel.trim(),
          category: newPresetCategory,
          description: newPresetDesc.trim() || null,
          default_channels: ['ALL'],
          recommended_variables: ['subscriber.first_name'],
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.detail || 'Failed to create preset');
      }

      setNewPresetKey('');
      setNewPresetLabel('');
      setNewPresetCategory('CUSTOM');
      setNewPresetDesc('');
      setShowAddPresetForm(false);
      await fetchPresets();
    } catch (err: any) {
      setPresetError(err.message || 'Failed to create preset');
    } finally {
      setSavingPreset(false);
    }
  };

  const handleDeletePreset = async (presetId: string) => {
    if (!confirm('Are you sure you want to delete this event preset?')) return;
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/registry/presets/${presetId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setPresets((prev) => (Array.isArray(prev) ? prev.filter((p) => p.id !== presetId) : []));
      }
    } catch (err: any) {
      alert(err.message || 'Failed to delete preset');
    }
  };

  const handleSendTestNotification = async (template?: NotificationTemplate) => {
    const isModalPreview = !template;
    const targetTemplateId = template?.id || 'editor_preview';
    setTestingTemplateId(targetTemplateId);
    setTestResult(null);

    try {
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/templates/test-send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_id: template?.id || null,
          notification_type: template?.notification_type || formType,
          channel: template?.channel || formChannel,
          title_template: template ? template.title_template : formTitle || null,
          body_template: template ? template.body_template : formBody,
          recipient_user_id: userId,
          custom_context: {
            'subscriber.first_name': devProfile.firstName,
            'subscriber.email': devProfile.email,
          },
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.detail || 'Failed to execute test notification');
      }

      const data = await res.json();
      setTestResult({
        success: true,
        message: data.message || `Test dispatch completed successfully for ${data.channel}!`,
        correlation_id: data.correlation_id,
        rendered_title: data.rendered_title,
        rendered_body: data.rendered_body,
        developer_profile: data.developer_profile,
        lifecycle: data.lifecycle,
      });

      fetchAuditLogs();
      setTimeout(() => setTestResult(null), 8000);
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err.message || 'Failed to dispatch test notification',
      });
    } finally {
      setTestingTemplateId(null);
    }
  };

  // Defensive array guards ensuring complete resilience against any API or state anomalies
  const safeTemplates = Array.isArray(templates) ? templates : [];
  const safePresets = Array.isArray(presets) ? presets : [];
  const safeVariables = Array.isArray(variables) ? variables : [];
  const safeAuditLogs = Array.isArray(auditLogs) ? auditLogs : [];

  // Compute unified available event types with live template counts
  const availableEventTypes = React.useMemo(() => {
    const map = new Map<string, { key: string; label: string; count: number }>();

    safeTemplates.forEach((t) => {
      const key = (t.notification_type || '').toUpperCase();
      if (!key) return;
      const current = map.get(key);
      if (current) {
        current.count++;
      } else {
        const matchingPreset = safePresets.find((p) => p.key.toUpperCase() === key);
        map.set(key, {
          key,
          label: matchingPreset ? matchingPreset.label : key.replace(/_/g, ' '),
          count: 1,
        });
      }
    });

    safePresets.forEach((p) => {
      const key = (p.key || '').toUpperCase();
      if (!map.has(key)) {
        map.set(key, {
          key,
          label: p.label,
          count: 0,
        });
      }
    });

    return Array.from(map.values()).sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return a.key.localeCompare(b.key);
    });
  }, [safeTemplates, safePresets]);

  // Robust multi-factor filter for Templates
  const filteredTemplates = safeTemplates.filter((t) => {
    if (selectedChannelFilter !== 'ALL' && t.channel !== selectedChannelFilter && t.channel !== 'ALL') {
      return false;
    }
    if (selectedTypeFilter !== 'ALL') {
      const templateType = (t.notification_type || '').toUpperCase();
      const filterType = selectedTypeFilter.toUpperCase();
      if (templateType !== filterType) {
        return false;
      }
    }
    if (statusFilter !== 'ALL' && (t.status || 'PUBLISHED') !== statusFilter) {
      return false;
    }
    if (searchQuery.trim()) {
      const terms = searchQuery.toLowerCase().trim().split(/\s+/).filter(Boolean);
      const haystack = [
        t.notification_type || '',
        (t.notification_type || '').replace(/_/g, ' '),
        t.title_template || '',
        t.body_template || '',
        t.cta_label || '',
        t.channel || '',
        t.channel === 'ALL' ? 'omni omnichannel all channels' : '',
        t.channel === 'IN_APP' ? 'in-app in app' : '',
        t.variation_index === 0 ? 'control v0 var 0' : `var ${t.variation_index} variation ${t.variation_index}`,
        t.status || '',
      ].join(' ').toLowerCase();

      const matchesAll = terms.every((term) => haystack.includes(term));
      if (!matchesAll) return false;
    }
    return true;
  });

  // Filter for Variables Tab
  const filteredVariables = safeVariables.filter((v) => {
    if (varNamespaceFilter !== 'ALL' && (v.namespace || 'custom') !== varNamespaceFilter) {
      return false;
    }
    if (varSearchQuery.trim()) {
      const q = varSearchQuery.toLowerCase();
      return (
        v.key.toLowerCase().includes(q) ||
        v.label.toLowerCase().includes(q) ||
        (v.description || '').toLowerCase().includes(q) ||
        v.sample_value.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Filter for Presets Tab
  const filteredPresets = safePresets.filter((p) => {
    if (presetCategoryFilter !== 'ALL' && p.category !== presetCategoryFilter) {
      return false;
    }
    if (presetSearchQuery.trim()) {
      const q = presetSearchQuery.toLowerCase();
      return (
        p.key.toLowerCase().includes(q) ||
        p.label.toLowerCase().includes(q) ||
        (p.description || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Filter for Audit Logs Tab
  const filteredAuditLogs = safeAuditLogs.filter((log) => {
    if (auditStatusFilter !== 'ALL' && log.status !== auditStatusFilter) {
      return false;
    }
    if (auditSearchQuery.trim()) {
      const q = auditSearchQuery.toLowerCase();
      return (
        log.correlation_id.toLowerCase().includes(q) ||
        log.notification_type.toLowerCase().includes(q) ||
        log.channel.toLowerCase().includes(q) ||
        (log.rendered_title || '').toLowerCase().includes(q) ||
        (log.rendered_body || '').toLowerCase().includes(q) ||
        (log.users?.email || '').toLowerCase().includes(q) ||
        (log.users?.name || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Filter tokens for modal picker
  const filteredEditorTokens = safeVariables.filter((v) => {
    if (!tokenSearch.trim()) return true;
    const q = tokenSearch.toLowerCase();
    return v.key.toLowerCase().includes(q) || v.label.toLowerCase().includes(q);
  });

  // Event visual category avatar and icon helper
  const getEventVisual = (type: string) => {
    const t = (type || '').toUpperCase();
    if (t.includes('CERTIFICATE') || t.includes('REWARD')) {
      return {
        icon: Award,
        color: 'text-amber-600 bg-amber-50/90 border-amber-200/90',
      };
    }
    if (t.includes('DEADLINE')) {
      const isUrgent = t.includes('24') || t.includes('MISSED');
      return {
        icon: Clock,
        color: isUrgent ? 'text-rose-600 bg-rose-50/90 border-rose-200/90' : 'text-amber-600 bg-amber-50/90 border-amber-200/90',
      };
    }
    if (t.includes('QUIZ') || t.includes('PASSED') || t.includes('FAILED')) {
      return {
        icon: t.includes('PASSED') ? CheckCircle2 : AlertCircle,
        color: t.includes('PASSED') ? 'text-emerald-600 bg-emerald-50/90 border-emerald-200/90' : 'text-rose-600 bg-rose-50/90 border-rose-200/90',
      };
    }
    if (t.includes('STREAK')) {
      return {
        icon: Flame,
        color: 'text-orange-600 bg-orange-50/90 border-orange-200/90',
      };
    }
    if (t.includes('MODULE')) {
      return {
        icon: GraduationCap,
        color: 'text-indigo-600 bg-indigo-50/90 border-indigo-200/90',
      };
    }
    if (t.includes('REENGAGEMENT')) {
      return {
        icon: RefreshCw,
        color: 'text-sky-600 bg-sky-50/90 border-sky-200/90',
      };
    }
    return {
      icon: Bell,
      color: 'text-slate-600 bg-slate-100 border-slate-200',
    };
  };

  // Channel badge helper
  const getChannelBadge = (ch: string) => {
    switch (ch) {
      case 'IN_APP':
        return { label: 'In-App', bg: 'bg-purple-50/80 text-purple-700 border-purple-200/80', icon: Bell };
      case 'PUSH':
        return { label: 'Push', bg: 'bg-sky-50/80 text-sky-700 border-sky-200/80', icon: Smartphone };
      case 'EMAIL':
        return { label: 'Email', bg: 'bg-amber-50/80 text-amber-700 border-amber-200/80', icon: Mail };
      case 'WHATSAPP':
        return { label: 'WhatsApp', bg: 'bg-emerald-50/80 text-emerald-700 border-emerald-200/80', icon: MessageSquare };
      case 'ALL':
      default:
        return { label: 'Omnichannel', bg: 'bg-indigo-50/80 text-indigo-700 border-indigo-200/80', icon: Layers };
    }
  };

  // Helper to format body copy preview: highlights {{...}} tokens cleanly
  const renderFormattedPreview = (text: string) => {
    const parts = text.split(/(\{\{[^}]+\}\})/g);
    return parts.map((part, idx) => {
      if (part.startsWith('{{') && part.endsWith('}}')) {
        return (
          <span
            key={idx}
            className="inline-block mx-0.5 px-2 py-0.5 rounded-md bg-indigo-50/90 text-indigo-700 font-mono text-xs font-semibold border border-indigo-200/80 shadow-2xs"
          >
            {part}
          </span>
        );
      }
      return <span key={idx}>{part}</span>;
    });
  };

  const copyToClipboard = (tokenKey: string) => {
    navigator.clipboard.writeText(`{{${tokenKey}}}`);
    setCopiedVarKey(tokenKey);
    setTimeout(() => setCopiedVarKey(null), 2000);
  };

  return (
    <div className="space-y-5">
      {/* Test Result Toast Banner */}
      {testResult && (
        <div
          className={`p-4 rounded-xl border flex items-start justify-between shadow-xs transition-all ${
            testResult.success ? 'bg-emerald-50 border-emerald-200 text-emerald-950' : 'bg-rose-50 border-rose-200 text-rose-950'
          }`}
        >
          <div className="flex items-start gap-3">
            {testResult.success ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 text-rose-600 mt-0.5 shrink-0" />
            )}
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <p className="font-semibold text-sm">{testResult.message}</p>
                {testResult.correlation_id && (
                  <span className="font-mono text-xs bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded">
                    {testResult.correlation_id}
                  </span>
                )}
              </div>
              {testResult.rendered_body && (
                <p className="text-xs text-slate-700 leading-relaxed">
                  <span className="font-medium text-emerald-800">Preview: </span>
                  {testResult.rendered_title ? `${testResult.rendered_title} — ` : ''}
                  {testResult.rendered_body}
                </p>
              )}
            </div>
          </div>
          <button onClick={() => setTestResult(null)} className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer">
            <X size={16} />
          </button>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          PRIMARY MAIN-SCREEN SUB-TAB NAVIGATION
         ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-1 border-b border-slate-200/60">
        <div className="inline-flex p-1 bg-slate-100 rounded-xl border border-slate-200/80 flex-wrap">
          <button
            type="button"
            onClick={() => setActiveMainTab('templates')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeMainTab === 'templates'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Bell size={14} className={activeMainTab === 'templates' ? 'text-indigo-600' : 'text-slate-400'} />
            <span>Templates</span>
            <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
              {safeTemplates.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveMainTab('variables')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeMainTab === 'variables'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Database size={14} className={activeMainTab === 'variables' ? 'text-indigo-600' : 'text-slate-400'} />
            <span>Smart Tags</span>
            <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
              {safeVariables.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveMainTab('presets')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeMainTab === 'presets'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sliders size={14} className={activeMainTab === 'presets' ? 'text-sky-600' : 'text-slate-400'} />
            <span>Notification Triggers</span>
            <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
              {safePresets.length}
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveMainTab('audit')}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
              activeMainTab === 'audit'
                ? 'bg-white text-slate-900 shadow-2xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <History size={14} className={activeMainTab === 'audit' ? 'text-emerald-600' : 'text-slate-400'} />
            <span>Delivery History</span>
            {safeAuditLogs.length > 0 && (
              <span className="text-[10px] font-bold px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                {safeAuditLogs.length}
              </span>
            )}
          </button>
        </div>

        {/* Primary Action Button Contextual to Tab */}
        {activeMainTab === 'templates' && (
          <button
            onClick={() => handleOpenCreate()}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs transition-all active:scale-95 cursor-pointer shrink-0"
          >
            <Plus size={15} />
            <span>New Template</span>
          </button>
        )}
        {activeMainTab === 'variables' && (
          <button
            onClick={() => setShowAddVarForm(!showAddVarForm)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs transition-all active:scale-95 cursor-pointer shrink-0"
          >
            <Plus size={15} />
            <span>{showAddVarForm ? 'Close Form' : '+ Add Smart Tag'}</span>
          </button>
        )}
        {activeMainTab === 'presets' && (
          <button
            onClick={() => setShowAddPresetForm(!showAddPresetForm)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold shadow-xs transition-all active:scale-95 cursor-pointer shrink-0"
          >
            <Plus size={15} />
            <span>{showAddPresetForm ? 'Close Form' : '+ Add Trigger'}</span>
          </button>
        )}
        {activeMainTab === 'audit' && (
          <button
            onClick={fetchAuditLogs}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold border border-slate-200 shadow-2xs transition-all cursor-pointer shrink-0"
          >
            <RefreshCw size={13} className="text-slate-500" />
            <span>Refresh History</span>
          </button>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────
          TAB 1: NOTIFICATION TEMPLATES VIEW
         ───────────────────────────────────────────────────────────── */}
      {activeMainTab === 'templates' && (
        <div className="space-y-4">
          {/* Two-Tier Filters & Channel Navigation */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-2xs divide-y divide-slate-100 overflow-hidden">
            {/* Tier 1: Channels Navigation */}
            <div className="p-3.5 sm:px-5 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-1.5">
                {(['ALL', 'PUSH', 'IN_APP', 'WHATSAPP', 'EMAIL'] as const).map((ch) => {
                  const isActive = selectedChannelFilter === ch;
                  const count = ch === 'ALL'
                    ? safeTemplates.length
                    : safeTemplates.filter((t) => t.channel === ch || t.channel === 'ALL').length;
                  const label =
                    ch === 'ALL'
                      ? 'All Channels'
                      : ch === 'IN_APP'
                      ? 'In-App'
                      : ch === 'WHATSAPP'
                      ? 'WhatsApp'
                      : ch === 'PUSH'
                      ? 'Push'
                      : 'Email';

                  return (
                    <button
                      key={ch}
                      onClick={() => setSelectedChannelFilter(ch)}
                      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all cursor-pointer whitespace-nowrap ${
                        isActive
                          ? 'bg-slate-900 text-white shadow-xs'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                      }`}
                    >
                      <span>{label}</span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-bold ${
                          isActive ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-500'
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* View Switcher on Right of Tier 1 */}
              <div className="inline-flex rounded-lg bg-slate-100 p-0.5 text-slate-600">
                <button
                  onClick={() => setViewMode('list')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                    viewMode === 'list' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'hover:text-slate-900'
                  }`}
                  title="Table list view"
                >
                  <LayoutList size={13} />
                  <span>Table</span>
                </button>
                <button
                  onClick={() => setViewMode('grid')}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium transition-all cursor-pointer ${
                    viewMode === 'grid' ? 'bg-white text-slate-900 shadow-2xs font-semibold' : 'hover:text-slate-900'
                  }`}
                  title="Card grid view"
                >
                  <LayoutGrid size={13} />
                  <span>Cards</span>
                </button>
              </div>
            </div>

            {/* Tier 2: Search, Event Preset Filter & Count */}
            <div className="px-3.5 py-2.5 sm:px-5 bg-slate-50/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 flex-1 max-w-xl">
                {/* Search Input */}
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search by trigger, title, message text, or channel..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-8 py-2 rounded-lg border border-slate-200 bg-white text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-slate-900 transition-all placeholder:text-slate-400 shadow-2xs"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                      title="Clear search"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>

                {/* Event Preset Filter Dropdown */}
                <div className="relative shrink-0">
                  <select
                    value={selectedTypeFilter}
                    onChange={(e) => setSelectedTypeFilter(e.target.value)}
                    className="appearance-none pl-3 pr-8 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 cursor-pointer min-w-[190px] max-w-[260px] truncate shadow-2xs"
                  >
                    <option value="ALL">All Triggers ({availableEventTypes.length})</option>
                    {availableEventTypes.map((item) => (
                      <option key={item.key} value={item.key}>
                        {item.key} {item.count > 0 ? `(${item.count})` : '(0)'}
                      </option>
                    ))}
                  </select>
                  <ChevronDown size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>

                {/* Clear Filters Button (if active) */}
                {(searchQuery || selectedChannelFilter !== 'ALL' || selectedTypeFilter !== 'ALL') && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setSelectedChannelFilter('ALL');
                      setSelectedTypeFilter('ALL');
                    }}
                    className="text-[11px] font-semibold text-rose-600 hover:text-rose-700 hover:underline px-1 whitespace-nowrap cursor-pointer"
                  >
                    Reset
                  </button>
                )}
              </div>

              <span className="text-xs font-medium text-slate-500">
                Showing <span className="font-semibold text-slate-800">{filteredTemplates.length}</span> of {safeTemplates.length}
              </span>
            </div>
          </div>

          {/* List or Grid Display */}
          {loading ? (
            <div className="bg-white rounded-xl border border-slate-200 p-16 flex flex-col items-center justify-center text-center space-y-2">
              <Loader2 className="w-6 h-6 text-indigo-600 animate-spin" />
              <p className="text-sm text-slate-500 font-medium">Loading templates…</p>
            </div>
          ) : error ? (
            <div className="bg-rose-50 rounded-xl border border-rose-200 p-6 text-center space-y-2">
              <p className="text-sm font-semibold text-rose-800">{error}</p>
              <button onClick={fetchTemplates} className="text-xs text-rose-700 font-bold underline cursor-pointer">
                Retry
              </button>
            </div>
          ) : filteredTemplates.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-16 text-center space-y-3">
              <Bell size={24} className="mx-auto text-slate-400" />
              <h4 className="text-sm font-bold text-slate-800">No templates found</h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                No notification templates matched your current filter criteria.
              </p>
              <button
                onClick={() => {
                  setSearchQuery('');
                  setSelectedChannelFilter('ALL');
                  setSelectedTypeFilter('ALL');
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-50 text-indigo-700 hover:bg-indigo-100 text-xs font-semibold cursor-pointer"
              >
                Clear Filters
              </button>
            </div>
          ) : viewMode === 'list' ? (
            /* ── SPACIOUS & ELEGANT TABLE LIST VIEW ── */
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/90 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    <th className="py-4 px-6 w-64">Trigger & Version</th>
                    <th className="py-4 px-4 w-36">Delivery Channel</th>
                    <th className="py-4 px-6">Message Content</th>
                    <th className="py-4 px-4 w-36">Status</th>
                    <th className="py-4 px-6 text-right w-48">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {filteredTemplates.map((t) => {
                    const chBadge = getChannelBadge(t.channel);
                    const ChIcon = chBadge.icon;
                    const eventVisual = getEventVisual(t.notification_type);
                    const EventIcon = eventVisual.icon;
                    const isTesting = testingTemplateId === t.id;

                    return (
                      <tr key={t.id} className="hover:bg-slate-50/80 transition-colors group">
                        {/* Event & Variation */}
                        <td className="py-6 px-6 align-top">
                          <div className="flex items-start gap-3.5">
                            <div
                              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${eventVisual.color} shadow-2xs`}
                              title={t.notification_type}
                            >
                              <EventIcon size={19} />
                            </div>
                            <div className="space-y-1.5 min-w-0">
                              <span className="font-bold text-sm text-slate-900 block truncate leading-tight">
                                {t.notification_type}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs font-medium text-slate-600 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200/80">
                                  {t.variation_index === 0 ? 'Primary Version' : `Version ${t.variation_index + 1}`}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Channel */}
                        <td className="py-6 px-4 align-top">
                          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold border ${chBadge.bg} shadow-2xs`}>
                            <ChIcon size={14} />
                            <span>{chBadge.label}</span>
                          </span>
                        </td>

                        {/* Copy Preview without Truncation */}
                        <td className="py-6 px-6 align-top">
                          <div className="space-y-2 max-w-3xl">
                            {t.title_template && (
                              <h4 className="font-bold text-base text-slate-900 leading-snug tracking-tight">
                                {t.title_template}
                              </h4>
                            )}
                            <div className="text-slate-700 text-sm leading-relaxed font-normal whitespace-pre-wrap">
                              {renderFormattedPreview(t.body_template)}
                            </div>
                            {t.cta_label && (
                              <div className="pt-1.5 flex items-center gap-2">
                                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200/80 px-3 py-1 rounded-lg border border-slate-200 shadow-2xs transition-colors">
                                  <span>CTA: {t.cta_label}</span>
                                  <ArrowUpRight size={13} className="text-slate-400" />
                                </span>
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Status Toggle & Badge */}
                        <td className="py-6 px-4 align-top">
                          <div className="flex items-center gap-2.5 pt-1">
                            <button
                              onClick={() => handleToggleActive(t)}
                              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                                t.is_active ? 'bg-emerald-500' : 'bg-slate-300'
                              }`}
                              title={t.is_active ? 'Active' : 'Inactive'}
                            >
                              <span
                                className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${
                                  t.is_active ? 'translate-x-4' : 'translate-x-0'
                                }`}
                              />
                            </button>
                            <div className="flex items-center gap-1.5">
                              <span className={`w-2 h-2 rounded-full ${t.is_active ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
                              <span className={`text-xs font-semibold ${t.is_active ? 'text-emerald-700' : 'text-slate-400'}`}>
                                {t.is_active ? 'Active' : 'Paused'}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Actions */}
                        <td className="py-6 px-6 align-top text-right">
                          <div className="flex items-center justify-end gap-1.5 pt-0.5">
                            <button
                              onClick={() => handleSendTestNotification(t)}
                              disabled={isTesting}
                              className="px-3.5 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-600 text-indigo-700 hover:text-white border border-indigo-200 hover:border-transparent text-xs font-semibold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shadow-2xs active:scale-95"
                              title="Send test notification to me"
                            >
                              {isTesting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                              <span>Test</span>
                            </button>
                            <button
                              onClick={() => handleOpenNewVariation(t)}
                              className="p-1.5 text-slate-400 hover:text-slate-800 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                              title="Duplicate variation"
                            >
                              <Copy size={16} />
                            </button>
                            <button
                              onClick={() => handleOpenEdit(t)}
                              className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors cursor-pointer"
                              title="Edit template"
                            >
                              <Edit3 size={16} />
                            </button>
                            <button
                              onClick={() => handleDeleteTemplate(t.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 transition-colors cursor-pointer"
                              title="Delete template"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            /* ── COMPACT CARDS GRID ── */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredTemplates.map((t) => {
                const chBadge = getChannelBadge(t.channel);
                const ChIcon = chBadge.icon;
                const eventVisual = getEventVisual(t.notification_type);
                const EventIcon = eventVisual.icon;
                const isTesting = testingTemplateId === t.id;

                return (
                  <div
                    key={t.id}
                    className="bg-white rounded-xl border border-slate-200 p-5 shadow-2xs hover:shadow-xs transition-all flex flex-col justify-between space-y-3"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 border ${eventVisual.color}`}>
                            <EventIcon size={16} />
                          </div>
                          <div>
                            <span className="font-bold text-sm text-slate-900 block truncate">
                              {t.notification_type}
                            </span>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold border ${chBadge.bg}`}>
                                <ChIcon size={11} />
                                <span>{chBadge.label}</span>
                              </span>
                              <span className="text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                                {t.variation_index === 0 ? 'v0' : `v${t.variation_index}`}
                              </span>
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={() => handleToggleActive(t)}
                          className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
                            t.is_active ? 'bg-emerald-500' : 'bg-slate-300'
                          }`}
                        >
                          <span
                            className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${
                              t.is_active ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>

                      {t.title_template && (
                        <h4 className="font-bold text-sm text-slate-900 leading-snug">
                          {t.title_template}
                        </h4>
                      )}

                      <div className="text-slate-600 text-xs leading-relaxed">
                        {renderFormattedPreview(t.body_template)}
                      </div>
                    </div>

                    <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                      <button
                        onClick={() => handleSendTestNotification(t)}
                        disabled={isTesting}
                        className="px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-600 text-indigo-700 hover:text-white border border-indigo-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 transition-colors"
                      >
                        {isTesting ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
                        <span>Test</span>
                      </button>

                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleOpenNewVariation(t)}
                          className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer"
                          title="Duplicate"
                        >
                          <Copy size={15} />
                        </button>
                        <button
                          onClick={() => handleOpenEdit(t)}
                          className="p-1.5 text-slate-400 hover:text-indigo-600 rounded-lg hover:bg-slate-100 cursor-pointer"
                          title="Edit"
                        >
                          <Edit3 size={15} />
                        </button>
                        <button
                          onClick={() => handleDeleteTemplate(t.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 cursor-pointer"
                          title="Delete"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 2: VARIABLE DICTIONARY (MAIN SCREEN TABLE)
         ───────────────────────────────────────────────────────────── */}
      {activeMainTab === 'variables' && (
        <div className="space-y-4">
          {/* Inline Add Variable Form (if open) */}
          {showAddVarForm && (
            <div className="bg-white rounded-xl border border-indigo-200 p-5 shadow-xs space-y-4 transition-all">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Database size={16} className="text-indigo-600" />
                  <h4 className="font-bold text-sm text-slate-900">Register Custom Variable</h4>
                </div>
                <button onClick={() => setShowAddVarForm(false)} className="text-slate-400 hover:text-slate-600 p-1">
                  <X size={16} />
                </button>
              </div>

              {varError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs font-semibold text-rose-800">
                  {varError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700">Variable Key (custom.*)</label>
                  <input
                    type="text"
                    placeholder="e.g. discount_code"
                    value={newVarKey}
                    onChange={(e) => setNewVarKey(e.target.value.toLowerCase().replace(/\s+/g, '_'))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-xs mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700">Friendly Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Discount Code"
                    value={newVarLabel}
                    onChange={(e) => setNewVarLabel(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700">Field Type</label>
                  <select
                    value={newVarType}
                    onChange={(e) => setNewVarType(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs mt-1 bg-white font-medium"
                  >
                    <option value="string">String</option>
                    <option value="number">Number</option>
                    <option value="date">Date</option>
                    <option value="percentage">Percentage</option>
                    <option value="url">URL</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="sm:col-span-2">
                  <label className="text-xs font-bold text-slate-700">Sample Example (for live preview)</label>
                  <input
                    type="text"
                    placeholder="e.g. SUMMER20 or 95"
                    value={newVarSample}
                    onChange={(e) => setNewVarSample(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs mt-1"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Strict Validation: In production, values are supplied directly by event triggers or optional filters (e.g. <code className="text-indigo-600 font-mono">{"{{ tag | default: '...' }}"}</code>).
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <label className="flex items-center gap-2 text-xs font-medium text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={newVarRequired}
                    onChange={(e) => setNewVarRequired(e.target.checked)}
                    className="rounded text-indigo-600"
                  />
                  <span>Require this tag (prevent message from sending if info is missing)</span>
                </label>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setShowAddVarForm(false)}
                    className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateCustomVariable}
                    disabled={savingVar}
                    className="px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-xs cursor-pointer disabled:opacity-50"
                  >
                    {savingVar ? 'Saving…' : 'Save Smart Tag'}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Filter Bar */}
          <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 flex-1 max-w-xl">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search tags, labels, or descriptions..."
                  value={varSearchQuery}
                  onChange={(e) => setVarSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 rounded-lg border border-slate-200 bg-white text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 text-slate-900 placeholder:text-slate-400"
                />
                {varSearchQuery && (
                  <button onClick={() => setVarSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    <X size={13} />
                  </button>
                )}
              </div>

              <select
                value={varNamespaceFilter}
                onChange={(e) => setVarNamespaceFilter(e.target.value)}
                className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 cursor-pointer"
              >
                <option value="ALL">All Categories</option>
                <option value="subscriber">Learner Profile</option>
                <option value="curriculum">Sprint & Curriculum</option>
                <option value="assessment">Quiz & Assessment</option>
                <option value="gamification">Points & Badges</option>
                <option value="custom">Custom Tags</option>
              </select>
            </div>

            <span className="text-xs font-medium text-slate-500">
              Showing <span className="font-semibold text-slate-800">{filteredVariables.length}</span> of {safeVariables.length} smart tags
            </span>
          </div>

          {/* Variables Table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/90 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-4 px-6 w-64">Smart Tag</th>
                  <th className="py-4 px-4 w-36">Category</th>
                  <th className="py-4 px-4 w-32">Field Type</th>
                  <th className="py-4 px-6">Name & Description</th>
                  <th className="py-4 px-4 w-44">Example Value</th>
                  <th className="py-4 px-6 text-right w-36">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredVariables.map((v) => {
                  const isCopied = copiedVarKey === v.key;

                  return (
                    <tr key={v.id || v.key} className="hover:bg-slate-50/80 transition-colors group">
                      <td className="py-4 px-6 align-top">
                        <div className="flex items-center gap-2">
                          <code className="px-2.5 py-1 rounded-md bg-indigo-50 font-mono text-xs font-bold text-indigo-700 border border-indigo-200/80 select-all">
                            {`{{${v.key}}}`}
                          </code>
                          <button
                            onClick={() => copyToClipboard(v.key)}
                            className="p-1 text-slate-400 hover:text-indigo-600 rounded transition-colors cursor-pointer"
                            title="Copy variable token"
                          >
                            {isCopied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
                          </button>
                        </div>
                      </td>

                      <td className="py-4 px-4 align-top">
                        <span className="inline-block px-2.5 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                          {v.namespace}
                        </span>
                      </td>

                      <td className="py-4 px-4 align-top">
                        <span className="inline-block px-2 py-0.5 rounded text-xs font-medium bg-slate-50 text-slate-600 border border-slate-200/60 font-mono">
                          {v.data_type}
                        </span>
                      </td>

                      <td className="py-4 px-6 align-top">
                        <div>
                          <p className="font-bold text-sm text-slate-900">{v.label}</p>
                          {v.description && (
                            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{v.description}</p>
                          )}
                        </div>
                      </td>

                      <td className="py-4 px-4 align-top font-mono text-xs text-slate-700">
                        <span className="bg-slate-50 px-2 py-1 rounded border border-slate-200 block truncate">
                          "{v.sample_value}"
                        </span>
                      </td>

                      <td className="py-4 px-6 align-top text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => copyToClipboard(v.key)}
                            className="px-2.5 py-1 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors flex items-center gap-1 cursor-pointer"
                          >
                            {isCopied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                            <span>{isCopied ? 'Copied' : 'Copy'}</span>
                          </button>
                          {!v.is_system && (
                            <button
                              onClick={() => handleDeleteVariable(v.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 cursor-pointer"
                              title="Delete custom variable"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 3: EVENT PRESETS (MAIN SCREEN TABLE)
         ───────────────────────────────────────────────────────────── */}
      {activeMainTab === 'presets' && (
        <div className="space-y-4">
          {/* Inline Add Preset Form (if open) */}
          {showAddPresetForm && (
            <div className="bg-white rounded-xl border border-sky-200 p-5 shadow-xs space-y-4 transition-all">
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <Sliders size={16} className="text-sky-600" />
                  <h4 className="font-bold text-sm text-slate-900">Create Custom Event Preset</h4>
                </div>
                <button onClick={() => setShowAddPresetForm(false)} className="text-slate-400 hover:text-slate-600 p-1">
                  <X size={16} />
                </button>
              </div>

              {presetError && (
                <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs font-semibold text-rose-800">
                  {presetError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-bold text-slate-700">Event Key</label>
                  <input
                    type="text"
                    placeholder="e.g. SPRINT_COMPLETED"
                    value={newPresetKey}
                    onChange={(e) => setNewPresetKey(e.target.value.toUpperCase().replace(/\s+/g, '_'))}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 font-mono text-xs mt-1 uppercase"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700">Display Label</label>
                  <input
                    type="text"
                    placeholder="e.g. Sprint Completed"
                    value={newPresetLabel}
                    onChange={(e) => setNewPresetLabel(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-700">Category</label>
                  <select
                    value={newPresetCategory}
                    onChange={(e) => setNewPresetCategory(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs mt-1 bg-white font-medium"
                  >
                    <option value="CUSTOM">CUSTOM</option>
                    <option value="ASSESSMENT">ASSESSMENT</option>
                    <option value="CURRICULUM">CURRICULUM</option>
                    <option value="CONTENT">CONTENT</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-slate-700">When does this trigger send? (optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Dispatched when a learner finishes all sprint activities"
                  value={newPresetDesc}
                  onChange={(e) => setNewPresetDesc(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs mt-1"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  onClick={() => setShowAddPresetForm(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateEventPreset}
                  disabled={savingPreset}
                  className="px-4 py-1.5 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold shadow-xs cursor-pointer disabled:opacity-50"
                >
                  {savingPreset ? 'Saving…' : 'Save Trigger'}
                </button>
              </div>
            </div>
          )}

          {/* Filter Bar */}
          <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 flex-1 max-w-xl">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search triggers, names, or descriptions..."
                  value={presetSearchQuery}
                  onChange={(e) => setPresetSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 rounded-lg border border-slate-200 bg-white text-xs focus:outline-none focus:ring-1 focus:ring-sky-500 text-slate-900 placeholder:text-slate-400"
                />
                {presetSearchQuery && (
                  <button onClick={() => setPresetSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    <X size={13} />
                  </button>
                )}
              </div>

              <select
                value={presetCategoryFilter}
                onChange={(e) => setPresetCategoryFilter(e.target.value)}
                className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-sky-500 cursor-pointer"
              >
                <option value="ALL">All Categories</option>
                <option value="ASSESSMENT">ASSESSMENT</option>
                <option value="CURRICULUM">CURRICULUM</option>
                <option value="CONTENT">CONTENT</option>
                <option value="CUSTOM">CUSTOM</option>
              </select>
            </div>

            <span className="text-xs font-medium text-slate-500">
              Showing <span className="font-semibold text-slate-800">{filteredPresets.length}</span> of {safePresets.length} notification triggers
            </span>
          </div>

          {/* Event Presets Table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/90 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-4 px-6 w-64">Event Key</th>
                  <th className="py-4 px-4 w-36">Category</th>
                  <th className="py-4 px-6">Label & Trigger Description</th>
                  <th className="py-4 px-4 w-44">Active Templates</th>
                  <th className="py-4 px-6 text-right w-36">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredPresets.map((p) => {
                  const eventVisual = getEventVisual(p.key);
                  const EventIcon = eventVisual.icon;
                  const matchingTemplateCount = safeTemplates.filter((t) => t.notification_type === p.key).length;

                  return (
                    <tr key={p.id || p.key} className="hover:bg-slate-50/80 transition-colors group">
                      <td className="py-4 px-6 align-top">
                        <div className="flex items-center gap-3">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border ${eventVisual.color}`}>
                            <EventIcon size={17} />
                          </div>
                          <div>
                            <span className="font-mono font-bold text-xs text-slate-900 block truncate">
                              {p.key}
                            </span>
                            <span className="text-[11px] text-slate-400">
                              {p.is_system ? 'System Preset' : 'Custom Preset'}
                            </span>
                          </div>
                        </div>
                      </td>

                      <td className="py-4 px-4 align-top">
                        <span className="inline-block px-2.5 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                          {p.category}
                        </span>
                      </td>

                      <td className="py-4 px-6 align-top">
                        <div>
                          <p className="font-bold text-sm text-slate-900">{p.label}</p>
                          {p.description && (
                            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{p.description}</p>
                          )}
                        </div>
                      </td>

                      <td className="py-4 px-4 align-top">
                        <span className="inline-block px-2.5 py-0.5 rounded-md text-xs font-semibold bg-slate-50 text-slate-700 border border-slate-200">
                          {matchingTemplateCount} {matchingTemplateCount === 1 ? 'template' : 'templates'}
                        </span>
                      </td>

                      <td className="py-4 px-6 align-top text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              setSelectedTypeFilter(p.key);
                              setActiveMainTab('templates');
                            }}
                            className="px-2.5 py-1 rounded-md border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                            title="Filter templates by this event"
                          >
                            View Messages
                          </button>
                          {!p.is_system && (
                            <button
                              onClick={() => handleDeletePreset(p.id)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-rose-50 cursor-pointer"
                              title="Delete preset"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 4: DISPATCH AUDIT LOGS (MAIN SCREEN TABLE & INSPECTOR)
         ───────────────────────────────────────────────────────────── */}
      {activeMainTab === 'audit' && (
        <div className="space-y-4">
          {/* Filter Bar */}
          <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 flex-1 max-w-xl">
              <div className="relative flex-1 min-w-[220px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search by delivery ID, recipient email, or message text..."
                  value={auditSearchQuery}
                  onChange={(e) => setAuditSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 rounded-lg border border-slate-200 bg-white text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 text-slate-900 placeholder:text-slate-400"
                />
                {auditSearchQuery && (
                  <button onClick={() => setAuditSearchQuery('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    <X size={13} />
                  </button>
                )}
              </div>

              <select
                value={auditStatusFilter}
                onChange={(e) => setAuditStatusFilter(e.target.value)}
                className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
              >
                <option value="ALL">All Statuses</option>
                <option value="DELIVERED">DELIVERED</option>
                <option value="FAILED">FAILED</option>
                <option value="PENDING">PENDING</option>
              </select>
            </div>

            <span className="text-xs font-medium text-slate-500">
              Showing <span className="font-semibold text-slate-800">{filteredAuditLogs.length}</span> deliveries
            </span>
          </div>

          {/* Audit Logs Table */}
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/90 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-4 px-6 w-56">Delivery ID</th>
                  <th className="py-4 px-4 w-32">Status</th>
                  <th className="py-4 px-4 w-36">Channel & Trigger</th>
                  <th className="py-4 px-6">Delivered Message</th>
                  <th className="py-4 px-4 w-44">Sent Time</th>
                  <th className="py-4 px-6 text-right w-36">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {filteredAuditLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400 text-xs">
                      No delivery records found matching your filters.
                    </td>
                  </tr>
                ) : (
                  filteredAuditLogs.map((log) => {
                    const isSelected = selectedAuditLog?.id === log.id;
                    const chBadge = getChannelBadge(log.channel);
                    const ChIcon = chBadge.icon;

                    return (
                      <React.Fragment key={log.id}>
                        <tr className={`hover:bg-slate-50/80 transition-colors ${isSelected ? 'bg-indigo-50/30' : ''}`}>
                          <td className="py-4 px-6 align-top">
                            <span className="font-mono text-xs font-bold text-slate-900 block truncate">
                              {log.correlation_id}
                            </span>
                            {log.is_test && (
                              <span className="inline-block mt-0.5 text-[10px] font-semibold text-amber-700 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                                Test Dispatch
                              </span>
                            )}
                          </td>

                          <td className="py-4 px-4 align-top">
                            <span
                              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-semibold border ${
                                log.status === 'DELIVERED'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : 'bg-rose-50 text-rose-700 border-rose-200'
                              }`}
                            >
                              <span className={`w-1.5 h-1.5 rounded-full ${log.status === 'DELIVERED' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                              <span>{log.status}</span>
                            </span>
                          </td>

                          <td className="py-4 px-4 align-top">
                            <div className="space-y-1">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border ${chBadge.bg}`}>
                                <ChIcon size={11} />
                                <span>{chBadge.label}</span>
                              </span>
                              <p className="font-mono text-[11px] font-bold text-slate-700 truncate">
                                {log.notification_type}
                              </p>
                            </div>
                          </td>

                          <td className="py-4 px-6 align-top">
                            <div className="space-y-0.5 max-w-xl">
                              {log.rendered_title && (
                                <p className="font-bold text-sm text-slate-900 truncate">{log.rendered_title}</p>
                              )}
                              <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                                {log.rendered_body}
                              </p>
                              {log.failure_reason && (
                                <p className="text-xs text-rose-600 font-medium pt-0.5">
                                  Error: {log.failure_reason}
                                </p>
                              )}
                            </div>
                          </td>

                          <td className="py-4 px-4 align-top text-xs text-slate-500">
                            <p className="font-medium text-slate-700">{new Date(log.created_at).toLocaleDateString()}</p>
                            <p className="text-[11px] text-slate-400">{new Date(log.created_at).toLocaleTimeString()}</p>
                          </td>

                          <td className="py-4 px-6 align-top text-right">
                            <button
                              onClick={() => setSelectedAuditLog(isSelected ? null : log)}
                              className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-colors cursor-pointer inline-flex items-center gap-1 ${
                                isSelected
                                  ? 'bg-slate-900 text-white border-slate-900'
                                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                              }`}
                            >
                              <Code2 size={13} />
                              <span>{isSelected ? 'Hide' : 'Payload'}</span>
                            </button>
                          </td>
                        </tr>

                        {/* Expandable JSON Payload Row */}
                        {isSelected && (
                          <tr className="bg-slate-900 text-slate-100">
                            <td colSpan={6} className="p-5">
                              <div className="space-y-2">
                                <div className="flex items-center justify-between text-xs text-slate-400 pb-1 border-b border-slate-800">
                                  <span className="font-bold uppercase tracking-wider text-slate-200">
                                    Delivered Message Details & Tag Snapshot
                                  </span>
                                  <span className="font-mono text-[11px]">{log.correlation_id}</span>
                                </div>
                                <pre className="p-3 bg-slate-950 rounded-lg text-xs font-mono text-emerald-400 overflow-x-auto max-h-64 leading-relaxed">
                                  {JSON.stringify(
                                    {
                                      resolved_variables: log.resolved_variables,
                                      validation_errors: log.validation_errors,
                                      provider_response: log.provider_response,
                                    },
                                    null,
                                    2
                                  )}
                                </pre>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          STREAMLINED TEMPLATE EDITOR & SIMULATOR MODAL
         ───────────────────────────────────────────────────────────── */}
      {isEditorOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-xs overflow-y-auto">
          <div className="relative w-full max-w-4xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
            {/* Modal Header */}
            <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/90">
              <div className="flex items-center gap-2">
                <Bell size={16} className="text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900">
                  {editingTemplate ? 'Edit Notification Message' : 'Create Notification Message'}
                </h3>
              </div>
              <button
                onClick={() => setIsEditorOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 lg:grid-cols-12 gap-5">
              {/* Form Side (7 Cols) */}
              <div className="lg:col-span-7 space-y-3.5">
                {/* Linter Error / Warning Alert */}
                {lintReport && lintReport.valid === false && (lintReport.hard_errors || []).length > 0 && (
                  <div className="p-2.5 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-800 space-y-0.5">
                    <p className="font-bold flex items-center gap-1 text-[11px]">
                      <AlertCircle size={13} className="text-rose-600" />
                      Please review before saving:
                    </p>
                    <ul className="text-[11px] text-rose-700 pl-4 list-disc">
                      {(lintReport.hard_errors || []).map((err, i) => (
                        <li key={i}>{err}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Event Type */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                      Notification Trigger
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditorOpen(false);
                        setActiveMainTab('presets');
                        setShowAddPresetForm(true);
                      }}
                      className="text-[11px] text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer"
                    >
                      + New Trigger
                    </button>
                  </div>
                  <input
                    type="text"
                    value={formType}
                    onChange={(e) => setFormType(e.target.value.toUpperCase().replace(/\s+/g, '_'))}
                    placeholder="e.g. MODULE_PASSED"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 font-mono text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 uppercase"
                  />
                </div>

                {/* Channel, Variation, Status Row */}
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">Channel</label>
                    <select
                      value={formChannel}
                      onChange={(e) => setFormChannel(e.target.value as any)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-800 bg-white"
                    >
                      <option value="ALL">All Channels (Omni)</option>
                      <option value="PUSH">Push Notification</option>
                      <option value="IN_APP">In-App Banner</option>
                      <option value="WHATSAPP">WhatsApp</option>
                      <option value="EMAIL">Email</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide" title="0 = Primary message, 1+ = Alternative wording">Version (0=Main)</label>
                    <input
                      type="number"
                      min="0"
                      max="10"
                      value={formVariationIndex}
                      onChange={(e) => setFormVariationIndex(parseInt(e.target.value, 10) || 0)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">Status</label>
                    <select
                      value={formStatus}
                      onChange={(e) => setFormStatus(e.target.value as any)}
                      className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs font-medium text-slate-800 bg-white"
                    >
                      <option value="PUBLISHED">Published</option>
                      <option value="DRAFT">Draft</option>
                      <option value="VALIDATED">Validated</option>
                      <option value="ARCHIVED">Archived</option>
                    </select>
                  </div>
                </div>

                {/* Title Input */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                      Message Title
                    </label>
                    {lintReport?.metrics && (
                      <span className="text-[10px] text-slate-400 font-mono">
                        {lintReport.metrics.title_rendered_length} / {lintReport.metrics.title_recommended} rec
                      </span>
                    )}
                  </div>
                  <input
                    ref={titleInputRef}
                    type="text"
                    value={formTitle}
                    onFocus={() => setLastFocusedField('title')}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="e.g. {{subscriber.first_name}}, module ready!"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-sans"
                  />
                </div>

                {/* Body Textarea with Compact Variable Insert Palette */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                      Message Body <span className="text-rose-500">*</span>
                    </label>

                    {/* Compact Token Inserter Popover Button */}
                    <div className="relative" ref={tokenDropdownRef}>
                      <button
                        type="button"
                        onClick={() => setIsTokenDropdownOpen(!isTokenDropdownOpen)}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 bg-indigo-50 px-2 py-0.5 rounded cursor-pointer"
                      >
                        <Sparkles size={11} />
                        <span>Insert Smart Tag</span>
                        <ChevronDown size={11} />
                      </button>

                      {isTokenDropdownOpen && (
                        <div className="absolute right-0 top-full mt-1 w-64 bg-white rounded-xl shadow-xl border border-slate-200 p-2 z-40 space-y-2">
                          <input
                            type="text"
                            placeholder="Search tags (name, score)..."
                            value={tokenSearch}
                            onChange={(e) => setTokenSearch(e.target.value)}
                            className="w-full px-2 py-1 text-xs rounded border border-slate-200 bg-slate-50 focus:outline-none"
                            autoFocus
                          />
                          <div className="max-h-48 overflow-y-auto space-y-1">
                            {filteredEditorTokens.map((v) => (
                              <button
                                key={v.key}
                                type="button"
                                onClick={() => handleInsertToken(v.key)}
                                className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-indigo-50 text-xs flex items-center justify-between group cursor-pointer transition-colors"
                              >
                                <div className="min-w-0 pr-2">
                                  <span className="font-semibold text-slate-800 text-xs block group-hover:text-indigo-700">
                                    {v.label || v.key}
                                  </span>
                                  <span className="font-mono text-[10px] text-slate-500">
                                    {`{{${v.key}}}`}
                                  </span>
                                </div>
                                <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
                                  {v.sample_value || v.data_type}
                                </span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <textarea
                    ref={bodyTextareaRef}
                    rows={4}
                    value={formBody}
                    onFocus={() => setLastFocusedField('body')}
                    onChange={(e) => setFormBody(e.target.value)}
                    placeholder="e.g. Well done {{subscriber.first_name}}! You scored {{assessment.score}} on {{curriculum.module_name}}."
                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono leading-relaxed resize-none"
                  />

                  {/* Character metrics inline badge */}
                  {lintReport?.metrics && (
                    <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5 font-mono">
                      <span>
                        Body: {lintReport.metrics.body_rendered_length} / {lintReport.metrics.body_recommended} rec (max {lintReport.metrics.body_hard})
                      </span>
                      {(lintReport.warnings || []).length > 0 && (
                        <span className="text-amber-600 font-semibold">{lintReport.warnings[0]}</span>
                      )}
                    </div>
                  )}
                </div>

                {/* CTA Action Label */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wide">
                    Button Text <span className="text-slate-400 font-normal">(Optional, e.g. View Results)</span>
                  </label>
                  <input
                    type="text"
                    value={formCta}
                    onChange={(e) => setFormCta(e.target.value)}
                    placeholder="e.g. View Analysis"
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-300 text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
              </div>

              {/* Live Preview Simulator Side (5 Cols) */}
              <div className="lg:col-span-5 bg-slate-50 rounded-xl p-4 border border-slate-200/80 flex flex-col justify-between space-y-3">
                <div className="space-y-3">
                  <div className="flex items-center justify-between pb-1 border-b border-slate-200">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 flex items-center gap-1">
                      <Eye size={12} className="text-indigo-600" />
                      <span>Live Preview</span>
                    </span>

                    {/* Simulator Channels Switcher */}
                    <div className="inline-flex rounded-md bg-slate-200/80 p-0.5 text-[10px] font-semibold">
                      {(['push', 'in_app', 'whatsapp', 'email'] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setSimulatorMode(m)}
                          className={`px-1.5 py-0.5 rounded cursor-pointer transition-all ${
                            simulatorMode === m ? 'bg-white shadow-2xs text-slate-900' : 'text-slate-600'
                          }`}
                        >
                          {m === 'in_app' ? 'In-App' : m.charAt(0).toUpperCase() + m.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Simulator Device Frame */}
                  <div className="py-2">
                    {simulatorMode === 'push' && (
                      <div className="w-full bg-slate-900 text-white rounded-xl p-3 shadow-md border border-slate-800 space-y-1.5 text-xs">
                        <div className="flex items-center justify-between text-[10px] text-slate-400 pb-1 border-b border-slate-800">
                          <div className="flex items-center gap-1">
                            <div className="w-3.5 h-3.5 rounded bg-indigo-500 flex items-center justify-center text-[8px] font-black">
                              L
                            </div>
                            <span className="font-semibold text-slate-200">LUCID</span>
                          </div>
                          <span>now</span>
                        </div>
                        <h5 className="font-bold text-white text-xs">
                          {lintReport?.rendered_preview?.title || 'Notification Title'}
                        </h5>
                        <p className="text-slate-300 text-[11px] leading-relaxed">
                          {lintReport?.rendered_preview?.body || 'Message body preview.'}
                        </p>
                      </div>
                    )}

                    {simulatorMode === 'in_app' && (
                      <div className="w-full bg-white rounded-xl p-3 shadow-xs border border-slate-200 space-y-2 text-xs">
                        <div className="flex items-start gap-2.5">
                          <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
                            <Bell size={13} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h5 className="font-bold text-slate-900 text-xs">
                              {lintReport?.rendered_preview?.title || 'In-App Notification'}
                            </h5>
                            <p className="text-slate-600 text-[11px] mt-0.5 leading-relaxed">
                              {lintReport?.rendered_preview?.body || 'In-App copy preview.'}
                            </p>
                            {formCta && (
                              <button type="button" className="mt-1.5 text-[10px] font-bold text-white bg-indigo-600 px-2 py-0.5 rounded">
                                {formCta}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {simulatorMode === 'whatsapp' && (
                      <div className="w-full bg-[#E5DDD5] rounded-xl p-3 border border-slate-300 space-y-1 text-xs">
                        <div className="bg-white rounded-lg p-2.5 shadow-2xs space-y-1 border border-slate-200">
                          {lintReport?.rendered_preview?.title && (
                            <p className="font-bold text-[#075E54] text-xs">
                              {lintReport.rendered_preview.title}
                            </p>
                          )}
                          <p className="text-slate-800 text-[11px] leading-relaxed">
                            {lintReport?.rendered_preview?.body || 'WhatsApp body preview.'}
                          </p>
                        </div>
                      </div>
                    )}

                    {simulatorMode === 'email' && (
                      <div className="w-full bg-white rounded-xl p-3 border border-slate-200 space-y-1.5 text-xs">
                        <p className="text-[10px] text-slate-500 pb-1 border-b border-slate-100">
                          Subject: {lintReport?.rendered_preview?.title || 'Notification Update'}
                        </p>
                        <p className="text-slate-700 text-[11px] leading-relaxed">
                          {lintReport?.rendered_preview?.body || 'Email body preview.'}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {/* Instant Send Test Button */}
                <button
                  type="button"
                  onClick={() => handleSendTestNotification()}
                  disabled={testingTemplateId === 'editor_preview'}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
                >
                  {testingTemplateId === 'editor_preview' ? (
                    <Loader2 size={12} className="animate-spin" />
                  ) : (
                    <Send size={12} />
                  )}
                  <span>Send Test Message to My Account</span>
                </button>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="px-5 py-3 border-t border-slate-100 bg-slate-50 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsEditorOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 text-xs font-semibold hover:bg-slate-100 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveTemplate}
                disabled={saving || (formStatus === 'PUBLISHED' && lintReport !== null && lintReport.valid === false && (lintReport.hard_errors || []).length > 0)}
                className="inline-flex items-center gap-1 px-4 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-2xs cursor-pointer disabled:opacity-50"
              >
                {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                <span>{editingTemplate ? 'Save Changes' : 'Create Message'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
