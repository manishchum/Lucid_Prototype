import { useCallback, useEffect, useState } from "react";

import { fetchActiveTasks, fetchUserTasks, Task } from "@/lib/taskApi";

const inFlightPromisesMap = new Map<string, Promise<Task[]>>();
const taskCacheMap = new Map<string, { data: Task[]; timestamp: number }>();
const STALE_TIME_MS = 15000;

export function useTasks(
  userId?: string,
  isAdmin?: boolean,
  companyId?: string,
  enabled: boolean = true
) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (force: boolean = false) => {
      if (!enabled || !userId) {
        if (!enabled) setTasks([]);
        setLoading(false);
        setError(null);
        return;
      }

      const cacheKey = `${userId}_${companyId || ""}_${Boolean(isAdmin)}`;
      const cached = taskCacheMap.get(cacheKey);
      const now = Date.now();

      // Return cached data immediately if fresh and not forced
      if (!force && cached && now - cached.timestamp < STALE_TIME_MS) {
        setTasks(cached.data);
        setLoading(false);
        return;
      }

      // If cached data exists, seed UI with cached data while refetching in background
      if (cached) {
        setTasks(cached.data);
      } else {
        setLoading(true);
      }
      setError(null);

      try {
        let promise = inFlightPromisesMap.get(cacheKey);
        if (!promise) {
          promise = isAdmin
            ? fetchActiveTasks({ userId, companyId })
            : fetchUserTasks(userId, companyId);
          inFlightPromisesMap.set(cacheKey, promise);
        }

        const data = await promise;
        taskCacheMap.set(cacheKey, { data, timestamp: Date.now() });
        setTasks(data);
      } catch (err: any) {
        console.error("TASK ERROR:", err);
        setError(err?.message ?? "Failed to load tasks");
      } finally {
        inFlightPromisesMap.delete(cacheKey);
        setLoading(false);
      }
    },
    [userId, isAdmin, companyId, enabled]
  );

  useEffect(() => {
    load(false);
  }, [load]);

  const refetch = useCallback(() => load(true), [load]);

  return { tasks, loading, error, refetch };
}

