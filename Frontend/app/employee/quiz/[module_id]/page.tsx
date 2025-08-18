"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function ModuleQuizPage({ params }: { params: { module_id: string } }) {
  const moduleId = params.module_id;
  const [quiz, setQuiz] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    const fetchOrGenerateQuiz = async () => {
      setLoading(true);
      setError(null);
      // 1. Try to fetch existing quiz for this module (processed_modules.id)
      const { data: assessment, error: fetchError } = await supabase
        .from("assessments")
        .select("id, questions")
        .eq("type", "module")
        .eq("module_id", moduleId)
        .maybeSingle();
      if (assessment && assessment.questions) {
        try {
          const quizData = Array.isArray(assessment.questions) ? assessment.questions : JSON.parse(assessment.questions);
          setQuiz(quizData);
          setAnswers(new Array(quizData.length).fill(-1));
          setAssessmentId(assessment.id);
        } catch {
          setQuiz(null);
          setError("Failed to parse quiz data.");
        }
        setLoading(false);
        return;
      }
      // 2. If not found, call API to generate quiz for this module
      try {
        const res = await fetch("/api/gpt-mcq-quiz", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ moduleId }),
        });
        const result = await res.json();
        if (result.quiz) {
          setQuiz(result.quiz);
          setAnswers(new Array(result.quiz.length).fill(-1));
          // Fetch assessment id for the newly created quiz
          const { data: newAssessment } = await supabase
            .from("assessments")
            .select("id")
            .eq("type", "module")
            .eq("module_id", moduleId)
            .maybeSingle();
          if (newAssessment && newAssessment.id) setAssessmentId(newAssessment.id);
        } else {
          setQuiz(null);
          setError(result.error || "Quiz generation failed.");
        }
      } catch (err) {
        setQuiz(null);
        setError("Quiz generation failed.");
      }
      setLoading(false);
    };
    if (moduleId) fetchOrGenerateQuiz();
  }, [moduleId]);

  const handleSelect = (qIdx: number, oIdx: number) => {
    if (submitted) return;
    setAnswers((prev) => {
      const next = [...prev];
      next[qIdx] = oIdx;
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!quiz) return;
    setSubmitted(true);
    // Score locally
    let correct = 0;
    const userAnswers = answers;
    const correctAnswers = quiz.map((q) => q.correctIndex);
    for (let i = 0; i < quiz.length; i++) {
      if (userAnswers[i] === correctAnswers[i]) correct++;
    }
    setScore(correct);
    console.log("[QUIZ] User answers:", userAnswers);
    console.log("[QUIZ] Correct answers:", correctAnswers);
    // Always fetch user info and assessmentId before API call
    let userEmail = null;
    let employeeId = null;
    let employeeName = null;
    let finalAssessmentId = assessmentId;
    try {
      const { data: userData } = await supabase.auth.getUser();
      userEmail = userData?.user?.email || null;
      employeeName = userData?.user?.user_metadata?.name || userEmail || null;
      if (userEmail) {
        // Fetch correct employee_id from employees table using email
        const { data: employeeRecord, error: employeeError } = await supabase
          .from("employees")
          .select("id")
          .eq("email", userEmail)
          .maybeSingle();
        if (employeeError) {
          console.log("[QUIZ] Error fetching employee record:", employeeError);
        }
        employeeId = employeeRecord?.id || null;
      }
    } catch (err) {
      console.log("[QUIZ] Error fetching user info or employee record:", err);
    }
    // If either is missing, block submission and show error
    if (!employeeId || !finalAssessmentId) {
      setFeedback("Error: Could not identify employee or assessment. Please refresh and try again.");
      console.log("[QUIZ] Missing employeeId or assessmentId, not submitting to backend.");
      return;
    }
    // Prepare all required fields for backend
    const payload = {
      quiz,
      userAnswers,
      score: correct,
      maxScore: quiz.length,
      answers: userAnswers,
      feedback: quiz.map((q, i) => userAnswers[i] === q.correctIndex ? "Correct" : "Incorrect"),
      modules: [{ module_id: moduleId }],
      employee_id: employeeId,
      employee_name: employeeName,
      assessment_id: finalAssessmentId,
    };
    // Call feedback API and let backend handle DB insert/update
    let feedbackText = "";
    try {
      console.log("[QUIZ] Calling GPT feedback API (with assessment storage)... Payload:", payload);
      const res = await fetch("/api/gpt-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      feedbackText = result.feedback || "";
      setFeedback(feedbackText);
      console.log("[QUIZ] GPT feedback received:", feedbackText);
      if (result.insertResult) {
        console.log("[QUIZ] Assessment storage result:", result.insertResult);
      }
      // Log quiz taken into module_progress
      try {
        const { data: userData } = await supabase.auth.getUser();
        const employeeEmail = userData?.user?.email || null;
        if (employeeEmail) {
          const { data: emp } = await supabase
            .from('employees')
            .select('id')
            .eq('email', employeeEmail)
            .maybeSingle();
          if (emp?.id) {
              await fetch('/api/module-progress', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  employee_id: emp.id,
                  processed_module_id: moduleId,
                  quiz_score: correct,
                  max_score: quiz.length,
                  quiz_feedback: feedbackText,
                  completed_at: new Date().toISOString(), // Ensure completion time is tracked
                }),
              });
          }
        }
      } catch (e) {
        console.log('[QUIZ] progress log error', e);
      }
    } catch (err) {
      feedbackText = "Could not generate feedback.";
      setFeedback(feedbackText);
      console.log("[QUIZ] GPT feedback error:", err);
    }
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading quiz...</div>;
  }
  if (error) {
    return <div className="min-h-screen flex items-center justify-center text-red-600">{error}</div>;
  }
  if (!quiz || quiz.length === 0) {
    return <div className="min-h-screen flex items-center justify-center text-gray-600">No quiz available for this module.</div>;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100 px-4 py-8">
      <div className="max-w-3xl mx-auto">
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Module Quiz</CardTitle>
            <CardDescription>Test your knowledge for this module</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-8">
              {quiz.map((q, idx) => (
                <li key={idx} className="bg-white rounded-lg shadow p-4">
                  <div className="font-semibold mb-2">Q{idx + 1}. {q.question}</div>
                  <ul className="space-y-2">
                    {q.options?.map((opt: string, oidx: number) => (
                      <li key={oidx} className="flex items-center">
                        <label className="flex items-center cursor-pointer">
                          <input
                            type="radio"
                            name={`q${idx}`}
                            checked={answers[idx] === oidx}
                            onChange={() => handleSelect(idx, oidx)}
                            disabled={submitted}
                          />
                          <span className="ml-2">{String.fromCharCode(65 + oidx)}. {opt}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
            {!submitted ? (
              <Button className="mt-8" variant="default" onClick={handleSubmit} disabled={answers.includes(-1)}>
                Submit Quiz
              </Button>
            ) : (
              <div className="mt-8">
                <div className="text-lg font-semibold mb-2">Your Score: {score} / {quiz.length}</div>
                {feedback && <div className="bg-blue-50 p-4 rounded text-blue-900 whitespace-pre-line">{feedback}</div>}
                <Button className="mt-4" variant="outline" onClick={() => router.back()}>
                  Back to Training Plan
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
