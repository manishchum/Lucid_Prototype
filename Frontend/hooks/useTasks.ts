import { useCallback, useEffect, useState } from "react";

import { fetchActiveTasks, fetchUserTasks, Task } from "@/lib/taskApi";
import { supabase } from "@/lib/supabase";

const inFlightPromisesMap = new Map<string, Promise<Task[]>>();
const taskCacheMap = new Map<string, { data: Task[]; timestamp: number }>();
const STALE_TIME_MS = 15000;

export async function broadcastTaskCompleted(userId: string, taskId?: string) {
  if (!userId || !supabase?.channel) return;
  try {
    const ch = supabase.channel(`realtime_tasks_${userId}_broadcast`);
    await ch.subscribe();
    await ch.send({
      type: "broadcast",
      event: "task_completed",
      payload: { userId, taskId, timestamp: Date.now() },
    });
    setTimeout(() => {
      try {
        supabase.removeChannel(ch);
      } catch {}
    }, 1000);
  } catch (err) {
    console.warn("[Realtime] Failed to broadcast task completed:", err);
  }
}

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
        if (!promise || force) {
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

  // ── Realtime Cross-Device Synchronization (Web & Mobile) ───────────
  useEffect(() => {
    if (!enabled || !userId || !supabase?.channel) return;

    const cacheKey = `${userId}_${companyId || ""}_${Boolean(isAdmin)}`;

    const handleRealtimeUpdate = () => {
      console.log("[Realtime] Task event received, updating UI immediately...");
      taskCacheMap.delete(cacheKey);
      load(true);
    };

    const channelName = `realtime_tasks_${userId}_${Date.now()}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "task_submissions",
          filter: `user_id=eq.${userId}`,
        },
        handleRealtimeUpdate
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "child_task_submissions",
          filter: `user_id=eq.${userId}`,
        },
        handleRealtimeUpdate
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "task_assignments",
          ...(companyId ? { filter: `company_id=eq.${companyId}` } : {}),
        },
        handleRealtimeUpdate
      )
      .on(
        "broadcast",
        { event: "task_completed" },
        (payload: any) => {
          if (!payload?.payload?.userId || payload.payload.userId === userId) {
            handleRealtimeUpdate();
          }
        }
      )
      .subscribe((status: string) => {
        if (status === "SUBSCRIBED") {
          console.log(`[Realtime] Connected to tasks sync channel for user: ${userId}`);
        }
      });

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {}
    };
  }, [enabled, userId, companyId, isAdmin, load]);

  const refetch = useCallback(() => load(true), [load]);

  return { tasks, loading, error, refetch };
}
