"use client";
import React, { useState } from 'react';
import { useApp, StudioTab } from '@/contexts/voice-agents-context';
import { StudioHeader } from './StudioHeader';
import { PublishModal } from './PublishModal';
import { TabOverview } from './TabOverview';
import { TabBehaviour } from './TabBehaviour';
import { TabVoiceLanguage } from './TabVoiceLanguage';
import { TabKnowledge } from './TabKnowledge';
import { TabScoring } from './TabScoring';
import { TabTestAgent } from './TabTestAgent';
import { TabCallHistory } from './TabCallHistory';
import { TabAdvancedSettings } from './TabAdvancedSettings';
import { TabChangeHistory } from './TabChangeHistory';
import {
  LayoutDashboard,
  Bot,
  Volume2,
  FileText,
  Award,
  PhoneCall,
  History,
  Sliders,
  Clock,
  Menu,
} from 'lucide-react';

export const AgentStudio: React.FC = () => {
  const { selectedAgent, activeStudioTab, setActiveStudioTab } = useApp();
  const [isPublishModalOpen, setIsPublishModalOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  if (!selectedAgent) return null;

  // Main task-oriented sections
  const primaryNav: { id: StudioTab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <LayoutDashboard className="w-4 h-4" /> },
    { id: 'behaviour', label: 'Agent Behaviour', icon: <Bot className="w-4 h-4" /> },
    { id: 'voice', label: 'Voice & Language', icon: <Volume2 className="w-4 h-4" /> },
    { id: 'knowledge', label: 'Knowledge', icon: <FileText className="w-4 h-4" /> },
    { id: 'scoring', label: 'Scoring & Results', icon: <Award className="w-4 h-4" /> },
    { id: 'test', label: 'Test Agent', icon: <PhoneCall className="w-4 h-4 text-blue-600" /> },
    { id: 'history', label: 'Call History', icon: <History className="w-4 h-4" /> },
  ];

  // Bottom secondary sections
  const secondaryNav: { id: StudioTab; label: string; icon: React.ReactNode }[] = [
    { id: 'advanced', label: 'Advanced Settings', icon: <Sliders className="w-4 h-4" /> },
    { id: 'versions', label: 'Change History', icon: <Clock className="w-4 h-4" /> },
  ];

  // Resolve active tab if a legacy alias is present
  let resolvedTab: StudioTab = activeStudioTab;
  if (activeStudioTab === 'prompts' || activeStudioTab === 'variables') resolvedTab = 'behaviour';
  else if (activeStudioTab === 'evaluation') resolvedTab = 'scoring';
  else if (activeStudioTab === 'playground') resolvedTab = 'test';

  return (
    <div className="flex-1 flex flex-col h-screen overflow-hidden bg-slate-50/50">
      {/* 1. Compact Top Studio Header */}
      <StudioHeader
        agent={selectedAgent}
        onOpenPublishModal={() => setIsPublishModalOpen(true)}
        onOpenTest={() => setActiveStudioTab('test')}
      />

      {/* Mobile Nav Toggle */}
      <div className="md:hidden bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between text-xs font-semibold">
        <span className="text-slate-600">
          Section: <strong className="text-slate-900">{primaryNav.concat(secondaryNav).find((n) => n.id === resolvedTab)?.label}</strong>
        </span>
        <button
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          className="p-1.5 rounded-lg bg-slate-100 text-slate-700"
        >
          <Menu className="w-4 h-4" />
        </button>
      </div>

      {/* 2. Workspace Body with Left-Side Navigation Panel */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left-Side Navigation Panel inside Agent Workspace */}
        <nav
          className={`${
            mobileMenuOpen ? 'block absolute inset-0 z-40 bg-white p-4' : 'hidden'
          } md:flex flex-col w-60 bg-white border-r border-slate-200 p-3 shrink-0 justify-between select-none shadow-sm`}
        >
          <div className="space-y-1">
            <div className="px-3 py-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Agent Workspace
            </div>

            {primaryNav.map((item) => {
              const isActive = resolvedTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveStudioTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-left transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-blue-50 text-blue-600 font-bold'
                      : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
                  }`}
                >
                  <span className={isActive ? 'text-blue-600' : 'text-slate-400'}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>

          {/* Bottom Secondary Links */}
          <div className="pt-3 border-t border-slate-100 space-y-1">
            {secondaryNav.map((item) => {
              const isActive = resolvedTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => {
                    setActiveStudioTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium text-left transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-slate-100 text-slate-900 font-semibold'
                      : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                  }`}
                >
                  <span className={isActive ? 'text-slate-700' : 'text-slate-400'}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        {/* 3. Main Content Viewport */}
        <div className="flex-1 overflow-y-auto">
          {resolvedTab === 'overview' && (
            <TabOverview
              agent={selectedAgent}
              onNavigateTab={(tab) => setActiveStudioTab(tab)}
            />
          )}

          {resolvedTab === 'behaviour' && <TabBehaviour agent={selectedAgent} />}

          {resolvedTab === 'voice' && <TabVoiceLanguage agent={selectedAgent} />}

          {resolvedTab === 'knowledge' && <TabKnowledge agent={selectedAgent} />}

          {resolvedTab === 'scoring' && <TabScoring agent={selectedAgent} />}

          {resolvedTab === 'test' && (
            <TabTestAgent
              agent={selectedAgent}
              onNavigateTab={(tab) => setActiveStudioTab(tab)}
            />
          )}

          {resolvedTab === 'history' && <TabCallHistory agent={selectedAgent} />}

          {resolvedTab === 'advanced' && <TabAdvancedSettings agent={selectedAgent} />}

          {resolvedTab === 'versions' && <TabChangeHistory agent={selectedAgent} />}
        </div>
      </div>

      {/* Publish Modal */}
      <PublishModal
        isOpen={isPublishModalOpen}
        onClose={() => setIsPublishModalOpen(false)}
        agent={selectedAgent}
      />
    </div>
  );
};
