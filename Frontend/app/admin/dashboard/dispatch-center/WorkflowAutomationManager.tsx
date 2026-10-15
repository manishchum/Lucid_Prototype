'use client';

import React, { useState, useEffect } from 'react';
import {
  Zap,
  Plus,
  Search,
  Filter,
  CheckCircle2,
  Clock,
  Trash2,
  Edit3,
  Sliders,
  Bell,
  Smartphone,
  Mail,
  ArrowRight,
  ArrowLeft,
  ChevronRight,
  Sparkles,
  HelpCircle,
  AlertCircle,
  Copy,
  Check,
  RefreshCw,
  Eye,
  Layers,
  GraduationCap,
  Flame,
  BookOpen,
  Award,
  ShieldCheck,
  Radio,
  X,
  FileText,
  AlertTriangle,
  ShieldAlert,
  Unlink,
  ExternalLink,
  MessageSquare,
  CheckCircle,
} from 'lucide-react';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import { WorkflowCanvasBuilder } from './WorkflowCanvasBuilder';

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

export interface NotificationWorkflow {
  id: string;
  title: string;
  description?: string;
  trigger_lifecycle: string;
  category: string;
  filter_rules: Array<{ field: string; operator: string; value: any }>;
  filter_match_type: 'ALL' | 'ANY';
  notification_type: string;
  channels: string[];
  delivery_policy?: 'PARALLEL' | 'ORDERED_FALLBACK';
  version_number?: number;
  pinned_template_id?: string;
  pinned_template_version_id?: string;
  title_template: string;
  body_template: string;
  cooldown_seconds: number;
  priority: string;
  is_active: boolean;
  execution_count: number;
  last_triggered_at?: string;
  created_at: string;
}

interface WorkflowManagerProps {
  onInsertTag?: (tag: string) => void;
}

export const LIFECYCLE_TRIGGERS = [
  // ─── ASSESSMENT & SIMULATIONS ──────────────────────────────────────────
  {
    key: 'ASSESSMENT_COMPLETED',
    category: 'ASSESSMENT',
    label: 'Quiz & Assessment Completed',
    description: 'Fires instantly when a learner submits any quiz, checkpoint, or exam.',
    icon: GraduationCap,
    badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    defaultTitle: '{{#if is_auditory}}🎧 Audio Recap: {{module_name}}{{else}}Review: {{module_name}}{{/if}}',
    defaultBody: 'Hi {{first_name}}, you scored {{score}}% on {{module_name}}. We noticed {{weak_topic}} could use a quick boost.',
  },
  {
    key: 'QUIZ_PASSED',
    category: 'ASSESSMENT',
    label: 'Quiz Passed Milestone',
    description: 'Sent immediately when a learner completes a quiz above the passing score.',
    icon: CheckCircle2,
    badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    defaultTitle: '🎉 Fantastic job on {{module_name}}!',
    defaultBody: 'Congratulations {{first_name}}! You passed with {{score}}% and earned +{{earned_xp}} XP.',
  },
  {
    key: 'QUIZ_FAILED',
    category: 'ASSESSMENT',
    label: 'Quiz Retry & Remediation',
    description: 'Supportive nudge with targeted review when score falls below threshold.',
    icon: AlertCircle,
    badgeColor: 'bg-rose-50 text-rose-700 border-rose-200',
    defaultTitle: '💪 Let’s master {{module_name}} together',
    defaultBody: 'Hi {{first_name}}, you scored {{score}}%. Review {{weak_topic}} and give it another shot!',
  },
  {
    key: 'ROLEPLAY_REPORT_READY',
    category: 'ASSESSMENT',
    label: 'AI Roleplay Evaluation Ready',
    description: 'Fires when audio/text simulation analysis and coaching feedback are compiled.',
    icon: Sparkles,
    badgeColor: 'bg-purple-50 text-purple-700 border-purple-200',
    defaultTitle: '🎙️ Your AI Roleplay Evaluation is ready!',
    defaultBody: 'Hi {{first_name}}, your scenario simulation has been graded. Review your coach feedback and insights.',
  },
  {
    key: 'POST_COMPLETION_FEEDBACK',
    category: 'ASSESSMENT',
    label: 'Post-Completion Survey Prompt',
    description: 'Prompts learner for 1-click feedback and rating immediately upon finishing a module.',
    icon: MessageSquare,
    badgeColor: 'bg-sky-50 text-sky-700 border-sky-200',
    defaultTitle: 'How was {{module_name}}?',
    defaultBody: 'Hi {{first_name}}, share your feedback on this sprint in 1 click to help us improve your learning path.',
  },

  // ─── CURRICULUM & DEADLINES ───────────────────────────────────────────
  {
    key: 'MODULE_PROGRESS_UPDATED',
    category: 'CURRICULUM',
    label: 'Curriculum Pacing & Progress',
    description: 'Fires as learners progress through course checkpoints or reach milestones.',
    icon: BookOpen,
    badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    defaultTitle: '🚀 Milestone reached: {{module_name}}',
    defaultBody: 'You are now {{progress_percentage}}% through! Only {{minutes_remaining}} minutes remaining to finish this sprint.',
  },
  {
    key: 'MODULE_ASSIGNED',
    category: 'CURRICULUM',
    label: 'New Sprint / Module Assigned',
    description: 'Fires when manager or admin assigns a new learning module or track.',
    icon: Layers,
    badgeColor: 'bg-blue-50 text-blue-700 border-blue-200',
    defaultTitle: '📚 New Sprint Assigned: {{module_name}}',
    defaultBody: 'Hi {{first_name}}, your manager has assigned {{module_name}}. Target completion: {{due_date}}.',
  },
  {
    key: 'MODULE_DUE_REMINDER',
    category: 'CURRICULUM',
    label: 'Approaching Deadline Alert',
    description: 'Automated nudge dispatched 48h / 24h prior to sprint deadline.',
    icon: Clock,
    badgeColor: 'bg-amber-50 text-amber-700 border-amber-200',
    defaultTitle: '⏳ {{days_left}} days left for {{module_name}}',
    defaultBody: 'Hi {{first_name}}, your sprint deadline is approaching on {{due_date}}. Jump back in to stay on schedule.',
  },
  {
    key: 'MODULE_OVERDUE',
    category: 'CURRICULUM',
    label: 'Module Overdue Escalation',
    description: 'Escalation notice when a module passes its deadline without completion.',
    icon: AlertTriangle,
    badgeColor: 'bg-rose-50 text-rose-700 border-rose-200',
    defaultTitle: '⚠️ Overdue Notice: {{module_name}}',
    defaultBody: 'Hi {{first_name}}, {{module_name}} was due on {{due_date}}. Please complete it to maintain team compliance.',
  },
  {
    key: 'COURSE_COMPLETED',
    category: 'CURRICULUM',
    label: 'Course / Track Finished',
    description: 'Celebrates 100% completion of an entire sprint track or learning curriculum.',
    icon: Award,
    badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    defaultTitle: '🏆 Track Completed: Congratulations {{first_name}}!',
    defaultBody: 'You completed the entire learning path! Your certificate is now available in your achievements.',
  },

  // ─── GAMIFICATION & ARENA ─────────────────────────────────────────────
  {
    key: 'DAILY_STREAK_CHECK',
    category: 'GAMIFICATION',
    label: 'Daily Streak Rescue Check',
    description: 'Scans for learners with active streaks who have not practiced today.',
    icon: Flame,
    badgeColor: 'bg-amber-50 text-amber-700 border-amber-200',
    defaultTitle: '🔥 Keep your {{streak_days}}-day streak alive!',
    defaultBody: '{{first_name}}, you are only {{points_to_next_rank}} XP behind {{rival_name}}! Complete 1 quick drill before midnight.',
  },
  {
    key: 'STREAK_MILESTONE',
    category: 'GAMIFICATION',
    label: 'Streak Milestone Achieved',
    description: 'Celebrates 3-day, 7-day, 14-day, 30-day continuous streaks.',
    icon: Flame,
    badgeColor: 'bg-orange-50 text-orange-700 border-orange-200',
    defaultTitle: '🔥 Unstoppable! {{streak_days}}-day streak achieved!',
    defaultBody: 'Incredible consistency, {{first_name}}! You earned a bonus +{{earned_xp}} XP for your streak milestone.',
  },
  {
    key: 'DRILL_COMPLETED',
    category: 'GAMIFICATION',
    label: 'Gamified Arena Drill Finished',
    description: 'Fires upon completion of interactive flashcard, speed, or arena drills.',
    icon: Zap,
    badgeColor: 'bg-purple-50 text-purple-700 border-purple-200',
    defaultTitle: '⚡ Drill Complete! +{{earned_xp}} XP',
    defaultBody: 'Great work {{first_name}}! Check the leaderboard to see your new rank.',
  },
  {
    key: 'BADGE_UNLOCKED',
    category: 'GAMIFICATION',
    label: 'Achievement Badge Unlocked',
    description: 'Celebrates unlocking an achievement badge or skill certification.',
    icon: Award,
    badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    defaultTitle: '🎖️ New Badge Unlocked: {{badge_name}}!',
    defaultBody: 'Outstanding achievement {{first_name}}! You earned the "{{badge_name}}" badge. View it in your showcase.',
  },
  {
    key: 'LEADERBOARD_ALERT',
    category: 'GAMIFICATION',
    label: 'Leaderboard Rank Shift Alert',
    description: 'Notifies learner when they climb ranks or get overtaken by a colleague.',
    icon: Radio,
    badgeColor: 'bg-blue-50 text-blue-700 border-blue-200',
    defaultTitle: '⚔️ Leaderboard Shift: {{rival_name}} is catching up!',
    defaultBody: 'Hi {{first_name}}, {{rival_name}} is only {{points_to_next_rank}} XP behind you. Complete a challenge to hold your rank!',
  },

  // ─── WORKPLACE TASKS & ASSIGNMENTS ────────────────────────────────────
  {
    key: 'TASK_ASSIGNED',
    category: 'TASKS',
    label: 'Workplace Task Assigned',
    description: 'Fires when manager assigns a practical workplace assignment (text/audio/file).',
    icon: FileText,
    badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    defaultTitle: '📋 New Task Assigned: {{task_title}}',
    defaultBody: 'Hi {{first_name}}, you have a new practical task assigned. Due date: {{due_date}}. Submit your response when ready.',
  },
  {
    key: 'TASK_SUBMITTED',
    category: 'TASKS',
    label: 'Workplace Task Submitted',
    description: 'Confirmation when an employee submits their practical task response.',
    icon: CheckCircle,
    badgeColor: 'bg-blue-50 text-blue-700 border-blue-200',
    defaultTitle: '✅ Task Submitted: {{task_title}}',
    defaultBody: 'Thank you {{first_name}}! Your submission has been received and is being evaluated by AI.',
  },
  {
    key: 'TASK_EVALUATED',
    category: 'TASKS',
    label: 'Task AI Evaluation Ready',
    description: 'Fires when AI finishes evaluating submission with pass/fail verdict and coaching advice.',
    icon: ShieldCheck,
    badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    defaultTitle: '🎯 Task Evaluation Ready: {{task_title}}',
    defaultBody: 'Hi {{first_name}}, your task submission was evaluated. Score: {{score}}%. Check out your detailed coaching feedback.',
  },
  {
    key: 'TASK_OVERDUE',
    category: 'TASKS',
    label: 'Task Deadline Overdue Notice',
    description: 'Escalation notice when a practical workplace task passes its due date.',
    icon: AlertTriangle,
    badgeColor: 'bg-rose-50 text-rose-700 border-rose-200',
    defaultTitle: '⚠️ Task Overdue: {{task_title}}',
    defaultBody: 'Hi {{first_name}}, your task {{task_title}} was due on {{due_date}}. Please submit your response as soon as possible.',
  },

  // ─── ONBOARDING & COGNITIVE PERSONALIZATION ────────────────────────────
  {
    key: 'USER_WELCOME',
    category: 'ONBOARDING',
    label: 'Learner Welcome & Activation',
    description: 'Welcome onboarding message sent when a new learner account is activated.',
    icon: Sparkles,
    badgeColor: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    defaultTitle: '👋 Welcome to {{company_name}} Learning, {{first_name}}!',
    defaultBody: 'Welcome aboard {{first_name}}! Your personalized learning path is ready. Take your first 3-minute quiz today.',
  },
  {
    key: 'LEARNING_STYLE_DISCOVERED',
    category: 'ONBOARDING',
    label: 'VARK Modality Diagnosed',
    description: 'Fires when employee completes learning style diagnostic, establishing VARK profile.',
    icon: Eye,
    badgeColor: 'bg-purple-50 text-purple-700 border-purple-200',
    defaultTitle: '🧠 Your Learning Style: {{vark.primary_style}} Learner',
    defaultBody: 'Hi {{first_name}}, we personalized your journey for {{vark.primary_style}} learning. Check out your tailored recommendations!',
  },

  // ─── CONTENT & ENGAGEMENT ─────────────────────────────────────────────
  {
    key: 'PODCAST_EPISODE_READY',
    category: 'CONTENT',
    label: 'Personalized Audio Recap Ready',
    description: 'Dispatched when AI synthesizes a personalized sprint podcast or audio recap.',
    icon: Radio,
    badgeColor: 'bg-indigo-50 text-indigo-700 border-indigo-200',
    defaultTitle: '🎧 New Audio Episode Ready: {{module_name}}',
    defaultBody: 'Hi {{first_name}}, your personalized 3-minute audio recap for {{module_name}} is ready to stream!',
  },
  {
    key: 'SCHEDULED_SCAN',
    category: 'ENGAGEMENT',
    label: 'Scheduled Re-Engagement Sweep',
    description: 'Periodic automated sweep for inactive learners or habit re-activation.',
    icon: Clock,
    badgeColor: 'bg-sky-50 text-sky-700 border-sky-200',
    defaultTitle: 'Ready for today’s 3-minute challenge?',
    defaultBody: 'Hi {{first_name}}, jump back in to continue your career journey milestones.',
  },
];

export interface ConditionFieldDefinition {
  value: string;
  label: string;
  type: 'number' | 'string' | 'boolean' | 'enum';
  category: 'Assessment' | 'Curriculum' | 'Gamification' | 'VARK' | 'Tasks' | 'Learner Profile' | 'Channels';
  options?: string[];
  placeholder?: string;
  description: string;
}

