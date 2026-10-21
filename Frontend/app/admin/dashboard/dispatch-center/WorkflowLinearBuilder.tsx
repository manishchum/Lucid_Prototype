'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Zap,
  ArrowRight,
  ArrowLeft,
  Check,
  CheckCircle2,
  AlertCircle,
  Play,
  Layers,
  GraduationCap,
  BookOpen,
  Flame,
  Award,
  Users,
  Compass,
  Radio,
  Bell,
  Smartphone,
  Mail,
  MessageSquare,
  Sparkles,
  HelpCircle,
  Clock,
  Send,
  Eye,
  GitBranch,
  Search,
  Filter,
  Tag,
  UserCheck,
  Building2,
  Shield,
  ChevronDown,
  ChevronUp,
  SlidersHorizontal,
  FileText,
  CheckCircle,
  RefreshCw,
  Megaphone,
} from 'lucide-react';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import { useAuth } from '@/contexts/auth-context';
import { PREDEFINED_CATEGORIES, NotificationTemplate } from './TemplateManagerTab';
import InfoTooltip from './InfoTooltip';

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

export interface WorkflowRule {
  field: string;
  operator: string;
  value: string | number;
}

export interface WorkflowFormData {
  id?: string;
  title: string;
  description?: string;
  category: string;
  trigger_lifecycle: string;
  notification_type?: string;
  template_id?: string;
  pinned_template_id?: string;
  pinned_template_version_id?: string;
  secondary_template_id?: string;
  title_template?: string;
  body_template?: string;
  secondary_title_template?: string;
  secondary_body_template?: string;
  rule_mode: 'THRESHOLD' | 'DUAL_BRANCH' | 'UNCONDITIONAL';
  filter_rules: WorkflowRule[];
  filter_match_type: 'ALL' | 'ANY';
  channels: string[];
  cooldown_seconds: number;
  priority: string;
  is_active: boolean;
  recipient_routing?: 'LEARNER' | 'MANAGER' | 'BOTH';
  audience_filter?: {
    departments?: string[];
    roles?: string[];
    module_ids?: string[];
  };
  schedule_type?: 'EVENT_DRIVEN' | 'RECURRING';
  schedule_config?: {
    frequency?: 'DAILY' | 'WEEKLY' | 'EVERY_N_DAYS';
    days?: string[];
    time?: string;
    interval_days?: number;
  };
}

export function formatApiError(errDetail: any, fallbackMessage: string = 'An error occurred'): string {
  if (!errDetail) return fallbackMessage;
  if (typeof errDetail === 'string') return errDetail;
  if (Array.isArray(errDetail)) {
    return errDetail
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object') {
          const loc = Array.isArray(item.loc)
            ? item.loc.filter((l: any) => l !== 'body').join('.')
            : '';
          const msg = item.msg || JSON.stringify(item);
          return loc ? `${loc}: ${msg}` : msg;
        }
        return String(item);
      })
      .join('; ');
  }
  if (typeof errDetail === 'object') {
    if (errDetail.message) return String(errDetail.message);
    return JSON.stringify(errDetail);
  }
  return String(errDetail);
}

// Deprecated smart recipes kept empty for backwards compatibility
export const SMART_RULE_RECIPES: Record<string, any[]> = {};

export interface PredefinedTrigger {
  key: string;
  category: string;
  label: string;
  description: string;
  ruleArchetype: 'ZERO_RULE' | 'THRESHOLD' | 'TIME_OFFSET';
  icon: any;
  variables: string[];
}

