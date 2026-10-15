'use client';

import React, { useState, useEffect } from 'react';
import {
  Zap,
  Plus,
  CheckCircle2,
  Clock,
  Trash2,
  Sliders,
  Smartphone,
  ArrowLeft,
  Check,
  RefreshCw,
  X,
  Play,
  GitBranch,
  Send,
  Users,
  Moon,
  Gauge,
  ShieldCheck,
  Eye,
  Settings,
  Sparkles,
} from 'lucide-react';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import {
  NotificationWorkflow,
  LIFECYCLE_TRIGGERS,
  AVAILABLE_FIELDS,
} from './WorkflowAutomationManager';

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

interface WorkflowCanvasBuilderProps {
  workflow?: NotificationWorkflow | null;
  onClose: () => void;
  onSaved: () => void;
}

export type StepType = 'TRIGGER' | 'CONDITION' | 'ACTION' | 'DELAY';

export interface CanvasRuleItem {
  id: string;
  field: string;
  operator: string;
  value: any;
}

export interface WorkflowStep {
  id: string;
  type: StepType;
  title: string;
  subtitle?: string;

  // Trigger Properties
  triggerKey?: string;

  // Condition Properties
  conditionMatch?: 'ALL' | 'ANY';
  rules?: CanvasRuleItem[];
  trueBranch?: WorkflowStep[];
  falseBranch?: WorkflowStep[];

  // Action Properties
  templateId?: string;
  templateName?: string;
  channels?: string[];
  titleTemplate?: string;
  bodyTemplate?: string;
  ctaLabel?: string;
  templateVersion?: number;
  templateStatus?: string;

  // Delay Properties
  cooldownSeconds?: number;
  respectQuietHours?: boolean;
}

