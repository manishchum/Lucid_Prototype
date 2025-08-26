"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";

export default function TrainingPlanPage() {
  // Helper to render reasoning in a readable format
  function renderReasoning(reasoning: any) {
    if (!reasoning) return null;
    // If it's a string, just show it
    if (typeof reasoning === "string") return <div>{reasoning}</div>;
    // If it's an array, render each object
    if (Array.isArray(reasoning)) {
      return reasoning.map((item, idx) => (
        <div key={idx} className="mb-4">{renderReasoning(item)}</div>
      ));
    }
    // If it's an object, render each key/value
    return (
      <div>
        {Object.entries(reasoning).map(([key, value], idx) => (
          <div key={idx} className="mb-2">
            <div className="font-semibold text-blue-900 mb-1">{key.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}</div>
            {Array.isArray(value) ? (
              <ul className="list-disc pl-6 text-gray-700">
                {value.map((v, i) => <li key={i}>{v}</li>)}
              </ul>
            ) : typeof value === "object" ? (
              renderReasoning(value)
            ) : (
              <div className="text-gray-800">{typeof value === "string" ? value : value !== undefined ? JSON.stringify(value) : ""}</div>
            )}
          </div>
        ))}
      </div>
    );
  }
  const { user, loading: authLoading } = useAuth();
  const [plan, setPlan] = useState<any>(null);
  const [reasoning, setReasoning] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && user?.email) {
      fetchPlan();
    }
  }, [user, authLoading]);

  const fetchPlan = async () => {
    setLoading(true);
    try {
      // Get employee id from Supabase
      if (!user || !user.email) {
        setPlan("Could not find employee record.");
        setLoading(false);
        return;
      }
      const { data: employeeData, error: employeeError } = await supabase
        .from("employees")
        .select("id")
        .eq("email", user.email)
        .single();
      if (employeeError || !employeeData?.id) {
        setPlan("Could not find employee record.");
        setLoading(false);
        return;
      }
      // Call training-plan API
      const res = await fetch("/api/training-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_id: employeeData.id })
      });
      const result = await res.json();
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

  const router = useRouter();
  // Helper: resolve a usable processed_module_id for navigation
  const resolveModuleId = async (mod: any): Promise<string | null> => {
    const direct = mod?.id ?? mod?.original_module_id;
    if (direct && direct !== 'undefined' && direct !== 'null') return String(direct);
    // Fallback: try to resolve by title in processed_modules
    if (mod?.title) {
      try {
        const { data } = await supabase
          .from('processed_modules')
          .select('id, title')
          .ilike('title', mod.title)
          .limit(1)
          .maybeSingle();
        if (data?.id) return String(data.id);
      } catch {}
    }
    return null;
  };

  if (authLoading || loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading training plan...</div>;
  }

  // Defensive: Support both plan.modules and plan.learning_plan.modules
  let parsedPlan = plan;
  // Unwrap common shapes: { modules }, { learning_plan: { modules } }, { plan: { modules } }
  let modules = parsedPlan?.modules || parsedPlan?.learning_plan?.modules || parsedPlan?.plan?.modules;
  let overallRecommendations = parsedPlan?.overall_recommendations || parsedPlan?.learning_plan?.overall_recommendations || parsedPlan?.plan?.overall_recommendations;

  // Always try to parse plan.raw if present
  if (parsedPlan?.raw) {
    try {
      const parsedRaw = typeof parsedPlan.raw === 'string' ? JSON.parse(parsedPlan.raw) : parsedPlan.raw;
      modules = parsedRaw?.modules || parsedRaw?.learning_plan?.modules || parsedRaw?.plan?.modules;
      overallRecommendations = parsedRaw?.overall_recommendations || parsedRaw?.learning_plan?.overall_recommendations || parsedRaw?.plan?.overall_recommendations;
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
              <CardDescription>Your AI-generated learning roadmap</CardDescription>
            </CardHeader>
            <CardContent>
              {parsedPlan && parsedPlan.error ? (
                <div className="text-red-600 mb-2">Error: {parsedPlan.error}</div>
              ) : (
                <div className="text-gray-500">No plan generated yet.</div>
              )}
              {parsedPlan && parsedPlan.raw && (
                <>
                  <div className="text-gray-700 font-semibold mb-2">Raw JSON Response:</div>
                  <pre className="bg-gray-100 p-2 mt-4 rounded text-xs overflow-x-auto max-h-96">{typeof parsedPlan.raw === 'string' ? parsedPlan.raw : JSON.stringify(parsedPlan.raw, null, 2)}</pre>
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
    const fallback = `${idx}-${mod?.title || 'module'}`;
    const tabValue = String(mod?.id ?? mod?.original_module_id ?? fallback);
    return { ...mod, _tabValue: tabValue };
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100 px-4 py-8">
      <div className="max-w-5xl mx-auto">
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Personalized Training Plan</CardTitle>
            <CardDescription>Your AI-generated learning roadmap</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col md:flex-row gap-6">
              {/* Tabs List */}
              <div className="w-full md:w-72 shrink-0">
                <Tabs defaultValue={normalizedModules[0]?._tabValue || ""} className="flex flex-col md:flex-row">
                    {/* Left Sidebar Tabs List */}
                    <TabsList className="md:w-72 w-full flex flex-col bg-white rounded-lg shadow p-2 sticky top-4 h-fit">
                        {normalizedModules.map((mod: any) => (
                        <TabsTrigger
                            key={mod._tabValue}
                            value={mod._tabValue}
                            className="text-left py-3 px-4 rounded-lg mb-2 border hover:bg-blue-50 whitespace-normal"
                        >
                            <div className="font-semibold text-base md:text-lg">{mod.title}</div>
                            <div className="text-xs text-gray-500">{mod.objectives?.length || 0} objectives</div>
                        </TabsTrigger>
                        ))}
                    </TabsList>

                    {/* Right Content Panel */}
                    <div className="flex-1 mt-6 md:mt-0 md:ml-6">
                        {normalizedModules.map((mod: any) => (
                        <TabsContent key={mod._tabValue} value={mod._tabValue} className="bg-white rounded-lg shadow p-6">
                            <div className="mb-4">
                            <div className="text-2xl font-bold mb-2">{mod.title}</div>
                            <div className="text-gray-600 mb-2">
                                Recommended Time: <span className="font-semibold">{mod.recommended_time_hours} hours</span>
                            </div>
                            <div className="text-gray-600 mb-2">
                                Tips: {Array.isArray(mod.tips) ? (
                                  <ul className="list-disc pl-6 text-gray-700">
                                    {mod.tips.map((t: any, i: number) => (
                                      <li key={`${mod._tabValue}-tip-${i}`}>{t}</li>
                                    ))}
                                  </ul>
                                ) : (
                                  <span className="font-semibold">{mod.tips}</span>
                                )}
                            </div>
                            </div>
                            <div className="mb-4">
                            <div className="font-semibold mb-1">Objectives:</div>
                            <ul className="list-disc pl-6 text-gray-700">
                                {mod.objectives?.map((obj: string, idx: number) => (
                                <li key={`${mod._tabValue}-obj-${idx}`}>{obj}</li>
                                ))}
                            </ul>
                            </div>
                            <div className="flex gap-4 mt-6">
                            <Button
                              variant="outline"
                              onClick={async () => {
                                const navId = await resolveModuleId(mod);
                                if (navId) router.push(`/employee/module/${navId}`);
                              }}
                              disabled={!(mod.id ?? mod.original_module_id) && !mod.title}
                            >
                                View Content
                            </Button>
                            <Button
                              variant="default"
                              onClick={async () => {
                                const navId = await resolveModuleId(mod);
                                if (navId) router.push(`/employee/quiz/${navId}`);
                              }}
                              disabled={!(mod.id ?? mod.original_module_id) && !mod.title}
                            >
                                Take Quiz
                            </Button>
                            </div>
                        </TabsContent>
                        ))}
                    </div>
                </Tabs>
              </div>
            </div>
            {overallRecommendations && (
              <div className="mt-8 p-4 bg-blue-50 rounded-lg text-blue-900">
                <div className="font-bold mb-2">Overall Recommendations</div>
                {Array.isArray(overallRecommendations) ? (
                  <ul className="list-disc pl-6">
                    {overallRecommendations.map((r: any, i: number) => (
                      <li key={`rec-${i}`}>{r}</li>
                    ))}
                  </ul>
                ) : (
                  <div>{overallRecommendations}</div>
                )}
              </div>
            )}
            {/* Reasoning Section */}
            {reasoning && (
              <div className="mt-8 p-4 bg-yellow-50 rounded-lg text-yellow-900">
                <div className="font-bold mb-2">GPT Reasoning</div>
                {renderReasoning(reasoning)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
