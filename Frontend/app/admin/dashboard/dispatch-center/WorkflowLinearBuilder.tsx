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
  template_id?: string;
  secondary_template_id?: string;
  rule_mode: 'THRESHOLD' | 'DUAL_BRANCH' | 'UNCONDITIONAL';
  filter_rules: WorkflowRule[];
  filter_match_type: 'ALL' | 'ANY';
  channels: string[];
  cooldown_seconds: number;
  priority: string;
  is_active: boolean;
}

export const PREDEFINED_SYSTEM_TRIGGERS = [
  // ASSESSMENT
  {
    key: 'ASSESSMENT_COMPLETED',
    category: 'ASSESSMENT',
    label: 'Quiz & Assessment Completed',
    description: 'Fires instantly whenever any learner finishes an exam or quiz submission.',
    icon: GraduationCap,
    variables: ['assessment.score', 'assessment.passing_score', 'assessment.weak_topic', 'assessment.passed'],
  },
  {
    key: 'QUIZ_PASSED',
    category: 'ASSESSMENT',
    label: 'Quiz Passed Milestone',
    description: 'Fires when a learner completes an assessment scoring above the passing mark.',
    icon: CheckCircle2,
    variables: ['assessment.score', 'gamification.earned_xp', 'curriculum.module_name'],
  },
  {
    key: 'QUIZ_FAILED',
    category: 'ASSESSMENT',
    label: 'Quiz Retry & Remediation Needed',
    description: 'Fires when a score falls below the required threshold to trigger recovery practice.',
    icon: AlertCircle,
    variables: ['assessment.score', 'assessment.weak_topic', 'assessment.remediation_module'],
  },
  {
    key: 'ROLEPLAY_REPORT_READY',
    category: 'ASSESSMENT',
    label: 'AI Roleplay Evaluation Ready',
    description: 'Fires when an AI simulation or roleplay scenario finishes speech/audio grading.',
    icon: GraduationCap,
    variables: ['assessment.confidence_score', 'assessment.feedback_summary'],
  },

  // CURRICULUM
  {
    key: 'MODULE_ASSIGNED',
    category: 'CURRICULUM',
    label: 'New Sprint / Module Assigned',
    description: 'Fires when an administrator or algorithm enrolls a learner into a new module.',
    icon: BookOpen,
    variables: ['curriculum.module_name', 'curriculum.due_date', 'curriculum.action_url'],
  },
  {
    key: 'MODULE_PROGRESS_UPDATED',
    category: 'CURRICULUM',
    label: 'Curriculum Pacing & Progress',
    description: 'Fires as learners complete sub-sections and checkpoints.',
    icon: BookOpen,
    variables: ['curriculum.progress_percentage', 'curriculum.minutes_remaining'],
  },
  {
    key: 'MODULE_DUE_REMINDER',
    category: 'CURRICULUM',
    label: 'Module Due Reminder',
    description: 'Fires 48 hours or 24 hours prior to a sprint deadline.',
    icon: Clock,
    variables: ['curriculum.days_left', 'curriculum.due_date', 'curriculum.action_url'],
  },
  {
    key: 'MODULE_OVERDUE',
    category: 'CURRICULUM',
    label: 'Module Overdue Alert',
    description: 'Fires when a module target deadline passes without completion.',
    icon: AlertCircle,
    variables: ['curriculum.module_name', 'curriculum.days_left'],
  },

  // GAMIFICATION
  {
    key: 'DAILY_STREAK_CHECK',
    category: 'GAMIFICATION',
    label: 'Daily Streak Rescue Check',
    description: 'Fires in the evening if a learner has not completed their daily micro-drill.',
    icon: Flame,
    variables: ['gamification.streak_days', 'gamification.streak_expiring_hours'],
  },
  {
    key: 'STREAK_MILESTONE',
    category: 'GAMIFICATION',
    label: 'Streak Milestone Reached',
    description: 'Fires on hitting day 3, 7, 14, 30 continuous streak milestones.',
    icon: Flame,
    variables: ['gamification.streak_days', 'gamification.xp_points'],
  },
  {
    key: 'BADGE_UNLOCKED',
    category: 'GAMIFICATION',
    label: 'Achievement Badge Unlocked',
    description: 'Fires when unlocking milestone achievements and skill certifications.',
    icon: Award,
    variables: ['gamification.badge_name', 'gamification.earned_xp'],
  },
  {
    key: 'LEADERBOARD_ALERT',
    category: 'GAMIFICATION',
    label: 'Leaderboard Shift Alert',
    description: 'Fires when a rival overtakes the learner in the weekly division standings.',
    icon: Users,
    variables: ['gamification.leaderboard_rank', 'gamification.rival_name', 'gamification.points_to_next_rank'],
  },

  // TASKS
  {
    key: 'TASK_ASSIGNED',
    category: 'TASKS',
    label: 'Workplace Task Assigned',
    description: 'Fires when a manager assigns a real-world workplace action item.',
    icon: Layers,
    variables: ['task.task_title', 'task.due_date'],
  },
  {
    key: 'TASK_EVALUATED',
    category: 'TASKS',
    label: 'Task AI Evaluation Ready',
    description: 'Fires when an uploaded document or submission completes AI assessment.',
    icon: Layers,
    variables: ['task.task_title', 'task.feedback_summary'],
  },

  // ONBOARDING
  {
    key: 'USER_WELCOME',
    category: 'ONBOARDING',
    label: 'Learner Welcome & Activation',
    description: 'Fires upon initial account creation and invitation.',
    icon: Users,
    variables: ['subscriber.first_name', 'subscriber.company_name'],
  },
  {
    key: 'LEARNING_STYLE_DISCOVERED',
    category: 'ONBOARDING',
    label: 'VARK Modality Diagnosed',
    description: 'Fires once the learner completes their VARK learning intake quiz.',
    icon: Compass,
    variables: ['vark.primary_style', 'vark.recommended_cta_label'],
  },

  // ENGAGEMENT & SYSTEM
  {
    key: 'DAILY_NUDGE',
    category: 'ENGAGEMENT',
    label: 'Daily Micro-Learning Nudge',
    description: 'Fires morning personalized study prompt respecting quiet hours.',
    icon: Compass,
    variables: ['subscriber.first_name', 'curriculum.module_name'],
  },
  {
    key: 'GENERAL_ANNOUNCEMENT',
    category: 'SYSTEM',
    label: 'Company-Wide Announcement',
    description: 'Platform broadcast or curriculum release announcement.',
    icon: Bell,
    variables: ['subscriber.company_name'],
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
  const [workflowCategory, setWorkflowCategory] = useState(initialWorkflow?.category || 'ASSESSMENT');
  const [selectedTriggerKey, setSelectedTriggerKey] = useState(
    initialWorkflow?.trigger_lifecycle || 'ASSESSMENT_COMPLETED'
  );

  // Step 2: Templates
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    initialWorkflow?.pinned_template_id || initialWorkflow?.template_id || ''
  );
  const [secondaryTemplateId, setSecondaryTemplateId] = useState<string>(
    initialWorkflow?.secondary_template_id || ''
  );

  // Step 3: Rules
  const [ruleMode, setRuleMode] = useState<'THRESHOLD' | 'DUAL_BRANCH' | 'UNCONDITIONAL'>(
    initialWorkflow?.rule_mode || 'THRESHOLD'
  );
  const [rules, setRules] = useState<WorkflowRule[]>(
    initialWorkflow?.filter_rules && initialWorkflow.filter_rules.length > 0
      ? initialWorkflow.filter_rules.map((r: any) => ({
          field: r.field || r.variable || 'assessment.score',
          operator: r.operator || '<',
          value: r.value !== undefined ? String(r.value) : '70',
        }))
      : [{ field: 'assessment.score', operator: '<', value: '70' }]
  );

  // Step 4: Channels
  const [selectedChannels, setSelectedChannels] = useState<string[]>(
    initialWorkflow?.channels && initialWorkflow.channels.length > 0
      ? initialWorkflow.channels
      : ['IN_APP', 'PUSH']
  );
  const [cooldownHours, setCooldownHours] = useState<number>(
    Math.round((initialWorkflow?.cooldown_seconds || 3600) / 3600) || 1
  );

  // Live Test State
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<any | null>(null);
  const [testError, setTestError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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

          // If no template is selected yet, default to first matching category
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

  // Current Trigger definition
  const currentTrigger =
    PREDEFINED_SYSTEM_TRIGGERS.find((t) => t.key === selectedTriggerKey) ||
    PREDEFINED_SYSTEM_TRIGGERS[0];

  // Selected Primary & Secondary Template Objects
  const primaryTemplate = availableTemplates.find((t) => t.id === selectedTemplateId);
  const secondaryTemplate = availableTemplates.find((t) => t.id === secondaryTemplateId);

  // Step 2: Split-Pane Master-Detail State & Interpolators
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

  // Current active template being previewed/selected in Step 2
  const activeTemplateForBranch =
    ruleMode === 'DUAL_BRANCH' && activeBranchTab === 'SECONDARY'
      ? secondaryTemplate
      : primaryTemplate;

  // Logged in name for dynamic preview
  const loggedInName = employeeData?.name || user?.displayName || 'Learner';

  // Sample token values for dynamic live preview
  const sampleTokenMap: Record<string, string> = {
    first_name: loggedInName.split(' ')[0] || 'Alex',
    name: loggedInName || 'Alex Chen',
    user_name: loggedInName || 'Alex Chen',
    'subscriber.name': loggedInName || 'Alex Chen',
    'subscriber.role': 'Security Analyst',
    'subscriber.department': 'Cyber Defense',
    module_name: 'Cybersecurity Fundamentals',
    'curriculum.module_name': 'Cybersecurity Fundamentals',
    'curriculum.days_left': '2',
    time_remaining: '24 hours',
    progress: '85',
    'curriculum.progress_percentage': '85',
    score: '88',
    'assessment.score': '88',
    passing_score: '70',
    assessment_name: 'Threat Modeling Challenge',
    streak_days: '7',
    'gamification.streak_days': '7',
    'gamification.xp_points': '450',
    badge_name: 'Rapid Incident Responder',
    task_title: 'Analyze Firewall Logs',
    completed_count: '4',
  };

  const renderInterpolatedPreview = (text?: string): string => {
    if (!text) return '';
    return text.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, token) => {
      const cleanToken = token.trim();
      return sampleTokenMap[cleanToken] || sampleTokenMap[cleanToken.toLowerCase()] || `[${cleanToken}]`;
    });
  };

  // Extract all {{token}} from a template
  const extractTokens = (t?: NotificationTemplate): string[] => {
    if (!t) return [];
    const combined = `${t.title_template || ''} ${t.body_template || ''}`;
    const matches = combined.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g);
    const tokens = new Set<string>();
    for (const m of matches) {
      if (m[1]) tokens.add(m[1].trim());
    }
    return Array.from(tokens);
  };

  // Add / Remove Rule Row
  const handleAddRule = () => {
    setRules((prev) => [...prev, { field: currentTrigger.variables[0] || 'assessment.score', operator: '<', value: '70' }]);
  };

  const handleRemoveRule = (index: number) => {
    setRules((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpdateRule = (index: number, key: keyof WorkflowRule, val: any) => {
    setRules((prev) =>
      prev.map((r, i) => (i === index ? { ...r, [key]: val } : r))
    );
  };

  // Toggle Channel
  const handleToggleChannel = (ch: string) => {
    setSelectedChannels((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]
    );
  };

  // Step Validation Logic
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
      if (ruleMode !== 'UNCONDITIONAL') {
        for (let i = 0; i < rules.length; i++) {
          if (!rules[i].value || !String(rules[i].value).trim()) {
            setErrorMsg(`Condition #${i + 1} has an empty value. Please specify a threshold value.`);
            return false;
          }
        }
      }
    } else if (step === 4) {
      if (selectedChannels.length === 0) {
        setErrorMsg('Please select at least one delivery channel (e.g. In-App, Push, Email).');
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

    const payload = {
      trigger_lifecycle: selectedTriggerKey,
      rule_mode: ruleMode,
      filter_rules: ruleMode === 'UNCONDITIONAL' ? [] : rules,
      filter_match_type: 'ALL',
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

  // Save / Submit Workflow
  const handleSaveWorkflow = async () => {
    if (!validateStep(1) || !validateStep(2) || !validateStep(3) || !validateStep(4)) {
      return;
    }

    setSaving(true);
    setErrorMsg(null);

    const payload = {
      title: workflowTitle.trim(),
      description: `Automated trigger on ${currentTrigger.label}`,
      trigger_lifecycle: selectedTriggerKey,
      category: workflowCategory,
      pinned_template_id: selectedTemplateId,
      secondary_template_id: ruleMode === 'DUAL_BRANCH' ? secondaryTemplateId : null,
      title_template: primaryTemplate?.title_template || 'Notification Title',
      body_template: primaryTemplate?.body_template || 'Notification message copy',
      secondary_title_template: secondaryTemplate?.title_template || null,
      secondary_body_template: secondaryTemplate?.body_template || null,
      rule_mode: ruleMode,
      filter_rules: ruleMode === 'UNCONDITIONAL' ? [] : rules,
      filter_match_type: 'ALL',
      notification_type: `${selectedTriggerKey}_WF`,
      channels: selectedChannels,
      delivery_policy: 'PARALLEL',
      cooldown_seconds: cooldownHours * 3600,
      priority: 'NORMAL',
      is_active: true,
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
        throw new Error(err.detail?.message || err.detail || 'Failed to save workflow');
      }

      onSaved();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save workflow.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto">
      {/* ─── LOCKED STABLE MODAL BOX (FIXES DYNAMIC JUMPING SIZE) ───── */}
      <div className="bg-white rounded-3xl border border-slate-200 shadow-2xl w-full max-w-5xl h-[740px] max-h-[92vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* ─── MODAL TOP HEADER (SHRINK-0) ────────────────────────────── */}
        <div className="shrink-0 px-6 py-4 border-b border-slate-100 bg-slate-50/70 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
              <Zap size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                {initialWorkflow ? 'Edit Notification Workflow' : 'Create Notification Workflow'}
              </h3>
              <p className="text-[11px] text-slate-500">
                4-Step Linear Wizard • Predefined System Triggers & Real-User Test
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* ─── STEPPER BAR (SHRINK-0) ─────────────────────────────────── */}
        <div className="shrink-0 px-6 py-3 border-b border-slate-100 bg-white grid grid-cols-4 gap-2">
          {[
            { num: 1, title: 'Trigger Event' },
            { num: 2, title: 'Pick Templates' },
            { num: 3, title: 'Define Rules' },
            { num: 4, title: 'Channels & Test' },
          ].map((s) => {
            const isActive = currentStep === s.num;
            const isCompleted = currentStep > s.num;
            return (
              <button
                key={s.num}
                type="button"
                onClick={() => handleStepJump(s.num)}
                className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold text-left transition-all cursor-pointer ${
                  isActive
                    ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 shadow-2xs'
                    : isCompleted
                    ? 'text-slate-700 hover:bg-slate-50'
                    : 'text-slate-400 hover:bg-slate-50'
                }`}
              >
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                    isActive
                      ? 'bg-indigo-600 text-white'
                      : isCompleted
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-slate-100 text-slate-400'
                  }`}
                >
                  {isCompleted ? <Check size={11} /> : s.num}
                </span>
                <span className="truncate">{s.title}</span>
              </button>
            );
          })}
        </div>

        {/* ─── MODAL BODY: STEP CONTENT (FLEX-1 WITH STABLE SCROLL) ───── */}
        <div className={`flex-1 min-h-0 ${currentStep === 2 ? 'p-5 flex flex-col overflow-hidden' : 'overflow-y-auto p-6 space-y-6 custom-scrollbar'}`}>
          {errorMsg && (
            <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2 animate-in fade-in duration-100">
              <AlertCircle size={15} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════
              STEP 1: WORKFLOW DETAILS & TRIGGER EVENT
             ═════════════════════════════════════════════════════════════ */}
          {currentStep === 1 && (
            <div className="space-y-5 animate-in fade-in duration-100">
              {/* Workflow Name */}
              <div>
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5 mb-1.5">
                  <span>Workflow Name</span>
                  <span className="text-rose-500">*</span>
                  <InfoTooltip content="Descriptive identifier for this automation pipeline. Appears in audit logs and management reports." />
                </label>
                <input
                  ref={titleInputRef}
                  type="text"
                  value={workflowTitle}
                  onChange={(e) => {
                    setWorkflowTitle(e.target.value);
                    if (errorMsg) setErrorMsg(null);
                  }}
                  placeholder="e.g. Adaptive Quiz Weak-Spot Remediation"
                  className="w-full px-4 py-2.5 rounded-xl border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-all font-medium"
                />
              </div>

              {/* Event Domain Selection */}
              <div>
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5 mb-1.5">
                  <span>Select Event Domain / Category</span>
                  <InfoTooltip content="The functional domain of the learning platform that emits this trigger." />
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {PREDEFINED_CATEGORIES.map((cat) => {
                    const isSelected = workflowCategory === cat.id;
                    const Icon = cat.icon;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => {
                          setWorkflowCategory(cat.id);
                          const firstInCat = PREDEFINED_SYSTEM_TRIGGERS.find((t) => t.category === cat.id);
                          if (firstInCat) setSelectedTriggerKey(firstInCat.key);
                        }}
                        className={`p-3 rounded-2xl border text-left transition-all flex flex-col justify-between cursor-pointer ${
                          isSelected
                            ? 'bg-indigo-50 border-indigo-400 shadow-2xs'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className={`p-1.5 rounded-lg w-fit mb-2 ${isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'}`}>
                          <Icon size={14} />
                        </div>
                        <div className={`text-xs font-bold ${isSelected ? 'text-indigo-900' : 'text-slate-800'}`}>
                          {cat.label}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Predefined Trigger Dropdown */}
              <div>
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5 mb-1.5">
                  <span>Select Predefined System Trigger Event</span>
                  <span className="text-rose-500">*</span>
                  <InfoTooltip content="Standard system contract event that activates this workflow when fired by backend or frontend." />
                </label>
                <div className="space-y-2">
                  {PREDEFINED_SYSTEM_TRIGGERS.filter((t) => t.category === workflowCategory).map((trig) => {
                    const isSelected = selectedTriggerKey === trig.key;
                    const Icon = trig.icon;
                    return (
                      <div
                        key={trig.key}
                        onClick={() => setSelectedTriggerKey(trig.key)}
                        className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-start justify-between gap-3 ${
                          isSelected
                            ? 'bg-amber-50/70 border-amber-400 shadow-2xs'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div
                            className={`p-2 rounded-xl shrink-0 mt-0.5 ${
                              isSelected ? 'bg-amber-500 text-white' : 'bg-slate-100 text-slate-600'
                            }`}
                          >
                            <Icon size={15} />
                          </div>
                          <div>
                            <div className="text-xs font-bold text-slate-900 flex items-center gap-2">
                              <span>{trig.label}</span>
                              <span className="font-mono text-[10px] text-slate-400 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                                {trig.key}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 mt-0.5">
                              {trig.description}
                            </p>
                            {/* Available variables chip */}
                            <div className="flex flex-wrap gap-1 mt-2">
                              {trig.variables.map((v) => (
                                <span
                                  key={v}
                                  className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-slate-100 text-slate-600"
                                >
                                  {`{{${v}}}`}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="shrink-0 mt-1">
                          <div
                            className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                              isSelected ? 'border-amber-600 bg-amber-600 text-white' : 'border-slate-300 bg-white'
                            }`}
                          >
                            {isSelected && <Check size={10} />}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════
              STEP 2: SELECT TEMPLATES (SINGLE OR DUAL BRANCH)
             ═════════════════════════════════════════════════════════════ */}
          {currentStep === 2 && (
            <div className="flex-1 min-h-0 flex flex-col space-y-3.5 animate-in fade-in duration-100">
              {/* Top Control Bar: Step Title + Info + Single/Dual-Branch Switch */}
              <div className="shrink-0 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div>
                  <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <span>Step 2: Choose Message Template(s)</span>
                    <InfoTooltip content="Bind approved copy created in the Templates Catalog to this event trigger. Copy is channel-agnostic and interpolated with live event variables." />
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Select approved notification copy. In Dual Branch mode, pick distinct copy for TRUE and FALSE outcomes.
                  </p>
                </div>

                {/* Dual-Branch Switch */}
                <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl shrink-0 self-start sm:self-auto">
                  <button
                    type="button"
                    onClick={() => {
                      setRuleMode('THRESHOLD');
                      setActiveBranchTab('PRIMARY');
                      if (errorMsg) setErrorMsg(null);
                    }}
                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      ruleMode !== 'DUAL_BRANCH'
                        ? 'bg-white text-slate-900 shadow-2xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Single Template
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRuleMode('DUAL_BRANCH');
                      if (errorMsg) setErrorMsg(null);
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                      ruleMode === 'DUAL_BRANCH'
                        ? 'bg-indigo-600 text-white shadow-2xs font-bold'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <GitBranch size={12} />
                    <span>Dual Branch (IF/ELSE)</span>
                  </button>
                </div>
              </div>

              {/* Dual-Branch Branch Navigator (When DUAL_BRANCH is active) */}
              {ruleMode === 'DUAL_BRANCH' && (
                <div className="shrink-0 grid grid-cols-2 gap-2.5 p-1.5 bg-slate-100/80 rounded-2xl border border-slate-200/80">
                  <button
                    type="button"
                    onClick={() => setActiveBranchTab('PRIMARY')}
                    className={`p-2 rounded-xl text-left transition-all cursor-pointer flex items-center justify-between ${
                      activeBranchTab === 'PRIMARY'
                        ? 'bg-white text-indigo-900 shadow-xs border border-indigo-200 ring-2 ring-indigo-500/10'
                        : 'text-slate-600 hover:bg-white/60'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${activeBranchTab === 'PRIMARY' ? 'bg-indigo-600' : 'bg-slate-400'}`} />
                      <div className="truncate">
                        <div className="text-[11px] font-bold">1. Primary Branch (IF TRUE) *</div>
                        <div className="text-[10px] text-slate-500 truncate">
                          {primaryTemplate ? (primaryTemplate.template_name || primaryTemplate.notification_type) : 'Select template below...'}
                        </div>
                      </div>
                    </div>
                    {primaryTemplate && (
                      <span className="p-1 rounded-full bg-emerald-100 text-emerald-700 shrink-0 ml-1">
                        <Check size={11} />
                      </span>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveBranchTab('SECONDARY')}
                    className={`p-2 rounded-xl text-left transition-all cursor-pointer flex items-center justify-between ${
                      activeBranchTab === 'SECONDARY'
                        ? 'bg-white text-amber-900 shadow-xs border border-amber-200 ring-2 ring-amber-500/10'
                        : 'text-slate-600 hover:bg-white/60'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${activeBranchTab === 'SECONDARY' ? 'bg-amber-600' : 'bg-slate-400'}`} />
                      <div className="truncate">
                        <div className="text-[11px] font-bold">2. Secondary Branch (IF FALSE) *</div>
                        <div className="text-[10px] text-slate-500 truncate">
                          {secondaryTemplate ? (secondaryTemplate.template_name || secondaryTemplate.notification_type) : 'Select template below...'}
                        </div>
                      </div>
                    </div>
                    {secondaryTemplate && (
                      <span className="p-1 rounded-full bg-emerald-100 text-emerald-700 shrink-0 ml-1">
                        <Check size={11} />
                      </span>
                    )}
                  </button>
                </div>
              )}

              {/* ─── SPLIT-PANE CONTAINER (7 COLS LEFT + 5 COLS RIGHT) ─── */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-3.5 flex-1 min-h-0">
                {/* ── LEFT PANE: SEARCH, CATEGORIES & TEMPLATE CARDS ── */}
                <div className="lg:col-span-7 flex flex-col min-h-0 bg-slate-50/70 p-3.5 rounded-2xl border border-slate-200/90">
                  {/* Search Bar */}
                  <div className="relative shrink-0 mb-2.5">
                    <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                    <input
                      type="text"
                      value={templateSearchQuery}
                      onChange={(e) => setTemplateSearchQuery(e.target.value)}
                      placeholder="Search templates by title, body, or keywords..."
                      className="w-full pl-10 pr-9 py-2 bg-white rounded-xl border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-all font-medium"
                    />
                    {templateSearchQuery && (
                      <button
                        type="button"
                        onClick={() => setTemplateSearchQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded-full cursor-pointer transition-colors"
                        title="Clear search"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>

                  {/* Category Filter Chips */}
                  <div className="shrink-0 flex items-center gap-1.5 overflow-x-auto pb-1.5 mb-2.5 scrollbar-none">
                    <button
                      type="button"
                      onClick={() => setTemplateCategoryFilter('ALL')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-all cursor-pointer ${
                        templateCategoryFilter === 'ALL'
                          ? 'bg-slate-900 text-white shadow-2xs'
                          : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      All ({availableTemplates.length})
                    </button>
                    {PREDEFINED_CATEGORIES.map((cat) => {
                      const count = availableTemplates.filter((t) => t.category === cat.id).length;
                      const isSel = templateCategoryFilter === cat.id;
                      return (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setTemplateCategoryFilter(cat.id)}
                          className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-all cursor-pointer ${
                            isSel
                              ? 'bg-indigo-600 text-white shadow-2xs'
                              : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          {cat.label} ({count})
                        </button>
                      );
                    })}
                  </div>

                  {/* Active selection banner for Dual Branch */}
                  {ruleMode === 'DUAL_BRANCH' && (
                    <div className="shrink-0 mb-2 px-2.5 py-1 rounded-lg bg-white border border-slate-200/90 flex items-center justify-between text-[11px]">
                      <span className="font-bold text-slate-700">
                        Assigning template to:{' '}
                        <span className={activeBranchTab === 'PRIMARY' ? 'text-indigo-600' : 'text-amber-600'}>
                          {activeBranchTab === 'PRIMARY' ? 'IF TRUE Branch' : 'IF FALSE Branch'}
                        </span>
                      </span>
                      <span className="text-slate-400 text-[10px]">Click any card below to select</span>
                    </div>
                  )}

                  {/* Scrollable Templates List (Fills remaining height) */}
                  <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
                    {templatesLoading ? (
                      <div className="p-8 text-center text-xs text-slate-400">Loading approved templates...</div>
                    ) : filteredTemplates.length === 0 ? (
                      <div className="p-8 text-center bg-white rounded-2xl border border-dashed border-slate-200">
                        <p className="text-xs font-semibold text-slate-600">No matching templates found</p>
                        <p className="text-[11px] text-slate-400 mt-1">Try another search keyword or category filter.</p>
                      </div>
                    ) : (
                      filteredTemplates.map((t) => {
                        const isPrimarySelected = selectedTemplateId === t.id;
                        const isSecondarySelected = secondaryTemplateId === t.id;
                        const isCurrentlyActiveForBranch =
                          ruleMode === 'DUAL_BRANCH'
                            ? (activeBranchTab === 'PRIMARY' && isPrimarySelected) ||
                              (activeBranchTab === 'SECONDARY' && isSecondarySelected)
                            : isPrimarySelected;

                        return (
                          <div
                            key={t.id}
                            onClick={() => {
                              if (ruleMode === 'DUAL_BRANCH') {
                                if (activeBranchTab === 'PRIMARY') {
                                  setSelectedTemplateId(t.id);
                                } else {
                                  setSecondaryTemplateId(t.id);
                                }
                              } else {
                                setSelectedTemplateId(t.id);
                              }
                              if (errorMsg) setErrorMsg(null);
                            }}
                            className={`p-3 rounded-2xl border text-left transition-all cursor-pointer relative ${
                              isCurrentlyActiveForBranch
                                ? activeBranchTab === 'SECONDARY' && ruleMode === 'DUAL_BRANCH'
                                  ? 'bg-amber-50/90 border-amber-500 ring-2 ring-amber-500/15 shadow-2xs'
                                  : 'bg-indigo-50/90 border-indigo-500 ring-2 ring-indigo-500/15 shadow-2xs'
                                : 'bg-white border-slate-200/90 hover:border-slate-300 hover:shadow-2xs'
                            }`}
                          >
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 text-slate-700">
                                  {t.category}
                                </span>
                                <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-500">
                                  v{t.version}
                                </span>
                                {isPrimarySelected && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700">
                                    Primary (IF True)
                                  </span>
                                )}
                                {isSecondarySelected && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">
                                    Fallback (IF False)
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

                            {/* Tags preview */}
                            <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                              {extractTokens(t).slice(0, 3).map((token) => (
                                <span
                                  key={token}
                                  className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-purple-50 text-purple-700 border border-purple-200/60"
                                >
                                  {`{{${token}}}`}
                                </span>
                              ))}
                              {extractTokens(t).length > 3 && (
                                <span className="text-[10px] text-slate-400 font-medium">
                                  +{extractTokens(t).length - 3} more
                                </span>
                              )}
                              {t.cta_label && (
                                <span className="ml-auto text-[10px] font-semibold text-indigo-600 bg-indigo-50 px-1.5 py-0.2 rounded border border-indigo-100">
                                  CTA: {t.cta_label}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* ── RIGHT PANE: REAL-TIME NOTIFICATION PREVIEW & INSPECTOR ── */}
                <div className="lg:col-span-5 flex flex-col min-h-0 bg-white p-4 rounded-2xl border border-slate-200/90 shadow-2xs">
                  {/* Preview Header & Channel Toggle */}
                  <div className="shrink-0 flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
                    <div className="flex items-center gap-1.5">
                      <Sparkles size={14} className="text-indigo-600" />
                      <span className="text-xs font-bold text-slate-800">Live Rendered Preview</span>
                      <InfoTooltip content="Real-time rendering of how the notification appears to the learner, with interpolated sample variables." />
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
                        title="Mobile Push Notification preview"
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
                        title="In-App Banner preview"
                      >
                        <Bell size={11} />
                        <span>In-App</span>
                      </button>
                    </div>
                  </div>

                  {/* Dual branch preview selector (if DUAL_BRANCH) */}
                  {ruleMode === 'DUAL_BRANCH' && (
                    <div className="shrink-0 flex items-center justify-between gap-1 p-1 bg-slate-50 rounded-xl border border-slate-200/70 mb-3 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setActiveBranchTab('PRIMARY')}
                        className={`flex-1 py-1 rounded-lg font-bold transition-all text-center cursor-pointer ${
                          activeBranchTab === 'PRIMARY'
                            ? 'bg-white text-indigo-700 shadow-2xs border border-indigo-200'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        Previewing IF TRUE
                      </button>
                      <button
                        type="button"
                        onClick={() => setActiveBranchTab('SECONDARY')}
                        className={`flex-1 py-1 rounded-lg font-bold transition-all text-center cursor-pointer ${
                          activeBranchTab === 'SECONDARY'
                            ? 'bg-white text-amber-800 shadow-2xs border border-amber-200'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        Previewing IF FALSE
                      </button>
                    </div>
                  )}

                  {/* Preview Render Box */}
                  <div className="shrink-0">
                    {activeTemplateForBranch ? (
                      previewChannel === 'PUSH' ? (
                        /* Mobile Push Card */
                        <div className="bg-slate-900 text-white p-3.5 rounded-2xl border border-slate-800 shadow-sm space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5">
                              <div className="w-4 h-4 rounded-md bg-indigo-600 flex items-center justify-center text-[9px] font-bold">
                                <Zap size={9} />
                              </div>
                              <span className="text-[10px] font-bold tracking-wider text-slate-300 uppercase">
                                Workfloww
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

                          {activeTemplateForBranch.cta_label && (
                            <div className="pt-1.5 border-t border-slate-800 flex justify-end">
                              <span className="text-[10px] font-bold text-indigo-400 bg-indigo-950/60 px-2 py-1 rounded-lg border border-indigo-800/80">
                                {activeTemplateForBranch.cta_label} &rarr;
                              </span>
                            </div>
                          )}
                        </div>
                      ) : (
                        /* In-App Toast Card */
                        <div className="bg-white p-3.5 rounded-2xl border-2 border-indigo-200 shadow-xs space-y-2">
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

                          {activeTemplateForBranch.cta_label && (
                            <div className="pt-1 flex justify-start">
                              <span className="text-[11px] font-bold text-indigo-600 hover:text-indigo-700 underline underline-offset-2">
                                {activeTemplateForBranch.cta_label}
                              </span>
                            </div>
                          )}
                        </div>
                      )
                    ) : (
                      <div className="p-6 text-center rounded-2xl border border-dashed border-slate-200 bg-slate-50">
                        <Smartphone size={24} className="mx-auto text-slate-300 mb-2" />
                        <p className="text-xs font-semibold text-slate-600">No template selected</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">Click a template card on the left to inspect its live preview.</p>
                      </div>
                    )}
                  </div>

                  {/* Variable Mapping Inspector (Scrollable bottom of right pane) */}
                  <div className="flex-1 min-h-0 overflow-y-auto mt-3.5 pt-3 border-t border-slate-100 custom-scrollbar">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-bold text-slate-700 flex items-center gap-1">
                        <Tag size={12} className="text-slate-400" />
                        <span>Dynamic Token Inspector</span>
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">
                        {extractTokens(activeTemplateForBranch).length} token(s)
                      </span>
                    </div>

                    {extractTokens(activeTemplateForBranch).length === 0 ? (
                      <p className="text-[11px] text-slate-400 italic">
                        This template uses static text without variable tokens.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {extractTokens(activeTemplateForBranch).map((token) => {
                          const isTriggerVar = currentTrigger.variables.some((v) => v.toLowerCase().includes(token.toLowerCase()) || token.toLowerCase().includes(v.toLowerCase()));
                          const isProfileVar = ['first_name', 'name', 'user_name', 'subscriber.name', 'subscriber.role', 'subscriber.department'].includes(token.toLowerCase());

                          return (
                            <div
                              key={token}
                              className="p-2 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between text-[11px]"
                            >
                              <span className="font-mono font-bold text-purple-700 bg-purple-50 px-1.5 py-0.5 rounded border border-purple-200/60">
                                {`{{${token}}}`}
                              </span>

                              <div className="flex items-center gap-1 text-[10px] font-semibold">
                                {isTriggerVar ? (
                                  <span className="text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 flex items-center gap-1">
                                    <Check size={9} /> Trigger Event
                                  </span>
                                ) : isProfileVar ? (
                                  <span className="text-blue-700 bg-blue-50 px-1.5 py-0.5 rounded border border-blue-200 flex items-center gap-1">
                                    <Check size={9} /> User Profile
                                  </span>
                                ) : (
                                  <span className="text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">
                                    Payload Var
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════
              STEP 3: DEFINE RULES (HYBRID RULE ENGINE)
             ═════════════════════════════════════════════════════════════ */}
          {currentStep === 3 && (
            <div className="space-y-5 animate-in fade-in duration-100">
              <div>
                <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <span>Step 3: Define Trigger Rules & Conditions</span>
                  <InfoTooltip content="Set conditions comparing event parameters (like score or streak) to target values." />
                </h4>
                <p className="text-[11px] text-slate-500">
                  Control under what conditions the notification is dispatched when the event fires.
                </p>
              </div>

              {/* Rule Mode Tabs */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                {[
                  {
                    id: 'THRESHOLD',
                    title: 'Threshold Filter',
                    desc: 'Dispatch only when score, streak, or deadline matches criteria.',
                  },
                  {
                    id: 'DUAL_BRANCH',
                    title: 'Dual Branch (IF / ELSE)',
                    desc: 'Route to Template A if True, or Template B if False.',
                  },
                  {
                    id: 'UNCONDITIONAL',
                    title: 'Always Dispatch',
                    desc: 'Send unconditionally whenever the event occurs.',
                  },
                ].map((mode) => {
                  const isSelected = ruleMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => {
                        setRuleMode(mode.id as any);
                        if (errorMsg) setErrorMsg(null);
                      }}
                      className={`p-3.5 rounded-2xl border text-left transition-all cursor-pointer ${
                        isSelected
                          ? 'bg-indigo-50 border-indigo-400 shadow-2xs'
                          : 'bg-white border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <div className={`text-xs font-bold mb-1 ${isSelected ? 'text-indigo-900' : 'text-slate-800'}`}>
                        {mode.title}
                      </div>
                      <p className="text-[11px] text-slate-500 leading-snug">{mode.desc}</p>
                    </button>
                  );
                })}
              </div>

              {/* Dynamic Rules Builder (Only if not UNCONDITIONAL) */}
              {ruleMode !== 'UNCONDITIONAL' ? (
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-700 flex items-center gap-1">
                      <span>Evaluation Criteria (ALL must match)</span>
                      <InfoTooltip content="All conditions must be satisfied for the rule to evaluate to TRUE." />
                    </span>
                    <button
                      type="button"
                      onClick={handleAddRule}
                      className="text-xs font-semibold text-indigo-600 hover:text-indigo-700 cursor-pointer"
                    >
                      + Add Rule Condition
                    </button>
                  </div>

                  <div className="space-y-2">
                    {rules.map((rule, idx) => (
                      <div
                        key={idx}
                        className="flex flex-wrap items-center gap-2 bg-white p-2.5 rounded-xl border border-slate-200"
                      >
                        {/* Variable Picker */}
                        <select
                          value={rule.field}
                          onChange={(e) => handleUpdateRule(idx, 'field', e.target.value)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono"
                        >
                          {currentTrigger.variables.map((v) => (
                            <option key={v} value={v}>
                              {v}
                            </option>
                          ))}
                          <option value="subscriber.role">subscriber.role</option>
                          <option value="subscriber.department">subscriber.department</option>
                          <option value="gamification.streak_days">gamification.streak_days</option>
                        </select>

                        {/* Operator */}
                        <select
                          value={rule.operator}
                          onChange={(e) => handleUpdateRule(idx, 'operator', e.target.value)}
                          className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500 font-bold"
                        >
                          <option value="<">&lt; (Less than)</option>
                          <option value="<=">&le; (Less than or equal)</option>
                          <option value=">">&gt; (Greater than)</option>
                          <option value=">=">&ge; (Greater than or equal)</option>
                          <option value="==">== (Equals)</option>
                          <option value="!=">!= (Not equals)</option>
                        </select>

                        {/* Target Value */}
                        <input
                          type="text"
                          value={rule.value}
                          onChange={(e) => handleUpdateRule(idx, 'value', e.target.value)}
                          placeholder="e.g. 70"
                          className="flex-1 min-w-[80px] px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />

                        {/* Delete Button */}
                        {rules.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveRule(idx)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 transition-colors cursor-pointer"
                          >
                            <X size={14} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>

                  {ruleMode === 'DUAL_BRANCH' && (
                    <div className="text-[11px] text-slate-500 mt-2 p-2.5 rounded-xl bg-white border border-slate-200/80">
                      <strong>Branching Behavior:</strong> If condition is TRUE → dispatches <strong>{primaryTemplate?.template_name || 'Primary Template'}</strong>. If condition is FALSE → dispatches <strong>{secondaryTemplate?.template_name || 'Secondary Template'}</strong>.
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-6 text-center rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-500">
                  This workflow will fire unconditionally every time <strong>{currentTrigger.label}</strong> is ingested.
                </div>
              )}
            </div>
          )}

          {/* ═════════════════════════════════════════════════════════════
              STEP 4: CHANNELS & TEST AGAINST LOGGED-IN PORTAL USER
             ═════════════════════════════════════════════════════════════ */}
          {currentStep === 4 && (
            <div className="space-y-5 animate-in fade-in duration-100">
              <div>
                <h4 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                  <span>Step 4: Select Delivery Channels & Run Live Verification</span>
                  <InfoTooltip content="Transport channels deliver the notification. You can test the payload before saving." />
                </h4>
                <p className="text-[11px] text-slate-500">
                  Select allowed delivery channels and test the flow against your real authenticated account.
                </p>
              </div>

              {/* Delivery Channels */}
              <div>
                <label className="text-xs font-bold text-slate-700 flex items-center gap-1.5 mb-2">
                  <span>Delivery Channels</span>
                  <span className="text-rose-500">*</span>
                  <InfoTooltip content="Select at least one destination transport. In-App bell, mobile push, email digest, or WhatsApp." />
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  {[
                    { id: 'IN_APP', label: 'In-App Bell', icon: Bell, color: 'text-indigo-600' },
                    { id: 'PUSH', label: 'Mobile Push', icon: Smartphone, color: 'text-emerald-600' },
                    { id: 'EMAIL', label: 'Email Digest', icon: Mail, color: 'text-blue-600' },
                    { id: 'WHATSAPP', label: 'WhatsApp', icon: MessageSquare, color: 'text-green-600' },
                  ].map((ch) => {
                    const isSelected = selectedChannels.includes(ch.id);
                    const Icon = ch.icon;
                    return (
                      <div
                        key={ch.id}
                        onClick={() => {
                          handleToggleChannel(ch.id);
                          if (errorMsg) setErrorMsg(null);
                        }}
                        className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-center justify-between ${
                          isSelected
                            ? 'bg-indigo-50/60 border-indigo-400 shadow-2xs'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <Icon size={16} className={ch.color} />
                          <span className="text-xs font-bold text-slate-800">{ch.label}</span>
                        </div>
                        <div
                          className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                            isSelected ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-300 bg-white'
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

              {/* ─── LIVE TEST RUNNER SECTION ─────────────────────────── */}
              <div className="p-4 rounded-2xl bg-slate-900 text-white space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-bold flex items-center gap-1.5 text-amber-400">
                      <Sparkles size={14} />
                      <span>Live Test Run (Authenticated User Context)</span>
                      <InfoTooltip content="Simulates rule evaluation and token rendering with your currently logged-in account (Ansh Gahoi) without sending real production alerts." />
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Tests rule evaluation and interpolates variables using your active profile (
                      <strong>{loggedInName}</strong>).
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={handleRunTest}
                    disabled={testing}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-900 rounded-xl text-xs font-bold transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Play size={12} className={testing ? 'animate-spin' : ''} />
                    <span>{testing ? 'Testing...' : 'Test Workflow'}</span>
                  </button>
                </div>

                {testError && (
                  <div className="p-3 rounded-xl bg-rose-950/80 border border-rose-800 text-rose-300 text-xs">
                    {testError}
                  </div>
                )}

                {testResult && (
                  <div className="p-3.5 rounded-xl bg-slate-800/80 border border-slate-700 space-y-2 text-xs">
                    <div className="flex items-center justify-between border-b border-slate-700 pb-2">
                      <span className="font-semibold text-slate-300">
                        Rule Mode: <span className="font-mono text-amber-400">{testResult.rule_mode}</span>
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded-full font-bold text-[11px] ${
                          testResult.matches_conditions
                            ? 'bg-emerald-900/80 text-emerald-300 border border-emerald-700'
                            : 'bg-rose-900/80 text-rose-300 border border-rose-700'
                        }`}
                      >
                        {testResult.matches_conditions ? '✓ Condition MATCHED (TRUE)' : '✕ Condition FAILED (FALSE)'}
                      </span>
                    </div>

                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                        Rendered Title (Evaluated with your profile)
                      </div>
                      <div className="font-bold text-white text-xs">{testResult.rendered_title}</div>
                    </div>

                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-0.5">
                        Rendered Message Body
                      </div>
                      <div className="text-slate-300 text-[11px] leading-relaxed">
                        {testResult.rendered_body}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* ─── MODAL FOOTER NAVIGATION (SHRINK-0) ────────────────────── */}
        <div className="shrink-0 px-6 py-4 border-t border-slate-100 bg-slate-50/70 flex items-center justify-between">
          <button
            type="button"
            disabled={currentStep === 1}
            onClick={() => setCurrentStep((prev) => Math.max(1, prev - 1))}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-30 disabled:pointer-events-none"
          >
            <ArrowLeft size={13} />
            <span>Previous</span>
          </button>

          <div className="flex items-center gap-2.5">
            {currentStep < 4 ? (
              <button
                type="button"
                onClick={handleNextStep}
                className="flex items-center gap-1.5 px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs transition-all cursor-pointer"
              >
                <span>Continue</span>
                <ArrowRight size={13} />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSaveWorkflow}
                disabled={saving}
                className="flex items-center gap-1.5 px-6 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs hover:shadow-sm transition-all cursor-pointer disabled:opacity-50"
              >
                <Check size={14} />
                <span>{saving ? 'Saving...' : initialWorkflow ? 'Update Workflow' : 'Save & Publish Workflow'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
