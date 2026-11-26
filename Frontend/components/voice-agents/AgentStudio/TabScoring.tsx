"use client";
import React, { useState } from 'react';
import { VoiceAgent, EvaluationCriterion } from '@/types/voice-agents';
import { useApp } from '@/contexts/voice-agents-context';
import {
  Award,
  Plus,
  Trash2,
  Edit2,
  CheckCircle2,
  X,
  Sliders,
  Check,
  Percent,
} from 'lucide-react';

interface TabScoringProps {
  agent: VoiceAgent;
}

export const TabScoring: React.FC<TabScoringProps> = ({ agent }) => {
  const { updateAgent, permissions, showToast } = useApp();

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [editingCrit, setEditingCrit] = useState<EvaluationCriterion | null>(null);

  const [critName, setCritName] = useState('');
  const [critDesc, setCritDesc] = useState('');
  const [critWeight, setCritWeight] = useState(30);
  const [critPass, setCritPass] = useState(70);

  const evaluation = agent.evaluation;

  const handleToggleScoring = (enabled: boolean) => {
    updateAgent(agent.id, {
      evaluation: {
        ...evaluation,
        enabled,
      },
      hasUnsavedChanges: true,
    });
    showToast(
      'Scoring Updated',
      enabled ? 'Call scoring enabled.' : 'Call scoring disabled for this agent.'
    );
  };

  const handlePassingThreshold = (score: number) => {
    updateAgent(agent.id, {
      evaluation: {
        ...evaluation,
        passingThreshold: score,
      },
      hasUnsavedChanges: true,
    });
  };

  const handleSaveCriterion = () => {
    if (!critName.trim()) return;

    if (editingCrit) {
      const updated = evaluation.criteria.map((c) =>
        c.id === editingCrit.id
          ? {
              ...c,
              name: critName.trim(),
              description: critDesc.trim(),
              weight: critWeight,
              passingScore: critPass,
            }
          : c
      );
      updateAgent(agent.id, {
        evaluation: { ...evaluation, criteria: updated },
        hasUnsavedChanges: true,
      });
      showToast('Criterion Saved', `Updated "${critName}".`);
    } else {
      const newCrit: EvaluationCriterion = {
        id: `crit-${Date.now()}`,
        name: critName.trim(),
        description: critDesc.trim(),
        weight: critWeight,
        passingScore: critPass,
      };
      updateAgent(agent.id, {
        evaluation: { ...evaluation, criteria: [...evaluation.criteria, newCrit] },
        hasUnsavedChanges: true,
      });
      showToast('Criterion Added', `Added "${critName}" to scoring rules.`);
    }

    setIsAddModalOpen(false);
  };

  const handleDeleteCriterion = (id: string) => {
    const updated = evaluation.criteria.filter((c) => c.id !== id);
    updateAgent(agent.id, {
      evaluation: { ...evaluation, criteria: updated },
      hasUnsavedChanges: true,
    });
    showToast('Criterion Removed', 'Removed criterion.');
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Scoring & Results</h2>
        <p className="text-sm text-slate-500 mt-1">
          Set whether this agent evaluates caller performance and define the passing benchmark.
        </p>
      </div>

      {/* Enable / Disable Toggle Card */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm flex items-center justify-between">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Score Conversations Automatically</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Turn this on for interview, training, or assessment agents. Turn off for general support.
          </p>
        </div>

        <button
          onClick={() => handleToggleScoring(!evaluation.enabled)}
          className={`px-4 py-2 rounded-lg text-xs font-semibold border transition-all ${
            evaluation.enabled
              ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
              : 'bg-slate-100 text-slate-700 border-slate-300 hover:bg-slate-200'
          }`}
        >
          {evaluation.enabled ? 'Scoring Enabled' : 'Scoring Disabled'}
        </button>
      </div>

      {evaluation.enabled ? (
        <>
          {/* Passing Score Target */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Passing Score</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  The minimum percentage a caller must achieve to pass.
                </p>
              </div>
              <span className="text-2xl font-bold font-mono text-blue-600">
                {evaluation.passingThreshold}%
              </span>
            </div>

            <div className="flex gap-2">
              {[60, 70, 75, 80, 85, 90].map((score) => (
                <button
                  key={score}
                  onClick={() => handlePassingThreshold(score)}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold border transition-all ${
                    evaluation.passingThreshold === score
                      ? 'border-blue-600 bg-blue-50 text-blue-700 font-bold'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  {score}%
                </button>
              ))}
            </div>
          </div>

          {/* What should be evaluated? */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">What should be evaluated?</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  The key skills or competencies the agent assesses during each call.
                </p>
              </div>

              <button
                onClick={() => {
                  setEditingCrit(null);
                  setCritName('');
                  setCritDesc('');
                  setCritWeight(30);
                  setCritPass(70);
                  setIsAddModalOpen(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Criterion</span>
              </button>
            </div>

            <div className="space-y-3">
              {evaluation.criteria.map((c) => (
                <div
                  key={c.id}
                  className="p-4 bg-slate-50 rounded-xl border border-slate-200 text-xs flex items-start justify-between gap-4"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-bold text-slate-900 text-xs">{c.name}</span>
                      <span className="text-[10px] font-semibold text-blue-700 bg-blue-100 px-2 py-0.2 rounded">
                        Importance: {c.weight >= 35 ? 'High' : c.weight >= 25 ? 'Medium' : 'Standard'} ({c.weight}%)
                      </span>
                      <span className="text-[10px] text-slate-500 bg-slate-200/80 px-2 py-0.2 rounded font-mono">
                        Pass target: {c.passingScore}%
                      </span>
                    </div>
                    <p className="text-slate-600 leading-relaxed text-[11px]">{c.description}</p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => {
                        setEditingCrit(c);
                        setCritName(c.name);
                        setCritDesc(c.description);
                        setCritWeight(c.weight);
                        setCritPass(c.passingScore);
                        setIsAddModalOpen(true);
                      }}
                      className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md"
                      title="Edit"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteCriterion(c.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-xs space-y-2">
          <Award className="w-8 h-8 text-slate-300 mx-auto mb-1" />
          <h4 className="font-bold text-slate-800">Scoring is turned off</h4>
          <p className="max-w-md mx-auto text-slate-400">
            This agent will answer and converse with callers without assigning test scores or grades.
          </p>
        </div>
      )}

      {/* Add / Edit Criterion Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                {editingCrit ? 'Edit Criterion' : 'Add Evaluation Criterion'}
              </h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Criterion Name *</label>
                <input
                  type="text"
                  value={critName}
                  onChange={(e) => setCritName(e.target.value)}
                  placeholder="e.g. Communication Skills or Problem Solving"
                  className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">What to look for *</label>
                <textarea
                  rows={2}
                  value={critDesc}
                  onChange={(e) => setCritDesc(e.target.value)}
                  placeholder="e.g. How clearly and empathetically the candidate responds"
                  className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Importance Level
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { label: 'Standard (20%)', val: 20 },
                    { label: 'Medium (30%)', val: 30 },
                    { label: 'High (50%)', val: 50 },
                  ].map((lvl) => (
                    <button
                      key={lvl.val}
                      type="button"
                      onClick={() => setCritWeight(lvl.val)}
                      className={`py-1.5 px-2 rounded-lg text-xs font-semibold border ${
                        critWeight === lvl.val
                          ? 'border-blue-600 bg-blue-50 text-blue-700'
                          : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {lvl.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveCriterion}
                disabled={!critName.trim()}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg shadow-sm"
              >
                Save Criterion
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
