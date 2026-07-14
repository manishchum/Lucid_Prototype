"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import TaskDashboard from "@/components/task-manager/TaskDashboard";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { useAuth } from "@/contexts/auth-context";
import { useTenant } from "@/contexts/tenant-context";
import CompanySelector from "@/components/company-selector";
import { LeaderboardModal } from "@/components/leaderboard-modal";
// import { LeaderboardModal } from "@/components/leaderboard-modal";
import { createCacheKey, sharedDataClient } from "@/lib/data-client";
import { fetchWithAuth } from "@/lib/fetch-with-auth";
import {
  Users, BookOpen, Clock, User, ChevronDown,
  Trophy, Target, TrendingUp, Zap, LayoutGrid,
  ShieldCheck, ArrowRight, CheckCircle2, LogOut, Award,
  Download, Linkedin, X
} from "lucide-react";
import { AssignedSprintsSection } from "@/components/assigned-sprints-section";
import { useTasks } from "@/hooks/useTasks";
import { submitTaskResponse } from "@/lib/taskApi";
import type { SubmitTaskPayload, Task } from "@/lib/taskApi";
import type { AssignedTask, AssignmentLevel, SubmissionFormat, QuizQuestion } from "@/types/task";
import { FeatureGate } from "@/components/feature-gate";
import { FEATURES } from "@/contexts/tenant-context";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;
const DEFAULT_QUIZ_THRESHOLD = 80;

type SprintStatus = "not_started" | "in_progress" | "completed";

// --- Types ---
interface Employee {
  user_id: string;
  email: string;
  name: string | null;
  joined_at: string;
  company_id?: string;
}

interface ModuleAssessmentStatus {
  moduleId: string;
  hasBaseline: boolean;
  baselineCompleted: boolean;
  baselineScore?: number;
  baselineMaxScore?: number;
}

interface SprintModule {
  id: string;
  name: string;
  completed: boolean;
  quizScore: number | null;
  passStatus?: boolean;
  completedAt: string | null;
}

interface SprintItem {
  id: string;
  title: string;
  moduleName: string | null;
  hasBaseline: boolean;
  baselineCompleted: boolean;
  baselineScore?: number | null;
  baselineMaxScore?: number | null;
  status: SprintStatus;
  certificateEarned: boolean;
  completedDate: string | null;
  modules: SprintModule[];
  quizThreshold: number;
  sprintTopic: string;
}

interface AssessmentEvidence {
  scorePercent: number | null;
  completedAt: string | null;
}

function mapBackendLevel(level: string): AssignmentLevel {
  return level === "cohort" ? "sprint" : (level as AssignmentLevel);
}

function mapBackendTasksToAssignedTasks(backendTasks: Task[]): AssignedTask[] {
  return backendTasks.map((task) => {
    const level = mapBackendLevel(task.level);
    const audienceName = task.audience_display_name || "";
    let subtasks: {
      id: string;
      title: string;
      description: string;
      submissionFormat: SubmissionFormat;
      questions: QuizQuestion[];
    }[] = [];
    let isMultiple = false;

    if (task.bundle_tasks && Array.isArray(task.bundle_tasks) && task.bundle_tasks.length > 0) {
      isMultiple = true;
      const normalizeFormat = (val: any): SubmissionFormat => {
        if (Array.isArray(val)) return (val[0] || 'text') as SubmissionFormat;
        return (val || 'text') as SubmissionFormat;
      };

      subtasks = task.bundle_tasks.map((sub, index) => ({
        id: index === 0 ? task.task_id : `${task.task_id}-${index}`,
        title: sub.title || "",
        description: sub.description || "",
        submissionFormat: normalizeFormat(sub.submission_format),
        questions: (sub.questions || []) as QuizQuestion[],
      }));
    } else {
      const rawFormats = task.submission_format;
      let formats: string[] = [];
      if (Array.isArray(rawFormats)) {
        formats = rawFormats;
      } else if (typeof rawFormats === 'string') {
        if (rawFormats.startsWith('[')) {
          try {
            formats = JSON.parse(rawFormats);
          } catch (e) {
            formats = [rawFormats];
          }
        } else {
          formats = [rawFormats];
        }
      } else {
        formats = ['text'];
      }

      subtasks = formats.map((fmt, index) => ({
        id: index === 0 ? task.task_id : `${task.task_id}-${fmt}`,
        title: task.title,
        description: task.description ?? "",
        submissionFormat: fmt as SubmissionFormat,
        questions: task.questions || [],
      }));
    }

    const submission = (task as any).submission || null;
    const statusNormalized = String(task.status || "").toLowerCase();
    const statusIsCompleted = statusNormalized.includes("completed") || statusNormalized.includes("submitted") || statusNormalized.includes("reviewed");
    const hasSubmission = task.submitted === true || Boolean(submission) || statusIsCompleted;

    const mapped = {
      id: task.assignment_id || task.task_id,
      level,
      mode: isMultiple ? ("multiple" as const) : ("single" as const),
      tasks: subtasks,
      targetSprints: level === "sprint" ? [audienceName].filter(Boolean) : [],
      targetOrgs: level === "org" ? [audienceName].filter(Boolean) : [],
      targetFunctions: level === "function" ? [audienceName].filter(Boolean) : [],
      targetSubFunctions: level === "sub_function" ? [audienceName].filter(Boolean) : [],
      targetIndividuals: level === "individual" ? [audienceName].filter(Boolean) : [],
      dueDate: task.due_date,
      createdAt: task.created_at,
      status: hasSubmission ? "Completed" : "Active",
      completionCount: task.completion_count,
      totalTargetUsersCount: task.total_target_count,
      recurrence: task.recurrence as AssignedTask["recurrence"],
      submitted: hasSubmission,
      submission: submission,
      bundle_tasks: task.bundle_tasks || [],
    } as AssignedTask;

    return mapped;
  });
}

