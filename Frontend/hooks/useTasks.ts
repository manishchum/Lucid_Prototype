import { useCallback, useEffect, useState } from "react";

import { fetchActiveTasks, fetchUserTasks, Task } from "@/lib/taskApi";

export function useTasks(
  userId?: string,
  isAdmin?: boolean,
  companyId?: string
) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {

  console.log("useTasks called with:", {
    userId,
    companyId,
    isAdmin
  });

  if (!userId) {
    console.log("NO USER ID - stopping");
    return;
  }

  setLoading(true);
  setError(null);

  try {
    const data = isAdmin
      ? await fetchActiveTasks({ userId, companyId })
      : await fetchUserTasks(userId, companyId);

    console.log("TASK API RESPONSE:", data);

    setTasks(data);

  } catch (err: any) {
    console.error("TASK ERROR:", err);
    setError(err?.message ?? "Failed to load tasks");
  } finally {
    setLoading(false);
  }

}, [userId, isAdmin, companyId]);

  useEffect(() => {
    load();
  }, [load]);

  return { tasks, loading, error, refetch: load };
}
