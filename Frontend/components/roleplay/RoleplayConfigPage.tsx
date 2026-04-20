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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-blue-100 py-8">
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
          <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white p-8">
            <h1 className="text-3xl font-bold mb-2">Start Your Roleplay Session</h1>
          </div>

          <div className="p-8">
            {/* Scenario Overview */}
            <div className="bg-gradient-to-br from-blue-50 to-blue-100 rounded-xl p-6 mb-8 border border-blue-200">
              <h2 className="text-xl font-bold text-slate-900 mb-2">{scenario.title}</h2>
              <p className="text-slate-600 mb-4">{scenario.description}</p>
              
              {/* Role Information - Hidden */}
              {/* <div className="bg-white rounded-lg p-4 mb-4 border border-blue-200">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <User className="w-4 h-4 text-green-600" />
                      <span className="text-xs font-semibold text-slate-500 uppercase">Your Role (Learner)</span>
                    </div>
                    <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-medium inline-block">
                      {scenario.userRole || 'Learner'}
                    </span>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Briefcase className="w-4 h-4 text-blue-600" />
                      <span className="text-xs font-semibold text-slate-500 uppercase">AI Coach Plays</span>
                    </div>
                    <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium inline-block">
                      {scenario.role}
                    </span>
                  </div>
                </div>
              </div> */}
              
              <div className="flex flex-wrap gap-2">
                <span className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-sm font-medium">
                  {scenario.difficulty} Difficulty
                </span>
              </div>
            </div>

            {/* Configuration Sections */}
            <div>
              {/* AI Voice Gender */}
              <div>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
                  <User className="w-5 h-5 text-blue-600" />
                  AI Voice
                </label>
                <div className="grid grid-cols-2 gap-3 mb-8">
                  <button
                    onClick={() => setConfig({ ...config, voiceGender: 'female' })}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      config.voiceGender === 'female'
                        ? 'border-blue-600 bg-blue-50 text-blue-700 font-semibold'
                        : 'border-slate-200 hover:border-blue-300 text-slate-600'
                    }`}
                  >
                    👩 Female Voice
                  </button>
                  <button
                    onClick={() => setConfig({ ...config, voiceGender: 'male' })}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      config.voiceGender === 'male'
                        ? 'border-blue-600 bg-blue-50 text-blue-700 font-semibold'
                        : 'border-slate-200 hover:border-blue-300 text-slate-600'
                    }`}
                  >
                    👨 Male Voice
                  </button>
                </div>
              </div>

              {/* Learner Instructions */}
              <div className="mb-8">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
                  <MessageSquare className="w-5 h-5 text-blue-600" />
                  Instructions for Learners
                </label>
                <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-5">
                  <div className="text-slate-700 whitespace-pre-line leading-relaxed">
                    {scenario.learnerBrief || `📣 Welcome to this roleplay practice session.
In this exercise, you will interact with a virtual character to practice and improve your professional communication skills.

✅ What You Need to Do:

1. Greet and introduce yourself professionally.
   Begin with a polite greeting and clearly state your name and role.

2. Present your main points clearly.
   • Communicate your key message
   • Use clear and simple language
   • Stay focused on your objectives

3. Listen and respond appropriately.
   Pay attention to questions or concerns and provide thoughtful responses.

4. Conclude professionally.
   Summarize the conversation and end with a courteous closing statement.`}
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-4 mb-4">
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
                className="flex-1 bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800"
              >
                <Play className="w-5 h-5 mr-2" />
                Start Roleplay
              </Button>
            </div>

            {/* Save Draft Button */}
            <div className="flex justify-center">
              <Button
                onClick={() => {
                  // Add save draft functionality here
                  console.log('Draft saved:', config);
                }}
                variant="outline"
                size="lg"
                className="px-8"
              >
                Save Draft
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}