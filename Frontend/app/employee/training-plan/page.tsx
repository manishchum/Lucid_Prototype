"use client";

import { useEffect, useState, Suspense } from "react";
import LoadingProgress from "@/components/shared/LoadingProgress";
import { useLoadingProgress } from "@/hooks/useLoadingProgress";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import { useDataCache } from "@/contexts/data-context";

import { Users, ChevronLeft, CheckCircle2 } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;



function TrainingPlanContent() {
  const { user, internalUser, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [plan, setPlan] = useState<any>(null);
  const [reasoning, setReasoning] = useState<any>(null);
  const [baselineRequired, setBaselineRequired] = useState(false);
  const [baselineMessage, setBaselineMessage] = useState<string | null>(null);
  const [baselineExists, setBaselineExists] = useState(false);
  const [baselineCompleted, setBaselineCompleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [baselineNavLoading, setBaselineNavLoading] = useState(false);
  const [contentLoadingModuleId, setContentLoadingModuleId] = useState<string | null>(null);
  const [quizLoadingModuleId, setQuizLoadingModuleId] = useState<string | null>(null);
  const [moduleBaselineStatus, setModuleBaselineStatus] = useState<Map<string, boolean>>(new Map());
  const [completedModules, setCompletedModules] = useState<string[]>([]);
  const [actualUserId, setActualUserId] = useState<string | null>(null);
  const [additionalReadings, setAdditionalReadings] = useState<any[] | null>(null);

  const moduleId = searchParams.get("module_id");
  const { getCacheData, setCacheData } = useDataCache();

  // Check cache on mount or when moduleId changes
  useEffect(() => {
    const key = `training_plan_data_${moduleId || "all"}`;
    const cachedData = getCacheData(key);
    if (cachedData) {
      setPlan(cachedData.plan);
      setReasoning(cachedData.reasoning);
      setBaselineRequired(cachedData.baselineRequired);
      setBaselineMessage(cachedData.baselineMessage);
      setCompletedModules(cachedData.completedModules);
      setAdditionalReadings(cachedData.additionalReadings);
      setLoading(false); // Skip loader if we have cached data
    } else {
      setLoading(true); // Show loader if no cache for this specific moduleId
    }
  }, [getCacheData, moduleId]);

  const { progress: loadingProgress, show: showLoadingProgress } = useLoadingProgress(authLoading || loading);


  const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;
  const [processedModuleIds, setProcessedModuleIds] = useState<string[]>([]);
  let userId: any = null;
  // Fetch completed modules from Supabase (same logic as employee/welcome)
  useEffect(() => {
    async function fetchCompletedModules() {
      if (!internalUser) return;
      const employeeData = internalUser;

      setActualUserId(employeeData.user_id);

      const { data: progressData } = await supabase
        .from("module_progress")
        .select("processed_module_id, completed_at")
        .eq("user_id", employeeData.user_id)
        .not("completed_at", "is", null);

      if (progressData) {
        setCompletedModules(
          progressData.map((row: any) => String(row.processed_module_id))
        );
      }
    }

    fetchCompletedModules();
  }, [internalUser]);

  // Helper to render reasoning in a readable format
  function renderReasoning(reasoning: any) {
    if (!reasoning) return null;
    // If it's a string, just show it
    if (typeof reasoning === "string") return <div>{reasoning}</div>;
    // If it's an array, render each object
    if (Array.isArray(reasoning)) {
      return reasoning.map((item, idx) => (
        <div key={idx} className="mb-4">
          {renderReasoning(item)}
        </div>
      ));
    }
    // If it's an object, render each key/value
    return (
      <div>
        {Object.entries(reasoning).map(([key, value], idx) => {
          const sectionTitle = key
            .replace(/_/g, " ")
            .replace(/\b\w/g, (l) => l.toUpperCase());
          // Custom rendering for module_selection array
          if (
            key === "module_selection" &&
            Array.isArray(value) &&
            value.length > 0 &&
            typeof value[0] === "object"
          ) {
            return (
              <div key={idx} className="mb-4">
                <div className="font-semibold text-blue-900 mb-1">
                  Module Selection
                </div>
                <ul className="list-disc pl-6 text-gray-700">
                  {value.map((mod: any, i: number) => (
                    <li key={mod.module_name || i} className="mb-2">
                      <div>
                        <span className="font-semibold">Module Name:</span>{" "}
                        {mod.module_name}
                      </div>
                      <div>
                        <span className="font-semibold">Justification:</span>{" "}
                        {mod.justification}
                      </div>
                      {/* <div>
                        <span className="font-semibold">Recommended Time:</span>{" "}
                        {mod.recommended_time} hours
                      </div> */}
                    </li>
                  ))}
                </ul>
              </div>
            );
          }
          // If value is array of strings, render as bullet points
          if (Array.isArray(value) && typeof value[0] === "string") {
            return (
              <div key={idx} className="mb-4">
                <div className="font-semibold text-blue-900 mb-1">
                  {sectionTitle}
                </div>
                <ul className="list-disc pl-6 text-gray-700">
                  {value.map((v, i) => (
                    <li key={i}>{v}</li>
                  ))}
                </ul>
              </div>
            );
          }
          // Fallback: default rendering
          return (
            <div key={idx} className="mb-2">
              <div className="font-semibold text-blue-900 mb-1">
                {sectionTitle}
              </div>
              {Array.isArray(value) ? (
                <ul className="list-disc pl-6 text-gray-700">
                  {value.map((v, i) => (
                    <li key={i}>
                      {typeof v === "object" && v !== null
                        ? JSON.stringify(v)
                        : v}
                    </li>
                  ))}
                </ul>
              ) : typeof value === "object" ? (
                renderReasoning(value)
              ) : (
                <div className="text-gray-800">
                  {typeof value === "string"
                    ? value
                    : value !== undefined
                      ? JSON.stringify(value)
                      : ""}
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  useEffect(() => {
    if (!authLoading) {
      if (!user) {
        router.push("/login");
      } else if (internalUser) {
        fetchPlan(internalUser);
      }
    }
  }, [user, authLoading, internalUser, router]);

  const fetchPlan = async (employeeData: any) => {
    const key = `training_plan_data_${moduleId || "all"}`;
    if (!getCacheData(key)) {
      setLoading(true);
    }
    try {
      setActualUserId(employeeData.user_id);
      const userIdVal = employeeData.user_id;

      // Fetch module-specific baseline requirements AND user's completion status
      try {
        const { data: modules } = await supabase
          .from("training_modules")
          .select("module_id, baseline_assessment_id")
          .eq("company_id", employeeData.company_id);

        const { data: userCompletedBaselines } = await supabase
          .from("employee_assessments")
          .select("assessment_id")
          .eq("user_id", employeeData.user_id);

        const completedBaselineIds = new Set(
          (userCompletedBaselines || []).map((ub: any) => ub.assessment_id)
        );

        const statusMap = new Map<string, boolean>();
        if (modules) {
          modules.forEach((mod: any) => {
            const requiresBaseline = !!mod.baseline_assessment_id;
            const userCompletedIt = mod.baseline_assessment_id &&
              completedBaselineIds.has(mod.baseline_assessment_id);
            statusMap.set(mod.module_id, requiresBaseline && !userCompletedIt);
          });
        }
        setModuleBaselineStatus(statusMap);
      } catch (e) {
        console.error("[training-plan] Error fetching module baseline requirements:", e);
      }

      // Pre-check
      try {
        setBaselineExists(false);
        setBaselineCompleted(false);
        if (employeeData?.company_id && employeeData?.user_id) {
          const { data: baselineDefs } = await supabase
            .from("assessments")
            .select("assessment_id, processed_modules!inner(user_id)")
            .eq("type", "baseline")
            .eq("company_id", employeeData.company_id)
            .eq("processed_modules.user_id", employeeData.user_id);

          const { data: userBaselines } = await supabase
            .from("learning_plan")
            .select("user_id,module_id,baseline_assessment")
            .eq("module_id", moduleId)
            .eq("user_id", employeeData.user_id);

          if (userBaselines && userBaselines.length > 0 && userBaselines[0].baseline_assessment == 0) {
            setBaselineExists(true);
            setBaselineCompleted(true);
          }
          if (baselineDefs && baselineDefs.length > 0) {
            setBaselineExists(true);
            const baselineIds = baselineDefs
              .map((b: any) => b.assessment_id)
              .filter(Boolean);
            if (baselineIds.length > 0) {
              const { data: userBaselines } = await supabase
                .from("employee_assessments")
                .select("assessment_id")
                .in("assessment_id", baselineIds)
                .eq("user_id", employeeData.user_id);
              if (userBaselines && userBaselines.length > 0) {
                setBaselineCompleted(true);
              } else {
                setBaselineCompleted(false);
              }
            }
          }
        }
      } catch (e) {
        console.error("[training-plan] baseline pre-check failed", e);
      }

      const requestBody: any = { user_id: employeeData.user_id };
      if (moduleId) {
        requestBody.module_id = moduleId;
        requestBody.processedModuleIds = processedModuleIds;

        try {
          const { data: tmData } = await supabase
            .from("training_modules")
            .select("additional_readings")
            .eq("module_id", moduleId)
            .single();
          if (tmData?.additional_readings) {
            const readings = typeof tmData.additional_readings === "string"
              ? JSON.parse(tmData.additional_readings)
              : tmData.additional_readings;
            setAdditionalReadings(Array.isArray(readings) ? readings : [readings]);
          } else {
            setAdditionalReadings(null);
          }
        } catch (e) {
          console.error("[training-plan] Error fetching additional_readings:", e);
          setAdditionalReadings(null);
        }
      }

      const res = await fetch(`${API_BASE}/api/training-plan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const result = await res.json();

      if (result?.error === "BASELINE_REQUIRED") {
        setBaselineRequired(true);
        setBaselineMessage(
          result?.message || "Please complete the baseline assessment first."
        );
        setPlan(null);
        setReasoning(null);
        setLoading(false);
        return;
      } else {
        setBaselineRequired(false);
        setBaselineMessage(null);
      }
      if (result.error) {
        setPlan({ error: result.error, raw: result.raw });
        setReasoning(null);
        setLoading(false);
        return;
      }
      if (result.plan) {
        if (typeof result.plan === "string") {
          try {
            setPlan(JSON.parse(result.plan));
          } catch {
            setPlan(result.plan);
          }
        } else {
          setPlan(result.plan);
        }
      } else {
        setPlan(null);
      }
      if (result.reasoning) {
        if (typeof result.reasoning === "string") {
          try {
            setReasoning(JSON.parse(result.reasoning));
          } catch {
            setReasoning(result.reasoning);
          }
        } else {
          setReasoning(result.reasoning);
        }
      } else {
        setReasoning(null);
      }

      if (result.plan?.modules) {
        await collectAndSaveProcessedModuleIds(result.plan.modules, userIdVal);
      }

      // Update cache
      const finalBaselineStatus = result?.error === "BASELINE_REQUIRED";
      const key = `training_plan_data_${moduleId || "all"}`;
      setCacheData(key, {
        plan: result.plan,
        reasoning: result.reasoning,
        baselineRequired: finalBaselineStatus,
        baselineMessage: result.message,
        completedModules: completedModules,
        additionalReadings: additionalReadings,
      });

    } catch (err) {
      setPlan("Error fetching training plan.");
    } finally {
      setLoading(false);
    }
  };

  // Helper: check if a module requires baseline AND user hasn't completed it
  const moduleRequiresBaseline = (mod: any): boolean => {
    const moduleId = mod?.original_module_id || mod?.module_id;
    if (!moduleId) return false;
    // Map stores true only if baseline is required AND user hasn't completed it
    const needsBaseline = moduleBaselineStatus.get(moduleId) === true;
    // console.log(`[moduleRequiresBaseline] Module ${moduleId} needs baseline:`, needsBaseline);
    return needsBaseline;
  };

  // Helper: resolve a usable processed_modules.processed_module_id for navigation
  const resolveModuleId = async (mod: any): Promise<string | null> => {
    try {
      // console.log("[resolveModuleId] Input module:", mod);

      // 1) If the module already carries a processed_module_id, use it
      if (mod?.processed_module_id) {
        // console.log("[resolveModuleId] Using processed_module_id:", mod.processed_module_id);
        return String(mod.processed_module_id);
      }

      // 2) Otherwise, search processed_modules by title (for plan-only modules)
      const moduleName = mod?.title || mod?.name;
      console.log(moduleName);
      console.log(userId)
      if (moduleName) {
        // console.log("[resolveModuleId] Searching by title:", moduleName);
        let query = supabase
          .from("processed_modules")
          .select("processed_module_id")
          .eq('title', moduleName);

        // Filter by the current sprint's original_module_id if available
        if (moduleId) {
          query = query.eq('original_module_id', moduleId);
        }

        const { data: pmByTitle } = await query
          .limit(1)
          .maybeSingle();

        if (pmByTitle?.processed_module_id) {
          // console.log("[resolveModuleId] Found by title:", pmByTitle.processed_module_id);
          return pmByTitle.processed_module_id;
        }
      }

      console.error("[resolveModuleId] Could not resolve module id for:", mod);
    } catch (e) {
      console.error("[resolveModuleId] Error:", e);
    }
    return null;
  };

  // Helper: collect all processed_module_ids and save to learning_plan table
  const collectAndSaveProcessedModuleIds = async (modules: any[], userIdVal: string) => {
    try {
      const ids: string[] = [];
      for (const mod of modules) {
        const resolvedId = await resolveModuleId(mod);
        if (resolvedId) {
          ids.push(resolvedId);
        }
      }
      setProcessedModuleIds(ids);

      // Save to learning_plan table
      if (ids.length > 0 && userIdVal && moduleId) {
        const { error } = await supabase
          .from("learning_plan")
          .update({
            user_id: userIdVal,
            module_id: moduleId,
            processed_module_ids: ids,
            status: 'IN_PROGRESS'
          })
          .eq('user_id', userIdVal)
          .eq('module_id', moduleId);

        if (error) {
          console.error("[collectAndSaveProcessedModuleIds] Error saving to learning_plan:", error);
        }

        for (const m of ids) {
          await supabase
            .from("module_progress")
            .upsert({
              user_id: userIdVal,
              processed_module_id: m,
            });
        }
      }
    } catch (e) {
      console.error("[collectAndSaveProcessedModuleIds] Error:", e);
    }
  };

  if (showLoadingProgress) {
    return <LoadingProgress label="Fetching your Sprint" progress={loadingProgress} />;
  }

  // If baseline is required, show a clear CTA to take the baseline assessment
  if (baselineRequired) {
    return (
      <div className="min-h-screen">
        <div className="transition-all duration-300 ease-in-out px-4 py-8">
          <div className="max-w-3xl mx-auto">
            <div className="bg-white rounded-xl shadow-lg p-8 border">
              <h2 className="text-2xl font-semibold mb-2">
                Baseline Assessment Required
              </h2>
              <p className="text-gray-700 mb-6">
                {baselineMessage ||
                  "Please complete the baseline assessment before accessing your personalized Performance Sprint."}
              </p>
              <div className="flex gap-4">
                <Button
                  onClick={() => {
                    if (baselineNavLoading) return;
                    setBaselineNavLoading(true);
                    window.location.href = "/employee/assessment";
                  }}
                  disabled={baselineNavLoading}
                  className="bg-blue-600 text-white"
                >
                  {baselineNavLoading ? (
                    <span className="flex items-center gap-2">
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      Redirecting...
                    </span>
                  ) : (
                    'Take Baseline Assessment'
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setBaselineRequired(false);
                    if (internalUser) fetchPlan(internalUser);
                  }}
                >
                  Retry
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Defensive: Support both plan.modules and plan.learning_plan.modules
  let parsedPlan = plan;
  // Unwrap common shapes: { modules }, { learning_plan: { modules } }, { plan: { modules } }
  let modules =
    parsedPlan?.modules ||
    parsedPlan?.learning_plan?.modules ||
    parsedPlan?.plan?.modules;
  let overallRecommendations =
    parsedPlan?.overall_recommendations ||
    parsedPlan?.learning_plan?.overall_recommendations ||
    parsedPlan?.plan?.overall_recommendations;

  // Always try to parse plan.raw if present
  if (parsedPlan?.raw) {
    try {
      const parsedRaw =
        typeof parsedPlan.raw === "string"
          ? JSON.parse(parsedPlan.raw)
          : parsedPlan.raw;
      modules =
        parsedRaw?.modules ||
        parsedRaw?.learning_plan?.modules ||
        parsedRaw?.plan?.modules;
      overallRecommendations =
        parsedRaw?.overall_recommendations ||
        parsedRaw?.learning_plan?.overall_recommendations ||
        parsedRaw?.plan?.overall_recommendations;
      if (modules && Array.isArray(modules)) {
        parsedPlan = parsedRaw;
      }
    } catch { }
  }

  if (!plan || !modules || !Array.isArray(modules)) {
    // Only show raw JSON if plan is missing or modules cannot be parsed as an array
    return (
      <div className="min-h-screen px-4 py-8">
        <div className="max-w-3xl mx-auto">
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>Personalized Training Plan</CardTitle>
              <CardDescription>
                Your AI-generated learning roadmap
              </CardDescription>
            </CardHeader>
            <CardContent>
              {parsedPlan && parsedPlan.error ? (
                <div className="text-red-600 mb-2">
                  Error: {parsedPlan.error}
                </div>
              ) : (
                <div className="text-gray-500">No plan generated yet.</div>
              )}
              {parsedPlan && parsedPlan.raw && (
                <>
                  <div className="text-gray-700 font-semibold mb-2">
                    Raw JSON Response:
                  </div>
                  <pre className="bg-gray-100 p-2 mt-4 rounded text-xs overflow-x-auto max-h-96">
                    {typeof parsedPlan.raw === "string"
                      ? parsedPlan.raw
                      : JSON.stringify(parsedPlan.raw, null, 2)}
                  </pre>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Normalize module items to ensure stable unique keys/values for tabs
  const normalizedModules = (modules as any[]).map((mod: any, idx: number) => {
    // console.log('This is the normalizedModules',mod)
    // Normalize: use 'name' as 'title' if title is missing
    const normalizedMod = {
      ...mod,
      title: mod.title || mod.name || `Module ${idx + 1}`,
      recommended_time: mod.recommended_time || mod.time || 0, // Ensure time is available
    };

    const fallback = `${idx}-${normalizedMod.title || "module"}`;
    const tabValue = String(
      normalizedMod?.id ?? normalizedMod?.original_module_id ?? fallback
    );

    // Check completion using processed_module_id to match employee/welcome logic
    let isCompleted = false;
    const processedModuleId = String(
      normalizedMod?.processed_module_id ??
      normalizedMod?.id ??
      normalizedMod?.original_module_id
    );
    if (
      processedModuleId &&
      processedModuleId !== "undefined" &&
      processedModuleId !== "null"
    ) {
      isCompleted = completedModules.includes(processedModuleId);
    }
    // console.log("Is Completed")
    // console.log(isCompleted);
    return { ...normalizedMod, _tabValue: tabValue, _isCompleted: isCompleted };
  });

  // Calculate accurate completion count - only count modules that are actually in the plan
  const planModuleIds = normalizedModules.map(mod => String(
    mod?.processed_module_id ?? mod?.id ?? mod?.original_module_id
  )).filter(id => id && id !== "undefined" && id !== "null");

  const actualCompletedCount = planModuleIds.filter(moduleId =>
    completedModules.includes(moduleId)
  ).length;

  const totalModulesCount = normalizedModules.length;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {/* Main content area that adapts to sidebar */}
      <div className="transition-all duration-300 ease-in-out">
        {/* Header */}
        <div
          className="bg-white shadow-sm border-b"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="max-w-10xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-4">
              <div className="flex items-center">
                <Users className="w-8 h-8 text-green-600 mr-3" />
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">
                    Learner's Performance Sprint
                  </h1>
                </div>
              </div>
              <div className="relative" />
            </div>
          </div>
        </div>
      </div>

      {/* Main content area that adapts to sidebar */}
      <div className="transition-all duration-300 ease-in-out px-4 py-8">
        <div className="max-w-7xl mx-auto">
          {/* Back Button */}
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-blue-600 hover:text-blue-800 font-medium mb-6 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
            Back
          </button>

          {/* Header Card */}
          <Card className="mb-6 border-0 shadow-sm">
            <CardHeader>
              <div className="flex items-center gap-3 mb-2">
                <div className="w-12 h-12 rounded-full bg-blue-100 flex items-center justify-center">
                  <Users className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <CardTitle className="text-xl font-bold text-gray-900">
                    Your Roadmap to Mastery
                  </CardTitle>
                  <CardDescription className="text-sm text-gray-600">
                    Performance Sprint which works for you.
                  </CardDescription>
                </div>
              </div>

              {/* Progress Overview */}
              <div className="mt-4 pt-4 border-t">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-base font-bold text-gray-900">
                    Progress Overview
                  </h3>
                  {/* <a href="#" className="text-sm text-blue-600 hover:underline">
                    View Details
                  </a> */}
                </div>
                <div className="mb-3">
                  <span className="text-2xl font-bold text-blue-600">
                    {actualCompletedCount} / {totalModulesCount} Modules Completed
                  </span>
                </div>
                {/* Individual Module Progress Bars */}
                <div className="flex gap-2">
                  {normalizedModules.map((mod: any, idx: number) => (
                    <div
                      key={idx}
                      className={`flex-1 h-2 rounded-full ${mod._isCompleted ? 'bg-blue-600' : 'bg-blue-200'
                        }`}
                      title={`${mod.title} - ${mod._isCompleted ? 'Completed' : 'Not Started'}`}
                    />
                  ))}
                </div>
              </div>
            </CardHeader>
          </Card>

          {/* Tips for Success Card */}
          {(parsedPlan?.tips || overallRecommendations) && (
            <Card className="mb-6 bg-yellow-50 border-blue-200 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg font-bold text-gray-900">
                  Tips for Success
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2 text-sm text-gray-700">
                  {parsedPlan?.tips ? (
                    typeof parsedPlan.tips === 'string' ? (
                      renderTipsContent(parsedPlan.tips)
                    ) : (
                      <div>{JSON.stringify(parsedPlan.tips)}</div>
                    )
                  ) : overallRecommendations ? (
                    Array.isArray(overallRecommendations) ? (
                      <ol className="space-y-2 list-decimal list-inside">
                        {overallRecommendations.slice(0, 4).map((rec: any, i: number) => (
                          <li key={i} className="leading-relaxed">
                            {typeof rec === 'string' ? rec : JSON.stringify(rec)}
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <div>{typeof overallRecommendations === 'string' ? overallRecommendations : JSON.stringify(overallRecommendations)}</div>
                    )
                  ) : null}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Module Cards - Scrollable Section */}
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Your Modules</h2>
            <div className="max-h-[600px] overflow-y-auto pr-2 space-y-4 scroll-smooth">
              {normalizedModules.map((mod: any, idx: number) => (
                <Card key={mod._tabValue} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                  <CardHeader className="pb-4">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-gray-600 mb-1">
                          MODULE {idx + 1} OF {totalModulesCount}
                        </div>
                        <CardTitle className="text-base font-bold text-gray-900">
                          {mod.title}
                        </CardTitle>
                      </div>
                      <div className="flex items-center gap-3">
                        {mod._isCompleted && (
                          <div className="flex items-center gap-2 px-3 py-1.5 bg-green-50 text-green-700 text-xs font-semibold rounded-full border border-green-200">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Completed
                          </div>
                        )}
                        <Button
                          variant="outline"
                          className="shrink-0"
                          onClick={async () => {
                            const moduleIdentifier = mod.processed_module_id || mod._tabValue;
                            setContentLoadingModuleId(moduleIdentifier);
                            const navId = await resolveModuleId(mod);
                            if (navId) {
                              router.push(`/employee/module/${navId}`);
                            } else {
                              alert("Could not find module content. Please contact support.");
                              setContentLoadingModuleId(null);
                            }
                          }}
                          disabled={
                            mod._isCompleted ||
                            moduleRequiresBaseline(mod) ||
                            contentLoadingModuleId === (mod.processed_module_id || mod._tabValue) ||
                            quizLoadingModuleId === (mod.processed_module_id || mod._tabValue)
                          }
                        >
                          {contentLoadingModuleId === (mod.processed_module_id || mod._tabValue) ? (
                            <span className="flex items-center gap-2">
                              <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-500 border-t-transparent"></div>
                              Loading...
                            </span>
                          ) : (
                            "View Content"
                          )}
                        </Button>
                        <Button
                          className={`shrink-0 ${mod._isCompleted || moduleRequiresBaseline(mod)
                            ? "bg-gray-200 text-gray-500 hover:bg-gray-200"
                            : "bg-blue-600 hover:bg-blue-700"
                            }`}
                          onClick={async () => {
                            const moduleIdentifier = mod.processed_module_id || mod._tabValue;
                            setQuizLoadingModuleId(moduleIdentifier);
                            const navId = await resolveModuleId(mod);
                            if (navId) {
                              router.push(`/employee/quiz/${navId}`);
                            } else {
                              alert("Could not find module quiz. Please contact support.");
                              setQuizLoadingModuleId(null);
                            }
                          }}
                          disabled={
                            mod._isCompleted ||
                            moduleRequiresBaseline(mod) ||
                            contentLoadingModuleId === (mod.processed_module_id || mod._tabValue) ||
                            quizLoadingModuleId === (mod.processed_module_id || mod._tabValue)
                          }
                        >
                          {quizLoadingModuleId === (mod.processed_module_id || mod._tabValue) ? (
                            <span className="flex items-center gap-2">
                              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                              Loading...
                            </span>
                          ) : (
                            "Module Quiz"
                          )}
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                </Card>
              ))}
            </div>
          </div>

          {/* Understand How Your Module Is Crafted Section */}
          {reasoning && (
            <Card className="mt-6 bg-gradient-to-r from-ornage-50 to-yellow-50 border-purple-200 shadow-sm">
              <CardHeader className="pb-3">
                <CardTitle className="text-lg font-bold text-gray-900">
                  Understand How Your Module Is Crafted
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <h3 className="font-semibold text-gray-900 mb-2">Module Selection</h3>
                    <div className="space-y-3">
                      {normalizedModules.map((mod: any, idx: number) => (
                        <div key={idx} className="flex items-start gap-3 p-3 bg-white rounded-lg">
                          <div className="flex items-center justify-center w-8 h-8 rounded bg-blue-100 text-blue-700 font-bold text-sm shrink-0">
                            {idx + 1}
                          </div>
                          <div className="flex-1">
                            <div className="font-semibold text-gray-900 mb-1">
                              Module Name: {mod.title}
                            </div>
                            <div className="text-sm text-gray-600">
                              Overview: {
                                reasoning?.module_selection?.[idx]?.justification ||
                                `Selected for comprehensive understanding of ${mod.title.toLowerCase()}.`
                              }
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="p-4 bg-white rounded-lg">
                    <h3 className="font-semibold text-gray-900 mb-2">Learning Blueprint</h3>
                    <p className="text-sm text-gray-700 leading-relaxed">
                      {reasoning?.overall_strategy ||
                        "The learning plan is designed using a 'Macro-to-Micro' and 'Theory-to-Practice' architecture, structured around the Kolb Learning Cycle. We begin with 'Professional Identity' (Profile modules) to establish the learner's baseline. We then move to 'Contextual Application' (Internship modules) to build real-world understanding."}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="mb-8"></div>
        </div>
      </div>
    </div>
  );
}


function renderTipsContent(tipsText: string) {
  const escapeHtml = (text: string) =>
    text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const formatInline = (text: string) =>
    text
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>");

  const lines = tipsText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const bulletLines = lines.filter((l) => /^[-*•]/.test(l));

  if (bulletLines.length && bulletLines.length === lines.length) {
    return (
      <ul className="list-disc list-inside space-y-1 pl-1">
        {bulletLines.map((line, idx) => {
          const clean = line.replace(/^[-*•]\s*/, "");
          const html = formatInline(escapeHtml(clean));
          return <li key={idx} dangerouslySetInnerHTML={{ __html: html }} />;
        })}
      </ul>
    );
  }

  // Fallback: render as paragraphs preserving simple inline markdown
  return (
    <div className="space-y-2">
      {lines.map((line, idx) => {
        const html = formatInline(escapeHtml(line));
        return <p key={idx} className="leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />;
      })}
    </div>
  );
}


export default function TrainingPlanPage() {
  return (
    <Suspense fallback={
      <LoadingProgress label="Fetching your sprint" progress={68} />
    }>
      <TrainingPlanContent />
    </Suspense>
  );
}
