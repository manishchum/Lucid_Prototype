'use client';

import React, { useState, useEffect } from 'react';
import {
  Zap,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  Trash2,
  Edit3,
  Bell,
  Smartphone,
  Mail,
  RefreshCw,
  Eye,
  Layers,
  GraduationCap,
  Flame,
  BookOpen,
  Award,
  Users,
  Compass,
  Radio,
  Play,
  ExternalLink,
  GitBranch,
  ArrowUpDown,
  ChevronDown,
  Activity,
  Sparkles,
  X,
  Send,
  Megaphone,
  AlertCircle,
} from 'lucide-react';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import WorkflowLinearBuilder, { formatApiError } from './WorkflowLinearBuilder';
import { PREDEFINED_CATEGORIES } from './TemplateManagerTab';
import { PREDEFINED_SYSTEM_TRIGGERS } from './WorkflowLinearBuilder';
import InfoTooltip from './InfoTooltip';

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

export interface WorkflowItem {
  id: string;
  title: string;
  description?: string;
  trigger_lifecycle: string;
  category: string;
  rule_mode?: string;
  filter_rules: Array<{ field: string; operator: string; value: any }>;
  filter_match_type: 'ALL' | 'ANY';
  notification_type: string;
  channels: string[];
  pinned_template_id?: string;
  secondary_template_id?: string;
  title_template: string;
  body_template: string;
  cooldown_seconds: number;
  priority: string;
  is_active: boolean;
  execution_count: number;
  last_triggered_at?: string;
  created_at: string;
  schedule_type?: string;
  schedule_config?: any;
  audience_filter?: any;
}

