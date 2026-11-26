"use client";
import React, { useState, useMemo } from 'react';
import { useApp } from '@/contexts/voice-agents-context';
import { VoiceAgent, AgentStatus, VoiceProviderId, CompanyName } from '@/types/voice-agents';
import { AgentAvatar } from './AgentAvatar';
import {
  Search,
  Filter,
  Plus,
  Sparkles,
  PhoneCall,
  LayoutGrid,
  List,
  MoreVertical,
  SlidersHorizontal,
  ChevronDown,
  Layers,
  ArrowUpDown,
  CheckCircle2,
  Clock,
  PauseCircle,
  Archive,
  Copy,
  Trash2,
  ExternalLink,
  Bot,
  Shield,
  Activity,
  Award,
} from 'lucide-react';

interface VoiceAgentsDashboardProps {
  onCreateAgent: () => void;
  onBrowseTemplates: () => void;
  onOpenPlayground: (agentId: string) => void;
}

export const VoiceAgentsDashboard: React.FC<VoiceAgentsDashboardProps> = ({
  onCreateAgent,
  onBrowseTemplates,
  onOpenPlayground,
}) => {
  const {
    agents,
    openStudio,
    duplicateAgent,
    deleteAgent,
    selectedCompany,
    setSelectedCompany,
    currentRole,
    permissions,
    showToast,
    setView,
  } = useApp();

  // Filters & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState<AgentStatus | 'All'>('All');
  const [sortBy, setSortBy] = useState<'updated' | 'alpha' | 'calls'>('updated');
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list'); // Default to list matching Screenshot 2!
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null);

  // Filtered Agents
  const filteredAgents = useMemo(() => {
    return agents.filter((agent) => {
      // Company scoping: ordinary users only see their company; global admin sees all or selected
      if (selectedCompany !== 'All' && agent.company !== selectedCompany) {
        return false;
      }

      // Search
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchName = agent.name.toLowerCase().includes(query);
        const matchDesc = agent.description.toLowerCase().includes(query);
        const matchOwner = agent.owner.toLowerCase().includes(query);
        const matchCategory = agent.category.toLowerCase().includes(query);
        if (!matchName && !matchDesc && !matchOwner && !matchCategory) return false;
      }

      // Category
      if (categoryFilter !== 'All' && agent.category !== categoryFilter) {
        return false;
      }

      // Status
      if (statusFilter !== 'All' && agent.status !== statusFilter) {
        return false;
      }

      return true;
    }).sort((a, b) => {
      if (sortBy === 'alpha') return a.name.localeCompare(b.name);
      if (sortBy === 'calls') return (b.testCallsCount || 0) - (a.testCallsCount || 0);
      return 0; // default initial/updated order
    });
  }, [agents, selectedCompany, searchQuery, categoryFilter, statusFilter, sortBy]);

  // Metrics
  const metrics = useMemo(() => {
    const scoped = selectedCompany === 'All' ? agents : agents.filter((a) => a.company === selectedCompany);
    const total = scoped.length;
    const active = scoped.filter((a) => a.status === 'active').length;
    const draft = scoped.filter((a) => a.status === 'draft').length;
    const testCalls = scoped.reduce((sum, a) => sum + (a.testCallsCount || 0), 0);
    const scoredAgents = scoped.filter((a) => a.averageScore && a.averageScore > 0);
    const avgScore = scoredAgents.length > 0
      ? (scoredAgents.reduce((sum, a) => sum + (a.averageScore || 0), 0) / scoredAgents.length).toFixed(1)
      : '88.2';

    return { total, active, draft, testCalls, avgScore };
  }, [agents, selectedCompany]);

  // Unique categories for filter dropdown
  const categories = useMemo(() => {
    const set = new Set<string>();
    agents.forEach((a) => set.add(a.category));
    return ['All', ...Array.from(set)];
  }, [agents]);

  const statusBadges: Record<AgentStatus, { label: string; bg: string; text: string; icon: React.ReactNode }> = {
    active: {
      label: 'Active',
      bg: 'bg-emerald-50 border-emerald-200',
      text: 'text-emerald-700',
      icon: <CheckCircle2 className="w-3 h-3 text-emerald-600" />,
    },
    draft: {
      label: 'Draft',
      bg: 'bg-amber-50 border-amber-200',
      text: 'text-amber-700',
      icon: <Clock className="w-3 h-3 text-amber-600" />,
    },
    paused: {
      label: 'Paused',
      bg: 'bg-slate-100 border-slate-200',
      text: 'text-slate-600',
      icon: <PauseCircle className="w-3 h-3 text-slate-500" />,
    },
    archived: {
      label: 'Archived',
      bg: 'bg-rose-50 border-rose-200',
      text: 'text-rose-700',
      icon: <Archive className="w-3 h-3 text-rose-500" />,
    },
  };

  return (
    <div className="flex-1 overflow-y-auto bg-slate-50/60 p-6 space-y-6">
      {/* Top Banner / Studio Header */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">Voice Agents</h1>
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
              Studio Module
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl leading-relaxed">
            Create, configure, test and manage AI-powered voice agents across your organization with multi-provider turn-taking and automated evaluation.
          </p>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={onBrowseTemplates}
            className="flex items-center gap-2 px-3.5 py-2 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-white border border-slate-200 rounded-xl shadow-sm hover:bg-slate-50 transition-colors"
          >
            <Sparkles className="w-4 h-4 text-blue-600" />
            <span>Browse Templates</span>
          </button>

          {permissions.canCreateAgents && (
            <button
              onClick={onCreateAgent}
              className="flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-xl shadow-sm transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Create Voice Agent</span>
            </button>
          )}
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Total Agents</div>
          <div className="text-2xl font-bold text-slate-900 mt-1 font-mono tabular-nums">{metrics.total}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Across current workspace</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wider">Active Agents</div>
          <div className="text-2xl font-bold text-emerald-600 mt-1 font-mono tabular-nums">{metrics.active}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Live in production</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider">Draft Agents</div>
          <div className="text-2xl font-bold text-amber-600 mt-1 font-mono tabular-nums">{metrics.draft}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">In configuration</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
          <div className="text-[11px] font-semibold text-blue-600 uppercase tracking-wider">Total Test Calls</div>
          <div className="text-2xl font-bold text-slate-900 mt-1 font-mono tabular-nums">{metrics.testCalls}</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Browser & phone trials</div>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm col-span-2 sm:col-span-1">
          <div className="text-[11px] font-semibold text-purple-600 uppercase tracking-wider">Avg Evaluation</div>
          <div className="text-2xl font-bold text-slate-900 mt-1 font-mono tabular-nums">{metrics.avgScore}%</div>
          <div className="text-[11px] text-slate-500 mt-0.5">Automated scoring rubric</div>
        </div>
      </div>

      {/* Search & Filter Toolbar */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row items-center justify-between gap-3">
          {/* Search Input */}
          <div className="relative w-full md:w-96">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by agent name, category, or owner..."
              className="w-full pl-9 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:bg-white transition-colors"
            />
          </div>

          {/* Controls: Sort & Grid/List Mode */}
          <div className="flex items-center gap-2 w-full md:w-auto justify-between md:justify-end">
            <div className="flex items-center gap-1.5 text-xs text-slate-600">
              <span className="text-[11px] text-slate-400 font-medium">Sort:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:outline-none cursor-pointer"
              >
                <option value="updated">Recently Updated</option>
                <option value="alpha">Alphabetical (A-Z)</option>
                <option value="calls">Most Test Calls</option>
              </select>
            </div>

            {/* View Mode Toggle */}
            <div className="flex items-center p-0.5 bg-slate-100 rounded-lg border border-slate-200">
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-md transition-all ${
                  viewMode === 'list'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
                title="List View (Lucid Native)"
              >
                <List className="w-4 h-4" />
              </button>
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-md transition-all ${
                  viewMode === 'grid'
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'text-slate-500 hover:text-slate-900'
                }`}
                title="Grid Card View"
              >
                <LayoutGrid className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Filters Strip */}
        <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mr-1">
            Filter:
          </span>

          {/* Category */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-700 focus:outline-none cursor-pointer"
          >
            {categories.map((c) => (
              <option key={c} value={c}>
                Category: {c}
              </option>
            ))}
          </select>

          {/* Status */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-700 focus:outline-none cursor-pointer"
          >
            <option value="All">Status: All</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="paused">Paused</option>
            <option value="archived">Archived</option>
          </select>

          {/* Company Filter (Super Admin) */}
          {permissions.canViewAllCompanies && (
            <select
              value={selectedCompany}
              onChange={(e) => setSelectedCompany(e.target.value as CompanyName | 'All')}
              className="bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-700 focus:outline-none cursor-pointer font-medium"
            >
              <option value="All">Company: All Companies</option>
              <option value="Lucid">Lucid</option>
              <option value="QSR">QSR</option>
              <option value="Consumer Goods">Consumer Goods</option>
              <option value="EY">EY</option>
              <option value="FMCG Global">FMCG Global</option>
            </select>
          )}

          {(categoryFilter !== 'All' || statusFilter !== 'All' || searchQuery) && (
            <button
              onClick={() => {
                setCategoryFilter('All');
                setStatusFilter('All');
                setSearchQuery('');
              }}
              className="text-[11px] font-semibold text-blue-600 hover:text-blue-800 ml-auto"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* Agents Listing */}
      {filteredAgents.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center shadow-sm">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto mb-3">
            <Bot className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-900">No voice agents found</h3>
          <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
            No agents match your current query or company filter. Try clearing filters or create a new agent.
          </p>
          <div className="mt-4 flex items-center justify-center gap-2">
            <button
              onClick={() => {
                setSearchQuery('');
                setCategoryFilter('All');
                setStatusFilter('All');
              }}
              className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            >
              Clear Filters
            </button>
            <button
              onClick={onCreateAgent}
              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              Create New Agent
            </button>
          </div>
        </div>
      ) : viewMode === 'list' ? (
        /* LIST VIEW – AUTHENTICALLY MATCHING SCREENSHOT 2! */
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm divide-y divide-slate-100 overflow-hidden">
          {filteredAgents.map((agent) => {
            const badge = statusBadges[agent.status];
            const isMenuOpen = activeMenuId === agent.id;

            return (
              <div
                key={agent.id}
                className="p-4 hover:bg-slate-50/80 transition-all flex items-center justify-between gap-4 group"
              >
                {/* Left: Pixel Avatar + Name + Owner */}
                <div
                  onClick={() => openStudio(agent.id, 'overview')}
                  className="flex items-center gap-3.5 min-w-0 flex-1 cursor-pointer"
                >
                  <AgentAvatar
                    name={agent.name}
                    color={agent.avatarColor}
                    size="md"
                    showBadge={true}
                  />

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900 group-hover:text-blue-600 transition-colors truncate">
                        {agent.name}
                      </span>
                      {/* Status Badge */}
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badge.bg} ${badge.text}`}
                      >
                        {badge.icon}
                        <span>{badge.label}</span>
                      </span>

                      {/* Multi-tenant Origin Indicator */}
                      {agent.type === 'company_copy' && (
                        <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded font-mono hidden sm:inline">
                          Template: {agent.sourceTemplateVersion || 'v1.0'}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5" suppressHydrationWarning>
                      <span className="truncate" suppressHydrationWarning>{agent.owner}</span>
                      <span aria-hidden="true" className="text-slate-300">·</span>
                      <span className="text-slate-600 font-medium truncate" suppressHydrationWarning>{agent.company}</span>
                      <span aria-hidden="true" className="text-slate-300">·</span>
                      <span className="text-slate-400" suppressHydrationWarning>{agent.category}</span>
                    </div>
                  </div>
                </div>

                {/* Right: Test stats, Last modified & Quick Actions */}
                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right hidden sm:block">
                    <div className="text-xs font-semibold text-slate-800 font-mono tabular-nums">
                      {agent.testCallsCount} calls
                      {agent.averageScore && (
                        <span className="text-emerald-600 ml-1.5 font-bold">({agent.averageScore}%)</span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-400">{agent.lastModified}</div>
                  </div>

                  {/* Test Call Quick Button */}
                  <button
                    onClick={() => onOpenPlayground(agent.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                    title="Launch Browser / Phone Test Playground"
                  >
                    <PhoneCall className="w-3.5 h-3.5" />
                    <span className="hidden md:inline">Test Call</span>
                  </button>

                  {/* Open Studio Button */}
                  <button
                    onClick={() => openStudio(agent.id, 'overview')}
                    className="px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                  >
                    Open Studio
                  </button>

                  {/* More Menu Dropdown */}
                  <div className="relative">
                    <button
                      onClick={() => setActiveMenuId(isMenuOpen ? null : agent.id)}
                      className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>

                    {isMenuOpen && (
                      <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl shadow-lg border border-slate-200 py-1.5 z-20 animate-in fade-in text-xs">
                        <button
                          onClick={() => {
                            openStudio(agent.id, 'prompts');
                            setActiveMenuId(null);
                          }}
                          className="w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                        >
                          <Bot className="w-3.5 h-3.5 text-slate-400" />
                          <span>Configure Prompts</span>
                        </button>
                        <button
                          onClick={() => {
                            openStudio(agent.id, 'playground');
                            setActiveMenuId(null);
                          }}
                          className="w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                        >
                          <PhoneCall className="w-3.5 h-3.5 text-blue-600" />
                          <span>Test Playground</span>
                        </button>
                        <button
                          onClick={() => {
                            duplicateAgent(agent.id);
                            setActiveMenuId(null);
                          }}
                          className="w-full px-3 py-1.5 text-left text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                        >
                          <Copy className="w-3.5 h-3.5 text-slate-400" />
                          <span>Duplicate Agent</span>
                        </button>
                        <div className="my-1 border-t border-slate-100" />
                        {permissions.canDelete && (
                          <button
                            onClick={() => {
                              deleteAgent(agent.id);
                              setActiveMenuId(null);
                            }}
                            className="w-full px-3 py-1.5 text-left text-rose-600 hover:bg-rose-50 flex items-center gap-2"
                          >
                            <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                            <span>Delete Agent</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* GRID VIEW */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredAgents.map((agent) => {
            const badge = statusBadges[agent.status];

            return (
              <div
                key={agent.id}
                className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm hover:border-blue-300 hover:shadow-md transition-all flex flex-col justify-between group"
              >
                <div>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <AgentAvatar
                      name={agent.name}
                      color={agent.avatarColor}
                      size="lg"
                      showBadge={true}
                    />

                    <span
                      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${badge.bg} ${badge.text}`}
                    >
                      {badge.icon}
                      <span>{badge.label}</span>
                    </span>
                  </div>

                  <h3
                    onClick={() => openStudio(agent.id, 'overview')}
                    className="text-base font-bold text-slate-900 group-hover:text-blue-600 transition-colors cursor-pointer truncate"
                  >
                    {agent.name}
                  </h3>

                  <p className="text-xs text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                    {agent.description}
                  </p>

                  <div className="mt-3 pt-3 border-t border-slate-100 space-y-1.5 text-xs text-slate-500" suppressHydrationWarning>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Company:</span>
                      <span className="font-semibold text-slate-800" suppressHydrationWarning>{agent.company}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Category:</span>
                      <span className="text-slate-700" suppressHydrationWarning>{agent.category}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">Owner:</span>
                      <span className="truncate max-w-[140px]" suppressHydrationWarning>{agent.owner}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                  <div className="text-[11px] text-slate-400">
                    <span className="font-semibold text-slate-700 font-mono">{agent.testCallsCount}</span> tests · {agent.lastModified}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => onOpenPlayground(agent.id)}
                      className="p-1.5 text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                      title="Run Test Call"
                    >
                      <PhoneCall className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => openStudio(agent.id, 'overview')}
                      className="px-3 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
                    >
                      Open
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