export const PREDEFINED_SYSTEM_TRIGGERS: PredefinedTrigger[] = [
  // ─── 0. ANNOUNCEMENTS & INFO ──────────────────────────────────────────
  {
    key: 'GENERAL_ANNOUNCEMENT',
    category: 'ANNOUNCEMENTS_INFO',
    label: 'General Announcement / Broadcast',
    description: 'Company-wide or targeted announcement delivered directly via In-App Bell & Mobile Push.',
    ruleArchetype: 'ZERO_RULE',
    icon: Megaphone,
    variables: ['subscriber.first_name', 'system.title', 'system.message', 'system.action_url'],
  },
  {
    key: 'TEAM_CHECKIN_NUDGE',
    category: 'ANNOUNCEMENTS_INFO',
    label: 'Team Check-in / How are you doing?',
    description: 'Friendly pulse check-in nudge sent periodically or manually to support learner wellbeing.',
    ruleArchetype: 'ZERO_RULE',
    icon: Compass,
    variables: ['subscriber.first_name', 'subscriber.company_name', 'system.action_url'],
  },
  {
    key: 'SYSTEM_ALERT',
    category: 'ANNOUNCEMENTS_INFO',
    label: 'System Notice / Maintenance Alert',
    description: 'Alerts learners of scheduled maintenance, system outages, or critical status advisories.',
    ruleArchetype: 'ZERO_RULE',
    icon: AlertCircle,
    variables: ['subscriber.first_name', 'system.title', 'system.message'],
  },
  {
    key: 'APP_UPDATE_NOTICE',
    category: 'ANNOUNCEMENTS_INFO',
    label: 'App Update / New Feature Release',
    description: 'Informs learners about new product features, drills, or platform upgrades.',
    ruleArchetype: 'ZERO_RULE',
    icon: Sparkles,
    variables: ['subscriber.first_name', 'system.title', 'system.version', 'system.action_url'],
  },
  {
    key: 'DEV_HEALTH_CHECK',
    category: 'ANNOUNCEMENTS_INFO',
    label: 'Developer Health / Ping Check',
    description: 'Developer diagnostics ping to verify in-app delivery and mobile push tokens.',
    ruleArchetype: 'ZERO_RULE',
    icon: Zap,
    variables: ['subscriber.first_name', 'system.title'],
  },
  {
    key: 'DEV_CUSTOM_EVENT_1',
    category: 'ANNOUNCEMENTS_INFO',
    label: 'Developer Hook 1 (Custom Trigger)',
    description: 'Custom programmatic hook triggered via POST /api/notifications/workflows/trigger-hook.',
    ruleArchetype: 'ZERO_RULE',
    icon: Zap,
    variables: ['subscriber.first_name', 'custom.event_payload'],
  },
  {
    key: 'DEV_CUSTOM_EVENT_2',
    category: 'ANNOUNCEMENTS_INFO',
    label: 'Developer Hook 2 (Custom Trigger)',
    description: 'Secondary custom programmatic hook triggered via developer API.',
    ruleArchetype: 'ZERO_RULE',
    icon: Zap,
    variables: ['subscriber.first_name', 'custom.event_payload'],
  },

  // ─── 1. USER ONBOARDING ────────────────────────────────────────────────
  {
    key: 'USER_WELCOME',
    category: 'ONBOARDING',
    label: 'Learner Welcome & Activation',
    description: 'Triggered when a learner logs in for the very first time.',
    ruleArchetype: 'ZERO_RULE',
    icon: Users,
    variables: ['subscriber.first_name', 'subscriber.company_name', 'subscriber.role', 'subscriber.department'],
  },
  {
    key: 'LEARNING_STYLE_DISCOVERED',
    category: 'ONBOARDING',
    label: 'VARK Modality Diagnosed',
    description: 'Fires once the learner completes their VARK learning intake quiz.',
    ruleArchetype: 'ZERO_RULE',
    icon: Compass,
    variables: ['subscriber.first_name', 'vark.primary_style', 'vark.recommended_cta_label'],
  },

  // ─── 2. SPRINT ASSIGNMENT ──────────────────────────────────────────────
  {
    key: 'MODULE_ASSIGNED',
    category: 'SPRINT_ASSIGNMENT',
    label: 'Sprint Assigned',
    description: 'Fires immediately when an admin, lead, or system assigns a sprint to a user.',
    ruleArchetype: 'ZERO_RULE',
    icon: BookOpen,
    variables: ['subscriber.first_name', 'curriculum.module_name', 'curriculum.due_date', 'curriculum.action_url'],
  },
  {
    key: 'COURSE_COMPLETED',
    category: 'SPRINT_ASSIGNMENT',
    label: 'Sprint Track Finished',
    description: 'Celebrates 100% completion of an entire sprint track or curriculum path.',
    ruleArchetype: 'ZERO_RULE',
    icon: Award,
    variables: ['subscriber.first_name', 'curriculum.module_name'],
  },

  // ─── 3. QUIZZES ────────────────────────────────────────────────────────
  {
    key: 'QUIZ_PASSED',
    category: 'QUIZZES',
    label: 'Quiz Passed Milestone',
    description: 'Sent immediately when user completes quiz above pass threshold.',
    ruleArchetype: 'ZERO_RULE',
    icon: CheckCircle2,
    variables: ['subscriber.first_name', 'curriculum.module_name', 'assessment.score', 'gamification.xp_points'],
  },
  {
    key: 'QUIZ_FAILED',
    category: 'QUIZZES',
    label: 'Quiz Retry & Remediation Needed',
    description: 'Gentle notice with retry encouragement when quiz score is below threshold.',
    ruleArchetype: 'ZERO_RULE',
    icon: AlertCircle,
    variables: ['subscriber.first_name', 'curriculum.module_name', 'assessment.score', 'assessment.weak_topic'],
  },
  {
    key: 'ASSESSMENT_COMPLETED',
    category: 'QUIZZES',
    label: 'Quiz Result / Evaluation',
    description: 'Fires upon quiz submission; allows setting custom score thresholds (e.g. Score >= 80%).',
    ruleArchetype: 'THRESHOLD',
    icon: GraduationCap,
    variables: ['subscriber.first_name', 'curriculum.module_name', 'assessment.score', 'assessment.passing_score'],
  },
  {
    key: 'QUIZ_WAITING_REMINDER',
    category: 'QUIZZES',
    label: 'Quiz Waiting to Take Reminder',
    description: 'Reminder sent when an assigned sprint quiz has not been attempted after X days.',
    ruleArchetype: 'TIME_OFFSET',
    icon: Clock,
    variables: ['subscriber.first_name', 'curriculum.module_name', 'curriculum.action_url'],
  },
  {
    key: 'POST_COMPLETION_FEEDBACK',
    category: 'QUIZZES',
    label: 'Post-Completion CSAT Survey Prompt',
    description: 'Prompts learner for 1-click feedback immediately upon finishing a quiz.',
    ruleArchetype: 'ZERO_RULE',
    icon: MessageSquare,
    variables: ['subscriber.first_name', 'curriculum.module_name'],
  },

  // ─── 4. GAMIFICATION ARENA ────────────────────────────────────────────
  {
    key: 'GAMIFICATION_SPRINT_READY',
    category: 'GAMIFICATION',
    label: 'Gamification Sprint Ready',
    description: 'Fires when an arena sprint battle or weekly speed sprint challenge unlocks.',
    ruleArchetype: 'ZERO_RULE',
    icon: Flame,
    variables: ['subscriber.first_name', 'curriculum.module_name', 'gamification.xp_points'],
  },
  {
    key: 'GAMIFICATION_DRILL_REMINDER',
    category: 'GAMIFICATION',
    label: 'Gamification Drills Waiting to Take',
    description: 'Nudge sent when arena drills or flash challenges have been pending for X days.',
    ruleArchetype: 'TIME_OFFSET',
    icon: Clock,
    variables: ['subscriber.first_name', 'gamification.xp_points'],
  },
  {
    key: 'DAILY_STREAK_CHECK',
    category: 'GAMIFICATION',
    label: 'Daily Streak Rescue Check & Reminder',
    description: 'Warns learner that their active streak will expire unless they practice before midnight.',
    ruleArchetype: 'THRESHOLD',
    icon: Flame,
    variables: ['subscriber.first_name', 'gamification.streak_days', 'gamification.points_to_next_rank', 'gamification.rival_name'],
  },
  {
    key: 'STREAK_MILESTONE',
    category: 'GAMIFICATION',
    label: 'Streak Milestone Reached',
    description: 'Celebrates continuous learning streak milestones (e.g. 7-day, 14-day, 30-day).',
    ruleArchetype: 'THRESHOLD',
    icon: Award,
    variables: ['subscriber.first_name', 'gamification.streak_days', 'gamification.xp_points'],
  },
  {
    key: 'BADGE_UNLOCKED',
    category: 'GAMIFICATION',
    label: 'Achievement Badge Unlocked',
    description: 'Celebrates unlocking an achievement badge or skill certification.',
    ruleArchetype: 'ZERO_RULE',
    icon: Award,
    variables: ['subscriber.first_name', 'gamification.badge_name', 'gamification.earned_xp'],
  },
  {
    key: 'LEADERBOARD_ALERT',
    category: 'GAMIFICATION',
    label: 'Leaderboard Shift Alert',
    description: 'Notifies learner when they climb ranks or get overtaken on the competitive arena leaderboard.',
    ruleArchetype: 'THRESHOLD',
    icon: Users,
    variables: ['subscriber.first_name', 'gamification.leaderboard_rank', 'gamification.rival_name', 'gamification.points_to_next_rank'],
  },

  // ─── 5. DEADLINES ─────────────────────────────────────────────────────
  {
    key: 'MODULE_DUE_REMINDER',
    category: 'DEADLINES',
    label: 'Sprint Due Reminder',
    description: 'Automated reminder dispatched at a developer-configured time ahead of sprint deadline.',
    ruleArchetype: 'TIME_OFFSET',
    icon: Clock,
    variables: ['subscriber.first_name', 'curriculum.module_name', 'curriculum.days_left', 'curriculum.due_date'],
  },
  {
    key: 'TASK_DUE_REMINDER',
    category: 'DEADLINES',
    label: 'Task Due Reminder',
    description: 'Automated reminder dispatched at a developer-configured time ahead of practical task deadline.',
    ruleArchetype: 'TIME_OFFSET',
    icon: Clock,
    variables: ['subscriber.first_name', 'task.task_title', 'task.due_date'],
  },
  {
    key: 'MODULE_OVERDUE',
    category: 'DEADLINES',
    label: 'Overdue Escalation Alert',
    description: 'Escalation notice when an assigned sprint or task passes its completion deadline.',
    ruleArchetype: 'ZERO_RULE',
    icon: AlertCircle,
    variables: ['subscriber.first_name', 'curriculum.module_name', 'subscriber.manager_name'],
  },

  // ─── 6. TASKS ─────────────────────────────────────────────────────────
  {
    key: 'TASK_ASSIGNED',
    category: 'TASKS',
    label: 'Workplace Task Assigned',
    description: 'Fires immediately when a manager or lead assigns a practical workplace assignment.',
    ruleArchetype: 'ZERO_RULE',
    icon: Layers,
    variables: ['subscriber.first_name', 'task.task_title', 'task.due_date'],
  },
  {
    key: 'TASK_EVALUATED',
    category: 'TASKS',
    label: 'Task AI Evaluation Ready',
    description: 'Fires when AI finishes evaluating submission with pass/fail verdict and coaching advice.',
    ruleArchetype: 'ZERO_RULE',
    icon: Layers,
    variables: ['subscriber.first_name', 'task.task_title', 'task.feedback_summary'],
  },

  // ─── 7. RE-ENGAGEMENT NUDGES ──────────────────────────────────────────
  {
    key: 'SCHEDULED_SCAN',
    category: 'RE_ENGAGEMENT',
    label: 'Inactivity Sweep Nudge',
    description: 'Periodic automated sweep targeting learners who have had zero activity for X days.',
    ruleArchetype: 'THRESHOLD',
    icon: Compass,
    variables: ['subscriber.first_name', 'curriculum.module_name'],
  },
  {
    key: 'POST_ASSIGNMENT_NUDGE',
    category: 'RE_ENGAGEMENT',
    label: 'Pending Assignment Follow-up Nudge',
    description: 'Follow-up nudge sent when a sprint or task has remained unstarted after X days.',
    ruleArchetype: 'TIME_OFFSET',
    icon: Clock,
    variables: ['subscriber.first_name', 'curriculum.module_name', 'curriculum.action_url'],
  },

  // ─── 8. ROLEPLAY ──────────────────────────────────────────────────────
  {
    key: 'ROLEPLAY_ASSIGNED',
    category: 'ROLEPLAY',
    label: 'Roleplay Scenario Assigned',
    description: 'Fires when an interactive conversation or sales simulation is assigned.',
    ruleArchetype: 'ZERO_RULE',
    icon: Award,
    variables: ['subscriber.first_name', 'curriculum.module_name'],
  },
  {
    key: 'ROLEPLAY_REPORT_READY',
    category: 'ROLEPLAY',
    label: 'Roleplay Report Generated',
    description: 'Dispatched when AI audio/speech simulation evaluation and scoring is complete.',
    ruleArchetype: 'ZERO_RULE',
    icon: GraduationCap,
    variables: ['subscriber.first_name', 'assessment.confidence_score', 'assessment.feedback_summary', 'assessment.score'],
  },
  {
    key: 'ROLEPLAY_RETAKE',
    category: 'ROLEPLAY',
    label: 'Roleplay Retake Needed',
    description: 'Fires when roleplay fluency or confidence falls below threshold, recommending practice.',
    ruleArchetype: 'THRESHOLD',
    icon: AlertCircle,
    variables: ['subscriber.first_name', 'assessment.score', 'assessment.feedback_summary'],
  },

  // ─── 9. CONTENT LIBRARY ───────────────────────────────────────────────
  {
    key: 'NEW_CONTENT_UPLOADED',
    category: 'CONTENT_LIBRARY',
    label: 'New Content Uploaded',
    description: 'Fires when new podcasts, articles, or resources are added to the library.',
    ruleArchetype: 'ZERO_RULE',
    icon: Radio,
    variables: ['subscriber.first_name', 'recommendations.content_name'],
  },

  // ─── 10. REPORTS ──────────────────────────────────────────────────────
  {
    key: 'SPRINT_REPORT_GENERATED',
    category: 'REPORTS',
    label: 'Sprint Performance Report Ready',
    description: 'Summary report generated upon completion of a sprint track or checkpoint.',
    ruleArchetype: 'ZERO_RULE',
    icon: FileText,
    variables: ['subscriber.first_name', 'curriculum.module_name', 'assessment.score'],
  },
  {
    key: 'ROLEPLAY_REPORT_GENERATED',
    category: 'REPORTS',
    label: 'Roleplay Rubric Report Ready',
    description: 'Detailed rubric and coaching report generated for simulation exercises.',
    ruleArchetype: 'ZERO_RULE',
    icon: FileText,
    variables: ['subscriber.first_name', 'assessment.score', 'assessment.feedback_summary'],
  },
];

interface WorkflowLinearBuilderProps {
  initialWorkflow?: any | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function WorkflowLinearBuilder({
  initialWorkflow,
  onClose,
  onSaved,
}: WorkflowLinearBuilderProps) {
  const { user, employeeData } = useAuth();
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Wizard Step: 1 -> 2 -> 3 -> 4
  const [currentStep, setCurrentStep] = useState<number>(1);

  // Available Templates loaded from API
  const [availableTemplates, setAvailableTemplates] = useState<NotificationTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);

  // Form State
  const [workflowTitle, setWorkflowTitle] = useState(initialWorkflow?.title || '');
  const [workflowCategory, setWorkflowCategory] = useState(initialWorkflow?.category || 'ONBOARDING');
  const [selectedTriggerKey, setSelectedTriggerKey] = useState(
    initialWorkflow?.trigger_lifecycle || 'USER_WELCOME'
  );

