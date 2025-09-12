"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import EmployeeNavigation from "@/components/employee-navigation";

export default function ModuleQuizPage({ params }: { params: { module_id: string } }) {
  const { user, loading: authLoading } = useAuth();
  // Handler for quiz submission
  const handleSubmit = async () => {
    if (!quiz || !Array.isArray(quiz)) return;
    // Ensure assessmentId is set before submission
    if (!assessmentId) {
      setFeedback("Error: Could not identify assessment. Please refresh and try again.");
      return;
    }
    setSubmitted(true);
    // Normalize answers for MCQ questions (send selected option values, not indices)
    const userAnswers = answers.map((ans, i) => {
      const q = quiz[i];
      // For MCQ questions, send the selected option text, not the index
      // If no answer selected (ans === -1), send empty string
      if (typeof ans === 'number' && ans >= 0 && ans < q.options.length) {
        return q.options[ans];
      }
      // No valid answer selected
      return '';
    });

    console.log('[QUIZ] Raw answers:', answers);
    console.log('[QUIZ] Converted userAnswers:', userAnswers);
    // Always fetch user info before API call
    let employeeId: string | null = null;
    let employeeName: string | null = null;
    if (!authLoading && user?.email) {
      try {
        const { data: emp } = await supabase
          .from('employees')
          .select('id')
          .eq('email', user.email)
          .single();
        employeeId = emp?.id || null;
  employeeName = (user as any)?.displayName || user.email || null;
      } catch (err) {
        console.log('[QUIZ] Error fetching employee record:', err);
      }
    }
    if (!employeeId) {
      setFeedback("Error: Could not identify employee. Please refresh and try again.");
      return;
    }
    const payload = {
      quiz,
      userAnswers,
      // Let the API score module quizzes using GPT
      employee_id: employeeId,
      employee_name: employeeName,
      assessment_id: assessmentId,
      modules: [{ module_id: moduleId }],
    };
    let feedbackText = "";
    try {
      const res = await fetch("/api/gpt-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await res.json();
      feedbackText = result.feedback || "";
      if (typeof result.score === 'number') setScore(result.score);
      if (typeof result.maxScore === 'number') setMaxScore(result.maxScore);
      setFeedback(feedbackText);
      // Log quiz taken into module_progress
      try {
        await fetch('/api/module-progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            employee_id: employeeId,
            processed_module_id: moduleId,
            quiz_score: typeof result.score === 'number' ? result.score : null,
            max_score: typeof result.maxScore === 'number' ? result.maxScore : quiz.length,
            quiz_feedback: feedbackText,
            completed_at: new Date().toISOString(),
          }),
        });
      } catch (e) {
        console.log('[QUIZ] progress log error', e);
      }
    } catch (err) {
      feedbackText = "Could not generate feedback.";
      setFeedback(feedbackText);
    }
  };
