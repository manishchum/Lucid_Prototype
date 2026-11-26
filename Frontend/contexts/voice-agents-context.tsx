"use client";

import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  VoiceAgent,
  AgentTemplate,
  ProviderIntegration,
  CallRecord,
  UserRole,
  CompanyName,
  RolePermissions,
} from '@/types/voice-agents';
import {
  INITIAL_AGENTS,
  INITIAL_TEMPLATES,
  INITIAL_PROVIDERS,
  INITIAL_CALL_HISTORY,
  ROLE_DEFINITIONS,
} from '@/lib/voice-agents/mockData';
import { compileStructuredToRaw } from '@/lib/voice-agents/promptUtils';
import { useTenant } from '@/contexts/tenant-context';
import { useAuth } from '@/contexts/auth-context';

export type StudioTab =
  | 'overview'
  | 'behaviour'
  | 'voice'
  | 'knowledge'
  | 'scoring'
  | 'test'
  | 'history'
  | 'advanced'
  | 'versions'
  // Legacy aliases for backward compatibility:
  | 'prompts'
  | 'variables'
  | 'evaluation'
  | 'playground';

export type AppView = 'dashboard' | 'studio' | 'providers' | 'permissions_matrix' | 'sprint_manager';

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  type: 'success' | 'info' | 'warning' | 'error';
}

interface VoiceAgentsContextType {
  agents: VoiceAgent[];
  templates: AgentTemplate[];
  providers: ProviderIntegration[];
  callHistory: CallRecord[];
  currentRole: UserRole;
  selectedCompany: CompanyName | 'All';
  currentView: AppView;
  selectedAgentId: string | null;
  selectedAgent: VoiceAgent | null;
  activeStudioTab: StudioTab;
  permissions: RolePermissions;
  toasts: ToastItem[];

  // Navigation
  setView: (view: AppView) => void;
  openStudio: (agentId: string, initialTab?: StudioTab) => void;
  closeStudio: () => void;
  setActiveStudioTab: (tab: StudioTab) => void;
  setCurrentRole: (role: UserRole) => void;
  setSelectedCompany: (company: CompanyName | 'All') => void;

  // Agent Operations
  updateAgent: (id: string, updates: Partial<VoiceAgent>) => void;
  createAgent: (agent: VoiceAgent) => void;
  deleteAgent: (id: string) => boolean;
  duplicateAgent: (id: string, targetCompany?: CompanyName) => VoiceAgent;
  publishAgent: (id: string, changeNotes: string) => void;
  rollbackAgentVersion: (id: string, targetVersion: string) => void;
  publishToRoleplay: (id: string) => void;

  // Provider Operations
  updateProvider: (id: string, updates: Partial<ProviderIntegration>) => void;
  testProviderConnection: (id: string) => Promise<boolean>;

  // Call & Testing Operations
  recordTestCall: (call: Omit<CallRecord, 'id' | 'date'>) => CallRecord;

  // Toast
  showToast: (title: string, description?: string, type?: ToastItem['type']) => void;
  removeToast: (id: string) => void;

  // Reset to initial
  resetAllData: () => void;
}

const VoiceAgentsContext = createContext<VoiceAgentsContextType | undefined>(undefined);

const AGENTS_KEY = 'lucid_voice_agents_v6';
const PROVIDERS_KEY = 'lucid_providers_v6';
const CALLS_KEY = 'lucid_calls_v6';

function sanitizeAgents(list: VoiceAgent[]): VoiceAgent[] {
  return list
    .filter((a) => a.id !== 'agent-5-lucyywarm' && !a.name.toLowerCase().includes('lucyy'))
    .map((a) => {
      let company = a.company as any;
      let name = a.name;
      let owner = a.owner;

      if (company === 'Yum! Brands' || company === 'QSR Brands') company = 'QSR';
      if (company === 'Haier Appliances') company = 'Consumer Goods';
      if (company === 'Enterprise Advisory') company = 'EY';

      if (name.toLowerCase().includes('yum')) name = name.replace(/yum! brands|yum/gi, 'QSR');
      if (name.toLowerCase().includes('haier6 sales')) name = 'Consumer Sales';
      else if (name.toLowerCase().includes('sales haier')) name = 'Consumer Sales Training';
      else if (name.toLowerCase().includes('haier')) name = name.replace(/haier/gi, 'Consumer');

      if (!owner || owner.includes('workfloww')) {
        owner = 'admin@lucid.ai';
      }

      return {
        ...a,
        name,
        company,
        owner,
      };
    });
}

