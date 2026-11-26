"use client";
import React, { useState } from 'react';
import { useApp } from '@/contexts/voice-agents-context';
import { VoiceAgent, AgentStatus } from '@/types/voice-agents';
import { AgentAvatar } from '../AgentAvatar';
import {
  ArrowLeft,
  PhoneCall,
  Save,
  Rocket,
  MoreVertical,
  Check,
  Edit2,
  Copy,
  Trash2,
  Download,
  ChevronDown,
  Headphones,
} from 'lucide-react';

interface StudioHeaderProps {
  agent: VoiceAgent;
  onOpenPublishModal: () => void;
  onOpenTest: () => void;
}

export const StudioHeader: React.FC<StudioHeaderProps> = ({
  agent,
  onOpenPublishModal,
  onOpenTest,
}) => {
  const {
    closeStudio,
    updateAgent,
    duplicateAgent,
    deleteAgent,
    publishToRoleplay,
    permissions,
    showToast,
  } = useApp();

  const [isEditingName, setIsEditingName] = useState(false);
  const [nameValue, setNameValue] = useState(agent.name);
  const [menuOpen, setMenuOpen] = useState(false);

  const handleSaveName = () => {
    if (nameValue.trim()) {
      updateAgent(agent.id, { name: nameValue.trim() });
    }
    setIsEditingName(false);
  };

  const handleSaveDraft = () => {
    updateAgent(agent.id, {
      hasUnsavedChanges: false,
      lastModified: 'Just now',
    });
    showToast('Changes Saved', `Saved updates for "${agent.name}".`);
  };

  const handleStatusChange = (status: AgentStatus) => {
    updateAgent(agent.id, { status });
    showToast('Status Updated', `Agent is now ${status}.`);
  };

  const statusStyles: Record<AgentStatus, { label: string; badge: string }> = {
    active: { label: 'Active', badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    draft: { label: 'Draft', badge: 'bg-amber-50 text-amber-700 border-amber-200' },
    paused: { label: 'Paused', badge: 'bg-slate-100 text-slate-700 border-slate-200' },
    archived: { label: 'Archived', badge: 'bg-rose-50 text-rose-700 border-rose-200' },
  };

  return (
    <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between gap-4 shrink-0 shadow-sm select-none">
      {/* Left: Back button + Agent Identity */}
      <div className="flex items-center gap-3.5 min-w-0">
        <button
          onClick={closeStudio}
          className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 p-1.5 rounded-lg hover:bg-slate-100 transition-colors shrink-0"
          title="Back to all agents"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Voice Agents</span>
        </button>

        <span className="text-slate-300 hidden sm:inline">/</span>

        <AgentAvatar
          name={agent.name}
          color={agent.avatarColor}
          size="sm"
          showBadge={true}
        />

        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {isEditingName ? (
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={nameValue}
                  onChange={(e) => setNameValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
                  autoFocus
                  className="text-sm font-bold text-slate-900 border border-blue-400 rounded-md px-2 py-0.5 focus:outline-none"
                />
                <button
                  onClick={handleSaveName}
                  className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                >
                  <Check className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 group">
                <h1 className="text-sm font-bold text-slate-900 truncate">
                  {agent.name}
                </h1>
                {permissions.canEditPrompts && (
                  <button
                    onClick={() => {
                      setNameValue(agent.name);
                      setIsEditingName(true);
                    }}
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-600 transition-opacity p-0.5"
                    title="Rename"
                  >
                    <Edit2 className="w-3 h-3" />
                  </button>
                )}
              </div>
            )}

            {/* Simple Status Selector */}
            <div className="relative">
              <select
                value={agent.status}
                onChange={(e) => handleStatusChange(e.target.value as AgentStatus)}
                className={`text-[11px] font-semibold border rounded-full px-2.5 py-0.5 cursor-pointer appearance-none pr-5 focus:outline-none ${statusStyles[agent.status].badge}`}
              >
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="paused">Paused</option>
                <option value="archived">Archived</option>
              </select>
              <ChevronDown className="w-3 h-3 text-slate-400 absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>

            {agent.hasUnsavedChanges && (
              <span className="text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full">
                Unsaved changes
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Right: One Primary Action ("Test Agent") + Clean Secondary Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Secondary: Save Changes */}
        {permissions.canEditPrompts && (
          <button
            onClick={handleSaveDraft}
            className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg shadow-sm transition-colors"
          >
            Save
          </button>
        )}

        {/* Primary Action: Test Agent */}
        <button
          onClick={onOpenTest}
          className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors"
        >
          <PhoneCall className="w-3.5 h-3.5" />
          <span>Test Agent</span>
        </button>

        {/* Publish Action (if admin/authorized) */}
        {permissions.canPublish && (
          <button
            onClick={onOpenPublishModal}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
            title="Publish updates to callers"
          >
            <Rocket className="w-3.5 h-3.5 text-slate-500" />
            <span>Publish</span>
          </button>
        )}

        {/* More Actions Menu */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
            title="More options"
          >
            <MoreVertical className="w-4 h-4" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-48 bg-white rounded-xl shadow-lg border border-slate-200 py-1 z-30 text-xs animate-in fade-in">
              <button
                onClick={() => {
                  duplicateAgent(agent.id);
                  setMenuOpen(false);
                }}
                className="w-full px-3.5 py-2 text-left text-slate-700 hover:bg-slate-50 flex items-center gap-2"
              >
                <Copy className="w-3.5 h-3.5 text-slate-400" />
                <span>Make a Copy</span>
              </button>

              <button
                onClick={() => {
                  const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(agent, null, 2));
                  const downloadAnchor = document.createElement('a');
                  downloadAnchor.setAttribute('href', dataStr);
                  downloadAnchor.setAttribute('download', `${agent.name.toLowerCase().replace(/\s+/g, '_')}_settings.json`);
                  document.body.appendChild(downloadAnchor);
                  downloadAnchor.click();
                  downloadAnchor.remove();
                  setMenuOpen(false);
                  showToast('Configuration Downloaded', 'Saved agent backup file.');
                }}
                className="w-full px-3.5 py-2 text-left text-slate-700 hover:bg-slate-50 flex items-center gap-2"
              >
                <Download className="w-3.5 h-3.5 text-slate-400" />
                <span>Download Backup</span>
              </button>

              {permissions.canPublish && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    onOpenPublishModal();
                  }}
                  className="w-full px-3.5 py-2 text-left text-slate-700 hover:bg-slate-50 flex sm:hidden items-center gap-2"
                >
                  <Rocket className="w-3.5 h-3.5 text-slate-400" />
                  <span>Publish Agent</span>
                </button>
              )}

              <button
                onClick={() => {
                  publishToRoleplay(agent.id);
                  setMenuOpen(false);
                }}
                className="w-full px-3.5 py-2 text-left text-slate-700 hover:bg-slate-50 flex items-center gap-2"
              >
                <Headphones className="w-3.5 h-3.5 text-blue-500" />
                <span>Publish to Roleplay</span>
              </button>

              <div className="my-1 border-t border-slate-100" />

              {permissions.canDelete && (
                <button
                  onClick={() => {
                    setMenuOpen(false);
                    deleteAgent(agent.id);
                  }}
                  className="w-full px-3.5 py-2 text-left text-rose-600 hover:bg-rose-50 flex items-center gap-2"
                >
                  <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                  <span>Delete Agent</span>
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