export default function WorkflowManagerTab() {
  const [workflows, setWorkflows] = useState<WorkflowItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('ALL');
  const [sortBy, setSortBy] = useState<'newest' | 'oldest' | 'executions' | 'name' | 'active'>('newest');

  // Modal State
  const [isBuilderOpen, setIsBuilderOpen] = useState(false);
  const [editingWorkflow, setEditingWorkflow] = useState<WorkflowItem | null>(null);

  // Broadcast Confirmation Modal State
  const [isBroadcastModalOpen, setIsBroadcastModalOpen] = useState(false);
  const [selectedBroadcastWorkflow, setSelectedBroadcastWorkflow] = useState<WorkflowItem | null>(null);
  const [audiencePreview, setAudiencePreview] = useState<{ count: number; sample: any[] } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [broadcastSuccess, setBroadcastSuccess] = useState<string | null>(null);
  const [broadcastError, setBroadcastError] = useState<string | null>(null);

  // Fetch workflows
  const fetchWorkflows = async () => {
    try {
      setLoading(true);
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/workflows`);
      if (res.ok) {
        const data = await res.json();
        setWorkflows(data.workflows || []);
      }
    } catch (err) {
      console.error('Failed to fetch workflows:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchWorkflows();
  }, []);

  // Toggle Active / Inactive
  const handleToggleStatus = async (wf: WorkflowItem, e: React.MouseEvent) => {
    e.stopPropagation();
    const updatedStatus = !wf.is_active;
    try {
      // Optimistic update
      setWorkflows((prev) =>
        prev.map((item) => (item.id === wf.id ? { ...item, is_active: updatedStatus } : item))
      );

      const res = await fetchWithAuth(`${API_BASE}/api/notifications/workflows/${wf.id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: updatedStatus }),
      });

      if (!res.ok) {
        // Revert on failure
        setWorkflows((prev) =>
          prev.map((item) => (item.id === wf.id ? { ...item, is_active: !updatedStatus } : item))
        );
      }
    } catch (err) {
      console.error('Status update failed:', err);
    }
  };

  // Delete Workflow
  const handleDeleteWorkflow = async (id: string, title: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete workflow "${title}"?`)) return;

    try {
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/workflows/${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setWorkflows((prev) => prev.filter((w) => w.id !== id));
      }
    } catch (err) {
      console.error('Delete failed:', err);
    }
  };

  // Open Broadcast Confirmation Modal
  const handleOpenBroadcastModal = async (wf: WorkflowItem, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelectedBroadcastWorkflow(wf);
    setIsBroadcastModalOpen(true);
    setBroadcastSuccess(null);
    setBroadcastError(null);
    setAudiencePreview(null);
    try {
      setLoadingPreview(true);
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/workflows/${wf.id}/preview-audience`);
      if (res.ok) {
        const data = await res.json();
        setAudiencePreview({
          count: data.recipient_count || 0,
          sample: data.sample_recipients || [],
        });
      }
    } catch (err) {
      console.error('Failed to preview audience:', err);
    } finally {
      setLoadingPreview(false);
    }
  };

  // Execute Direct Broadcast
  const handleConfirmBroadcast = async () => {
    if (!selectedBroadcastWorkflow) return;
    try {
      setIsBroadcasting(true);
      setBroadcastError(null);
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/workflows/${selectedBroadcastWorkflow.id}/broadcast`, {
        method: 'POST',
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(formatApiError(err.detail, 'Broadcast failed'));
      }
      const data = await res.json();
      const count = data.dispatched_count ?? data.recipients_matched ?? data.count ?? 0;
      setBroadcastSuccess(data.message || `Successfully broadcasted to ${count} active users via In-App Bell and Mobile Push!`);
      fetchWorkflows();
      setTimeout(() => {
        setIsBroadcastModalOpen(false);
        setSelectedBroadcastWorkflow(null);
        setBroadcastSuccess(null);
      }, 2000);
    } catch (err: any) {
      setBroadcastError(err.message || 'An error occurred during broadcast.');
    } finally {
      setIsBroadcasting(false);
    }
  };

  // Filtered and Sorted workflows
  const filteredWorkflows = workflows.filter((w) => {
    const matchesCat = selectedCategory === 'ALL' || w.category === selectedCategory;
    const q = searchQuery.toLowerCase().trim();
    const matchesSearch =
      !q ||
      w.title.toLowerCase().includes(q) ||
      w.trigger_lifecycle.toLowerCase().includes(q) ||
      (w.description && w.description.toLowerCase().includes(q));
    return matchesCat && matchesSearch;
  });

  const sortedWorkflows = [...filteredWorkflows].sort((a, b) => {
    if (sortBy === 'newest') return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    if (sortBy === 'oldest') return new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime();
    if (sortBy === 'executions') return (b.execution_count || 0) - (a.execution_count || 0);
    if (sortBy === 'name') return a.title.localeCompare(b.title);
    if (sortBy === 'active') return (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0);
    return 0;
  });

  const activeCount = workflows.filter((w) => w.is_active).length;
  const totalExecutions = workflows.reduce((sum, w) => sum + (w.execution_count || 0), 0);

  return (
    <div className="space-y-6">
      {/* ─── TOP ACTION BAR ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-2xs">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <span>Automated Workflows Center</span>
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              {activeCount} Running
            </span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Event-driven automated notification pipelines triggered on real-time platform lifecycle events.
          </p>
        </div>

        <div className="flex items-center gap-2.5 w-full sm:w-auto">
          <button
            type="button"
            onClick={fetchWorkflows}
            className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors cursor-pointer"
            title="Refresh workflows"
          >
            <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          </button>

          <button
            type="button"
            id="btn-create-workflow"
            onClick={() => {
              setEditingWorkflow(null);
              setIsBuilderOpen(true);
            }}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-xl text-xs font-semibold shadow-xs hover:shadow-sm transition-all cursor-pointer"
          >
            <Plus size={15} />
            <span>Create Workflow</span>
          </button>
        </div>
      </div>

      {/* ─── REFINED TOP METRICS CARDS (ENHANCED UI & PROPORTIONS) ─── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* CARD 1: ACTIVE PIPELINES */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs hover:border-slate-300 transition-all flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Active Pipelines
              </span>
              <InfoTooltip content="Number of automated notification workflows currently active and responding to real-time learner lifecycle events." />
            </div>
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center shrink-0">
              <Zap size={16} />
            </div>
          </div>
          <div className="my-2.5">
            <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 flex items-baseline gap-2 tracking-tight">
              <span>{activeCount}</span>
              <span className="text-xs font-semibold text-slate-400">/ {workflows.length} total</span>
            </div>
          </div>
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded-md border border-emerald-200">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
              Live Event Listener
            </span>
            <span className="text-[11px] text-slate-400 font-medium">Automatic</span>
          </div>
        </div>

        {/* CARD 2: TOTAL INGESTED EVENTS */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs hover:border-slate-300 transition-all flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Total Ingested Events
              </span>
              <InfoTooltip content="Cumulative volume of automated lifecycle events dispatched and recorded across all pipelines." />
            </div>
            <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 flex items-center justify-center shrink-0">
              <Radio size={16} />
            </div>
          </div>
          <div className="my-2.5">
            <div className="text-2xl sm:text-3xl font-extrabold text-indigo-600 tracking-tight">
              {totalExecutions}
            </div>
          </div>
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-indigo-700 bg-indigo-50 px-2.5 py-0.5 rounded-md border border-indigo-200">
              <Activity size={11} />
              Platform Dispatches
            </span>
            <span className="text-[11px] text-slate-400 font-medium">Lifecycle logged</span>
          </div>
        </div>

        {/* CARD 3: PREDEFINED SYSTEM EVENTS */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs hover:border-slate-300 transition-all flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Predefined System Events
              </span>
              <InfoTooltip content="Standardized contract events codified in the platform across Quizzes, Deadlines, Streaks, Tasks, and Onboarding." />
            </div>
            <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 border border-amber-100 flex items-center justify-center shrink-0">
              <Layers size={16} />
            </div>
          </div>
          <div className="my-2.5">
            <div className="text-2xl sm:text-3xl font-extrabold text-amber-600 tracking-tight">
              28
            </div>
          </div>
          <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-800 bg-amber-50 px-2.5 py-0.5 rounded-md border border-amber-200">
              <Sparkles size={11} />
              8 Core Domains
            </span>
            <span className="text-[11px] text-slate-400 font-medium">Standard contracts</span>
          </div>
        </div>
      </div>

      {/* ─── SEARCH & DROPDOWN FILTER / SORT BAR ────────────────────── */}
      <div className="bg-white p-3.5 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search Input */}
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search workflows by title or trigger event..."
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

        {/* Dropdowns Row: Category Filter + Sort Dropdown */}
        <div className="flex items-center gap-2.5 shrink-0 flex-wrap sm:flex-nowrap">
          {/* Category Dropdown */}
          <div className="relative">
            <div className="flex items-center gap-1.5 px-3 py-2 bg-white rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:border-slate-300 transition-colors">
              <Filter size={13} className="text-slate-400 shrink-0" />
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="bg-transparent text-xs font-semibold text-slate-700 focus:outline-none cursor-pointer pr-4"
              >
                <option value="ALL">All Categories ({workflows.length})</option>
                {PREDEFINED_CATEGORIES.map((cat) => {
                  const count = workflows.filter((w) => w.category === cat.id).length;
                  return (
                    <option key={cat.id} value={cat.id}>
                      {cat.label} ({count})
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* Sort By Dropdown */}
          <div className="relative">
            <div className="flex items-center gap-1.5 px-3 py-2 bg-white rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:border-slate-300 transition-colors">
              <ArrowUpDown size={13} className="text-slate-400 shrink-0" />
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-transparent text-xs font-semibold text-slate-700 focus:outline-none cursor-pointer pr-4"
              >
                <option value="newest">Sort: Recently Created</option>
                <option value="oldest">Sort: Oldest First</option>
                <option value="executions">Sort: Most Executions</option>
                <option value="name">Sort: Workflow Name (A-Z)</option>
                <option value="active">Sort: Active First</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* ─── WORKFLOWS DATA TABLE ──────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <RefreshCw size={24} className="mx-auto text-indigo-600 animate-spin mb-3" />
            <p className="text-xs font-semibold text-slate-600">Loading automated workflows...</p>
          </div>
        ) : sortedWorkflows.length === 0 ? (
          <div className="p-12 text-center">
            <Zap size={28} className="mx-auto text-slate-300 mb-3" />
            <h3 className="text-sm font-bold text-slate-700">No workflows found</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              {searchQuery || selectedCategory !== 'ALL'
                ? 'No workflows matched the current filter or search criteria.'
                : 'Create an automated notification workflow to trigger nudges when learners take quizzes or hit deadlines.'}
            </p>
            <button
              type="button"
              onClick={() => {
                setEditingWorkflow(null);
                setIsBuilderOpen(true);
              }}
              className="mt-4 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition-all cursor-pointer"
            >
              Create Workflow Now
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-3.5 px-5">Workflow Name</th>
                  <th className="py-3.5 px-4">Event Trigger</th>
                  <th className="py-3.5 px-4">Rule Evaluation Mode</th>
                  <th className="py-3.5 px-4">Delivery Channels</th>
                  <th className="py-3.5 px-4 text-center">Executions</th>
                  <th className="py-3.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {sortedWorkflows.map((wf) => {
                  const trigMeta = PREDEFINED_SYSTEM_TRIGGERS.find(
                    (t) => t.key === wf.trigger_lifecycle
                  ) || {
                    label: wf.trigger_lifecycle,
                    icon: Zap,
                  };
                  const TrigIcon = trigMeta.icon;

                  return (
                    <tr
                      key={wf.id}
                      onClick={() => {
                        setEditingWorkflow(wf);
                        setIsBuilderOpen(true);
                      }}
                      className="hover:bg-slate-50/70 transition-colors cursor-pointer group"
                    >
                      {/* 1. Workflow Name (Clean Column without toggle) */}
                      <td className="py-4 px-5">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                              {wf.title}
                            </span>
                            {wf.is_active ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                ACTIVE
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500 border border-slate-200">
                                PAUSED
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 line-clamp-1">
                            {wf.description || 'Automated lifecycle event'}
                          </div>
                        </div>
                      </td>

                      {/* 2. Event Trigger */}
                      <td className="py-4 px-4">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                          <TrigIcon size={12} className="text-amber-600" />
                          <span>{trigMeta.label}</span>
                        </span>
                      </td>

                      {/* 3. Rule Evaluation Mode */}
                      <td className="py-4 px-4">
                        {wf.rule_mode === 'DUAL_BRANCH' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-200">
                            <GitBranch size={12} />
                            <span>Dual Branch (IF/ELSE)</span>
                          </span>
                        ) : wf.rule_mode === 'UNCONDITIONAL' || (wf.filter_rules || []).length === 0 ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-slate-100 text-slate-600">
                            <span>Unconditional (Always Send)</span>
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {wf.filter_rules.map((r, i) => (
                              <span
                                key={i}
                                className="px-2 py-0.5 rounded text-[11px] font-mono bg-slate-100 text-slate-700 border border-slate-200"
                              >
                                {r.field.split('.').pop()} {r.operator} {r.value}
                              </span>
                            ))}
                          </div>
                        )}
                      </td>

                      {/* 4. Delivery Channels */}
                      <td className="py-4 px-4">
                        <div className="flex items-center gap-1 flex-wrap">
                          {(wf.channels || ['IN_APP']).map((ch) => (
                            <span
                              key={ch}
                              className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-200"
                            >
                              {ch}
                            </span>
                          ))}
                        </div>
                      </td>

                      {/* 5. Executions */}
                      <td className="py-4 px-4 text-center">
                        <span className="font-bold text-slate-700">
                          {wf.execution_count || 0}
                        </span>
                      </td>

                      {/* 6. Actions (On/Off Toggle moved here + Edit + Delete) */}
                      <td className="py-4 px-5 text-right">
                        <div
                          className="flex items-center justify-end gap-2.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {/* ON / OFF Toggle Switch under Actions */}
                          <div className="flex items-center gap-1.5 pr-1 border-r border-slate-200">
                            <button
                              type="button"
                              onClick={(e) => handleToggleStatus(wf, e)}
                              className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer shrink-0 ${
                                wf.is_active ? 'bg-emerald-500' : 'bg-slate-200'
                              }`}
                              title={
                                wf.is_active
                                  ? 'Workflow is ACTIVE. Click to Turn OFF'
                                  : 'Workflow is PAUSED. Click to Turn ON'
                              }
                            >
                              <span
                                className={`w-4 h-4 rounded-full bg-white shadow-xs absolute top-0.5 transition-transform ${
                                  wf.is_active ? 'left-4.5' : 'left-0.5'
                                }`}
                              />
                            </button>
                          </div>

                          {/* Send Now / Broadcast Button */}
                          <button
                            type="button"
                            onClick={(e) => handleOpenBroadcastModal(wf, e)}
                            className="px-2.5 py-1 rounded-xl text-xs font-bold bg-amber-50 text-amber-900 border border-amber-200/90 hover:bg-amber-100 transition-all flex items-center gap-1 cursor-pointer shadow-2xs shrink-0"
                            title="Instant Broadcast to Audience"
                          >
                            <Zap size={12} className="text-amber-600" />
                            <span>Send Now</span>
                          </button>

                          {/* Edit Button */}
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingWorkflow(wf);
                              setIsBuilderOpen(true);
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors cursor-pointer"
                            title="Edit Workflow Configuration"
                          >
                            <Edit3 size={14} />
                          </button>

                          {/* Delete Button */}
                          <button
                            type="button"
                            onClick={(e) => handleDeleteWorkflow(wf.id, wf.title, e)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
                            title="Delete Workflow"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── LINEAR BUILDER MODAL ──────────────────────────────────── */}
      {isBuilderOpen && (
        <WorkflowLinearBuilder
          initialWorkflow={editingWorkflow}
          onClose={() => setIsBuilderOpen(false)}
          onSaved={() => {
            setIsBuilderOpen(false);
            fetchWorkflows();
          }}
        />
      )}

      {/* ─── BROADCAST CONFIRMATION MODAL ───────────────────────────── */}
      {isBroadcastModalOpen && selectedBroadcastWorkflow && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center shrink-0">
                  <Zap size={20} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-base font-bold text-slate-900">
                      Broadcast Notification
                    </h3>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                      Live Push & Bell
                    </span>
                  </div>
                  <p className="text-xs text-slate-500">
                    Targeted immediate dispatch to company learners
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (!isBroadcasting) {
                    setIsBroadcastModalOpen(false);
                    setSelectedBroadcastWorkflow(null);
                  }
                }}
                disabled={isBroadcasting}
                className="w-8 h-8 rounded-full border border-slate-200 text-slate-400 hover:text-slate-600 hover:bg-slate-50 flex items-center justify-center transition-colors cursor-pointer disabled:opacity-50"
              >
                <X size={16} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
              {/* Workflow Details */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/90 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-900">
                    {selectedBroadcastWorkflow.title}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                    {selectedBroadcastWorkflow.trigger_lifecycle}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500">
                  {selectedBroadcastWorkflow.description || 'Automated lifecycle event'}
                </div>
                <div className="pt-2 border-t border-slate-200/60 flex items-center gap-2 text-[11px] text-slate-600">
                  <span className="font-semibold text-slate-400">Channels:</span>
                  {(selectedBroadcastWorkflow.channels || ['IN_APP', 'PUSH']).map((ch) => (
                    <span key={ch} className="px-2 py-0.5 rounded bg-white border border-slate-200 font-bold text-[10px] text-slate-700">
                      {ch === 'IN_APP' ? '🔔 In-App Bell' : ch === 'PUSH' ? '📱 Mobile Push' : ch}
                    </span>
                  ))}
                </div>
              </div>

              {/* Audience Preview Card */}
              <div className="p-4 rounded-2xl bg-indigo-50/60 border border-indigo-100 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-950 flex items-center gap-1.5">
                    <Users size={14} className="text-indigo-600" />
                    Target Audience Match
                  </span>
                  {loadingPreview ? (
                    <RefreshCw size={13} className="text-indigo-600 animate-spin" />
                  ) : (
                    <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-indigo-600 text-white shadow-2xs">
                      {audiencePreview?.count ?? 0} Learners
                    </span>
                  )}
                </div>

                {loadingPreview ? (
                  <p className="text-xs text-indigo-700 font-medium animate-pulse">
                    Calculating audience filters and company members...
                  </p>
                ) : (
                  <>
                    <p className="text-[11px] text-indigo-800 leading-relaxed">
                      {audiencePreview?.count
                        ? `This broadcast will be sent to ${audiencePreview.count} active company members matching this workflow's audience scope.`
                        : 'No company members match the current filter criteria (e.g., department or role filter).'}
                    </p>
                    {audiencePreview?.sample && audiencePreview.sample.length > 0 && (
                      <div className="pt-2 border-t border-indigo-100/80">
                        <span className="text-[10px] font-bold text-indigo-600 block mb-1">
                          Sample Matching Recipients:
                        </span>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {audiencePreview.sample.slice(0, 5).map((s: any, idx: number) => (
                            <span
                              key={idx}
                              className="px-2 py-0.5 rounded-lg bg-white border border-indigo-200/80 text-[10px] font-semibold text-slate-700"
                            >
                              {s.name || s.email} {s.department ? `(${s.department})` : ''}
                            </span>
                          ))}
                          {audiencePreview.sample.length > 5 && (
                            <span className="text-[10px] text-indigo-600 font-bold">
                              +{audiencePreview.sample.length - 5} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Message Preview */}
              <div className="p-4 rounded-2xl bg-white border border-slate-200 space-y-2">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                  Template Preview (Interpolated at Dispatch)
                </span>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 space-y-1">
                  <div className="text-xs font-bold text-slate-800">
                    {selectedBroadcastWorkflow.title_template || selectedBroadcastWorkflow.title}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {selectedBroadcastWorkflow.body_template || 'Automated announcement copy'}
                  </div>
                </div>
              </div>

              {/* Error or Success feedback */}
              {broadcastError && (
                <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-2">
                  <AlertCircle size={15} className="text-rose-600 shrink-0" />
                  <span>{broadcastError}</span>
                </div>
              )}
              {broadcastSuccess && (
                <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center gap-2">
                  <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                  <span>{broadcastSuccess}</span>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setIsBroadcastModalOpen(false);
                  setSelectedBroadcastWorkflow(null);
                }}
                disabled={isBroadcasting}
                className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={handleConfirmBroadcast}
                disabled={isBroadcasting || (audiencePreview?.count ?? 0) === 0}
                className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {isBroadcasting ? (
                  <RefreshCw size={13} className="animate-spin" />
                ) : (
                  <Zap size={13} className="fill-slate-950" />
                )}
                <span>
                  {isBroadcasting
                    ? 'Blasting Dispatches...'
                    : `Confirm & Blast to ${audiencePreview?.count ?? 0} Users`}
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
