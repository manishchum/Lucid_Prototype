"use client";

import { useCallback, useEffect, useMemo, useRef, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import TaskDashboard from "@/components/task-manager/TaskDashboard";
import TaskCreatorWizard from "@/components/task-manager/TaskCreatorWizard";
import type { ReportItem } from "@/components/task-manager/TaskReports";
import { useAuth } from "@/contexts/auth-context";
import { useTenant } from "@/contexts/tenant-context";
import {
  createTask,
  deleteTask,
  fetchActiveTasks,
  fetchAudienceMembers,
  fetchTaskSubmissions,
  fetchCohorts,
  submitTaskResponse,
  reassignTask,
  type CreateTaskPayload,
  type SubmitTaskPayload,
  type Task,
} from "@/lib/taskApi";
import type {
  AssignedTask,
  AssignmentLevel,
  Sprint,
  SubmissionFormat,
  TeamMember,
  QuizQuestion,
} from "@/types/task";

function mapBackendLevel(level?: string): AssignmentLevel {
  if (!level) return "individual";
  if (level === "cohort") return "sprint";
  return level as AssignmentLevel;
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

function mapCohortsToSprints(cohorts: { module_id: string; title: string }[]): Sprint[] {
  return cohorts.map((cohort) => ({
    id: cohort.module_id,
    title: cohort.title,
    code: cohort.title.slice(0, 4).toUpperCase(),
    status: "In Progress" as const,
    completionRate: 0,
    totalQuizzes: 0,
    completedQuizzes: 0,
  }));
}

function mapMembersToTeamMembers(members: any[]): TeamMember[] {
  return members.map((member) => {
    const name = member.name || member.email || "Unnamed User";
    return {
      id: member.user_id,
      name,
      email: member.email || "",
      avatar: name.slice(0, 1).toUpperCase(),
      org: member.company ?? "",
      function: member.function_name ?? "",
      subFunction: member.sub_function_name ?? "",
    };
  });
}

function TaskManagerContent() {
  const { user, loading: authLoading, userId, employeeData, isAdmin, isManager, isSuperAdmin, isDeveloper } = useAuth();
  const { activeCompanyId, isDeveloperMode } = useTenant();

  const effectiveUserId = employeeData?.user_id || userId || "";
  const companyId = useMemo(
    () => (isDeveloperMode && activeCompanyId ? activeCompanyId : employeeData?.company_id || ""),
    [activeCompanyId, employeeData?.company_id, isDeveloperMode]
  );
  const role: "admin" | "employee" =
    isAdmin || isSuperAdmin || isDeveloper || isManager ? "admin" : "employee";

  const [assignedTasks, setAssignedTasks] = useState<AssignedTask[]>([]);
  const [reports, setReports] = useState<ReportItem[]>([]);
  const [isCreatingTask, setIsCreatingTask] = useState(false);
  const searchParams = useSearchParams();
  const createParam = searchParams.get("create");

  useEffect(() => {
    setIsCreatingTask(createParam === "true");
  }, [createParam]);

  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const lastFetchedRef = useRef<string | null>(null);

  const loadTaskManagerData = useCallback(async () => {
    if (authLoading || !user || !effectiveUserId || !companyId) return;

    const fetchKey = `${effectiveUserId}-${companyId}-${role}`;
    if (lastFetchedRef.current === fetchKey) return;
    
    lastFetchedRef.current = fetchKey;

    setIsLoading(true);
    setError(null);
    try {
      const [tasks, cohorts, members] = await Promise.all([
        fetchActiveTasks({ userId: effectiveUserId, companyId }),
        fetchCohorts({ userId: effectiveUserId, companyId }),
        fetchAudienceMembers({ userId: effectiveUserId, companyId }),
      ]);

      // If admin, also fetch submissions for reporting
      if (role === 'admin') {
        try {
          const subsRes = await fetchTaskSubmissions({ companyId });
          const mapped = (subsRes.submissions || []).map((r: any) => ({
            id: r.submission_id,
            title: (r.tasks && r.tasks[0] && r.tasks[0].title) || r.task_id || 'Task Submission',
            category: 'tasks',
            score: r.score || 0,
            totalQuestions: r.max_score || 0,
            dateCompleted: r.submitted_at ? new Date(r.submitted_at).toISOString().split('T')[0] : 'N/A',
            status: r.status === 'submitted' ? 'Completed' : (r.status === 'reviewed' ? 'Completed' : 'In Progress'),
            image_url: r.image_url,
            video_url: r.video_url,
            audio_url: r.audio_url,
            aiValidation: {
              pass: r.ai_validation_pass,
              verdict: r.ai_validation_verdict,
              reason: r.ai_validation_reason,
              suggestion: r.ai_validation_suggestion,
              confidence: r.ai_validation_confidence,
              status: r.ai_status,
            },
            assignment_id: r.assignment_id,
          })) as ReportItem[];

          setReports(mapped);
        } catch (e) {
          // console.warn('Failed to fetch submissions for admin reports', e);
        }
      }

      setAssignedTasks(mapBackendTasksToAssignedTasks(tasks));
      setSprints(mapCohortsToSprints(cohorts));
      setTeamMembers(mapMembersToTeamMembers(members));
    } catch (err: any) {
      lastFetchedRef.current = null;
      setError(err?.message ?? "Failed to load task manager data.");
    } finally {
      setIsLoading(false);
    }
  }, [authLoading, companyId, effectiveUserId, user, role]);

  useEffect(() => {
    loadTaskManagerData();
  }, [loadTaskManagerData]);

  const handleBackendCreate = async (payload: object) => {
    const created = await createTask(
      {
        ...(payload as CreateTaskPayload),
        created_by: effectiveUserId || undefined,
      },
      { userId: effectiveUserId, companyId }
    );

    setAssignedTasks((prev) => [
      ...mapBackendTasksToAssignedTasks([created]),
      ...prev,
    ]);
    return created;
  };

  const handleTaskCreated = (newTask: AssignedTask) => {
    setAssignedTasks((prev) => {
      if (effectiveUserId && newTask.id.startsWith("task-assigned-")) {
        return prev;
      }
      if (prev.some((task) => task.id === newTask.id)) return prev;
      return [newTask, ...prev];
    });
    setIsCreatingTask(false);
  };

  const handleTaskSubmitted = (
    assignmentId: string,
    primaryTitle: string,
    score: number,
    maxScore: number,
    questionsList: any[],
    submission?: any
  ) => {
    // Minimal local update for UI: mark the current assignment completed immediately
    setAssignedTasks((prev) =>
      prev.map((t) =>
        t.id === assignmentId
          ? {
              ...t,
              completionCount: (t.completionCount || 0) + 1,
              status: "Completed",
              submitted: true,
              submission: submission || t.submission,
            }
          : t
      )
    );
    // console.log("Task submitted:", { assignmentId, primaryTitle, score, maxScore });
  };

  const handleBackendSubmit = async (
  payload: Omit<SubmitTaskPayload, "user_id">
) => {

  const normalizedSubmissionType = Array.isArray(
    payload.submission_type
  )
    ? payload.submission_type[0]
    : payload.submission_type;


  return submitTaskResponse(
    {
      ...payload,

      submission_type:
        normalizedSubmissionType,

      user_id:
        effectiveUserId,
    },
    {
      userId:
        effectiveUserId,

      companyId,
    }
  ).then((response) => {
    setAssignedTasks((prev) =>
      prev.map((task) =>
        task.id === payload.assignment_id
          ? {
              ...task,
              status: "Completed",
              submitted: true,
              submission: response?.submission || { submission_id: response?.submission_id },
            }
          : task
      )
    );
    return response;
  });
};

  const handleTaskReassigned = async (
    originalTaskId: string,
    updatedTask: AssignedTask,
    mode: "modify" | "copy"
  ) => {
    try {
      setError(null);
      const result = await reassignTask(
        {
          original_assignment_id: originalTaskId,
          mode,
          level: updatedTask.level,
          target_sprints: updatedTask.targetSprints,
          target_orgs: updatedTask.targetOrgs,
          target_functions: updatedTask.targetFunctions,
          target_sub_functions: updatedTask.targetSubFunctions,
          target_individuals: updatedTask.targetIndividuals,
          due_date: updatedTask.dueDate,
          recurrence: updatedTask.recurrence || "none",
        },
        { userId: effectiveUserId, companyId }
      );

      const mappedResult = mapBackendTasksToAssignedTasks([result])[0];

      setAssignedTasks((prev) =>
        mode === "copy"
          ? [mappedResult, ...prev]
          : prev.map((task) => (task.id === originalTaskId ? mappedResult : task))
      );
    } catch (err: any) {
      setError(err?.message ?? "Failed to save task reassignment to database.");
    }
  };


  const handleTaskDeleted = async (assignmentId: string) => {
    try {
      setError(null);
      await deleteTask(assignmentId, { userId: effectiveUserId, companyId });
      setAssignedTasks((prev) => prev.filter((task) => task.id !== assignmentId));
    } catch (err: any) {
      setError(err?.message ?? "Failed to delete task.");
    }
  };

  if (authLoading || isLoading) {
    return (
      <LoadingProgress
        label="Loading task manager"
      />
    );
  }

  if (error) {
    return (
      <main className="min-h-screen px-6 py-16 md:px-8">
        <div className="mx-auto max-w-7xl rounded-3xl border border-red-100 bg-white p-8 text-sm font-semibold text-red-600">
          {error}
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen px-6 py-16 md:px-8">
      {isCreatingTask ? (
        <TaskCreatorWizard
          onTaskCreated={handleTaskCreated}
          onCancel={() => setIsCreatingTask(false)}
          sprints={sprints}
          teamMembers={teamMembers}
          onBackendCreate={handleBackendCreate}
        />
      ) : (
        <TaskDashboard
          assignedTasks={assignedTasks}
          onStartCreateTask={() => setIsCreatingTask(true)}
          userRole={role}
          onSubmitTaskResponse={handleBackendSubmit}
          onTaskSubmitted={handleTaskSubmitted}
          onTaskReassigned={handleTaskReassigned}
          onTaskDeleted={handleTaskDeleted}
          teamMembers={teamMembers}
        />
      )}
    </main>
  );
}

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

export default function TaskManagerPage() {
  return (
    <Suspense fallback={
      <LoadingProgress
        label="Loading task manager"
      />
    }>
      <TaskManagerContent />
    </Suspense>
  );
}
