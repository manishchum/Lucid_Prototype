"use client";

import { useEffect, useState, Suspense } from "react";
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
import { createCacheKey, sharedDataClient } from "@/lib/data-client";
import { fetchWithAuth } from "@/lib/fetch-with-auth";
import { Users, ChevronLeft, CheckCircle2, BookOpen, ArrowUpRight } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

function TrainingPlanContent() {
  const { user, loading: authLoading, employeeData } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const moduleId = searchParams.get("module_id");
  
  const [plan, setPlan] = useState<any>(null);
  const [reasoning, setReasoning] = useState<any>(null);
  const [baselineRequired, setBaselineRequired] = useState(false);
  const [baselineMessage, setBaselineMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [baselineNavLoading, setBaselineNavLoading] = useState(false);
  const [contentLoadingModuleId, setContentLoadingModuleId] = useState<string | null>(null);
  const [quizLoadingModuleId, setQuizLoadingModuleId] = useState<string | null>(null);
  const [completedModules, setCompletedModules] = useState<string[]>([]);
  const [attemptedQuizModules, setAttemptedQuizModules] = useState<string[]>([]);
  const [additionalReadings, setAdditionalReadings] = useState<any[] | null>(null);
  const [moduleTitle, setModuleTitle] = useState<string>("");

  const { progress: loadingProgress, show: showLoadingProgress } = useIllusionProgress(authLoading || loading);

  const fetchTrainingPlan = async (employee: any, selectedModuleId: string) => {
    return sharedDataClient.query(
      createCacheKey({
        namespace: "training-plan",
        tenantId: employee.company_id,
        userId: employee.user_id,
        path: `/training-plan/${selectedModuleId}`,
      }),
      async () => {
        const res = await fetchWithAuth(`${API_BASE}/api/training-plan`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-User-ID": employee.user_id,
          },
          body: JSON.stringify({
            user_id: employee.user_id,
            module_id: selectedModuleId,
          }),
        });

        const result = await res.json();
        return result;
      },
      {
        ttlMs: 5 * 1000, // Short fallback TTL to pick up external progress completions
        swr: true,
        swrMs: 30 * 1000,
      },
    );
  };

  const loadPlan = async () => {
    if (!employeeData || !moduleId) return;

    setLoading(true);
    try {
      const result = await fetchTrainingPlan(employeeData, moduleId);
      const data = result.data;
      ////console.log("Fetched training plan data:", data);
      if (data?.error === "BASELINE_REQUIRED") {
        setBaselineRequired(true);
        setBaselineMessage(data.message || "Please complete the baseline assessment first.");
        setPlan(null);
        setReasoning(null);
        setLoading(false);
        return;
      }

      setBaselineRequired(false);
      setBaselineMessage(null);
      setPlan(data?.plan ?? null);
      setReasoning(data?.reasoning ?? null);

      const readingsRaw = data?.additional_readings;
      if (readingsRaw) {
        const readings = typeof readingsRaw === "string" ? JSON.parse(readingsRaw) : readingsRaw;
        setAdditionalReadings(Array.isArray(readings) ? readings : [readings]);
      } else {
        setAdditionalReadings(null);
      }
    } catch (err) {
      setPlan("Error fetching training plan.");
    } finally {
      setLoading(false);
    }
  };

  const fetchModuleProgress = async (employee: any) => {
    if (!employee?.user_id) return;

    try {
      const progressResult = await sharedDataClient.query(
        createCacheKey({
          namespace: "module-progress",
          tenantId: employee.company_id,
          userId: employee.user_id,
          path: `/api/module-progress/user/${employee.user_id}`,
        }),
        async () => {
          const res = await fetchWithAuth(`${API_BASE}/api/module-progress/user/${employee.user_id}`, {
            headers: { "X-User-ID": employee.user_id },
          });

          if (!res.ok) {
            return { progress: [] };
          }

          return res.json();
        },
        {
          ttlMs: 5 * 1000,
          swr: true,
          swrMs: 30 * 1000,
        },
      );

      const progressEntries =
        progressResult?.data?.progress ||
        progressResult?.data?.data ||
        [];

      const attemptedIds = new Set<string>();
      const completedIds = new Set<string>();

      (Array.isArray(progressEntries) ? progressEntries : []).forEach((entry: any) => {
        const processedId = String(entry?.processed_module_id || entry?.module_id || "").trim();
        if (!processedId) return;

        const hasAttempt =
          entry?.quiz_score !== null &&
          entry?.quiz_score !== undefined;

        if (hasAttempt) {
          attemptedIds.add(processedId);
        }

        const isCompleted = Boolean(
          entry?.completed_at ||
          String(entry?.status || "").toUpperCase() === "COMPLETED" ||
          entry?.pass_status,
        );

        if (isCompleted) {
          completedIds.add(processedId);
        }
      });

      setAttemptedQuizModules(Array.from(attemptedIds));
      setCompletedModules(Array.from(completedIds));
    } catch {
      setAttemptedQuizModules([]);
      setCompletedModules([]);
    }
  };

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
      return;
    }

    if (!authLoading && employeeData && moduleId) {
      loadPlan();
      fetchModuleProgress(employeeData);
      
      // Fetch module title
      const fetchModuleTitle = async () => {
        try {
          const res = await fetch(`${API_BASE}/api/training-modules/${moduleId}`, {
            headers: { "X-User-ID": employeeData.user_id },
          });
          if (res.ok) {
            const data = await res.json();
            const title = data?.module?.title || data?.title || "";
            setModuleTitle(title);
          }
        } catch (err) {
          console.error("Failed to fetch module title:", err);
        }
      };
      
      fetchModuleTitle();
    }
  }, [employeeData, moduleId, authLoading, user]);

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

  const normalizedAdditionalReadings = (additionalReadings || [])
    .map((reading: any, idx: number) => {
      if (typeof reading === "string") {
        return {
          id: `${idx}-${reading}`,
          title: reading,
          url: reading,
          description: null,
        };
      }

      if (!reading || typeof reading !== "object") {
        return null;
      }

      const url =
        reading.url ||
        reading.link ||
        reading.href ||
        reading.source ||
        null;
      const title =
        reading.title ||
        reading.name ||
        reading.label ||
        url ||
        `Reading ${idx + 1}`;

      return {
        id: String(reading.id || `${idx}-${title}`),
        title,
        url,
        description: reading.description || reading.summary || reading.notes || null,
      };
    })
    .filter(
      (reading): reading is { id: string; title: string; url: string | null; description: string | null } =>
        Boolean(reading)
    );

  const moduleRequiresBaseline = (_mod: any): boolean => false;

  const getNormalizedProcessedModuleId = (mod: any): string | null => {
    const candidate =
      mod?.resolved_processed_module_id ??
      mod?.processed_module_id ??
      (mod?.id && String(mod.id).startsWith("pm_") ? mod.id : null);

    if (!candidate) return null;
    const normalized = String(candidate).trim();
    if (!normalized || normalized === "undefined" || normalized === "null") {
      return null;
    }
    return normalized;
  };

  const resolveModuleId = async (mod: any): Promise<string | null> => {
    const directResolved =
      mod?.processed_module_id ??
      (mod?.id && String(mod.id).startsWith("pm_") ? mod.id : null);

    if (directResolved) {
      return String(directResolved);
    }

    if (!employeeData?.user_id) {
      return null;
    }

    const originalModuleId = mod?.original_module_id || moduleId;
    if (!originalModuleId) {
      return null;
    }

    try {
      const result = await sharedDataClient.query(
        createCacheKey({
          namespace: "processed-modules",
          tenantId: employeeData.company_id,
          userId: employeeData.user_id,
          path: `/api/processed-modules/original-module/${originalModuleId}`,
        }),
        async () => {
          const res = await fetchWithAuth(`${API_BASE}/api/processed-modules/original-module/${originalModuleId}`, {
            headers: { "X-User-ID": employeeData.user_id },
          });
          if (!res.ok) {
            return { data: [] };
          }
          return res.json();
        },
        {
          ttlMs: 10 * 60 * 1000,
          swr: true,
          swrMs: 20 * 60 * 1000,
        },
      );

      const allModules = (Array.isArray(result?.data) ? result.data : (result?.data?.data || result?.data?.modules || []));
      const targetTitle = String(mod?.title || mod?.name || "").trim().toLowerCase();

      const matched = (Array.isArray(allModules) ? allModules : []).find((pm: any) => {
        const pmTitle = String(pm?.title || "").trim().toLowerCase();
        return targetTitle && pmTitle === targetTitle;
      });

      if (matched?.processed_module_id) {
        return String(matched.processed_module_id);
      }

      const fallback = Array.isArray(allModules) ? allModules[0] : null;
      return fallback?.processed_module_id ? String(fallback.processed_module_id) : null;
    } catch {
      return null;
    }
  };

  // Defensive: Support both plan.modules and plan.learning_plan.modules
  let parsedPlan = plan;
  //console.log("Raw plan data:", parsedPlan);
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

  const moduleCandidates = Array.isArray(modules) ? (modules as any[]) : [];

  useEffect(() => {
    let cancelled = false;

    const resolveMissingProcessedModuleIds = async () => {
      if (!moduleCandidates.length || !employeeData?.user_id) return;

      const missing = moduleCandidates
        .map((mod: any, idx: number) => {
          const normalizedTitle = mod?.title || mod?.name || `Module ${idx + 1}`;
          const fallback = `${idx}-${normalizedTitle || "module"}`;
          const tabValue = String(mod?.id ?? mod?.original_module_id ?? fallback);

          return {
            mod,
            tabValue,
            resolvedProcessedModuleId: getNormalizedProcessedModuleId(mod),
          };
        })
        .filter((item) => !item.resolvedProcessedModuleId);

      if (!missing.length) return;

      const resolutions = await Promise.all(
        missing.map(async (item) => {
          const resolved = await resolveModuleId(item.mod);
          return {
            tabValue: item.tabValue,
            resolved: resolved ? String(resolved) : null,
          };
        })
      );

      if (cancelled) return;

      const resolvedMap = new Map<string, string>();
      resolutions.forEach((item) => {
        if (item?.tabValue && item?.resolved) {
          resolvedMap.set(item.tabValue, item.resolved);
        }
      });

      if (!resolvedMap.size) return;

      setPlan((prev: any) => {
        if (!prev) return prev;

        const patchModules = (list: any[] | undefined) => {
          if (!Array.isArray(list)) return list;
          return list.map((mod: any, idx: number) => {
            const fallback = `${idx}-${(mod?.title || mod?.name || "module")}`;
            const tabValue = String(mod?.id ?? mod?.original_module_id ?? fallback);
            const resolved = resolvedMap.get(tabValue);
            if (!resolved) return mod;
            return {
              ...mod,
              resolved_processed_module_id: resolved,
            };
          });
        };

        return {
          ...prev,
          modules: patchModules(prev.modules),
          learning_plan: prev.learning_plan
            ? {
                ...prev.learning_plan,
                modules: patchModules(prev.learning_plan.modules),
              }
            : prev.learning_plan,
          plan: prev.plan
            ? {
                ...prev.plan,
                modules: patchModules(prev.plan.modules),
              }
            : prev.plan,
        };
      });
    };

    resolveMissingProcessedModuleIds();

    return () => {
      cancelled = true;
    };
  }, [moduleCandidates, moduleId, employeeData?.user_id]);

  if (showLoadingProgress) {
    return <LoadingProgress label="Fetching your Sprint" progress={loadingProgress} />;
  }

  // If baseline is required, show a clear CTA to take the baseline assessment
  if (baselineRequired) {
    return (
      <div className="min-h-screen px-4 py-8">
        <div className="max-w-3xl mx-auto">
            <div className="bg-white rounded-xl shadow-lg p-8 border">
              <h2 className="text-2xl font-semibold mb-2">
                Baseline Assessment Required
              </h2>
              <p className="text-gray-700 mb-6">
                {baselineMessage ||
                  "Please Complete The Baseline Assessment Before Accessing Your Personalized Sprint."}
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
                    loadPlan();
                  }}
                >
                  Retry
                </Button>
              </div>
            </div>
          </div>
      </div>
    );
  }

  if (!plan || !modules || !Array.isArray(modules)) {
    // Only show raw JSON if plan is missing or modules cannot be parsed as an array
    return (
      <div className="min-h-screen px-4 py-8">
        <div className="max-w-3xl mx-auto">
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>Personalized Plan</CardTitle>
              <CardDescription>
                Your AI-generated Roadmap
              </CardDescription>
            </CardHeader>
            <CardContent>
              {parsedPlan && parsedPlan.error ? (
                <div className="text-red-600 mb-2">
                  Error: {parsedPlan.error}
                </div>
              ) : (
                <div className="text-gray-500">No Plan Generated Yet.</div>
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
    // //console.log('This is the normalizedModules',mod)
    // Normalize: use 'name' as 'title' if title is missing
    //console.log(mod)
    const normalizedMod = {
      ...mod,
      title: mod.title || mod.name || `Module ${idx + 1}`,
      recommended_time: mod.recommended_time || mod.time || 0, // Ensure time is available
    };

    const fallback = `${idx}-${normalizedMod.title || "module"}`;
    const tabValue = String(
      normalizedMod?.id ?? normalizedMod?.original_module_id ?? fallback
    );

    const resolvedProcessedModuleId = getNormalizedProcessedModuleId(normalizedMod);

    // Check completion using processed_module_id to match employee/welcome logic
    let isCompleted = false;
    //console.log(normalizedMod, resolvedProcessedModuleId, completedModules);
    if (resolvedProcessedModuleId) {
      isCompleted = completedModules.includes(resolvedProcessedModuleId);
    }
    // //console.log("Is Completed")
    // //console.log(isCompleted);
    return {
      ...normalizedMod,
      resolved_processed_module_id: resolvedProcessedModuleId,
      _tabValue: tabValue,
      _isCompleted: isCompleted,
    };
  });

  // Calculate accurate completion count - only count modules that are actually in the plan
  const planModuleIds = normalizedModules
    .map((mod) => getNormalizedProcessedModuleId(mod))
    .filter((id): id is string => Boolean(id));
  
  const actualCompletedCount = planModuleIds.filter(moduleId => 
    completedModules.includes(moduleId)
  ).length;

  const totalModulesCount = normalizedModules.length;
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
        <div className="px-4 py-8">
          <div className="max-w-7xl mx-auto">
          {/* Header Card with Back Button */}
          <div className="bg-white rounded-xl shadow-sm p-8 border border-slate-200 mb-8 relative">
            <button
              onClick={() => router.push('/employee/welcome')}
              className="flex items-center gap-2 text-blue-600 hover:text-blue-800 font-medium mb-4 transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
              Back
            </button>
            <h1 className="text-3xl font-bold text-gray-800 mb-2">
              Sprint{moduleTitle ? `- ${moduleTitle}` : ''}
            </h1>
            <p className="text-slate-600">Your personalized roadmap to master new skills</p>
          </div>

          {/* Main content area */}
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
                  Sprint which works for you.
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
                      className={`flex-1 h-2 rounded-full ${
                        mod._isCompleted ? 'bg-blue-600' : 'bg-blue-200'
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

          {normalizedAdditionalReadings.length > 0 && (
            <Card className="mb-6 bg-blue-50 border-blue-200 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
                    <BookOpen className="w-5 h-5 text-blue-700" />
                  </div>
                  <div>
                    <CardTitle className="text-lg font-bold text-gray-900">
                      Additional Readings
                    </CardTitle>
                    <CardDescription className="text-sm text-gray-600">
                      Extra Resources Curated for this Sprint.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {normalizedAdditionalReadings.map((reading) => {
                    const isExternalLink = !!reading.url && /^https?:\/\//i.test(reading.url);

                    return (
                      <div
                        key={reading.id}
                        className="rounded-xl border border-blue-100 bg-white p-4 shadow-sm"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0 flex-1">
                            <h3 className="text-sm font-semibold text-gray-900 break-words">
                              {reading.title}
                            </h3>
                            {reading.description && (
                              <p className="mt-1 text-sm leading-relaxed text-gray-600">
                                {reading.description}
                              </p>
                            )}
                            {reading.url && (
                              <p className="mt-2 text-xs text-gray-500 break-all">
                                {reading.url}
                              </p>
                            )}
                          </div>
                          {reading.url && (
                            <a
                              href={reading.url}
                              target={isExternalLink ? "_blank" : undefined}
                              rel={isExternalLink ? "noreferrer" : undefined}
                              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
                            >
                              Open
                              <ArrowUpRight className="h-4 w-4" />
                            </a>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Module Cards Section */}
          <div className="mb-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Your Modules</h2>
            <div className="space-y-4">
              {normalizedModules.map((mod: any, idx: number) => (
                <Card key={mod._tabValue} className="border-0 shadow-sm hover:shadow-md transition-shadow">
                  <CardHeader className="pb-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold text-gray-600 mb-1">
                          MODULE {idx + 1} OF {totalModulesCount}
                        </div>
                        <CardTitle className="text-base font-bold text-gray-900">
                          {mod.title}
                        </CardTitle>
                      </div>
                      <div className="grid w-full grid-cols-1 gap-2 sm:w-auto sm:grid-cols-2 sm:items-center">
                        {mod._isCompleted && (
                          <div className="flex items-center justify-center gap-2 px-3 py-1.5 bg-green-50 text-green-700 text-xs font-semibold rounded-full border border-green-200 sm:col-span-2">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Completed
                          </div>
                        )}
                    <Button
                      variant="outline"
                      className="w-full sm:w-auto shrink-0"
                      onClick={async () => {
                        const realId = getNormalizedProcessedModuleId(mod);
                        setContentLoadingModuleId(mod._tabValue);
                        
                        // Only navigate if we have a real ID or can resolve one
                        const navId = realId || (await resolveModuleId(mod));
                        
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
                        attemptedQuizModules.includes(String(getNormalizedProcessedModuleId(mod) || mod._tabValue)) ||
                        contentLoadingModuleId === (getNormalizedProcessedModuleId(mod) || mod._tabValue) ||
                        quizLoadingModuleId === (getNormalizedProcessedModuleId(mod) || mod._tabValue)
                      }
                    >
                      {contentLoadingModuleId === (getNormalizedProcessedModuleId(mod) || mod._tabValue) ? (
                        <span className="flex items-center justify-center gap-2">
                          <div className="animate-spin rounded-full h-4 w-4 border-2 border-gray-500 border-t-transparent"></div>
                          Loading...
                        </span>
                      ) : (
                        "View Content"
                      )}
                    </Button>
                    <Button
                      className={`w-full sm:w-auto shrink-0 ${
                        mod._isCompleted || moduleRequiresBaseline(mod)
                          ? "bg-gray-200 text-gray-500 hover:bg-gray-200"
                          : "bg-blue-600 hover:bg-blue-700"
                      }`}
                      onClick={async () => {
                        const realId = getNormalizedProcessedModuleId(mod);
                        setQuizLoadingModuleId(mod._tabValue);
                        
                        const navId = realId || (await resolveModuleId(mod));
                        
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
                        contentLoadingModuleId === (getNormalizedProcessedModuleId(mod) || mod._tabValue) ||
                        quizLoadingModuleId === (getNormalizedProcessedModuleId(mod) || mod._tabValue)
                      }
                    >
                      {quizLoadingModuleId === (getNormalizedProcessedModuleId(mod) || mod._tabValue) ? (
                        <span className="flex items-center justify-center gap-2">
                          <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                          Loading...
                        </span>
                      ) : attemptedQuizModules.includes(String(getNormalizedProcessedModuleId(mod) || mod._tabValue)) ? (
                        "Quiz Attempted"
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
                    <h3 className="font-semibold text-gray-900 mb-2"> Blueprint</h3>
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

function useIllusionProgress(active: boolean) {
  const [progress, setProgress] = useState(15);
  const [show, setShow] = useState(active);

  useEffect(() => {
    if (!active) {
      setProgress(100);
      const timeout = setTimeout(() => setShow(false), 180);
      return () => clearTimeout(timeout);
    }

    setShow(true);
    setProgress(Math.min(30, 12 + Math.round(Math.random() * 10)));

    const id = setInterval(() => {
      setProgress((prev) => {
        const hold = prev > 70 ? Math.random() < 0.5 : Math.random() < 0.3;
        if (hold) return prev; // pause occasionally to mimic real loading
        const increment = Math.max(1, Math.round(Math.random() * 7));
        return Math.min(prev + increment, 94);
      });
    }, 420 + Math.round(Math.random() * 240));

    return () => clearInterval(id);
  }, [active]);

  return { progress: Math.min(progress, 100), show };
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

function LoadingProgress({ label, progress }: { label: string; progress: number }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-lg border border-slate-100 p-6 space-y-4">
        <div className="flex items-center justify-between text-sm font-semibold text-slate-700">
          <span>{label}</span>
          <span className="text-slate-900 text-base font-black">{progress}%</span>
        </div>
        <div className="relative h-3 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="absolute left-0 top-0 h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-cyan-400 transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-slate-500 font-medium">Crafting your personalized roadmap. Hang tight.</p>
      </div>
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