// ...existing code...

  const moduleId = params.module_id;
  const [quiz, setQuiz] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // answers can be: number (mcq), string (open-ended), number[] (multiple select), Record<string, string> (matching)
  const [answers, setAnswers] = useState<Array<number | string | number[] | Record<string, string>>>([]);
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [maxScore, setMaxScore] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const router = useRouter();

  // Handler for MCQ selection
  const handleSelect = (qIdx: number, oIdx: number) => {
    if (submitted) return;
    setAnswers((prev) => {
      const next = [...prev];
      next[qIdx] = oIdx;
      return next;
    });
  };

  // Handler for open-ended text answers
  const handleTextAnswer = (qIdx: number, value: string) => {
    if (submitted) return;
    setAnswers((prev) => {
      const next = [...prev];
      next[qIdx] = value;
      return next;
    });
  };

  // Handler for quiz submission (already present)
  // ...existing handleSubmit function...

  useEffect(() => {
    // Validate moduleId from route params
    if (!moduleId || moduleId === 'undefined' || moduleId === 'null') {
      setError('Invalid or missing module id. Please navigate from the Training Plan page.');
      setLoading(false);
      return;
    }
    const fetchOrGenerateQuiz = async () => {
      setLoading(true);
      setError(null);
      let learningStyle: string | null = null;
      if (!authLoading && user?.email) {
        try {
          const { data: emp } = await supabase
            .from('employees')
            .select('id')
            .eq('email', user.email)
            .single();
          if (emp?.id) {
            const { data: styleData } = await supabase
              .from('employee_learning_style')
              .select('learning_style')
              .eq('employee_id', emp.id)
              .maybeSingle();
            if (styleData?.learning_style) {
              learningStyle = styleData.learning_style;
            }
          }
        } catch (e) {
          console.log('[quiz] employee fetch error', e);
        }
      }
      if (!learningStyle) {
        setError('Could not determine your learning style.');
        setLoading(false);
        return;
      }
      // 1. Try to fetch existing quiz for this module and learning style
      let query = supabase
        .from("assessments")
        .select("id, questions")
        .eq("type", "module")
        .eq("module_id", moduleId)
        .eq("learning_style", learningStyle);
      const { data: assessment } = await query.maybeSingle();
      console.log('[QUIZ DEBUG] Assessment fetch result:', assessment);
      if (assessment && assessment.questions) {
        try {
          const quizData = Array.isArray(assessment.questions) ? assessment.questions : JSON.parse(assessment.questions);
          console.log('[QUIZ DEBUG] Parsed quizData from assessment:', quizData);
          setQuiz(quizData);
          setAnswers(new Array(quizData.length).fill(-1));
          setAssessmentId(assessment.id);
        } catch (e) {
          console.log('[QUIZ DEBUG] Failed to parse quiz data:', e, assessment.questions);
          setQuiz(null);
          setError("Failed to parse quiz data.");
        }
        setLoading(false);
        return;
      }
      try {
        const res = await fetch("/api/gpt-mcq-quiz", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ moduleId, learningStyle }),
        });
        const result = await res.json();
        console.log('[QUIZ DEBUG] /api/gpt-mcq-quiz result:', result);
        if (result.quiz) {
          setQuiz(result.quiz);
          setAnswers(new Array(result.quiz.length).fill(-1));
          const { data: newAssessment } = await supabase
            .from("assessments")
            .select("id")
            .eq("type", "module")
            .eq("module_id", moduleId)
            .eq("learning_style", learningStyle)
            .maybeSingle();
          console.log('[QUIZ DEBUG] New assessment after quiz generation:', newAssessment);
          if (newAssessment && newAssessment.id) setAssessmentId(newAssessment.id);
        } else {
          setQuiz(null);
          setError(result.error || "Quiz generation failed.");
        }
      } catch (err) {
        console.log('[QUIZ DEBUG] Error during quiz generation:', err);
        setQuiz(null);
        setError("Quiz generation failed.");
      }
      setLoading(false);
    };
  if (!authLoading && user?.email && moduleId && moduleId !== 'undefined' && moduleId !== 'null') fetchOrGenerateQuiz();
  }, [user, authLoading, moduleId]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading quiz...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-600 font-semibold mb-2">{error}</div>
          <Button variant="outline" onClick={() => router.back()}>
            Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100 px-4 py-8">
      <div className="max-w-3xl mx-auto">
        {/* Navigation */}
        <EmployeeNavigation 
          customBackPath={`/employee/module/${params.module_id}`}
          showForward={false}
        />
        
        <Card className="mb-8">
          <CardHeader>
            <CardTitle>Module Quiz</CardTitle>
            <CardDescription>Answer the questions below. Your learning style is used to personalize this quiz.</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="list-decimal ml-6">
              {quiz && quiz.map((q, idx) => (
                <li key={idx} className="mb-6">
                  <div className="font-semibold mb-2">{q.question}</div>
                  {/* Only MCQ options displayed. All other question types commented out. */}
                  {(Array.isArray(q.options) && q.options.length > 0) ? (
                    <div>
                      {q.options.map((opt: string, oIdx: number) => (
                        <label key={oIdx} className="block mb-2">
                          <input
                            type="radio"
                            name={`q${idx}`}
                            checked={answers[idx] === oIdx}
                            onChange={() => handleSelect(idx, oIdx)}
                            disabled={submitted}
                            className="mr-2"
                          />
                          {opt}
                        </label>
                      ))}
                    </div>
                  ) : (
                    <div className="text-red-600 text-sm">No options available for this question.</div>
                  )}
                  {/*
                  // Other question types are commented out for MCQ-only display
                  // {q.type === 'multiple select' ? ...}
                  // {(q.type === 'open-ended' || q.type === 'scenario') ? ...}
                  // {q.type === 'fill-in-the-blank' ? ...}
                  // {q.type === 'true/false' ? ...}
                  // {q.type === 'ordering' ? ...}
                  // {q.type === 'matching' && ...}
                  // Fallback: unknown question type
                  */}
                </li>
              ))}
            </ol>
            {!submitted ? (
              <Button className="mt-8" variant="default" onClick={handleSubmit} disabled={answers.some(a => a === -1)}>
                Submit Quiz
              </Button>
            ) : (
              <div className="mt-8">
                <div className="text-lg font-semibold mb-2">
                  {score === null || maxScore === null ? (
                    <div className="flex items-center gap-2">
                      <span>Grading...</span>
                      <span className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-600"></span>
                    </div>
                  ) : (
                    <>Your Score: {score} / {maxScore}</>
                  )}
                </div>
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
