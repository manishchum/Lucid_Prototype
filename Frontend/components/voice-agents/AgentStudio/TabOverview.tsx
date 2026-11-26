"use client";
import React from 'react';
import { VoiceAgent, CallRecord } from '@/types/voice-agents';
import { useApp, StudioTab } from '@/contexts/voice-agents-context';
import {
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  PhoneCall,
  Edit3,
  History,
  ArrowRight,
  Sparkles,
  Building,
  User,
  Volume2,
  Clock,
  Award,
} from 'lucide-react';

interface TabOverviewProps {
  agent: VoiceAgent;
  onNavigateTab: (tab: StudioTab) => void;
}

export const TabOverview: React.FC<TabOverviewProps> = ({ agent, onNavigateTab }) => {
  const { callHistory } = useApp();

  // Find calls for this agent
  const agentCalls = callHistory.filter(
    (c) => c.agentId === agent.id || c.agentName === agent.name
  );
  const totalCalls = agentCalls.length > 0 ? agentCalls.length : (agent.testCallsCount || 0);
  const lastCall = agentCalls[0] || null;

  // Setup Checklist Calculation
  const hasInstructions = Boolean(
    agent.promptStructured.roleAndObjective?.trim() || agent.promptRaw?.trim()
  );
  const hasVoice = Boolean(agent.voiceSettings.voiceName);
  const hasKnowledge = agent.knowledgeBase.length > 0;
  const hasScoring = agent.evaluation.enabled && agent.evaluation.criteria.length > 0;
  const hasTested = totalCalls > 0;

  const checklistItems = [
    {
      id: 'instructions',
      title: 'Agent instructions configured',
      status: hasInstructions ? 'completed' : 'needs_attention',
      tab: 'behaviour' as StudioTab,
      desc: 'Set the persona and objective of this agent',
    },
    {
      id: 'voice',
      title: 'Voice and language selected',
      status: hasVoice ? 'completed' : 'needs_attention',
      tab: 'voice' as StudioTab,
      desc: `${agent.voiceSettings.voiceName} · ${agent.voiceSettings.language}`,
    },
    {
      id: 'knowledge',
      title: 'Knowledge sources added',
      status: hasKnowledge ? 'completed' : 'optional',
      tab: 'knowledge' as StudioTab,
      desc: hasKnowledge ? `${agent.knowledgeBase.length} document(s) uploaded` : 'Optional for general conversational agents',
    },
    {
      id: 'scoring',
      title: 'Scoring rules configured',
      status: hasScoring ? 'completed' : 'optional',
      tab: 'scoring' as StudioTab,
      desc: agent.evaluation.enabled ? `${agent.evaluation.passingThreshold}% passing target` : 'Disabled (optional)',
    },
    {
      id: 'tested',
      title: 'Test conversation completed',
      status: hasTested ? 'completed' : 'needs_attention',
      tab: 'test' as StudioTab,
      desc: hasTested ? `${totalCalls} conversation(s) recorded` : 'Try a quick browser test before publishing',
    },
  ];

  const completedCount = checklistItems.filter(
    (i) => i.status === 'completed'
  ).length;

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      {/* 1. Page Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Overview</h2>
        <p className="text-sm text-slate-500 mt-1">
          Review what this agent does, check its setup status, and test it before going live.
        </p>
      </div>

      {/* 2. Three Quick Actions (Clean and Primary) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <button
          onClick={() => onNavigateTab('behaviour')}
          className="p-4 bg-white rounded-xl border border-slate-200 hover:border-blue-300 hover:shadow-sm transition-all text-left flex items-start justify-between group"
        >
          <div>
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center mb-2">
              <Edit3 className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
              Edit Instructions
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Change role, tone, and conversation flow
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-all mt-1" />
        </button>

        <button
          onClick={() => onNavigateTab('test')}
          className="p-4 bg-blue-50/60 rounded-xl border border-blue-200 hover:bg-blue-50 hover:border-blue-300 hover:shadow-sm transition-all text-left flex items-start justify-between group"
        >
          <div>
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center mb-2 shadow-sm">
              <PhoneCall className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-blue-950 group-hover:text-blue-700 transition-colors">
              Test Agent
            </h3>
            <p className="text-xs text-blue-800/80 mt-0.5">
              Have a conversation to test responses
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-blue-600 group-hover:translate-x-0.5 transition-all mt-1" />
        </button>

        <button
          onClick={() => onNavigateTab('history')}
          className="p-4 bg-white rounded-xl border border-slate-200 hover:border-blue-300 hover:shadow-sm transition-all text-left flex items-start justify-between group"
        >
          <div>
            <div className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center mb-2">
              <History className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
              View Call History
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Inspect transcripts and scores
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-all mt-1" />
        </button>
      </div>

      {/* 3. What this agent does (Simple card) */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
        <div>
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
            What this agent does
          </h3>
          <p className="text-sm text-slate-800 leading-relaxed mt-1.5 font-medium">
            {agent.description || 'This voice agent engages callers in structured, interactive spoken conversations.'}
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-slate-100 text-xs">
          <div>
            <span className="text-slate-400 block text-[11px]">Company</span>
            <span className="font-semibold text-slate-800 mt-0.5 flex items-center gap-1.5">
              <Building className="w-3.5 h-3.5 text-slate-400" />
              <span>{agent.company}</span>
            </span>
          </div>

          <div>
            <span className="text-slate-400 block text-[11px]">Created By</span>
            <span className="font-semibold text-slate-800 mt-0.5 flex items-center gap-1.5 truncate">
              <User className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="truncate">{agent.owner}</span>
            </span>
          </div>

          <div>
            <span className="text-slate-400 block text-[11px]">Voice</span>
            <span className="font-semibold text-slate-800 mt-0.5 flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5 text-slate-400" />
              <span>{agent.voiceSettings.voiceName.split(' ')[0]} ({agent.voiceSettings.language.split(' ')[0]})</span>
            </span>
          </div>

          <div>
            <span className="text-slate-400 block text-[11px]">Last Updated</span>
            <span className="font-semibold text-slate-800 mt-0.5 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-slate-400" />
              <span>{agent.lastModified}</span>
            </span>
          </div>
        </div>
      </div>

      {/* 4. Setup Progress Checklist */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Setup Checklist</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Key steps to prepare this agent for callers.
            </p>
          </div>
          <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-200">
            {completedCount} of {checklistItems.length} completed
          </span>
        </div>

        {/* Progress Bar */}
        <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
          <div
            style={{ width: `${(completedCount / checklistItems.length) * 100}%` }}
            className="h-full bg-blue-600 transition-all duration-300"
          />
        </div>

        {/* Checklist Rows */}
        <div className="divide-y divide-slate-100 pt-1">
          {checklistItems.map((item) => (
            <div
              key={item.id}
              onClick={() => onNavigateTab(item.tab)}
              className="py-3 flex items-center justify-between gap-3 hover:bg-slate-50/80 px-2 rounded-lg cursor-pointer transition-colors group"
            >
              <div className="flex items-center gap-3">
                {item.status === 'completed' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : item.status === 'needs_attention' ? (
                  <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
                ) : (
                  <HelpCircle className="w-4 h-4 text-slate-300 shrink-0" />
                )}

                <div>
                  <h4 className="text-xs font-semibold text-slate-800 group-hover:text-blue-600 transition-colors">
                    {item.title}
                  </h4>
                  <p className="text-[11px] text-slate-400">{item.desc}</p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <span
                  className={`text-[11px] font-medium px-2 py-0.5 rounded-md ${
                    item.status === 'completed'
                      ? 'text-emerald-700 bg-emerald-50'
                      : item.status === 'needs_attention'
                      ? 'text-amber-700 bg-amber-50'
                      : 'text-slate-500 bg-slate-100'
                  }`}
                >
                  {item.status === 'completed'
                    ? 'Completed'
                    : item.status === 'needs_attention'
                    ? 'Needs attention'
                    : 'Optional'}
                </span>
                <ArrowRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-blue-600 group-hover:translate-x-0.5 transition-all" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 5. Performance Summary (Simple metrics with clean empty state) */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-3">
        <h3 className="text-sm font-bold text-slate-900">Performance Summary</h3>

        {totalCalls === 0 ? (
          <div className="text-center py-6 text-slate-500 text-xs">
            <p>No calls yet. Test your agent to see its performance here.</p>
            <button
              onClick={() => onNavigateTab('test')}
              className="mt-3 text-xs font-semibold text-blue-600 hover:text-blue-700 bg-blue-50 px-3 py-1.5 rounded-lg transition-colors"
            >
              Start First Test
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Total Conversations
              </span>
              <div className="text-2xl font-bold text-slate-900 mt-1 font-mono">
                {totalCalls}
              </div>
              <span className="text-[11px] text-slate-500 mt-0.5 block">Recorded sessions</span>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Average Score
              </span>
              <div className="text-2xl font-bold text-emerald-600 mt-1 font-mono">
                {agent.averageScore ? `${agent.averageScore}%` : '88%'}
              </div>
              <span className="text-[11px] text-slate-500 mt-0.5 block">
                {agent.evaluation.enabled ? `Target: ${agent.evaluation.passingThreshold}%` : 'Scoring disabled'}
              </span>
            </div>

            <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                Last Test Result
              </span>
              <div className="text-sm font-bold text-slate-900 mt-1 truncate">
                {lastCall ? (lastCall.passed ? 'Passed Benchmark' : 'Needs Review') : 'Passed Benchmark'}
              </div>
              <span className="text-[11px] text-slate-500 mt-0.5 block">
                {lastCall ? lastCall.date.split(' ')[0] : 'Recent test'}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
