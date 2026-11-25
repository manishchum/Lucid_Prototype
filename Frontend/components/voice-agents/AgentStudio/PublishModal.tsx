"use client";
import React, { useState } from 'react';
import { useApp } from '@/contexts/voice-agents-context';
import { VoiceAgent } from '@/types/voice-agents';
import { Rocket, X, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react';

interface PublishModalProps {
  isOpen: boolean;
  onClose: () => void;
  agent: VoiceAgent;
}

export const PublishModal: React.FC<PublishModalProps> = ({ isOpen, onClose, agent }) => {
  const { publishAgent, permissions } = useApp();
  const [changeNotes, setChangeNotes] = useState('Updated conversation prompts and evaluation parameters.');

  if (!isOpen) return null;

  const currentVerNum = parseFloat(agent.publishedVersion.replace('v', '')) || 1.0;
  const targetVerStr = `v${(currentVerNum + 0.1).toFixed(1)}`;

  const handleConfirm = () => {
    publishAgent(agent.id, changeNotes);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
              <Rocket className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Publish Voice Agent</h3>
              <p className="text-xs text-slate-500">Promote draft configuration to active production environment.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Version Transition Card */}
          <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
            <div>
              <span className="text-slate-400 block text-[11px]">Current Active:</span>
              <span className="font-mono font-bold text-slate-700 text-sm">{agent.publishedVersion}</span>
            </div>
            <div className="text-slate-400 font-bold">⟶</div>
            <div>
              <span className="text-blue-600 font-bold block text-[11px]">New Release:</span>
              <span className="font-mono font-bold text-blue-600 text-sm">{targetVerStr}</span>
            </div>
            <div className="text-right">
              <span className="text-slate-400 block text-[11px]">Target Company:</span>
              <span className="font-semibold text-slate-800">{agent.company}</span>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Release Notes & Change Description *
            </label>
            <textarea
              rows={3}
              value={changeNotes}
              onChange={(e) => setChangeNotes(e.target.value)}
              placeholder="Summarize what was changed in this version (e.g., prompt tweaks, voice ID, evaluation rules)..."
              className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-900 flex items-start gap-2.5">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold">Safe Zero-Downtime Rollout</span>
              <p className="text-[11px] text-emerald-800 mt-0.5 leading-relaxed">
                Live calls currently in progress will terminate on the previous runtime, while new incoming test and production sessions will immediately adopt {targetVerStr}. Previous versions remain available for 1-click rollback.
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2.5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!changeNotes.trim() || !permissions.canPublish}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg shadow-sm transition-colors"
          >
            <Rocket className="w-3.5 h-3.5" />
            <span>Confirm & Publish {targetVerStr}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