export function WorkflowCanvasBuilder({ workflow, onClose, onSaved }: WorkflowCanvasBuilderProps) {
  // ─── TAB NAVIGATION ──────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'PIPELINE' | 'SETTINGS'>('PIPELINE');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // ─── WORKFLOW CORE METADATA ──────────────────────────────────────────────
  const [wId, setWId] = useState<string | null>(workflow?.id || null);
  const [wTitle, setWTitle] = useState(workflow?.title || 'Adaptive Weak-Spot Remediation');
  const [wDescription, setWDescription] = useState(
    workflow?.description || 'Automated learning workflow with condition branching, multi-channel action, and quiet hours.'
  );
  const [wTrigger, setWTrigger] = useState<string>(workflow?.trigger_lifecycle || 'ASSESSMENT_SUBMITTED');
  const [wCategory, setWCategory] = useState(workflow?.category || 'ASSESSMENT');
  const [wIsActive, setWIsActive] = useState<boolean>(workflow?.is_active ?? true);
  const [wDeliveryPolicy, setWDeliveryPolicy] = useState<'PARALLEL' | 'ORDERED_FALLBACK'>('ORDERED_FALLBACK');
  const [wPriority, setWPriority] = useState<'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'>('NORMAL');
  const [wCooldown, setWCooldown] = useState<number>(workflow?.cooldown_seconds || 3600);

  // ─── 5-PILLAR ENTERPRISE GOVERNANCE SETTINGS ─────────────────────────────
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(true);
  const [quietStart, setQuietStart] = useState('22:00');
  const [quietEnd, setQuietEnd] = useState('08:00');
  const [fatigueMaxPerDay, setFatigueMaxPerDay] = useState(3);
  const [audienceSegment, setAudienceSegment] = useState<'ALL_ACTIVE' | 'TRIAL_USERS' | 'ENTERPRISE_TEAMS' | 'CHURN_RISK'>('ALL_ACTIVE');

  // ─── GUIDED 3-STEP SETUP WIZARD STATE (SCREEN 2) ─────────────────────────
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3>(1);
  const [wizardName, setWizardName] = useState(wTitle);
  const [wizardTrigger, setWizardTrigger] = useState(wTrigger);
  const [wizardThreshold, setWizardThreshold] = useState('70');
  const [wizardChannels, setWizardChannels] = useState<string[]>(['PUSH', 'IN_APP']);
  const [wizardTemplateId, setWizardTemplateId] = useState('');

  // ─── TEMPLATE CATALOG ────────────────────────────────────────────────────
  const [availableTemplates, setAvailableTemplates] = useState<any[]>([]);
  useEffect(() => {
    fetchCatalogTemplates();
  }, []);

  const fetchCatalogTemplates = async () => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/templates`);
      const data = await res.json();
      if (data?.templates) {
        setAvailableTemplates(data.templates);
      }
    } catch (err) {
      console.error('Failed to load templates:', err);
    }
  };

  // ─── DEFAULT STEPS (CLEAN VERTICAL PIPELINE TREE) ────────────────────────
  const DEFAULT_STEPS: WorkflowStep[] = [
    {
      id: 'step-trigger',
      type: 'TRIGGER',
      title: 'Assessment Submitted',
      subtitle: 'Fires instantly when a learner submits any quiz, checkpoint, or exam',
      triggerKey: workflow?.trigger_lifecycle || 'ASSESSMENT_SUBMITTED',
    },
    {
      id: 'step-condition',
      type: 'CONDITION',
      title: 'Passing Score Evaluation',
      subtitle: 'Evaluates if learner scored below passing threshold (< 70%)',
      conditionMatch: 'ALL',
      rules:
        workflow?.filter_rules && workflow.filter_rules.length > 0
          ? workflow.filter_rules.map((r, i) => ({
              id: `rule-${i}`,
              field: r.field || 'score',
              operator: r.operator || '<',
              value: r.value ?? '70',
            }))
          : [
              { id: 'rule-1', field: 'score', operator: '<', value: '70' },
              { id: 'rule-2', field: 'department', operator: '!=', value: 'Management' },
            ],
      trueBranch: [
        {
          id: 'step-action-remedial',
          type: 'ACTION',
          title: 'Adaptive Remediation Nudge',
          subtitle: 'Dispatches targeted review recommendation & unlocks practice micro-drill',
          templateId: workflow?.pinned_template_id || 'tpl-adaptive-remediation',
          templateName: 'Adaptive Remediation Review',
          channels: ['PUSH', 'IN_APP'],
          titleTemplate: '💪 Let’s strengthen {{module_name}}',
          bodyTemplate:
            'Hi {{first_name}}, you scored {{score}}% on {{module_name}}. We’ve unlocked an interactive refresher drill on {{weak_topic}} to help you master this sprint!',
          templateVersion: 2,
          templateStatus: 'PUBLISHED',
        },
        {
          id: 'step-delay-remedial',
          type: 'DELAY',
          title: 'Learner Cooldown Wait',
          subtitle: 'Suppresses repeated alerts to respect attention & quiet hours',
          cooldownSeconds: 7200,
          respectQuietHours: true,
        },
      ],
      falseBranch: [
        {
          id: 'step-action-passed',
          type: 'ACTION',
          title: 'Quiz Passed Celebration',
          subtitle: 'Recognizes mastery and unlocks the next module track in the syllabus',
          templateId: 'tpl-quiz-passed',
          templateName: 'Quiz Passed Milestone',
          channels: ['IN_APP', 'PUSH'],
          titleTemplate: '🎉 Fantastic job on {{module_name}}!',
          bodyTemplate:
            'Congratulations {{first_name}}! You passed with {{score}}% and earned +150 XP toward your weekly goal.',
          templateVersion: 1,
          templateStatus: 'PUBLISHED',
        },
      ],
    },
  ];

  const [steps, setSteps] = useState<WorkflowStep[]>(DEFAULT_STEPS);

  // ─── SELECTION & INSPECTOR STATE ─────────────────────────────────────────
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);

  // ─── INSERT POPOVER MENU STATE ───────────────────────────────────────────
  const [insertPopover, setInsertPopover] = useState<{
    parentBranch: 'MAIN' | 'TRUE' | 'FALSE';
    insertIndex: number;
    anchorY: number;
  } | null>(null);

  // ─── SIMULATION & DRY RUN STATE ──────────────────────────────────────────
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);
  const [simPersona, setSimPersona] = useState<'alex' | 'jordan'>('alex');
  const [simLogs, setSimLogs] = useState<string[]>([]);
  const [isSimRunning, setIsSimRunning] = useState(false);
  const [activeLitSteps, setActiveLitSteps] = useState<string[]>([]);
  const [activeLitBranch, setActiveLitBranch] = useState<'TRUE' | 'FALSE' | null>(null);

  // ─── HELPER: FIND STEP RECURSIVELY ───────────────────────────────────────
  const findStepById = (stepList: WorkflowStep[], id: string): WorkflowStep | null => {
    for (const step of stepList) {
      if (step.id === id) return step;
      if (step.trueBranch) {
        const found = findStepById(step.trueBranch, id);
        if (found) return found;
      }
      if (step.falseBranch) {
        const found = findStepById(step.falseBranch, id);
        if (found) return found;
      }
    }
    return null;
  };

  // ─── HELPER: UPDATE STEP RECURSIVELY ─────────────────────────────────────
  const updateStepById = (
    stepList: WorkflowStep[],
    id: string,
    updater: (step: WorkflowStep) => WorkflowStep
  ): WorkflowStep[] => {
    return stepList.map((step) => {
      if (step.id === id) {
        return updater(step);
      }
      return {
        ...step,
        trueBranch: step.trueBranch ? updateStepById(step.trueBranch, id, updater) : undefined,
        falseBranch: step.falseBranch ? updateStepById(step.falseBranch, id, updater) : undefined,
      };
    });
  };

  // ─── HELPER: DELETE STEP RECURSIVELY ─────────────────────────────────────
  const deleteStepById = (stepList: WorkflowStep[], id: string): WorkflowStep[] => {
    return stepList
      .filter((step) => step.id !== id)
      .map((step) => ({
        ...step,
        trueBranch: step.trueBranch ? deleteStepById(step.trueBranch, id) : undefined,
        falseBranch: step.falseBranch ? deleteStepById(step.falseBranch, id) : undefined,
      }));
  };

  // ─── INSERT STEP INTO PIPELINE ───────────────────────────────────────────
  const handleInsertStep = (type: StepType) => {
    if (!insertPopover) return;
    const { parentBranch, insertIndex } = insertPopover;

    const newId = `step-${type.toLowerCase()}-${Date.now()}`;
    let newStep: WorkflowStep;

    if (type === 'ACTION') {
      const defaultTpl = availableTemplates[0];
      newStep = {
        id: newId,
        type: 'ACTION',
        title: defaultTpl ? defaultTpl.name : 'Notification Action',
        subtitle: 'Sends targeted message via selected channels',
        templateId: defaultTpl?.id || 'tpl-general-nudge',
        templateName: defaultTpl?.name || 'Course Update Nudge',
        channels: defaultTpl ? [defaultTpl.channel] : ['IN_APP', 'PUSH'],
        titleTemplate: '🔔 Update: {{module_name}}',
        bodyTemplate: 'Hi {{first_name}}, continue your sprint today to maintain your learning streak!',
        templateVersion: 1,
        templateStatus: 'PUBLISHED',
      };
    } else if (type === 'CONDITION') {
      newStep = {
        id: newId,
        type: 'CONDITION',
        title: 'Check Condition (IF / ELSE)',
        subtitle: 'Evaluates learner criteria to split workflow path',
        conditionMatch: 'ALL',
        rules: [{ id: `rule-${Date.now()}`, field: 'score', operator: '<', value: '70' }],
        trueBranch: [],
        falseBranch: [],
      };
    } else {
      newStep = {
        id: newId,
        type: 'DELAY',
        title: 'Delay / Cooldown',
        subtitle: 'Wait before proceeding to the next step',
        cooldownSeconds: 3600,
        respectQuietHours: true,
      };
    }

    if (parentBranch === 'MAIN') {
      setSteps((prev) => {
        const copy = [...prev];
        copy.splice(insertIndex, 0, newStep);
        return copy;
      });
    } else if (parentBranch === 'TRUE') {
      setSteps((prev) =>
        updateStepById(prev, 'step-condition', (s) => ({
          ...s,
          trueBranch: (() => {
            const list = [...(s.trueBranch || [])];
            list.splice(insertIndex, 0, newStep);
            return list;
          })(),
        }))
      );
    } else if (parentBranch === 'FALSE') {
      setSteps((prev) =>
        updateStepById(prev, 'step-condition', (s) => ({
          ...s,
          falseBranch: (() => {
            const list = [...(s.falseBranch || [])];
            list.splice(insertIndex, 0, newStep);
            return list;
          })(),
        }))
      );
    }

    setInsertPopover(null);
    setSelectedStepId(newStep.id);
    setIsInspectorOpen(true);
    setHasUnsavedChanges(true);
  };

  // ─── DRY RUN SIMULATION ──────────────────────────────────────────────────
  const handleStartSimulation = () => {
    setIsSimRunning(true);
    setActiveLitSteps(['step-trigger']);
    setActiveLitBranch(null);

    const personaName = simPersona === 'alex' ? 'Alex Mercer (Score 68%)' : 'Jordan Hayes (Score 84%)';
    const scoreVal = simPersona === 'alex' ? 68 : 84;
    const isUnderPassing = scoreVal < 70;

    setSimLogs([
      `[0.00s] Ingesting lifecycle event "${wTrigger}" for ${personaName}`,
      `[0.08s] Policy Check: Quiet Hours (Pass) • Daily Fatigue 0/${fatigueMaxPerDay} (Pass)`,
    ]);

    setTimeout(() => {
      setActiveLitSteps(['step-trigger', 'step-condition']);
      setSimLogs((prev) => [
        ...prev,
        `[0.40s] Condition Evaluated: score (${scoreVal}) < 70 → ${isUnderPassing ? 'TRUE (Remediation Required)' : 'FALSE (Passed)'}`,
      ]);

      setTimeout(() => {
        if (isUnderPassing) {
          setActiveLitBranch('TRUE');
          setActiveLitSteps(['step-trigger', 'step-condition', 'step-action-remedial', 'step-delay-remedial']);
          setSimLogs((prev) => [
            ...prev,
            `[0.80s] Branch [TRUE] activated: Dispatched "Adaptive Remediation Nudge" via [PUSH, IN_APP]`,
            `[1.05s] Lockscreen notification delivered. Cooldown timer (2 hours) initiated.`,
          ]);
        } else {
          setActiveLitBranch('FALSE');
          setActiveLitSteps(['step-trigger', 'step-condition', 'step-action-passed']);
          setSimLogs((prev) => [
            ...prev,
            `[0.80s] Branch [FALSE] activated: Dispatched "Quiz Passed Celebration" via [IN_APP, PUSH]`,
            `[1.05s] Milestone recorded. Workflow completed successfully.`,
          ]);
        }
        setIsSimRunning(false);
      }, 700);
    }, 600);
  };

  // ─── PUBLISH / SAVE WORKFLOW ─────────────────────────────────────────────
  const handlePublish = async () => {
    setSaving(true);
    try {
      const condNode = steps.find((s) => s.type === 'CONDITION');
      const flatRules = condNode?.rules || [{ field: 'score', operator: '<', value: '70' }];
      const sampleAction = condNode?.trueBranch?.[0] || steps.find((s) => s.type === 'ACTION');

      const payload = {
        title: wTitle,
        description: wDescription,
        trigger_lifecycle: wTrigger,
        category: wCategory,
        filter_rules: flatRules.map((r) => ({ field: r.field, operator: r.operator, value: r.value })),
        filter_match_type: condNode?.conditionMatch || 'ALL',
        notification_type: 'ADAPTIVE_' + wTrigger,
        channels: sampleAction?.channels || ['IN_APP', 'PUSH'],
        delivery_policy: wDeliveryPolicy,
        pinned_template_id: sampleAction?.templateId || null,
        title_template: sampleAction?.titleTemplate || '💪 Let’s strengthen {{module_name}}',
        body_template:
          sampleAction?.bodyTemplate ||
          'Hi {{first_name}}, you scored {{score}}% on {{module_name}}. Review your tailored refresher drill!',
        cooldown_seconds: wCooldown,
        priority: wPriority,
        is_active: wIsActive,
      };

      if (wId) {
        const res = await fetchWithAuth(`${API_BASE}/api/notifications/workflows/${wId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to update workflow');
      } else {
        const res = await fetchWithAuth(`${API_BASE}/api/notifications/workflows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error('Failed to create workflow');
        const data = await res.json();
        if (data?.workflow?.id) setWId(data.workflow.id);
      }

      setSaveSuccess(true);
      setHasUnsavedChanges(false);
      setTimeout(() => setSaveSuccess(false), 2500);
      onSaved();
    } catch (err: any) {
      console.error('Publish error:', err);
      alert(err?.message || 'Error publishing workflow');
    } finally {
      setSaving(false);
    }
  };

  // ─── COMPILE GUIDED WIZARD INTO VISUAL TREE (SCREEN 2) ───────────────────
  const handleCompileWizard = () => {
    setWTitle(wizardName || 'Adaptive Remediation Workflow');
    setWTrigger(wizardTrigger);

    const chosenTpl = availableTemplates.find((t) => t.id === wizardTemplateId) || availableTemplates[0];

    const generatedSteps: WorkflowStep[] = [
      {
        id: 'step-trigger',
        type: 'TRIGGER',
        title: LIFECYCLE_TRIGGERS.find((t) => t.key === wizardTrigger)?.label || 'Assessment Submitted',
        subtitle: 'Fires instantly upon matching lifecycle event in learning platform',
        triggerKey: wizardTrigger,
      },
      {
        id: 'step-condition',
        type: 'CONDITION',
        title: `Score Evaluation (< ${wizardThreshold}%)`,
        subtitle: `Evaluates if learner scored below passing threshold (< ${wizardThreshold}%)`,
        conditionMatch: 'ALL',
        rules: [{ id: 'rule-1', field: 'score', operator: '<', value: wizardThreshold }],
        trueBranch: [
          {
            id: 'step-action-remedial',
            type: 'ACTION',
            title: chosenTpl ? chosenTpl.name : 'Adaptive Remediation Nudge',
            subtitle: 'Dispatches targeted review recommendation & unlocks practice micro-drill',
            templateId: chosenTpl?.id || 'tpl-adaptive-remediation',
            templateName: chosenTpl?.name || 'Adaptive Remediation Review',
            channels: wizardChannels,
            titleTemplate: chosenTpl?.title_template || '💪 Let’s strengthen {{module_name}}',
            bodyTemplate:
              chosenTpl?.body_template ||
              'Hi {{first_name}}, you scored {{score}}% on {{module_name}}. Review your tailored refresher drill!',
            templateVersion: 1,
            templateStatus: 'PUBLISHED',
          },
          {
            id: 'step-delay-remedial',
            type: 'DELAY',
            title: 'Learner Cooldown Wait (2 Hours)',
            subtitle: 'Suppresses repeated alerts to respect attention & quiet hours',
            cooldownSeconds: 7200,
            respectQuietHours: true,
          },
        ],
        falseBranch: [
          {
            id: 'step-action-passed',
            type: 'ACTION',
            title: 'Quiz Passed Celebration',
            subtitle: 'Recognizes mastery and unlocks the next module track in the syllabus',
            templateId: 'tpl-quiz-passed',
            templateName: 'Quiz Passed Milestone',
            channels: wizardChannels,
            titleTemplate: '🎉 Fantastic job on {{module_name}}!',
            bodyTemplate:
              'Congratulations {{first_name}}! You passed with {{score}}% and earned +150 XP toward your weekly goal.',
            templateVersion: 1,
            templateStatus: 'PUBLISHED',
          },
        ],
      },
    ];

    setSteps(generatedSteps);
    setIsWizardOpen(false);
    setSelectedStepId(null);
    setHasUnsavedChanges(true);
  };

  const selectedStep = selectedStepId ? findStepById(steps, selectedStepId) : null;
  const selectedTriggerObj = LIFECYCLE_TRIGGERS.find((t) => t.key === wTrigger) || LIFECYCLE_TRIGGERS[0];

  // ─── REFINED STRIPE-GRADE CARD RENDERER ──────────────────────────────────
  const renderCard = (step: WorkflowStep, stepBadgeLabel: string) => {
    const isSelected = selectedStepId === step.id;
    const isLit = activeLitSteps.includes(step.id);

    return (
      <div
        key={step.id}
        onClick={(e) => {
          e.stopPropagation();
          setSelectedStepId(step.id);
          setIsInspectorOpen(true);
        }}
        className={`w-[380px] rounded-2xl bg-white border transition-all cursor-pointer select-none relative group ${
          isSelected
            ? 'border-indigo-600 ring-2 ring-indigo-500/20 shadow-md'
            : isLit
            ? 'border-emerald-500 ring-2 ring-emerald-500/25 shadow-md bg-emerald-50/10'
            : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'
        }`}
      >
        <div className="p-4 space-y-3">
          {/* Top Row: Icon + Type Pill + Executed badge / Action menu */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {/* Soft Icon Badge */}
              {step.type === 'TRIGGER' && (
                <div className="w-7 h-7 rounded-lg bg-amber-50 border border-amber-200/70 text-amber-600 flex items-center justify-center shrink-0">
                  <Zap size={14} />
                </div>
              )}
              {step.type === 'CONDITION' && (
                <div className="w-7 h-7 rounded-lg bg-indigo-50 border border-indigo-200/70 text-indigo-600 flex items-center justify-center shrink-0">
                  <GitBranch size={14} />
                </div>
              )}
              {step.type === 'ACTION' && (
                <div className="w-7 h-7 rounded-lg bg-emerald-50 border border-emerald-200/70 text-emerald-600 flex items-center justify-center shrink-0">
                  <Send size={14} />
                </div>
              )}
              {step.type === 'DELAY' && (
                <div className="w-7 h-7 rounded-lg bg-slate-100 border border-slate-200/70 text-slate-600 flex items-center justify-center shrink-0">
                  <Clock size={14} />
                </div>
              )}

              {/* Category Micro-tag */}
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                {stepBadgeLabel}
              </span>
            </div>

            {/* Right badges / actions */}
            <div className="flex items-center gap-2">
              {isLit && (
                <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Check size={11} />
                  <span>Executed</span>
                </span>
              )}

              {step.type !== 'TRIGGER' && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSteps((prev) => deleteStepById(prev, step.id));
                    if (selectedStepId === step.id) {
                      setSelectedStepId(null);
                      setIsInspectorOpen(false);
                    }
                    setHasUnsavedChanges(true);
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-all cursor-pointer"
                  title="Delete Step"
                >
                  <Trash2 size={13} />
                </button>
              )}

              <span className="text-[11px] font-medium text-slate-400 group-hover:text-indigo-600 transition-colors">
                Configure →
              </span>
            </div>
          </div>

          {/* Title & Subtitle */}
          <div>
            <h3 className="text-sm font-bold text-slate-900 leading-snug">{step.title}</h3>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed line-clamp-1">{step.subtitle}</p>
          </div>

          {/* Clean Content Preview Section */}
          {step.type === 'TRIGGER' && (
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between text-xs">
              <span className="font-semibold text-amber-700 bg-amber-50/80 px-2 py-0.5 rounded-md border border-amber-200/60 font-mono text-[11px]">
                {wTrigger}
              </span>
              <span className="text-slate-400 text-[10px]">Payload: score, user_id, module</span>
            </div>
          )}

          {step.type === 'CONDITION' && (
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 space-y-1.5">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                {step.conditionMatch || 'ALL'} rules must match:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {step.rules?.map((r) => (
                  <span
                    key={r.id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white text-slate-700 text-[11px] font-mono border border-slate-200 shadow-2xs"
                  >
                    <span className="font-medium text-slate-600">{r.field}</span>
                    <span className="text-indigo-600 font-bold">{r.operator}</span>
                    <span className="font-semibold text-slate-900">&quot;{r.value}&quot;</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {step.type === 'ACTION' && (
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 space-y-2">
              <div className="flex items-center gap-1.5">
                {(step.channels || ['IN_APP']).map((ch) => (
                  <span
                    key={ch}
                    className="text-[9px] font-bold px-2 py-0.5 rounded-md bg-white text-emerald-700 border border-emerald-200 font-mono tracking-wider shadow-2xs"
                  >
                    {ch}
                  </span>
                ))}
              </div>
              {step.bodyTemplate && (
                <p className="text-[11px] text-slate-600 italic line-clamp-2 leading-relaxed">
                  &quot;{step.bodyTemplate}&quot;
                </p>
              )}
            </div>
          )}

          {step.type === 'DELAY' && (
            <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-100 flex items-center justify-between text-xs">
              <span className="font-bold text-slate-700 font-mono text-[11px] flex items-center gap-1.5">
                <Clock size={12} className="text-slate-500" />
                <span>{Math.round((step.cooldownSeconds || 3600) / 3600)} Hours Cooldown</span>
              </span>
              <span className="text-slate-400 text-[10px]">Quiet Hours: 10 PM - 8 AM</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ─── REUSABLE VERTICAL CONNECTOR WITH [+] INSERT BUTTON ──────────────────
  const renderConnector = (parentBranch: 'MAIN' | 'TRUE' | 'FALSE', insertIndex: number) => {
    return (
      <div className="relative flex flex-col items-center my-0.5 group/conn">
        {/* Crisp vertical line stem */}
        <div className="w-0.5 h-11 bg-slate-200 group-hover/conn:bg-indigo-400 transition-colors" />

        {/* [+] Insert Button */}
        <button
          type="button"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            setInsertPopover({
              parentBranch,
              insertIndex,
              anchorY: rect.bottom + 6,
            });
          }}
          className="absolute top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-white border border-slate-300 hover:border-indigo-600 hover:bg-indigo-50 hover:scale-110 shadow-xs flex items-center justify-center text-slate-400 hover:text-indigo-600 transition-all cursor-pointer z-10"
          title="Insert Step Here"
        >
          <Plus size={12} />
        </button>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-[60] bg-[#f8fafc] text-slate-800 flex flex-col overflow-hidden select-none font-sans">
      {/* ─────────────────────────────────────────────────────────────────────
          TOP APP BAR (CLEAN, SOLID WHITE, ZERO OVERLAP)
         ───────────────────────────────────────────────────────────────────── */}
      <header className="h-14 bg-white border-b border-slate-200/90 px-6 flex items-center justify-between shrink-0 z-30 shadow-2xs">
        {/* Left: Back + Workflow Name */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer flex items-center gap-1.5 text-xs font-semibold"
            title="Return to Automations List"
          >
            <ArrowLeft size={16} />
            <span className="hidden sm:inline">Automations</span>
          </button>

          <div className="h-4 w-px bg-slate-200" />

          {/* Workflow Title */}
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-amber-50 border border-amber-200/70 text-amber-600">
              <Zap size={14} />
            </span>
            <input
              type="text"
              value={wTitle}
              onChange={(e) => {
                setWTitle(e.target.value);
                setHasUnsavedChanges(true);
              }}
              className="bg-transparent hover:bg-slate-100 focus:bg-white px-2 py-1 rounded-md text-sm font-bold text-slate-900 border border-transparent focus:border-indigo-500 outline-none w-56 sm:w-72 transition-colors"
            />
          </div>

          {/* Active Status Badge */}
          <button
            type="button"
            onClick={() => {
              setWIsActive(!wIsActive);
              setHasUnsavedChanges(true);
            }}
            className={`px-2.5 py-1 rounded-full text-[11px] font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
              wIsActive
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-slate-100 text-slate-600 border border-slate-200'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${wIsActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
            <span>{wIsActive ? 'Active' : 'Draft'}</span>
          </button>
        </div>

        {/* Center: Segmented Tabs */}
        <div className="hidden md:flex items-center p-1 rounded-xl bg-slate-100 border border-slate-200">
          <button
            type="button"
            onClick={() => setActiveTab('PIPELINE')}
            className={`px-3.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'PIPELINE'
                ? 'bg-white text-indigo-700 shadow-2xs font-extrabold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <GitBranch size={13} />
            <span>Workflow Pipeline</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('SETTINGS')}
            className={`px-3.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'SETTINGS'
                ? 'bg-white text-indigo-700 shadow-2xs font-extrabold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            <Sliders size={13} />
            <span>Workflow Settings</span>
          </button>
        </div>

        {/* Right: Actions (Offset with mr-14 to clear Next.js dev badge) */}
        <div className="flex items-center gap-2.5 mr-14">
          {/* Setup Wizard Launcher (Screen 2) */}
          <button
            type="button"
            onClick={() => {
              setWizardName(wTitle);
              setWizardTrigger(wTrigger);
              setWizardStep(1);
              setIsWizardOpen(true);
            }}
            className="px-3 py-1.5 rounded-xl text-xs font-bold bg-white hover:bg-slate-50 text-indigo-700 border border-slate-200 flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
            title="Launch 3-Step Guided Workflow Setup Wizard"
          >
            <Sparkles size={12} className="text-indigo-600" />
            <span className="hidden sm:inline">Setup Wizard</span>
          </button>

          {/* Test Run Simulation */}
          <button
            type="button"
            onClick={() => setIsSimulatorOpen(true)}
            className="px-3.5 py-1.5 rounded-xl text-xs font-bold bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 flex items-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
          >
            <Play size={12} className="text-emerald-600 fill-emerald-600" />
            <span className="hidden sm:inline">Test Run</span>
          </button>

          {/* Save Workflow */}
          <button
            type="button"
            onClick={handlePublish}
            disabled={saving}
            className="px-4 py-1.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
          >
            {saving ? (
              <>
                <RefreshCw size={13} className="animate-spin" />
                <span>Saving...</span>
              </>
            ) : saveSuccess ? (
              <>
                <Check size={13} className="text-white" />
                <span>Saved!</span>
              </>
            ) : (
              <>
                <CheckCircle2 size={13} />
                <span>Save Workflow</span>
              </>
            )}
          </button>

          {/* Close Modal Button */}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer ml-1"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>
      </header>

      {/* ─────────────────────────────────────────────────────────────────────
          MAIN CONTENT AREA
         ───────────────────────────────────────────────────────────────────── */}
      {activeTab === 'PIPELINE' ? (
        <div className="relative flex-1 flex overflow-hidden">
          {/* ─── CENTERED VERTICAL TREE CANVAS ─────────────────────────────── */}
          <div
            onClick={() => {
              setInsertPopover(null);
            }}
            className="flex-1 overflow-y-auto px-6 py-12 flex flex-col items-center bg-[#f8fafc]"
          >
            {/* ─── 1. ROOT TRIGGER CARD ────────────────────────────────────── */}
            {renderCard(steps[0], 'Trigger • Event')}

            {/* Vertical connector from Trigger to Condition */}
            {renderConnector('MAIN', 1)}

            {/* ─── 2. CONDITION IF / ELSE CARD ─────────────────────────────── */}
            {steps[1] && renderCard(steps[1], 'Rule • Condition')}

            {/* ─── 3. SYMMETRICAL BRANCHING FORK ───────────────────────────── */}
            {steps[1] && steps[1].type === 'CONDITION' && (
              <div className="w-full max-w-4xl relative flex flex-col items-center">
                {/* Mathematical SVG Branching Fork */}
                <svg viewBox="0 0 100 48" preserveAspectRatio="none" className="w-full h-12 overflow-visible">
                  {/* Vertical stem from condition */}
                  <path d="M 50 0 V 16" stroke="#cbd5e1" strokeWidth="2" fill="none" />
                  {/* Fork to Left Branch (True) */}
                  <path
                    d="M 50 16 C 50 32, 25 32, 25 48"
                    fill="none"
                    stroke={activeLitBranch === 'TRUE' ? '#10b981' : '#cbd5e1'}
                    strokeWidth={activeLitBranch === 'TRUE' ? 3 : 2}
                    className="transition-colors duration-300"
                  />
                  {/* Fork to Right Branch (False) */}
                  <path
                    d="M 50 16 C 50 32, 75 32, 75 48"
                    fill="none"
                    stroke={activeLitBranch === 'FALSE' ? '#10b981' : '#cbd5e1'}
                    strokeWidth={activeLitBranch === 'FALSE' ? 3 : 2}
                    className="transition-colors duration-300"
                  />
                </svg>

                {/* Symmetrical Two-Column Branches */}
                <div className="w-full grid grid-cols-2 gap-8">
                  {/* ─── LEFT COLUMN: TRUE BRANCH (REMEDIATION) ─────────────── */}
                  <div
                    className={`flex flex-col items-center transition-all ${
                      activeLitBranch === 'FALSE' ? 'opacity-35' : 'opacity-100'
                    }`}
                  >
                    {/* Branch Label Badge */}
                    <div className="mb-3">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-800 border border-emerald-200/90 shadow-2xs">
                        <Check size={12} className="text-emerald-600" />
                        <span>IF TRUE • Score &lt; 70% (Remediation)</span>
                      </span>
                    </div>

                    {/* True Branch Steps */}
                    {steps[1].trueBranch?.map((trueStep, idx) => (
                      <React.Fragment key={trueStep.id}>
                        {renderCard(trueStep, `Action • ${trueStep.type}`)}
                        {idx < (steps[1].trueBranch?.length || 0) - 1 && renderConnector('TRUE', idx + 1)}
                      </React.Fragment>
                    ))}

                    {/* [+] Connector to append step */}
                    {renderConnector('TRUE', steps[1].trueBranch?.length || 0)}

                    {/* Terminal End of Branch */}
                    <div className="flex flex-col items-center">
                      <div className="px-3 py-1 rounded-full bg-slate-100 border border-slate-200/80 text-slate-500 text-[11px] font-semibold flex items-center gap-1.5 shadow-2xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                        <span>End of Branch</span>
                      </div>
                    </div>
                  </div>

                  {/* ─── RIGHT COLUMN: FALSE BRANCH (PASSED) ────────────────── */}
                  <div
                    className={`flex flex-col items-center transition-all ${
                      activeLitBranch === 'TRUE' ? 'opacity-35' : 'opacity-100'
                    }`}
                  >
                    {/* Branch Label Badge */}
                    <div className="mb-3">
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-100 text-slate-700 border border-slate-200/90 shadow-2xs">
                        <X size={12} className="text-slate-500" />
                        <span>IF FALSE • Score &ge; 70% (Passed)</span>
                      </span>
                    </div>

                    {/* False Branch Steps */}
                    {steps[1].falseBranch?.map((falseStep, idx) => (
                      <React.Fragment key={falseStep.id}>
                        {renderCard(falseStep, `Action • ${falseStep.type}`)}
                        {idx < (steps[1].falseBranch?.length || 0) - 1 && renderConnector('FALSE', idx + 1)}
                      </React.Fragment>
                    ))}

                    {/* [+] Connector to append step */}
                    {renderConnector('FALSE', steps[1].falseBranch?.length || 0)}

                    {/* Terminal End of Branch */}
                    <div className="flex flex-col items-center">
                      <div className="px-3 py-1 rounded-full bg-slate-100 border border-slate-200/80 text-slate-500 text-[11px] font-semibold flex items-center gap-1.5 shadow-2xs">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                        <span>End of Branch</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ─── CONTEXTUAL INSERT POPOVER MENU ────────────────────────────── */}
          {insertPopover && (
            <div
              style={{
                position: 'fixed',
                left: '50%',
                top: `${insertPopover.anchorY}px`,
                transform: 'translateX(-50%)',
              }}
              className="w-56 bg-white border border-slate-200 rounded-2xl shadow-xl p-1.5 z-50 space-y-1 animate-in fade-in zoom-in-95 duration-150"
            >
              <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                Insert Step
              </div>
              <button
                type="button"
                onClick={() => handleInsertStep('ACTION')}
                className="w-full px-2.5 py-2 rounded-xl text-left text-xs font-semibold text-slate-700 hover:bg-emerald-50 hover:text-emerald-700 flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <span className="p-1 rounded-md bg-emerald-100 text-emerald-700">
                  <Send size={13} />
                </span>
                <div>
                  <div className="font-bold">Send Notification</div>
                  <div className="text-[10px] text-slate-400 font-normal">Push, In-App, Email</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleInsertStep('CONDITION')}
                className="w-full px-2.5 py-2 rounded-xl text-left text-xs font-semibold text-slate-700 hover:bg-indigo-50 hover:text-indigo-700 flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <span className="p-1 rounded-md bg-indigo-100 text-indigo-700">
                  <GitBranch size={13} />
                </span>
                <div>
                  <div className="font-bold">Condition (IF / ELSE)</div>
                  <div className="text-[10px] text-slate-400 font-normal">Score & attribute filters</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => handleInsertStep('DELAY')}
                className="w-full px-2.5 py-2 rounded-xl text-left text-xs font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-800 flex items-center gap-2.5 transition-colors cursor-pointer"
              >
                <span className="p-1 rounded-md bg-slate-200 text-slate-700">
                  <Clock size={13} />
                </span>
                <div>
                  <div className="font-bold">Delay / Cooldown</div>
                  <div className="text-[10px] text-slate-400 font-normal">Pacing & quiet hours</div>
                </div>
              </button>
            </div>
          )}

          {/* ─── RIGHT SLIDE-OVER INSPECTOR PANEL (CLEAN WHITE) ────────────── */}
          {isInspectorOpen && selectedStep && (
            <aside className="w-80 lg:w-96 bg-white border-l border-slate-200/90 flex flex-col shrink-0 z-20 shadow-xl animate-in slide-in-from-right duration-200">
              {/* Header */}
              <div className="p-4 border-b border-slate-200/90 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sliders size={15} className="text-indigo-600" />
                  <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">Configure Step</span>
                </div>
                <button
                  type="button"
                  onClick={() => setIsInspectorOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 cursor-pointer transition-colors"
                >
                  <X size={15} />
                </button>
              </div>

              {/* Inspector Form */}
              <div className="flex-1 overflow-y-auto p-5 space-y-5 text-xs">
                {/* Step Title Input */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">Step Title</label>
                  <input
                    type="text"
                    value={selectedStep.title}
                    onChange={(e) => {
                      const val = e.target.value;
                      setSteps((prev) => updateStepById(prev, selectedStep.id, (s) => ({ ...s, title: val })));
                      setHasUnsavedChanges(true);
                    }}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-xs font-bold focus:bg-white focus:border-indigo-500 outline-none transition-colors"
                  />
                </div>

                {/* 1. TRIGGER INSPECTOR */}
                {selectedStep.type === 'TRIGGER' && (
                  <div className="space-y-3 pt-1">
                    <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                      Lifecycle Event Trigger
                    </label>
                    <select
                      value={wTrigger}
                      onChange={(e) => {
                        setWTrigger(e.target.value);
                        setHasUnsavedChanges(true);
                      }}
                      className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-xs font-semibold focus:border-indigo-500 outline-none"
                    >
                      {LIFECYCLE_TRIGGERS.map((t) => (
                        <option key={t.key} value={t.key}>
                          {t.label}
                        </option>
                      ))}
                    </select>

                    <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                      <div className="text-[11px] font-bold text-amber-700 flex items-center gap-1.5">
                        <Zap size={13} />
                        <span>Event Contract Schema</span>
                      </div>
                      <div className="text-[11px] text-slate-500 leading-relaxed">{selectedTriggerObj.description}</div>
                      <div className="pt-2 flex flex-wrap gap-1.5">
                        {['score', 'module_name', 'user_id', 'passing_score'].map((k) => (
                          <span
                            key={k}
                            className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-white text-slate-700 border border-slate-200 shadow-2xs"
                          >
                            {k}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* 2. ACTION INSPECTOR (STRICT CATALOG BINDING & PHONE PREVIEW) */}
                {selectedStep.type === 'ACTION' && (
                  <div className="space-y-4 pt-1">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                        Approved Template Catalog
                      </label>
                      <select
                        value={selectedStep.templateId || ''}
                        onChange={(e) => {
                          const tplId = e.target.value;
                          const tpl = availableTemplates.find((t) => t.id === tplId);
                          if (tpl) {
                            setSteps((prev) =>
                              updateStepById(prev, selectedStep.id, (s) => ({
                                ...s,
                                templateId: tpl.id,
                                templateName: tpl.name,
                                titleTemplate: tpl.title_template || tpl.name,
                                bodyTemplate: tpl.body_template || '',
                                channels: [tpl.channel],
                              }))
                            );
                            setHasUnsavedChanges(true);
                          }
                        }}
                        className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-xs font-semibold focus:border-indigo-500 outline-none"
                      >
                        {availableTemplates.map((tpl) => (
                          <option key={tpl.id} value={tpl.id}>
                            {tpl.name} ({tpl.channel})
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Delivery Channels Multi-select */}
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                        Delivery Channels
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        {['PUSH', 'IN_APP', 'EMAIL', 'WHATSAPP'].map((ch) => {
                          const active = (selectedStep.channels || []).includes(ch);
                          return (
                            <button
                              key={ch}
                              type="button"
                              onClick={() => {
                                const nextCh = active
                                  ? (selectedStep.channels || []).filter((c) => c !== ch)
                                  : [...(selectedStep.channels || []), ch];
                                setSteps((prev) =>
                                  updateStepById(prev, selectedStep.id, (s) => ({ ...s, channels: nextCh }))
                                );
                                setHasUnsavedChanges(true);
                              }}
                              className={`p-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center justify-between ${
                                active
                                  ? 'bg-indigo-50 border-indigo-300 text-indigo-700 shadow-2xs'
                                  : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                              }`}
                            >
                              <span>{ch}</span>
                              {active && <Check size={13} className="text-indigo-600" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Live Mobile Smartphone Preview */}
                    <div className="space-y-2 pt-2">
                      <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider flex items-center gap-1.5">
                        <Smartphone size={13} className="text-indigo-600" />
                        <span>Learner Device Preview</span>
                      </label>
                      <div className="p-4 rounded-3xl bg-slate-900 border border-slate-800 text-white shadow-lg flex flex-col space-y-2.5">
                        <div className="flex items-center justify-between text-[10px] text-slate-400 pb-1 border-b border-slate-800 font-mono">
                          <span>09:41 AM</span>
                          <span>5G • 100%</span>
                        </div>
                        <div className="p-3 rounded-2xl bg-slate-800/95 border border-slate-700/80 space-y-1.5 shadow-md">
                          <div className="flex items-center gap-1.5 text-[10px] font-bold text-indigo-400">
                            <Zap size={11} />
                            <span>Lucid Learning</span>
                          </div>
                          <div className="text-xs font-bold text-white">{selectedStep.titleTemplate}</div>
                          <div className="text-[11px] text-slate-300 leading-relaxed">{selectedStep.bodyTemplate}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 3. CONDITION RULES INSPECTOR */}
                {selectedStep.type === 'CONDITION' && (
                  <div className="space-y-3 pt-1">
                    <div className="flex items-center justify-between">
                      <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                        Evaluation Rules
                      </label>
                      <select
                        value={selectedStep.conditionMatch || 'ALL'}
                        onChange={(e) => {
                          const val = e.target.value as 'ALL' | 'ANY';
                          setSteps((prev) =>
                            updateStepById(prev, selectedStep.id, (s) => ({ ...s, conditionMatch: val }))
                          );
                          setHasUnsavedChanges(true);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-slate-800 text-[11px] font-bold"
                      >
                        <option value="ALL">Match ALL</option>
                        <option value="ANY">Match ANY</option>
                      </select>
                    </div>

                    <div className="space-y-2.5">
                      {selectedStep.rules?.map((rule) => (
                        <div
                          key={rule.id}
                          className="p-3 rounded-xl bg-slate-50 border border-slate-200 space-y-2"
                        >
                          <div className="flex items-center gap-2">
                            <select
                              value={rule.field}
                              onChange={(e) => {
                                const val = e.target.value;
                                setSteps((prev) =>
                                  updateStepById(prev, selectedStep.id, (s) => ({
                                    ...s,
                                    rules: s.rules?.map((r) => (r.id === rule.id ? { ...r, field: val } : r)),
                                  }))
                                );
                                setHasUnsavedChanges(true);
                              }}
                              className="flex-1 px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-xs"
                            >
                              {AVAILABLE_FIELDS.map((f) => (
                                <option key={f.value} value={f.value}>
                                  {f.label}
                                </option>
                              ))}
                            </select>

                            <select
                              value={rule.operator}
                              onChange={(e) => {
                                const val = e.target.value;
                                setSteps((prev) =>
                                  updateStepById(prev, selectedStep.id, (s) => ({
                                    ...s,
                                    rules: s.rules?.map((r) => (r.id === rule.id ? { ...r, operator: val } : r)),
                                  }))
                                );
                                setHasUnsavedChanges(true);
                              }}
                              className="w-16 px-2 py-1.5 rounded-lg bg-white border border-slate-200 text-indigo-600 font-mono text-xs font-bold"
                            >
                              <option value="<">&lt;</option>
                              <option value="<=">&le;</option>
                              <option value="==">==</option>
                              <option value="!=">!=</option>
                              <option value=">=">&ge;</option>
                              <option value=">">&gt;</option>
                            </select>

                            <input
                              type="text"
                              value={rule.value}
                              onChange={(e) => {
                                const val = e.target.value;
                                setSteps((prev) =>
                                  updateStepById(prev, selectedStep.id, (s) => ({
                                    ...s,
                                    rules: s.rules?.map((r) => (r.id === rule.id ? { ...r, value: val } : r)),
                                  }))
                                );
                                setHasUnsavedChanges(true);
                              }}
                              className="w-16 px-2 py-1.5 rounded-lg bg-white border border-slate-200 text-slate-900 text-xs font-mono font-semibold"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* 4. DELAY INSPECTOR */}
                {selectedStep.type === 'DELAY' && (
                  <div className="space-y-3 pt-1">
                    <label className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                      Cooldown Duration (Hours)
                    </label>
                    <input
                      type="range"
                      min={1}
                      max={72}
                      step={1}
                      value={Math.round((selectedStep.cooldownSeconds || 3600) / 3600)}
                      onChange={(e) => {
                        const hours = parseInt(e.target.value);
                        setSteps((prev) =>
                          updateStepById(prev, selectedStep.id, (s) => ({ ...s, cooldownSeconds: hours * 3600 }))
                        );
                        setHasUnsavedChanges(true);
                      }}
                      className="w-full accent-indigo-600 cursor-pointer"
                    />
                    <div className="text-right text-xs font-mono font-bold text-slate-700">
                      {Math.round((selectedStep.cooldownSeconds || 3600) / 3600)} Hours Cooldown
                    </div>
                  </div>
                )}
              </div>
            </aside>
          )}

          {/* ─── SLIDE-UP DRY RUN SIMULATION TERMINAL DRAWER ──────────────── */}
          {isSimulatorOpen && (
            <div className="absolute bottom-0 inset-x-0 h-64 bg-white border-t border-slate-200 shadow-2xl flex flex-col z-30 animate-in slide-in-from-bottom duration-200">
              <div className="h-10 px-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2">
                  <Play size={13} className="text-emerald-600 fill-emerald-600" />
                  <span className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                    Pipeline Execution Simulator
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  {/* Persona Selector */}
                  <div className="flex items-center p-0.5 rounded-lg bg-slate-200/80 border border-slate-300">
                    {[
                      { id: 'alex', label: 'Alex (Score 68% - Remediation)' },
                      { id: 'jordan', label: 'Jordan (Score 84% - Passed)' },
                    ].map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setSimPersona(p.id as any)}
                        className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer ${
                          simPersona === p.id
                            ? 'bg-indigo-600 text-white shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  {/* Run Button */}
                  <button
                    type="button"
                    onClick={handleStartSimulation}
                    disabled={isSimRunning}
                    className="px-3.5 py-1 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-2xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Play size={11} className="fill-white" />
                    <span>{isSimRunning ? 'Executing...' : 'Run Simulation'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsSimulatorOpen(false);
                      setActiveLitSteps([]);
                      setActiveLitBranch(null);
                    }}
                    className="p-1 rounded text-slate-400 hover:text-slate-800 cursor-pointer"
                  >
                    <X size={15} />
                  </button>
                </div>
              </div>

              {/* Log Output Console */}
              <div className="flex-1 p-4 overflow-y-auto font-mono text-[11px] space-y-1.5 bg-slate-950 text-emerald-400">
                {simLogs.length === 0 ? (
                  <div className="text-slate-500 italic">
                    Select a learner test persona above and click &quot;Run Simulation&quot; to test path traversal and
                    lighting on the pipeline.
                  </div>
                ) : (
                  simLogs.map((log, idx) => (
                    <div key={idx} className="leading-relaxed">
                      {log}
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ─────────────────────────────────────────────────────────────────────
            ENTERPRISE GOVERNANCE SETTINGS VIEW (5 PILLARS)
           ───────────────────────────────────────────────────────────────────── */
        <div className="flex-1 overflow-y-auto p-6 md:p-10 max-w-5xl mx-auto w-full space-y-6">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Workflow Governance & Execution Policy</h2>
            <p className="text-xs text-slate-500 mt-1">
              Configure enterprise guardrails, quiet hours, delivery precedence, and fatigue limits for this automation.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Card 1: Audience & Enrollment */}
            <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs space-y-3">
              <div className="flex items-center gap-2">
                <Users size={16} className="text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900">Audience & Enrollment Criteria</h3>
              </div>
              <p className="text-xs text-slate-500">
                Defines which learners can be enrolled when lifecycle trigger events occur.
              </p>
              <select
                value={audienceSegment}
                onChange={(e) => setAudienceSegment(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-xs font-semibold"
              >
                <option value="ALL_ACTIVE">All Active Learners</option>
                <option value="TRIAL_USERS">Trial & Onboarding Users</option>
                <option value="ENTERPRISE_TEAMS">Enterprise & Corporate Teams</option>
                <option value="CHURN_RISK">At-Risk Learners (Streak &lt; 2)</option>
              </select>
            </div>

            {/* Card 2: Fatigue & Frequency Capping */}
            <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs space-y-3">
              <div className="flex items-center gap-2">
                <Gauge size={16} className="text-amber-600" />
                <h3 className="text-sm font-bold text-slate-900">Fatigue & Frequency Capping</h3>
              </div>
              <p className="text-xs text-slate-500">
                Max notifications a learner can receive across all workflows in 24 hours.
              </p>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-500">Max Per 24h:</span>
                <span className="font-bold text-amber-700 font-mono">{fatigueMaxPerDay} notifications</span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                value={fatigueMaxPerDay}
                onChange={(e) => setFatigueMaxPerDay(parseInt(e.target.value))}
                className="w-full accent-amber-600 cursor-pointer"
              />
            </div>

            {/* Card 3: Quiet Hours & Local Timezone */}
            <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs space-y-3">
              <div className="flex items-center gap-2">
                <Moon size={16} className="text-purple-600" />
                <h3 className="text-sm font-bold text-slate-900">Quiet Hours & Local Timezone</h3>
              </div>
              <p className="text-xs text-slate-500">
                Delays nudges until the learner&apos;s morning if triggered during quiet windows.
              </p>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-500 text-[10px]">Quiet Window Start:</span>
                  <input
                    type="time"
                    value={quietStart}
                    onChange={(e) => setQuietStart(e.target.value)}
                    className="w-full mt-1 px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900"
                  />
                </div>
                <div>
                  <span className="text-slate-500 text-[10px]">Quiet Window End:</span>
                  <input
                    type="time"
                    value={quietEnd}
                    onChange={(e) => setQuietEnd(e.target.value)}
                    className="w-full mt-1 px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-slate-900"
                  />
                </div>
              </div>
            </div>

            {/* Card 4: Queue Precedence & Delivery Mode */}
            <div className="p-5 rounded-2xl bg-white border border-slate-200/90 shadow-2xs space-y-3">
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-emerald-600" />
                <h3 className="text-sm font-bold text-slate-900">Queue Precedence & Delivery Mode</h3>
              </div>
              <p className="text-xs text-slate-500">
                Controls Redis dispatch queue priority and channel fallback policies.
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setWPriority(p)}
                    className={`py-1.5 px-3 rounded-lg text-xs font-bold border transition-all cursor-pointer ${
                      wPriority === p
                        ? 'bg-indigo-50 border-indigo-300 text-indigo-700'
                        : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────
          SCREEN 2: GUIDED 3-STEP WORKFLOW SETUP WIZARD MODAL
         ───────────────────────────────────────────────────────────────────── */}
      {isWizardOpen && (
        <div className="fixed inset-0 z-[70] bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white rounded-3xl border border-slate-200 shadow-2xl p-6 sm:p-8 space-y-6 animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Create New Notification Workflow</h3>
                <p className="text-xs text-slate-500 mt-0.5">Define your trigger and decision logic in 3 quick steps</p>
              </div>
              <button
                type="button"
                onClick={() => setIsWizardOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
              >
                <X size={16} />
              </button>
            </div>

            {/* Step Progress Bar */}
            <div className="flex items-center justify-between border-b border-slate-100 pb-4 text-xs font-semibold">
              <div className={`flex items-center gap-2 ${wizardStep === 1 ? 'text-indigo-600 font-bold' : 'text-slate-400'}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${wizardStep === 1 ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>1</span>
                <span>Select Trigger</span>
              </div>
              <div className="w-8 h-px bg-slate-200" />
              <div className={`flex items-center gap-2 ${wizardStep === 2 ? 'text-indigo-600 font-bold' : 'text-slate-400'}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${wizardStep === 2 ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>2</span>
                <span>Define Rules</span>
              </div>
              <div className="w-8 h-px bg-slate-200" />
              <div className={`flex items-center gap-2 ${wizardStep === 3 ? 'text-indigo-600 font-bold' : 'text-slate-400'}`}>
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] ${wizardStep === 3 ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-500'}`}>3</span>
                <span>Actions & Channels</span>
              </div>
            </div>

            {/* Step 1: Trigger & Name */}
            {wizardStep === 1 && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Workflow Name</label>
                  <input
                    type="text"
                    value={wizardName}
                    onChange={(e) => setWizardName(e.target.value)}
                    placeholder="e.g. Adaptive Weak-Spot Remediation"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-xs font-semibold focus:bg-white focus:border-indigo-500 outline-none"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Event Trigger Selection</label>
                  <div className="grid grid-cols-1 gap-2.5">
                    {[
                      {
                        key: 'ASSESSMENT_SUBMITTED',
                        title: 'Quiz & Assessment Completed',
                        desc: 'Fires instantly when a learner submits any quiz, exam, or drill',
                        payload: 'score, user_id, module_name',
                        icon: Zap,
                        badgeColor: 'bg-amber-50 text-amber-600 border-amber-200',
                      },
                      {
                        key: 'LEARNER_INACTIVE_3D',
                        title: 'Learner Inactivity (3 Days)',
                        desc: 'Fires when a learner has not practiced or logged in for 72 hours',
                        payload: 'days_inactive, user_id, streak_days',
                        icon: Clock,
                        badgeColor: 'bg-indigo-50 text-indigo-600 border-indigo-200',
                      },
                      {
                        key: 'COURSE_MILESTONE_PASSED',
                        title: 'Course Milestone Passed',
                        desc: 'Fires when a learner masters a full sprint track or level',
                        payload: 'module_name, user_id, earned_xp',
                        icon: CheckCircle2,
                        badgeColor: 'bg-emerald-50 text-emerald-600 border-emerald-200',
                      },
                    ].map((t) => {
                      const isSel = wizardTrigger === t.key;
                      const Icon = t.icon;
                      return (
                        <div
                          key={t.key}
                          onClick={() => setWizardTrigger(t.key)}
                          className={`p-3.5 rounded-2xl border transition-all cursor-pointer flex items-start gap-3 ${
                            isSel
                              ? 'bg-indigo-50/50 border-indigo-600 ring-2 ring-indigo-500/15 shadow-2xs'
                              : 'bg-white border-slate-200 hover:border-slate-300'
                          }`}
                        >
                          <div className={`p-2 rounded-xl border ${t.badgeColor} shrink-0 mt-0.5`}>
                            <Icon size={14} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                              <h4 className="text-xs font-bold text-slate-900">{t.title}</h4>
                              <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${isSel ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-300'}`}>
                                {isSel && <Check size={10} />}
                              </div>
                            </div>
                            <p className="text-[11px] text-slate-500 mt-0.5">{t.desc}</p>
                            <span className="inline-block mt-2 font-mono text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md">
                              Payload: {t.payload}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setIsWizardOpen(false)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    Skip to Canvas
                  </button>
                  <button
                    type="button"
                    onClick={() => setWizardStep(2)}
                    className="px-5 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xs transition-all cursor-pointer"
                  >
                    Next: Define Rules →
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Evaluation Rules */}
            {wizardStep === 2 && (
              <div className="space-y-4">
                <div>
                  <h4 className="text-xs font-bold text-slate-900">Define Evaluation Threshold</h4>
                  <p className="text-xs text-slate-500 mt-0.5">Splits the workflow path into Remediation vs Passed celebration branches</p>
                </div>

                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono font-bold text-slate-700">learner.score</span>
                    <span className="text-xs font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-2.5 py-1 rounded-lg">&lt;</span>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={wizardThreshold}
                        onChange={(e) => setWizardThreshold(e.target.value)}
                        className="w-16 px-2.5 py-1 rounded-lg bg-white border border-slate-200 text-xs font-bold text-slate-900 font-mono text-center outline-none focus:border-indigo-500"
                      />
                      <span className="text-xs font-bold text-slate-500">%</span>
                    </div>
                  </div>

                  <div className="pt-2 border-t border-slate-200/80 space-y-1 text-[11px] text-slate-600">
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      <span><strong>IF TRUE (&lt; {wizardThreshold}%):</strong> Routes to Adaptive Remediation Nudge</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-slate-400" />
                      <span><strong>IF FALSE (&ge; {wizardThreshold}%):</strong> Routes to Quiz Passed Celebration Milestone</span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setWizardStep(1)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    ← Back
                  </button>
                  <button
                    type="button"
                    onClick={() => setWizardStep(3)}
                    className="px-5 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xs transition-all cursor-pointer"
                  >
                    Next: Actions & Channels →
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Template & Channels */}
            {wizardStep === 3 && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Approved Notification Template</label>
                  <select
                    value={wizardTemplateId}
                    onChange={(e) => setWizardTemplateId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-slate-900 text-xs font-semibold outline-none"
                  >
                    {availableTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.channel})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-slate-700 uppercase tracking-wider">Delivery Channels</label>
                  <div className="grid grid-cols-2 gap-2">
                    {['PUSH', 'IN_APP', 'EMAIL', 'WHATSAPP'].map((ch) => {
                      const active = wizardChannels.includes(ch);
                      return (
                        <button
                          key={ch}
                          type="button"
                          onClick={() => {
                            setWizardChannels((prev) =>
                              active ? prev.filter((c) => c !== ch) : [...prev, ch]
                            );
                          }}
                          className={`p-2.5 rounded-xl text-xs font-bold border transition-all cursor-pointer flex items-center justify-between ${
                            active
                              ? 'bg-indigo-50 border-indigo-300 text-indigo-700 shadow-2xs'
                              : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                          }`}
                        >
                          <span>{ch}</span>
                          {active && <Check size={13} className="text-indigo-600" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => setWizardStep(2)}
                    className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    ← Back
                  </button>
                  <button
                    type="button"
                    onClick={handleCompileWizard}
                    className="px-5 py-2.5 rounded-xl text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-2xs transition-all cursor-pointer flex items-center gap-1.5"
                  >
                    <Sparkles size={13} />
                    <span>Generate Workflow Pipeline</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
