"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";

export default function TrainingPlanPage() {
  const { user, loading: authLoading } = useAuth();
  const [plan, setPlan] = useState<any>(null);
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
      if (result.plan) {
        // If plan is a string, try to parse it
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
    } catch (err) {
      setPlan("Error fetching training plan.");
    } finally {
      setLoading(false);
    }
  };

  const router = useRouter();

  if (authLoading || loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading training plan...</div>;
  }

  // Defensive: Support both plan.modules and plan.learning_plan.modules
  const modules = plan?.modules || plan?.learning_plan?.modules;
  const overallRecommendations = plan?.overall_recommendations || plan?.learning_plan?.overall_recommendations;

  if (!plan || !modules || !Array.isArray(modules)) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100 px-4 py-8">
        <div className="max-w-3xl mx-auto">
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>Personalized Training Plan</CardTitle>
              <CardDescription>Your AI-generated learning roadmap</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-gray-500">No plan generated yet.</div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

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
                <Tabs defaultValue={modules[0]?.id || ""} className="flex flex-col md:flex-row">
                    {/* Left Sidebar Tabs List */}
                    <TabsList className="md:w-72 w-full flex flex-col bg-white rounded-lg shadow p-2 sticky top-4 h-fit">
                        {modules.map((mod: any) => (
                        <TabsTrigger
                            key={mod.id}
                            value={mod.id}
                            className="text-left py-3 px-4 rounded-lg mb-2 border hover:bg-blue-50 whitespace-normal"
                        >
                            <div className="font-semibold text-base md:text-lg">{mod.title}</div>
                            <div className="text-xs text-gray-500">{mod.objectives?.length || 0} objectives</div>
                        </TabsTrigger>
                        ))}
                    </TabsList>

                    {/* Right Content Panel */}
                    <div className="flex-1 mt-6 md:mt-0 md:ml-6">
                        {modules.map((mod: any) => (
                        <TabsContent key={mod.id} value={mod.id} className="bg-white rounded-lg shadow p-6">
                            <div className="mb-4">
                            <div className="text-2xl font-bold mb-2">{mod.title}</div>
                            <div className="text-gray-600 mb-2">
                                Recommended Time: <span className="font-semibold">{mod.recommended_time_hours} hours</span>
                            </div>
                            <div className="text-gray-600 mb-2">
                                Tips: <span className="font-semibold">{mod.tips}</span>
                            </div>
                            </div>
                            <div className="mb-4">
                            <div className="font-semibold mb-1">Objectives:</div>
                            <ul className="list-disc pl-6 text-gray-700">
                                {mod.objectives?.map((obj: string, idx: number) => (
                                <li key={idx}>{obj}</li>
                                ))}
                            </ul>
                            </div>
                            <div className="flex gap-4 mt-6">
                            <Button variant="outline" onClick={() => router.push(`/employee/module/${mod.id}`)}>
                                View Content
                            </Button>
                            <Button variant="default" onClick={() => router.push(`/employee/quiz/${mod.id}`)}>
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
                <div>{Array.isArray(overallRecommendations) ? overallRecommendations.join("\n") : overallRecommendations}</div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
