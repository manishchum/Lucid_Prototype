"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import { createCacheKey, sharedDataClient } from "@/lib/data-client";
import { fetchWithAuth } from "@/lib/fetch-with-auth";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

interface Module {
  processed_module_id: string;
  title: string;
  order_index?: number;
}

interface ModuleSideNavProps {
  userId: string;
  currentModuleId: string;
  sprintModuleId?: string; // The original module_id from training_modules (sprint level)
}

export default function ModuleSideNav({ userId, currentModuleId, sprintModuleId }: ModuleSideNavProps) {
  const [modules, setModules] = useState<Module[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolvedOriginalModuleId, setResolvedOriginalModuleId] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetchSprintModules();
  }, [userId, sprintModuleId, currentModuleId]);

  const fetchSprintModules = async () => {
    if (!userId) return;

    try {
      // Keep existing nav visible during route/module updates.
      if (modules.length === 0) {
        setLoading(true);
      }

      // Determine the original_module_id (sprint-level module_id)
      let originalModuleId = sprintModuleId;

      // If sprintModuleId is not provided, get it from the current processed module
      if (!originalModuleId && currentModuleId) {
        try {
          const currentModuleResult = await sharedDataClient.query<any>(
            createCacheKey({
              namespace: "processed-modules",
              tenantId: "public",
              userId,
              path: `/api/processed-modules/${currentModuleId}`,
            }),
            async () => {
              const pmRes = await fetchWithAuth(
                `${API_BASE}/api/processed-modules/${currentModuleId}`,
              );
              if (!pmRes.ok) {
                throw new Error("Failed to fetch current module");
              }
              return pmRes.json();
            },
            { ttlMs: 10 * 60 * 1000, swr: true, swrMs: 20 * 60 * 1000 },
          );
          const pmData = currentModuleResult?.data;
          const currentModule = pmData?.data;

          if (!currentModule?.original_module_id) {
            return;
          }

          originalModuleId = currentModule.original_module_id;
          setResolvedOriginalModuleId(String(currentModule.original_module_id));
        } catch (error) {
          console.error("[ModuleSideNav] Error fetching current module:", error);
          return;
        }
      }

      if (!originalModuleId) {
        return;
      }

      // Fetch all processed modules that belong to this sprint/original module via backend API
      try {
        const modulesResult = await sharedDataClient.query<any>(
          createCacheKey({
            namespace: "processed-modules",
            tenantId: "public",
            userId,
            path: `/api/processed-modules/original-module/${originalModuleId}`,
          }),
          async () => {
            const modulesRes = await fetchWithAuth(
              `${API_BASE}/api/processed-modules/original-module/${originalModuleId}`,
            );
            if (!modulesRes.ok) {
              throw new Error("Failed to fetch sprint modules");
            }
            return modulesRes.json();
          },
          { ttlMs: 10 * 60 * 1000, swr: true, swrMs: 20 * 60 * 1000 },
        );
        const modulesData = modulesResult?.data;
        const modules = modulesData?.data || [];
        
        if (Array.isArray(modules) && modules.length > 0) {
          setModules(modules);
          setResolvedOriginalModuleId(String(originalModuleId));
        }
      } catch (error) {
        console.error("[ModuleSideNav] Error fetching modules:", error);
        return;
      }
    } catch (error) {
      console.error("[ModuleSideNav] Unexpected error:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleModuleClick = (moduleId: string) => {
    router.push(`/employee/module/${moduleId}`);
  };

  if (loading && modules.length === 0) {
    return (
      <div
        className="hidden xl:block xl:fixed xl:top-0 xl:h-screen xl:w-64 xl:bg-white xl:border-r xl:shadow-sm xl:z-30 xl:overflow-y-auto xl:transition-all xl:duration-300 xl:ease-in-out"
        style={{ 
          paddingTop: "4rem",
          left: "var(--sidebar-width, 5rem)"
        }}
      >
        <div className="p-4 md:p-6">
          <div className="animate-pulse space-y-2 md:space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 md:h-16 bg-gray-200 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (modules.length === 0) {
    return null;
  }

  return (
    <div
      className="hidden xl:block xl:fixed xl:top-0 xl:h-screen xl:w-64 xl:bg-white xl:border-r xl:shadow-sm xl:z-30 xl:overflow-y-auto xl:transition-all xl:duration-300 xl:ease-in-out"
      style={{ 
        paddingTop: "4rem",
        left: "var(--sidebar-width, 5rem)"
      }}
    >
      <div className="p-4 md:p-6">
        <h2 className="text-lg md:text-xl font-bold mb-4 md:mb-6 text-gray-900">Modules</h2>
        <div className="space-y-2 md:space-y-3">
          {modules.map((mod, index) => {
            const isActive = mod.processed_module_id === currentModuleId;
            return (
              <button
                key={mod.processed_module_id}
                onClick={() => handleModuleClick(mod.processed_module_id)}
                className={clsx(
                  "w-full text-left p-3 md:p-4 rounded-lg transition-all duration-200 border text-sm md:text-base",
                  isActive
                    ? "bg-blue-100 text-blue-700 font-medium border-blue-200"
                    : "bg-white text-gray-700 hover:bg-gray-50 border-gray-200"
                )}
              >
                <div className="font-medium leading-snug">
                  Module {index + 1}: {mod.title}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
