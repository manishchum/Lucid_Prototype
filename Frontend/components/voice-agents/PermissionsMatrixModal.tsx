"use client";
import React from 'react';
import { useApp } from '@/contexts/voice-agents-context';
import { ROLE_DEFINITIONS } from '@/lib/voice-agents/mockData';
import { UserRole } from '@/types/voice-agents';
import { Check, X, Shield, Sliders } from 'lucide-react';

interface PermissionsMatrixModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const PermissionsMatrixModal: React.FC<PermissionsMatrixModalProps> = ({
  isOpen,
  onClose,
}) => {
  const { currentRole, setCurrentRole } = useApp();

  if (!isOpen) return null;

  const roles = Object.keys(ROLE_DEFINITIONS) as UserRole[];

  const permissionRows = [
    { key: 'canViewAllCompanies', label: 'Cross-Company View', desc: 'Can view agents across all companies' },
    { key: 'canCreateGlobalTemplates', label: 'Manage Global Templates', desc: 'Can create and publish global templates' },
    { key: 'canCreateAgents', label: 'Create New Agents', desc: 'Can build new agents from scratch or template' },
    { key: 'canEditPrompts', label: 'Edit Prompts', desc: 'Can modify prompt instructions' },
    { key: 'canEditAllPromptSections', label: 'All Prompt Sections', desc: 'Can edit all 9 structured prompt sections' },
    { key: 'canManageProviders', label: 'Manage Voice Providers', desc: 'Configure API keys, webhooks, and telephony' },
    { key: 'canTestBrowser', label: 'Browser Voice Test', desc: 'Run real-time browser microphone simulations' },
    { key: 'canTestPhone', label: 'Outbound Phone Test', desc: 'Trigger outbound phone testing calls' },
    { key: 'canPublish', label: 'Publish to Production', desc: 'Promote draft versions to live active state' },
    { key: 'canDelete', label: 'Delete Agents', desc: 'Permanently remove agent records' },
    { key: 'canViewLogs', label: 'Technical Latency Logs', desc: 'Inspect latency, provider logs and errors' },
    { key: 'canManageAccess', label: 'Company RBAC Access', desc: 'Manage user permissions inside workspace' },
  ] as const;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-4xl w-full overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
              <Sliders className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-slate-900">Role-Based Access Control (RBAC) Matrix</h3>
              <p className="text-xs text-slate-500">
                Enterprise security matrix governing permissions across Workfloww administrative tiers.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1.5 rounded-lg hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Table Content */}
        <div className="p-6 overflow-y-auto flex-1">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200">
                <th className="pb-3 text-slate-600 font-semibold w-1/3">Capability</th>
                {roles.map((r) => (
                  <th
                    key={r}
                    className={`pb-3 px-2 text-center font-semibold cursor-pointer ${
                      currentRole === r ? 'text-blue-600 bg-blue-50/60 rounded-t-lg' : 'text-slate-700'
                    }`}
                    onClick={() => setCurrentRole(r)}
                    title="Click to activate this role"
                  >
                    <div className="text-[11px] font-bold leading-tight">
                      {ROLE_DEFINITIONS[r].title.replace('Workfloww ', '').replace(' (Read-Only)', '')}
                    </div>
                    {currentRole === r && (
                      <span className="inline-block mt-0.5 text-[9px] bg-blue-600 text-white px-1.5 py-0.2 rounded font-bold">
                        ACTIVE
                      </span>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {permissionRows.map((perm) => (
                <tr key={perm.key} className="hover:bg-slate-50/50">
                  <td className="py-2.5 pr-4">
                    <div className="font-semibold text-slate-900">{perm.label}</div>
                    <div className="text-[11px] text-slate-500">{perm.desc}</div>
                  </td>
                  {roles.map((r) => {
                    const hasPerm = ROLE_DEFINITIONS[r].permissions[perm.key];
                    const isSelectedCol = currentRole === r;

                    return (
                      <td
                        key={`${perm.key}-${r}`}
                        className={`py-2.5 px-2 text-center ${
                          isSelectedCol ? 'bg-blue-50/30' : ''
                        }`}
                      >
                        {hasPerm ? (
                          <div className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-700">
                            <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                          </div>
                        ) : (
                          <div className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-slate-100 text-slate-400">
                            <X className="w-3 h-3" />
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500 shrink-0">
          <span>Click any column header to instantly test permissions in this prototype session.</span>
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-sm transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
