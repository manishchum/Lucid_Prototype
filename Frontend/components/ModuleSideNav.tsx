"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import clsx from "clsx";

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
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    fetchSprintModules();
  }, [userId, sprintModuleId]);

  const fetchSprintModules = async () => {
    try {
      setLoading(true);
      console.log("[ModuleSideNav] Fetching modules for userId:", userId, "sprintModuleId:", sprintModuleId);

      // First, get the processed_module_ids from learning_plan
      const { data: learningPlanData, error: planError } = await supabase
        .from("learning_plan")
        .select("processed_module_ids, module_id")
        .eq("user_id", userId)
        .order("assigned_on", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (planError) {
        console.error("[ModuleSideNav] Error fetching learning plan:", planError);
        setLoading(false);
        return;
      }

      if (!learningPlanData?.processed_module_ids) {
        console.log("[ModuleSideNav] No processed_module_ids found");
        setLoading(false);
        return;
      }

      let processedModuleIds = learningPlanData.processed_module_ids;
      
      // Parse if it's a string
      if (typeof processedModuleIds === 'string') {
        try {
          processedModuleIds = JSON.parse(processedModuleIds);
        } catch (e) {
          console.error("[ModuleSideNav] Error parsing processed_module_ids:", e);
          setLoading(false);
          return;
        }
      }

      if (!Array.isArray(processedModuleIds) || processedModuleIds.length === 0) {
        console.log("[ModuleSideNav] processed_module_ids is not an array or is empty");
        setLoading(false);
        return;
      }

      console.log("[ModuleSideNav] Fetching modules with IDs:", processedModuleIds);

      // Fetch all processed modules with these IDs
      const { data: modulesData, error: modulesError } = await supabase
        .from("processed_modules")
        .select("processed_module_id, title, order_index")
        .in("processed_module_id", processedModuleIds)
        .order("order_index", { ascending: true });

      if (modulesError) {
        console.error("[ModuleSideNav] Error fetching modules:", modulesError);
        setLoading(false);
        return;
      }

      console.log("[ModuleSideNav] Fetched modules:", modulesData);
      
      // Sort by the order in the processed_module_ids array if order_index is not available
      const sortedModules = modulesData?.sort((a: Module, b: Module) => {
        const aIndex = processedModuleIds.indexOf(a.processed_module_id);
        const bIndex = processedModuleIds.indexOf(b.processed_module_id);
        return aIndex - bIndex;
      }) || [];

      setModules(sortedModules);
    } catch (error) {
      console.error("[ModuleSideNav] Unexpected error:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleModuleClick = (moduleId: string) => {
    router.push(`/employee/module/${moduleId}`);
  };

  if (loading) {
    return (
      <div
        className="fixed top-0 left-[5rem] h-screen w-64 bg-white border-r shadow-lg z-40 overflow-y-auto"
        style={{ paddingTop: "4rem" }}
      >
        <div className="p-4">
          <div className="animate-pulse space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-16 bg-gray-200 rounded"></div>
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
      className="fixed top-0 left-[5rem] h-screen w-64 bg-white border-r shadow-sm z-40 overflow-y-auto"
      style={{ paddingTop: "4rem" }}
    >
      <div className="p-6">
        <h2 className="text-xl font-bold mb-6 text-gray-900">Modules</h2>
        <div className="space-y-3">
          {modules.map((mod, index) => {
            const isActive = mod.processed_module_id === currentModuleId;
            return (
              <button
                key={mod.processed_module_id}
                onClick={() => handleModuleClick(mod.processed_module_id)}
                className={clsx(
                  "w-full text-left p-4 rounded-lg transition-all duration-200 border",
                  isActive
                    ? "bg-blue-100 text-blue-700 font-medium border-blue-200"
                    : "bg-white text-gray-700 hover:bg-gray-50 border-gray-200"
                )}
              >
                <div className="text-sm font-medium leading-snug">
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