export const AVAILABLE_FIELDS: ConditionFieldDefinition[] = [
  // ─── 1. ASSESSMENT & PRACTICE ──────────────────────────────────────────
  { value: 'score', label: 'Quiz Score % (score)', type: 'number', category: 'Assessment', placeholder: 'e.g. 70', description: 'Achieved score on quiz or exam' },
  { value: 'passing_score', label: 'Passing Score % (passing_score)', type: 'number', category: 'Assessment', placeholder: 'e.g. 75', description: 'Passing threshold score required' },
  { value: 'passed', label: 'Quiz Passed Status (passed)', type: 'boolean', category: 'Assessment', description: 'Whether learner achieved passing grade' },
  { value: 'weak_topic', label: 'Weak Spot Topic (weak_topic)', type: 'string', category: 'Assessment', placeholder: 'e.g. Objections, Pricing', description: 'Topic with the lowest competency score' },
  { value: 'feedback_summary', label: 'AI Feedback Summary (feedback_summary)', type: 'string', category: 'Assessment', placeholder: 'e.g. Needs review', description: 'AI evaluation commentary' },
  { value: 'attempt_number', label: 'Quiz Attempt Count (attempt_number)', type: 'number', category: 'Assessment', placeholder: 'e.g. 1', description: 'Number of times quiz was attempted' },
  { value: 'confidence_score', label: 'Fluency Confidence % (confidence_score)', type: 'number', category: 'Assessment', placeholder: 'e.g. 80', description: 'AI speech and fluency conviction score' },
  { value: 'remediation_module', label: 'Remediation Module Title (remediation_module)', type: 'string', category: 'Assessment', placeholder: 'e.g. Objection Refresher', description: 'Recommended practice micro-drill' },
  { value: 'roleplay_passed', label: 'AI Roleplay Passed (roleplay_passed)', type: 'boolean', category: 'Assessment', description: 'Whether learner passed scenario simulation' },

  // ─── 2. CURRICULUM, PACING & DEADLINES ──────────────────────────────────
  { value: 'progress_percentage', label: 'Course Progress % (progress_percentage)', type: 'number', category: 'Curriculum', placeholder: 'e.g. 50', description: 'Percentage completion of active sprint' },
  { value: 'days_left', label: 'Days Until Deadline (days_left)', type: 'number', category: 'Curriculum', placeholder: 'e.g. 2', description: 'Days remaining before assigned due date' },
  { value: 'minutes_remaining', label: 'Estimated Minutes Left (minutes_remaining)', type: 'number', category: 'Curriculum', placeholder: 'e.g. 15', description: 'AI-estimated time to complete current module' },
  { value: 'module_name', label: 'Module Title (module_name)', type: 'string', category: 'Curriculum', placeholder: 'e.g. Strategic Sales', description: 'Title of assigned module or course' },
  { value: 'module_type', label: 'Module Format (module_type)', type: 'enum', category: 'Curriculum', options: ['sprint', 'roleplay', 'quiz', 'compliance', 'onboarding'], description: 'Type or format of module' },
  { value: 'is_overdue', label: 'Module Overdue Status (is_overdue)', type: 'boolean', category: 'Curriculum', description: 'True if current date exceeds assigned deadline' },
  { value: 'completed', label: 'Track 100% Completed (completed)', type: 'boolean', category: 'Curriculum', description: 'True if entire curriculum track is finished' },

  // ─── 3. GAMIFICATION & SOCIAL ARENA ─────────────────────────────────────
  { value: 'streak_days', label: 'Current Streak Days (streak_days)', type: 'number', category: 'Gamification', placeholder: 'e.g. 7', description: 'Consecutive active learning days' },
  { value: 'streak_expiring_hours', label: 'Streak Expiry Hours Left (streak_expiring_hours)', type: 'number', category: 'Gamification', placeholder: 'e.g. 4', description: 'Hours before daily streak resets at midnight UTC' },
  { value: 'xp_points', label: 'Total Accumulated XP (xp_points)', type: 'number', category: 'Gamification', placeholder: 'e.g. 1200', description: 'Lifetime XP points earned' },
  { value: 'earned_xp', label: 'XP Points Earned in Event (earned_xp)', type: 'number', category: 'Gamification', placeholder: 'e.g. 50', description: 'XP points awarded for latest activity' },
  { value: 'leaderboard_rank', label: 'Leaderboard Rank (leaderboard_rank)', type: 'number', category: 'Gamification', placeholder: 'e.g. 3', description: 'Current standing on company leaderboard' },
  { value: 'points_to_next_rank', label: 'XP to Overtake Rival (points_to_next_rank)', type: 'number', category: 'Gamification', placeholder: 'e.g. 40', description: 'Points required to overtake colleague ahead' },
  { value: 'rival_name', label: 'Leaderboard Rival Name (rival_name)', type: 'string', category: 'Gamification', placeholder: 'e.g. Sarah', description: 'Colleague directly above on the leaderboard' },
  { value: 'badge_name', label: 'Achievement Badge Name (badge_name)', type: 'string', category: 'Gamification', placeholder: 'e.g. Speed Champion', description: 'Title of newly unlocked achievement badge' },
  { value: 'completed_count', label: 'Total Modules Finished Count (completed_count)', type: 'number', category: 'Gamification', placeholder: 'e.g. 5', description: 'Total count of completed modules' },

  // ─── 4. COGNITIVE & VARK LEARNING STYLE ─────────────────────────────────
  { value: 'vark.primary_style', label: 'Primary Learning Style (primary_style)', type: 'enum', category: 'VARK', options: ['Auditory', 'Visual', 'Kinesthetic', 'Reading/Writing'], description: 'Primary cognitive learning modality' },
  { value: 'vark.is_auditory', label: 'Is Auditory Learner (is_auditory)', type: 'boolean', category: 'VARK', description: 'True if learner learns best via audio & podcasts' },
  { value: 'vark.is_visual', label: 'Is Visual Learner (is_visual)', type: 'boolean', category: 'VARK', description: 'True if learner learns best via diagrams & mindmaps' },
  { value: 'vark.is_kinesthetic', label: 'Is Kinesthetic Learner (is_kinesthetic)', type: 'boolean', category: 'VARK', description: 'True if learner learns best via interactive arena drills' },
  { value: 'vark.is_reading_writing', label: 'Is Reading/Writing Learner (is_reading_writing)', type: 'boolean', category: 'VARK', description: 'True if learner learns best via executive summaries' },

  // ─── 5. WORKPLACE TASKS & PRACTICAL ASSIGNMENTS ─────────────────────────
  { value: 'task_title', label: 'Workplace Task Title (task_title)', type: 'string', category: 'Tasks', placeholder: 'e.g. Client Pitch Review', description: 'Title of assigned workplace practical task' },
  { value: 'task_type', label: 'Task Submission Format (task_type)', type: 'enum', category: 'Tasks', options: ['textual', 'audio', 'video', 'file', 'quiz'], description: 'Required submission format' },
  { value: 'task_status', label: 'Task Status (task_status)', type: 'enum', category: 'Tasks', options: ['assigned', 'submitted', 'evaluated', 'overdue'], description: 'Lifecycle status of practical task' },
  { value: 'ai_validation_pass', label: 'Task AI Evaluation Passed (ai_validation_pass)', type: 'boolean', category: 'Tasks', description: 'Whether practical task passed AI evaluation criteria' },
  { value: 'ai_validation_confidence', label: 'Task AI Confidence % (ai_validation_confidence)', type: 'number', category: 'Tasks', placeholder: 'e.g. 85', description: 'Confidence score of AI evaluation' },

  // ─── 6. LEARNER PROFILE & ORGANIZATION ──────────────────────────────────
  { value: 'company_name', label: 'Company / Organization (company_name)', type: 'string', category: 'Learner Profile', placeholder: 'e.g. Acme Corp', description: 'Recipient company name' },
  { value: 'department', label: 'Department / Unit (department)', type: 'string', category: 'Learner Profile', placeholder: 'e.g. Enterprise Sales', description: 'Learner department unit' },
  { value: 'role', label: 'User Account Role (role)', type: 'enum', category: 'Learner Profile', options: ['employee', 'manager', 'admin'], description: 'User platform permission role' },
  { value: 'manager_name', label: 'Reporting Manager Name (manager_name)', type: 'string', category: 'Learner Profile', placeholder: 'e.g. Sarah Connor', description: 'Direct reporting manager' },
  { value: 'email_unsubscribed', label: 'Email Unsubscribed Status (email_unsubscribed)', type: 'boolean', category: 'Learner Profile', description: 'True if learner opted out of marketing emails' },

  // ─── 7. CHANNELS & DELIVERY PREFERENCES ─────────────────────────────────
  { value: 'channel_preference', label: 'Preferred Channel (channel_preference)', type: 'enum', category: 'Channels', options: ['IN_APP', 'PUSH', 'EMAIL', 'WHATSAPP'], description: 'Primary preferred delivery channel' },
  { value: 'in_app_enabled', label: 'In-App Notifications Enabled (in_app_enabled)', type: 'boolean', category: 'Channels', description: 'Whether in-app drawer notifications are active' },
  { value: 'email_enabled', label: 'Email Notifications Enabled (email_enabled)', type: 'boolean', category: 'Channels', description: 'Whether email alerts are active in preferences' },
  { value: 'push_enabled', label: 'Push Notifications Enabled (push_enabled)', type: 'boolean', category: 'Channels', description: 'Whether mobile push alerts are active in preferences' },
];

export const FILTER_RECIPES = [
  {
    label: '🎯 Score < 70% (Remediation)',
    rule: { field: 'score', operator: '<', value: '70' },
  },
  {
    label: '🎧 Auditory Style Only',
    rule: { field: 'vark.primary_style', operator: '==', value: 'Auditory' },
  },
  {
    label: '🔥 Active Streak (>= 7 Days)',
    rule: { field: 'streak_days', operator: '>=', value: '7' },
  },
  {
    label: '⏳ Due in <= 2 Days',
    rule: { field: 'days_left', operator: '<=', value: '2' },
  },
  {
    label: '📋 Task AI Failed',
    rule: { field: 'ai_validation_pass', operator: '==', value: 'false' },
  },
  {
    label: '⚠️ Overdue Modules Only',
    rule: { field: 'is_overdue', operator: '==', value: 'true' },
  },
];

export const OPERATORS_BY_TYPE = {
  number: [
    { value: '<', label: '< Less than' },
    { value: '<=', label: '<= Less or equal' },
    { value: '==', label: '== Equals' },
    { value: '!=', label: '!= Not equal' },
    { value: '>', label: '> Greater than' },
    { value: '>=', label: '>= Greater or equal' },
  ],
  string: [
    { value: '==', label: '== Equals' },
    { value: '!=', label: '!= Not equal' },
    { value: 'contains', label: 'Contains text' },
    { value: 'starts with', label: 'Starts with' },
    { value: 'ends with', label: 'Ends with' },
    { value: 'in', label: 'In list (comma-separated)' },
  ],
  enum: [
    { value: '==', label: '== Is' },
    { value: '!=', label: '!= Is not' },
    { value: 'in', label: 'One of (comma-separated)' },
  ],
  boolean: [
    { value: '==', label: 'Is' },
    { value: '!=', label: 'Is not' },
  ],
};

export interface SmartTagDefinition {
  tag: string;
  label: string;
  desc: string;
  category: 'Learner' | 'Assessment' | 'Curriculum' | 'Gamification' | 'VARK' | 'Tasks' | 'Conditionals' | 'Filters';
  sampleValue: string;
  sourcePath?: string;
  isBlock?: boolean;
}

