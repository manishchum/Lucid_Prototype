"use client";
import React, { useState, useMemo } from 'react';
import { VoiceAgent, CallRecord } from '@/types/voice-agents';
import { useApp } from '@/contexts/voice-agents-context';
import {
  Phone,
  Mic,
  Calendar,
  Search,
  CheckCircle2,
  XCircle,
  Eye,
  Play,
  Pause,
  Clock,
  X,
  Volume2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface TabCallHistoryProps {
  agent: VoiceAgent;
}

export const TabCallHistory: React.FC<TabCallHistoryProps> = ({ agent }) => {
  const { callHistory, showToast } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCall, setSelectedCall] = useState<CallRecord | null>(null);
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  // Calls scoped to this agent
  const agentCalls = useMemo(() => {
    return callHistory.filter((c) => {
      // Scoped strictly to this agent ID
      if (c.agentId !== agent.id) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchCaller = c.caller.toLowerCase().includes(q);
        const matchSummary = c.summary?.toLowerCase().includes(q);
        if (!matchCaller && !matchSummary) return false;
      }

      return true;
    });
  }, [callHistory, agent.id, searchQuery]);

  const toggleAudioReplay = () => {
    setIsPlayingAudio(!isPlayingAudio);
    if (!isPlayingAudio) {
      showToast('Audio Simulation', 'Simulating call playback for test session.');
      setTimeout(() => setIsPlayingAudio(false), 4000);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Call History</h2>
        <p className="text-sm text-slate-500 mt-1">
          Review past conversations, caller answers, and performance results.
        </p>
      </div>

      {/* Search Input */}
      <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by caller name or summary..."
            className="w-full pl-9 pr-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <span className="text-xs text-slate-500 font-medium">
          {agentCalls.length} call(s) recorded
        </span>
      </div>

      {/* Table */}
      {agentCalls.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-xs">
          <p>No call records found.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-semibold text-[11px]">
                <th className="py-3 px-4">Date & Time</th>
                <th className="py-3 px-3">Caller</th>
                <th className="py-3 px-3">Call Type</th>
                <th className="py-3 px-3">Duration</th>
                <th className="py-3 px-3">Result</th>
                <th className="py-3 px-4 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {agentCalls.map((call) => (
                <tr
                  key={call.id}
                  onClick={() => setSelectedCall(call)}
                  className="hover:bg-slate-50/70 transition-colors cursor-pointer group"
                >
                  <td className="py-3 px-4 text-slate-700 font-medium">
                    {call.date.split(' ')[0]}
                    <span className="text-slate-400 block text-[10px]">
                      {call.date.split(' ')[1] || ''}
                    </span>
                  </td>
                  <td className="py-3 px-3 font-semibold text-slate-900 truncate max-w-[150px]">
                    {call.caller}
                  </td>
                  <td className="py-3 px-3">
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700">
                      {call.type === 'phone' ? <Phone className="w-3 h-3 text-purple-600" /> : <Mic className="w-3 h-3 text-blue-600" />}
                      <span className="capitalize">{call.type}</span>
                    </span>
                  </td>
                  <td className="py-3 px-3 text-slate-600 font-mono">
                    {Math.floor(call.durationSeconds / 60)}m {call.durationSeconds % 60}s
                  </td>
                  <td className="py-3 px-3">
                    {call.score !== undefined ? (
                      <span className="font-bold text-emerald-600 font-mono">
                        {call.score}% ({call.passed ? 'Passed' : 'Needs Review'})
                      </span>
                    ) : (
                      <span className="text-emerald-700 font-medium">Completed</span>
                    )}
                  </td>
                  <td className="py-3 px-4 text-right">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedCall(call);
                      }}
                      className="text-xs font-semibold text-blue-600 hover:text-blue-800"
                    >
                      View Call
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Inspect Call Drawer */}
      {selectedCall && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white w-full max-w-lg h-full shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-right duration-150">
            {/* Header */}
            <div className="p-5 border-b border-slate-200 flex items-center justify-between bg-slate-50">
              <div>
                <h3 className="text-sm font-bold text-slate-900">Call Details</h3>
                <span className="text-xs text-slate-400">
                  {selectedCall.caller} · {selectedCall.date}
                </span>
              </div>
              <button
                onClick={() => setSelectedCall(null)}
                className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto flex-1 space-y-5 text-xs">
              {/* Playback Simulation */}
              <div className="p-3 bg-slate-100 rounded-xl flex items-center justify-between">
                <button
                  onClick={toggleAudioReplay}
                  className="flex items-center gap-2 font-bold text-slate-800 hover:text-blue-600"
                >
                  {isPlayingAudio ? <Pause className="w-4 h-4 text-blue-600" /> : <Play className="w-4 h-4 fill-current text-blue-600" />}
                  <span>{isPlayingAudio ? 'Simulating audio preview...' : 'Simulate call audio playback'}</span>
                  <span className="text-[10px] uppercase tracking-wider font-semibold bg-slate-200 text-slate-600 px-1.5 py-0.5 rounded">
                    Simulation
                  </span>
                </button>
                <span className="text-slate-500 font-mono">
                  {Math.floor(selectedCall.durationSeconds / 60)}m {selectedCall.durationSeconds % 60}s
                </span>
              </div>

              {/* Summary */}
              <div>
                <h4 className="font-bold text-slate-900 mb-1">Conversation Summary</h4>
                <p className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-slate-700 leading-relaxed">
                  {selectedCall.summary}
                </p>
              </div>

              {/* Score */}
              {selectedCall.score !== undefined && (
                <div>
                  <h4 className="font-bold text-slate-900 mb-1">Evaluation Result</h4>
                  <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 flex items-center justify-between">
                    <span className="font-semibold text-emerald-900">Overall Score</span>
                    <span className="text-base font-bold font-mono text-emerald-700">
                      {selectedCall.score}%
                    </span>
                  </div>
                </div>
              )}

              {/* Information Collected */}
              <div>
                <h4 className="font-bold text-slate-900 mb-1">Information Collected</h4>
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 space-y-1.5">
                  {Object.entries(selectedCall.extractedVariables || {}).map(([key, val]) => (
                    <div key={key} className="flex justify-between">
                      <span className="text-slate-500 capitalize">{key.replace(/_/g, ' ')}:</span>
                      <span className="font-semibold text-slate-800 truncate max-w-[200px]">
                        {typeof val === 'boolean' ? (val ? 'Yes' : 'No') : String(val)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Transcript */}
              <div>
                <h4 className="font-bold text-slate-900 mb-2">Transcript</h4>
                <div className="space-y-2 max-h-60 overflow-y-auto">
                  {(selectedCall.transcript || []).map((msg) => {
                    const isAgent = msg.sender === 'agent';
                    return (
                      <div
                        key={msg.id}
                        className={`p-3 rounded-xl leading-relaxed ${
                          isAgent ? 'bg-blue-50/60 text-blue-950' : 'bg-slate-100 text-slate-900'
                        }`}
                      >
                        <div className="font-bold text-[10px] text-slate-400 mb-0.5">
                          {isAgent ? agent.name : selectedCall.caller} · {msg.timestamp}
                        </div>
                        {msg.text}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Advanced Technical Details Dropdown */}
              <div className="pt-2 border-t border-slate-100">
                <button
                  onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
                  className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1"
                >
                  <span>Advanced Details</span>
                  {showTechnicalDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>

                {showTechnicalDetails && (
                  <div className="mt-2 p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1 font-mono text-[11px] text-slate-600">
                    <div>Call ID: {selectedCall.id}</div>
                    <div>Provider: {selectedCall.provider}</div>
                    <div>Latency: {selectedCall.latencyMs}ms</div>
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-slate-200 bg-slate-50 text-right">
              <button
                onClick={() => setSelectedCall(null)}
                className="px-4 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
