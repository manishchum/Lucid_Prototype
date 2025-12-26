"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import EmployeeNavigation from "@/components/employee-navigation";
import { Users, ChevronLeft } from "lucide-react";

export default function TrainingPlanPage() {
  // Track completed modules for the user
  const [completedModules, setCompletedModules] = useState<string[]>([]);
  const [actualUserId, setActualUserId] = useState<string | null>(null);

  const { user, loading: authLoading } = useAuth();
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

  // Fetch completed modules from Supabase (same logic as employee/welcome)
  useEffect(() => {
    console.log("[training-plan] Fetching completed modules for user:", user?.email);
    async function fetchCompletedModules() {
      if (!user?.email) return;
      // Get employee id
      const { data: employeeData } = await supabase
        .from("users")
        .select("user_id")
        .eq("email", user.email)
        .single();
      if (!employeeData?.user_id) return;

      // Get completed modules for employee (match employee/welcome logic)
      const { data: progressData } = await supabase
        .from("module_progress")
        .select("processed_module_id, completed_at")
        .eq("user_id", employeeData.user_id)
        .not("completed_at", "is", null);

      if (progressData) {
        // Store completed processed_module_ids
        setCompletedModules(
          progressData.map((row: any) => String(row.processed_module_id))
        );
      }
    }
    fetchCompletedModules();
  }, [user]);

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
                      <div>
                        <span className="font-semibold">Recommended Time:</span>{" "}
                        {mod.recommended_time} hours
                      </div>
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
    if (!authLoading && user?.email) {
      fetchPlan();
    }
  }, [user, authLoading]);

  const fetchPlan = async () => {
    console.log("[training-plan] Fetching training plan...");
    setLoading(true);
    try {
      // Get employee id from Supabase
      if (!user || !user.email) {
        setPlan("Could not find employee record.");
        setLoading(false);
        return;
      }
      const { data: employeeData, error: employeeError } = await supabase
        .from("users")
        .select("user_id, company_id")
        .eq("email", user.email)
        .single();
      if (employeeError || !employeeData?.user_id) {
        setPlan("Could not find employee record.");
        setLoading(false);
        return;
      }
      // Store the actual user_id for use in resolveModuleId
      setActualUserId(employeeData.user_id);
      
      // Fetch module-specific baseline requirements AND user's completion status
      try {
        const { data: modules } = await supabase
          .from("training_modules")
          .select("module_id, baseline_assessment_id")
          .eq("company_id", employeeData.company_id);
        
        // Get all baseline assessments this user has completed
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
            // Check if module requires baseline AND user hasn't completed it
            const requiresBaseline = !!mod.baseline_assessment_id;
            const userCompletedIt = mod.baseline_assessment_id && 
                                   completedBaselineIds.has(mod.baseline_assessment_id);
            // Store true only if baseline is required AND user hasn't completed it
            statusMap.set(mod.module_id, requiresBaseline && !userCompletedIt);
          });
        }
        setModuleBaselineStatus(statusMap);
        console.log("[training-plan] Module baseline status map:", statusMap);
      } catch (e) {
        console.error("[training-plan] Error fetching module baseline requirements:", e);
      }
      
      // Pre-check: detect if company has baseline definitions and whether user completed one
      try {
        setBaselineExists(false);
        setBaselineCompleted(false);
        if (employeeData?.company_id && employeeData?.user_id) {
          const { data: baselineDefs } = await supabase
            .from("assessments")
            .select("assessment_id")
            .eq("type", "baseline")
            .eq("company_id", employeeData.company_id);
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

      // Extract module_id from URL parameters
      const moduleId = searchParams.get('module_id');
      
      // Call training-plan API with module_id if present
      const requestBody: any = { user_id: employeeData.user_id };
      if (moduleId) {
        requestBody.module_id = moduleId;
      }
      console.log("[training-plan] Fetching plan with body:", requestBody);
      const res = await fetch("/api/training-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const result = await res.json();

      console.log("[training-plan] Fetched plan result:", result);
      // If API indicates baseline is required, show a clear prompt
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
      // If error, show raw JSON for debugging
      if (result.error) {
        setPlan({ error: result.error, raw: result.raw });
        setReasoning(null);
        setLoading(false);
        return;
      }
      // Parse plan
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
      // Parse reasoning
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
    console.log(`[moduleRequiresBaseline] Module ${moduleId} needs baseline:`, needsBaseline);
    return needsBaseline;
  };

  // Helper: resolve a usable processed_modules.processed_module_id for navigation
  const resolveModuleId = async (mod: any): Promise<string | null> => {
    try {
      console.log("[resolveModuleId] Input module:", mod);

      // 1) If the module already carries a processed_module_id, use it
      if (mod?.processed_module_id) {
        console.log("[resolveModuleId] Using processed_module_id:", mod.processed_module_id);
        return String(mod.processed_module_id);
      }

      // 2) Otherwise, search processed_modules by title (for plan-only modules)
      const moduleName = mod?.title || mod?.name;
      if (moduleName && actualUserId) {
        console.log("[resolveModuleId] Searching by title:", moduleName);
        const { data: pmByTitle } = await supabase
          .from("processed_modules")
          .select("processed_module_id")
          .ilike("title", moduleName)
          .eq("user_id", actualUserId)
          .limit(1)
          .maybeSingle();
        if (pmByTitle?.processed_module_id) {
          console.log("[resolveModuleId] Found by title:", pmByTitle.processed_module_id);
          return pmByTitle.processed_module_id;
        }
      }

      console.error("[resolveModuleId] Could not resolve module id for:", mod);
    } catch (e) {
      console.error("[resolveModuleId] Error:", e);
    }
    return null;
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading training plan...</p>
        </div>
      </div>
    );
  }

  // If baseline is required, show a clear CTA to take the baseline assessment
  if (baselineRequired) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100">
        <EmployeeNavigation showForward={false} />
        <div
          className="transition-all duration-300 ease-in-out px-4 py-8"
          style={{ marginLeft: "var(--sidebar-width, 0px)" }}
        >
          <div className="max-w-3xl mx-auto">
            <div className="bg-white rounded-xl shadow-lg p-8 border">
              <h2 className="text-2xl font-semibold mb-2">
                Baseline Assessment Required
              </h2>
              <p className="text-gray-700 mb-6">
                {baselineMessage ||
                  "Please complete the baseline assessment before accessing your personalized learning plan."}
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
                    fetchPlan();
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
    } catch {}
  }

  if (!plan || !modules || !Array.isArray(modules)) {
    // Only show raw JSON if plan is missing or modules cannot be parsed as an array
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100 px-4 py-8">
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
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100">
      <EmployeeNavigation showBack={false} showForward={false} />
      {/* Main content area that adapts to sidebar */}
      <div
        className="transition-all duration-300 ease-in-out"
        style={{
          marginLeft: "var(--sidebar-width, 0px)",
        }}
      >
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
                    Learner's Learning Plan
                  </h1>
                </div>
              </div>
              <div className="relative" />
            </div>
          </div>
        </div>
      </div>

      {/* Main content area that adapts to sidebar */}
      <div
        className="transition-all duration-300 ease-in-out px-4 py-8"
        style={{
          marginLeft: "var(--sidebar-width, 0px)",
        }}
      >
        <div className="max-w-7xl mx-auto">
          {/* Back Button */}
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-blue-600 hover:text-blue-800 font-medium mb-6 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
            Back
          </button>
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>Your Roadmap to Mastery</CardTitle>
              <CardDescription>
                Learning Plan which works for you
              </CardDescription>
              {/* Progress Summary */}
              <div className="mt-4 p-4 bg-gradient-to-r from-blue-50 to-green-50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-gray-700">
                    Progress Overview
                  </span>
                  <span className="text-sm font-bold text-green-600">
                    {actualCompletedCount} / {totalModulesCount} Modules Completed
                  </span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div
                    className="bg-gradient-to-r from-green-400 to-green-600 h-2 rounded-full transition-all duration-500"
                    style={{
                      width: `${Math.min(
                        (actualCompletedCount / Math.max(totalModulesCount, 1)) * 100,
                        100
                      )}%`,
                    }}
                  ></div>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {/* Reworked layout: Tabs root spans full width, sidebar fixed, content stretches */}
              <Tabs
                defaultValue={normalizedModules[0]?._tabValue || ""}
                className="flex flex-col lg:flex-row gap-8 w-full"
              >
                {/* Sidebar */}
                <div className="w-full lg:w-80 shrink-0">
                  <TabsList className="w-full flex flex-col bg-white rounded-xl shadow-lg p-3 sticky top-4 h-fit border">
                    {normalizedModules.map((mod: any) => (
                      <TabsTrigger
                        key={mod._tabValue}
                        value={mod._tabValue}
                        className={`text-left py-0 px-5 rounded-xl mb-3 border whitespace-normal relative transition-all duration-200 flex w-full h-28 ${
                          mod._isCompleted
                            ? "bg-green-100 text-green-800 border-green-300 shadow-md"
                            : "bg-white text-gray-900 hover:bg-blue-50 hover:shadow-md border-gray-200"
                        }`}
                      >
                        <div className="flex items-start justify-between w-full h-full">
                          <div className="flex-1 flex flex-col justify-between h-full py-4">
                            <div className="font-semibold text-base lg:text-base flex items-center gap-2 leading-tight break-words">
                              {mod._isCompleted && (
                                <span className="text-green-600 text-lg">
                                  ✓
                                </span>
                              )}
                              {mod.title}
                            </div>
                            <div className="text-sm text-gray-500">
                              {mod.recommended_time || 0} hours
                            </div>
                          </div>
                          {mod._isCompleted && (
                            <div className="absolute top-3 right-3">
                              <div className="w-3 h-3 bg-green-500 rounded-full animate-pulse"></div>
                            </div>
                          )}
                        </div>
                      </TabsTrigger>
                    ))}
                  </TabsList>
                </div>
                {/* Content Area */}
                <div className="flex-1 min-w-0">
                  {normalizedModules.map((mod: any) => (
                    <TabsContent
                      key={mod._tabValue}
                      value={mod._tabValue}
                      className="bg-white rounded-xl shadow-lg p-8 border w-full"
                    >
                      {/* Header */}
                      <div className="flex items-center justify-between mb-5">
                        <h2 className="text-2xl font-semibold text-gray-900 leading-snug pr-4 break-words">
                          {mod.title}
                        </h2>
                        {mod._isCompleted && (
                          <div className="px-4 py-2 bg-green-100 text-green-800 text-sm font-semibold rounded-full border border-green-200 shadow-sm">
                            ✓ Completed
                          </div>
                        )}
                      </div>
                      {/* Summary Metrics */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mb-6">
                        <div className="bg-blue-50 rounded-lg p-4 border border-blue-200">
                          <div className="text-sm font-semibold text-blue-800 mb-1">
                            Recommended Time
                          </div>
                          <div className="text-2xl font-bold text-blue-900">
                            {mod.recommended_time} hours
                          </div>
                        </div>

                      </div>
                      {/* Tips */}
                      <div className="bg-amber-50 rounded-lg p-5 border border-amber-200 mb-6">
                        <div className="font-semibold text-amber-800 mb-4 flex items-center gap-2">
                          {/* <span className="text-xl">💡</span> */}
                          Tips for Success
                        </div>
                        {Array.isArray(mod.tips) ? (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {mod.tips.map((t: any, i: number) => (
                              <div
                                key={`${mod._tabValue}-tip-${i}`}
                                className="flex items-start gap-2"
                              >
                                <div className="w-2 h-2 bg-amber-400 rounded-full mt-2 shrink-0"></div>
                                <div className="text-amber-700 flex-1">{t}</div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="text-amber-700">{mod.tips}</div>
                        )}
                      </div>
                      {/* Actions */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <Button
                          variant="outline"
                          size="lg"
                          onClick={async () => {
                            console.log(
                              "[training-plan] View Content clicked for module:",
                              mod
                            );
                            setContentLoadingModuleId(mod.processed_module_id);
                            const navId = await resolveModuleId(mod);
                            console.log(
                              "[training-plan] Resolved module id:",
                              navId
                            );
                            if (navId) {
                              router.push(`/employee/module/${navId}`);
                            } else {
                              alert(
                                "Could not find module content. Please contact support."
                              );
                              setContentLoadingModuleId(null);
                            }
                          }}
                          disabled={
                            mod._isCompleted ||
                            moduleRequiresBaseline(mod) ||
                            contentLoadingModuleId === mod.processed_module_id ||
                            quizLoadingModuleId === mod.processed_module_id
                          }
                          className={`w-full py-3 text-base font-semibold border-2 transition-all duration-200 ${
                            mod._isCompleted ||
                            moduleRequiresBaseline(mod) ||
                            contentLoadingModuleId === mod.processed_module_id ||
                            quizLoadingModuleId === mod.processed_module_id
                              ? "bg-gray-100 text-gray-500 cursor-not-allowed"
                              : "hover:bg-blue-50"
                          }`}
                        >
                          {contentLoadingModuleId === mod.processed_module_id ? (
                            <span className="flex items-center justify-center gap-2">
                              <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-500 border-t-transparent"></div>
                              Loading...
                            </span>
                          ) : (
                            "View Content"
                          )}
                        </Button>
                        <Button
                          variant={mod._isCompleted ? "outline" : "default"}
                          size="lg"
                          onClick={async () => {
                            console.log(
                              "[training-plan] Quiz clicked for module:",
                              mod
                            );
                            setQuizLoadingModuleId(mod.processed_module_id);
                            const navId = await resolveModuleId(mod);
                            console.log(
                              "[training-plan] Resolved module id:",
                              navId
                            );
                            if (navId) {
                              router.push(`/employee/quiz/${navId}`);
                            } else {
                              alert(
                                "Could not find module quiz. Please contact support."
                              );
                              setQuizLoadingModuleId(null);
                            }
                          }}
                          disabled={
                            mod._isCompleted ||
                            moduleRequiresBaseline(mod) ||
                            contentLoadingModuleId === mod.processed_module_id ||
                            quizLoadingModuleId === mod.processed_module_id
                          }
                          className={`w-full py-3 text-base font-semibold transition-all duration-200 ${
                            mod._isCompleted ||
                            moduleRequiresBaseline(mod) ||
                            contentLoadingModuleId === mod.processed_module_id ||
                            quizLoadingModuleId === mod.processed_module_id
                              ? "bg-gray-100 text-gray-500 cursor-not-allowed border-2"
                              : "bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800"
                          }`}
                        >
                          {mod._isCompleted ? (
                            "Quiz Completed"
                          ) : quizLoadingModuleId === mod.processed_module_id ? (
                            <span className="flex items-center justify-center gap-2">
                              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                              Loading...
                            </span>
                          ) : (
                            "Module Quiz"
                          )}
                        </Button>
                      </div>
                    </TabsContent>
                  ))}
                </div>
              </Tabs>
              {overallRecommendations && (
                <div className="mt-8 p-6 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl border border-blue-200 shadow-lg">
                  <div className="font-bold text-xl mb-4 text-blue-900 flex items-center gap-2">
                    {/* <span className="text-2xl">🌟</span> */}
                    Overall Recommendations
                  </div>
                  {Array.isArray(overallRecommendations) ? (
                    <ul className="space-y-3">
                      {overallRecommendations.map((r: any, i: number) => (
                        <li key={`rec-${i}`} className="flex items-start gap-3">
                          <div className="w-6 h-6 bg-blue-100 text-blue-800 rounded-full flex items-center justify-center text-sm font-semibold mt-0.5">
                            {i + 1}
                          </div>
                          <div className="text-blue-800 flex-1">{r}</div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <div className="text-blue-800 text-lg">
                      {overallRecommendations}
                    </div>
                  )}
                </div>
              )}
              {/* Reasoning Section */}
              {reasoning && (
                <div className="mt-8 p-6 bg-gradient-to-r from-yellow-50 to-orange-50 rounded-xl border border-yellow-200 shadow-lg">
                  <div className="font-bold text-xl mb-4 text-yellow-900 flex items-center gap-2">
                    {/* <span className="text-2xl">🧠</span> */}
                    Understand How Your Mastery Roadmap Is Crafted
                  </div>
                  <div className="text-yellow-800">
                    {renderReasoning(reasoning)}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