  // Step 2: Templates
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    initialWorkflow?.pinned_template_id || initialWorkflow?.template_id || ''
  );
  const [secondaryTemplateId, setSecondaryTemplateId] = useState<string>(
    initialWorkflow?.secondary_template_id || ''
  );

  // Current Trigger definition
  const currentTrigger =
    PREDEFINED_SYSTEM_TRIGGERS.find((t) => t.key === selectedTriggerKey) ||
    PREDEFINED_SYSTEM_TRIGGERS[0];

  // Step 3: Rules & Archetypes
  const [ruleMode, setRuleMode] = useState<'THRESHOLD' | 'DUAL_BRANCH' | 'UNCONDITIONAL'>(
    initialWorkflow?.rule_mode || (currentTrigger.ruleArchetype === 'ZERO_RULE' ? 'UNCONDITIONAL' : 'THRESHOLD')
  );
  const [dualBranchEnabled, setDualBranchEnabled] = useState<boolean>(
    initialWorkflow?.rule_mode === 'DUAL_BRANCH'
  );

  // Relative Time Offset State (for TIME_OFFSET triggers)
  const [timeOffsetValue, setTimeOffsetValue] = useState<number>(() => {
    if (initialWorkflow?.filter_rules && initialWorkflow.filter_rules.length > 0) {
      const val = Number(initialWorkflow.filter_rules[0].value);
      if (!isNaN(val) && val > 0) return val;
    }
    return 24;
  });
  const [timeOffsetUnit, setTimeOffsetUnit] = useState<'HOURS' | 'DAYS'>('HOURS');

  // Contextual Metric Threshold State (for THRESHOLD triggers)
  const [thresholdOperator, setThresholdOperator] = useState<string>(
    initialWorkflow?.filter_rules?.[0]?.operator || '>='
  );
  const [thresholdValue, setThresholdValue] = useState<string>(
    initialWorkflow?.filter_rules?.[0]?.value !== undefined
      ? String(initialWorkflow.filter_rules[0].value)
      : '70'
  );

  // Fallback explicit rules array
  const [rules, setRules] = useState<WorkflowRule[]>(
    initialWorkflow?.filter_rules && initialWorkflow.filter_rules.length > 0
      ? initialWorkflow.filter_rules.map((r: any) => ({
          field: r.field || r.variable || 'assessment.score',
          operator: r.operator || '<',
          value: r.value !== undefined ? String(r.value) : '70',
        }))
      : []
  );

  // Step 3 Extended: Recipient Routing & Audience Scoping
  const [recipientRouting, setRecipientRouting] = useState<'LEARNER' | 'MANAGER' | 'BOTH'>(
    initialWorkflow?.recipient_routing || 'LEARNER'
  );
  const [audienceFilter, setAudienceFilter] = useState<{
    departments: string[];
    roles: string[];
    module_ids: string[];
  }>({
    departments: Array.isArray(initialWorkflow?.audience_filter?.departments)
      ? initialWorkflow.audience_filter.departments
      : [],
    roles: Array.isArray(initialWorkflow?.audience_filter?.roles)
      ? initialWorkflow.audience_filter.roles
      : [],
    module_ids: Array.isArray(initialWorkflow?.audience_filter?.module_ids)
      ? initialWorkflow.audience_filter.module_ids
      : [],
  });
  const [isAudienceExpanded, setIsAudienceExpanded] = useState(false);

  // Step 4: Channels (Strictly Mobile Push and In-App for this phase)
  const [selectedChannels, setSelectedChannels] = useState<string[]>(() => {
    const raw = initialWorkflow?.channels || ['IN_APP', 'PUSH'];
    const filtered = raw.filter((c: string) => ['IN_APP', 'PUSH'].includes(c));
    return filtered.length > 0 ? filtered : ['IN_APP', 'PUSH'];
  });
  const [cooldownHours, setCooldownHours] = useState<number>(
    Math.round((initialWorkflow?.cooldown_seconds || 3600) / 3600) || 1
  );

  // Live Test State
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Schedule Mode & Config State
  const [scheduleType, setScheduleType] = useState<'EVENT_DRIVEN' | 'RECURRING'>(
    initialWorkflow?.schedule_type || initialWorkflow?.audience_filter?.schedule?.type || 'EVENT_DRIVEN'
  );
  const [scheduleConfig, setScheduleConfig] = useState({
    frequency: (initialWorkflow?.schedule_config?.frequency || initialWorkflow?.audience_filter?.schedule?.config?.frequency || 'DAILY') as 'DAILY' | 'WEEKLY' | 'EVERY_N_DAYS',
    time: (initialWorkflow?.schedule_config?.time || initialWorkflow?.audience_filter?.schedule?.config?.time || '09:00') as string,
    days: (initialWorkflow?.schedule_config?.days || initialWorkflow?.audience_filter?.schedule?.config?.days || ['MON', 'TUE', 'WED', 'THU', 'FRI']) as string[],
    interval_days: (initialWorkflow?.schedule_config?.interval_days || initialWorkflow?.audience_filter?.schedule?.config?.interval_days || 1) as number,
    timezone: (initialWorkflow?.schedule_config?.timezone || initialWorkflow?.audience_filter?.schedule?.config?.timezone || (typeof Intl !== 'undefined' ? Intl.DateTimeFormat().resolvedOptions().timeZone : 'Asia/Kolkata')) as string,
  });

  // Broadcast & Audience Preview State
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastStatus, setBroadcastStatus] = useState<{ success: boolean; message: string } | null>(null);
  const [previewingAudience, setPreviewingAudience] = useState(false);
  const [audiencePreviewData, setAudiencePreviewData] = useState<{ count: number; sample: any[] } | null>(null);

  // Fetch templates
  useEffect(() => {
    const load = async () => {
      try {
        setTemplatesLoading(true);
        const res = await fetchWithAuth(`${API_BASE}/api/notifications/templates`);
        if (res.ok) {
          const data = await res.json();
          const list = data.templates || [];
          setAvailableTemplates(list);

          if (!selectedTemplateId && list.length > 0) {
            const matching = list.find((t: NotificationTemplate) => t.category === workflowCategory);
            if (matching) setSelectedTemplateId(matching.id);
            else setSelectedTemplateId(list[0].id);
          }
        }
      } catch (e) {
        console.error('Failed to load templates in workflow builder:', e);
      } finally {
        setTemplatesLoading(false);
      }
    };
    load();
  }, [workflowCategory]);

  // Sync ruleMode when trigger or dual-branching changes
  useEffect(() => {
    if (dualBranchEnabled) {
      setRuleMode('DUAL_BRANCH');
    } else if (currentTrigger.ruleArchetype === 'ZERO_RULE') {
      setRuleMode('UNCONDITIONAL');
    } else {
      setRuleMode('THRESHOLD');
    }
  }, [selectedTriggerKey, dualBranchEnabled, currentTrigger.ruleArchetype]);

  // Selected Primary & Secondary Template Objects
  const primaryTemplate = availableTemplates.find((t) => t.id === selectedTemplateId);
  const secondaryTemplate = availableTemplates.find((t) => t.id === secondaryTemplateId);

  // Step 2: Split-Pane State
  const [templateSearchQuery, setTemplateSearchQuery] = useState('');
  const [templateCategoryFilter, setTemplateCategoryFilter] = useState('ALL');
  const [activeBranchTab, setActiveBranchTab] = useState<'PRIMARY' | 'SECONDARY'>('PRIMARY');
  const [previewChannel, setPreviewChannel] = useState<'PUSH' | 'IN_APP'>('PUSH');

  // Filtered Templates for Step 2 Catalog
  const filteredTemplates = availableTemplates.filter((t) => {
    const matchesCategory =
      templateCategoryFilter === 'ALL' || t.category === templateCategoryFilter;
    const q = templateSearchQuery.toLowerCase().trim();
    if (!q) return matchesCategory;
    const matchesQuery =
      (t.template_name && t.template_name.toLowerCase().includes(q)) ||
      (t.notification_type && t.notification_type.toLowerCase().includes(q)) ||
      (t.title_template && t.title_template.toLowerCase().includes(q)) ||
      (t.body_template && t.body_template.toLowerCase().includes(q));
    return matchesCategory && matchesQuery;
  });

  // Extract variables helper
  const extractTokens = (tpl?: NotificationTemplate | null): string[] => {
    if (!tpl) return [];
    const text = `${tpl.title_template || ''} ${tpl.body_template || ''}`;
    const matches = text.match(/\{\{([^}]+)\}\}/g) || [];
    return Array.from(
      new Set(
        matches
          .map((m) => m.replace(/[{}]/g, '').trim())
          .filter((k) => !k.startsWith('#') && !k.startsWith('/') && !k.startsWith('^'))
      )
    );
  };

  // Interpolation helper for real-time live preview
  const loggedInName = employeeData?.name || (user as any)?.name || user?.email?.split('@')[0] || 'Learner';
  const renderInterpolatedPreview = (rawText?: string): string => {
    if (!rawText) return '';
    return rawText
      .replace(/\{\{\s*subscriber\.first_name\s*\}\}/gi, loggedInName)
      .replace(/\{\{\s*subscriber\.full_name\s*\}\}/gi, `${loggedInName} Mercer`)
      .replace(/\{\{\s*first_name\s*\}\}/gi, loggedInName)
      .replace(/\{\{\s*subscriber\.company_name\s*\}\}/gi, 'Acme Corp')
      .replace(/\{\{\s*company_name\s*\}\}/gi, 'Acme Corp')
      .replace(/\{\{\s*curriculum\.module_name\s*\}\}/gi, 'Sprint 2: Async Workflows')
      .replace(/\{\{\s*module_name\s*\}\}/gi, 'Sprint 2: Async Workflows')
      .replace(/\{\{\s*assessment\.score\s*\}\}/gi, '88%')
      .replace(/\{\{\s*score\s*\}\}/gi, '88%')
      .replace(/\{\{\s*assessment\.weak_topic\s*\}\}/gi, 'Objection Handling')
      .replace(/\{\{\s*gamification\.streak_days\s*\}\}/gi, '7')
      .replace(/\{\{\s*streak_days\s*\}\}/gi, '7')
      .replace(/\{\{\s*gamification\.badge_name\s*\}\}/gi, 'Master Negotiator')
      .replace(/\{\{\s*badge_name\s*\}\}/gi, 'Master Negotiator')
      .replace(/\{\{\s*curriculum\.days_left\s*\}\}/gi, '2')
      .replace(/\{\{\s*days_left\s*\}\}/gi, '2')
      .replace(/\{\{\s*curriculum\.due_date\s*\}\}/gi, 'Friday, Oct 24')
      .replace(/\{\{\s*due_date\s*\}\}/gi, 'Friday, Oct 24')
      .replace(/\{\{\s*task\.task_title\s*\}\}/gi, 'Quarterly Client Case Review')
      .replace(/\{\{\s*task_title\s*\}\}/gi, 'Quarterly Client Case Review')
      .replace(/\{\{#[^}]+\}\}/g, '')
      .replace(/\{\{\/[^}]+\}\}/g, '');
  };

  const handleToggleChannel = (channel: string) => {
    if (!['IN_APP', 'PUSH'].includes(channel)) return;
    if (selectedChannels.includes(channel)) {
      if (selectedChannels.length === 1) {
        setErrorMsg('At least one delivery channel is required.');
        return;
      }
      setSelectedChannels(selectedChannels.filter((c) => c !== channel));
    } else {
      setSelectedChannels([...selectedChannels, channel]);
    }
  };

  // Compile final filter_rules to send to backend
  const buildFinalRules = (): WorkflowRule[] => {
    if (ruleMode === 'UNCONDITIONAL') {
      return [];
    }

    if (currentTrigger.ruleArchetype === 'TIME_OFFSET') {
      const isDueTrigger = ['MODULE_DUE_REMINDER', 'TASK_DUE_REMINDER'].includes(currentTrigger.key);
      const field = isDueTrigger ? 'curriculum.days_left' : 'days_pending';
      const days = timeOffsetUnit === 'HOURS' ? Math.max(1, Math.round(timeOffsetValue / 24)) : timeOffsetValue;
      return [{ field, operator: '<=', value: days }];
    }

    if (currentTrigger.ruleArchetype === 'THRESHOLD') {
      let field = 'assessment.score';
      if (currentTrigger.key === 'DAILY_STREAK_CHECK' || currentTrigger.key === 'STREAK_MILESTONE') {
        field = 'gamification.streak_days';
      } else if (currentTrigger.key === 'LEADERBOARD_ALERT') {
        field = 'gamification.leaderboard_rank';
      } else if (currentTrigger.key === 'SCHEDULED_SCAN') {
        field = 'inactivity_days';
      }
      return [{ field, operator: thresholdOperator, value: thresholdValue }];
    }

    return rules.length > 0 ? rules : [];
  };

  // Step Validation
  const validateStep = (step: number): boolean => {
    setErrorMsg(null);
    if (step === 1) {
      if (!workflowTitle.trim()) {
        setErrorMsg('Workflow Name is required. Please provide a clear title.');
        titleInputRef.current?.focus();
        return false;
      }
      if (!selectedTriggerKey) {
        setErrorMsg('Please select a predefined system trigger event.');
        return false;
      }
    } else if (step === 2) {
      if (!selectedTemplateId) {
        setErrorMsg('Please select a primary message template.');
        return false;
      }
      if (ruleMode === 'DUAL_BRANCH' && !secondaryTemplateId) {
        setErrorMsg('Dual-Branch mode requires selecting a secondary template (IF FALSE branch).');
        return false;
      }
    } else if (step === 3) {
      if (ruleMode !== 'UNCONDITIONAL' && currentTrigger.ruleArchetype === 'THRESHOLD') {
        if (!String(thresholdValue).trim()) {
          setErrorMsg('Please specify a threshold value.');
          return false;
        }
      }
    } else if (step === 4) {
      if (selectedChannels.length === 0) {
        setErrorMsg('Please select at least one delivery channel (Mobile Push or In-App Bell).');
        return false;
      }
    }
    return true;
  };

  const handleNextStep = () => {
    if (validateStep(currentStep)) {
      setErrorMsg(null);
      setCurrentStep((prev) => Math.min(4, prev + 1));
    }
  };

  const handleStepJump = (targetStep: number) => {
    if (targetStep < currentStep) {
      setErrorMsg(null);
      setCurrentStep(targetStep);
      return;
    }
    for (let s = currentStep; s < targetStep; s++) {
      if (!validateStep(s)) return;
    }
    setErrorMsg(null);
    setCurrentStep(targetStep);
  };

  // Run Real-Time Test Simulation against Authenticated Portal User
  const handleRunTest = async () => {
    if (!primaryTemplate) {
      setTestError('Please select at least one message template before testing.');
      return;
    }

    setTesting(true);
    setTestError(null);
    setTestResult(null);

    const finalRules = buildFinalRules();
    const payload = {
      trigger_lifecycle: selectedTriggerKey,
      rule_mode: ruleMode,
      filter_rules: finalRules,
      filter_match_type: 'ALL',
      recipient_routing: recipientRouting,
      audience_filter: audienceFilter,
      title_template: primaryTemplate.title_template,
      body_template: primaryTemplate.body_template,
      secondary_title_template: secondaryTemplate?.title_template || primaryTemplate.title_template,
      secondary_body_template: secondaryTemplate?.body_template || primaryTemplate.body_template,
      sample_payload: {
        score: 68,
        passing_score: 70,
        weak_topic: 'Prompt Engineering',
        module_name: 'Sprint 2: Async Workflows',
        streak_days: 5,
        department: 'Enterprise Sales',
        role: 'employee',
      },
    };

    try {
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/workflows/simulate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Test evaluation failed');
      }

      const result = await res.json();
      setTestResult(result);
    } catch (err: any) {
      setTestError(err.message || 'Simulation encountered an error');
    } finally {
      setTesting(false);
    }
  };

  // Preview Audience Count & Sample
  const handlePreviewAudience = async () => {
    const wfId = initialWorkflow?.id;
    if (!wfId) return;
    try {
      setPreviewingAudience(true);
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/workflows/${wfId}/preview-audience`);
      if (res.ok) {
        const data = await res.json();
        const count = data.total_recipients ?? data.recipient_count ?? data.count ?? (data.sample_recipients?.length || 0);
        setAudiencePreviewData({
          count: count,
          sample: data.sample_recipients || [],
        });
      }
    } catch (err) {
      console.error('Failed to preview audience:', err);
    } finally {
      setPreviewingAudience(false);
    }
  };

  // One-Click Instant Broadcast
  const handlePreviewAndBroadcast = async () => {
    setBroadcasting(true);
    setBroadcastStatus(null);
    let wfId = initialWorkflow?.id;
    try {
      if (!wfId) {
        if (!validateStep(1) || !validateStep(2) || !validateStep(3) || !validateStep(4)) {
          setBroadcasting(false);
          return;
        }
        const finalRules = buildFinalRules();
        const payload: WorkflowFormData = {
          title: workflowTitle.trim(),
          category: workflowCategory,
          trigger_lifecycle: selectedTriggerKey,
          notification_type: `WF_${selectedTriggerKey}`,
          template_id: selectedTemplateId,
          pinned_template_id: selectedTemplateId,
          title_template: primaryTemplate?.title_template || workflowTitle.trim(),
          body_template: primaryTemplate?.body_template || 'Please check your portal for complete details.',
          secondary_template_id: ruleMode === 'DUAL_BRANCH' ? secondaryTemplateId : undefined,
          secondary_title_template: secondaryTemplate?.title_template,
          secondary_body_template: secondaryTemplate?.body_template,
          rule_mode: ruleMode,
          filter_rules: finalRules,
          filter_match_type: 'ALL',
          channels: selectedChannels,
          cooldown_seconds: cooldownHours * 3600,
          priority: 'NORMAL',
          is_active: true,
          recipient_routing: recipientRouting,
          audience_filter: audienceFilter,
          schedule_type: scheduleType,
          schedule_config: scheduleType === 'RECURRING' ? scheduleConfig : undefined,
        };
        const res = await fetchWithAuth(`${API_BASE}/api/notifications/workflows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(formatApiError(err.detail, 'Failed to save workflow before broadcasting'));
        }
        const created = await res.json();
        wfId = created.workflow?.id;
      }

      if (!wfId) throw new Error('Workflow ID is missing.');

      const broadcastRes = await fetchWithAuth(`${API_BASE}/api/notifications/workflows/${wfId}/broadcast`, {
        method: 'POST',
      });
      if (!broadcastRes.ok) {
        const err = await broadcastRes.json().catch(() => ({}));
        throw new Error(formatApiError(err.detail, 'Broadcast dispatch failed.'));
      }
      const bData = await broadcastRes.json();
      const count = bData.dispatched_count ?? bData.recipients_matched ?? bData.count ?? 0;
      setBroadcastStatus({
        success: true,
        message: bData.message || `Successfully broadcasted to ${count} matching learners via In-App Bell & Mobile Push!`,
      });
      onSaved();
    } catch (err: any) {
      setBroadcastStatus({
        success: false,
        message: err.message || 'An error occurred during broadcast.',
      });
    } finally {
      setBroadcasting(false);
    }
  };

  // Save / Submit Workflow
  const handleSaveWorkflow = async () => {
    if (!validateStep(1) || !validateStep(2) || !validateStep(3) || !validateStep(4)) {
      return;
    }

    setSaving(true);
    setErrorMsg(null);

    const finalRules = buildFinalRules();
    const payload: WorkflowFormData = {
      title: workflowTitle.trim(),
      category: workflowCategory,
      trigger_lifecycle: selectedTriggerKey,
      notification_type: `WF_${selectedTriggerKey}`,
      template_id: selectedTemplateId,
      pinned_template_id: selectedTemplateId,
      title_template: primaryTemplate?.title_template || workflowTitle.trim(),
      body_template: primaryTemplate?.body_template || 'Please check your portal for complete details.',
      secondary_template_id: ruleMode === 'DUAL_BRANCH' ? secondaryTemplateId : undefined,
      secondary_title_template: secondaryTemplate?.title_template,
      secondary_body_template: secondaryTemplate?.body_template,
      rule_mode: ruleMode,
      filter_rules: finalRules,
      filter_match_type: 'ALL',
      channels: selectedChannels,
      cooldown_seconds: cooldownHours * 3600,
      priority: 'NORMAL',
      is_active: initialWorkflow?.is_active ?? true,
      recipient_routing: recipientRouting,
      audience_filter: audienceFilter,
      schedule_type: scheduleType,
      schedule_config: scheduleType === 'RECURRING' ? scheduleConfig : undefined,
    };

    try {
      const url = initialWorkflow?.id
        ? `${API_BASE}/api/notifications/workflows/${initialWorkflow.id}`
        : `${API_BASE}/api/notifications/workflows`;
      const method = initialWorkflow?.id ? 'PUT' : 'POST';

      const res = await fetchWithAuth(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(formatApiError(err.detail, 'Failed to save workflow definition'));
      }

      onSaved();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'An unexpected error occurred while saving.');
    } finally {
      setSaving(false);
    }
  };

  const stepsList = [
    { num: 1, label: 'Trigger Event', desc: 'Category & Hook' },
    { num: 2, label: 'Message Template', desc: 'In-App & Push Copy' },
    { num: 3, label: 'Rules & Audience', desc: 'Archetype & Scoping' },
    { num: 4, label: 'Channels & Test', desc: 'Push & Bell Delivery' },
  ];

  const activeTemplateForBranch =
    activeBranchTab === 'SECONDARY' && secondaryTemplate
      ? secondaryTemplate
      : primaryTemplate;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-150">
      <div className="relative w-full max-w-5xl h-[92vh] bg-white rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
        {/* ─── HEADER BAR ────────────────────────────────────────────────────── */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center shrink-0">
              <Zap size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-slate-900">
                  {initialWorkflow?.id ? 'Edit Notification Workflow' : 'Create Notification Workflow'}
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                  Mobile Push & In-App Studio
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Configure automated notification triggers, audience targeting, and multi-channel delivery.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-xl hover:bg-slate-100 text-slate-400 hover:text-slate-600 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X size={18} />
          </button>
        </div>

        {/* ─── STEP PROGRESS BREADCRUMBS ─────────────────────────────────────── */}
        <div className="px-6 py-3 bg-slate-50/80 border-b border-slate-100 shrink-0">
          <div className="grid grid-cols-4 gap-2">
            {stepsList.map((s) => {
              const isActive = currentStep === s.num;
              const isPassed = currentStep > s.num;
              return (
                <button
                  key={s.num}
                  type="button"
                  onClick={() => handleStepJump(s.num)}
                  className={`flex items-center gap-2.5 p-2 rounded-xl text-left transition-all cursor-pointer ${
                    isActive
                      ? 'bg-white shadow-2xs border border-indigo-200'
                      : isPassed
                      ? 'hover:bg-slate-100/70 opacity-90'
                      : 'opacity-40 hover:opacity-60'
                  }`}
                >
                  <div
                    className={`w-6 h-6 rounded-lg flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
                      isPassed
                        ? 'bg-emerald-500 text-white'
                        : isActive
                        ? 'bg-indigo-600 text-white'
                        : 'bg-slate-200 text-slate-600'
                    }`}
                  >
                    {isPassed ? <Check size={13} /> : s.num}
                  </div>
                  <div className="min-w-0">
                    <div
                      className={`text-xs font-bold truncate ${
                        isActive ? 'text-indigo-900' : 'text-slate-700'
                      }`}
                    >
                      {s.label}
                    </div>
                    <div className="text-[10px] text-slate-400 truncate">{s.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ─── ERROR BANNER ─────────────────────────────────────────────────── */}
        {errorMsg && (
          <div className="mx-6 mt-3 p-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center justify-between shrink-0 animate-in fade-in">
            <div className="flex items-center gap-2">
              <AlertCircle size={15} className="shrink-0 text-rose-500" />
              <span>{errorMsg}</span>
            </div>
            <button
              type="button"
              onClick={() => setErrorMsg(null)}
              className="text-rose-400 hover:text-rose-700 font-bold"
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* ─── SCROLLABLE STEP BODY ─────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto p-6 min-h-0">
          {/* ═════════════════════════════════════════════════════════════
              STEP 1: SELECT EVENT TRIGGER & NAME
             ═════════════════════════════════════════════════════════════ */}
          {currentStep === 1 && (
            <div className="space-y-6 animate-in fade-in duration-100">
              {/* Title & Category Input */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="sm:col-span-2">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5 mb-1.5">
                    <span>Workflow Name</span>
                    <span className="text-rose-500">*</span>
                    <InfoTooltip content="A concise, descriptive name for admins to identify this automation." />
                  </label>
                  <input
                    ref={titleInputRef}
                    type="text"
                    value={workflowTitle}
                    onChange={(e) => setWorkflowTitle(e.target.value)}
                    placeholder="e.g. Daily Streak Rescue Reminder"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-all bg-white"
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5 mb-1.5">
                    <span>Domain / Category</span>
                    <InfoTooltip content="Categorizes the workflow into one of the 10 core product domains." />
                  </label>
                  <select
                    value={workflowCategory}
                    onChange={(e) => {
                      setWorkflowCategory(e.target.value);
                      const firstTrigger = PREDEFINED_SYSTEM_TRIGGERS.find(
                        (t) => t.category === e.target.value
                      );
                      if (firstTrigger) setSelectedTriggerKey(firstTrigger.key);
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                  >
                    {PREDEFINED_CATEGORIES.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Predefined Triggers Grid */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                    <span>Select Trigger Event</span>
                    <span className="text-rose-500">*</span>
                    <InfoTooltip content="Choose which system event initiates this notification workflow." />
                  </label>
                  <span className="text-[11px] text-slate-400">
                    Showing triggers for <strong>{PREDEFINED_CATEGORIES.find(c => c.id === workflowCategory)?.label || workflowCategory}</strong>
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {PREDEFINED_SYSTEM_TRIGGERS.filter(
                    (t) => t.category === workflowCategory
                  ).map((trigger) => {
                    const isSelected = selectedTriggerKey === trigger.key;
                    const Icon = trigger.icon;

                    return (
                      <div
                        key={trigger.key}
                        onClick={() => {
                          setSelectedTriggerKey(trigger.key);
                          if (errorMsg) setErrorMsg(null);
                        }}
                        className={`p-4 rounded-2xl border transition-all cursor-pointer relative flex flex-col justify-between ${
                          isSelected
                            ? 'bg-indigo-50/70 border-indigo-500 shadow-2xs ring-2 ring-indigo-500/15'
                            : 'bg-white border-slate-200/90 hover:border-slate-300 hover:shadow-2xs'
                        }`}
                      >
                        <div>
                          <div className="flex items-center justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2">
                              <div
                                className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                                  isSelected
                                    ? 'bg-indigo-600 text-white'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                <Icon size={16} />
                              </div>
                              <span className="text-xs font-bold text-slate-900">
                                {trigger.label}
                              </span>
                            </div>

                            {/* Archetype Badge */}
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                                trigger.ruleArchetype === 'ZERO_RULE'
                                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                  : trigger.ruleArchetype === 'TIME_OFFSET'
                                  ? 'bg-indigo-50 text-indigo-700 border-indigo-200'
                                  : 'bg-amber-50 text-amber-700 border-amber-200'
                              }`}
                            >
                              {trigger.ruleArchetype === 'ZERO_RULE'
                                ? '✨ Zero-Rule'
                                : trigger.ruleArchetype === 'TIME_OFFSET'
                                ? '⏱️ Time Offset'
                                : '🎯 Threshold'}
                            </span>
                          </div>

                          <p className="text-[11px] text-slate-500 leading-relaxed mb-3">
                            {trigger.description}
                          </p>
                        </div>

                        {/* Variables Pills */}
                        <div className="pt-2 border-t border-slate-100 flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-bold text-slate-400">Available:</span>
                          {trigger.variables.slice(0, 3).map((v) => (
                            <span
                              key={v}
                              className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-slate-100 text-slate-600 border border-slate-200/60"
                            >
                              {v.split('.').pop()}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Dispatch Trigger Mode & Recurring Schedule Selector */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/90 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <span>Dispatch Trigger Mode</span>
                      <InfoTooltip content="Choose whether this workflow triggers immediately on events/broadcasts or runs on a scheduled recurring timer." />
                    </label>
                    <p className="text-[11px] text-slate-500">
                      Determine how and when notification policies are evaluated.
                    </p>
                  </div>

                  <div className="inline-flex p-1 bg-white rounded-xl border border-slate-200 shrink-0">
                    <button
                      type="button"
                      onClick={() => setScheduleType('EVENT_DRIVEN')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                        scheduleType === 'EVENT_DRIVEN'
                          ? 'bg-indigo-600 text-white shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Zap size={13} />
                      <span>⚡ Real-time Event</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setScheduleType('RECURRING')}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                        scheduleType === 'RECURRING'
                          ? 'bg-indigo-600 text-white shadow-2xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Clock size={13} />
                      <span>⏰ Scheduled Recurring</span>
                    </button>
                  </div>
                </div>

                {scheduleType === 'RECURRING' && (
                  <div className="p-3.5 bg-white rounded-xl border border-indigo-100 shadow-2xs space-y-3 animate-in fade-in duration-150">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="text-[11px] font-bold text-slate-700 block mb-1">
                          Recurrence Frequency
                        </label>
                        <select
                          value={scheduleConfig.frequency}
                          onChange={(e) =>
                            setScheduleConfig((prev) => ({
                              ...prev,
                              frequency: e.target.value as any,
                            }))
                          }
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        >
                          <option value="DAILY">Every Day</option>
                          <option value="WEEKLY">Specific Days of Week</option>
                          <option value="EVERY_N_DAYS">Every N Days</option>
                        </select>
                      </div>

                      <div>
                        <label className="text-[11px] font-bold text-slate-700 block mb-1">
                          Dispatch Time (24h)
                        </label>
                        <input
                          type="time"
                          value={scheduleConfig.time}
                          onChange={(e) =>
                            setScheduleConfig((prev) => ({ ...prev, time: e.target.value }))
                          }
                          className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                        />
                      </div>

                      {scheduleConfig.frequency === 'EVERY_N_DAYS' && (
                        <div>
                          <label className="text-[11px] font-bold text-slate-700 block mb-1">
                            Interval (Days)
                          </label>
                          <input
                            type="number"
                            min={1}
                            max={30}
                            value={scheduleConfig.interval_days}
                            onChange={(e) =>
                              setScheduleConfig((prev) => ({
                                ...prev,
                                interval_days: Math.max(1, parseInt(e.target.value) || 1),
                              }))
                            }
                            className="w-full px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
                          />
                        </div>
                      )}
                    </div>

                    {scheduleConfig.frequency === 'WEEKLY' && (
                      <div>
                        <label className="text-[11px] font-bold text-slate-700 block mb-1.5">
                          Active Dispatch Days
                        </label>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'].map((day) => {
                            const isSelected = (scheduleConfig.days || []).includes(day);
                            return (
                              <button
                                key={day}
                                type="button"
                                onClick={() => {
                                  const currentDays = scheduleConfig.days || [];
                                  const nextDays = isSelected
                                    ? currentDays.filter((d) => d !== day)
                                    : [...currentDays, day];
                                  setScheduleConfig((prev) => ({ ...prev, days: nextDays }));
                                }}
                                className={`px-2.5 py-1 rounded-lg text-xs font-bold border transition-colors cursor-pointer ${
                                  isSelected
                                    ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                                    : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
                                }`}
                              >
                                {day}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <p className="text-[11px] text-indigo-700 font-medium">
                      ℹ️ Evaluated by ARQ background worker daily at the scheduled time across matching audience members.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════
              STEP 2: MESSAGE TEMPLATE SELECTION & LIVE PREVIEW
             ═════════════════════════════════════════════════════════════ */}
          {currentStep === 2 && (
            <div className="space-y-4 animate-in fade-in duration-100">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <span>Step 2: Assign Notification Template</span>
                    <InfoTooltip content="Select which pre-approved message copy will be rendered and sent when this workflow triggers." />
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Choose from published templates or preview how variables interpolate for learners.
                  </p>
                </div>

                {ruleMode === 'DUAL_BRANCH' && (
                  <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl">
                    <button
                      type="button"
                      onClick={() => setActiveBranchTab('PRIMARY')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        activeBranchTab === 'PRIMARY'
                          ? 'bg-white text-indigo-700 shadow-2xs border border-indigo-200'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Primary (IF TRUE)
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveBranchTab('SECONDARY')}
                      className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        activeBranchTab === 'SECONDARY'
                          ? 'bg-white text-amber-800 shadow-2xs border border-amber-200'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      Secondary (IF FALSE)
                    </button>
                  </div>
                )}
              </div>

              {/* Split Pane: Left Catalog, Right Live Preview */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                {/* ── LEFT PANE: TEMPLATE CATALOG ── */}
                <div className="lg:col-span-7 flex flex-col space-y-3">
                  <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                      <Search size={13} className="absolute left-3 top-2.5 text-slate-400" />
                      <input
                        type="text"
                        value={templateSearchQuery}
                        onChange={(e) => setTemplateSearchQuery(e.target.value)}
                        placeholder="Search templates by title or slug..."
                        className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                      />
                    </div>
                  </div>

                  {/* Template List */}
                  <div className="max-h-[380px] overflow-y-auto space-y-2 pr-1">
                    {filteredTemplates.length === 0 ? (
                      <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200 text-xs text-slate-500">
                        No templates found matching your search.
                      </div>
                    ) : (
                      filteredTemplates.map((t) => {
                        const isPrimarySelected = selectedTemplateId === t.id;
                        const isSecondarySelected = secondaryTemplateId === t.id;
                        const isCurrentlyActiveForBranch =
                          activeBranchTab === 'SECONDARY' && ruleMode === 'DUAL_BRANCH'
                            ? isSecondarySelected
                            : isPrimarySelected;

                        return (
                          <div
                            key={t.id}
                            onClick={() => {
                              if (activeBranchTab === 'SECONDARY' && ruleMode === 'DUAL_BRANCH') {
                                setSecondaryTemplateId(t.id);
                              } else {
                                setSelectedTemplateId(t.id);
                              }
                              if (errorMsg) setErrorMsg(null);
                            }}
                            className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer relative ${
                              isCurrentlyActiveForBranch
                                ? activeBranchTab === 'SECONDARY' && ruleMode === 'DUAL_BRANCH'
                                  ? 'bg-amber-50/90 border-amber-500 ring-2 ring-amber-500/15 shadow-2xs'
                                  : 'bg-indigo-50/90 border-indigo-500 ring-2 ring-indigo-500/15 shadow-2xs'
                                : 'bg-white border-slate-200/90 hover:border-slate-300 hover:shadow-2xs'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2 mb-1.5">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700">
                                  {t.category}
                                </span>
                                {isPrimarySelected && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700">
                                    Primary (IF True)
                                  </span>
                                )}
                                {isSecondarySelected && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                                    Secondary (IF False)
                                  </span>
                                )}
                              </div>

                              <div
                                className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                                  isCurrentlyActiveForBranch
                                    ? activeBranchTab === 'SECONDARY' && ruleMode === 'DUAL_BRANCH'
                                      ? 'border-amber-600 bg-amber-600 text-white'
                                      : 'border-indigo-600 bg-indigo-600 text-white'
                                    : 'border-slate-300 bg-white'
                                }`}
                              >
                                {isCurrentlyActiveForBranch && <Check size={10} />}
                              </div>
                            </div>

                            <div className="text-xs font-bold text-slate-900 truncate">
                              {t.template_name || t.notification_type}
                            </div>
                            <div className="text-[11px] font-semibold text-slate-700 line-clamp-1 mt-0.5">
                              {t.title_template}
                            </div>
                            <p className="text-[11px] text-slate-500 line-clamp-2 mt-0.5">
                              {t.body_template}
                            </p>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* ── RIGHT PANE: REAL-TIME LIVE NOTIFICATION PREVIEW ── */}
                <div className="lg:col-span-5 flex flex-col bg-white p-4 rounded-2xl border border-slate-200/90 shadow-2xs justify-between">
                  <div>
                    <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
                      <div className="flex items-center gap-1.5">
                        <Sparkles size={14} className="text-indigo-600" />
                        <span className="text-xs font-bold text-slate-800">Live Render Preview</span>
                      </div>

                      <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-lg">
                        <button
                          type="button"
                          onClick={() => setPreviewChannel('PUSH')}
                          className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                            previewChannel === 'PUSH'
                              ? 'bg-white text-slate-900 shadow-2xs'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          <Smartphone size={11} />
                          <span>Push</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setPreviewChannel('IN_APP')}
                          className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-bold transition-all cursor-pointer ${
                            previewChannel === 'IN_APP'
                              ? 'bg-white text-slate-900 shadow-2xs'
                              : 'text-slate-500 hover:text-slate-800'
                          }`}
                        >
                          <Bell size={11} />
                          <span>In-App</span>
                        </button>
                      </div>
                    </div>

                    {activeTemplateForBranch ? (
                      previewChannel === 'PUSH' ? (
                        <div className="bg-slate-900 text-white p-4 rounded-2xl border border-slate-800 shadow-sm space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <div className="w-4 h-4 rounded-md bg-indigo-600 flex items-center justify-center text-[9px] font-bold">
                                <Zap size={9} />
                              </div>
                              <span className="text-[10px] font-bold tracking-wider text-slate-300 uppercase">
                                Lucid
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-400">now</span>
                          </div>

                          <div>
                            <h5 className="text-xs font-bold text-slate-100">
                              {renderInterpolatedPreview(activeTemplateForBranch.title_template)}
                            </h5>
                            <p className="text-[11px] text-slate-300 leading-snug mt-1 line-clamp-3">
                              {renderInterpolatedPreview(activeTemplateForBranch.body_template)}
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="bg-white p-4 rounded-2xl border-2 border-indigo-200 shadow-xs space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <div className="p-1 rounded-lg bg-indigo-50 text-indigo-600">
                                <Bell size={12} />
                              </div>
                              <span className="text-[10px] font-bold text-indigo-900 bg-indigo-50 px-2 py-0.5 rounded-md">
                                {activeTemplateForBranch.category}
                              </span>
                            </div>
                            <span className="text-[10px] text-slate-400">Just now</span>
                          </div>

                          <div>
                            <h5 className="text-xs font-bold text-slate-900">
                              {renderInterpolatedPreview(activeTemplateForBranch.title_template)}
                            </h5>
                            <p className="text-[11px] text-slate-600 leading-snug mt-1 line-clamp-3">
                              {renderInterpolatedPreview(activeTemplateForBranch.body_template)}
                            </p>
                          </div>
                        </div>
                      )
                    ) : (
                      <div className="p-8 text-center text-xs text-slate-400">
                        Select a template on the left to see live preview.
                      </div>
                    )}
                  </div>

                  <div className="mt-4 p-2.5 rounded-xl bg-slate-50 border border-slate-100 text-[10px] text-slate-500">
                    Preview rendered for authenticated profile: <strong>{loggedInName}</strong>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════
              STEP 3: STREAMLINED RULES, TIMING & AUDIENCE SCOPING
             ═════════════════════════════════════════════════════════════ */}
          {currentStep === 3 && (
            <div className="space-y-5 animate-in fade-in duration-100">
              <div>
                <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <span>Step 3: Trigger Rules, Reminders & Audience Scoping</span>
                  <InfoTooltip content="Rules control under what conditions the notification is dispatched, along with relative timing and recipient routing." />
                </h4>
                <p className="text-[11px] text-slate-500">
                  Configure trigger rules tailored for <strong>{currentTrigger.label}</strong>.
                </p>
              </div>

              {/* ARCHETYPE A: ZERO-RULE (DIRECT LIFECYCLE EVENT) */}
              {currentTrigger.ruleArchetype === 'ZERO_RULE' && (
                <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200 flex items-start gap-3.5 shadow-2xs">
                  <div className="p-2.5 rounded-xl bg-emerald-600 text-white shrink-0">
                    <Zap size={16} />
                  </div>
                  <div>
                    <h5 className="text-xs font-bold text-emerald-950">
                      Direct Lifecycle Trigger (Zero Conditions Required)
                    </h5>
                    <p className="text-[11px] text-emerald-800 mt-0.5 leading-relaxed">
                      This workflow will fire immediately every time <strong>{currentTrigger.label}</strong> occurs in the platform. No complicated boolean conditions are required. You can optionally scope which departments or roles receive it below.
                    </p>
                  </div>
                </div>
              )}

              {/* ARCHETYPE B: TIME_OFFSET (DEADLINES & REMINDERS) */}
              {currentTrigger.ruleArchetype === 'TIME_OFFSET' && (
                <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-200 space-y-3 shadow-2xs">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-indigo-600 text-white">
                      <Clock size={15} />
                    </div>
                    <div>
                      <h5 className="text-xs font-bold text-indigo-950">
                        Relative Reminder Timing Configuration
                      </h5>
                      <p className="text-[11px] text-indigo-700">
                        Configure when the reminder nudge will be sent to the learner.
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 bg-white p-3.5 rounded-xl border border-indigo-200/80 shadow-2xs">
                    <span className="text-xs font-semibold text-slate-700">Notify exactly</span>
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={timeOffsetValue}
                      onChange={(e) => setTimeOffsetValue(Math.max(1, Number(e.target.value) || 1))}
                      className="w-20 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-center text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />
                    <select
                      value={timeOffsetUnit}
                      onChange={(e) => setTimeOffsetUnit(e.target.value as any)}
                      className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value="HOURS">Hours</option>
                      <option value="DAYS">Days</option>
                    </select>
                    <span className="text-xs font-semibold text-slate-700">
                      {['MODULE_DUE_REMINDER', 'TASK_DUE_REMINDER'].includes(currentTrigger.key)
                        ? 'Before Assigned Deadline'
                        : 'After Assignment (if not yet started)'}
                    </span>
                  </div>
                </div>
              )}

              {/* ARCHETYPE C: THRESHOLD (METRIC EVALUATION) */}
              {currentTrigger.ruleArchetype === 'THRESHOLD' && (
                <div className="p-4 rounded-2xl bg-amber-50/60 border border-amber-200 space-y-3 shadow-2xs">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-xl bg-amber-600 text-white">
                      <SlidersHorizontal size={15} />
                    </div>
                    <div>
                      <h5 className="text-xs font-bold text-amber-950">
                        Metric Threshold Evaluation Criteria
                      </h5>
                      <p className="text-[11px] text-amber-800">
                        Specify the target threshold that triggers this notification.
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 bg-white p-3.5 rounded-xl border border-amber-200/80 shadow-2xs">
                    <span className="text-xs font-semibold text-slate-700">
                      {currentTrigger.key === 'ASSESSMENT_COMPLETED' && 'Quiz Score:'}
                      {currentTrigger.key === 'DAILY_STREAK_CHECK' && 'Active Streak:'}
                      {currentTrigger.key === 'STREAK_MILESTONE' && 'Streak Days Reached:'}
                      {currentTrigger.key === 'LEADERBOARD_ALERT' && 'Rank Drop / Delta:'}
                      {currentTrigger.key === 'SCHEDULED_SCAN' && 'Inactivity Duration:'}
                      {currentTrigger.key === 'ROLEPLAY_RETAKE' && 'Fluency / Rubric Score:'}
                    </span>

                    <select
                      value={thresholdOperator}
                      onChange={(e) => setThresholdOperator(e.target.value)}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    >
                      <option value=">=">&ge; (Greater than or equal)</option>
                      <option value="<">&lt; (Less than)</option>
                      <option value="<=">&le; (Less than or equal)</option>
                      <option value=">">&gt; (Greater than)</option>
                      <option value="==">== (Exact match)</option>
                    </select>

                    <input
                      type="text"
                      value={thresholdValue}
                      onChange={(e) => setThresholdValue(e.target.value)}
                      placeholder="e.g. 70"
                      className="w-24 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-bold text-center text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    />

                    <span className="text-xs font-bold text-slate-500">
                      {['ASSESSMENT_COMPLETED', 'ROLEPLAY_RETAKE'].includes(currentTrigger.key)
                        ? '%'
                        : ['STREAK_MILESTONE', 'DAILY_STREAK_CHECK', 'SCHEDULED_SCAN'].includes(currentTrigger.key)
                        ? 'Days'
                        : 'Positions'}
                    </span>
                  </div>
                </div>
              )}

              {/* DUAL BRANCHING TOGGLE */}
              <div className="flex items-center justify-between p-3.5 rounded-2xl bg-slate-50 border border-slate-200/90 shadow-2xs">
                <div>
                  <span className="text-xs font-bold text-slate-800 block">
                    Enable Dual-Branching (Pass / Fail Secondary Template)
                  </span>
                  <p className="text-[11px] text-slate-500">
                    Optionally route to a secondary template if condition evaluates to False.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDualBranchEnabled(!dualBranchEnabled)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
                    dualBranchEnabled ? 'bg-indigo-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      dualBranchEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              {/* RECIPIENT ROUTING & ESCALATION POLICY */}
              <div className="space-y-2 pt-2">
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                  <UserCheck size={14} className="text-indigo-600" />
                  <span>Recipient Routing Policy</span>
                  <InfoTooltip content="Determines who receives the notification: the active learner, their direct reporting manager, or both." />
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  {[
                    {
                      id: 'LEARNER',
                      label: 'Learner Only',
                      desc: 'Direct notification to the active learner.',
                      icon: Users,
                    },
                    {
                      id: 'BOTH',
                      label: 'Learner + CC Manager',
                      desc: 'Notifies learner and carbon copies their manager.',
                      icon: UserCheck,
                    },
                    {
                      id: 'MANAGER',
                      label: 'Manager Only (Escalation)',
                      desc: 'Direct escalation to reporting manager only.',
                      icon: Shield,
                    },
                  ].map((route) => {
                    const isSelected = recipientRouting === route.id;
                    const Icon = route.icon;
                    return (
                      <button
                        key={route.id}
                        type="button"
                        onClick={() => setRecipientRouting(route.id as any)}
                        className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex flex-col justify-between ${
                          isSelected
                            ? 'bg-indigo-50/80 border-indigo-500 shadow-2xs ring-1 ring-indigo-500/20'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <div
                            className={`p-1 rounded-lg ${
                              isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            <Icon size={13} />
                          </div>
                          <span
                            className={`text-xs font-bold ${
                              isSelected ? 'text-indigo-900' : 'text-slate-800'
                            }`}
                          >
                            {route.label}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 leading-snug">{route.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* AUDIENCE SCOPING ACCORDION (OPTIONAL) */}
              {(() => {
                const activeDepts = audienceFilter?.departments || [];
                const activeRoles = audienceFilter?.roles || [];
                const totalAudienceFilters = activeDepts.length + activeRoles.length;

                return (
                  <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden shadow-2xs">
                    <button
                      type="button"
                      onClick={() => setIsAudienceExpanded(!isAudienceExpanded)}
                      className="w-full px-4 py-3 bg-slate-50/70 hover:bg-slate-100/70 flex items-center justify-between text-left transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <Building2 size={14} className="text-slate-600" />
                        <span className="text-xs font-bold text-slate-800">
                          Audience Scope & Department Filters (Optional)
                        </span>
                        {totalAudienceFilters > 0 && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-700">
                            {totalAudienceFilters} active filters
                          </span>
                        )}
                      </div>
                      {isAudienceExpanded ? (
                        <ChevronUp size={15} className="text-slate-400" />
                      ) : (
                        <ChevronDown size={15} className="text-slate-400" />
                      )}
                    </button>

                    {isAudienceExpanded && (
                      <div className="p-4 space-y-4 border-t border-slate-100 bg-white animate-in fade-in duration-100">
                        {/* Department Pills */}
                        <div>
                          <div className="text-[11px] font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                            <span>Target Specific Departments</span>
                            {activeDepts.length > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setAudienceFilter((prev) => ({
                                    ...(prev || {}),
                                    departments: [],
                                    roles: prev?.roles || [],
                                    module_ids: prev?.module_ids || [],
                                  }))
                                }
                                className="text-[10px] text-rose-600 hover:underline cursor-pointer"
                              >
                                Clear all
                              </button>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {[
                              'Sales',
                              'Customer Success',
                              'Engineering',
                              'Operations',
                              'Marketing',
                              'Product',
                              'HR',
                              'Finance',
                            ].map((dept) => {
                              const isDeptActive = activeDepts.includes(dept);
                              return (
                                <button
                                  key={dept}
                                  type="button"
                                  onClick={() => {
                                    setAudienceFilter((prev) => {
                                      const cur = prev?.departments || [];
                                      return {
                                        roles: prev?.roles || [],
                                        module_ids: prev?.module_ids || [],
                                        departments: isDeptActive
                                          ? cur.filter((d) => d !== dept)
                                          : [...cur, dept],
                                      };
                                    });
                                  }}
                                  className={`px-2.5 py-1 rounded-xl text-xs font-semibold transition-all cursor-pointer ${
                                    isDeptActive
                                      ? 'bg-indigo-600 text-white shadow-2xs'
                                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                  }`}
                                >
                                  {dept}
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {/* Account Role Pills */}
                        <div>
                          <div className="text-[11px] font-bold text-slate-700 mb-1.5 flex items-center justify-between">
                            <span>Target Specific Account Roles</span>
                            {activeRoles.length > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setAudienceFilter((prev) => ({
                                    ...(prev || {}),
                                    departments: prev?.departments || [],
                                    roles: [],
                                    module_ids: prev?.module_ids || [],
                                  }))
                                }
                                className="text-[10px] text-rose-600 hover:underline cursor-pointer"
                              >
                                Clear all
                              </button>
                            )}
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {['employee', 'manager', 'admin'].map((role) => {
                              const isRoleActive = activeRoles.includes(role);
                              return (
                                <button
                                  key={role}
                                  type="button"
                                  onClick={() => {
                                    setAudienceFilter((prev) => {
                                      const cur = prev?.roles || [];
                                      return {
                                        departments: prev?.departments || [],
                                        module_ids: prev?.module_ids || [],
                                        roles: isRoleActive
                                          ? cur.filter((r) => r !== role)
                                          : [...cur, role],
                                      };
                                    });
                                  }}
                                  className={`px-2.5 py-1 rounded-xl text-xs font-semibold capitalize transition-all cursor-pointer ${
                                    isRoleActive
                                      ? 'bg-blue-600 text-white shadow-2xs'
                                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                  }`}
                                >
                                  {role}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════
              STEP 4: DELIVERY CHANNELS & TEST SIMULATION
             ═════════════════════════════════════════════════════════════ */}
          {currentStep === 4 && (
            <div className="space-y-5 animate-in fade-in duration-100">
              <div>
                <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <span>Step 4: Select Delivery Channels & Live Simulation</span>
                  <InfoTooltip content="Transport channels deliver the notification. In this phase, notifications are strictly routed to Mobile Push and In-App Bell." />
                </h4>
                <p className="text-[11px] text-slate-500">
                  Select destination delivery channels and test live rendering before deploying.
                </p>
              </div>

              {/* Delivery Channels */}
              <div>
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5 mb-2">
                  <span>Delivery Channels</span>
                  <span className="text-rose-500">*</span>
                  <InfoTooltip content="Active channels: Mobile Push and In-App Bell. Email and WhatsApp will become available in subsequent phases." />
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {[
                    { id: 'IN_APP', label: 'In-App Bell', icon: Bell, color: 'text-indigo-600', available: true },
                    { id: 'PUSH', label: 'Mobile Push', icon: Smartphone, color: 'text-emerald-600', available: true },
                    { id: 'EMAIL', label: 'Email Digest', icon: Mail, color: 'text-blue-600', available: false },
                    { id: 'WHATSAPP', label: 'WhatsApp', icon: MessageSquare, color: 'text-green-600', available: false },
                  ].map((ch) => {
                    const isSelected = selectedChannels.includes(ch.id);
                    const Icon = ch.icon;
                    return (
                      <div
                        key={ch.id}
                        onClick={() => {
                          if (!ch.available) return;
                          handleToggleChannel(ch.id);
                          if (errorMsg) setErrorMsg(null);
                        }}
                        className={`p-3.5 rounded-2xl border transition-all flex items-center justify-between ${
                          !ch.available
                            ? 'bg-slate-50/70 border-slate-200/80 opacity-60 cursor-not-allowed select-none'
                            : isSelected
                            ? 'bg-indigo-50/60 border-indigo-400 shadow-2xs cursor-pointer'
                            : 'bg-white border-slate-200 hover:border-slate-300 cursor-pointer'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <Icon size={16} className={ch.color} />
                          <div>
                            <span className="text-xs font-bold text-slate-800 block">{ch.label}</span>
                            {!ch.available && (
                              <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                                Coming Soon
                              </span>
                            )}
                          </div>
                        </div>
                        <div
                          className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                            !ch.available
                              ? 'border-slate-200 bg-slate-100'
                              : isSelected
                              ? 'bg-indigo-600 border-indigo-600 text-white'
                              : 'border-slate-300 bg-white'
                          }`}
                        >
                          {isSelected && <Check size={10} />}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Fatigue Cooldown */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <span>Delivery Fatigue Cooldown</span>
                    <InfoTooltip content="Prevents repeat spam by enforcing a minimum quiet window between triggers for the same learner." />
                  </div>
                  <div className="text-[11px] text-slate-500">
                    Suppress repeat nudges if a learner was nudged recently.
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={72}
                    value={cooldownHours}
                    onChange={(e) => setCooldownHours(Number(e.target.value) || 1)}
                    className="w-16 px-2.5 py-1 rounded-xl border border-slate-200 text-xs text-center font-bold text-slate-800 bg-white"
                  />
                  <span className="text-xs text-slate-500 font-medium">hours</span>
                </div>
              </div>

              {/* LIVE SIMULATION RUNNER */}
              <div className="p-4 rounded-2xl bg-slate-900 text-white space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold flex items-center gap-1.5 text-amber-400">
                      <Sparkles size={14} />
                      <span>Live Simulation (Authenticated User Context)</span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Simulate rule evaluation and token rendering with your currently active account (
                      <strong>{loggedInName}</strong>).
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleRunTest}
                    disabled={testing}
                    className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {testing ? <RefreshCw size={13} className="animate-spin" /> : <Play size={13} />}
                    <span>{testing ? 'Evaluating...' : 'Run Live Test'}</span>
                  </button>
                </div>

                {testError && (
                  <div className="p-2.5 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs flex items-center gap-2">
                    <AlertCircle size={14} className="shrink-0 text-rose-400" />
                    <span>{testError}</span>
                  </div>
                )}

                {testResult && (
                  <div className="p-3 rounded-xl bg-slate-800 border border-slate-700 space-y-2 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-300">Simulation Verdict:</span>
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          testResult.rule_evaluation_passed
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        }`}
                      >
                        {testResult.rule_evaluation_passed ? 'CONDITION TRUE' : 'CONDITION FALSE'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-300">
                      <strong>Rendered Title:</strong> {testResult.rendered_title || '(Empty)'}
                    </div>
                    <div className="text-[11px] text-slate-400">
                      <strong>Rendered Body:</strong> {testResult.rendered_body || '(Empty)'}
                    </div>
                  </div>
                )}
              </div>

              {/* ONE-CLICK INSTANT BROADCAST */}
              <div className="p-4 rounded-2xl bg-indigo-50/70 border border-indigo-200/90 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-bold flex items-center gap-1.5 text-indigo-950">
                      <Send size={14} className="text-indigo-600" />
                      <span>One-Click Broadcast / Dispatch Now</span>
                    </div>
                    <p className="text-[11px] text-slate-600 mt-0.5">
                      Instantly blast this notification to all matching audience members via In-App Bell and Mobile Push.
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {initialWorkflow?.id && (
                      <button
                        type="button"
                        onClick={handlePreviewAudience}
                        disabled={previewingAudience}
                        className="px-3 py-1.5 rounded-xl bg-white border border-slate-200 hover:border-slate-300 text-slate-700 text-xs font-bold transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        {previewingAudience ? <RefreshCw size={12} className="animate-spin" /> : <Eye size={12} />}
                        <span>{previewingAudience ? 'Checking...' : 'Check Audience'}</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handlePreviewAndBroadcast}
                      disabled={broadcasting}
                      className="px-3.5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                    >
                      {broadcasting ? <RefreshCw size={13} className="animate-spin" /> : <Zap size={13} />}
                      <span>{broadcasting ? 'Broadcasting...' : '⚡ Broadcast to Audience'}</span>
                    </button>
                  </div>
                </div>

                {audiencePreviewData && (
                  <div className="p-3 bg-white rounded-xl border border-indigo-100 text-xs space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-700">Matching Recipient Audience:</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 text-indigo-700 border border-indigo-200">
                        {audiencePreviewData.count} Enrolled Users Match Scope
                      </span>
                    </div>
                    {audiencePreviewData.sample.length > 0 && (
                      <div className="space-y-1 pt-0.5">
                        <div className="flex items-center justify-between text-[11px] text-slate-500">
                          <span className="font-medium text-slate-500">
                            Sample Preview (first {Math.min(audiencePreviewData.sample.length, 6)} of {audiencePreviewData.count}):
                          </span>
                          {audiencePreviewData.count > 6 && (
                            <span className="text-[10px] font-semibold text-indigo-600">
                              +{audiencePreviewData.count - Math.min(audiencePreviewData.sample.length, 6)} more will receive this
                            </span>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {audiencePreviewData.sample.slice(0, 6).map((s: any, idx: number) => (
                            <span key={idx} className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200/60 font-mono text-[10px]">
                              {typeof s === 'string' ? s : `${s.name || s.email} (${s.department || 'General'})`}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {broadcastStatus && (
                  <div
                    className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                      broadcastStatus.success
                        ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                        : 'bg-rose-50 border border-rose-200 text-rose-800'
                    }`}
                  >
                    {broadcastStatus.success ? (
                      <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                    ) : (
                      <AlertCircle size={15} className="text-rose-600 shrink-0" />
                    )}
                    <span>{broadcastStatus.message}</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ─── FOOTER ACTIONS ────────────────────────────────────────────────── */}
        <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between bg-slate-50/50 shrink-0">
          <div>
            {currentStep > 1 && (
              <button
                type="button"
                onClick={() => setCurrentStep((prev) => Math.max(1, prev - 1))}
                className="px-4 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors flex items-center gap-1.5 cursor-pointer"
              >
                <ArrowLeft size={14} />
                <span>Back</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-xs font-bold text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
            >
              Cancel
            </button>

            {currentStep < 4 ? (
              <button
                type="button"
                onClick={handleNextStep}
                className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-all shadow-2xs flex items-center gap-1.5 cursor-pointer"
              >
                <span>Continue</span>
                <ArrowRight size={14} />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSaveWorkflow}
                disabled={saving}
                className="px-6 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                {saving ? <RefreshCw size={14} className="animate-spin" /> : <Check size={14} />}
                <span>{saving ? 'Publishing...' : 'Save & Activate Workflow'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
