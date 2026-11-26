export type UserRole =
  | 'workfloww_super_admin'
  | 'workfloww_developer'
  | 'company_admin'
  | 'company_manager'
  | 'viewer';

export interface RolePermissions {
  canViewAllCompanies: boolean;
  canCreateGlobalTemplates: boolean;
  canCreateAgents: boolean;
  canEditPrompts: boolean;
  canEditAllPromptSections: boolean;
  canManageProviders: boolean;
  canTestBrowser: boolean;
  canTestPhone: boolean;
  canPublish: boolean;
  canDelete: boolean;
  canViewLogs: boolean;
  canManageAccess: boolean;
  canManageKnowledgeBase: boolean;
}

export type CompanyName =
  | 'Lucid'
  | 'QSR'
  | 'Consumer Goods'
  | 'EY'
  | 'FMCG Global'
  | 'Demo Corp';

export type AgentStatus = 'draft' | 'active' | 'paused' | 'archived';

export type AgentType = 'global_template' | 'company_agent' | 'company_copy';

export type VoiceProviderId = 'elevenlabs' | 'openai' | 'vapi' | 'retell' | 'custom';

export interface StructuredPromptSections {
  agentIdentity: string;
  roleAndObjective: string;
  personalityAndTone: string;
  conversationFlow: string;
  contextAndBackground: string;
  behaviouralRules: string;
  objectionHandling: string;
  fallbackBehaviour: string;
  conversationEnding: string;
}

export interface SectionConfig {
  key: keyof StructuredPromptSections;
  title: string;
  description: string;
  enabled: boolean;
}

export type VariableType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface OutputVariable {
  id: string;
  name: string;
  description: string;
  type: VariableType;
  required: boolean;
  defaultValue?: string | number | boolean;
  validationRules?: string;
  extractedValue?: any;
}

export interface VoiceSettings {
  voiceId: string;
  voiceName: string;
  gender: 'male' | 'female' | 'neutral';
  language: string;
  accent: string;
  speed: number; // 0.5 to 2.0
  stability?: number; // 0.0 to 1.0 (ElevenLabs)
  similarity?: number; // 0.0 to 1.0 (ElevenLabs)
  responseLatency?: number; // 0.1 to 1.0
  allowBargeIn: boolean;
  silenceTimeoutSeconds: number;
  maxDurationMinutes: number;
  backgroundDenoise: 'krisp' | 'standard' | 'off';
  temperature?: number;
}

export interface KnowledgeSource {
  id: string;
  title: string;
  type: 'pdf' | 'docx' | 'txt' | 'url' | 'custom';
  size?: string;
  sourceUrl?: string;
  dateAdded: string;
  status: 'ready' | 'processing' | 'failed';
  contentSnippet: string;
  charCount: number;
}

export interface EvaluationCriterion {
  id: string;
  name: string;
  description: string;
  weight: number; // Percentage (summing to 100)
  passingScore: number; // out of 100
  criticalFailRule?: string;
}

export interface EvaluationConfig {
  enabled: boolean;
  passingThreshold: number; // default e.g. 70%
  criteria: EvaluationCriterion[];
  criticalFailurePolicy: string;
  readinessClassifications: {
    level: string;
    minScore: number;
    description: string;
  }[];
}

export interface TranscriptMessage {
  id: string;
  sender: 'agent' | 'user';
  text: string;
  timestamp: string;
  confidence?: number;
  sentiment?: 'positive' | 'neutral' | 'constructive' | 'negative';
}

export interface CallRecord {
  id: string;
  agentId: string;
  agentName: string;
  company: CompanyName;
  date: string;
  caller: string;
  destinationPhone?: string;
  type: 'browser' | 'phone';
  provider: VoiceProviderId;
  durationSeconds: number;
  status: 'completed' | 'failed' | 'busy' | 'no_answer' | 'rejected';
  score?: number;
  passed?: boolean;
  transcript: TranscriptMessage[];
  extractedVariables: Record<string, any>;
  evaluationScores: Record<string, number>;
  latencyMs: number;
  summary: string;
  technicalError?: string;
}

export interface PromptVersionRecord {
  version: string;
  updatedAt: string;
  updatedBy: string;
  changeDescription: string;
  promptRaw: string;
  promptStructured: StructuredPromptSections;
  isPublished: boolean;
}

export interface VoiceAgent {
  id: string;
  name: string;
  description: string;
  category: string;
  company: CompanyName;
  owner: string;
  provider: VoiceProviderId;
  model: string;
  status: AgentStatus;
  type: AgentType;
  sourceTemplateId?: string;
  sourceTemplateVersion?: string;
  publishedVersion: string;
  currentDraftVersion: string;
  lastModified: string;
  testCallsCount: number;
  averageScore?: number;
  avatarColor: 'blue' | 'amber' | 'crimson' | 'emerald' | 'purple';
  promptMode: 'structured' | 'advanced';
  promptStructured: StructuredPromptSections;
  promptRaw: string;
  outputVariables: OutputVariable[];
  voiceSettings: VoiceSettings;
  knowledgeBase: KnowledgeSource[];
  evaluation: EvaluationConfig;
  versions: PromptVersionRecord[];
  hasUnsavedChanges?: boolean;
}

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  supportedLanguages: string[];
  recommendedProvider: VoiceProviderId;
  version: string;
  defaultPromptStructured: StructuredPromptSections;
  defaultVariables: OutputVariable[];
  defaultEvaluation: EvaluationConfig;
}

export interface ProviderIntegration {
  id: VoiceProviderId;
  name: string;
  description: string;
  status: 'connected' | 'not_connected' | 'error' | 'disabled';
  apiKeyMasked: string;
  availableModels: string[];
  capabilities: string[];
  phoneNumbers: string[];
  webhookUrl: string;
  lastTested: string;
  pingLatencyMs: number;
}
