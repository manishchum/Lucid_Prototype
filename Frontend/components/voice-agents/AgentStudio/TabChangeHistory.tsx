"use client";
import React, { useState } from 'react';
import { VoiceAgent, PromptVersionRecord } from '@/types/voice-agents';
import { useApp } from '@/contexts/voice-agents-context';
import { compileStructuredToRaw } from '@/lib/voice-agents/promptUtils';
import {
  History,
  RotateCcw,
  CheckCircle2,
  Clock,
  User,
  GitCompare,
  X,
} from 'lucide-react';

interface TabChangeHistoryProps {
  agent: VoiceAgent;
}

export const TabChangeHistory: React.FC<TabChangeHistoryProps> = ({ agent }) => {
  const { rollbackAgentVersion, permissions, showToast } = useApp();

  const [compareTarget, setCompareTarget] = useState<PromptVersionRecord | null>(null);

  const handleRollback = (ver: PromptVersionRecord) => {
    if (!permissions.canEditPrompts) {
      showToast('Permission Denied', 'Your role cannot restore configurations.', 'error');
      return;
    }
    rollbackAgentVersion(agent.id, ver.version);
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Change History</h2>
        <p className="text-sm text-slate-500 mt-1">
          Review past updates made to this agent, compare changes, or restore an earlier version.
        </p>
      </div>

      {/* Timeline */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900">Past Updates</h3>
          <span className="text-xs text-slate-400">
            {agent.versions.length} checkpoint(s) saved
          </span>
        </div>

        <div className="divide-y divide-slate-100">
          {agent.versions.map((ver, idx) => {
            const isLive = ver.version === agent.publishedVersion;

            return (
              <div
                key={ver.version}
                className="p-5 flex items-start justify-between gap-4 hover:bg-slate-50/70 transition-colors"
              >
                <div className="flex items-start gap-3.5">
                  <div
                    className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs shrink-0 ${
                      isLive
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-100 text-slate-700'
                    }`}
                  >
                    {ver.version}
                  </div>

                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-xs text-slate-900">{ver.version}</span>
                      {isLive && (
                        <span className="text-[10px] font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.2 rounded-full">
                          Currently Active
                        </span>
                      )}
                      <span className="text-[11px] text-slate-400 font-mono">{ver.updatedAt}</span>
                    </div>

                    <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                      {ver.changeDescription}
                    </p>

                    <div className="text-[11px] text-slate-400 mt-1 flex items-center gap-1.5">
                      <User className="w-3 h-3 text-slate-400" />
                      <span>Updated by {ver.updatedBy}</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setCompareTarget(ver)}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 shadow-sm"
                  >
                    <GitCompare className="w-3.5 h-3.5 text-blue-600" />
                    <span>Compare</span>
                  </button>

                  {!isLive && permissions.canEditPrompts && (
                    <button
                      onClick={() => handleRollback(ver)}
                      className="flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 rounded-lg transition-colors"
                      title="Revert to this version"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Restore</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Compare Modal */}
      {compareTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Snapshot: {compareTarget.version}
                </h3>
                <p className="text-xs text-slate-500">{compareTarget.changeDescription}</p>
              </div>
              <button
                onClick={() => setCompareTarget(null)}
                className="text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 text-xs">
              <pre className="p-4 bg-slate-950 text-emerald-400 font-mono text-xs rounded-xl overflow-x-auto leading-relaxed">
                {compileStructuredToRaw(compareTarget.promptStructured)}
              </pre>
            </div>

            <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs">
              <span className="text-slate-400">Recorded {compareTarget.updatedAt}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setCompareTarget(null)}
                  className="px-4 py-1.5 text-slate-700 bg-white border border-slate-300 rounded-lg"
                >
                  Close
                </button>
                {permissions.canEditPrompts && (
                  <button
                    onClick={() => {
                      handleRollback(compareTarget);
                      setCompareTarget(null);
                    }}
                    className="px-4 py-1.5 text-white bg-blue-600 hover:bg-blue-700 rounded-lg font-semibold shadow-sm"
                  >
                    Restore This Version
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
