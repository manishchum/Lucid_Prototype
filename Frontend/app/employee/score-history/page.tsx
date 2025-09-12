"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import EmployeeNavigation from "@/components/employee-navigation";

export default function ScoreHistoryPage() {
  const { user, loading: authLoading } = useAuth();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [scoreHistory, setScoreHistory] = useState<any[]>([]);
  const [learningStyleData, setLearningStyleData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  // State to track which items are expanded (must be declared at the top level)
  const [expanded, setExpanded] = useState<{ [key: number]: boolean }>({});
  const [learningStyleExpanded, setLearningStyleExpanded] = useState<boolean>(false);
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && user?.email) {
      fetchEmployeeAndHistory(user.email);
    }
  }, [user, authLoading]);

  const fetchEmployeeAndHistory = async (email: string) => {
    setLoading(true);
    try {
      // First, get employee data
      const { data: employeeData } = await supabase
        .from("employees")
        .select("id")
        .eq("email", email)
        .single();
      
      if (!employeeData?.id) {
        setLoading(false);
        return;
      }
      
      setEmployeeId(employeeData.id);

      // Fetch assessment history
      const { data: assessments } = await supabase
        .from("employee_assessments")
        .select("id, score, max_score, feedback, question_feedback, assessment_id, assessments(type, questions)")
        .eq("employee_id", employeeData.id)
        .order("id", { ascending: false });
      
      setScoreHistory(assessments || []);

      // Fetch learning style data
      const { data: learningStyle, error: learningStyleError } = await supabase
        .from("employee_learning_style")
        .select("employee_id, answers, learning_style, gpt_analysis, created_at, updated_at")
        .eq("employee_id", employeeData.id)
        .single();
      
      if (learningStyleError) {
        console.warn("Learning style fetch error:", learningStyleError);
        setLearningStyleData(null);
      } else {
        setLearningStyleData(learningStyle);
      }
      
    } catch (err) {
      console.error("Error fetching data:", err);
    } finally {
      setLoading(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading score history...</p>
        </div>
      </div>
    );
  }

  const toggleExpand = (idx: number) => {
    setExpanded((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  // Helper function to get learning style display info
  const getLearningStyleInfo = (styleCode: string) => {
    const styleMap: Record<string, { label: string; description: string }> = {
      CS: {
        label: "Concrete Sequential",
        description: "Prefers structure, clear steps, and hands-on practice. Learning emphasizes checklists, examples, and measurable milestones."
      },
      AS: {
        label: "Abstract Sequential", 
        description: "Thinks analytically and values logic. Learning focuses on theory, frameworks, and evidence-based decision making."
      },
      AR: {
        label: "Abstract Random",
        description: "Learns through connections and stories. Learning highlights collaboration, reflection, and real-world context."
      },
      CR: {
        label: "Concrete Random",
        description: "Enjoys experimentation and rapid iteration. Learning leans into challenges, scenarios, and creative problem solving."
      }
    };
    
    return styleMap[styleCode] || { label: styleCode, description: "Unknown learning style" };
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100 px-4 py-8">
      <div className="max-w-3xl mx-auto">
        {/* Navigation */}
        <EmployeeNavigation showForward={false} />
        
        {/* Learning Style Section */}
        {learningStyleData ? (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>Your Learning Style</CardTitle>
              <CardDescription>
                Your personalized learning style assessment and analysis
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border-b pb-4 mb-4">
                <div className="flex items-center justify-between mb-2 cursor-pointer" onClick={() => setLearningStyleExpanded(!learningStyleExpanded)}>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">Learning Style Assessment</span>
                    <div className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                      {learningStyleData.learning_style}
                    </div>
                    <span className="text-sm text-gray-400">
                      {getLearningStyleInfo(learningStyleData.learning_style).label}
                    </span>
                    <span className="ml-2 text-sm text-gray-400">
                      Completed: {new Date(learningStyleData.updated_at || learningStyleData.created_at).toLocaleDateString()}
                    </span>
                  </div>
                  <button
                    aria-label={learningStyleExpanded ? 'Collapse details' : 'Expand details'}
                    className="focus:outline-none"
                    tabIndex={-1}
                    type="button"
                  >
                    <span className="text-xl">{learningStyleExpanded ? '▲' : '▼'}</span>
                  </button>
                </div>
                {learningStyleExpanded && (
                  <div className="mt-2">
                    <div className="mb-4">
                      <span className="font-semibold">Description:</span>
                      <div className="bg-gray-50 border rounded p-3 text-gray-700 mt-1">
                        {getLearningStyleInfo(learningStyleData.learning_style).description}
                      </div>
                    </div>
                    {learningStyleData.gpt_analysis && (
                      <div className="mb-1">
                        <span className="font-semibold">AI Analysis & Recommendations:</span>
                        <div className="bg-blue-50 border border-blue-200 rounded p-3 text-gray-700 whitespace-pre-line mt-1">
                          {learningStyleData.gpt_analysis}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>Your Learning Style</CardTitle>
              <CardDescription>
                Complete your learning style assessment to see personalized recommendations
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8">
                <div className="text-gray-500 mb-4">
                  You haven't completed your learning style assessment yet.
                </div>
                <button 
                  onClick={() => router.push("/employee/learning-style")}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Take Learning Style Assessment
                </button>
              </div>
            </CardContent>
          </Card>
        )}
        
        {/* Assessment History Section */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Assessment History</CardTitle>
            <CardDescription>View all your assessment results and AI feedback</CardDescription>
          </CardHeader>
          <CardContent>
            {scoreHistory.length === 0 && <div className="text-gray-500">No assessments taken yet.</div>}
            {scoreHistory.length > 0 && (
              <div className="space-y-6">
                {scoreHistory.map((item, idx) => {
                  const isExpanded = expanded[idx] || false;
                  return (
                    <div key={idx} className="border-b pb-4 mb-4 last:border-b-0 last:pb-0 last:mb-0">
                      <div className="flex items-center justify-between mb-2 cursor-pointer" onClick={() => toggleExpand(idx)}>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{item.assessments?.type === 'baseline' ? 'Baseline Assessment' : 'Module Assessment'}</span>
                          <span className="text-sm text-gray-400">ID: {item.id?.slice?.(0,8) || ''}</span>
                          <span className="ml-2">Score: <span className="font-semibold">{item.score} / {item.max_score ?? '?'}</span></span>
                        </div>
                        <button
                          aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
                          className="focus:outline-none"
                          tabIndex={-1}
                          type="button"
                        >
                          <span className="text-xl">{isExpanded ? '▲' : '▼'}</span>
                        </button>
                      </div>
                      {isExpanded && (
                        <div className="mt-2">
                          <div className="mb-1">
                            <span className="font-semibold">AI Feedback:</span>
                            <div className="bg-gray-50 border rounded p-3 text-gray-700 whitespace-pre-line mt-1">{item.feedback}</div>
                          </div>
                          {item.question_feedback && (
                            <div className="mb-1">
                              <span className="font-semibold">Question Feedback:</span>
                              <div className="bg-gray-50 border rounded p-3 text-gray-700 whitespace-pre-line mt-1">{item.question_feedback}</div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
