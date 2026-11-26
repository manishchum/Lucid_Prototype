"use client";
import React, { useState } from 'react';
import { VoiceAgent, VoiceProviderId } from '@/types/voice-agents';
import { useApp } from '@/contexts/voice-agents-context';
import {
  Volume2,
  Play,
  Pause,
  ChevronDown,
  ChevronUp,
  Check,
  Globe,
  Sliders,
  Shield,
  Zap,
} from 'lucide-react';

interface TabVoiceLanguageProps {
  agent: VoiceAgent;
}

export const TabVoiceLanguage: React.FC<TabVoiceLanguageProps> = ({ agent }) => {
  const { updateAgent, providers, showToast } = useApp();

  const [isPlayingId, setIsPlayingId] = useState<string | null>(null);
  const [showAdvancedVoice, setShowAdvancedVoice] = useState(false);

  // Friendly Voice Options
  const voiceLibrary = [
    { id: '21m00Tcm4TlvDq8ikWAM', name: 'Rachel', gender: 'Female', accent: 'American (Professional)', desc: 'Clear, crisp corporate tone suitable for customer care and assessments' },
    { id: 'AZnzlk1XvdvUeBnXmlld', name: 'Domi', gender: 'Female', accent: 'American (Engaging)', desc: 'Warm, empathetic, and reassuring for support check-ins' },
    { id: 'EXAVITQu4vr4xnSDxMaL', name: 'Bella', gender: 'Female', accent: 'American (Refined)', desc: 'Executive cadence, patient and articulate' },
    { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', gender: 'Male', accent: 'American (Calm)', desc: 'Calm, grounded narrator and coaching proctor' },
    { id: 'VR6AewLTigWG4xSOukaG', name: 'Josh', gender: 'Male', accent: 'American (Conversational)', desc: 'Young professional, conversational and energetic' },
    { id: 'sonic-english-indian', name: 'Rohan', gender: 'Male', accent: 'Indian (Executive)', desc: 'Articulate Indian English, ideal for business roleplays' },
    { id: 'sonic-priya', name: 'Priya', gender: 'Female', accent: 'Indian (Conversational)', desc: 'Warm Indian English for retail and onboarding inquiries' },
    { id: 'retell-british-partner', name: 'Arthur', gender: 'Male', accent: 'British (Oxbridge)', desc: 'Formal, intellectually rigorous for strategy and audits' },
  ];

  const languages = [
    'English (US)',
    'English (India)',
    'English (UK)',
    'Hindi',
    'Hinglish',
    'Spanish',
    'German',
    'French',
  ];

  const speakingStyles = [
    { id: 'natural', label: 'Natural & Balanced', desc: 'Everyday human rhythm and pacing' },
    { id: 'calm', label: 'Calm & Reassuring', desc: 'Slightly slower, patient and gentle' },
    { id: 'energetic', label: 'Energetic & Upbeat', desc: 'Dynamic, persuasive and enthusiastic' },
    { id: 'professional', label: 'Professional & Polished', desc: 'Measured, corporate and clear' },
  ];

  const [selectedStyle, setSelectedStyle] = useState('natural');

  const playVoiceSample = (vId: string, vName: string) => {
    if (isPlayingId === vId) {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
      setIsPlayingId(null);
      return;
    }

    setIsPlayingId(vId);

    try {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(
          `Hello! I am ${vName}. This is how my voice sounds on Workfloww.`
        );
        utterance.rate = agent.voiceSettings.speed || 1.0;
        utterance.onend = () => setIsPlayingId(null);
        utterance.onerror = () => setIsPlayingId(null);
        window.speechSynthesis.speak(utterance);
      } else {
        setTimeout(() => setIsPlayingId(null), 2500);
      }
    } catch {
      setTimeout(() => setIsPlayingId(null), 2500);
    }
  };

  const handleSelectVoice = (v: typeof voiceLibrary[0]) => {
    updateAgent(agent.id, {
      voiceSettings: {
        ...agent.voiceSettings,
        voiceId: v.id,
        voiceName: `${v.name} (${v.gender})`,
        accent: v.accent,
      },
      hasUnsavedChanges: true,
    });
    showToast('Voice Selected', `Set voice persona to ${v.name}.`);
  };

  const handleSelectLanguage = (lang: string) => {
    updateAgent(agent.id, {
      voiceSettings: {
        ...agent.voiceSettings,
        language: lang,
      },
      hasUnsavedChanges: true,
    });
  };

  const handleSpeedSlider = (val: number) => {
    updateAgent(agent.id, {
      voiceSettings: {
        ...agent.voiceSettings,
        speed: val,
      },
      hasUnsavedChanges: true,
    });
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-6">
      {/* Page Header */}
      <div>
        <h2 className="text-xl font-bold text-slate-900 tracking-tight">Voice & Language</h2>
        <p className="text-sm text-slate-500 mt-1">
          Choose the voice persona, language, and cadence your callers will experience.
        </p>
      </div>

      {/* 1. Select a Voice */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Select a Voice</h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Click on any voice card to select it, or click the play button to hear a live sample.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {voiceLibrary.map((v) => {
            const isSelected = agent.voiceSettings.voiceName.includes(v.name);
            const isPlaying = isPlayingId === v.id;

            return (
              <div
                key={v.id}
                onClick={() => handleSelectVoice(v)}
                className={`p-4 rounded-xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                  isSelected
                    ? 'border-blue-600 bg-blue-50/50 shadow-sm ring-1 ring-blue-500/20'
                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50/60'
                }`}
              >
                <div className="min-w-0 pr-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900">{v.name}</span>
                    <span className="text-[10px] text-slate-500 bg-slate-100 px-1.5 py-0.2 rounded font-medium">
                      {v.gender}
                    </span>
                    <span className="text-[10px] text-slate-400 truncate">{v.accent}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1 line-clamp-2 leading-relaxed">
                    {v.desc}
                  </p>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      playVoiceSample(v.id, v.name);
                    }}
                    className={`p-2 rounded-lg transition-colors ${
                      isPlaying
                        ? 'bg-blue-600 text-white animate-pulse'
                        : 'bg-slate-100 text-slate-700 hover:bg-blue-100 hover:text-blue-700'
                    }`}
                    title={isPlaying ? 'Stop' : 'Listen to sample'}
                  >
                    {isPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                  </button>

                  {isSelected && (
                    <div className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center">
                      <Check className="w-3 h-3 stroke-[2.5]" />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 2. Choose Language */}
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Choose Language</h3>
          <p className="text-xs text-slate-500 mt-0.5">Primary language the agent will speak and transcribe.</p>
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          {languages.map((lang) => {
            const isSelected = agent.voiceSettings.language.startsWith(lang.split(' ')[0]);

            return (
              <button
                key={lang}
                onClick={() => handleSelectLanguage(lang)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  isSelected
                    ? 'border-blue-600 bg-blue-600 text-white shadow-sm'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                {lang}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3. Speaking Style & Speed */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
        {/* Style */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-3">
          <h3 className="text-sm font-bold text-slate-900">Speaking Style</h3>
          <div className="space-y-2">
            {speakingStyles.map((s) => (
              <div
                key={s.id}
                onClick={() => setSelectedStyle(s.id)}
                className={`p-2.5 rounded-lg border text-xs cursor-pointer flex items-center justify-between ${
                  selectedStyle === s.id
                    ? 'border-blue-500 bg-blue-50/50 text-blue-900 font-semibold'
                    : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <div>
                  <div className="font-semibold">{s.label}</div>
                  <div className="text-[11px] text-slate-400 font-normal">{s.desc}</div>
                </div>
                {selectedStyle === s.id && <Check className="w-4 h-4 text-blue-600 shrink-0" />}
              </div>
            ))}
          </div>
        </div>

        {/* Speed */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-sm space-y-4 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Response Speed</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Adjust how fast or slow the agent delivers spoken sentences.
            </p>
          </div>

          <div className="space-y-3 py-2">
            <input
              type="range"
              min="0.85"
              max="1.25"
              step="0.05"
              value={agent.voiceSettings.speed}
              onChange={(e) => handleSpeedSlider(parseFloat(e.target.value))}
              className="w-full accent-blue-600 cursor-pointer"
            />
            <div className="flex justify-between text-xs font-semibold text-slate-600">
              <span className={agent.voiceSettings.speed <= 0.9 ? 'text-blue-600' : ''}>Slow</span>
              <span className={agent.voiceSettings.speed === 1.0 ? 'text-blue-600' : ''}>Normal</span>
              <span className={agent.voiceSettings.speed >= 1.15 ? 'text-blue-600' : ''}>Fast</span>
            </div>
          </div>

          <div className="text-[11px] text-slate-400 bg-slate-50 p-2.5 rounded-lg">
            Current pace: <strong className="text-slate-700 font-mono">{agent.voiceSettings.speed}x</strong>
          </div>
        </div>
      </div>

      {/* 4. Advanced Voice Settings (Cleanly Collapsed Accordion) */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <button
          onClick={() => setShowAdvancedVoice(!showAdvancedVoice)}
          className="w-full px-6 py-4 flex items-center justify-between text-left hover:bg-slate-50/80 transition-colors"
        >
          <div>
            <h3 className="text-sm font-bold text-slate-900">Advanced Voice Settings</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Technical parameters: speech speed, interruption sensitivity, and timeouts.
            </p>
          </div>
          {showAdvancedVoice ? (
            <ChevronUp className="w-4 h-4 text-slate-400" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400" />
          )}
        </button>

        {showAdvancedVoice && (
          <div className="p-6 pt-2 border-t border-slate-100 space-y-4 text-xs bg-slate-50/30">

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Silence Timeout (Wait time before agent speaks)
                </label>
                <select
                  value={agent.voiceSettings.silenceTimeoutSeconds}
                  onChange={(e) =>
                    updateAgent(agent.id, {
                      voiceSettings: {
                        ...agent.voiceSettings,
                        silenceTimeoutSeconds: parseInt(e.target.value),
                      },
                      hasUnsavedChanges: true,
                    })
                  }
                  className="w-full bg-white border border-slate-300 rounded-lg p-2 text-xs"
                >
                  <option value={2}>2 seconds (Quick response)</option>
                  <option value={3}>3 seconds (Balanced)</option>
                  <option value={4}>4 seconds (Allows user thinking pauses)</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Allow Caller Interruption (Barge-In)
                </label>
                <div className="pt-2">
                  <label className="flex items-center gap-2 cursor-pointer font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={agent.voiceSettings.allowBargeIn}
                      onChange={(e) =>
                        updateAgent(agent.id, {
                          voiceSettings: {
                            ...agent.voiceSettings,
                            allowBargeIn: e.target.checked,
                          },
                          hasUnsavedChanges: true,
                        })
                      }
                      className="rounded text-blue-600 focus:ring-blue-500 w-4 h-4"
                    />
                    <span>Yes, stop speaking if the caller starts talking</span>
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
