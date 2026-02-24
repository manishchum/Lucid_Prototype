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
  }, [currentModuleId, sprintModuleId]);

  const fetchSprintModules = async () => {
    try {
      setLoading(true);
      console.log("[ModuleSideNav] Fetching modules for currentModuleId:", currentModuleId, "sprintModuleId:", sprintModuleId);

      // Determine the original_module_id (sprint-level module_id)
      let originalModuleId = sprintModuleId;

      // If sprintModuleId is not provided, get it from the current processed module
      if (!originalModuleId && currentModuleId) {
        const { data: currentModule, error: currentModuleError } = await supabase
          .from("processed_modules")
          .select("original_module_id")
          .eq("processed_module_id", currentModuleId)
          .maybeSingle();

        if (currentModuleError) {
          console.error("[ModuleSideNav] Error fetching current module:", currentModuleError);
          setLoading(false);
          return;
        }

        if (!currentModule?.original_module_id) {
          console.log("[ModuleSideNav] No original_module_id found for current module");
          setLoading(false);
          return;
        }

        originalModuleId = currentModule.original_module_id;
      }

      if (!originalModuleId) {
        console.log("[ModuleSideNav] No original_module_id available");
        setLoading(false);
        return;
      }

      console.log("[ModuleSideNav] Fetching all processed modules for original_module_id:", originalModuleId);

      // Fetch all processed modules that belong to this sprint/original module
      const { data: modulesData, error: modulesError } = await supabase
        .from("processed_modules")
        .select("processed_module_id, title, order_index")
        .eq("original_module_id", originalModuleId)
        .order("order_index", { ascending: true });

      if (modulesError) {
        console.error("[ModuleSideNav] Error fetching modules:", modulesError);
        setLoading(false);
        return;
      }

      console.log("[ModuleSideNav] Fetched modules:", modulesData);
      
      setModules(modulesData || []);
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
        className="fixed top-0 h-screen w-64 bg-white border-r shadow-sm z-30 overflow-y-auto transition-all duration-300 ease-in-out"
        style={{ 
          paddingTop: "4rem",
          left: "var(--sidebar-width, 5rem)"
        }}
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
      className="fixed top-0 h-screen w-64 bg-white border-r shadow-sm z-30 overflow-y-auto transition-all duration-300 ease-in-out"
      style={{ 
        paddingTop: "4rem",
        left: "var(--sidebar-width, 5rem)"
      }}
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
