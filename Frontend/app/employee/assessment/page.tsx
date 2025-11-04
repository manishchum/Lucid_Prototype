
"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import MCQQuiz from "./mcq-quiz";
import ScoreFeedbackCard from "./score-feedback";
import { useAuth } from "@/contexts/auth-context";
import EmployeeNavigation from "@/components/employee-navigation";

interface TrainingModule {
  id: string;
  title: string;
  ai_modules: string | null;
}

const AssessmentPage = () => {
  const { user } = useAuth();
  const [modules, setModules] = useState<TrainingModule[]>([]);
  const [mcqQuestionsByModule, setMcqQuestionsByModule] = useState<Array<{ moduleId: string; title?: string; questions: any[] }>>([]);
  const [currentModuleIndex, setCurrentModuleIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [score, setScore] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [companyId, setCompanyId] = useState<string | null>(null);

  useEffect(() => {
    const fetchModules = async () => {
      setLoading(true);
      setError("");
      try {
        // Get employee's company_id first
        let companyId: string | null = null;
        if (user?.email) {
          const { data: empData } = await supabase
            .from("employees")
            .select("company_id")
            .eq("email", user.email)
            .maybeSingle();
          companyId = empData?.company_id || null;
        }
        if (!companyId) throw new Error("Could not find company for user");
        // Get modules for this company only
        const { data, error } = await supabase
          .from("training_modules")
          .select("id, title, ai_modules")
          .eq("company_id", companyId)
          .order("created_at", { ascending: true });
        if (error) throw error;
        setModules(data || []);
        setCompanyId(companyId);
      } catch (err: any) {
  setError("Failed to load modules: " + err.message);
  // Add delay before clearing error
  setTimeout(() => setError(""), 1200);
      } finally {
        setLoading(false);
      }
    };
    fetchModules();
  }, [user]);

  useEffect(() => {
    const getMCQQuiz = async () => {
      if (modules.length === 0) return;
      setLoading(true);
      setError("");
      try {
        // Get employee's company_id and id
        let companyId: string | null = null;
        let employeeId: string | null = null;
        if (user?.email) {
          const { data: empData } = await supabase
            .from("employees")
            .select("id, company_id")
            .eq("email", user.email)
            .maybeSingle();
          companyId = empData?.company_id || null;
          employeeId = empData?.id || null;
        }
        if (!companyId || !employeeId) throw new Error("Could not find employee or company for user");
        // Request a baseline quiz for all assigned modules (multi-module baseline)
        const res = await fetch('/api/gpt-mcq-quiz', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            moduleIds: modules.map(m => m.id), 
            companyId 
          }),
        });
        const d = await res.json();
        console.log('[Assessment] Baseline quiz result:', d);
        
        // For now, assign all questions to a single "baseline" entry
        // (The baseline quiz covers all modules together)
        const quizzes = d.quiz && d.quiz.length > 0 
          ? [{ moduleId: 'baseline', title: 'Baseline Assessment', questions: d.quiz }]
          : [];
        setMcqQuestionsByModule(quizzes);
      } catch (err: any) {
        setError("Failed to get quiz: " + err.message);
      } finally {
        setLoading(false);
      }
    };
    if (modules.length > 0) getMCQQuiz();
  }, [modules, user]);

  const handleMCQSubmit = async (result: { score: number; answers: number[]; feedback: string[] }, moduleId: string) => {
    console.log("handleMCQSubmit called with result successfully.");
    setScore(result.score);
    setLoading(true);
    try {
      // 1. Fetch employee UUID from employees table using user.email
      let employeeId: string | null = null;
      if (user?.email) {
        const { data: empData, error: empError } = await supabase
          .from("employees")
          .select("id")
          .eq("email", user.email)
          .maybeSingle();
        if (empData?.id) {
          employeeId = empData.id;
        } else {
          setError("Could not find employee record for this user.");
          setLoading(false);
          return;
        }
      } else {
        setError("User email not found.");
        setLoading(false);
        return;
      }

      // 2. Find or create a baseline assessment for this company
      let assessmentId: string | null = null;
      // Look up the baseline assessment for this company
      const { data: assessmentDef } = await supabase
        .from('assessments')
        .select('id')
        .eq('type', 'baseline')
        .eq('company_id', companyId)
        .limit(1)
        .maybeSingle();
      if (assessmentDef?.id) {
        assessmentId = assessmentDef.id;
      } else {
        // Find questions for the baseline from the fetched quizzes
        const questionsForModule = mcqQuestionsByModule.find((m) => m.moduleId === 'baseline')?.questions || [];
        const { data: newDef } = await supabase
          .from('assessments')
          .insert({ type: 'baseline', company_id: companyId, questions: JSON.stringify(questionsForModule) })
          .select()
          .single();
        assessmentId = newDef?.id || null;
      }

      // Log score in terminal
      console.log("Employee ID:", employeeId);
      console.log("Employee Name:", user?.email);
      console.log("Employee Score:", result.score, "/", (mcqQuestionsByModule.find(m => m.moduleId === 'baseline')?.questions || []).length);
      console.log("Employee Feedback:", result.feedback.join("\n"));

      // Call GPT feedback API for AI-generated feedback and store in Supabase
      const res = await fetch("/api/gpt-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          score: result.score,
          maxScore: (mcqQuestionsByModule.find(m => m.moduleId === 'baseline')?.questions || []).length,
          answers: result.answers,
          feedback: result.feedback,
          modules,
          employee_id: employeeId,
          employee_name: user?.email,
          assessment_id: assessmentId,
        }),
      });
      const data = await res.json();
      setFeedback(data.feedback || "");
    } catch (err: any) {
      setFeedback("Could not generate feedback.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100">
      <EmployeeNavigation showForward={false} />
      
      {/* Main content area that adapts to sidebar */}
      <div 
        className="transition-all duration-300 ease-in-out py-10"
        style={{ 
          marginLeft: 'var(--sidebar-width, 0px)',
        }}
      >
        <div className="max-w-2xl mx-auto px-4">
          <h1 className="text-3xl font-bold mb-4">Starting Baseline
</h1>
          <p className="mb-6 text-gray-700">
            Every learner is different. This short assessment helps us tailor the program to your strengths and needs, so you can learn smarter, apply faster and move closer to your career ambitions.
          </p>
          {error && <div className="mb-4 text-red-600">{error}</div>}
          {loading && <div className="mb-4 text-gray-500">Loading...</div>}
          {!loading && score === null && mcqQuestionsByModule.length > 0 && (
            <MCQQuiz
              questions={mcqQuestionsByModule[0]?.questions || []}
              onSubmit={(res) => handleMCQSubmit(res, mcqQuestionsByModule[0].moduleId)}
            />
          )}
          {!loading && score !== null && (
            <div>
              <ScoreFeedbackCard score={score!} maxScore={(mcqQuestionsByModule[0]?.questions || []).length} feedback={feedback} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AssessmentPage;