export const SMART_TAGS: SmartTagDefinition[] = [
  // ─── 1. LEARNER & ORGANIZATION ──────────────────────────────────────────
  {
    tag: '{{first_name}}',
    label: 'First Name',
    desc: "Recipient's given first name",
    category: 'Learner',
    sampleValue: 'Alex',
    sourcePath: 'users.name',
  },
  {
    tag: '{{full_name}}',
    label: 'Full Name',
    desc: "Recipient's complete full name",
    category: 'Learner',
    sampleValue: 'Alex Mercer',
    sourcePath: 'users.name',
  },
  {
    tag: '{{company_name}}',
    label: 'Company Name',
    desc: 'Organization or tenant name',
    category: 'Learner',
    sampleValue: 'Acme Global',
    sourcePath: 'companies.name',
  },
  {
    tag: '{{manager_name}}',
    label: 'Manager Name',
    desc: "Direct reporting manager's name",
    category: 'Learner',
    sampleValue: 'Sarah Connor',
    sourcePath: 'users.manager_id',
  },
  {
    tag: '{{department}}',
    label: 'Department',
    desc: 'Enrolled business unit or department',
    category: 'Learner',
    sampleValue: 'Enterprise Sales',
    sourcePath: 'users.department',
  },
  {
    tag: '{{role}}',
    label: 'Account Role',
    desc: 'Platform account role or title',
    category: 'Learner',
    sampleValue: 'Senior Specialist',
    sourcePath: 'users.role',
  },
  {
    tag: '{{email}}',
    label: 'Corporate Email',
    desc: "Recipient's corporate email address",
    category: 'Learner',
    sampleValue: 'alex.mercer@acmeglobal.com',
    sourcePath: 'users.email',
  },

  // ─── 2. ASSESSMENT & PRACTICE ──────────────────────────────────────────
  {
    tag: '{{score}}',
    label: 'Quiz Score %',
    desc: 'Latest achieved score percentage',
    category: 'Assessment',
    sampleValue: '84%',
    sourcePath: 'quiz_attempts.score',
  },
  {
    tag: '{{passing_score}}',
    label: 'Passing Score %',
    desc: 'Benchmark score required to pass',
    category: 'Assessment',
    sampleValue: '75%',
    sourcePath: 'modules.passing_threshold',
  },
  {
    tag: '{{weak_topic}}',
    label: 'Weak Spot Topic',
    desc: 'Identified competency gap or sub-topic',
    category: 'Assessment',
    sampleValue: 'Pricing Objections',
    sourcePath: 'ai_diagnostics.weak_topic',
  },
  {
    tag: '{{feedback_summary}}',
    label: 'AI Feedback Summary',
    desc: 'Key takeaways from AI coach evaluation',
    category: 'Assessment',
    sampleValue: 'Strong active listening with crisp rebuttals.',
    sourcePath: 'quiz_attempts.feedback',
  },
  {
    tag: '{{remediation_module}}',
    label: 'Remediation Module',
    desc: 'Recommended micro-drill to bridge knowledge gap',
    category: 'Assessment',
    sampleValue: 'Objection Handling Micro-Drill',
    sourcePath: 'recommendations.remediation_module',
  },
  {
    tag: '{{attempt_number}}',
    label: 'Attempt Count',
    desc: 'Number of times assessment was attempted',
    category: 'Assessment',
    sampleValue: '2',
    sourcePath: 'quiz_attempts.attempt_number',
  },
  {
    tag: '{{confidence_score}}',
    label: 'Fluency Confidence %',
    desc: 'AI speech and fluency conviction score',
    category: 'Assessment',
    sampleValue: '88%',
    sourcePath: 'roleplay_submissions.confidence_score',
  },
  {
    tag: '{{passed}}',
    label: 'Assessment Passed Status',
    desc: 'True/false boolean indicating passing grade',
    category: 'Assessment',
    sampleValue: 'true',
    sourcePath: 'quiz_attempts.passed',
  },
  {
    tag: '{{roleplay_passed}}',
    label: 'AI Roleplay Passed',
    desc: 'Whether learner passed scenario simulation',
    category: 'Assessment',
    sampleValue: 'true',
    sourcePath: 'roleplay_submissions.passed',
  },

  // ─── 3. CURRICULUM, PACING & DEADLINES ──────────────────────────────────
  {
    tag: '{{module_name}}',
    label: 'Module Title',
    desc: 'Active sprint, course, or track title',
    category: 'Curriculum',
    sampleValue: 'Negotiation & Objection Handling',
    sourcePath: 'processed_modules.title',
  },
  {
    tag: '{{progress_percentage}}',
    label: 'Progress %',
    desc: 'Track completion percentage (0-100)',
    category: 'Curriculum',
    sampleValue: '75%',
    sourcePath: 'module_progress.progress',
  },
  {
    tag: '{{due_date}}',
    label: 'Due Date',
    desc: 'Assigned completion deadline formatted as date',
    category: 'Curriculum',
    sampleValue: 'Oct 20, 2026',
    sourcePath: 'module_assignments.due_date',
  },
  {
    tag: '{{days_left}}',
    label: 'Days Left',
    desc: 'Days remaining before sprint deadline',
    category: 'Curriculum',
    sampleValue: '2',
    sourcePath: 'calculated.days_left',
  },
  {
    tag: '{{minutes_remaining}}',
    label: 'Minutes Left',
    desc: 'AI-estimated time to complete current module',
    category: 'Curriculum',
    sampleValue: '8',
    sourcePath: 'calculated.minutes_remaining',
  },
  {
    tag: '{{action_url}}',
    label: 'Action Deep-Link URL',
    desc: 'Direct URL to resume or launch module',
    category: 'Curriculum',
    sampleValue: 'https://app.lucid.ai/sprint/42',
    sourcePath: 'calculated.deep_link',
  },
  {
    tag: '{{module_type}}',
    label: 'Module Format',
    desc: 'Sprint, roleplay, quiz, or compliance',
    category: 'Curriculum',
    sampleValue: 'sprint',
    sourcePath: 'modules.type',
  },
  {
    tag: '{{is_overdue}}',
    label: 'Overdue Status Flag',
    desc: 'True if current date passes assigned deadline',
    category: 'Curriculum',
    sampleValue: 'false',
    sourcePath: 'calculated.is_overdue',
  },
  {
    tag: '{{completed}}',
    label: 'Sprint Finished Status',
    desc: 'True if track or sprint is 100% completed',
    category: 'Curriculum',
    sampleValue: 'true',
    sourcePath: 'module_progress.completed',
  },

  // ─── 4. GAMIFICATION & SOCIAL ARENA ─────────────────────────────────────
  {
    tag: '{{streak_days}}',
    label: 'Streak Days',
    desc: 'Consecutive active learning streak in days',
    category: 'Gamification',
    sampleValue: '7',
    sourcePath: 'user_gamification_profiles.current_streak_days',
  },
  {
    tag: '{{streak_expiring_hours}}',
    label: 'Streak Expiry Hours',
    desc: 'Hours before daily streak resets at midnight UTC',
    category: 'Gamification',
    sampleValue: '3',
    sourcePath: 'calculated.streak_expiring_hours',
  },
  {
    tag: '{{xp_points}}',
    label: 'Total XP Points',
    desc: 'Lifetime experience points accumulated',
    category: 'Gamification',
    sampleValue: '1,450',
    sourcePath: 'user_gamification_profiles.total_xp',
  },
  {
    tag: '{{earned_xp}}',
    label: 'XP Points Earned',
    desc: 'XP points awarded for immediate activity',
    category: 'Gamification',
    sampleValue: '120',
    sourcePath: 'event_payload.earned_xp',
  },
  {
    tag: '{{leaderboard_rank}}',
    label: 'Leaderboard Rank',
    desc: 'Current standing on company leaderboard',
    category: 'Gamification',
    sampleValue: '#3',
    sourcePath: 'calculated.leaderboard_rank',
  },
  {
    tag: '{{points_to_next_rank}}',
    label: 'XP to Overtake Rival',
    desc: 'Points needed to climb past colleague ahead',
    category: 'Gamification',
    sampleValue: '45',
    sourcePath: 'calculated.points_to_next_rank',
  },
  {
    tag: '{{rival_name}}',
    label: 'Leaderboard Rival Name',
    desc: 'Colleague directly above on leaderboard',
    category: 'Gamification',
    sampleValue: 'Sarah',
    sourcePath: 'calculated.rival_name',
  },
  {
    tag: '{{badge_name}}',
    label: 'Achievement Badge Name',
    desc: 'Title of newly unlocked skill badge',
    category: 'Gamification',
    sampleValue: 'Objection Master',
    sourcePath: 'badges.name',
  },
  {
    tag: '{{completed_count}}',
    label: 'Completed Sprints Count',
    desc: 'Lifetime count of sprints finished',
    category: 'Gamification',
    sampleValue: '6',
    sourcePath: 'user_stats.completed_count',
  },

  // ─── 5. COGNITIVE & VARK MODALITY ───────────────────────────────────────
  {
    tag: '{{vark.primary_style}}',
    label: 'Primary Learning Style',
    desc: 'Auditory, Visual, Kinesthetic, Reading/Writing',
    category: 'VARK',
    sampleValue: 'Auditory',
    sourcePath: 'employee_learning_style.learning_style',
  },
  {
    tag: '{{vark.recommended_cta_label}}',
    label: 'Smart CTA Text',
    desc: 'VARK-adapted button text (e.g. Listen to Podcast)',
    category: 'VARK',
    sampleValue: '🎧 Listen to 3-Min Podcast',
    sourcePath: 'calculated.cta_label',
  },
  {
    tag: '{{vark.recommended_cta_url}}',
    label: 'Personalized CTA Link',
    desc: 'Modality deep link (/learn?mode=audio)',
    category: 'VARK',
    sampleValue: '/learn?mode=audio',
    sourcePath: 'calculated.cta_url',
  },
  {
    tag: '{{vark.is_auditory}}',
    label: 'Is Auditory Learner',
    desc: 'True if learner absorbs best via audio & podcasts',
    category: 'VARK',
    sampleValue: 'true',
    sourcePath: 'employee_learning_style.is_auditory',
  },
  {
    tag: '{{vark.is_visual}}',
    label: 'Is Visual Learner',
    desc: 'True if learner absorbs best via diagrams & mindmaps',
    category: 'VARK',
    sampleValue: 'false',
    sourcePath: 'employee_learning_style.is_visual',
  },
  {
    tag: '{{vark.is_kinesthetic}}',
    label: 'Is Kinesthetic Learner',
    desc: 'True if learner absorbs best via interactive drills',
    category: 'VARK',
    sampleValue: 'false',
    sourcePath: 'employee_learning_style.is_kinesthetic',
  },
  {
    tag: '{{vark.is_reading_writing}}',
    label: 'Is Reading/Writing Learner',
    desc: 'True if learner absorbs best via executive reading summaries',
    category: 'VARK',
    sampleValue: 'false',
    sourcePath: 'employee_learning_style.is_reading_writing',
  },

  // ─── 6. WORKPLACE TASKS & ASSIGNMENTS ───────────────────────────────────
  {
    tag: '{{task_title}}',
    label: 'Workplace Task Title',
    desc: 'Title of practical workplace assignment',
    category: 'Tasks',
    sampleValue: 'Quarterly Client Case Review',
    sourcePath: 'tasks.title',
  },
  {
    tag: '{{task_type}}',
    label: 'Task Format',
    desc: 'Textual, audio, video, or file format',
    category: 'Tasks',
    sampleValue: 'audio',
    sourcePath: 'tasks.submission_format',
  },
  {
    tag: '{{task_status}}',
    label: 'Task Status',
    desc: 'Assigned, submitted, evaluated, overdue',
    category: 'Tasks',
    sampleValue: 'evaluated',
    sourcePath: 'task_assignments.status',
  },
  {
    tag: '{{task_due_date}}',
    label: 'Task Due Date',
    desc: 'Assigned workplace task deadline',
    category: 'Tasks',
    sampleValue: 'Tomorrow at 5:00 PM',
    sourcePath: 'task_assignments.due_date',
  },
  {
    tag: '{{task_feedback}}',
    label: 'Task AI Feedback',
    desc: 'AI feedback summary on task submission',
    category: 'Tasks',
    sampleValue: 'Strong analysis with crisp action points.',
    sourcePath: 'task_submissions.feedback',
  },
  {
    tag: '{{ai_validation_pass}}',
    label: 'Task AI Passed',
    desc: 'True if workplace task passed AI evaluation criteria',
    category: 'Tasks',
    sampleValue: 'true',
    sourcePath: 'task_submissions.ai_validation_pass',
  },
  {
    tag: '{{content_name}}',
    label: 'Content Title',
    desc: 'Audio recap episode or digest name',
    category: 'Curriculum',
    sampleValue: 'Handling Enterprise Objections',
    sourcePath: 'recommendations.title',
  },

  // ─── 7. COGNITIVE CONDITIONAL BLOCKS ───────────────────────────────────
  {
    tag: '{{#if is_auditory}}🎧 Listen to Podcast{{else}}📖 Read Digest{{/if}}',
    label: 'Auditory vs Reading Block',
    desc: 'Adapts format dynamically based on learner modality',
    category: 'Conditionals',
    sampleValue: '🎧 Listen to Podcast',
    isBlock: true,
  },
  {
    tag: '{{#if is_visual}}📊 View Mindmap{{else}}⚡ Quick Practice{{/if}}',
    label: 'Visual Learner Block',
    desc: 'Offers diagrams/infographics to visual learners',
    category: 'Conditionals',
    sampleValue: '📊 View Mindmap',
    isBlock: true,
  },
  {
    tag: '{{#if is_kinesthetic}}🎮 Jump into Arena Drill{{else}}📚 Review Notes{{/if}}',
    label: 'Kinesthetic Arena Block',
    desc: 'Routes kinesthetic learners to interactive arena drills',
    category: 'Conditionals',
    sampleValue: '🎮 Jump into Arena Drill',
    isBlock: true,
  },
  {
    tag: '{{#if passed}}🎉 Congratulations!{{else}}💪 Keep Practicing!{{/if}}',
    label: 'Pass / Fail Adaptive Block',
    desc: 'Adapts tone between celebratory and encouraging',
    category: 'Conditionals',
    sampleValue: '🎉 Congratulations!',
    isBlock: true,
  },
  {
    tag: '{{#if is_reading_writing}}📖 Read Detailed Brief{{else}}🎧 Listen to Audio{{/if}}',
    label: 'Reading vs Audio Modality Block',
    desc: 'Switches between executive digest and audio recap',
    category: 'Conditionals',
    sampleValue: '🎧 Listen to Audio',
    isBlock: true,
  },
  {
    tag: '{{#if is_overdue}}⚠️ Urgent: Module Overdue!{{else}}On track{{/if}}',
    label: 'Urgent Overdue Escalation Block',
    desc: 'Switches banner urgency depending on deadline lapse',
    category: 'Conditionals',
    sampleValue: 'On track',
    isBlock: true,
  },

  // ─── 8. ZERO-CODE FORMAT FILTERS ────────────────────────────────────────
  {
    tag: '{{ first_name | capitalize }}',
    label: 'Capitalize Name Filter',
    desc: 'Ensures subscriber name starts with uppercase',
    category: 'Filters',
    sampleValue: 'Alex',
    isBlock: true,
  },
  {
    tag: '{{ module_name | truncate: 35 }}',
    label: 'Truncate Title Filter',
    desc: 'Safely truncates long module titles for mobile push',
    category: 'Filters',
    sampleValue: 'Negotiation & Objection...',
    isBlock: true,
  },
  {
    tag: '{{ due_date | default: "soon" }}',
    label: 'Default Fallback Filter',
    desc: 'Renders fallback text if deadline is unassigned',
    category: 'Filters',
    sampleValue: 'Oct 20, 2026',
    isBlock: true,
  },
  {
    tag: '{{ score | default: "0" }}%',
    label: 'Safe Score Number',
    desc: 'Guarantees fallback numeric zero if score is null',
    category: 'Filters',
    sampleValue: '84%',
    isBlock: true,
  },
  {
    tag: '{{ rival_name | upper }}',
    label: 'Uppercase Rival Name',
    desc: 'UPPERCASE shoutout for competitive alerts',
    category: 'Filters',
    sampleValue: 'SARAH',
    isBlock: true,
  },
  {
    tag: '{{ due_date | date }}',
    label: 'Date Formatter Filter',
    desc: 'Converts timestamp into human-readable date format',
    category: 'Filters',
    sampleValue: 'Oct 20, 2026',
    isBlock: true,
  },
  {
    tag: '{{ xp_points | number }}',
    label: 'Number Thousands Formatter',
    desc: 'Formats numeric totals with comma separators',
    category: 'Filters',
    sampleValue: '1,450',
    isBlock: true,
  },
];

function inferCategory(type: string): string {
  const t = (type || '').toUpperCase();
  if (t.includes('QUIZ') || t.includes('ASSESS') || t.includes('REMEDIAT') || t.includes('ROLEPLAY') || t.includes('TEST') || t.includes('EXAM') || t.includes('FEEDBACK') || t.includes('PASS') || t.includes('FAIL')) return 'ASSESSMENT';
  if (t.includes('TASK')) return 'TASKS';
  if (t.includes('WELCOME') || t.includes('LEARNING_STYLE') || t.includes('VARK') || t.includes('ONBOARD')) return 'ONBOARDING';
  if (t.includes('PODCAST') || t.includes('CONTENT')) return 'CONTENT';
  if (t.includes('MODULE') || t.includes('CURRICULUM') || t.includes('COURSE') || t.includes('DEADLINE') || t.includes('SPRINT')) return 'CURRICULUM';
  if (t.includes('STREAK') || t.includes('XP') || t.includes('RANK') || t.includes('LEADERBOARD') || t.includes('BADGE') || t.includes('DRILL') || t.includes('ARENA')) return 'GAMIFICATION';
  if (t.includes('REENGAGE') || t.includes('INACTIV') || t.includes('SWEEP') || t.includes('DAILY_NUDGE') || t.includes('SCAN')) return 'ENGAGEMENT';
  return 'GENERAL';
}

