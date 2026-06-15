import { fetchWithAuth } from "@/lib/fetch-with-auth";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:8000";

export interface Task {
  task_id: string;
  assignment_id: string;
  company_id: string;
  title: string;
  description: string;
  submission_format: "text" | "image" | "multiple_choice" | "audio" | "video";
  questions: { id: string; question: string; options: string[] }[];
  status: string;
  due_date: string;
  recurrence: string;
  level: string;
  audience_display_name: string;
  total_target_count: number;
  completion_count: number;
  created_at: string;
  // optional fields attached by backend when returning user-specific tasks
  submitted?: boolean;
  submission?: any;
}

export interface CreateTaskPayload {
  title: string;
  description?: string;
  submission_format: string;
  questions?: { id: string; question: string; options: string[] }[];
  level: string;
  target_module_id?: string;
  target_function_id?: string;
  target_sub_function_id?: string;
  target_user_ids?: string[];
  due_date: string;
  recurrence: string;
  created_by?: string;
}

export interface SubmitTaskPayload {
  task_id: string;
  user_id: string;
  assignment_id: string;
  submission_type: string;
  text_response?: string;
  image_url?: string;
  audio_url?: string;
  video_url?: string;
  answers?: { question_id: string; selected_option: string }[];
  score?: number;
  max_score?: number;
  ai_validation_pass?: boolean;
  ai_validation_verdict?: string;
  ai_validation_reason?: string;
  ai_validation_suggestion?: string;
  ai_validation_confidence?: "high" | "medium" | "low";
  ai_status?: string;
}

const buildHeaders = (options?: { userId?: string; companyId?: string }): HeadersInit => {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (options?.userId) {
    headers["X-User-ID"] = options.userId;
  }
  if (options?.companyId) {
    headers["X-Company-ID"] = options.companyId;
  }
  return headers;
};

const formatApiError = (error: any, fallback: string) => {
  const detail = error?.detail ?? error?.message ?? error;

  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        const path = Array.isArray(item?.loc) ? item.loc.join(".") : "";
        const message = item?.msg || JSON.stringify(item);
        return path ? `${path}: ${message}` : message;
      })
      .join("; ");
  }

  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object") return JSON.stringify(detail);
  return fallback;
};

export async function fetchActiveTasks(params?: {
  userId?: string;
  companyId?: string;
}): Promise<Task[]> {
  const res = await fetchWithAuth(`${BACKEND_URL}/api/task-manager/tasks`, {
    headers: buildHeaders(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(formatApiError(err, `Failed to fetch tasks: ${res.statusText}`));
  }
  const data = await res.json();
  return data.tasks as Task[];
}

export async function fetchUserTasks(
  userId: string,
  companyId?: string
): Promise<Task[]> {
  const res = await fetchWithAuth(
    `${BACKEND_URL}/api/task-manager/tasks/user/${userId}`,
    {
      headers: buildHeaders({ userId, companyId }),
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(formatApiError(err, `Failed to fetch user tasks: ${res.statusText}`));
  }
  const data = await res.json();
  return data.tasks as Task[];
}

export async function createTask(
  payload: CreateTaskPayload,
  params?: { userId?: string; companyId?: string }
): Promise<Task> {
  const res = await fetchWithAuth(`${BACKEND_URL}/api/task-manager/tasks`, {
    method: "POST",
    headers: buildHeaders(params),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(formatApiError(err, `Failed to create task: ${res.statusText}`));
  }
  return res.json();
}

export async function submitTask(
  payload: SubmitTaskPayload,
  params?: { userId?: string; companyId?: string }
): Promise<{ submission_id: string }> {
  const res = await fetchWithAuth(`${BACKEND_URL}/api/task-manager/tasks/submit`, {
    method: "POST",
    headers: buildHeaders(params),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(formatApiError(err, `Failed to submit: ${res.statusText}`));
  }
  return res.json();
}

export async function submitTaskResponse(
  payload: SubmitTaskPayload,
  params?: { userId?: string; companyId?: string }
): Promise<{ submission_id: string }> {
  return submitTask(payload, params);
}

export async function fetchAudienceFunctions(params?: {
  userId?: string;
  companyId?: string;
}) {
  const res = await fetchWithAuth(`${BACKEND_URL}/api/task-manager/audience/functions`, {
    headers: buildHeaders(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(formatApiError(err, "Failed to fetch departments"));
  }
  return res.json() as Promise<{ function_id: string; function_name: string }[]>;
}

export async function fetchAudienceSubFunctions(
  functionId: string,
  params?: { userId?: string; companyId?: string }
) {
  const res = await fetchWithAuth(
    `${BACKEND_URL}/api/task-manager/audience/sub-functions/${functionId}`,
    { headers: buildHeaders(params) }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(formatApiError(err, "Failed to fetch teams"));
  }
  return res.json() as Promise<{ sub_function_id: string; sub_function_name: string }[]>;
}

export async function fetchCohorts(params?: { userId?: string; companyId?: string }) {
  const res = await fetchWithAuth(`${BACKEND_URL}/api/task-manager/audience/cohorts`, {
    headers: buildHeaders(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(formatApiError(err, "Failed to fetch cohorts"));
  }
  return res.json() as Promise<{ module_id: string; title: string }[]>;
}

export async function fetchAudienceMembers(params?: {
  userId?: string;
  companyId?: string;
}) {
  const res = await fetchWithAuth(`${BACKEND_URL}/api/task-manager/audience/members`, {
    headers: buildHeaders(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(formatApiError(err, "Failed to fetch audience members"));
  }
  return res.json() as Promise<
    {
      user_id: string;
      name: string;
      email: string;
      company?: string;
      function_name?: string;
      sub_function_name?: string;
    }[]
  >;
}

export async function fetchTaskSubmissions(
  params?: { assignmentId?: string; userId?: string; companyId?: string }
) {
  const q = new URLSearchParams();
  if (params?.assignmentId) q.set('assignment_id', params.assignmentId);
  if (params?.userId) q.set('user_id', params.userId);

  const url = `${BACKEND_URL}/api/task-manager/tasks/submissions${q.toString() ? `?${q.toString()}` : ''}`;
  const res = await fetchWithAuth(url, { headers: buildHeaders(params) });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(formatApiError(err, `Failed to fetch submissions: ${res.statusText}`));
  }
  return res.json() as Promise<{ submissions: any[]; total: number }>;
}

export async function deleteTask(
  assignmentId: string,
  params?: { userId?: string; companyId?: string }
): Promise<{ success: boolean }> {
  const res = await fetchWithAuth(`${BACKEND_URL}/api/task-manager/tasks/${assignmentId}`, {
    method: "DELETE",
    headers: buildHeaders(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(formatApiError(err, `Failed to delete task: ${res.statusText}`));
  }
  return res.json();
}

export interface ReassignTaskPayload {
  original_assignment_id: string;
  mode: "modify" | "copy";
  level: string;
  target_sprints?: string[];
  target_orgs?: string[];
  target_functions?: string[];
  target_sub_functions?: string[];
  target_individuals?: string[];
  due_date: string;
  recurrence: string;
}

export async function reassignTask(
  payload: ReassignTaskPayload,
  params?: { userId?: string; companyId?: string }
): Promise<Task> {
  const res = await fetchWithAuth(`${BACKEND_URL}/api/task-manager/tasks/reassign`, {
    method: "POST",
    headers: buildHeaders(params),
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(formatApiError(err, `Failed to reassign task: ${res.statusText}`));
  }
  return res.json();
}
