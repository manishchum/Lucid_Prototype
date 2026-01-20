"use client";

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ArrowLeft, Video, Mic, Clock, Target, MessageSquare, User, Briefcase, Play } from 'lucide-react';
import { Scenario } from '@/lib/roleplay/types';

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

  const handleStart = () => {
    onStart(config);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-purple-50 py-8">
      <div className="container mx-auto px-4 max-w-5xl">
        {/* Header */}
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-6 transition-colors"
        >
          <ArrowLeft className="w-5 h-5" />
          <span className="font-medium">Back to Scenarios</span>
        </button>

        {/* Main Card */}
        <Card className="bg-white shadow-xl rounded-2xl overflow-hidden">
          {/* Header Section */}
          <div className="bg-gradient-to-r from-purple-600 to-blue-600 text-white p-8">
            <h1 className="text-3xl font-bold mb-2">Configure Your Roleplay Session</h1>
            <p className="text-purple-100 text-lg">Customize your practice session settings</p>
          </div>

          <div className="p-8">
            {/* Scenario Overview */}
            <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-xl p-6 mb-8 border border-purple-200">
              <h2 className="text-xl font-bold text-slate-900 mb-2">{scenario.title}</h2>
              <p className="text-slate-600 mb-4">{scenario.description}</p>
              <div className="flex flex-wrap gap-2">
                <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-medium">
                  {scenario.role}
                </span>
                <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                  {scenario.difficulty} Difficulty
                </span>
              </div>
            </div>

            {/* Configuration Sections */}
            <div className="space-y-6">
              {/* Session Duration */}
              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
                  <Clock className="w-5 h-5 text-purple-600" />
                  Session Duration
                </label>
                <div className="grid grid-cols-4 gap-3">
                  {[5, 10, 15, 20].map((duration) => (
                    <button
                      key={duration}
                      onClick={() => setConfig({ ...config, duration })}
                      className={`p-4 rounded-lg border-2 transition-all ${
                        config.duration === duration
                          ? 'border-purple-600 bg-purple-50 text-purple-700 font-semibold'
                          : 'border-slate-200 hover:border-purple-300 text-slate-600'
                      }`}
                    >
                      {duration} min
                    </button>
                  ))}
                </div>
              </div>

              {/* Difficulty Level */}
              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
                  <Target className="w-5 h-5 text-purple-600" />
                  Difficulty Level
                </label>
                <div className="grid grid-cols-3 gap-3">
                  {['Easy', 'Medium', 'Hard'].map((difficulty) => (
                    <button
                      key={difficulty}
                      onClick={() => setConfig({ ...config, difficulty })}
                      className={`p-4 rounded-lg border-2 transition-all ${
                        config.difficulty === difficulty
                          ? 'border-purple-600 bg-purple-50 text-purple-700 font-semibold'
                          : 'border-slate-200 hover:border-purple-300 text-slate-600'
                      }`}
                    >
                      {difficulty}
                    </button>
                  ))}
                </div>
              </div>

              {/* Conversation Tone */}
              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
                  <MessageSquare className="w-5 h-5 text-purple-600" />
                  LT Tone
                </label>
                <div className="grid grid-cols-4 gap-3">
                  {['Friendly', 'Neutral', 'Professional', 'Challenging'].map((tone) => (
                    <button
                      key={tone}
                      onClick={() => setConfig({ ...config, tone })}
                      className={`p-4 rounded-lg border-2 transition-all ${
                        config.tone === tone
                          ? 'border-purple-600 bg-purple-50 text-purple-700 font-semibold'
                          : 'border-slate-200 hover:border-purple-300 text-slate-600'
                      }`}
                    >
                      {tone}
                    </button>
                  ))}
                </div>
              </div>

              {/* AI Voice Gender */}
              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
                  <User className="w-5 h-5 text-purple-600" />
                  AI Voice
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => setConfig({ ...config, voiceGender: 'female' })}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      config.voiceGender === 'female'
                        ? 'border-purple-600 bg-purple-50 text-purple-700 font-semibold'
                        : 'border-slate-200 hover:border-purple-300 text-slate-600'
                    }`}
                  >
                    👩 Female Voice
                  </button>
                  <button
                    onClick={() => setConfig({ ...config, voiceGender: 'male' })}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      config.voiceGender === 'male'
                        ? 'border-purple-600 bg-purple-50 text-purple-700 font-semibold'
                        : 'border-slate-200 hover:border-purple-300 text-slate-600'
                    }`}
                  >
                    👨 Male Voice
                  </button>
                </div>
              </div>

              {/* User Role & Goals */}
              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
                  <User className="w-5 h-5 text-purple-600" />
                  Your Role
                </label>
                <input
                  type="text"
                  value={config.userRole}
                  onChange={(e) => setConfig({ ...config, userRole: e.target.value })}
                  placeholder={`e.g., ${scenario.userRole || 'Account Manager'}`}
                  className="w-full p-3 border-2 border-slate-200 rounded-lg focus:border-purple-600 focus:outline-none"
                />
              </div>

              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
                  <Briefcase className="w-5 h-5 text-purple-600" />
                  Session Goals (Optional)
                </label>
                <textarea
                  value={config.userGoals}
                  onChange={(e) => setConfig({ ...config, userGoals: e.target.value })}
                  placeholder="What do you want to practice or improve in this session?"
                  rows={3}
                  className="w-full p-3 border-2 border-slate-200 rounded-lg focus:border-purple-600 focus:outline-none resize-none"
                />
              </div>

              {/* Device Settings */}
              <div>
                <label className="text-sm font-semibold text-slate-700 mb-3 block">
                  Device Settings
                </label>
                <div className="space-y-3">
                  <label className="flex items-center gap-3 p-4 border-2 border-slate-200 rounded-lg hover:border-purple-300 cursor-pointer transition-all">
                    <input
                      type="checkbox"
                      checked={config.cameraEnabled}
                      onChange={(e) => setConfig({ ...config, cameraEnabled: e.target.checked })}
                      className="w-5 h-5 text-purple-600 rounded focus:ring-purple-500"
                    />
                    <Video className="w-5 h-5 text-purple-600" />
                    <div className="flex-1">
                      <div className="font-medium text-slate-700">Enable Camera</div>
                      <div className="text-sm text-slate-500">Show video during roleplay for better practice</div>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-4 border-2 border-slate-200 rounded-lg hover:border-purple-300 cursor-pointer transition-all">
                    <input
                      type="checkbox"
                      checked={config.micEnabled}
                      onChange={(e) => setConfig({ ...config, micEnabled: e.target.checked })}
                      className="w-5 h-5 text-purple-600 rounded focus:ring-purple-500"
                    />
                    <Mic className="w-5 h-5 text-purple-600" />
                    <div className="flex-1">
                      <div className="font-medium text-slate-700">Enable Microphone</div>
                      <div className="text-sm text-slate-500">Use voice input for natural conversation</div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Feedback Level */}
              <div>
                <label className="text-sm font-semibold text-slate-700 mb-3 block">
                  Feedback Detail Level
                </label>
                <div className="grid grid-cols-3 gap-3">
                  <button
                    onClick={() => setConfig({ ...config, feedbackLevel: 'basic' })}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      config.feedbackLevel === 'basic'
                        ? 'border-purple-600 bg-purple-50'
                        : 'border-slate-200 hover:border-purple-300'
                    }`}
                  >
                    <div className="font-semibold text-slate-700 mb-1">Basic</div>
                    <div className="text-xs text-slate-500">Quick overview</div>
                  </button>

                  <button
                    onClick={() => setConfig({ ...config, feedbackLevel: 'detailed' })}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      config.feedbackLevel === 'detailed'
                        ? 'border-purple-600 bg-purple-50'
                        : 'border-slate-200 hover:border-purple-300'
                    }`}
                  >
                    <div className="font-semibold text-slate-700 mb-1">Detailed</div>
                    <div className="text-xs text-slate-500">5 parameters</div>
                  </button>

                  <button
                    onClick={() => setConfig({ ...config, feedbackLevel: 'comprehensive' })}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      config.feedbackLevel === 'comprehensive'
                        ? 'border-purple-600 bg-purple-50'
                        : 'border-slate-200 hover:border-purple-300'
                    }`}
                  >
                    <div className="font-semibold text-slate-700 mb-1">Comprehensive</div>
                    <div className="text-xs text-slate-500">8 parameters</div>
                  </button>
                </div>
              </div>

              {/* Auto-end option */}
              <label className="flex items-center gap-3 p-4 border-2 border-slate-200 rounded-lg hover:border-purple-300 cursor-pointer transition-all">
                <input
                  type="checkbox"
                  checked={config.autoEnd}
                  onChange={(e) => setConfig({ ...config, autoEnd: e.target.checked })}
                  className="w-5 h-5 text-purple-600 rounded focus:ring-purple-500"
                />
                <div className="flex-1">
                  <div className="font-medium text-slate-700">Auto-end After Duration</div>
                  <div className="text-sm text-slate-500">Automatically end session when time is up</div>
                </div>
              </label>
            </div>

            {/* Action Buttons */}
            <div className="mt-8 flex gap-4">
              <Button
                onClick={onBack}
                variant="outline"
                size="lg"
                className="flex-1 border-2"
              >
                Cancel
              </Button>
              <Button
                onClick={handleStart}
                size="lg"
                className="flex-1 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700"
              >
                <Play className="w-5 h-5 mr-2" />
                Start Roleplay
              </Button>
            </div>

            {/* Info Box */}
            <div className="mt-6 bg-blue-50 border border-blue-200 rounded-lg p-4">
              <p className="text-sm text-blue-800">
                <strong>💡 Tip:</strong> Configure your session settings to match your learning goals. 
                You can adjust difficulty and tone to challenge yourself or practice specific scenarios.
              </p>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