export const VoiceAgentsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { activeCompany } = useTenant();
  const { isSuperAdmin, isDeveloper, isAdmin, isManager } = useAuth();

  const [agents, setAgents] = useState<VoiceAgent[]>(INITIAL_AGENTS);
  const [templates] = useState<AgentTemplate[]>(INITIAL_TEMPLATES);
  const [providers, setProviders] = useState<ProviderIntegration[]>(INITIAL_PROVIDERS);
  const [callHistory, setCallHistory] = useState<CallRecord[]>(INITIAL_CALL_HISTORY);
  const [isHydrated, setIsHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(AGENTS_KEY);
      if (stored) {
        setAgents(sanitizeAgents(JSON.parse(stored)));
      }
      const storedProv = localStorage.getItem(PROVIDERS_KEY);
      if (storedProv) {
        setProviders(JSON.parse(storedProv));
      }
      const storedCalls = localStorage.getItem(CALLS_KEY);
      if (storedCalls) {
        setCallHistory(JSON.parse(storedCalls));
      }
    } catch (e) {
      console.warn('Failed to read from localStorage', e);
    } finally {
      setIsHydrated(true);
    }
  }, []);

  // Determine user role in Lucid
  const [currentRole, setCurrentRole] = useState<UserRole>(() => {
    if (isSuperAdmin) return 'workfloww_super_admin';
    if (isDeveloper) return 'workfloww_developer';
    if (isAdmin) return 'company_admin';
    if (isManager) return 'company_manager';
    return 'workfloww_super_admin';
  });

  // Default company to activeCompany from Lucid or 'All'
  const [selectedCompany, setSelectedCompany] = useState<CompanyName | 'All'>('All');
  const [currentView, setView] = useState<AppView>('dashboard');
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [activeStudioTab, setActiveStudioTab] = useState<StudioTab>('overview');
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  // Sync role if auth state changes
  useEffect(() => {
    if (isSuperAdmin) setCurrentRole('workfloww_super_admin');
    else if (isDeveloper) setCurrentRole('workfloww_developer');
    else if (isAdmin) setCurrentRole('company_admin');
    else if (isManager) setCurrentRole('company_manager');
  }, [isSuperAdmin, isDeveloper, isAdmin, isManager]);

  // Persist to local storage
  useEffect(() => {
    if (!isHydrated) return;
    try {
      localStorage.setItem(AGENTS_KEY, JSON.stringify(agents));
    } catch (e) {
      console.warn('Failed to persist agents to localStorage', e);
    }
  }, [agents, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      localStorage.setItem(PROVIDERS_KEY, JSON.stringify(providers));
    } catch (e) {
      console.warn('Failed to persist providers to localStorage', e);
    }
  }, [providers, isHydrated]);

  useEffect(() => {
    if (!isHydrated) return;
    try {
      localStorage.setItem(CALLS_KEY, JSON.stringify(callHistory));
    } catch (e) {
      console.warn('Failed to persist call history to localStorage', e);
    }
  }, [callHistory, isHydrated]);

  const showToast = (title: string, description?: string, type: ToastItem['type'] = 'info') => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const newToast: ToastItem = { id, title, description, type };
    setToasts((prev) => [...prev, newToast]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };

  const removeToast = (id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  const permissions: RolePermissions =
    ROLE_DEFINITIONS[currentRole]?.permissions || ROLE_DEFINITIONS.workfloww_super_admin.permissions;

  const selectedAgent = agents.find((a) => a.id === selectedAgentId) || null;

  const openStudio = (agentId: string, initialTab: StudioTab = 'overview') => {
    setSelectedAgentId(agentId);
    setActiveStudioTab(initialTab);
    setView('studio');
  };

  const closeStudio = () => {
    setSelectedAgentId(null);
    setView('dashboard');
  };

  const updateAgent = (id: string, updates: Partial<VoiceAgent>) => {
    // Enforce prompt-edit permission at authoritative mutation boundary
    if ((updates.promptRaw !== undefined || updates.promptStructured !== undefined) && !permissions.canEditPrompts) {
      showToast('Permission Denied', 'Your current role does not have permission to edit prompts.', 'error');
      return;
    }

    setAgents((prev) =>
      prev.map((agent) => {
        if (agent.id !== id) return agent;
        const updated = {
          ...agent,
          ...updates,
          lastModified: 'Just now',
          hasUnsavedChanges: true,
        };

        // If structured prompt changed, compile raw prompt
        if (updates.promptStructured && !updates.promptRaw) {
          updated.promptRaw = compileStructuredToRaw(updates.promptStructured);
        }

        return updated;
      })
    );
  };

  const createAgent = (newAgent: VoiceAgent) => {
    setAgents((prev) => [newAgent, ...prev]);
    showToast('Agent Created', `Agent "${newAgent.name}" has been created successfully.`, 'success');
    openStudio(newAgent.id, 'overview');
  };

  const deleteAgent = (id: string): boolean => {
    if (!permissions.canDelete) {
      showToast('Permission Denied', 'Your role is not authorized to delete agents.', 'error');
      return false;
    }
    const target = agents.find((a) => a.id === id);
    setAgents((prev) => prev.filter((a) => a.id !== id));
    if (selectedAgentId === id) {
      closeStudio();
    }
    showToast('Agent Deleted', `Agent "${target?.name || id}" removed.`, 'info');
    return true;
  };

  const duplicateAgent = (id: string, targetCompany?: CompanyName): VoiceAgent => {
    const source = agents.find((a) => a.id === id);
    if (!source) throw new Error('Source agent not found');

    const newId = `agent-${Date.now()}`;
    const newAgent: VoiceAgent = {
      ...source,
      id: newId,
      name: `${source.name} (Copy)`,
      company: targetCompany || (selectedCompany === 'All' ? 'Lucid' : selectedCompany),
      type: 'company_copy',
      status: 'draft',
      sourceTemplateId: source.type === 'global_template' ? source.id : source.sourceTemplateId,
      sourceTemplateVersion: source.publishedVersion,
      publishedVersion: 'v1.0',
      currentDraftVersion: 'v1.0-draft',
      lastModified: 'Just now',
      testCallsCount: 0,
      averageScore: undefined,
      versions: [
        {
          version: 'v1.0',
          updatedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
          updatedBy: 'Admin',
          changeDescription: `Initial copy branched from ${source.name}`,
          promptRaw: source.promptRaw,
          promptStructured: { ...source.promptStructured },
          isPublished: false,
        },
      ],
      hasUnsavedChanges: true,
    };

    setAgents((prev) => [newAgent, ...prev]);
    showToast('Agent Duplicated', `Created "${newAgent.name}".`, 'success');
    return newAgent;
  };

  const publishAgent = (id: string, changeNotes: string) => {
    if (!permissions.canPublish) {
      showToast('Permission Denied', 'Your role is not authorized to publish changes to production.', 'error');
      return;
    }

    setAgents((prev) =>
      prev.map((agent) => {
        if (agent.id !== id) return agent;
        const currentVerNum = parseFloat(agent.publishedVersion.replace('v', '')) || 1.0;
        const newVerStr = `v${(currentVerNum + 0.1).toFixed(1)}`;

        const newVersionRecord = {
          version: newVerStr,
          updatedAt: new Date().toISOString().replace('T', ' ').substring(0, 19),
          updatedBy: 'Admin',
          changeDescription: changeNotes || 'Published updates to production environment.',
          promptRaw: agent.promptRaw,
          promptStructured: { ...agent.promptStructured },
          isPublished: true,
        };

        return {
          ...agent,
          status: 'active',
          publishedVersion: newVerStr,
          currentDraftVersion: newVerStr,
          lastModified: 'Just now',
          hasUnsavedChanges: false,
          versions: [newVersionRecord, ...agent.versions.map((v) => ({ ...v, isPublished: false }))],
        };
      })
    );

    showToast('Version Published', `Agent updated to active status and published.`, 'success');
  };

  const rollbackAgentVersion = (id: string, targetVersion: string) => {
    setAgents((prev) =>
      prev.map((agent) => {
        if (agent.id !== id) return agent;
        const targetRec = agent.versions.find((v) => v.version === targetVersion);
        if (!targetRec) return agent;

        return {
          ...agent,
          promptRaw: targetRec.promptRaw || compileStructuredToRaw(targetRec.promptStructured),
          promptStructured: { ...targetRec.promptStructured },
          currentDraftVersion: `${targetVersion}-restored`,
          lastModified: 'Just now',
          hasUnsavedChanges: true,
        };
      })
    );
    showToast('Version Restored', `Restored prompt content from ${targetVersion}. Click Save or Publish to apply.`);
  };

  const publishToRoleplay = (id: string) => {
    const target = agents.find((a) => a.id === id);
    if (!target) return;
    showToast(
      'Published to Role-Play',
      `"${target.name}" is now synced and available in Employee Role-Play scenarios.`,
      'success'
    );
  };

  const updateProvider = (id: string, updates: Partial<ProviderIntegration>) => {
    setProviders((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...updates, lastTested: 'Just now' } : p))
    );
    showToast('Provider Configuration Saved', 'Connection parameters updated.', 'success');
  };

  const testProviderConnection = async (id: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setTimeout(() => {
        setProviders((prev) =>
          prev.map((p) => {
            if (p.id !== id) return p;
            const isSuccess = p.status !== 'disabled';
            return {
              ...p,
              status: isSuccess ? 'connected' : 'disabled',
              lastTested: 'Just now',
              pingLatencyMs: Math.floor(Math.random() * 80) + 120,
            };
          })
        );
        showToast('Connection Test Passed', `${id.toUpperCase()} responding with nominal sub-200ms latency.`, 'success');
        resolve(true);
      }, 700);
    });
  };

  const recordTestCall = (call: Omit<CallRecord, 'id' | 'date'>): CallRecord => {
    const fullCall: CallRecord = {
      ...call,
      id: `CALL-${Date.now().toString().slice(-4)}-${Math.floor(Math.random() * 899 + 100)}`,
      date: new Date().toISOString().replace('T', ' ').substring(0, 19),
    };

    setCallHistory((prev) => [fullCall, ...prev]);

    // Update agent test count
    setAgents((prev) =>
      prev.map((a) => {
        if (a.id !== call.agentId) return a;
        const newCount = (a.testCallsCount || 0) + 1;
        const newScore = call.score
          ? Math.round(((a.averageScore || 85) * (newCount - 1) + call.score) / newCount)
          : a.averageScore;
        return {
          ...a,
          testCallsCount: newCount,
          averageScore: newScore,
          lastModified: 'Just now',
        };
      })
    );

    return fullCall;
  };

  const resetAllData = () => {
    if (typeof window !== 'undefined') {
      localStorage.removeItem(AGENTS_KEY);
      localStorage.removeItem(PROVIDERS_KEY);
      localStorage.removeItem(CALLS_KEY);
    }
    setAgents(INITIAL_AGENTS);
    setProviders(INITIAL_PROVIDERS);
    setCallHistory(INITIAL_CALL_HISTORY);
    showToast('Data Reset', 'Restored pristine initial dataset with all 8 agents.', 'info');
  };

  return (
    <VoiceAgentsContext.Provider
      value={{
        agents,
        templates,
        providers,
        callHistory,
        currentRole,
        selectedCompany,
        currentView,
        selectedAgentId,
        selectedAgent,
        activeStudioTab,
        permissions,
        toasts,
        setView,
        openStudio,
        closeStudio,
        setActiveStudioTab,
        setCurrentRole,
        setSelectedCompany,
        updateAgent,
        createAgent,
        deleteAgent,
        duplicateAgent,
        publishAgent,
        rollbackAgentVersion,
        publishToRoleplay,
        updateProvider,
        testProviderConnection,
        recordTestCall,
        showToast,
        removeToast,
        resetAllData,
      }}
    >
      {children}
    </VoiceAgentsContext.Provider>
  );
};

export const useVoiceAgents = () => {
  const context = useContext(VoiceAgentsContext);
  if (!context) {
    throw new Error('useVoiceAgents must be used within a VoiceAgentsProvider');
  }
  return context;
};

// Alias so that imported studio components using useApp work directly
export const useApp = useVoiceAgents;
export const AppProvider = VoiceAgentsProvider;