function extractDynamicTokens(str: string): string[] {
  const matches = str.match(/\{\{\s*([#\/]?[\w\.]+)(?:\s*\|[^}]+)?\s*\}\}/g) || [];
  const tokens = matches.map((m) => {
    const raw = m.replace(/[{}]/g, '').split('|')[0].trim();
    return raw.replace(/^[#\/]/, '');
  });
  const ignored = ['if', 'else', 'is_auditory', 'is_visual', 'is_kinesthetic', 'is_reading_writing', 'is_overdue', 'passed'];
  return Array.from(new Set(tokens)).filter((t) => !ignored.includes(t) && t.length > 0);
}

function checkTokenCompatibility(tokens: string[], workflowCategory: string): { incompatible: string[]; warning?: string } {
  const domainTokens: Record<string, string[]> = {
    ASSESSMENT: ['score', 'passing_score', 'weak_topic', 'assessment_id', 'passed', 'feedback_summary', 'attempt_number', 'confidence_score', 'roleplay_passed', 'remediation_module'],
    CURRICULUM: ['module_name', 'progress_percentage', 'minutes_remaining', 'course_id', 'due_date', 'days_left', 'module_type', 'is_overdue', 'completed', 'action_url'],
    GAMIFICATION: ['streak_days', 'streak_expiring_hours', 'rival_name', 'points_to_next_rank', 'xp_points', 'earned_xp', 'badge_name', 'leaderboard_rank', 'completed_count'],
    TASKS: ['task_title', 'task_type', 'task_status', 'task_due_date', 'task_feedback', 'ai_validation_pass'],
    ONBOARDING: ['primary_style', 'vark.primary_style', 'vark.recommended_cta_label'],
    CONTENT: ['content_name', 'episode_title'],
  };

  const foreignTokens = tokens.filter((token) => {
    for (const [cat, catTokens] of Object.entries(domainTokens)) {
      if (cat !== workflowCategory && catTokens.includes(token)) {
        return true;
      }
    }
    return false;
  });

  return {
    incompatible: foreignTokens,
    warning:
      foreignTokens.length > 0
        ? `Notice: Token(s) ${foreignTokens.map((t) => `{{${t}}}`).join(', ')} belong to another domain. Ensure the trigger payload supplies them, or missing variables will safely skip dispatch.`
        : undefined,
  };
}

export function WorkflowAutomationManager({ onInsertTag }: WorkflowManagerProps) {
  const [workflows, setWorkflows] = useState<NotificationWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState('ALL');

  // Visual Canvas Builder State
  const [isCanvasOpen, setIsCanvasOpen] = useState(false);
  const [selectedCanvasWf, setSelectedCanvasWf] = useState<NotificationWorkflow | null>(null);

  // Wizard Modal State
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [wizardStep, setWizardStep] = useState<1 | 2 | 3 | 4>(1);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Trigger search & domain filtering inside Wizard Step 1
  const [triggerSearch, setTriggerSearch] = useState('');
  const [triggerDomainFilter, setTriggerDomainFilter] = useState('ALL');

  // Wizard Form Fields
  const [wTitle, setWTitle] = useState('');
  const [wDescription, setWDescription] = useState('');
  const [wTrigger, setWTrigger] = useState('ASSESSMENT_COMPLETED');
  const [wCategory, setWCategory] = useState('ASSESSMENT');
  const [wRules, setWRules] = useState<Array<{ field: string; operator: string; value: any }>>([
    { field: 'score', operator: '<', value: '70' },
  ]);
  const [wMatchType, setWMatchType] = useState<'ALL' | 'ANY'>('ALL');
  const [wNotifType, setWNotifType] = useState('ADAPTIVE_REMEDIATION_NUDGE');
  const [wChannels, setWChannels] = useState<string[]>(['IN_APP', 'PUSH']);
  const [wDeliveryPolicy, setWDeliveryPolicy] = useState<'PARALLEL' | 'ORDERED_FALLBACK'>('PARALLEL');
  const [wPinnedTemplateId, setWPinnedTemplateId] = useState<string | null>(null);
  const [templateSelectionMode, setTemplateSelectionMode] = useState<'CATALOG' | 'CUSTOM'>('CATALOG');
  const [templateSearchQuery, setTemplateSearchQuery] = useState('');
  const [isBrowsingTemplates, setIsBrowsingTemplates] = useState(false);
  const [tplCategoryFilter, setTplCategoryFilter] = useState<string>('MATCH');
  const [availableTemplates, setAvailableTemplates] = useState<any[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [wTitleTpl, setWTitleTpl] = useState('{{#if is_auditory}}🎧 Audio Recap: {{module_name}}{{else}}Review: {{module_name}}{{/if}}');
  const [wBodyTpl, setWBodyTpl] = useState('Hi {{first_name}}, you scored {{score}}% on {{module_name}}. We noticed {{weak_topic}} could use a boost. {{#if is_auditory}}Listen to your 3-min audio recap{{else}}Review your quick summary{{/if}} to ace the next drill!');
  const [wCooldown, setWCooldown] = useState(3600);

  // Simulation Preview State
  const [previewPersona, setPreviewPersona] = useState<'auditory' | 'visual' | 'kinesthetic'>('auditory');
  const [copiedTag, setCopiedTag] = useState<string | null>(null);

  // Step 3 Smart Tags State
  const [tagCategoryFilter, setTagCategoryFilter] = useState<string>('ALL');
  const [tagSearchQuery, setTagSearchQuery] = useState<string>('');
  const [tagInsertTarget, setTagInsertTarget] = useState<'BODY' | 'TITLE'>('BODY');
  const [tagToast, setTagToast] = useState<string | null>(null);

  // Version History & Rollback Modal State
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [selectedHistoryWf, setSelectedHistoryWf] = useState<NotificationWorkflow | null>(null);
  const [versionHistory, setVersionHistory] = useState<any[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);

  useEffect(() => {
    fetchWorkflows();
    fetchCatalogTemplates();
  }, []);

  const fetchCatalogTemplates = async () => {
    setLoadingTemplates(true);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/templates`);
      const data = await res.json();
      if (data?.templates) {
        setAvailableTemplates(data.templates);
      }
    } catch (err) {
      console.error('Failed to fetch catalog templates:', err);
    } finally {
      setLoadingTemplates(false);
    }
  };

  const fetchWorkflows = async () => {
    setLoading(true);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/workflows`);
      const data = await res.json();
      if (data?.workflows) {
        setWorkflows(data.workflows);
      }
    } catch (err) {
      console.error('Failed to fetch workflows:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCanvas = (wf?: NotificationWorkflow | null) => {
    setSelectedCanvasWf(wf || null);
    setIsCanvasOpen(true);
  };

  const handleOpenNewWizard = () => {
    handleOpenCanvas(null);
  };

  const handleOpenClassicWizard = () => {
    setEditingId(null);
    setWizardStep(1);
    setTriggerSearch('');
    setTriggerDomainFilter('ALL');
    setWTitle('Adaptive Weak-Spot Remediation Nudge');
    setWDescription('Automatically delivers personalized remediation when learner scores below 70%.');
    setWTrigger('ASSESSMENT_COMPLETED');
    setWCategory('ASSESSMENT');
    setWRules([{ field: 'score', operator: '<', value: '70' }]);
    setWMatchType('ALL');
    setWNotifType('ADAPTIVE_REMEDIATION_NUDGE');
    setWChannels(['IN_APP', 'PUSH']);
    setWDeliveryPolicy('PARALLEL');
    setWPinnedTemplateId(null);
    setTemplateSelectionMode('CATALOG');
    setTemplateSearchQuery('');
    setIsBrowsingTemplates(true);
    setTplCategoryFilter('MATCH');
    setWTitleTpl('{{#if is_auditory}}🎧 Audio Recap: {{module_name}}{{else}}Review: {{module_name}}{{/if}}');
    setWBodyTpl('Hi {{first_name}}, you scored {{score}}% on {{module_name}}. We noticed {{weak_topic}} could use a boost. {{#if is_auditory}}Listen to your 3-min audio recap{{else}}Review your quick summary{{/if}} to ace the next drill!');
    setWCooldown(3600);
    setIsWizardOpen(true);
  };

  const handleEditWorkflow = (wf: NotificationWorkflow) => {
    handleOpenCanvas(wf);
  };

  const handleEditWorkflowClassic = (wf: NotificationWorkflow) => {
    setEditingId(wf.id);
    setWizardStep(1);
    setTriggerSearch('');
    setTriggerDomainFilter('ALL');
    setWTitle(wf.title);
    setWDescription(wf.description || '');
    setWTrigger(wf.trigger_lifecycle);
    setWCategory(wf.category);
    setWRules(wf.filter_rules.length ? wf.filter_rules : [{ field: 'score', operator: '<', value: '70' }]);
    setWMatchType(wf.filter_match_type || 'ALL');
    setWNotifType(wf.notification_type);
    setWChannels(wf.channels || ['IN_APP', 'PUSH']);
    setWPinnedTemplateId(wf.pinned_template_id || null);
    setTemplateSelectionMode(wf.pinned_template_id ? 'CATALOG' : 'CUSTOM');
    setIsBrowsingTemplates(!wf.pinned_template_id);
    setTemplateSearchQuery('');
    setTplCategoryFilter('MATCH');
    setWTitleTpl(wf.title_template);
    setWBodyTpl(wf.body_template);
    setWCooldown(wf.cooldown_seconds || 3600);
    setIsWizardOpen(true);
  };

  const handleToggleStatus = async (wf: NotificationWorkflow) => {
    try {
      const newStatus = !wf.is_active;
      await fetchWithAuth(`${API_BASE}/api/notifications/workflows/${wf.id}/status?is_active=${newStatus}`, {
        method: 'PATCH',
      });
      setWorkflows((prev) =>
        prev.map((item) => (item.id === wf.id ? { ...item, is_active: newStatus } : item))
      );
    } catch (err) {
      console.error('Failed to toggle workflow status:', err);
    }
  };

  const handleDeleteWorkflow = async (id: string) => {
    if (!confirm('Are you sure you want to delete this automation workflow?')) return;
    try {
      await fetchWithAuth(`${API_BASE}/api/notifications/workflows/${id}`, { method: 'DELETE' });
      setWorkflows((prev) => prev.filter((item) => item.id !== id));
    } catch (err) {
      console.error('Failed to delete workflow:', err);
    }
  };

  const handleSaveWorkflow = async () => {
    setSaving(true);
    try {
      const payload = {
        title: wTitle,
        description: wDescription,
        trigger_lifecycle: wTrigger,
        category: wCategory,
        filter_rules: wRules,
        filter_match_type: wMatchType,
        notification_type: wNotifType,
        channels: wChannels,
        delivery_policy: wDeliveryPolicy,
        pinned_template_id: wPinnedTemplateId || null,
        title_template: wTitleTpl,
        body_template: wBodyTpl,
        cooldown_seconds: wCooldown,
        priority: 'NORMAL',
        is_active: true,
      };

      let respData = null;
      if (editingId) {
        const res = await fetchWithAuth(`${API_BASE}/api/notifications/workflows/${editingId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          const detailMsg = typeof errData?.detail === 'string' ? errData.detail : (errData?.detail?.[0]?.msg || 'Failed to update workflow');
          throw new Error(detailMsg);
        }
        respData = await res.json();
      } else {
        const res = await fetchWithAuth(`${API_BASE}/api/notifications/workflows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => null);
          const detailMsg = typeof errData?.detail === 'string' ? errData.detail : (errData?.detail?.[0]?.msg || 'Failed to create workflow');
          throw new Error(detailMsg);
        }
        respData = await res.json();
      }

      if (respData?.conflict_warning) {
        alert(respData.conflict_warning);
      }

      await fetchWorkflows();
      setIsWizardOpen(false);
    } catch (err: any) {
      console.error('Failed to save workflow:', err);
      alert(err?.message || 'Error saving workflow. Please check your parameters.');
    } finally {
      setSaving(false);
    }
  };

  const handleViewHistory = async (wf: NotificationWorkflow) => {
    setSelectedHistoryWf(wf);
    setIsHistoryOpen(true);
    setLoadingHistory(true);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/workflows/${wf.id}/versions`);
      const data = await res.json();
      setVersionHistory(data?.versions || []);
    } catch (err) {
      console.error('Failed to fetch workflow versions:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleRollbackWorkflow = async (versionNum: number) => {
    if (!selectedHistoryWf) return;
    if (!confirm(`Are you sure you want to restore Version ${versionNum}?`)) return;
    setRollingBack(true);
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/workflows/${selectedHistoryWf.id}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_version: versionNum }),
      });
      const data = await res.json();
      if (data.success) {
        alert(`Restored to Version ${versionNum} successfully! Active version is now ${data.new_version}.`);
        setIsHistoryOpen(false);
        await fetchWorkflows();
      } else {
        alert(data.detail || 'Rollback failed.');
      }
    } catch (err: any) {
      console.error('Rollback error:', err);
      alert(err?.message || 'Failed to rollback workflow.');
    } finally {
      setRollingBack(false);
    }
  };

  const handleCopyTag = (tag: string) => {
    navigator.clipboard.writeText(tag);
    setCopiedTag(tag);
    setTagToast(`Copied ${tag} to clipboard`);
    setTimeout(() => {
      setCopiedTag(null);
      setTagToast(null);
    }, 2000);
    if (onInsertTag) onInsertTag(tag);
  };

  const handleInsertTagToTitle = (tag: string) => {
    setWTitleTpl((prev) => (prev ? `${prev} ${tag}` : tag));
    setTagToast(`Inserted ${tag} into Title template`);
    setTimeout(() => setTagToast(null), 2500);
  };

  const handleInsertTagToBody = (tag: string) => {
    setWBodyTpl((prev) => (prev ? `${prev} ${tag}` : tag));
    setTagToast(`Inserted ${tag} into Body template`);
    setTimeout(() => setTagToast(null), 2500);
  };

  // Filtered workflows list
  const filteredWorkflows = workflows.filter((w) => {
    const matchesSearch =
      w.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      w.notification_type.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (w.description && w.description.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCategory = categoryFilter === 'ALL' || w.category === categoryFilter;
    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'ACTIVE' && w.is_active) ||
      (statusFilter === 'PAUSED' && !w.is_active);
    return matchesSearch && matchesCategory && matchesStatus;
  });

  // Simulation persona render for step 3 and step 4
  const renderSimulatedText = (text: string) => {
    let output = text;
    const isAuditory = previewPersona === 'auditory';
    const isVisual = previewPersona === 'visual';
    const isKinesthetic = previewPersona === 'kinesthetic';

    // Conditional blocks (using [\s\S] for cross-target multi-line matching without 's' flag)
    output = output.replace(
      /\{\{#if\s+is_auditory\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g,
      (_, trueBlock, falseBlock) => (isAuditory ? trueBlock : falseBlock || '')
    );
    output = output.replace(
      /\{\{#if\s+is_visual\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g,
      (_, trueBlock, falseBlock) => (isVisual ? trueBlock : falseBlock || '')
    );
    output = output.replace(
      /\{\{#if\s+is_kinesthetic\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g,
      (_, trueBlock, falseBlock) => (isKinesthetic ? trueBlock : falseBlock || '')
    );
    output = output.replace(
      /\{\{#if\s+is_reading_writing\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g,
      (_, trueBlock, falseBlock) => falseBlock || ''
    );
    output = output.replace(
      /\{\{#if\s+is_overdue\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g,
      (_, trueBlock, falseBlock) => falseBlock || ''
    );
    output = output.replace(
      /\{\{#if\s+passed\}\}([\s\S]*?)(?:\{\{else\}\}([\s\S]*?))?\{\{\/if\}\}/g,
      (_, trueBlock) => trueBlock
    );

    // Filter syntax simulations
    output = output
      .replace(/\{\{\s*first_name\s*\|\s*capitalize\s*\}\}/g, isAuditory ? 'Alex' : isVisual ? 'Jordan' : 'Taylor')
      .replace(/\{\{\s*module_name\s*\|\s*truncate:\s*\d+\s*\}\}/g, 'Negotiation & Objection...')
      .replace(/\{\{\s*due_date\s*\|\s*default:[^}]+\}\}/g, 'Oct 20, 2026')
      .replace(/\{\{\s*due_date\s*\|\s*date\s*\}\}/g, 'Oct 20, 2026')
      .replace(/\{\{\s*score\s*\|\s*default:[^}]+\}\}/g, '84')
      .replace(/\{\{\s*rival_name\s*\|\s*upper\s*\}\}/g, 'SARAH')
      .replace(/\{\{\s*xp_points\s*\|\s*number\s*\}\}/g, '1,450');

    // Substitutions
    output = output
      .replace(/\{\{first_name\}\}/g, isAuditory ? 'Alex' : isVisual ? 'Jordan' : 'Taylor')
      .replace(/\{\{full_name\}\}/g, isAuditory ? 'Alex Mercer' : isVisual ? 'Jordan Hayes' : 'Taylor Reed')
      .replace(/\{\{email\}\}/g, isAuditory ? 'alex.mercer@acmeglobal.com' : isVisual ? 'jordan.hayes@acmeglobal.com' : 'taylor.reed@acmeglobal.com')
      .replace(/\{\{company_name\}\}/g, 'Acme Global')
      .replace(/\{\{manager_name\}\}/g, 'Sarah Connor')
      .replace(/\{\{department\}\}/g, 'Enterprise Sales')
      .replace(/\{\{role\}\}/g, 'Senior Specialist')
      .replace(/\{\{vark\.primary_style\}\}/g, isAuditory ? 'Auditory' : isVisual ? 'Visual' : 'Kinesthetic')
      .replace(/\{\{vark\.is_auditory\}\}/g, isAuditory ? 'true' : 'false')
      .replace(/\{\{vark\.is_visual\}\}/g, isVisual ? 'true' : 'false')
      .replace(/\{\{vark\.is_kinesthetic\}\}/g, isKinesthetic ? 'true' : 'false')
      .replace(/\{\{vark\.is_reading_writing\}\}/g, 'false')
      .replace(/\{\{vark\.recommended_cta_label\}\}/g, isAuditory ? '🎧 Listen to 3-Min Podcast' : isVisual ? '📊 View Infographic' : '🎮 Jump into Arena')
      .replace(/\{\{vark\.recommended_cta_url\}\}/g, isAuditory ? '/learn?mode=audio' : isVisual ? '/learn?mode=visual' : '/gamification/arena')
      .replace(/\{\{module_name\}\}/g, 'Negotiation & Objection Handling')
      .replace(/\{\{score\}\}/g, '84')
      .replace(/\{\{passing_score\}\}/g, '75')
      .replace(/\{\{passed\}\}/g, 'true')
      .replace(/\{\{roleplay_passed\}\}/g, 'true')
      .replace(/\{\{weak_topic\}\}/g, 'Pricing Objections')
      .replace(/\{\{feedback_summary\}\}/g, 'Strong active listening with crisp rebuttals.')
      .replace(/\{\{remediation_module\}\}/g, 'Objection Handling Micro-Drill')
      .replace(/\{\{attempt_number\}\}/g, '2')
      .replace(/\{\{confidence_score\}\}/g, '88')
      .replace(/\{\{streak_days\}\}/g, '7')
      .replace(/\{\{streak_expiring_hours\}\}/g, '3')
      .replace(/\{\{rival_name\}\}/g, 'Sarah')
      .replace(/\{\{points_to_next_rank\}\}/g, '45')
      .replace(/\{\{xp_points\}\}/g, '1,450')
      .replace(/\{\{earned_xp\}\}/g, '120')
      .replace(/\{\{leaderboard_rank\}\}/g, '#3')
      .replace(/\{\{badge_name\}\}/g, 'Objection Master')
      .replace(/\{\{completed_count\}\}/g, '6')
      .replace(/\{\{progress_percentage\}\}/g, '75')
      .replace(/\{\{minutes_remaining\}\}/g, '8')
      .replace(/\{\{due_date\}\}/g, 'Oct 20, 2026')
      .replace(/\{\{days_left\}\}/g, '2')
      .replace(/\{\{is_overdue\}\}/g, 'false')
      .replace(/\{\{completed\}\}/g, 'true')
      .replace(/\{\{action_url\}\}/g, 'https://app.lucid.ai/sprint/42')
      .replace(/\{\{module_type\}\}/g, 'sprint')
      .replace(/\{\{task_title\}\}/g, 'Quarterly Client Case Review')
      .replace(/\{\{task_type\}\}/g, 'audio')
      .replace(/\{\{task_status\}\}/g, 'evaluated')
      .replace(/\{\{task_due_date\}\}/g, 'Tomorrow at 5:00 PM')
      .replace(/\{\{task_feedback\}\}/g, 'Strong analysis with crisp action points.')
      .replace(/\{\{ai_validation_pass\}\}/g, 'true')
      .replace(/\{\{content_name\}\}/g, 'Handling Enterprise Objections');

    return output;
  };

  return (
    <div className="space-y-6">
      {/* ─────────────────────────────────────────────────────────────
          HEADER BANNER & CONTROLS
         ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 bg-white rounded-xl border border-slate-200/80 shadow-2xs">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100">
              <Zap size={16} />
            </span>
            <h2 className="text-base font-semibold text-slate-900">Event-Triggered Automations</h2>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200">
              {workflows.length} Active Rules
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Build zero-code automated workflows that react to learner actions (Quizzes, Streaks, Progress) with personalized VARK & Gamification context.
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenNewWizard}
          className="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-all shadow-xs cursor-pointer"
        >
          <Plus size={14} />
          <span>New Automation Workflow</span>
        </button>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          FILTER BAR
         ───────────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="relative w-full sm:w-80">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search workflows, triggers, keys..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs text-slate-800 focus:outline-hidden focus:border-indigo-500"
          />
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs text-slate-700 focus:outline-hidden"
          >
            <option value="ALL">All Categories</option>
            <option value="ASSESSMENT">Assessments & Quizzes</option>
            <option value="CURRICULUM">Curriculum Progress</option>
            <option value="GAMIFICATION">Gamification & Streaks</option>
            <option value="TASKS">Workplace Tasks</option>
            <option value="ONBOARDING">Onboarding & VARK</option>
            <option value="CONTENT">Content & Podcasts</option>
            <option value="ENGAGEMENT">Engagement Sweeps</option>
            <option value="CUSTOM">Custom Triggers</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs text-slate-700 focus:outline-hidden"
          >
            <option value="ALL">All Status</option>
            <option value="ACTIVE">Active Only</option>
            <option value="PAUSED">Paused Only</option>
          </select>

          <button
            type="button"
            onClick={fetchWorkflows}
            className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition-all cursor-pointer"
            title="Refresh list"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────
          WORKFLOWS CARDS LIST
         ───────────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="py-12 text-center text-xs text-slate-500">Loading automation workflows...</div>
      ) : filteredWorkflows.length === 0 ? (
        <div className="p-8 text-center bg-white rounded-xl border border-slate-200/80">
          <Zap size={24} className="mx-auto text-slate-300 mb-2" />
          <h3 className="text-sm font-semibold text-slate-800">No automation workflows found</h3>
          <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
            Create your first workflow to automatically dispatch personalized nudges when learners complete quizzes or streaks.
          </p>
          <button
            type="button"
            onClick={handleOpenNewWizard}
            className="mt-4 inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800"
          >
            <Plus size={13} />
            <span>Create Workflow</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {filteredWorkflows.map((wf) => {
            const triggerInfo = LIFECYCLE_TRIGGERS.find((t) => t.key === wf.trigger_lifecycle) || {
              label: wf.trigger_lifecycle,
              icon: Zap,
              badgeColor: 'bg-slate-100 text-slate-700 border-slate-200',
            };
            const Icon = triggerInfo.icon;

            return (
              <div
                key={wf.id}
                className="p-4 bg-white rounded-xl border border-slate-200/80 hover:border-slate-300 transition-all shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${triggerInfo.badgeColor}`}
                    >
                      <Icon size={12} />
                      <span>{triggerInfo.label}</span>
                    </span>

                    <span className="text-xs font-mono font-medium text-slate-400">
                      [{wf.notification_type}]
                    </span>

                    <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                      v{wf.version_number || 1}
                    </span>

                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                      wf.delivery_policy === 'ORDERED_FALLBACK'
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-indigo-50 text-indigo-700 border-indigo-200'
                    }`}>
                      {wf.delivery_policy === 'ORDERED_FALLBACK' ? 'Fallback' : 'Parallel'}
                    </span>

                    {Boolean((wf.title_template && wf.title_template.includes('{{')) || (wf.body_template && wf.body_template.includes('{{'))) ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
                        <Sparkles size={10} />
                        <span>Personalized</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                        <span>Static</span>
                      </span>
                    )}

                    {wf.pinned_template_id && (() => {
                      const matched = availableTemplates.find((t) => t.id === wf.pinned_template_id);
                      return (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 border border-purple-200"
                          title={`Bound to template: ${matched?.notification_type || wf.pinned_template_id}`}
                        >
                          <Layers size={10} />
                          <span>Bound: {matched ? matched.notification_type : 'Catalog Template'}</span>
                        </span>
                      );
                    })()}

                    <span
                      className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${
                        wf.is_active
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-slate-100 text-slate-500 border-slate-200'
                      }`}
                    >
                      {wf.is_active ? 'Active' : 'Paused'}
                    </span>
                  </div>

                  <h3 className="text-sm font-semibold text-slate-900 truncate">{wf.title}</h3>
                  {wf.description && <p className="text-xs text-slate-500 line-clamp-1">{wf.description}</p>}

                  {/* Conditions & Channels Pills */}
                  <div className="flex items-center gap-2 pt-1 flex-wrap">
                    <span className="text-[11px] text-slate-400 font-medium">When:</span>
                    {wf.filter_rules.map((rule, idx) => (
                      <span
                        key={idx}
                        className="inline-flex items-center text-[11px] font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md border border-slate-200/80"
                      >
                        {rule.field} {rule.operator} {String(rule.value)}
                      </span>
                    ))}

                    <span className="text-[11px] text-slate-300">•</span>
                    <span className="text-[11px] text-slate-400 font-medium">Via:</span>
                    <div className="flex items-center gap-1">
                      {wf.channels.includes('IN_APP') && (
                        <span title="In-App Drawer" className="p-1 rounded bg-slate-100 text-slate-600">
                          <Bell size={11} />
                        </span>
                      )}
                      {wf.channels.includes('PUSH') && (
                        <span title="Mobile Push" className="p-1 rounded bg-slate-100 text-slate-600">
                          <Smartphone size={11} />
                        </span>
                      )}
                      {wf.channels.includes('EMAIL') && (
                        <span title="Email" className="p-1 rounded bg-slate-100 text-slate-600">
                          <Mail size={11} />
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right Metrics & Actions */}
                <div className="flex items-center gap-3 self-end md:self-center shrink-0 border-t md:border-t-0 pt-2 md:pt-0 border-slate-100 w-full md:w-auto justify-between md:justify-end">
                  <div className="text-right hidden lg:block">
                    <div className="text-xs font-semibold text-slate-800">{wf.execution_count} sends</div>
                    <div className="text-[10px] text-slate-400">
                      {wf.last_triggered_at ? `Last: ${new Date(wf.last_triggered_at).toLocaleDateString()}` : 'Never fired'}
                    </div>
                  </div>

                  {/* Active Toggle Switch */}
                  <button
                    type="button"
                    onClick={() => handleToggleStatus(wf)}
                    className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                      wf.is_active ? 'bg-slate-900' : 'bg-slate-200'
                    }`}
                    title={wf.is_active ? 'Pause workflow' : 'Activate workflow'}
                  >
                    <span
                      className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                        wf.is_active ? 'translate-x-4' : 'translate-x-0'
                      }`}
                    />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleViewHistory(wf)}
                    className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition-all cursor-pointer"
                    title="Version history & rollback"
                  >
                    <Clock size={13} />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleEditWorkflow(wf)}
                    className="p-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-600 transition-all cursor-pointer"
                    title="Edit workflow"
                  >
                    <Edit3 size={13} />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDeleteWorkflow(wf.id)}
                    className="p-1.5 rounded-lg border border-slate-200 hover:bg-rose-50 hover:text-rose-600 text-slate-400 transition-all cursor-pointer"
                    title="Delete workflow"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          4-STEP CLEAN AUTOMATION WIZARD MODAL
         ───────────────────────────────────────────────────────────── */}
      {isWizardOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="relative w-full max-w-2xl bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
            {/* Modal Header */}
            <div className="px-6 py-4 border-b border-slate-200/80 flex items-center justify-between bg-slate-50/50">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  {editingId ? 'Edit Automation Workflow' : 'New Automation Workflow Wizard'}
                </h3>
                <p className="text-xs text-slate-500">Step {wizardStep} of 4</p>
              </div>
              <button
                type="button"
                onClick={() => setIsWizardOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all"
              >
                <X size={16} />
              </button>
            </div>

            {/* Stepper Tabs Bar */}
            <div className="px-6 pt-3 pb-2 border-b border-slate-100 flex items-center justify-between text-xs font-semibold">
              <button
                type="button"
                onClick={() => setWizardStep(1)}
                className={`flex items-center gap-1.5 pb-1 border-b-2 transition-all ${
                  wizardStep === 1
                    ? 'border-indigo-600 text-indigo-600'
                    : wizardStep > 1
                    ? 'border-emerald-500 text-emerald-600'
                    : 'border-transparent text-slate-400'
                }`}
              >
                <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] bg-slate-100">1</span>
                <span>Trigger</span>
              </button>

              <button
                type="button"
                onClick={() => setWizardStep(2)}
                className={`flex items-center gap-1.5 pb-1 border-b-2 transition-all ${
                  wizardStep === 2
                    ? 'border-indigo-600 text-indigo-600'
                    : wizardStep > 2
                    ? 'border-emerald-500 text-emerald-600'
                    : 'border-transparent text-slate-400'
                }`}
              >
                <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] bg-slate-100">2</span>
                <span>Filters</span>
              </button>

              <button
                type="button"
                onClick={() => setWizardStep(3)}
                className={`flex items-center gap-1.5 pb-1 border-b-2 transition-all ${
                  wizardStep === 3
                    ? 'border-indigo-600 text-indigo-600'
                    : wizardStep > 3
                    ? 'border-emerald-500 text-emerald-600'
                    : 'border-transparent text-slate-400'
                }`}
              >
                <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] bg-slate-100">3</span>
                <span>Smart Tags</span>
              </button>

              <button
                type="button"
                onClick={() => setWizardStep(4)}
                className={`flex items-center gap-1.5 pb-1 border-b-2 transition-all ${
                  wizardStep === 4 ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-slate-400'
                }`}
              >
                <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] bg-slate-100">4</span>
                <span>Template & Preview</span>
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 overflow-y-auto space-y-5 flex-1">
              {/* ──────────────────────────────────────────────────
                  STEP 1: TRIGGER LIFECYCLE (CATEGORIZED & SEARCHABLE)
                 ────────────────────────────────────────────────── */}
              {wizardStep === 1 && (() => {
                const filteredTriggers = LIFECYCLE_TRIGGERS.filter((t) => {
                  if (triggerDomainFilter !== 'ALL' && t.category !== triggerDomainFilter) return false;
                  if (triggerSearch.trim()) {
                    const q = triggerSearch.toLowerCase().trim();
                    return (
                      t.label.toLowerCase().includes(q) ||
                      t.key.toLowerCase().includes(q) ||
                      t.description.toLowerCase().includes(q) ||
                      t.category.toLowerCase().includes(q)
                    );
                  }
                  return true;
                });

                const selectedTrigger = LIFECYCLE_TRIGGERS.find((t) => t.key === wTrigger);

                return (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-800 mb-1">Workflow Title</label>
                      <input
                        type="text"
                        value={wTitle}
                        onChange={(e) => setWTitle(e.target.value)}
                        placeholder="e.g. Adaptive Weak-Spot Remediation Nudge"
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-900 focus:outline-hidden focus:border-indigo-500"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-800 mb-1">Description (Optional)</label>
                      <input
                        type="text"
                        value={wDescription}
                        onChange={(e) => setWDescription(e.target.value)}
                        placeholder="e.g. Automatically triggers when learner scores below 70%"
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-700 focus:outline-hidden focus:border-indigo-500"
                      />
                    </div>

                    {/* Trigger Event Lifecycle Selector Header & Controls */}
                    <div className="space-y-2.5 pt-1">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                          <label className="block text-xs font-semibold text-slate-800">
                            Select Trigger Event Lifecycle
                          </label>
                          <p className="text-[11px] text-slate-500">
                            Choose the exact event that will wake up and evaluate this automation workflow.
                          </p>
                        </div>
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200 self-start sm:self-auto">
                          {filteredTriggers.length} of {LIFECYCLE_TRIGGERS.length} Available
                        </span>
                      </div>

                      {/* Search & Domain Filter Pills */}
                      <div className="space-y-2">
                        <div className="relative">
                          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                          <input
                            type="text"
                            value={triggerSearch}
                            onChange={(e) => setTriggerSearch(e.target.value)}
                            placeholder="Filter triggers (e.g. quiz, streak, task, overdue, roleplay, podcast)..."
                            className="w-full pl-9 pr-8 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-800 bg-white placeholder:text-slate-400 focus:outline-hidden focus:border-indigo-500 shadow-2xs"
                          />
                          {triggerSearch && (
                            <button
                              type="button"
                              onClick={() => setTriggerSearch('')}
                              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
                              title="Clear search"
                            >
                              <X size={13} />
                            </button>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5 flex-wrap">
                          {[
                            { key: 'ALL', label: 'All', count: LIFECYCLE_TRIGGERS.length },
                            { key: 'ASSESSMENT', label: 'Assessments', count: LIFECYCLE_TRIGGERS.filter((t) => t.category === 'ASSESSMENT').length },
                            { key: 'CURRICULUM', label: 'Curriculum', count: LIFECYCLE_TRIGGERS.filter((t) => t.category === 'CURRICULUM').length },
                            { key: 'GAMIFICATION', label: 'Gamification', count: LIFECYCLE_TRIGGERS.filter((t) => t.category === 'GAMIFICATION').length },
                            { key: 'TASKS', label: 'Workplace Tasks', count: LIFECYCLE_TRIGGERS.filter((t) => t.category === 'TASKS').length },
                            { key: 'ONBOARDING', label: 'Onboarding & VARK', count: LIFECYCLE_TRIGGERS.filter((t) => t.category === 'ONBOARDING').length },
                            { key: 'CONTENT', label: 'Content', count: LIFECYCLE_TRIGGERS.filter((t) => t.category === 'CONTENT').length },
                            { key: 'ENGAGEMENT', label: 'Engagement', count: LIFECYCLE_TRIGGERS.filter((t) => t.category === 'ENGAGEMENT').length },
                          ].map((cat) => {
                            const isActive = triggerDomainFilter === cat.key;
                            return (
                              <button
                                key={cat.key}
                                type="button"
                                onClick={() => setTriggerDomainFilter(cat.key)}
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                  isActive
                                    ? 'bg-slate-900 text-white shadow-2xs'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
                                }`}
                              >
                                <span>{cat.label}</span>
                                <span
                                  className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                                    isActive ? 'bg-slate-800 text-slate-200' : 'bg-white text-slate-500 border border-slate-200/60'
                                  }`}
                                >
                                  {cat.count}
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Trigger Cards Scrollable Grid */}
                      {filteredTriggers.length === 0 ? (
                        <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                          <AlertCircle size={20} className="mx-auto text-slate-400 mb-1.5" />
                          <p className="text-xs font-semibold text-slate-700">No matching trigger events found</p>
                          <p className="text-[11px] text-slate-500 mt-0.5">Try adjusting your search terms or clearing the domain filter.</p>
                          <button
                            type="button"
                            onClick={() => {
                              setTriggerSearch('');
                              setTriggerDomainFilter('ALL');
                            }}
                            className="mt-2 text-xs font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                          >
                            Reset Filter
                          </button>
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[380px] overflow-y-auto pr-1">
                          {filteredTriggers.map((t) => {
                            const Icon = t.icon;
                            const isSelected = wTrigger === t.key;
                            return (
                              <div
                                key={t.key}
                                onClick={() => {
                                  setWTrigger(t.key);
                                  setWCategory(t.category);
                                  if (!editingId) {
                                    if (t.defaultTitle) setWTitleTpl(t.defaultTitle);
                                    if (t.defaultBody) setWBodyTpl(t.defaultBody);
                                  }
                                }}
                                className={`p-3 rounded-xl border text-left cursor-pointer transition-all relative ${
                                  isSelected
                                    ? 'bg-indigo-50/70 border-indigo-500 ring-2 ring-indigo-500/20 shadow-xs'
                                    : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span
                                      className={`p-1.5 rounded-lg shrink-0 ${
                                        isSelected ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                                      }`}
                                    >
                                      <Icon size={14} />
                                    </span>
                                    <div className="min-w-0">
                                      <span className="text-xs font-semibold text-slate-900 block truncate">{t.label}</span>
                                      <span className="text-[10px] font-mono text-slate-400 block truncate">[{t.key}]</span>
                                    </div>
                                  </div>
                                  {isSelected ? (
                                    <span className="text-indigo-600 shrink-0">
                                      <CheckCircle2 size={16} />
                                    </span>
                                  ) : (
                                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded border shrink-0 ${t.badgeColor}`}>
                                      {t.category}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-slate-500 mt-2 line-clamp-2 leading-relaxed">{t.description}</p>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* Selected Trigger Confirmation Footer */}
                      {selectedTrigger && (
                        <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 flex items-center justify-between gap-2 text-xs">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-[11px] text-slate-500 font-medium shrink-0">Selected Trigger:</span>
                            <span className="font-semibold text-slate-800 flex items-center gap-1.5 truncate">
                              <selectedTrigger.icon size={13} className="text-indigo-600 shrink-0" />
                              <span className="truncate">{selectedTrigger.label}</span>
                            </span>
                            <span className="text-[10px] font-mono text-slate-400 hidden sm:inline">({selectedTrigger.key})</span>
                          </div>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border shrink-0 ${selectedTrigger.badgeColor}`}>
                            {selectedTrigger.category}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* ──────────────────────────────────────────────────
                  STEP 2: SIMPLE VISUAL FILTER BUILDER
                 ────────────────────────────────────────────────── */}
              {/* ──────────────────────────────────────────────────
                  STEP 2: ENHANCED VISUAL FILTER BUILDER
                 ────────────────────────────────────────────────── */}
              {wizardStep === 2 && (() => {
                const groupedFields = AVAILABLE_FIELDS.reduce((acc, f) => {
                  acc[f.category] = acc[f.category] || [];
                  acc[f.category].push(f);
                  return acc;
                }, {} as Record<string, ConditionFieldDefinition[]>);

                const getFieldDef = (fieldVal: string): ConditionFieldDefinition => {
                  return (
                    AVAILABLE_FIELDS.find((f) => f.value === fieldVal) || {
                      value: fieldVal,
                      label: fieldVal,
                      type: 'string',
                      category: 'Assessment',
                      description: 'Custom trigger field',
                    }
                  );
                };

                const handleFieldChange = (idx: number, newFieldKey: string) => {
                  const targetDef = getFieldDef(newFieldKey);
                  const newRules = [...wRules];
                  const currentOp = newRules[idx]?.operator || '==';

                  const allowedOps = (OPERATORS_BY_TYPE[targetDef.type] || OPERATORS_BY_TYPE.string).map((o) => o.value);
                  const validOp = allowedOps.includes(currentOp) ? currentOp : allowedOps[0];

                  let defaultVal: any = '';
                  if (targetDef.type === 'boolean') {
                    defaultVal = 'true';
                  } else if (targetDef.type === 'enum' && targetDef.options?.length) {
                    defaultVal = targetDef.options[0];
                  } else if (targetDef.type === 'number') {
                    defaultVal = targetDef.placeholder?.replace('e.g. ', '').split(',')[0].trim() || '70';
                  } else {
                    defaultVal = '';
                  }

                  newRules[idx] = {
                    field: newFieldKey,
                    operator: validOp,
                    value: defaultVal,
                  };
                  setWRules(newRules);
                };

                const handleApplyRecipe = (rec: { field: string; operator: string; value: string }) => {
                  if (wRules.length === 0) {
                    setWRules([rec]);
                  } else if (wRules.length === 1 && !wRules[0].field) {
                    setWRules([rec]);
                  } else if (wRules.length < 8) {
                    setWRules([...wRules, rec]);
                  }
                };

                return (
                  <div className="space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <h4 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                          <Sliders size={13} className="text-indigo-600" />
                          <span>Audience & Filter Conditions</span>
                          <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full">
                            {wRules.length} Active
                          </span>
                        </h4>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Define precise conditions. Notifications will only fire when the learner or trigger payload matches these rules.
                        </p>
                      </div>

                      {wRules.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setWRules([])}
                          className="text-[11px] font-semibold text-rose-600 hover:text-rose-700 cursor-pointer self-start sm:self-auto"
                        >
                          Clear All (Send to Everyone)
                        </button>
                      )}
                    </div>

                    {/* Quick Recipe Chips */}
                    <div className="p-2.5 rounded-xl bg-slate-50 border border-slate-200/80">
                      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-600 mb-1.5">
                        <Sparkles size={12} className="text-amber-500" />
                        <span>Quick Condition Recipes:</span>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {FILTER_RECIPES.map((recipe, rIdx) => (
                          <button
                            key={rIdx}
                            type="button"
                            onClick={() => handleApplyRecipe(recipe.rule)}
                            className="px-2 py-1 rounded-lg bg-white border border-slate-200 hover:border-indigo-300 hover:bg-indigo-50/40 text-[11px] font-medium text-slate-700 transition-all cursor-pointer shadow-2xs"
                          >
                            {recipe.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Active Rules List */}
                    <div className="space-y-2.5">
                      {wRules.length === 0 ? (
                        <div className="p-6 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                          <CheckCircle2 size={20} className="mx-auto text-emerald-500 mb-1.5" />
                          <p className="text-xs font-semibold text-slate-800">No condition filters active</p>
                          <p className="text-[11px] text-slate-500 mt-0.5 max-w-md mx-auto">
                            This workflow will trigger unconditionally for every recipient when this event fires. Click below to narrow down your target audience.
                          </p>
                          <button
                            type="button"
                            onClick={() => setWRules([{ field: 'score', operator: '<', value: '70' }])}
                            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-700 transition-all cursor-pointer shadow-2xs"
                          >
                            <Plus size={13} />
                            <span>Add Filter Condition</span>
                          </button>
                        </div>
                      ) : (
                        wRules.map((rule, idx) => {
                          const fDef = getFieldDef(rule.field);
                          const ops = OPERATORS_BY_TYPE[fDef.type] || OPERATORS_BY_TYPE.string;

                          return (
                            <React.Fragment key={idx}>
                              {idx > 0 && (
                                <div className="flex items-center justify-center my-1">
                                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wider uppercase bg-indigo-100 text-indigo-700 border border-indigo-200/80">
                                    {wMatchType === 'ALL' ? 'AND' : 'OR'}
                                  </span>
                                </div>
                              )}

                              <div className="p-3 bg-white rounded-xl border border-slate-200 shadow-2xs hover:border-slate-300 transition-all space-y-2">
                                <div className="flex items-center justify-between gap-2 text-xs">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-600 font-bold text-[10px] flex items-center justify-center shrink-0">
                                      {idx + 1}
                                    </span>
                                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200/60 shrink-0">
                                      {fDef.category}
                                    </span>
                                    <span className="text-[11px] text-slate-400 truncate">
                                      {fDef.description}
                                    </span>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => setWRules(wRules.filter((_, i) => i !== idx))}
                                    className="p-1 text-slate-400 hover:text-rose-600 transition-all cursor-pointer rounded"
                                    title="Remove this condition"
                                  >
                                    <Trash2 size={13} />
                                  </button>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center">
                                  {/* Field Selector */}
                                  <div className="sm:col-span-5">
                                    <select
                                      value={rule.field}
                                      onChange={(e) => handleFieldChange(idx, e.target.value)}
                                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                    >
                                      {Object.entries(groupedFields).map(([cat, fields]) => (
                                        <optgroup key={cat} label={`── ${cat} (${fields.length}) ──`}>
                                          {fields.map((f) => (
                                            <option key={f.value} value={f.value}>
                                              {f.label}
                                            </option>
                                          ))}
                                        </optgroup>
                                      ))}
                                    </select>
                                  </div>

                                  {/* Operator Selector */}
                                  <div className="sm:col-span-3">
                                    <select
                                      value={rule.operator}
                                      onChange={(e) => {
                                        const newRules = [...wRules];
                                        newRules[idx].operator = e.target.value;
                                        setWRules(newRules);
                                      }}
                                      className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                    >
                                      {ops.map((op) => (
                                        <option key={op.value} value={op.value}>
                                          {op.label}
                                        </option>
                                      ))}
                                    </select>
                                  </div>

                                  {/* Value Editor */}
                                  <div className="sm:col-span-4">
                                    {fDef.type === 'boolean' ? (
                                      <div className="flex items-center gap-1.5">
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const newRules = [...wRules];
                                            newRules[idx].value = 'true';
                                            setWRules(newRules);
                                          }}
                                          className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                            String(rule.value).toLowerCase() === 'true'
                                              ? 'bg-emerald-600 text-white shadow-2xs'
                                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                          }`}
                                        >
                                          True (Yes)
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            const newRules = [...wRules];
                                            newRules[idx].value = 'false';
                                            setWRules(newRules);
                                          }}
                                          className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer ${
                                            String(rule.value).toLowerCase() === 'false'
                                              ? 'bg-rose-600 text-white shadow-2xs'
                                              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                          }`}
                                        >
                                          False (No)
                                        </button>
                                      </div>
                                    ) : fDef.type === 'enum' && fDef.options && rule.operator !== 'in' ? (
                                      <select
                                        value={rule.value}
                                        onChange={(e) => {
                                          const newRules = [...wRules];
                                          newRules[idx].value = e.target.value;
                                          setWRules(newRules);
                                        }}
                                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-800 font-medium focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                      >
                                        {fDef.options.map((opt) => (
                                          <option key={opt} value={opt}>
                                            {opt}
                                          </option>
                                        ))}
                                      </select>
                                    ) : fDef.type === 'number' ? (
                                      <input
                                        type="number"
                                        step="any"
                                        value={rule.value}
                                        onChange={(e) => {
                                          const newRules = [...wRules];
                                          newRules[idx].value = e.target.value;
                                          setWRules(newRules);
                                        }}
                                        placeholder={fDef.placeholder || 'e.g. 70'}
                                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                      />
                                    ) : (
                                      <input
                                        type="text"
                                        value={rule.value}
                                        onChange={(e) => {
                                          const newRules = [...wRules];
                                          newRules[idx].value = e.target.value;
                                          setWRules(newRules);
                                        }}
                                        placeholder={fDef.placeholder || 'e.g. value or keywords'}
                                        className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                                      />
                                    )}
                                  </div>
                                </div>
                              </div>
                            </React.Fragment>
                          );
                        })
                      )}

                      {wRules.length > 0 && wRules.length < 8 && (
                        <button
                          type="button"
                          onClick={() =>
                            setWRules([
                              ...wRules,
                              { field: 'vark.primary_style', operator: '==', value: 'Auditory' },
                            ])
                          }
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-dashed border-slate-300 text-slate-600 hover:text-slate-900 text-xs font-semibold cursor-pointer hover:bg-slate-50 transition-all"
                        >
                          <Plus size={13} />
                          <span>Add Another Condition ({wMatchType === 'ALL' ? 'AND' : 'OR'})</span>
                        </button>
                      )}
                    </div>

                    {/* Match Policy & Natural Language Rule Summary */}
                    <div className="pt-3 border-t border-slate-100 space-y-2.5">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-600">
                        <span className="font-semibold text-slate-700">Condition Match Policy:</span>
                        <div className="flex items-center gap-4">
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name="matchType"
                              checked={wMatchType === 'ALL'}
                              onChange={() => setWMatchType('ALL')}
                              className="text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className="font-medium">Match ALL (AND)</span>
                          </label>
                          <label className="flex items-center gap-1.5 cursor-pointer">
                            <input
                              type="radio"
                              name="matchType"
                              checked={wMatchType === 'ANY'}
                              onChange={() => setWMatchType('ANY')}
                              className="text-indigo-600 focus:ring-indigo-500"
                            />
                            <span className="font-medium">Match ANY (OR)</span>
                          </label>
                        </div>
                      </div>

                      {/* Natural Language Summary Banner */}
                      <div className="p-3 rounded-xl bg-slate-50 border border-slate-200/80 text-xs">
                        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider block mb-1">
                          Rule Logic Summary:
                        </span>
                        {wRules.length === 0 ? (
                          <p className="text-slate-700">
                            Dispatched unconditionally to <span className="font-semibold text-slate-900">all learners</span> who trigger this event.
                          </p>
                        ) : (
                          <p className="text-slate-700 leading-relaxed">
                            Dispatched <span className="font-semibold text-slate-900">ONLY</span> when learner matches{' '}
                            {wRules.map((r, i) => (
                              <React.Fragment key={i}>
                                {i > 0 && (
                                  <span className="font-bold text-indigo-600">
                                    {' '}
                                    {wMatchType === 'ALL' ? 'AND' : 'OR'}{' '}
                                  </span>
                                )}
                                <span className="font-mono px-1.5 py-0.5 rounded bg-white border border-slate-200 text-slate-900 font-semibold text-[11px]">
                                  {r.field} {r.operator} &quot;{String(r.value)}&quot;
                                </span>
                              </React.Fragment>
                            ))}
                            .
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ──────────────────────────────────────────────────
                  STEP 3: SMART TAGS PALETTE
                 ────────────────────────────────────────────────── */}
              {/* ──────────────────────────────────────────────────
                  STEP 3: PERSONALIZATION SMART TAGS STUDIO
                 ────────────────────────────────────────────────── */}
              {wizardStep === 3 && (() => {
                const tagCategories = [
                  { id: 'ALL', label: 'All Tags', count: SMART_TAGS.length },
                  { id: 'Learner', label: 'Learner Profile', count: SMART_TAGS.filter((t) => t.category === 'Learner').length },
                  { id: 'Assessment', label: 'Assessment & Practice', count: SMART_TAGS.filter((t) => t.category === 'Assessment').length },
                  { id: 'Curriculum', label: 'Curriculum & Deadlines', count: SMART_TAGS.filter((t) => t.category === 'Curriculum').length },
                  { id: 'Gamification', label: 'Gamification & Arena', count: SMART_TAGS.filter((t) => t.category === 'Gamification').length },
                  { id: 'VARK', label: 'Cognitive & VARK', count: SMART_TAGS.filter((t) => t.category === 'VARK').length },
                  { id: 'Tasks', label: 'Workplace Tasks', count: SMART_TAGS.filter((t) => t.category === 'Tasks').length },
                  { id: 'Conditionals', label: 'Adaptive Blocks', count: SMART_TAGS.filter((t) => t.category === 'Conditionals').length },
                  { id: 'Filters', label: 'Format Filters', count: SMART_TAGS.filter((t) => t.category === 'Filters').length },
                ];

                const q = tagSearchQuery.trim().toLowerCase();
                const filteredTags = SMART_TAGS.filter((t) => {
                  const matchesCat = tagCategoryFilter === 'ALL' || t.category === tagCategoryFilter;
                  const matchesQ =
                    !q ||
                    t.tag.toLowerCase().includes(q) ||
                    t.label.toLowerCase().includes(q) ||
                    t.desc.toLowerCase().includes(q) ||
                    t.sampleValue.toLowerCase().includes(q) ||
                    (t.sourcePath && t.sourcePath.toLowerCase().includes(q));
                  return matchesCat && matchesQ;
                });

                return (
                  <div className="space-y-4">
                    {/* Header Banner & Toast */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <h4 className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                          <Sparkles size={14} className="text-indigo-600" />
                          <span>Personalization Smart Tags Studio</span>
                          <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full">
                            {filteredTags.length} / {SMART_TAGS.length} Available
                          </span>
                        </h4>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Supercharge your notifications with dynamic tokens, VARK cognitive style adapters, and format filters. Click to copy or insert directly into your template.
                        </p>
                      </div>

                      {tagToast && (
                        <div className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-semibold animate-pulse">
                          <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
                          <span>{tagToast}</span>
                        </div>
                      )}
                    </div>

                    {/* Search & Domain Filter Bar */}
                    <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 space-y-2.5">
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                        {/* Search Input */}
                        <div className="relative flex-1">
                          <Search size={13} className="absolute left-2.5 top-2.5 text-slate-400" />
                          <input
                            type="text"
                            value={tagSearchQuery}
                            onChange={(e) => setTagSearchQuery(e.target.value)}
                            placeholder="Search smart tags by token, label, sample, or description..."
                            className="w-full pl-8 pr-8 py-1.5 rounded-lg bg-white border border-slate-200 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                          />
                          {tagSearchQuery && (
                            <button
                              type="button"
                              onClick={() => setTagSearchQuery('')}
                              className="absolute right-2.5 top-2 text-slate-400 hover:text-slate-600"
                            >
                              <X size={13} />
                            </button>
                          )}
                        </div>

                        {/* Direct Insertion Target Switcher */}
                        <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-slate-200 shrink-0 text-xs">
                          <span className="text-[11px] font-semibold text-slate-500 px-1">1-Click Insert To:</span>
                          <button
                            type="button"
                            onClick={() => setTagInsertTarget('BODY')}
                            className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all cursor-pointer ${
                              tagInsertTarget === 'BODY'
                                ? 'bg-indigo-600 text-white shadow-2xs'
                                : 'text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            Body Draft
                          </button>
                          <button
                            type="button"
                            onClick={() => setTagInsertTarget('TITLE')}
                            className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-all cursor-pointer ${
                              tagInsertTarget === 'TITLE'
                                ? 'bg-indigo-600 text-white shadow-2xs'
                                : 'text-slate-600 hover:bg-slate-100'
                            }`}
                          >
                            Title Draft
                          </button>
                        </div>
                      </div>

                      {/* Domain Pills */}
                      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                        {tagCategories.map((cat) => {
                          const isActive = tagCategoryFilter === cat.id;
                          return (
                            <button
                              key={cat.id}
                              type="button"
                              onClick={() => setTagCategoryFilter(cat.id)}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                                isActive
                                  ? 'bg-slate-900 text-white shadow-2xs'
                                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200/80'
                              }`}
                            >
                              <span>{cat.label}</span>
                              <span
                                className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                                  isActive ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-500'
                                }`}
                              >
                                {cat.count}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Tags Grid */}
                    {filteredTags.length === 0 ? (
                      <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-200">
                        <AlertCircle size={20} className="mx-auto text-slate-400 mb-1.5" />
                        <p className="text-xs font-semibold text-slate-700">No matching smart tags found</p>
                        <p className="text-[11px] text-slate-500 mt-0.5">Try adjusting your search query or reset the category filter.</p>
                        <button
                          type="button"
                          onClick={() => {
                            setTagSearchQuery('');
                            setTagCategoryFilter('ALL');
                          }}
                          className="mt-2 text-xs font-semibold text-indigo-600 hover:text-indigo-800 cursor-pointer"
                        >
                          Reset Filters
                        </button>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-[380px] overflow-y-auto pr-1">
                        {filteredTags.map((tagObj) => {
                          const isCopied = copiedTag === tagObj.tag;

                          return (
                            <div
                              key={tagObj.tag}
                              className="p-3 rounded-xl bg-white border border-slate-200 hover:border-indigo-300 hover:shadow-2xs transition-all space-y-2 flex flex-col justify-between"
                            >
                              <div className="space-y-1.5">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0">
                                    <span className="font-mono text-xs font-bold text-indigo-600 bg-indigo-50/80 px-2 py-0.5 rounded border border-indigo-100 inline-block break-all">
                                      {tagObj.tag}
                                    </span>
                                  </div>
                                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200 shrink-0">
                                    {tagObj.category}
                                  </span>
                                </div>

                                <div className="text-xs font-medium text-slate-800 flex items-center gap-1.5">
                                  <span>{tagObj.label}</span>
                                </div>

                                <p className="text-[11px] text-slate-500 leading-relaxed line-clamp-2">
                                  {tagObj.desc}
                                </p>
                              </div>

                              <div className="pt-2 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                                <div className="min-w-0">
                                  <span className="text-[10px] text-slate-400 block truncate">
                                    Sample: <span className="text-slate-700 font-semibold">&quot;{tagObj.sampleValue}&quot;</span>
                                  </span>
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                  {/* Copy Tag Button */}
                                  <button
                                    type="button"
                                    onClick={() => handleCopyTag(tagObj.tag)}
                                    className="px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 text-[11px] font-semibold flex items-center gap-1 transition-all cursor-pointer"
                                    title="Copy tag to clipboard"
                                  >
                                    {isCopied ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
                                    <span>{isCopied ? 'Copied' : 'Copy'}</span>
                                  </button>

                                  {/* Direct Insert Button */}
                                  <button
                                    type="button"
                                    onClick={() =>
                                      tagInsertTarget === 'TITLE'
                                        ? handleInsertTagToTitle(tagObj.tag)
                                        : handleInsertTagToBody(tagObj.tag)
                                    }
                                    className="px-2.5 py-1 rounded-md bg-indigo-50 hover:bg-indigo-600 text-indigo-700 hover:text-white text-[11px] font-semibold flex items-center gap-1 transition-all cursor-pointer border border-indigo-200/80 hover:border-transparent"
                                    title={`Insert tag into ${tagInsertTarget === 'TITLE' ? 'Title' : 'Body'}`}
                                  >
                                    <Plus size={12} />
                                    <span>{tagInsertTarget === 'TITLE' ? '+ Title' : '+ Body'}</span>
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Draft Template Scratchpad (Direct Live Editor in Step 3) */}
                    <div className="p-3.5 bg-white rounded-xl border border-slate-200 shadow-2xs space-y-3">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-2">
                        <div className="flex items-center gap-1.5">
                          <Edit3 size={13} className="text-indigo-600" />
                          <span className="text-xs font-bold text-slate-900">Active Template Draft</span>
                          <span className="text-[10px] text-slate-400">Click &quot;+ Title&quot; or &quot;+ Body&quot; on any card above to insert</span>
                        </div>

                        {/* Quick Presets */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-semibold text-slate-400">Presets:</span>
                          <button
                            type="button"
                            onClick={() => {
                              setWTitleTpl('{{#if is_auditory}}🎧 Audio Recap: {{module_name}}{{else}}Review: {{module_name}}{{/if}}');
                              setWBodyTpl('Hi {{first_name}}, you scored {{score}}% on {{module_name}}. We noticed {{weak_topic}} could use a boost. {{#if is_auditory}}Listen to your 3-min audio recap{{else}}Review your quick summary{{/if}} to ace the next drill!');
                              setTagToast('Loaded VARK Adaptive preset');
                              setTimeout(() => setTagToast(null), 2000);
                            }}
                            className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-semibold cursor-pointer transition-colors"
                          >
                            🎧 VARK Adaptive
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setWTitleTpl('🔥 {{streak_days}}-Day Streak at risk, {{first_name}}!');
                              setWBodyTpl('Protect your streak before midnight UTC! You have {{streak_expiring_hours}} hours left. You are ranked {{leaderboard_rank}} — just {{points_to_next_rank}} XP behind {{rival_name}}. Jump in now!');
                              setTagToast('Loaded Gamification Streak preset');
                              setTimeout(() => setTagToast(null), 2000);
                            }}
                            className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-semibold cursor-pointer transition-colors"
                          >
                            🔥 Streak & Rival
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setWTitleTpl('⏳ {{days_left}} days left for {{module_name}}');
                              setWBodyTpl('Hi {{first_name}}, {{module_name | truncate: 35}} is due on {{due_date | default: "soon"}}. Only {{minutes_remaining}} minutes remaining to maintain track compliance!');
                              setTagToast('Loaded Deadline Alert preset');
                              setTimeout(() => setTagToast(null), 2000);
                            }}
                            className="px-2 py-0.5 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-[10px] font-semibold cursor-pointer transition-colors"
                          >
                            ⏳ Sprint Deadline
                          </button>
                        </div>
                      </div>

                      {/* Title Draft Input */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <label className="text-[11px] font-semibold text-slate-700 flex items-center gap-1.5">
                            <span>Draft Title:</span>
                            {tagInsertTarget === 'TITLE' && (
                              <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.2 rounded border border-indigo-100">
                                Target Active
                              </span>
                            )}
                          </label>
                          <div className="flex items-center gap-2 text-[10px] text-slate-400">
                            <span>{wTitleTpl.length} chars</span>
                            {wTitleTpl && (
                              <button
                                type="button"
                                onClick={() => setWTitleTpl('')}
                                className="text-slate-400 hover:text-slate-600 cursor-pointer"
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        </div>
                        <input
                          type="text"
                          value={wTitleTpl}
                          onFocus={() => setTagInsertTarget('TITLE')}
                          onChange={(e) => setWTitleTpl(e.target.value)}
                          placeholder="Compose title with {{tags}}..."
                          className="w-full px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50/50 font-mono text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>

                      {/* Body Draft Textarea */}
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <label className="text-[11px] font-semibold text-slate-700 flex items-center gap-1.5">
                            <span>Draft Body:</span>
                            {tagInsertTarget === 'BODY' && (
                              <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.2 rounded border border-indigo-100">
                                Target Active
                              </span>
                            )}
                          </label>
                          <div className="flex items-center gap-2 text-[10px] text-slate-400">
                            <span>{wBodyTpl.length} chars</span>
                            {wBodyTpl && (
                              <button
                                type="button"
                                onClick={() => setWBodyTpl('')}
                                className="text-slate-400 hover:text-slate-600 cursor-pointer"
                              >
                                Clear
                              </button>
                            )}
                          </div>
                        </div>
                        <textarea
                          rows={3}
                          value={wBodyTpl}
                          onFocus={() => setTagInsertTarget('BODY')}
                          onChange={(e) => setWBodyTpl(e.target.value)}
                          placeholder="Compose notification body with {{tags}}, {{#if conditionals}}, and {{filters}}..."
                          className="w-full px-3 py-2 rounded-lg border border-slate-200 bg-slate-50/50 font-mono text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 leading-relaxed resize-none"
                        />
                      </div>
                    </div>

                    {/* Live Sandbox Preview Card */}
                    <div className="p-3.5 bg-slate-900 rounded-xl text-white space-y-2.5">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <Eye size={14} className="text-indigo-400" />
                          <span className="text-xs font-semibold">Live Tag Preview Sandbox</span>
                          <span className="text-[10px] text-slate-400">Simulating active title & body template</span>
                        </div>

                        {/* Persona Selector */}
                        <div className="flex items-center gap-1 bg-slate-800 p-0.5 rounded-lg text-xs">
                          <button
                            type="button"
                            onClick={() => setPreviewPersona('auditory')}
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer ${
                              previewPersona === 'auditory' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            🎧 Auditory (Alex)
                          </button>
                          <button
                            type="button"
                            onClick={() => setPreviewPersona('visual')}
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer ${
                              previewPersona === 'visual' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            📊 Visual (Jordan)
                          </button>
                          <button
                            type="button"
                            onClick={() => setPreviewPersona('kinesthetic')}
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer ${
                              previewPersona === 'kinesthetic' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            🎮 Kinesthetic (Taylor)
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1.5 p-3 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs">
                        <div>
                          <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider block">Rendered Title:</span>
                          <p className="font-semibold text-slate-100 mt-0.5">{renderSimulatedText(wTitleTpl)}</p>
                        </div>
                        <div className="pt-2 border-t border-slate-700/50">
                          <span className="text-[10px] uppercase font-bold text-indigo-400 tracking-wider block">Rendered Body:</span>
                          <p className="text-slate-200 mt-0.5 leading-relaxed">{renderSimulatedText(wBodyTpl)}</p>
                        </div>
                      </div>
                    </div>

                    {/* Handlebars CheatSheet Note */}
                    <div className="p-3 bg-indigo-50/70 rounded-xl border border-indigo-100 flex items-start gap-2 text-xs text-indigo-900">
                      <HelpCircle size={15} className="text-indigo-600 shrink-0 mt-0.5" />
                      <div className="space-y-1 text-[11px] leading-relaxed">
                        <p className="font-semibold text-indigo-950">Handlebars & Cognitive Syntax Tip:</p>
                        <p>
                          Use conditional blocks like <code className="font-mono bg-white px-1 py-0.5 rounded border border-indigo-200">{'{{#if is_auditory}}Listen to Podcast{{else}}Read Summary{{/if}}'}</code> to tailor delivery formats, and zero-code filters like <code className="font-mono bg-white px-1 py-0.5 rounded border border-indigo-200">{'{{ first_name | capitalize }}'}</code> or <code className="font-mono bg-white px-1 py-0.5 rounded border border-indigo-200">{'{{ due_date | default: "soon" }}'}</code> for safe defaults.
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* ──────────────────────────────────────────────────
                  STEP 4: TEMPLATE, CHANNELS & PREVIEW
                 ────────────────────────────────────────────────── */}
              {wizardStep === 4 && (() => {
                const pinnedTemplate = availableTemplates.find((t) => t.id === wPinnedTemplateId);
                const isCustomPersonalized = (wTitleTpl + ' ' + wBodyTpl).includes('{{');
                const customTokens = extractDynamicTokens(wTitleTpl + ' ' + wBodyTpl);

                const activeTitle = pinnedTemplate ? (pinnedTemplate.title_template || wTitleTpl) : wTitleTpl;
                const activeBody = pinnedTemplate ? (pinnedTemplate.body_template || wBodyTpl) : wBodyTpl;
                const activeTokens = extractDynamicTokens(activeTitle + ' ' + activeBody);
                const activeCompat = checkTokenCompatibility(activeTokens, wCategory);

                // Filter catalog templates
                const filteredCatalog = availableTemplates.filter((tpl) => {
                  const tplCat = tpl.category || inferCategory(tpl.notification_type);
                  const matchesDomain =
                    tplCategoryFilter === 'MATCH'
                      ? tplCat === wCategory || tplCat === 'GENERAL'
                      : tplCategoryFilter === 'ALL'
                      ? true
                      : tplCat === tplCategoryFilter;

                  const q = templateSearchQuery.trim().toLowerCase();
                  const matchesSearch =
                    !q ||
                    (tpl.notification_type && tpl.notification_type.toLowerCase().includes(q)) ||
                    (tpl.title_template && tpl.title_template.toLowerCase().includes(q)) ||
                    (tpl.body_template && tpl.body_template.toLowerCase().includes(q));

                  return matchesDomain && matchesSearch;
                });

                return (
                  <div className="space-y-4">
                    {/* Template Binding Mode Switcher */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <label className="block text-xs font-semibold text-slate-800">
                          Template Authoring & Binding
                        </label>
                        <span className="text-[11px] text-slate-400 font-medium">
                          {templateSelectionMode === 'CATALOG' && wPinnedTemplateId
                            ? 'Catalog Pinned Template'
                            : templateSelectionMode === 'CATALOG'
                            ? 'Catalog Selection Mode'
                            : 'Custom Inline Copy'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setTemplateSelectionMode('CATALOG');
                            if (!wPinnedTemplateId) {
                              setIsBrowsingTemplates(true);
                            }
                          }}
                          className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                            templateSelectionMode === 'CATALOG'
                              ? 'bg-indigo-50/70 border-indigo-300 ring-1 ring-indigo-200 text-indigo-950 shadow-2xs'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1.5 font-semibold text-xs">
                              <Layers size={14} className={templateSelectionMode === 'CATALOG' ? 'text-indigo-600' : 'text-slate-400'} />
                              <span>Link from Catalog</span>
                            </div>
                            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-700">
                              Recommended
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500 font-normal mt-1 leading-normal">
                            Bind to an existing template from the Templates tab. Guarantees consistent copy across channels and workflows.
                          </p>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setTemplateSelectionMode('CUSTOM');
                            setWPinnedTemplateId(null);
                            setIsBrowsingTemplates(false);
                          }}
                          className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                            templateSelectionMode === 'CUSTOM'
                              ? 'bg-indigo-50/70 border-indigo-300 ring-1 ring-indigo-200 text-indigo-950 shadow-2xs'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 font-semibold text-xs">
                            <Edit3 size={14} className={templateSelectionMode === 'CUSTOM' ? 'text-indigo-600' : 'text-slate-400'} />
                            <span>Custom Inline Copy</span>
                          </div>
                          <p className="text-[11px] text-slate-500 font-normal mt-1 leading-normal">
                            Draft bespoke notification text stored solely on this workflow without linking to a catalog template.
                          </p>
                        </button>
                      </div>
                    </div>

                    {/* Catalog Mode: Bound Card OR Catalog Browser */}
                    {templateSelectionMode === 'CATALOG' && (
                      <div className="space-y-3">
                        {wPinnedTemplateId && pinnedTemplate && !isBrowsingTemplates ? (
                          /* Bound Template Summary Card */
                          <div className="p-4 rounded-xl border border-indigo-200 bg-linear-to-br from-indigo-50/50 via-white to-slate-50/80 shadow-2xs space-y-3">
                            <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-indigo-100">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-md bg-indigo-600 text-white">
                                  <Layers size={11} />
                                  <span>Bound Template</span>
                                </span>
                                <span className="text-xs font-mono font-semibold text-slate-800">
                                  [{pinnedTemplate.notification_type}]
                                </span>
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                                  v{pinnedTemplate.version || 1}
                                </span>
                                <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200">
                                  {pinnedTemplate.category || inferCategory(pinnedTemplate.notification_type)}
                                </span>

                                {activeTokens.length > 0 ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                    <Sparkles size={10} />
                                    <span>Personalized ({activeTokens.length} dynamic tokens)</span>
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                                    <span>Static / Broadcast</span>
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => setIsBrowsingTemplates(true)}
                                  className="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition-colors cursor-pointer"
                                >
                                  Change Template
                                </button>
                                <span className="text-slate-300">|</span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setTemplateSelectionMode('CUSTOM');
                                    setWPinnedTemplateId(null);
                                  }}
                                  className="text-xs text-slate-500 hover:text-slate-700 transition-colors cursor-pointer"
                                >
                                  Unlink
                                </button>
                              </div>
                            </div>

                            {/* Template Preview */}
                            <div className="space-y-1.5">
                              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                                Title Template:
                              </div>
                              <div className="p-2.5 rounded-lg bg-white border border-slate-200 text-xs font-mono text-slate-900">
                                {pinnedTemplate.title_template || '(No title template)'}
                              </div>

                              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider pt-1">
                                Message Body Template:
                              </div>
                              <div className="p-2.5 rounded-lg bg-white border border-slate-200 text-xs font-mono text-slate-800 leading-relaxed whitespace-pre-wrap">
                                {pinnedTemplate.body_template}
                              </div>
                            </div>

                            {/* Dynamic Variables Breakdown */}
                            <div className="pt-1">
                              <div className="text-[11px] font-semibold text-slate-700 mb-1.5">
                                Dynamic Recipient Variables:
                              </div>
                              {activeTokens.length > 0 ? (
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {activeTokens.map((token) => (
                                    <span
                                      key={token}
                                      className="inline-flex items-center text-[11px] font-mono font-semibold px-2 py-0.5 rounded-md bg-indigo-100 text-indigo-900 border border-indigo-200"
                                    >
                                      {`{{${token}}}`}
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-[11px] text-slate-500 italic">
                                  Static template: No user variables required. Broadcasts exact message to all recipients.
                                </p>
                              )}
                            </div>

                            {/* Strict Personalization Execution Policy Banner */}
                            <div className="p-3 bg-emerald-50/90 rounded-xl border border-emerald-200/90 text-xs text-emerald-900 flex items-start gap-2.5">
                              <ShieldCheck size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                              <div className="leading-relaxed">
                                <span className="font-semibold text-emerald-950">Strict Variable Enforcement:</span>{' '}
                                During automated execution, the dispatch engine resolves each dynamic variable against the recipient's live profile and event payload. If any required token is missing, delivery is safely skipped for that user and logged to the Dispatch Audit Trail.
                              </div>
                            </div>

                            {/* Token Compatibility Warning if Applicable */}
                            {activeCompat.warning && (
                              <div className="p-3 bg-amber-50/90 rounded-xl border border-amber-200/90 text-xs text-amber-900 flex items-start gap-2.5">
                                <AlertTriangle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                                <div className="leading-relaxed font-normal">
                                  <span className="font-semibold text-amber-950">Domain Mismatch Notice:</span> {activeCompat.warning}
                                </div>
                              </div>
                            )}
                          </div>
                        ) : (
                          /* Catalog Browser */
                          <div className="p-3.5 rounded-xl border border-slate-200 bg-slate-50/60 space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <Search size={14} className="text-slate-500" />
                                <span className="text-xs font-semibold text-slate-800">
                                  Select a Template from Catalog
                                </span>
                              </div>
                              {wPinnedTemplateId && pinnedTemplate && (
                                <button
                                  type="button"
                                  onClick={() => setIsBrowsingTemplates(false)}
                                  className="text-xs font-medium text-slate-600 hover:text-slate-800 cursor-pointer"
                                >
                                  Cancel (Keep Current)
                                </button>
                              )}
                            </div>

                            {/* Search Bar & Domain Filters */}
                            <div className="space-y-2">
                              <div className="relative">
                                <Search size={13} className="absolute left-2.5 top-2.5 text-slate-400" />
                                <input
                                  type="text"
                                  placeholder="Search templates by notification type, title, or body keywords..."
                                  value={templateSearchQuery}
                                  onChange={(e) => setTemplateSearchQuery(e.target.value)}
                                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-hidden focus:border-indigo-500"
                                />
                              </div>

                              <div className="flex items-center gap-1.5 flex-wrap text-xs">
                                <span className="text-[11px] font-semibold text-slate-400 mr-1">Domain:</span>
                                <button
                                  type="button"
                                  onClick={() => setTplCategoryFilter('MATCH')}
                                  className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                                    tplCategoryFilter === 'MATCH'
                                      ? 'bg-indigo-600 text-white shadow-2xs'
                                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                                  }`}
                                >
                                  Recommended ({wCategory})
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setTplCategoryFilter('ALL')}
                                  className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                                    tplCategoryFilter === 'ALL'
                                      ? 'bg-indigo-600 text-white shadow-2xs'
                                      : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                                  }`}
                                >
                                  All
                                </button>
                                {['ASSESSMENT', 'CURRICULUM', 'GAMIFICATION', 'ENGAGEMENT', 'GENERAL'].map((cat) => (
                                  <button
                                    key={cat}
                                    type="button"
                                    onClick={() => setTplCategoryFilter(cat)}
                                    className={`px-2 py-0.5 rounded-md text-[11px] font-semibold transition-all cursor-pointer ${
                                      tplCategoryFilter === cat
                                        ? 'bg-indigo-600 text-white shadow-2xs'
                                        : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                                    }`}
                                  >
                                    {cat}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Template Grid List */}
                            <div className="max-h-64 overflow-y-auto space-y-2 pr-1">
                              {loadingTemplates ? (
                                <div className="py-8 text-center text-xs text-slate-400">
                                  Loading catalog templates...
                                </div>
                              ) : filteredCatalog.length === 0 ? (
                                <div className="py-8 text-center space-y-2 bg-white rounded-lg border border-slate-200/80 p-4">
                                  <p className="text-xs text-slate-500">
                                    No templates found matching your filters.
                                  </p>
                                  <div className="flex items-center justify-center gap-2">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setTemplateSearchQuery('');
                                        setTplCategoryFilter('ALL');
                                      }}
                                      className="text-xs text-indigo-600 font-semibold hover:underline cursor-pointer"
                                    >
                                      Clear Filters
                                    </button>
                                    <span className="text-slate-300">•</span>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setTemplateSelectionMode('CUSTOM');
                                        setWPinnedTemplateId(null);
                                      }}
                                      className="text-xs text-slate-600 font-semibold hover:underline cursor-pointer"
                                    >
                                      Use Custom Copy
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                filteredCatalog.map((tpl) => {
                                  const tplCategory = tpl.category || inferCategory(tpl.notification_type);
                                  const tokens = extractDynamicTokens((tpl.title_template || '') + ' ' + (tpl.body_template || ''));
                                  const isSelected = wPinnedTemplateId === tpl.id;

                                  return (
                                    <div
                                      key={tpl.id}
                                      onClick={() => {
                                        setWPinnedTemplateId(tpl.id);
                                        setWTitleTpl(tpl.title_template || '');
                                        setWBodyTpl(tpl.body_template || '');
                                        setWNotifType(tpl.notification_type);
                                        if (tpl.channel && tpl.channel !== 'ALL' && !wChannels.includes(tpl.channel)) {
                                          setWChannels((prev) => [...prev, tpl.channel]);
                                        }
                                        setIsBrowsingTemplates(false);
                                      }}
                                      className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                                        isSelected
                                          ? 'bg-indigo-50/80 border-indigo-400 ring-2 ring-indigo-200 shadow-2xs'
                                          : 'bg-white hover:bg-slate-50/80 border-slate-200/90'
                                      }`}
                                    >
                                      <div className="flex items-center justify-between gap-2 mb-1">
                                        <div className="flex items-center gap-1.5 flex-wrap">
                                          <span className="text-xs font-mono font-bold text-slate-900">
                                            {tpl.notification_type}
                                          </span>
                                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 border border-slate-200">
                                            v{tpl.version || 1}
                                          </span>
                                          <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">
                                            {tplCategory}
                                          </span>
                                          <span className="text-[10px] font-mono font-semibold px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 border border-indigo-200">
                                            {tpl.channel}
                                          </span>
                                        </div>

                                        {tokens.length > 0 ? (
                                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                                            <Sparkles size={10} />
                                            <span>Personalized ({tokens.length})</span>
                                          </span>
                                        ) : (
                                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                                            Static
                                          </span>
                                        )}
                                      </div>

                                      {tpl.title_template && (
                                        <div className="text-xs font-semibold text-slate-800 line-clamp-1 mb-0.5">
                                          {tpl.title_template}
                                        </div>
                                      )}
                                      <div className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                                        {tpl.body_template}
                                      </div>

                                      {tokens.length > 0 && (
                                        <div className="flex items-center gap-1 pt-1.5 flex-wrap">
                                          <span className="text-[10px] text-slate-400 font-medium">Vars:</span>
                                          {tokens.slice(0, 4).map((t) => (
                                            <span
                                              key={t}
                                              className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 text-slate-600"
                                            >
                                              {`{{${t}}}`}
                                            </span>
                                          ))}
                                          {tokens.length > 4 && (
                                            <span className="text-[10px] text-slate-400">+{tokens.length - 4} more</span>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Custom Inline Copy Editor */}
                    {templateSelectionMode === 'CUSTOM' && (
                      <div className="p-4 rounded-xl border border-slate-200 bg-white space-y-3">
                        <div className="flex items-center justify-between pb-1 border-b border-slate-100">
                          <span className="text-xs font-semibold text-slate-800">
                            Custom Standalone Notification
                          </span>
                          {isCustomPersonalized ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <Sparkles size={10} />
                              <span>Personalized ({customTokens.length} tokens)</span>
                            </span>
                          ) : (
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 border border-slate-200">
                              Static Broadcast
                            </span>
                          )}
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-800 mb-1">
                            Notification Title
                          </label>
                          <input
                            type="text"
                            value={wTitleTpl}
                            onChange={(e) => setWTitleTpl(e.target.value)}
                            placeholder="e.g. Milestone Achieved: {{module_name}}"
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-900 focus:outline-hidden focus:border-indigo-500 font-mono"
                          />
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-800 mb-1">
                            Notification Message Body
                          </label>
                          <textarea
                            rows={3}
                            value={wBodyTpl}
                            onChange={(e) => setWBodyTpl(e.target.value)}
                            placeholder="e.g. Great work {{first_name}}! You scored {{score}}% on {{module_name}}."
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-900 focus:outline-hidden focus:border-indigo-500 font-mono leading-relaxed"
                          />
                        </div>

                        {/* Domain-Filtered Quick Insert Chips */}
                        <div>
                          <span className="text-[11px] font-semibold text-slate-500 block mb-1">
                            Insert Variables for {wCategory}:
                          </span>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {SMART_TAGS.filter(
                              (tag) => tag.category === 'Learner' || tag.category.toUpperCase() === wCategory || tag.category === 'VARK'
                            ).map((tagObj) => (
                              <button
                                key={tagObj.tag}
                                type="button"
                                onClick={() => {
                                  setWBodyTpl((prev) => prev + ' ' + tagObj.tag);
                                }}
                                className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-slate-100 hover:bg-indigo-50 hover:text-indigo-700 text-slate-700 border border-slate-200 transition-all cursor-pointer"
                              >
                                {tagObj.tag}
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="p-2.5 rounded-lg bg-slate-50 text-[11px] text-slate-500 leading-relaxed border border-slate-200/80">
                          <span className="font-semibold text-slate-700">Notice:</span> Custom inline copy is stored directly on this workflow. Dynamic tokens are validated against each recipient at dispatch time.
                        </div>
                      </div>
                    )}

                    {/* Delivery Channels */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-800 mb-1.5">Delivery Channels</label>
                      <div className="flex items-center gap-3">
                        <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={wChannels.includes('IN_APP')}
                            onChange={(e) =>
                              setWChannels(
                                e.target.checked
                                  ? [...wChannels, 'IN_APP']
                                  : wChannels.filter((c) => c !== 'IN_APP')
                              )
                            }
                          />
                          <Bell size={13} />
                          <span>In-App Drawer</span>
                        </label>

                        <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={wChannels.includes('PUSH')}
                            onChange={(e) =>
                              setWChannels(
                                e.target.checked
                                  ? [...wChannels, 'PUSH']
                                  : wChannels.filter((c) => c !== 'PUSH')
                              )
                            }
                          />
                          <Smartphone size={13} />
                          <span>Mobile Push</span>
                        </label>

                        <label className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={wChannels.includes('EMAIL')}
                            onChange={(e) =>
                              setWChannels(
                                e.target.checked
                                  ? [...wChannels, 'EMAIL']
                                  : wChannels.filter((c) => c !== 'EMAIL')
                              )
                            }
                          />
                          <Mail size={13} />
                          <span>Email</span>
                        </label>
                      </div>
                    </div>

                    {/* Delivery Policy (Parallel vs. Ordered Fallback) */}
                    <div>
                      <label className="block text-xs font-semibold text-slate-800 mb-1.5">Delivery Policy</label>
                      <div className="grid grid-cols-2 gap-2">
                        <div
                          onClick={() => setWDeliveryPolicy('PARALLEL')}
                          className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                            wDeliveryPolicy === 'PARALLEL'
                              ? 'bg-indigo-50/60 border-indigo-300 text-indigo-950 font-semibold shadow-2xs'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <Radio size={13} className={wDeliveryPolicy === 'PARALLEL' ? 'text-indigo-600' : 'text-slate-400'} />
                            <span>Parallel Omnichannel</span>
                          </div>
                          <p className="text-[11px] text-slate-500 font-normal mt-1">Broadcasts concurrently across all selected channels.</p>
                        </div>

                        <div
                          onClick={() => setWDeliveryPolicy('ORDERED_FALLBACK')}
                          className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                            wDeliveryPolicy === 'ORDERED_FALLBACK'
                              ? 'bg-amber-50/60 border-amber-300 text-amber-950 font-semibold shadow-2xs'
                              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            <Radio size={13} className={wDeliveryPolicy === 'ORDERED_FALLBACK' ? 'text-amber-600' : 'text-slate-400'} />
                            <span>Ordered Smart Fallback</span>
                          </div>
                          <p className="text-[11px] text-slate-500 font-normal mt-1">Attempts Push first. Falls back to In-App & Email on failure.</p>
                        </div>
                      </div>
                    </div>

                    {/* Live Simulation Persona Switcher */}
                    <div className="p-4 bg-slate-900 text-white rounded-xl space-y-3">
                      <div className="flex items-center justify-between text-xs border-b border-slate-800 pb-2">
                        <div className="flex items-center gap-1.5 text-indigo-400 font-semibold">
                          <Sparkles size={13} />
                          <span>Live Personalization Simulation</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setPreviewPersona('auditory')}
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer ${
                              previewPersona === 'auditory' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            🎧 Auditory
                          </button>
                          <button
                            type="button"
                            onClick={() => setPreviewPersona('visual')}
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer ${
                              previewPersona === 'visual' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            👁️ Visual
                          </button>
                          <button
                            type="button"
                            onClick={() => setPreviewPersona('kinesthetic')}
                            className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-all cursor-pointer ${
                              previewPersona === 'kinesthetic' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            🎮 Kinesthetic
                          </button>
                        </div>
                      </div>

                      <div className="space-y-1">
                        <div className="text-xs font-semibold text-white">{renderSimulatedText(activeTitle)}</div>
                        <div className="text-xs text-slate-300 leading-relaxed">{renderSimulatedText(activeBody)}</div>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Modal Footer Controls */}
            <div className="px-6 py-3 border-t border-slate-200/80 flex items-center justify-between bg-slate-50/50">
              <button
                type="button"
                onClick={() => setWizardStep((prev) => Math.max(1, prev - 1) as any)}
                disabled={wizardStep === 1}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100 disabled:opacity-40 transition-all cursor-pointer"
              >
                <ArrowLeft size={13} />
                <span>Back</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsWizardOpen(false)}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100 transition-all cursor-pointer"
                >
                  Cancel
                </button>

                {wizardStep < 4 ? (
                  <button
                    type="button"
                    onClick={() => setWizardStep((prev) => Math.min(4, prev + 1) as any)}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-all cursor-pointer"
                  >
                    <span>Next</span>
                    <ArrowRight size={13} />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={handleSaveWorkflow}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold hover:bg-indigo-500 transition-all cursor-pointer shadow-xs disabled:opacity-50"
                  >
                    <Check size={13} />
                    <span>{saving ? 'Saving...' : editingId ? 'Update Workflow' : 'Launch Workflow'}</span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          VERSION HISTORY & ROLLBACK MODAL
         ───────────────────────────────────────────────────────────── */}
      {isHistoryOpen && selectedHistoryWf && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4">
          <div className="relative w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden flex flex-col max-h-[85vh]">
            <div className="px-5 py-4 border-b border-slate-200/80 flex items-center justify-between bg-slate-50/50">
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Immutable Version History</h3>
                <p className="text-xs text-slate-500 truncate max-w-xs">{selectedHistoryWf.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsHistoryOpen(false)}
                className="p-1.5 rounded-lg hover:bg-slate-200/60 text-slate-400 hover:text-slate-700 transition-all cursor-pointer"
              >
                <X size={15} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-2.5 flex-1">
              {loadingHistory ? (
                <div className="py-8 text-center text-xs text-slate-500">Loading version snapshots...</div>
              ) : versionHistory.length === 0 ? (
                <div className="py-8 text-center text-xs text-slate-500">No version history recorded yet.</div>
              ) : (
                versionHistory.map((ver) => (
                  <div
                    key={ver.id}
                    className="p-3.5 rounded-xl border border-slate-200/80 hover:border-slate-300 bg-slate-50/40 flex items-center justify-between gap-3 transition-all"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-900">Version {ver.version_number}</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 font-mono">
                          {new Date(ver.created_at).toLocaleDateString()}
                        </span>
                        <span className="text-[10px] font-semibold px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700">
                          {ver.delivery_policy || 'PARALLEL'}
                        </span>
                      </div>
                      <div className="text-xs text-slate-600 truncate">{ver.title_template}</div>
                      <div className="text-[10px] text-slate-400 font-mono truncate">
                        Channels: {(ver.channels || []).join(', ')}
                      </div>
                    </div>

                    <button
                      type="button"
                      disabled={rollingBack}
                      onClick={() => handleRollbackWorkflow(ver.version_number)}
                      className="px-3 py-1.5 rounded-lg bg-white border border-slate-200 hover:bg-indigo-50 hover:border-indigo-200 text-xs font-semibold text-slate-700 hover:text-indigo-600 transition-all cursor-pointer shrink-0 disabled:opacity-50"
                    >
                      {rollingBack ? 'Restoring...' : 'Restore'}
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="px-5 py-3 border-t border-slate-200/80 bg-slate-50/50 text-right">
              <button
                type="button"
                onClick={() => setIsHistoryOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-100 cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          FULL-SCREEN VISUAL WORKFLOW CANVAS BUILDER
         ───────────────────────────────────────────────────────────── */}
      {isCanvasOpen && (
        <WorkflowCanvasBuilder
          workflow={selectedCanvasWf}
          onClose={() => setIsCanvasOpen(false)}
          onSaved={() => {
            fetchWorkflows();
            setIsCanvasOpen(false);
          }}
        />
      )}
    </div>
  );
}
