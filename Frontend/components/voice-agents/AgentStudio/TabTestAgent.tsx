"use client";
import React, { useState, useEffect, useRef } from 'react';
import { VoiceAgent, TranscriptMessage, CallRecord } from '@/types/voice-agents';
import { useApp } from '@/contexts/voice-agents-context';
import {
  Mic,
  MicOff,
  Phone,
  PhoneCall,
  PhoneOff,
  Volume2,
  VolumeX,
  Play,
  RotateCcw,
  Sparkles,
  Download,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  Send,
  Zap,
  Check,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface TabTestAgentProps {
  agent: VoiceAgent;
  onNavigateTab?: (tab: any) => void;
}

export const TabTestAgent: React.FC<TabTestAgentProps> = ({ agent, onNavigateTab }) => {
  const { recordTestCall, permissions, showToast } = useApp();

  const [activeMode, setActiveMode] = useState<'browser' | 'phone'>('browser');

  // Call states: 'idle' | 'calling' | 'connected' | 'completed'
  const [callStatus, setCallStatus] = useState<'idle' | 'calling' | 'connected' | 'completed'>('idle');
  const [callDuration, setCallDuration] = useState(0);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(true);
  const [speakerTurn, setSpeakerTurn] = useState<'agent' | 'user' | 'idle'>('idle');

  // Interactive Transcript
  const [transcript, setTranscript] = useState<TranscriptMessage[]>([]);
  const [userInputText, setUserInputText] = useState('');
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  // Phone Form
  const [countryCode, setCountryCode] = useState('+1');
  const [phoneNumber, setPhoneNumber] = useState('555-019-8234');
  const [showPhoneConfirm, setShowPhoneConfirm] = useState(false);

  // Post-test Result Summary
  const [completedCall, setCompletedCall] = useState<CallRecord | null>(null);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  // Timer
  useEffect(() => {
    let interval: any = null;
    if (callStatus === 'connected') {
      interval = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [callStatus]);

  // Scroll transcript
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [transcript]);

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const playUtterance = (text: string) => {
    if (!isSpeakerOn) return;
    try {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = agent.voiceSettings.speed || 1.0;
        utterance.onstart = () => setSpeakerTurn('agent');
        utterance.onend = () => setSpeakerTurn('idle');
        utterance.onerror = () => setSpeakerTurn('idle');
        window.speechSynthesis.speak(utterance);
      } else {
        setTimeout(() => setSpeakerTurn('idle'), 2500);
      }
    } catch {
      setTimeout(() => setSpeakerTurn('idle'), 2500);
    }
  };

  const startBrowserCall = () => {
    setCallStatus('connected');
    setCallDuration(0);
    setCompletedCall(null);
    setSpeakerTurn('agent');

    const greetingText = `Hello! This is ${agent.name}. How can I assist you with your inquiry today?`;
    const initialGreeting: TranscriptMessage = {
      id: `msg-${Date.now()}`,
      sender: 'agent',
      text: greetingText,
      timestamp: '00:02',
    };
    setTranscript([initialGreeting]);
    playUtterance(greetingText);
  };

  const startPhoneCall = () => {
    setShowPhoneConfirm(false);
    setCallStatus('calling');
    setCallDuration(0);
    setCompletedCall(null);
    setTranscript([]);

    setTimeout(() => {
      setCallStatus('connected');
      const greetingText = `Hello, this is ${agent.name} reaching out for your scheduled conversation.`;
      const initialGreeting: TranscriptMessage = {
        id: `msg-${Date.now()}`,
        sender: 'agent',
        text: greetingText,
        timestamp: '00:03',
      };
      setTranscript([initialGreeting]);
      playUtterance(greetingText);
    }, 2000);
  };

  const handleSendUserTurn = (textToSend?: string) => {
    const msg = textToSend || userInputText;
    if (!msg.trim() || callStatus !== 'connected') return;

    const userTurn: TranscriptMessage = {
      id: `msg-${Date.now()}`,
      sender: 'user',
      text: msg.trim(),
      timestamp: formatTimer(callDuration),
    };

    const newHistory = [...transcript, userTurn];
    setTranscript(newHistory);
    setUserInputText('');
    setSpeakerTurn('agent');

    setTimeout(() => {
      let agentReply = 'Thank you for sharing that. Could you tell me a little more about how you addressed that challenge?';
      if (agent.category.includes('Assessment')) {
        agentReply = 'That makes sense. When a sudden issue happens on the floor, what steps do you take first to protect safety?';
      } else if (agent.category.includes('Sales')) {
        agentReply = 'I understand your pricing concern. Our product delivers verified payback within three months. Would you like to review the breakdown?';
      } else if (agent.category.includes('Support')) {
        agentReply = 'I appreciate your patience. Let me pull up your account right now and resolve this for you immediately.';
      }

      const agentTurn: TranscriptMessage = {
        id: `msg-${Date.now() + 1}`,
        sender: 'agent',
        text: agentReply,
        timestamp: formatTimer(callDuration + 2),
      };
      setTranscript([...newHistory, agentTurn]);
      playUtterance(agentReply);
    }, 1200);
  };

  const handleEndConversation = () => {
    if (callStatus !== 'connected' && callStatus !== 'calling') return;

    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    setCallStatus('completed');
    setSpeakerTurn('idle');

    const score = agent.evaluation.enabled ? Math.floor(Math.random() * 12) + 84 : undefined;
    const passed = score ? score >= agent.evaluation.passingThreshold : true;

    const extractedVars: Record<string, any> = {};
    agent.outputVariables.forEach((v) => {
      if (v.type === 'number') extractedVars[v.name] = score || 85;
      else if (v.type === 'boolean') extractedVars[v.name] = passed;
      else if (v.type === 'array') extractedVars[v.name] = ['Active listening', 'Clear problem identification'];
      else extractedVars[v.name] = 'Verified during conversation';
    });

    const recorded = recordTestCall({
      agentId: agent.id,
      agentName: agent.name,
      company: agent.company,
      caller: activeMode === 'browser' ? 'Browser Test' : `${countryCode} ${phoneNumber}`,
      destinationPhone: activeMode === 'phone' ? `${countryCode} ${phoneNumber}` : undefined,
      type: activeMode,
      provider: agent.provider,
      durationSeconds: Math.max(callDuration, 28),
      status: 'completed',
      score: score,
      passed: passed,
      latencyMs: 145,
      summary: `Test conversation with ${agent.name}. The agent appropriately followed instructions, collected requested details, and maintained good conversational pacing.`,
      transcript: transcript.length > 0 ? transcript : [
        { id: 't1', sender: 'agent', text: 'Hello, this was a trial conversation.', timestamp: '00:03' },
        { id: 't2', sender: 'user', text: 'Thank you, test completed.', timestamp: '00:15' },
      ],
      extractedVariables: extractedVars,
      evaluationScores: { 'Communication': 88, 'Core Objective': 85 },
    });

    setCompletedCall(recorded);
    showToast('Conversation Completed', 'Test completed and summary generated.');
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      {/* 1. Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Try your voice agent</h2>
        <p className="text-sm text-slate-500 mt-1">
          Have a conversation with your agent to check how it responds before publishing.
        </p>
      </div>

      {/* 2. Two Large Primary Testing Options (Browser vs Phone) */}
      {callStatus === 'idle' && !completedCall && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Option A: Test in Browser */}
          <div
            onClick={startBrowserCall}
            className="p-6 bg-white rounded-xl border border-slate-200 hover:border-blue-400 hover:shadow-sm transition-all cursor-pointer flex flex-col justify-between group"
          >
            <div>
              <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center mb-4">
                <Mic className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                Test in Browser
              </h3>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                Talk directly using your computer microphone and speakers. Instant, no setup required.
              </p>
            </div>

            <div className="mt-6 flex items-center justify-between pt-4 border-t border-slate-100">
              <span className="text-xs font-semibold text-emerald-600 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Mic ready
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  startBrowserCall();
                }}
                className="px-4 py-2 text-xs font-bold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors"
              >
                Start Conversation
              </button>
            </div>
          </div>

          {/* Option B: Test on Phone */}
          <div
            onClick={() => {
              setActiveMode('phone');
              setShowPhoneConfirm(true);
            }}
            className="p-6 bg-white rounded-xl border border-slate-200 hover:border-blue-400 hover:shadow-sm transition-all cursor-pointer flex flex-col justify-between group"
          >
            <div>
              <div className="w-12 h-12 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center mb-4">
                <Phone className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900 group-hover:text-blue-600 transition-colors">
                Test on Phone
              </h3>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                Simulate an outbound phone call to test how the agent sounds over standard telephone lines.
              </p>
            </div>

            <div className="mt-6 flex items-center justify-between pt-4 border-t border-slate-100">
              <span className="text-xs text-slate-400">
                Simulated phone call
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setActiveMode('phone');
                  setShowPhoneConfirm(true);
                }}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
              >
                Call Phone
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Live In-Conversation Screen */}
      {(callStatus === 'connected' || callStatus === 'calling') && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col h-[520px]">
          {/* Conversation Top Bar */}
          <div className="px-6 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <div>
                <span className="text-xs font-bold text-slate-900">
                  {callStatus === 'calling' ? 'Calling...' : `In conversation with ${agent.name}`}
                </span>
                <span className="text-xs text-slate-400 font-mono ml-2">
                  {formatTimer(callDuration)}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsSpeakerOn(!isSpeakerOn)}
                className={`p-2 rounded-lg text-xs font-semibold border ${
                  isSpeakerOn ? 'bg-white text-slate-700 border-slate-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}
                title={isSpeakerOn ? 'Speaker On' : 'Speaker Muted'}
              >
                {isSpeakerOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>

              <button
                onClick={handleEndConversation}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg shadow-sm transition-colors"
              >
                <PhoneOff className="w-3.5 h-3.5" />
                <span>End Conversation</span>
              </button>
            </div>
          </div>

          {/* Transcript Area */}
          <div className="flex-1 p-6 overflow-y-auto space-y-3.5 bg-slate-50/30">
            {transcript.map((msg) => {
              const isAgent = msg.sender === 'agent';
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isAgent ? 'items-start' : 'items-end'}`}
                >
                  <span className="text-[10px] font-semibold text-slate-400 mb-0.5 px-1">
                    {isAgent ? agent.name : 'You'} · {msg.timestamp}
                  </span>
                  <div
                    className={`max-w-[80%] rounded-2xl p-3.5 text-xs leading-relaxed ${
                      isAgent
                        ? 'bg-white text-slate-800 border border-slate-200 rounded-tl-xs shadow-sm'
                        : 'bg-blue-600 text-white rounded-tr-xs'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              );
            })}
            <div ref={transcriptEndRef} />
          </div>

          {/* Turn Input Bar */}
          <div className="p-3 bg-white border-t border-slate-200 space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={userInputText}
                onChange={(e) => setUserInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendUserTurn()}
                placeholder="Type what you want to say, or speak into your microphone..."
                className="flex-1 bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-blue-500 focus:outline-none"
              />
              <button
                onClick={() => handleSendUserTurn()}
                disabled={!userInputText.trim()}
                className="p-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 4. Simple Post-Test Summary (Clean Results Card) */}
      {completedCall && (
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-6 animate-in slide-in-from-bottom-2">
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-100">
            <div>
              <span className="text-[11px] font-semibold text-emerald-600 uppercase tracking-wider block">
                Test Completed
              </span>
              <h3 className="text-base font-bold text-slate-900 mt-0.5">
                Conversation Summary & Results
              </h3>
            </div>

            {completedCall.score !== undefined && (
              <div className="text-right">
                <span className="text-[10px] text-slate-400 uppercase tracking-wider block">Score</span>
                <span className="text-2xl font-bold font-mono text-emerald-600">
                  {completedCall.score}%
                </span>
              </div>
            )}
          </div>

          {/* 4 Check Questions */}
          <div className="space-y-3 text-xs">
            {/* 1. Completed */}
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-slate-900">Did the agent complete the conversation?</span>
                <p className="text-slate-600 mt-0.5">
                  Yes, the conversation flowed naturally through greeting, inquiry, and conclusion ({completedCall.durationSeconds} seconds).
                </p>
              </div>
            </div>

            {/* 2. Appropriate response */}
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-slate-900">Was the response appropriate?</span>
                <p className="text-slate-600 mt-0.5">
                  {completedCall.summary || 'Tone remained professional, clear, and aligned with company guidelines.'}
                </p>
              </div>
            </div>

            {/* 3. Details collected */}
            <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 flex items-start gap-3">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div className="w-full">
                <span className="font-bold text-slate-900">Were the required details collected?</span>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {Object.keys(completedCall.extractedVariables || {}).map((key) => (
                    <span
                      key={key}
                      className="text-[11px] font-medium bg-emerald-50 text-emerald-800 border border-emerald-200 px-2 py-0.5 rounded"
                    >
                      ✓ {key.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* 4. Improvement suggestion */}
            <div className="p-3.5 bg-blue-50/50 rounded-xl border border-blue-100 flex items-start gap-3">
              <Sparkles className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-bold text-blue-950">Next suggested step</span>
                <p className="text-blue-900/80 mt-0.5">
                  The agent responded accurately. If you want a faster delivery, you can slightly increase Response Speed under Voice & Language.
                </p>
              </div>
            </div>
          </div>

          {/* 3 Clear Action Buttons */}
          <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100">
            <div className="flex items-center gap-2">
              <button
                onClick={startBrowserCall}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Try Again</span>
              </button>

              <button
                onClick={() => {
                  setCallStatus('idle');
                  setCompletedCall(null);
                }}
                className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Review Full Conversation
              </button>
            </div>

            {onNavigateTab && (
              <button
                onClick={() => onNavigateTab('behaviour')}
                className="text-xs font-semibold text-blue-600 hover:text-blue-800"
              >
                Edit Instructions ⟶
              </button>
            )}
          </div>

          {/* Technical Diagnostics (Cleanly Collapsed) */}
          <div className="pt-2 border-t border-slate-100">
            <button
              onClick={() => setShowTechnicalDetails(!showTechnicalDetails)}
              className="text-xs font-medium text-slate-400 hover:text-slate-600 flex items-center gap-1"
            >
              <span>Technical Diagnostics</span>
              {showTechnicalDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>

            {showTechnicalDetails && (
              <div className="mt-2 p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs text-slate-600 space-y-1 font-mono">
                <div>Latency: {completedCall.latencyMs}ms</div>
                <div>Audio Codec: Opus / WebRTC nominal</div>
                <div>Engine: Lucid Real-time Voice</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Phone Test Confirmation Modal */}
      {showPhoneConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full overflow-hidden p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center shrink-0">
                <Phone className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900">Simulate Phone Test</h3>
                <p className="text-xs text-slate-500">
                  Enter a phone number to test how the agent sounds over telephone lines.
                </p>
              </div>
            </div>

            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Country</label>
                  <select
                    value={countryCode}
                    onChange={(e) => setCountryCode(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-300 rounded-lg p-2 text-xs"
                  >
                    <option value="+1">+1 (US)</option>
                    <option value="+44">+44 (UK)</option>
                    <option value="+91">+91 (IN)</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block font-semibold text-slate-700 mb-1">Phone Number *</label>
                  <input
                    type="text"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="555-019-8234"
                    className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-[11px] text-slate-500">
                Note: In this interactive prototype, the call is simulated cleanly in the browser.
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setShowPhoneConfirm(false)}
                className="px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-800 bg-white border border-slate-300 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={startPhoneCall}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm"
              >
                Start Test Call
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
