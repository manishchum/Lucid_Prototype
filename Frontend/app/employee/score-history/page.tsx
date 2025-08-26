"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";

export default function ScoreHistoryPage() {
  const { user, loading: authLoading } = useAuth();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [scoreHistory, setScoreHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  // State to track which items are expanded (must be declared at the top level)
  const [expanded, setExpanded] = useState<{ [key: number]: boolean }>({});
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && user?.email) {
      fetchEmployeeAndHistory(user.email);
    }
  }, [user, authLoading]);

  const fetchEmployeeAndHistory = async (email: string) => {
    setLoading(true);
    try {
      const { data: employeeData } = await supabase
        .from("employees")
        .select("id")
        .eq("email", email)
        .single();
      if (!employeeData?.id) {
        setLoading(false);
        return;
      }
      const { data: assessments } = await supabase
        .from("employee_assessments")
        .select("id, score, max_score, feedback, question_feedback, assessment_id, assessments(type, questions)")
        .eq("employee_id", employeeData.id)
        .order("id", { ascending: false });
      setScoreHistory(assessments || []);
    } catch (err) {
      // handle error
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100 px-4 py-8">
      <div className="max-w-3xl mx-auto">
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Score & Feedback History</CardTitle>
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
