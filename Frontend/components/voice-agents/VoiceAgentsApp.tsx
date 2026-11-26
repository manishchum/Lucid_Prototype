"use client";

import React, { useState } from 'react';
import { VoiceAgentsProvider, useVoiceAgents } from '@/contexts/voice-agents-context';
import { VoiceAgentsDashboard } from '@/components/voice-agents/VoiceAgentsDashboard';
import { AgentStudio } from '@/components/voice-agents/AgentStudio/AgentStudio';
import { CreateAgentModal } from '@/components/voice-agents/CreateAgentModal';
import { PermissionsMatrixModal } from '@/components/voice-agents/PermissionsMatrixModal';
import { ToastContainer } from '@/components/voice-agents/Toast';
import { AgentTemplate } from '@/types/voice-agents';

const VoiceAgentsContent: React.FC = () => {
  const {
    currentView,
    openStudio,
  } = useVoiceAgents();

  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isPermissionsModalOpen, setIsPermissionsModalOpen] = useState(false);
  const [selectedTemplateForCreate, setSelectedTemplateForCreate] = useState<AgentTemplate | null>(null);

  const handleBrowseTemplates = () => {
    setSelectedTemplateForCreate(null);
    setIsCreateModalOpen(true);
  };

  const handleOpenPlayground = (agentId: string) => {
    openStudio(agentId, 'playground');
  };

  return (
    <div className="flex-1 flex flex-col h-[calc(100vh-4rem)] overflow-hidden bg-slate-50/50">
      {/* Main View Area */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {currentView === 'dashboard' && (
          <VoiceAgentsDashboard
            onCreateAgent={() => {
              setSelectedTemplateForCreate(null);
              setIsCreateModalOpen(true);
            }}
            onBrowseTemplates={handleBrowseTemplates}
            onOpenPlayground={handleOpenPlayground}
          />
        )}

        {currentView === 'studio' && <AgentStudio />}
      </main>

      {/* Global Modals */}
      <CreateAgentModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        initialTemplate={selectedTemplateForCreate}
      />

      <PermissionsMatrixModal
        isOpen={isPermissionsModalOpen}
        onClose={() => setIsPermissionsModalOpen(false)}
      />

      {/* Toast Notifications */}
      <ToastContainer />
    </div>
  );
};

export default function VoiceAgentsApp() {
  return (
    <VoiceAgentsProvider>
      <VoiceAgentsContent />
    </VoiceAgentsProvider>
  );
}
