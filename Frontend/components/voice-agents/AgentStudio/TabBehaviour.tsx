"use client";
import React, { useState } from 'react';
import { VoiceAgent, OutputVariable } from '@/types/voice-agents';
import { useApp } from '@/contexts/voice-agents-context';
import { compileStructuredToRaw, STANDARD_VARIABLES } from '@/lib/voice-agents/promptUtils';
import {
  Sparkles,
  Plus,
  Trash2,
  Edit2,
  Check,
  X,
  Code2,
  Sliders,
  ChevronDown,
  ChevronUp,
  Info,
  ShieldAlert,
  ArrowUpDown,
  FileCheck,
  CheckCircle2,
} from 'lucide-react';

interface TabBehaviourProps {
  agent: VoiceAgent;
}

export const TabBehaviour: React.FC<TabBehaviourProps> = ({ agent }) => {
  const { updateAgent, permissions, showToast } = useApp();

  const [isAdvancedMode, setIsAdvancedMode] = useState(false);

  // Basic Mode Form States derived from agent.promptStructured
  const [agentName, setAgentName] = useState(
    agent.promptStructured.agentIdentity?.split(',')[0]?.replace('You are ', '') || 'Alex'
  );
  const [agentRole, setAgentRole] = useState(
    agent.promptStructured.agentIdentity || 'Senior Evaluation Coach assessing management competencies.'
  );
  const [purpose, setPurpose] = useState(
    agent.promptStructured.roleAndObjective || 'Conduct an interactive, fair evaluation to determine readiness for leadership.'
  );

  // Tone presets
  const tonePresets = [
    { id: 'friendly_conversational', label: 'Friendly & Conversational', desc: 'Warm, approachable, and encouraging tone' },
    { id: 'professional_formal', label: 'Professional & Formal', desc: 'Polished, articulate, objective, and executive-ready' },
    { id: 'authoritative', label: 'Friendly but Authoritative', desc: 'Firm, confident, coaching-oriented, and decisive' },
    { id: 'persuasive_sales', label: 'Persuasive & Sales-Focused', desc: 'High energy, consultative, and value-focused' },
    { id: 'custom', label: 'Custom Tone', desc: 'Define your own specific conversational style' },
  ];

  const [selectedToneId, setSelectedToneId] = useState<string>(() => {
    const t = (agent.promptStructured.personalityAndTone || '').toLowerCase();
    if (t.includes('formal') || t.includes('professional')) return 'professional_formal';
    if (t.includes('sales') || t.includes('persuasive')) return 'persuasive_sales';
    if (t.includes('authoritative') || t.includes('sharp')) return 'authoritative';
    if (t.includes('friendly') || t.includes('warm')) return 'friendly_conversational';
    return 'authoritative';
  });
  const [customToneText, setCustomToneText] = useState(agent.promptStructured.personalityAndTone || '');

  // Conversation Flow Steps (parsed from flow text or defaults)
  const defaultFlowSteps = [
    { id: '1', title: '1. Greeting & Introduction', text: 'Warmly introduce yourself and confirm caller identity and readiness.' },
    { id: '2', title: '2. Understanding & Context', text: 'Ask open-ended questions to clarify the background and current situation.' },
    { id: '3', title: '3. Main Discussion & Scenarios', text: 'Present the primary scenarios or questions and probe decision-making.' },
    { id: '4', title: '4. Follow-up & Handling Concerns', text: 'Clarify any ambiguities and test objection handling under pressure.' },
    { id: '5', title: '5. Closing & Next Steps', text: 'Thank the caller, summarize key points, and explain the next review steps.' },
  ];

  const [flowSteps, setFlowSteps] = useState(defaultFlowSteps);
  const [editingFlowId, setEditingFlowId] = useState<string | null>(null);

  // Rules and Restrictions (parsed from behaviouralRules or defaults)
  const [rules, setRules] = useState<string[]>([
    'Never provide the correct answer or solution directly to the candidate.',
    'Remain courteous and calm if the caller expresses frustration or pushes back.',
    'Always verify key facts before moving to the next conversation phase.',
    'Do not share internal confidential evaluation rubrics or formulas.',
  ]);
  const [newRuleText, setNewRuleText] = useState('');

  // Additional Instructions
  const [additionalInstructions, setAdditionalInstructions] = useState(
    agent.promptStructured.contextAndBackground || ''
  );

  // Output Variables / Information to Collect
  const [isVarModalOpen, setIsVarModalOpen] = useState(false);
  const [editingVar, setEditingVar] = useState<OutputVariable | null>(null);
  const [varName, setVarName] = useState('');
  const [varDesc, setVarDesc] = useState('');
  const [varRequired, setVarRequired] = useState(true);

  // Raw Prompt in Advanced Mode
  const [rawPromptText, setRawPromptText] = useState(
    agent.promptRaw || compileStructuredToRaw(agent.promptStructured)
  );

  // Save Basic Mode Changes
  const handleSaveBasicMode = () => {
    let resolvedTone = customToneText;
    if (selectedToneId !== 'custom') {
      const match = tonePresets.find((p) => p.id === selectedToneId);
      resolvedTone = match ? match.desc : customToneText;
    }

    const flowCompiled = flowSteps.map((s) => `${s.title}: ${s.text}`).join('\n');
    const rulesCompiled = rules.map((r) => `- ${r}`).join('\n');

    const updatedStructured = {
      ...agent.promptStructured,
      agentIdentity: `You are ${agentName}. ${agentRole}`,
      roleAndObjective: purpose,
      personalityAndTone: resolvedTone,
      conversationFlow: flowCompiled,
      behaviouralRules: rulesCompiled,
      contextAndBackground: additionalInstructions,
    };

    const updatedRaw = compileStructuredToRaw(updatedStructured);

    updateAgent(agent.id, {
      promptStructured: updatedStructured,
      promptRaw: updatedRaw,
      hasUnsavedChanges: true,
    });

    showToast('Agent Behaviour Saved', 'Updated instructions saved.');
  };

  // Add / Edit Information Field
  const handleSaveInformationField = () => {
    if (!varName.trim()) return;

    const formattedName = varName.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_');

    if (editingVar) {
      const updatedList = agent.outputVariables.map((v) =>
        v.id === editingVar.id
          ? { ...v, name: formattedName, description: varDesc.trim(), required: varRequired }
          : v
      );
      updateAgent(agent.id, { outputVariables: updatedList });
      showToast('Field Updated', `Updated "${formattedName}".`);
    } else {
      const newField: OutputVariable = {
        id: `field-${Date.now()}`,
        name: formattedName,
        description: varDesc.trim() || `Information about ${formattedName}`,
        type: 'string',
        required: varRequired,
        defaultValue: '',
      };
      updateAgent(agent.id, { outputVariables: [...agent.outputVariables, newField] });
      showToast('Field Added', `Added "${formattedName}" to collected information.`);
    }

    setIsVarModalOpen(false);
  };

  const handleDeleteInformationField = (id: string) => {
    const updated = agent.outputVariables.filter((v) => v.id !== id);
    updateAgent(agent.id, { outputVariables: updated });
    showToast('Field Removed', 'Removed information field.');
  };

  const handleAddRule = () => {
    if (!newRuleText.trim()) return;
    setRules((prev) => [...prev, newRuleText.trim()]);
    setNewRuleText('');
  };

  const handleDeleteRule = (index: number) => {
    setRules((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      {/* Top Header with Advanced Mode Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2 border-b border-slate-200">
        <div>
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Agent Behaviour</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            Describe who this agent is, what it should accomplish, and how it should speak with people.
          </p>
        </div>

        {/* Advanced Mode Toggle */}
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200 px-3 py-1.5 rounded-lg cursor-pointer transition-colors">
            <input
              type="checkbox"
              checked={isAdvancedMode}
              onChange={(e) => setIsAdvancedMode(e.target.checked)}
              className="rounded text-blue-600 focus:ring-blue-500 w-3.5 h-3.5"
            />
            <span>Advanced prompt editing</span>
          </label>

          <button
            onClick={handleSaveBasicMode}
            className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors"
          >
            Save Changes
          </button>
        </div>
      </div>

      {!isAdvancedMode ? (
        /* BASIC / GUIDED MODE FOR MANAGERS */
        <div className="space-y-5">
          {/* 1. Who is this agent? */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center">
                1
              </span>
              <h3 className="text-sm font-bold text-slate-900">Who is this agent?</h3>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Agent Name</label>
                <input
                  type="text"
                  value={agentName}
                  onChange={(e) => setAgentName(e.target.value)}
                  placeholder="e.g. Alex"
                  className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Role & Title</label>
                <input
                  type="text"
                  value={agentRole}
                  onChange={(e) => setAgentRole(e.target.value)}
                  placeholder="e.g. Senior Customer Support Representative"
                  className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* 2. What should it accomplish? */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center">
                2
              </span>
              <h3 className="text-sm font-bold text-slate-900">What should it accomplish?</h3>
            </div>
            <p className="text-xs text-slate-500">
              What is the main purpose of this agent during conversations?
            </p>
            <textarea
              rows={3}
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="e.g. Guide store managers through crisis resolution scenarios, verify food safety logs, and score leadership responses."
              className="w-full bg-white border border-slate-300 rounded-lg p-3 text-xs text-slate-800 leading-relaxed focus:ring-1 focus:ring-blue-500 focus:outline-none"
            />
          </div>

          {/* 3. How should it communicate? */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-3">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center">
                3
              </span>
              <h3 className="text-sm font-bold text-slate-900">How should it communicate?</h3>
            </div>
            <p className="text-xs text-slate-500">
              Select the conversational personality callers should experience.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              {tonePresets.map((preset) => {
                const isSelected = selectedToneId === preset.id;
                return (
                  <div
                    key={preset.id}
                    onClick={() => setSelectedToneId(preset.id)}
                    className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                      isSelected
                        ? 'border-blue-600 bg-blue-50/50 shadow-sm'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/60'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900">{preset.label}</span>
                      {isSelected && <Check className="w-4 h-4 text-blue-600" />}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1 leading-normal">{preset.desc}</p>
                  </div>
                );
              })}
            </div>

            {selectedToneId === 'custom' && (
              <div className="pt-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Custom Tone Description
                </label>
                <input
                  type="text"
                  value={customToneText}
                  onChange={(e) => setCustomToneText(e.target.value)}
                  placeholder="e.g. Inquisitive, polite, concise, and academically rigorous"
                  className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>
            )}
          </div>

          {/* 4. How should the conversation work? */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center">
                  4
                </span>
                <h3 className="text-sm font-bold text-slate-900">How should the conversation work?</h3>
              </div>
              <span className="text-xs text-slate-400">Step-by-step dialogue flow</span>
            </div>

            <div className="space-y-2.5">
              {flowSteps.map((step, idx) => (
                <div
                  key={step.id}
                  className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs flex items-start justify-between gap-3"
                >
                  <div className="flex-1">
                    <span className="font-bold text-slate-800">{step.title}</span>
                    <p className="text-slate-600 mt-0.5">{step.text}</p>
                  </div>
                  <button
                    onClick={() => {
                      const newText = prompt('Edit step instructions:', step.text);
                      if (newText) {
                        setFlowSteps((prev) =>
                          prev.map((s) => (s.id === step.id ? { ...s, text: newText } : s))
                        );
                      }
                    }}
                    className="p-1 text-slate-400 hover:text-blue-600 rounded"
                    title="Edit step"
                  >
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* 5. What should the agent avoid? */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
            <div className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 font-bold text-xs flex items-center justify-center">
                5
              </span>
              <h3 className="text-sm font-bold text-slate-900">What should the agent avoid?</h3>
            </div>
            <p className="text-xs text-slate-500">
              Important boundaries and rules your agent must always follow.
            </p>

            <div className="space-y-2">
              {rules.map((rule, idx) => (
                <div
                  key={idx}
                  className="p-2.5 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-700 flex items-center justify-between gap-2"
                >
                  <span className="flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0" />
                    <span>{rule}</span>
                  </span>
                  <button
                    onClick={() => handleDeleteRule(idx)}
                    className="text-slate-400 hover:text-rose-600 p-1"
                    title="Remove rule"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            {/* Add Rule Input */}
            <div className="flex items-center gap-2 pt-1">
              <input
                type="text"
                value={newRuleText}
                onChange={(e) => setNewRuleText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddRule()}
                placeholder="Add a new rule (e.g., Never promise discounts over 10%)..."
                className="flex-1 bg-white border border-slate-300 rounded-lg p-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
              />
              <button
                onClick={handleAddRule}
                disabled={!newRuleText.trim()}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 rounded-lg"
              >
                Add Rule
              </button>
            </div>
          </div>

          {/* 6. What information should this agent collect? (Redesigned Section 5) */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  What information should this agent collect?
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Choose the information you want the agent to identify and return after each conversation.
                </p>
              </div>

              <button
                onClick={() => {
                  setEditingVar(null);
                  setVarName('');
                  setVarDesc('');
                  setVarRequired(true);
                  setIsVarModalOpen(true);
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Information Field</span>
              </button>
            </div>

            <div className="divide-y divide-slate-100 border border-slate-200 rounded-xl overflow-hidden">
              {agent.outputVariables.map((v) => (
                <div
                  key={v.id}
                  className="p-3.5 bg-white hover:bg-slate-50/70 transition-colors flex items-center justify-between gap-3 text-xs"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-900">{v.name.replace(/_/g, ' ')}</span>
                      {v.required ? (
                        <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.2 rounded">
                          Required
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-0.2 rounded">
                          Optional
                        </span>
                      )}
                    </div>
                    <p className="text-slate-500 text-[11px] mt-0.5">{v.description}</p>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => {
                        setEditingVar(v);
                        setVarName(v.name);
                        setVarDesc(v.description);
                        setVarRequired(v.required);
                        setIsVarModalOpen(true);
                      }}
                      className="p-1.5 text-slate-400 hover:text-slate-700 rounded-md hover:bg-slate-100"
                      title="Edit field"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteInformationField(v.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded-md hover:bg-rose-50"
                      title="Remove field"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 7. Additional Context / Notes */}
          <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-3">
            <h3 className="text-sm font-bold text-slate-900">Additional Instructions (Optional)</h3>
            <p className="text-xs text-slate-500">
              Any specific company policies or situational background the agent should be aware of.
            </p>
            <textarea
              rows={3}
              value={additionalInstructions}
              onChange={(e) => setAdditionalInstructions(e.target.value)}
              placeholder="e.g. Callers are Store General Managers who manage KFC franchise operations."
              className="w-full bg-white border border-slate-300 rounded-lg p-2.5 text-xs text-slate-800 focus:ring-1 focus:ring-blue-500 focus:outline-none"
            />
          </div>
        </div>
      ) : (
        /* ADVANCED MODE: RAW INSTRUCTIONS & VARIABLES */
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden space-y-4 p-6">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Complete System Prompt (Raw Editor)</h3>
              <p className="text-xs text-slate-500">
                Full underlying conversational instruction set passed to the inference engine.
              </p>
            </div>
            <span className="text-xs font-mono text-slate-400">
              {rawPromptText.length} characters
            </span>
          </div>

          <textarea
            rows={16}
            value={rawPromptText}
            onChange={(e) => {
              setRawPromptText(e.target.value);
              updateAgent(agent.id, { promptRaw: e.target.value, hasUnsavedChanges: true });
            }}
            className="w-full bg-slate-950 text-emerald-400 font-mono text-xs p-4 rounded-xl focus:outline-none leading-relaxed"
            spellCheck={false}
          />

          <div className="p-3 bg-blue-50 rounded-xl border border-blue-200 text-xs text-blue-900 flex items-start gap-2">
            <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <p>
              In Advanced Mode, edits to the raw prompt are saved directly without altering individual structured fields until synced.
            </p>
          </div>
        </div>
      )}

      {/* Add / Edit Information Field Modal */}
      {isVarModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <h3 className="text-sm font-bold text-slate-900">
                {editingVar ? 'Edit Information Field' : 'Add Information Field'}
              </h3>
              <button
                onClick={() => setIsVarModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Field Name *</label>
                <input
                  type="text"
                  value={varName}
                  onChange={(e) => setVarName(e.target.value)}
                  placeholder="e.g. Customer Satisfaction or Strengths"
                  className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  What should the agent look for? *
                </label>
                <textarea
                  rows={2}
                  value={varDesc}
                  onChange={(e) => setVarDesc(e.target.value)}
                  placeholder="e.g. Candidate demonstration of conflict resolution skills"
                  className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div className="pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={varRequired}
                    onChange={(e) => setVarRequired(e.target.checked)}
                    className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4"
                  />
                  <span className="font-semibold text-slate-700">
                    Required (must be collected in every conversation)
                  </span>
                </label>
              </div>
            </div>

            <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-end gap-2">
              <button
                onClick={() => setIsVarModalOpen(false)}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveInformationField}
                disabled={!varName.trim()}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg shadow-sm"
              >
                Save Field
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
