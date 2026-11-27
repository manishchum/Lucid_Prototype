"use client";

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { 
  ArrowLeft, Video, VideoOff, Mic, MicOff, Clock, Target, 
  MessageSquare, User, Briefcase, Play, Sparkles, CheckCircle2, 
  Volume2, ShieldCheck, Flame, Info
} from 'lucide-react';
import { Scenario } from '@/lib/roleplayApi';

interface RoleplayConfigPageProps {
  scenario: Scenario;
  onStart: (config: RoleplayConfig) => void;
  onBack: () => void;
}

export interface RoleplayConfig {
  duration: number; // in minutes
  difficulty: string;
  tone: string;
  voiceGender: 'female' | 'male';
  cameraEnabled: boolean;
  micEnabled: boolean;
  autoEnd: boolean;
  feedbackLevel: 'basic' | 'detailed' | 'comprehensive';
  userRole?: string;
  userGoals?: string;
}

export default function RoleplayConfigPage({ scenario, onStart, onBack }: RoleplayConfigPageProps) {
  const [config, setConfig] = useState<RoleplayConfig>({
    duration: 10,
    difficulty: scenario.difficulty || 'Medium',
    tone: scenario.tone || 'Neutral',
    voiceGender: 'female',
    cameraEnabled: true,
    micEnabled: true,
    autoEnd: false,
    feedbackLevel: 'comprehensive',
    userRole: scenario.userRole || '',
    userGoals: '',
  });

  const [hasMicPermission, setHasMicPermission] = useState<boolean | null>(null);

  // Check microphone readiness on load
  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices?.getUserMedia({ audio: true })
      .then((s) => {
        stream = s;
        setHasMicPermission(true);
      })
      .catch(() => {
        setHasMicPermission(false);
      })
      .finally(() => {
        if (stream) {
          stream.getTracks().forEach(track => track.stop());
        }
      });
  }, []);

  const handleStart = () => {
    onStart(config);
  };

  const getDifficultyColor = (diff: string) => {
    switch (diff.toLowerCase()) {
      case 'easy':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200';
      case 'hard':
        return 'bg-rose-50 text-rose-700 border-rose-200';
      default:
        return 'bg-amber-50 text-amber-700 border-amber-200';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/60 py-6 sm:py-10">
      <div className="container mx-auto px-4 max-w-6xl">
        {/* Navigation Bar */}
        <div className="flex items-center justify-between mb-6">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 font-medium text-sm transition-colors py-2 px-3 rounded-lg hover:bg-slate-200/60"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Scenarios</span>
          </button>
          
          <div className="flex items-center gap-2 text-xs text-slate-500 font-medium">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
            Gemini Live AI Ready
          </div>
        </div>

        {/* Split View Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          
          {/* Left Column: Mission Briefing (7 Cols) */}
          <div className="lg:col-span-7 space-y-6">
            
            {/* Scenario Header Card */}
            <div className="bg-white rounded-2xl p-6 sm:p-7 border border-slate-200/80 shadow-sm">
              <div className="flex flex-wrap items-center gap-2.5 mb-3">
                <span className={`px-3 py-1 rounded-full text-xs font-semibold border ${getDifficultyColor(config.difficulty)}`}>
                  {config.difficulty} Difficulty
                </span>
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                  {scenario.tone || 'Realistic'} Tone
                </span>
                {scenario.isCustom && (
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                    Custom Scenario
                  </span>
                )}
              </div>

              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-3">
                {scenario.title}
              </h1>
              
              <p className="text-slate-600 text-sm sm:text-base leading-relaxed">
                {scenario.description || 'Practice your communication and real-time handling skills in this interactive roleplay simulation.'}
              </p>
            </div>

            {/* Persona & Role Cast Card */}
            <div className="bg-white rounded-2xl p-6 sm:p-7 border border-slate-200/80 shadow-sm">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
                <Target className="w-4 h-4 text-purple-600" />
                Simulation Roles
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* AI Partner Card */}
                <div className="p-4 rounded-xl bg-gradient-to-br from-purple-50/70 to-indigo-50/70 border border-purple-100 flex items-start gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-purple-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-purple-600">AI Partner Plays</span>
                    <h3 className="font-bold text-slate-900 text-base mt-0.5">{scenario.role || 'AI Persona'}</h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Mode: <span className="font-medium text-slate-700">{scenario.tone || 'Adaptive Dialogue'}</span>
                    </p>
                  </div>
                </div>

                {/* Learner Card */}
                <div className="p-4 rounded-xl bg-gradient-to-br from-emerald-50/70 to-teal-50/70 border border-emerald-100 flex items-start gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                    <User className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600">You Play As</span>
                    <h3 className="font-bold text-slate-900 text-base mt-0.5">{scenario.userRole || 'Team Member / Learner'}</h3>
                    <p className="text-xs text-slate-500 mt-1">
                      Target: <span className="font-medium text-slate-700">Clear & Empathetic Response</span>
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Learner Brief & Instructions Card */}
            <div className="bg-white rounded-2xl p-6 sm:p-7 border border-slate-200/80 shadow-sm">
              <h2 className="text-sm font-bold uppercase tracking-wider text-slate-400 mb-4 flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-purple-600" />
                Instructions & Objectives
              </h2>

              <div className="p-5 rounded-xl bg-slate-50 border border-slate-200/70 text-slate-700 text-sm leading-relaxed whitespace-pre-line font-normal">
                {scenario.learnerBrief || `Welcome to your interactive roleplay session.

Key Guidelines:
• Greet your partner professionally and set a positive conversational tone.
• Listen attentively to the scenario prompts and address objections calmly.
• Maintain a structured speaking pace and provide clear, actionable responses.
• Conclude the conversation with a polite and professional closing.`}
              </div>

              {/* Assessment Parameter Highlights */}
              <div className="mt-5 pt-5 border-t border-slate-100 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                <div className="flex items-center gap-2 text-slate-600 font-medium">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>Talk-to-Listen Ratio</span>
                </div>
                <div className="flex items-center gap-2 text-slate-600 font-medium">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>Speaking Pace (WPM)</span>
                </div>
                <div className="flex items-center gap-2 text-slate-600 font-medium">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>Real-time Dynamics</span>
                </div>
              </div>
            </div>

          </div>

          {/* Right Column: Interactive Setup & Launch (5 Cols) */}
          <div className="lg:col-span-5 space-y-6 lg:sticky lg:top-6">
            
            <div className="bg-white rounded-2xl p-6 sm:p-7 border border-slate-200/80 shadow-sm space-y-6">
              
              <div>
                <h2 className="text-lg font-bold text-slate-900 tracking-tight">Session Setup</h2>
                <p className="text-xs text-slate-500 mt-0.5">Customize your AI partner and hardware preferences</p>
              </div>

              {/* AI Voice Selection */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-3">
                  AI Partner Voice
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setConfig({ ...config, voiceGender: 'female' })}
                    className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                      config.voiceGender === 'female'
                        ? 'border-purple-600 bg-purple-50/60 shadow-sm'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-2xl">👩</span>
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        config.voiceGender === 'female' ? 'border-purple-600 bg-purple-600' : 'border-slate-300'
                      }`}>
                        {config.voiceGender === 'female' && <div className="w-1.5 h-1.5 rounded-full bg-white"></div>}
                      </div>
                    </div>
                    <div className="font-bold text-sm text-slate-900">Female Voice</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">Warm & Natural</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setConfig({ ...config, voiceGender: 'male' })}
                    className={`relative p-4 rounded-xl border-2 text-left transition-all ${
                      config.voiceGender === 'male'
                        ? 'border-purple-600 bg-purple-50/60 shadow-sm'
                        : 'border-slate-200 hover:border-slate-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-2xl">👨</span>
                      <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                        config.voiceGender === 'male' ? 'border-purple-600 bg-purple-600' : 'border-slate-300'
                      }`}>
                        {config.voiceGender === 'male' && <div className="w-1.5 h-1.5 rounded-full bg-white"></div>}
                      </div>
                    </div>
                    <div className="font-bold text-sm text-slate-900">Male Voice</div>
                    <div className="text-[11px] text-slate-500 mt-0.5">Calm & Confident</div>
                  </button>
                </div>
              </div>

              {/* Hardware Readiness Check */}
              <div className="space-y-3 pt-2 border-t border-slate-100">
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">
                  Device Readiness
                </label>

                {/* Microphone Toggle / Status */}
                <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                      config.micEnabled ? 'bg-purple-100 text-purple-700' : 'bg-slate-200 text-slate-500'
                    }`}>
                      {config.micEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Microphone</div>
                      <div className="text-xs text-slate-500">
                        {hasMicPermission === false ? (
                          <span className="text-rose-600 font-medium">Permission needed</span>
                        ) : hasMicPermission === true ? (
                          <span className="text-emerald-600 font-medium">Ready & active</span>
                        ) : (
                          <span>Audio input detected</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfig({ ...config, micEnabled: !config.micEnabled })}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                      config.micEnabled ? 'bg-slate-200 hover:bg-slate-300 text-slate-700' : 'bg-purple-600 text-white'
                    }`}
                  >
                    {config.micEnabled ? 'Mute' : 'Enable'}
                  </button>
                </div>

                {/* Camera Toggle */}
                <div className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 border border-slate-200/80">
                  <div className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                      config.cameraEnabled ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-500'
                    }`}>
                      {config.cameraEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-900">Camera</div>
                      <div className="text-xs text-slate-500">
                        {config.cameraEnabled ? 'Video enabled' : 'Audio-only mode'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfig({ ...config, cameraEnabled: !config.cameraEnabled })}
                    className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
                      config.cameraEnabled ? 'bg-slate-200 hover:bg-slate-300 text-slate-700' : 'bg-indigo-600 text-white'
                    }`}
                  >
                    {config.cameraEnabled ? 'Turn Off' : 'Turn On'}
                  </button>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-4 space-y-3">
                <Button
                  onClick={handleStart}
                  size="lg"
                  className="w-full py-6 text-base font-bold bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 hover:from-purple-700 hover:to-indigo-800 text-white shadow-lg shadow-purple-500/25 rounded-xl transition-all duration-200 flex items-center justify-center gap-2 group"
                >
                  <Play className="w-5 h-5 fill-current transition-transform group-hover:scale-110" />
                  <span>Start Roleplay Session</span>
                </Button>

                <Button
                  onClick={onBack}
                  variant="outline"
                  size="lg"
                  className="w-full border-slate-200 text-slate-700 hover:bg-slate-100 font-medium rounded-xl"
                >
                  Cancel
                </Button>
              </div>

            </div>

          </div>

        </div>

      </div>
    </div>
  );
}
