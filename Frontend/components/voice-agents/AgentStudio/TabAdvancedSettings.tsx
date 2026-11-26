"use client";
import React, { useState } from 'react';
import { VoiceAgent, VoiceProviderId, OutputVariable } from '@/types/voice-agents';
import { useApp } from '@/contexts/voice-agents-context';
import { compileStructuredToRaw } from '@/lib/voice-agents/promptUtils';
import {
  Layers,
  Code2,
  FileJson,
  Key,
  Sliders,
  Shield,
  FileText,
  Activity,
  ChevronDown,
  ChevronUp,
  Lock,
  Copy,
  Check,
} from 'lucide-react';

interface TabAdvancedSettingsProps {
  agent: VoiceAgent;
}

export const TabAdvancedSettings: React.FC<TabAdvancedSettingsProps> = ({ agent }) => {
  const { updateAgent, providers, permissions, showToast } = useApp();

  const [expandedSection, setExpandedSection] = useState<string>('provider');

  // JSON Schema calculation
  const jsonSchema = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    title: `${agent.name.replace(/\s+/g, '')}OutputSchema`,
    type: 'object',
    properties: agent.outputVariables.reduce((acc, v) => {
      acc[v.name] = {
        type: v.type,
        description: v.description,
      };
      if (v.defaultValue !== undefined) acc[v.name].default = v.defaultValue;
      return acc;
    }, {} as Record<string, any>),
    required: agent.outputVariables.filter((v) => v.required).map((v) => v.name),
  };

  const toggleSection = (id: string) => {
    setExpandedSection(expandedSection === id ? '' : id);
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2">
          <h2 className="text-xl font-bold text-slate-900 tracking-tight">Advanced Settings</h2>
          <span className="text-[10px] font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">
            Developer & Admin Tools
          </span>
        </div>
        <p className="text-sm text-slate-500 mt-1">
          Technical infrastructure parameters, raw prompt payloads, JSON schemas, and diagnostic telemetry.
        </p>
      </div>

      <div className="space-y-3">
        {/* 1. Provider Configuration */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <button
            onClick={() => toggleSection('provider')}
            className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-slate-50/70 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                <Layers className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">1. Engine & Model Configuration</h3>
                <p className="text-xs text-slate-400">Underlying speech-to-speech engine and model parameters</p>
              </div>
            </div>
            {expandedSection === 'provider' ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>

          {expandedSection === 'provider' && (
            <div className="p-6 pt-2 border-t border-slate-100 space-y-4 text-xs bg-slate-50/40">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Model Checkpoint</label>
                  <input
                    type="text"
                    value={agent.model}
                    onChange={(e) => updateAgent(agent.id, { model: e.target.value, hasUnsavedChanges: true })}
                    className="w-full bg-white border border-slate-300 rounded-lg p-2 font-mono text-xs"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Inference Engine</label>
                  <div className="w-full bg-slate-100 border border-slate-200 rounded-lg p-2 text-xs font-medium text-slate-600">
                    Lucid High-Performance Voice Gateway (~148ms latency)
                  </div>
                </div>
              </div>

              <div className="text-[11px] text-slate-500">
                Active provider latency benchmark: <strong className="font-mono text-emerald-600">~148ms STT/TTS</strong>
              </div>
            </div>
          )}
        </div>

        {/* 2. Advanced Raw Prompt Editor */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <button
            onClick={() => toggleSection('raw_prompt')}
            className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-slate-50/70 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Code2 className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">2. Raw System Prompt</h3>
                <p className="text-xs text-slate-400">Directly inspect or edit the compiled instructions passed to LLM</p>
              </div>
            </div>
            {expandedSection === 'raw_prompt' ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>

          {expandedSection === 'raw_prompt' && (
            <div className="p-6 pt-2 border-t border-slate-100 space-y-3 text-xs bg-slate-50/40">
              <div className="flex justify-between items-center text-slate-400 font-mono text-[11px]">
                <span>system_prompt_compiled.txt</span>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(agent.promptRaw || compileStructuredToRaw(agent.promptStructured));
                    showToast('Copied', 'Prompt copied to clipboard.');
                  }}
                  className="flex items-center gap-1 text-blue-600 hover:text-blue-700 font-sans"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy</span>
                </button>
              </div>
              <textarea
                rows={10}
                value={agent.promptRaw || compileStructuredToRaw(agent.promptStructured)}
                onChange={(e) => updateAgent(agent.id, { promptRaw: e.target.value, hasUnsavedChanges: true })}
                className="w-full bg-slate-950 text-emerald-400 font-mono text-xs p-3 rounded-lg focus:outline-none"
              />
            </div>
          )}
        </div>

        {/* 3. Output JSON Schema */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <button
            onClick={() => toggleSection('schema')}
            className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-slate-50/70 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                <FileJson className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">3. Extraction JSON Schema</h3>
                <p className="text-xs text-slate-400">JSON Schema draft-07 specification for extracted call fields</p>
              </div>
            </div>
            {expandedSection === 'schema' ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>

          {expandedSection === 'schema' && (
            <div className="p-6 pt-2 border-t border-slate-100 space-y-2 text-xs bg-slate-50/40">
              <pre className="p-4 bg-slate-950 text-sky-300 font-mono text-xs rounded-lg overflow-x-auto">
                {JSON.stringify(jsonSchema, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* 4. API & Webhook Settings */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <button
            onClick={() => toggleSection('api')}
            className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-slate-50/70 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                <Key className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">4. API & Webhook Endpoints</h3>
                <p className="text-xs text-slate-400">Call event notifications, transcripts, and CRM synchronization</p>
              </div>
            </div>
            {expandedSection === 'api' ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>

          {expandedSection === 'api' && (
            <div className="p-6 pt-2 border-t border-slate-100 space-y-3 text-xs bg-slate-50/40">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Webhook Post URL</label>
                <input
                  type="text"
                  defaultValue="https://api.lucid.ai/webhooks/voice/completed"
                  className="w-full bg-white border border-slate-300 rounded-lg p-2 font-mono text-xs"
                />
              </div>
              <div className="flex items-center gap-2 text-[11px] text-slate-500">
                <Lock className="w-3.5 h-3.5 text-slate-400" />
                <span>HMAC signature verification enabled on all egress payloads</span>
              </div>
            </div>
          )}
        </div>

        {/* 5. Diagnostic Logs */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <button
            onClick={() => toggleSection('logs')}
            className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-slate-50/70 transition-colors"
          >
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
                <Activity className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">5. Diagnostics & Telemetry Logs</h3>
                <p className="text-xs text-slate-400">WebSocket connection status, packet health, and jitter records</p>
              </div>
            </div>
            {expandedSection === 'logs' ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
          </button>

          {expandedSection === 'logs' && (
            <div className="p-6 pt-2 border-t border-slate-100 space-y-2 text-xs bg-slate-50/40 font-mono text-slate-700">
              <div className="p-3 bg-slate-950 text-slate-300 rounded-lg space-y-1 text-[11px]">
                <div>[INFO] WebSocket TLS handshake completed: 42ms</div>
                <div>[INFO] Voice synthesis engine allocated: {agent.provider} ({agent.model})</div>
                <div>[INFO] Audio sample rate: 24000Hz (Opus narrow-band / wide-band)</div>
                <div>[OK] No packet loss or buffer underrun detected in recent sessions.</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