export default function EmployeeWelcome() {
  const { user, loading: authLoading, logout, employeeData, isAdmin, isSuperAdmin, isDeveloper, isManager } = useAuth();
  const { activeCompanyId, isDeveloperMode, hasFeature } = useTenant();
  const router = useRouter();
  const hasTaskManagementAccess = hasFeature(FEATURES.TASK_MANAGEMENT);
  // --- Logic State ---
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [scoreHistory, setScoreHistory] = useState<any[]>([]);
  const [moduleProgress, setModuleProgress] = useState<any[]>([]);
  const [assignedModules, setAssignedModules] = useState<SprintItem[]>([]);
  const [plans, setPlans] = useState<any[]>([]);
  const [learningStyle, setLearningStyle] = useState<string | null>(null);
  const [baselineScore, setBaselineScore] = useState<number | null>(null);
  const [baselineMaxScore, setBaselineMaxScore] = useState<number | null>(null);
  const [allAssignedCompleted, setAllAssignedCompleted] = useState<boolean>(false);
  const [baselineRequired, setBaselineRequired] = useState<boolean>(true);
  const [companyStats, setCompanyStats] = useState({
    totalEmployees: 0,
    completedEmployees: 0,
    userRank: null as number | null,
    topPercentile: null as number | null,
  });
  const [nudgeMessage, setNudgeMessage] = useState<string>("");
  const [progressPercentage, setProgressPercentage] = useState<number>(0);
  const [showLoginToast, setShowLoginToast] = useState<boolean>(false);
  const [isNavOverlay, setIsNavOverlay] = useState<boolean>(false);
  const [companyLearningStyleEnabled, setCompanyLearningStyleEnabled] = useState<boolean>(false);
  const [selectedCertificateSprint, setSelectedCertificateSprint] = useState<SprintItem | null>(null);
  const [linkedinExpanded, setLinkedinExpanded] = useState<boolean>(false);
  const [linkedinProfileUrl, setLinkedinProfileUrl] = useState<string>("");
  const [linkedinError, setLinkedinError] = useState<string>("");
  const [isExportingCertificate, setIsExportingCertificate] = useState<boolean>(false);
  const [showLeaderboard, setShowLeaderboard] = useState<boolean>(false);
  const [showAllModules, setShowAllModules] = useState(false);
  const [showLoadingProgress, setShowLoadingProgress] = useState(true);
  const [activeHomeTab, setActiveHomeTab] = useState<"sprints" | "tasks">("sprints");

  // Sync basic loading state without fake UI delays
  useEffect(() => {
    setShowLoadingProgress(authLoading || loading);
  }, [authLoading, loading]);

  useEffect(() => {
    if (!hasTaskManagementAccess && activeHomeTab === "tasks") {
      setActiveHomeTab("sprints");
    }
  }, [hasTaskManagementAccess, activeHomeTab]);

  const toastShownRef = useRef(false);
  const prevUserRef = useRef<any>(null);
  const certificateRef = useRef<HTMLDivElement | null>(null);
  const isAdminUser = isAdmin || isSuperAdmin || isDeveloper || isManager;
  const effectiveCompanyId =
    (isDeveloperMode && activeCompanyId ? activeCompanyId : employee?.company_id) || "";
  const taskUserId = employee?.user_id || '';
  const {
    tasks,
    loading: tasksLoading,
    error: tasksError,
    refetch: refetchTasks
  } = useTasks(taskUserId, isAdminUser, effectiveCompanyId, hasTaskManagementAccess);

  const assignedTaskItems = useMemo(() => mapBackendTasksToAssignedTasks(tasks), [tasks]);
  // const { tasks: _tasks, loading: _loading, error: _error, refetch: refetchTasks } = useTasks(taskUserId, isAdminUser, effectiveCompanyId);
  // const assignedTaskItems = useMemo(() => mapBackendTasksToAssignedTasks(_tasks), [_tasks]);
  // NOTE: keep `tasks` variable compatible with other code by reusing _tasks
  // when necessary. Replace references below to use `assignedTaskItems` which
  // is derived from `_tasks`.
  // useEffect(() => {
  //   console.log("RAW BACKEND TASKS:", _tasks);
  //   console.log("MAPPED DASHBOARD TASKS:", assignedTaskItems);
  // }, [_tasks, assignedTaskItems]);

  const handleTaskSubmitResponse = async (payload: Omit<SubmitTaskPayload, "user_id">) => {
    if (!employee?.user_id) {
      throw new Error("Missing employee identity");
    }

    return submitTaskResponse(
      { ...payload, user_id: employee.user_id },
      { userId: employee.user_id, companyId: effectiveCompanyId }
    );
  };

  const handleTaskSubmitted = (
    taskId: string,
    title: string,
    score: number,
    totalQuestions: number,
    questionsList: any[]
  ) => {
    // After an optimistic local update in TaskDashboard, re-query the backend to
    // fetch the attached `submission` object for the assignment. This ensures
    // the UI shows the Verified & Complete badge that relies on backend data.
    try {
      refetchTasks();
    } catch (err) {
      console.warn('Refetch after submit failed', err);
    }
  };

const handleGenerateCertificate = (sprintId: string) => {
  const sprint = assignedModules.find((s) => s.id === sprintId);
  if (sprint && sprint.certificateEarned) {
    openCertificateModal(sprint);
  }
};

  // ─── Utility helpers ──────────────────────────────────────────────────────

  const sanitizeFileNameChunk = (value: string) =>
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "certificate";

  const toIso = (value: unknown): string | null => {
    if (!value || typeof value !== "string") return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  };

  const toNumberOrNull = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  /** Uppercase-trim a raw status string. */
  const normalizeStatus = (value: unknown) => String(value || "").trim().toUpperCase();

  const normalizeProcessedModuleIds = (value: unknown): string[] => {
    if (Array.isArray(value)) {
      return value.map((id) => String(id)).filter(Boolean);
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) return [];
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          return parsed.map((id) => String(id)).filter(Boolean);
        }
      } catch {
        return [trimmed];
      }
    }
    return [];
  };

  /**
   * Compute a 0-100 percentage score from a raw progress/assessment entry.
   * Handles: {score, max_score}, {quiz_score, max_score}, ratio (0-1), or raw %.
   */
  const computePercentScore = (entry: any): number | null => {
    const score = toNumberOrNull(
      entry?.quiz_score ?? entry?.quizScore ?? entry?.score
    );
    if (score === null) return null;

    const maxScore = toNumberOrNull(entry?.max_score ?? entry?.maxScore);
    if (maxScore && maxScore > 0) {
      return Number(((score / maxScore) * 100).toFixed(2));
    }

    // Treat values in (0,1] as ratios
    if (score > 0 && score <= 1) {
      return Number((score * 100).toFixed(2));
    }

    return score;
  };

  const formatCertificateDate = (isoDate: string | null) => {
    if (!isoDate) return "--";
    const date = new Date(isoDate);
    if (Number.isNaN(date.getTime())) return "--";
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  const formatTaskDate = (value?: string) => {
    if (!value) return "N/A";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "N/A";
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  const formatSubmissionLabel = (format: Task["submission_format"]) => {
    switch (format) {
      case "text":
        return "Written Response";
      case "image":
        return "Image Upload";
      case "multiple_choice":
        return "Multiple Choice";
      case "audio":
        return "Audio Recording";
      case "video":
        return "Video Recording";
      default:
        return format;
    }
  };

  const getTaskStatusColor = (status: string) => {
    const normalized = status?.toLowerCase();
    if (normalized === "completed" || normalized === "submitted") {
      return "bg-green-100 text-green-700";
    }
    if (normalized === "overdue") {
      return "bg-red-100 text-red-700";
    }
    if (normalized === "due_soon" || normalized === "pending") {
      return "bg-yellow-100 text-yellow-700";
    }
    return "bg-slate-100 text-slate-700";
  };

  // ─────────────────────────────────────────────────────────────────────────────
  // buildSprintsFromPlans
  //
  // Certificate logic (FIXED):
  //   • A module PASSES when:  pass_status === true  OR  quizScore >= threshold
  //   • A module is COMPLETE when: completed_at is set, status === "COMPLETED",
  //     or pass_status is true
  //   • certificateEarned = every module is COMPLETE AND every module PASSES
  //                         OR backend plan.status === "COMPLETED" / overall_status = true
  //
  // Sprint status (FIXED):
  //   • "completed"   → certificateEarned
  //   • "in_progress" → at least one module has any progress but not all complete
  //   • "not_started" → no progress at all
  //
  // Button label (consumed in JSX):
  //   • certificateEarned            → "Review Sprint"  +  "View Certificate"
  //   • in_progress                  → "Continue"
  //   • not_started                  → "Start your sprint"
  // ─────────────────────────────────────────────────────────────────────────────
  const buildSprintsFromPlans = (
    plans: any[],
    modules: any[],
    progress: any[],
    assessmentEvidenceByModuleId?: Record<string, AssessmentEvidence[]>,
    baselineEvidenceByModuleId?: Record<string, AssessmentEvidence[]>,
  ): SprintItem[] => {
    // Only process plans the user is actually assigned to
    const assignedPlans = plans.filter((p: any) => {
      const status = normalizeStatus(p?.status);
      return (
        status === "ASSIGNED" ||
        status === "IN_PROGRESS" ||
        status === "COMPLETED"
      );
    });

    // Quick lookup: module_id → title
    const moduleTitleById: Record<string, string> = {};
    for (const m of modules) {
      if (m?.module_id) {
        moduleTitleById[String(m.module_id)] = m.title || `Module ${m.module_id}`;
      }
    }

    // ── Build a multi-key index into the progress array ───────────────────
    // We index by every ID that could link a progress row to a plan module.
    const progressByAnyId = new Map<string, any[]>();
    const addToIndex = (key: string | null | undefined, entry: any) => {
      if (!key) return;
      const k = String(key).trim();
      if (!k) return;
      const arr = progressByAnyId.get(k) || [];
      arr.push(entry);
      progressByAnyId.set(k, arr);
    };

    for (const entry of progress) {
      addToIndex(entry?.module_id, entry);
      addToIndex(entry?.original_module_id, entry);
      addToIndex(entry?.processed_module_id, entry);

      // Nested processed_modules object (some APIs embed it)
      const nested = Array.isArray(entry?.processed_modules)
        ? entry.processed_modules
        : entry?.processed_modules
        ? [entry.processed_modules]
        : [];
      for (const pm of nested) {
        addToIndex(pm?.original_module_id, entry);
        addToIndex(pm?.processed_module_id, entry);
      }
    }

    // ── Helper: pick the best progress entry for a set of candidate IDs ───
    // "Best" = has a completed_at, or a pass_status, or a quiz_score.
    const findBestProgress = (...ids: Array<string | null | undefined>): any | null => {
    for (const id of ids) {
        if (!id) continue;
        const entries = progressByAnyId.get(String(id).trim()) || [];
        if (!entries.length) continue;
        // Prefer entries that look "most complete"
        const scored = entries
          .map((e) => ({
            e,
            weight:
              (e?.completed_at ? 4 : 0) +
              (e?.pass_status ? 2 : 0) +
              (e?.quiz_score !== null && e?.quiz_score !== undefined ? 1 : 0),
          }))
          .sort((a, b) => b.weight - a.weight);
        return scored[0].e;
      }
      return null;
    };

    const baselineCompletedModuleIds = new Set<string>(
      (plans || [])
        .filter((plan: any) => normalizeStatus(plan?.status) === "BASELINE_COMPLETED")
        .map((plan: any) => String(plan?.module_id ?? plan?.id ?? "").trim())
        .filter(Boolean),
    );

    return assignedPlans.map((p: any) => {
      const sprintId = String(p.module_id ?? p.id ?? "");
      const threshold =
        toNumberOrNull(p.quiz_threshold ?? p.quizThreshold) ?? DEFAULT_QUIZ_THRESHOLD;

      const modulesInPlan: any[] = Array.isArray(p?.plan_json?.modules)
        ? p.plan_json.modules
        : [];

      const baselineEnabled =
        p?.baseline_assessment === true || p?.baseline_assessment === 1;
      const planJsonProcessedModuleIds = modulesInPlan
        .map((mod: any) => String(mod?.processed_module_id ?? "").trim())
        .filter(Boolean);

      // Baseline plans assign a personalized subset in plan_json.modules.
      // Non-baseline plans assign the full processed_module_ids collection.
      // Set preserves the source order while protecting the denominator from
      // accidental duplicate IDs.
      const processedModuleIds = Array.from(
        new Set(
          baselineEnabled
            ? planJsonProcessedModuleIds
            : normalizeProcessedModuleIds(p?.processed_module_ids),
        ),
      );

      // ── Determine if the backend already says "COMPLETED" ─────────────
      const isBackendCompleted = Boolean(
        p.overall_status === true ||
          p.overall_status === 1 ||
          p.overall_status === "true" ||
          normalizeStatus(p?.status) === "COMPLETED",
      );

      const baselineEvidence = baselineEvidenceByModuleId?.[sprintId] || [];
      const baselineCompleted =
        baselineCompletedModuleIds.has(sprintId) ||
        baselineEvidence.some((ev) => Boolean(ev.completedAt)) ||
        baselineEvidence.length > 0;
      const baselineScore =
        baselineEvidence.length > 0
          ? baselineEvidence
              .map((ev) => ev.scorePercent)
              .filter((value): value is number => typeof value === "number")
              .at(-1) ?? null
          : null;
      const baselineMaxScore = baselineEvidence.length > 0 ? 100 : null;

      // ── Build the SprintModule list ───────────────────────────────────
      let sprintModules: SprintModule[] = [];

      if (modulesInPlan.length > 0) {
        // Case 1: Plan ships an explicit modules array
        sprintModules = modulesInPlan.map((mod: any, index: number) => {
          // Use the positionally-aligned processedModuleId first, then fall back
          // to whatever ID is on the module object itself.
          const processedIdFromPlan = processedModuleIds[index] ?? null;
          const modOwnId = String(
            mod?.processed_module_id ?? mod?.id ?? mod?.module_id ?? ""
          );
          const modId = processedIdFromPlan || modOwnId || `${sprintId}-${index + 1}`;

          const pr = findBestProgress(
            processedIdFromPlan,
            modOwnId,
            mod?.original_module_id,
          );

          const prStatus = normalizeStatus(pr?.status);

          // Compute score, prefer the progress row over the plan module snapshot
          const fallbackAssessments = assessmentEvidenceByModuleId?.[modId] || [];
          const fbMax =
            fallbackAssessments.length > 0
              ? Math.max(...fallbackAssessments.map((e) => e.scorePercent ?? -Infinity))
              : null;

          let quizScore: number | null =
            computePercentScore(pr) ??
            toNumberOrNull(mod?.quizScore) ??
            (fbMax !== null && fbMax > -Infinity ? fbMax : null);

          // A module is COMPLETE when:
          // - It has completed_at set AND
          // - It has passStatus === true OR quizScore >= threshold
          const passStatus = Boolean(pr?.pass_status);
          const completed = Boolean(pr?.completed_at) && (passStatus || (quizScore !== null && quizScore >= threshold));

          const moduleObj = {
            id: modId,
            name: String(mod?.name ?? mod?.title ?? `Module ${index + 1}`),
            completed,
            quizScore,
            passStatus,
            completedAt: toIso(pr?.completed_at ?? mod?.completedAt),
          };

          return moduleObj;
        });
      } else if (processedModuleIds.length > 0) {
        // Case 2: No modules array, but we have processed_module_ids
        sprintModules = processedModuleIds.map((pmId: string, index: number) => {
          const pr = findBestProgress(pmId);
          
          // Compute score FIRST
          const fallbackAssessments = assessmentEvidenceByModuleId?.[pmId] || [];
          const fbMax =
            fallbackAssessments.length > 0
              ? Math.max(
                  ...fallbackAssessments.map((e) => e.scorePercent ?? -Infinity),
                )
              : null;
          const quizScore =
            computePercentScore(pr) ??
            (fbMax !== null && fbMax > -Infinity ? fbMax : null);

          // A module is COMPLETE when:
          // - It has completed_at set AND
          // - It has passStatus === true OR quizScore >= threshold
          const passStatus = Boolean(pr?.pass_status);
          const completed = Boolean(pr?.completed_at) && (passStatus || (quizScore !== null && quizScore >= threshold));

          const moduleObj = {
            id: pmId,
            name: String(
              pr?.processed_modules?.title ??
                pr?.module_title ??
                `Module ${index + 1}`,
            ),
            completed,
            quizScore,
            passStatus,
            completedAt: toIso(pr?.completed_at),
          };

          return moduleObj;
        });
      } else {
        // Case 3: No explicit module list — synthesise from progress rows
        // (de-duplicate by a stable key)
        const relatedRaw = [
          ...(progressByAnyId.get(sprintId) || []),
          ...processedModuleIds.flatMap((id) => progressByAnyId.get(id) || []),
        ];

        const seen = new Set<string>();
        const relatedProgress = relatedRaw.filter((entry: any) => {
          const key = String(
            entry?.module_progress_id ??
              `${entry?.processed_module_id || ""}-${entry?.user_id || ""}-${entry?.started_at || ""}`,
          );
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });

        if (relatedProgress.length > 0) {
          sprintModules = relatedProgress.map((pr: any, index: number) => {
            const quizScore = computePercentScore(pr);
            const passStatus = Boolean(pr?.pass_status);
            // A module is COMPLETE when:
            // - It has completed_at set AND
            // - It has passStatus === true OR quizScore >= threshold
            const completed = Boolean(pr?.completed_at) && (passStatus || (quizScore !== null && quizScore >= threshold));
            
            return {
              id: String(
                pr?.module_id ??
                  pr?.processed_module_id ??
                  `${sprintId}-${index + 1}`,
              ),
              name: String(
                pr?.processed_modules?.title ??
                  pr?.module_title ??
                  `Module ${index + 1}`,
              ),
              completed,
              quizScore,
              passStatus,
              completedAt: toIso(pr?.completed_at),
            };
          });
        } else {
          // Case 4: Absolute fallback — treat the plan itself as one module
          const fallbackAssessments =
            assessmentEvidenceByModuleId?.[sprintId] || [];
          const fbMax =
            fallbackAssessments.length > 0
              ? Math.max(
                  ...fallbackAssessments.map((e) => e.scorePercent ?? -Infinity),
                )
              : null;

          sprintModules = [
            {
              id: sprintId || "unknown",
              name:
                moduleTitleById[sprintId] ||
                p.module_name ||
                p.module_title ||
                p.title ||
                `Module ${sprintId || ""}`,
              // A module is COMPLETE ONLY when backend says so OR it has completed_at
              completed:
                isBackendCompleted ||
                Boolean(p?.completed_at) ||
                fallbackAssessments.some((ev) => ev.completedAt !== null),
              quizScore:
                fbMax !== null && fbMax > -Infinity
                  ? fbMax
                  : computePercentScore(p),
              passStatus: Boolean(p?.pass_status),
              completedAt:
                fallbackAssessments
                  .map((ev) => ev.completedAt)
                  .filter((v): v is string => Boolean(v))
                  .sort()
                  .at(-1) ?? toIso(p.completed_at),
            },
          ];
        }
      }

      // ── Certificate eligibility ───────────────────────────────────────
      //   SIMPLE LOGIC: Certificate is ONLY earned when:
      //     ALL modules have completed === true
      //   OR the backend explicitly says COMPLETED
      
      // Canonical progress rule: assigned IDs come only from
      // learning_plan.processed_module_ids; completed_at alone marks completion.
      // plan_json supplies display metadata, not assignment membership.
      const metadataByProcessedId = new Map<string, any>();
      modulesInPlan.forEach((mod: any) => {
        const id = String(mod?.processed_module_id ?? "").trim();
        if (id) metadataByProcessedId.set(id, mod);
      });

      sprintModules = processedModuleIds.map((processedModuleId, index) => {
        const mod =
          metadataByProcessedId.get(processedModuleId) ??
          modulesInPlan[index] ??
          null;
        const pr = findBestProgress(processedModuleId);

        return {
          id: processedModuleId,
          name: String(
            mod?.name ??
              mod?.title ??
              pr?.processed_modules?.title ??
              pr?.module_title ??
              `Module ${index + 1}`,
          ),
          completed: Boolean(pr?.completed_at),
          quizScore: computePercentScore(pr),
          passStatus: Boolean(pr?.pass_status),
          completedAt: toIso(pr?.completed_at),
        };
      });

      const hasModules = sprintModules.length > 0;

      const allModulesComplete =
        hasModules &&
        sprintModules.every((mod) => mod.completed === true);

      const certificateEarned = allModulesComplete;

      // ── Sprint-level completion date ──────────────────────────────────
      //   Use the latest completedAt among modules; fall back to plan date.
      const completedDate = certificateEarned
        ? ([...sprintModules]
            .map((mod) => mod.completedAt)
            .filter((v): v is string => Boolean(v))
            .sort()
            .at(-1) ??
          toIso(p.completed_at) ??
          new Date().toISOString())
        : null;

      // ── Sprint status ─────────────────────────────────────────────────
      //   "completed"   → certificate earned
      //   "in_progress" → at least one module has been touched
      //   "not_started" → nothing done yet
      const completedModuleCount = sprintModules.filter(
        (mod) => mod.completed,
      ).length;

      let status: SprintStatus;
      if (certificateEarned) {
        status = "completed";
      } else if (completedModuleCount > 0) {
        status = "in_progress";
      } else {
        status = "not_started";
      }

      return {
        id: sprintId,
        title:
          moduleTitleById[sprintId] ||
          p.module_name ||
          p.module_title ||
          p.title ||
          `Module ${sprintId}`,
        moduleName: p.module_name || p.module_title || p.title || null,
        hasBaseline:
          p.baseline_assessment === 1 || p.baseline_assessment === true,
        baselineCompleted,
        baselineScore,
        baselineMaxScore,
        status,
        certificateEarned,
        completedDate,
        modules: sprintModules,
        quizThreshold: threshold,
        sprintTopic:
          p.topic ||
          p.module_topic ||
          p.module_name ||
          p.title ||
          "professional development",
      };
    });
  };

  // ─── Certificate modal helpers ─────────────────────────────────────────────

  const openCertificateModal = (sprint: SprintItem) => {
    setSelectedCertificateSprint(sprint);
    setLinkedinExpanded(false);
    setLinkedinProfileUrl("");
    setLinkedinError("");
  };

  const closeCertificateModal = () => {
    setSelectedCertificateSprint(null);
    setLinkedinExpanded(false);
    setLinkedinProfileUrl("");
    setLinkedinError("");
  };

  const downloadCertificatePdf = async () => {
    if (!selectedCertificateSprint || !certificateRef.current || isExportingCertificate)
      return;

    try {
      setIsExportingCertificate(true);
      const canvas = await html2canvas(certificateRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("landscape", "pt", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      const imgWidth = canvas.width;
      const imgHeight = canvas.height;
      const ratio = Math.min(
        (pageWidth - 40) / imgWidth,
        (pageHeight - 40) / imgHeight,
      );
      const renderWidth = imgWidth * ratio;
      const renderHeight = imgHeight * ratio;
      const x = (pageWidth - renderWidth) / 2;
      const y = (pageHeight - renderHeight) / 2;

      pdf.addImage(imgData, "PNG", x, y, renderWidth, renderHeight);

      const sprintSlug = sanitizeFileNameChunk(
        selectedCertificateSprint.title || "sprint",
      );
      const userSlug = sanitizeFileNameChunk(
        employee?.name || employee?.email || user?.email || "user",
      );
      pdf.save(`lucid-certificate-${sprintSlug}-${userSlug}.pdf`);
    } catch (error) {
      console.error("[Certificate] Failed to download PDF:", error);
    } finally {
      setIsExportingCertificate(false);
    }
  };

  const shareOnLinkedIn = () => {
    if (!selectedCertificateSprint) return;
    setLinkedinError("");

    const profileUrl = linkedinProfileUrl.trim();
    if (!profileUrl) {
      setLinkedinError("Please paste your LinkedIn profile URL.");
      return;
    }

    let parsed: URL;
    try {
      parsed = new URL(profileUrl);
    } catch {
      setLinkedinError("Please enter a valid URL (including https://).");
      return;
    }

    if (!parsed.hostname.toLowerCase().includes("linkedin.com")) {
      setLinkedinError("Please provide a valid LinkedIn profile URL.");
      return;
    }

    const message = `🎉 Excited to share that I've successfully completed the '${selectedCertificateSprint.title}' sprint on Lucid!\n\nThis sprint deepened my understanding of ${selectedCertificateSprint.sprintTopic} and helped me grow professionally through hands-on learning and collaboration.\n\nA huge thank you to the entire team and the Lucid platform for making this learning journey possible. Looking forward to the next sprint! 🚀\n\n#Lucid #LearningAndDevelopment #SprintComplete #ProfessionalGrowth`;

    const shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(profileUrl)}&summary=${encodeURIComponent(message)}`;
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  };

  // ─── Data fetching ─────────────────────────────────────────────────────────

  // const fetchUserByEmail = async (email: string) => {
  //   try {
  //     const res = await fetchWithAuth(
  //       `${API_BASE}/api/users/by-email/${encodeURIComponent(email)}`,
  //     );
  //     if (!res.ok) return null;
  //     const payload = await res.json();
  //     let u = payload?.user ?? payload;
  //     if (Array.isArray(u)) u = u[0];
  //     return u || null;
  //   } catch {
  //     return null;
  //   }
  // };

  const fetchDashboardData = async (
    employeeData: any,
    effectiveCompanyId: string,
  ) => {
    const userId = employeeData.user_id || employeeData.id || "";
    
    const result = await sharedDataClient.query(
      createCacheKey({
        namespace: "dashboard",
        tenantId: effectiveCompanyId,
        userId: userId,
        path: "/employee/dashboard",
      }),
      async () => {
        const headers = {
          "X-User-ID": userId,
          "X-Company-ID": effectiveCompanyId,
        };

        // const [plansRes, modulesRes, progressRes, companyRes, learningStyleRes, dashboard_summary]: any[] = await Promise.all([
        //   fetchWithAuth(`${API_BASE}/api/learning-plans/?user_id=${employeeData.user_id}`, { headers }).then((r) => (r.ok ? r.json() : ({} as any))),
        //   fetchWithAuth(`${API_BASE}/api/training-modules/company/${employeeData.company_id}`, { headers }).then((r) => (r.ok ? r.json() : ({} as any))),
        //   fetchWithAuth(`${API_BASE}/api/module-progress/user/${employeeData.user_id}`, { headers }).then((r) => (r.ok ? r.json() : ({} as any))),
        //   fetchWithAuth(`${API_BASE}/api/companies/${encodeURIComponent(employeeData.company_id)}`, { headers }).then((r) => (r.ok ? r.json() : ({} as any))),
        //   fetchWithAuth(`${API_BASE}/api/learning-style?user_id=${encodeURIComponent(employeeData.user_id)}`, { headers }).then((r) => (r.ok ? r.json() : ({} as any))),
        //   fetchWithAuth(`${API_BASE}/api/employee/dashboard_summary/${encodeURIComponent(userId)}`, { headers }).then((r) => (r.ok ? r.json() : ({} as any))),
        
        // ]);
        
        const dashboard_summary = await fetchWithAuth(`${API_BASE}/api/employee/dashboard_summary/${encodeURIComponent(userId)}`, { headers }).then((r)=> r.ok ? r.json() : ({} as any));
        
        // console.log("Fetched dashboard data:", {
        //   plans: plansRes,
        //   modules: modulesRes,
        //   progress: progressRes,
        //   company: companyRes,
        //   learningStyle: learningStyleRes,
        //    dashboard_summary:dashboard_summary,
        // });

        // const dashBoardData = dashboard_summary;
        
     
        return {
          plans: dashboard_summary?.plans || [],
          modules: dashboard_summary?.modules || [],
          progress: dashboard_summary?.progress || [],
          company: dashboard_summary?.company || null,
          learningStyle: dashboard_summary?.learning_style || null,
          assessmentEvidenceByModuleId: dashboard_summary.assessment_evidence_by_module_id || {},
          baselineEvidenceByModuleId: dashboard_summary.baseline_evidence_by_module_id || {},
          userRank: dashboard_summary.user_rank || null,
          totalUsers: dashboard_summary.total_users || 0,
        };
      },
      {
        ttlMs: 60 * 1000,
        swr: true,
        swrMs: 300 * 1000,
      },
    );
    return result.data;
  };

  const loadDashboard = async () => {
    if (!user?.email) return;

    try {
      setLoading(true);
      const emp = employeeData;
      if (!emp) {
        return;
      }

      setEmployee(emp);

      const selectedCompanyId =
        isDeveloperMode && activeCompanyId ? activeCompanyId : emp.company_id;

      if (!selectedCompanyId) {
        setLoading(false);
        return;
      }

      const data = await fetchDashboardData(emp, selectedCompanyId);
      const plans = data?.plans || [];
      setPlans(plans);
      // console.log("RAW PLANS", plans);
      const modules = data?.modules || [];
      const progress = Array.isArray(data?.progress) ? data.progress : [];
      const assessmentEvidenceByModuleId =
        data?.assessmentEvidenceByModuleId || {};
      const baselineEvidenceByModuleId =
        data?.baselineEvidenceByModuleId || {};

      const mappedAssigned = buildSprintsFromPlans(
        plans,
        modules,
        progress,
        assessmentEvidenceByModuleId,
        baselineEvidenceByModuleId,
      );
      // console.log("Mapped assigned modules:", mappedAssigned);
      setAssignedModules(mappedAssigned);
      setModuleProgress(progress);
      setLearningStyle(data?.learningStyle || null);
      setCompanyLearningStyleEnabled(
        Boolean(data?.company?.learning_style_enabled),
      );

      const baselineNeeded = plans.some(
        (plan: any) =>
          plan.baseline_assessment === 1 || plan.baseline_assessment === true,
      );
      setBaselineRequired(baselineNeeded);

      const completedCount = mappedAssigned.filter(
        (p) => p.status === "completed",
      ).length;
      const totalAssigned = mappedAssigned.length;
      const progressValue =
        totalAssigned > 0
          ? Math.round((completedCount / totalAssigned) * 100)
          : 0;
      setProgressPercentage(progressValue);

      const totalUsers = data?.totalUsers ?? 0;
      setCompanyStats({
        totalEmployees: totalUsers,
        completedEmployees: completedCount,
        userRank: data?.userRank?.rank ?? null,
        topPercentile: data?.userRank?.top_percentile ?? null,
      });
      generateNudgeMessage(
        progressValue,
        data?.userRank?.rank ?? null,
        totalUsers,
        data?.userRank?.top_percentile ?? 10,
        completedCount
      );
    } catch (e) {
      console.error("[Welcome] loadDashboard failed:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && user) {
      loadDashboard();
    }
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, activeCompanyId, isDeveloperMode]);

   const generateNudgeMessage = (progress: number, rank: number | null, total: number, percentile: number, completed: number) => {
     if (progress === 100) setNudgeMessage("🎉 Congratulations! You've completed your Performance Sprint!");
     if (progress === 100) setNudgeMessage("🎉 Congratulations! You've completed your Performance Sprint!");
     else setNudgeMessage(`💪 One step in! Complete your sprints and stand among the top 5%.`);
   };

    if (showLoadingProgress) {
    return (
      <LoadingProgress
        label="Loading your dashboard"
      />
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      <main className="min-h-screen pt-4 md:pt-8 pb-8 md:pb-12 px-4 sm:px-6 lg:px-8 relative">
        <LeaderboardModal
          open={showLeaderboard}
          onOpenChange={setShowLeaderboard}
          employee={employee}
        />

        {/* Fixed Leaderboard Button (Positioned directly below the company logo pill for responsiveness) */}
        <Button
          onClick={() => setShowLeaderboard(true)}
          variant="outline"
          className="fixed top-[36px] right-4 z-50 rounded-xl border border-slate-200 bg-white/95 backdrop-blur shadow-sm hover:bg-amber-50 hover:border-amber-200 transition-colors flex items-center justify-center"
          title="View leaderboard"
          size="icon"
        >
          <Trophy className="w-5 h-5 text-amber-500" />
        </Button>

        <div className="max-w-6xl mx-auto w-full">
          {/* Dashboard Header */}
          <div className="mb-6 md:mb-10 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex items-center gap-3 sm:gap-4 min-w-0 w-full sm:w-auto">
              <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white rounded-2xl shadow-sm flex items-center justify-center border border-slate-100 shrink-0">
                <Users className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight break-words">
                  {employee?.name
                    ? `Welcome, ${employee.name.split(" ")[0]}`
                    : "Learner Dashboard"}
                </h1>
                <p className="text-xs sm:text-sm text-slate-500 font-medium break-all sm:break-normal">
                  {employee?.email || "Personalized learning hub"}
                </p>
              </div>
            </div>
            <div className="w-full md:w-[320px]">
              <CompanySelector showLabel />
            </div>
          </div>

          <div className="grid gap-4 md:gap-8">
            {/* Progress Nudge Card */}
            {nudgeMessage && (
              <Card className="rounded-3xl border-none shadow-[0_8px_30px_rgb(0,0,0,0.04)] bg-white overflow-hidden">
                <CardContent className="p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                      <div className="w-10 h-10 sm:w-14 sm:h-14 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
                        {progressPercentage === 100 ? (
                          <Trophy className="text-blue-600 w-5 h-5 sm:w-6 sm:h-6" />
                        ) : (
                          <Zap className="text-blue-600 w-5 h-5 sm:w-6 sm:h-6" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-base sm:text-lg font-black text-slate-900">
                          Your Progress
                        </h3>
                        <p className="text-slate-500 mt-1 font-medium leading-relaxed text-xs sm:text-sm">
                          {nudgeMessage}
                        </p>
                        <div className="flex flex-wrap gap-2 mt-3">
                          <Badge
                            variant="secondary"
                            className="bg-slate-100 text-slate-600 border-none font-bold text-[10px] sm:text-xs"
                          >
                            {companyStats.completedEmployees} COMPLETED
                            {/* {companyStats.completedEmployees} COMPLETED */}
                          </Badge>
                        </div>
                      </div>
                    </div>
                    <div className="flex flex-col items-center justify-center self-center sm:self-auto">
                      <div
                        className={`relative w-20 h-20 sm:w-24 sm:h-24 rounded-full flex items-center justify-center bg-white border-4 ${
                          progressPercentage >= 100
                            ? "border-green-100"
                            : "border-blue-50"
                        }`}
                      >
                        <span
                          className={`text-lg sm:text-2xl font-black ${
                            progressPercentage >= 100
                              ? "text-green-600"
                              : "text-blue-600"
                          }`}
                        >
                          {progressPercentage.toFixed(1)}%
                          {/* {progressPercentage.toFixed(1)}% */}
                        </span>
                      </div>
                      <div className="mt-2 text-[10px] sm:text-xs font-black uppercase tracking-[0.05em] text-slate-400 text-center">
                        {companyStats.completedEmployees} of {assignedModules.length}
                        {/* {companyStats.completedEmployees} of {assignedModules.length} */}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Learning Style Card */}
            {companyLearningStyleEnabled && (
              <Card className="rounded-2xl border-none shadow-sm bg-white overflow-visible">
                <CardContent className="p-4 sm:p-6">
                  {learningStyle ? (
                    <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 text-center sm:text-left">
                      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-blue-600 text-white flex items-center justify-center text-xl sm:text-2xl font-black shadow-xl shadow-blue-100 shrink-0">
                        {learningStyle}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm sm:text-base font-extrabold text-slate-900">
                          Your Learning Style
                        </h4>
                        <div className="mt-2 text-xs sm:text-sm text-slate-500">
                          <LearningStyleBlurb styleCode={learningStyle} />
                        </div>
                        <Button
                          variant="link"
                          className="text-blue-600 font-bold p-0 h-auto mt-3 text-xs sm:text-sm"
                          onClick={() => router.push("/employee/score-history")}
                        >
                          Get full report <ArrowRight size={14} className="ml-1" />
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-col sm:flex-row items-center justify-center sm:justify-between gap-4">
                      <div className="w-full sm:max-w-md text-center sm:text-left">
                        <h4 className="text-base md:text-lg font-black text-slate-900 mb-1">
                          Discover Your Learning Style
                        </h4>
                        <p className="text-xs md:text-sm text-slate-500 font-medium">
                          Take our 5-minute survey to unlock your personalized path.
                        </p>
                      </div>
                      <div className="relative mt-2 sm:mt-0">
                        <div className="hidden sm:block absolute -top-20 sm:-top-24 right-0 z-10 w-64 sm:w-72 animate-bounce">
                          <div className="bg-blue-600 text-white rounded-2xl px-4 sm:px-5 py-2 sm:py-3 shadow-xl text-xs sm:text-sm">
                            <p className="font-black text-xs sm:text-sm">
                              Step 1: Start Here!
                            </p>
                            <p className="text-blue-100 text-[10px] sm:text-xs">
                              Complete survey to unlock modules.
                            </p>
                            <div className="absolute right-8 -bottom-2 w-4 h-4 bg-blue-600 rotate-45"></div>
                          </div>
                        </div>
                        <Button
                          onClick={() =>
                            router.push("/employee/learning-style")
                          }
                          className="bg-slate-900 hover:bg-black text-white px-6 sm:px-8 py-2 sm:py-3 rounded-xl font-bold h-10 sm:h-11 text-xs sm:text-sm"
                        >
                          Take Survey
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            
             {/* Assigned Modules */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <button
                onClick={() => setActiveHomeTab("sprints")}
                className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-bold border transition-colors ${
                  activeHomeTab === "sprints"
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                Assigned Sprints
                <span
                  className={`ml-2 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                    activeHomeTab === "sprints"
                      ? "bg-white/20 text-white"
                      : "bg-slate-100 text-slate-700"
                  }`}
                >
                  {assignedModules.length}
                </span>
              </button>
              
              {/* Assigned Tasks - Only visible for Tier 3 */}
              <FeatureGate feature={FEATURES.TASK_MANAGEMENT}>
                <button
                  onClick={() => setActiveHomeTab("tasks")}
                  className={`px-3 sm:px-4 py-2 rounded-lg text-xs sm:text-sm font-bold border transition-colors ${
                    activeHomeTab === "tasks"
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  Assigned Tasks
                  <span
                    className={`ml-2 inline-flex items-center justify-center rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      activeHomeTab === "tasks"
                        ? "bg-white/20 text-white"
                        : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {tasks.length}
                  </span>
                </button>
              </FeatureGate>
              
            </div>

            {activeHomeTab === "sprints" || !hasTaskManagementAccess ? (
            <AssignedSprintsSection
              assignedModules={assignedModules}
              moduleProgress={moduleProgress}
              plans ={plans}
              userId={employee?.user_id || ""}
              companyId={effectiveCompanyId}
              isLocked={companyLearningStyleEnabled && !learningStyle}
              onGenerateCertificate={handleGenerateCertificate}
            />
            ) : (
              <FeatureGate feature={FEATURES.TASK_MANAGEMENT}>
                <div className="space-y-8">
                  {tasksLoading ? (
                    <Card className="rounded-2xl border-none shadow-sm bg-white overflow-hidden">
                      <CardContent className="p-6 text-sm text-slate-500">Loading tasks...</CardContent>
                    </Card>
                  ) : tasksError ? (
                    <Card className="rounded-2xl border-none shadow-sm bg-white overflow-hidden">
                      <CardContent className="p-6 text-sm text-red-600 font-medium">{tasksError}</CardContent>
                    </Card>
                  ) : assignedTaskItems.length === 0 ? (
                    <Card className="rounded-2xl border-none shadow-sm bg-white overflow-hidden">
                      <CardContent className="p-6 text-sm text-slate-500">No tasks assigned</CardContent>
                    </Card>
                  ) : (
                    <TaskDashboard
                      assignedTasks={assignedTaskItems}
                      onStartCreateTask={() => {}}
                      userRole="employee"
                      onSubmitTaskResponse={handleTaskSubmitResponse}
                      onTaskSubmitted={handleTaskSubmitted}
                    />
                  )}

                </div>
              </FeatureGate>
            )}

             {/* Progress History */}
             {/* <Card className="rounded-2xl border-none shadow-sm bg-white overflow-hidden">
               <CardHeader className="px-8 py-6">
                 <CardTitle className="text-lg font-black text-slate-900">Recent Activity</CardTitle>
               </CardHeader>
               <CardContent className="px-8 pb-8">
                 <div className="space-y-4">
                   {moduleProgress.length === 0 ? (
                     <p className="text-slate-400 font-medium text-center py-4">No activity yet.</p>
                   ) : (
                     moduleProgress.map((mod) => (
                       <div key={mod.processed_module_id} className="flex items-center gap-4 p-4 rounded-xl bg-slate-50/50 border border-slate-100/50">
                         <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${mod.completed_at ? 'bg-green-100 text-green-600' : 'bg-blue-50 text-blue-600'}`}>
                           {mod.completed_at ? <CheckCircle2 size={20} /> : <Clock size={20} />}
                         </div>
                         <div className="flex-1 overflow-hidden">
                           <p className="font-bold text-slate-900 truncate">{mod.processed_modules?.title || `Module ${mod.processed_module_id}`}</p>
                           <p className="text-xs text-slate-500 font-medium">{mod.completed_at ? 'Finished' : 'In Progress'}</p>
                         </div>
                         {mod.quiz_score !== null && (
                           <Badge className="bg-white border-slate-200 text-slate-600 font-bold">Score: {mod.quiz_score}%</Badge>
                         )}
                       </div>
                     ))
                   )}
                 </div>
               </CardContent>
             </Card> */}
            </div>
          </div>
        </main>

      {/* Certificate Modal */}
            {selectedCertificateSprint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="relative w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6 py-4">
              <div>
                <h3 className="text-lg sm:text-xl font-black text-slate-900">
                  Sprint Certificate
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 font-medium">
                  Preview and download your certificate
                </p>
              </div>

              <button
                onClick={closeCertificateModal}
                className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors"
                aria-label="Close certificate modal"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-6">
              <CertificateTemplate
                ref={certificateRef}
                recipientName={employee?.name || employee?.email || "Learner"}
                sprintName={selectedCertificateSprint.title}
                completionDate={formatCertificateDate(selectedCertificateSprint.completedDate)}
              />

              <div className="flex flex-col sm:flex-row gap-3 sm:justify-end">
                <Button
                  variant="outline"
                  onClick={() => setLinkedinExpanded((prev) => !prev)}
                  className="rounded-xl"
                >
                  <Linkedin className="w-4 h-4 mr-2" />
                  Share on LinkedIn
                </Button>

                <Button
                  onClick={downloadCertificatePdf}
                  disabled={isExportingCertificate}
                  className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white"
                >
                  <Download className="w-4 h-4 mr-2" />
                  {isExportingCertificate ? "Generating..." : "Download PDF"}
                </Button>
              </div>

              {linkedinExpanded && (
                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                  <label className="block text-sm font-bold text-slate-700 mb-2">
                    LinkedIn Profile URL
                  </label>
                  <input
                    type="url"
                    value={linkedinProfileUrl}
                    onChange={(e) => setLinkedinProfileUrl(e.target.value)}
                    placeholder="https://www.linkedin.com/in/your-profile"
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {linkedinError && (
                    <p className="mt-2 text-sm text-red-600 font-medium">{linkedinError}</p>
                  )}

                  <div className="mt-3 flex justify-end">
                    <Button
                      onClick={shareOnLinkedIn}
                      className="rounded-lg bg-slate-900 hover:bg-black text-white"
                    >
                      Post to LinkedIn
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
// ─── SprintRow ─────────────────────────────────────────────────────────────────
// Extracted into its own component to keep button logic clear and testable.
//
// Button rules:
//   certificateEarned  → "View Certificate" (blue outline) + "Review Sprint" (grey)
//   status=in_progress → "Continue" (blue outline)
//   status=not_started → "Start your sprint" (blue filled)
//
// The "Baseline" button appears only when the sprint HAS a baseline AND the
// certificate has NOT been earned yet (i.e., user hasn't fully completed it).
// ──────────────────────────────────────────────────────────────────────────────
function SprintRow({
  sprint,
  onViewCertificate,
  onNavigate,
}: {
  sprint: SprintItem;
  onViewCertificate: (sprint: SprintItem) => void;
  onNavigate: (path: string) => void;
}) {
  const trainingPlanPath = `/employee/training-plan?module_id=${sprint.id}`;
  const assessmentPath = `/employee/assessment?moduleId=${sprint.id}`;

  return (
    <div className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-4 md:p-6 bg-white">
      {/* Sprint title */}
      <div className="flex-1 min-w-0 w-full sm:w-auto">
        <p className="text-sm sm:text-base font-extrabold text-slate-900 break-words">
          {sprint.title || `Module ${sprint.id}`}
        </p>
        {sprint.moduleName && sprint.moduleName !== sprint.title && (
          <div className="text-xs text-slate-500 break-words mt-0.5">
            {sprint.moduleName}
          </div>
        )}
        {/* Optional: show a subtle progress indicator */}
        {sprint.status === "in_progress" && sprint.modules.length > 0 && (
          <div className="text-[10px] text-slate-400 mt-1 font-medium">
            {sprint.modules.filter((m) => m.completed).length} /{" "}
            {sprint.modules.length} modules completed
          </div>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 w-full sm:w-auto flex-shrink-0">
        {/* Baseline button stays visible until the learner has taken it once. */}
        {sprint.hasBaseline && (
          <button
            onClick={() => {
              if (sprint.baselineCompleted) return;
              onNavigate(assessmentPath);
            }}
            disabled={sprint.baselineCompleted}
            className={[
              "px-3 py-2 rounded-lg text-xs border font-bold flex-1 sm:flex-none h-10 transition-colors",
              sprint.baselineCompleted
                ? "border-slate-200 text-slate-400 bg-slate-50 cursor-not-allowed"
                : "border-slate-200 text-slate-700 bg-white hover:bg-slate-50",
            ].join(" ")}
          >
            {sprint.baselineCompleted ? "Baseline Completed" : "Baseline"}
          </button>
        )}

        {/* Certificate button — only when earned */}
        {sprint.certificateEarned && (
          <button
            onClick={() => onViewCertificate(sprint)}
            className="px-4 sm:px-5 py-1.5 sm:py-2 rounded-xl text-xs border border-blue-600 text-blue-700 font-bold hover:bg-blue-50 flex-1 sm:flex-none h-9 sm:h-10 transition-all duration-200 inline-flex items-center justify-center gap-1.5"
          >
            <Award size={16} />
            View Certificate
          </button>
        )}

        {/*
         * Primary CTA button:
         *   - certificateEarned  → "Review Sprint"   (muted grey)
         *   - in_progress        → "Continue"        (blue outline)
         *   - not_started        → "Start your sprint" (blue filled)
         */}
        <button
          onClick={() => {
            if (sprint.hasBaseline && !sprint.baselineCompleted) return;
            onNavigate(trainingPlanPath);
          }}
          disabled={sprint.hasBaseline && !sprint.baselineCompleted}
          className={[
            "px-4 sm:px-5 py-1.5 sm:py-2 rounded-xl text-xs font-bold flex-1 sm:flex-none h-9 sm:h-10 transition-all duration-200 disabled:cursor-not-allowed",
            sprint.certificateEarned
              ? "bg-slate-100 text-slate-700 hover:bg-slate-200"
              : sprint.status === "in_progress"
              ? "border border-blue-600 text-blue-700 hover:bg-blue-50"
              : sprint.hasBaseline && !sprint.baselineCompleted
              ? "bg-blue-300 text-white"
              : "bg-blue-600 text-white hover:bg-blue-700",
          ].join(" ")}
        >
          {sprint.certificateEarned
            ? "Review Sprint"
            : sprint.status === "in_progress"
            ? "Continue"
            : sprint.hasBaseline && !sprint.baselineCompleted
            ? "Complete Baseline First"
            : "Start your sprint"}
        </button>
      </div>
    </div>
  );
}

// ─── CertificateTemplate ───────────────────────────────────────────────────────

const CertificateTemplate = React.forwardRef<
  HTMLDivElement,
  {
    recipientName: string;
    sprintName: string;
    completionDate: string;
  }
>(({ recipientName, sprintName, completionDate }, ref) => {
  return (
    <div
      ref={ref}
      className="relative bg-gradient-to-br from-white via-sky-50/40 to-blue-50/70 rounded-xl p-4 sm:p-8 border-4 border-sky-100"
    >
      <div className="absolute inset-4 border-2 border-blue-100 rounded-lg pointer-events-none" />

      <div className="absolute inset-0 pointer-events-none opacity-40 rounded-xl overflow-hidden">
        <div className="absolute -top-10 -left-16 w-64 h-64 border border-blue-100 rounded-full" />
        <div className="absolute top-20 -right-16 w-56 h-56 border border-sky-100 rounded-full" />
        <div className="absolute bottom-6 left-1/3 w-40 h-40 border border-indigo-100 rounded-full" />
      </div>

      <div className="relative z-10">
        <div className="relative">
          <div className="text-center">
            <h2 className="text-2xl sm:text-4xl font-black text-slate-900 mt-2 tracking-wide">
              CERTIFICATE OF SPRINT COMPLETION
            </h2>
          </div>

          <div className="absolute top-0 right-0 flex items-center gap-0 shrink-0">
            <svg
              viewBox="0 0 64 64"
              className="w-8 h-8"
              aria-hidden="true"
              focusable="false"
            >
              <defs>
                <linearGradient id="lucidPurple" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#5B2DE1" />
                  <stop offset="100%" stopColor="#6F45EE" />
                </linearGradient>
              </defs>
              <rect x="24" y="8" width="24" height="24" fill="url(#lucidPurple)" />
              <rect x="8" y="24" width="24" height="24" fill="url(#lucidPurple)" />
              <rect x="24" y="24" width="8" height="8" fill="#FFFFFF" />
              <rect x="34" y="48" width="12" height="12" fill="#8FAAE6" />
            </svg>
            <span className="text-lg sm:text-xl font-black text-black leading-none">
              Lucid
            </span>
          </div>
        </div>

        <div className="mt-8 sm:mt-10 text-center px-2">
          <p className="text-sm sm:text-base text-slate-600 font-medium">
            This Certificate is Proudly Awarded to
          </p>
          <h3 className="mt-3 text-2xl sm:text-4xl font-black text-blue-700 tracking-wide">
            {recipientName}
          </h3>

          <p className="mt-6 text-sm sm:text-base text-slate-700 leading-relaxed max-w-3xl mx-auto">
            In Recognition of Successfully Completing the
          </p>

          <p className="mt-2 text-lg sm:text-2xl font-bold text-slate-900">
            "{sprintName}"
          </p>

          <p className="mt-5 text-sm sm:text-base text-slate-700 leading-relaxed max-w-3xl mx-auto">
            Demonstrating Readiness, Focus and Commitment to Doing The Job
            Better Every Day.
          </p>
        </div>

        <div className="mt-8 sm:mt-10 flex items-end justify-between gap-6 border-t border-blue-100 pt-5">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500 font-bold">
              Date
            </p>
            <p className="text-base sm:text-lg font-black text-slate-900 mt-1">
              {completionDate}
            </p>
          </div>

          <div className="text-right">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500 font-bold">
              Awarded by
            </p>
            <p className="text-base sm:text-lg font-black text-blue-700 mt-1">
              Lucid
            </p>
          </div>
        </div>
      </div>
    </div>
  );
});

CertificateTemplate.displayName = "CertificateTemplate";

// ─── LearningStyleBlurb ────────────────────────────────────────────────────────

function LearningStyleBlurb({ styleCode }: { styleCode: string }) {
  const meta: Record<string, { label: string; blurb: string }> = {
    CS: {
      label: "Concrete Sequential",
      blurb:
        "You prefer structure and clear steps. Your plan emphasizes checklists and measurable milestones.",
    },
    AS: {
      label: "Abstract Sequential",
      blurb:
        "You think analytically and value logic. Your plan focuses on evidence-based frameworks.",
    },
    AR: {
      label: "Abstract Random",
      blurb:
        "You learn through connections and stories. Your plan highlights collaboration and reflection.",
    },
    CR: {
      label: "Concrete Random",
      blurb:
        "You enjoy experimentation and iteration. Your plan leans into creative problem solving.",
    },
  };
  const info = meta[styleCode as keyof typeof meta] || {
    label: "Cognitive Learner",
    blurb: "Your plan is being personalized to your unique learning style.",
  };
  return (
    <div className="text-xs sm:text-sm font-medium leading-relaxed">
      <span className="font-black text-slate-900 block mb-1">{info.label}</span>
      {info.blurb}
    </div>
  );
}

// ─── LoadingProgress ───────────────────────────────────────────────────────────

function LoadingProgress({
  label,
}: {
  label: string;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-lg border border-slate-100 p-6 flex flex-col items-center justify-center space-y-4">
        <div className="w-8 h-8 md:w-10 md:h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
        <p className="text-sm font-semibold text-slate-700">{label}</p>
        <p className="text-xs text-slate-500 font-medium">
          Loading your data securely...
        </p>
      </div>
    </div>
  );
}
