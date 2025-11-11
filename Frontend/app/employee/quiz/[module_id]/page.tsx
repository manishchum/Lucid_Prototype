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
  // Handler for navigation
  const handleNext = () => {
    if (currentPage < totalPages - 1) {
      setCurrentPage(currentPage + 1);
    }
  };

  const handlePrevious = () => {
    if (currentPage > 0) {
      setCurrentPage(currentPage - 1);
    }
  };

  // Handler for quiz submission
  const handleSubmit = async () => {
    if (!quiz || !Array.isArray(quiz)) return;
    // Ensure assessmentId is set before submission
    if (!assessmentId) {
      setFeedback("Error: Could not identify assessment. Please refresh and try again.");
      return;
    }
    setSubmitted(true);
    setIsSubmitting(true);
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
          .select('employee_id')
          .eq('email', user.email)
          .single();
        employeeId = emp?.employee_id || null;
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
    } finally {
      setIsSubmitting(false);
    }
  };
// ...existing code...

  const moduleId = params.module_id;
  const [quiz, setQuiz] = useState<any[] | null>(null);
  const [moduleName, setModuleName] = useState<string>("Module Quiz");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // answers can be: number (mcq), string (open-ended), number[] (multiple select), Record<string, string> (matching)
  const [answers, setAnswers] = useState<Array<number | string | number[] | Record<string, string>>>([]);
  const [submitted, setSubmitted] = useState(false);
  const [score, setScore] = useState<number | null>(null);
  const [maxScore, setMaxScore] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const router = useRouter();

  const questionsPerPage = 10;
  const totalPages = quiz ? Math.ceil(quiz.length / questionsPerPage) : 0;
  const currentQuestions = quiz ? quiz.slice(currentPage * questionsPerPage, (currentPage + 1) * questionsPerPage) : [];
  const answeredQuestions = answers.filter(a => a !== -1 && a !== '').length;
  const progressPercentage = quiz ? (answeredQuestions / quiz.length) * 100 : 0;

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
      
      // Fetch module name first
      try {
        const { data: moduleData } = await supabase
          .from('processed_modules')
          .select('title')
          .eq('module_id', moduleId)
          .single();
        
        if (moduleData?.title) {
          setModuleName(moduleData.title);
        }
      } catch (e) {
        console.log('[quiz] module name fetch error', e);
      }
      
      let learningStyle: string | null = null;
      if (!authLoading && user?.email) {
        try {
          const { data: emp } = await supabase
            .from('employees')
            .select('employee_id')
            .eq('email', user.email)
            .single();
          if (emp?.employee_id) {
            const { data: styleData } = await supabase
              .from('employee_learning_style')
              .select('learning_style')
              .eq('employee_id', emp.employee_id)
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
        .select("assessment_id, questions")
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
          setAssessmentId(assessment.assessment_id);
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
            .select("assessment_id")
            .eq("type", "module")
            .eq("module_id", moduleId)
            .eq("learning_style", learningStyle)
            .maybeSingle();
          console.log('[QUIZ DEBUG] New assessment after quiz generation:', newAssessment);
          if (newAssessment && newAssessment.assessment_id) setAssessmentId(newAssessment.assessment_id);
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
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100">
      <EmployeeNavigation 
        customBackPath={`/employee/module/${params.module_id}`}
        showForward={false}
      />
      
      {/* Main content area that adapts to sidebar */}
      <div 
        className="transition-all duration-300 ease-in-out px-4 py-8"
        style={{ 
          marginLeft: 'var(--sidebar-width, 0px)',
        }}
      >
        <div className="max-w-3xl mx-auto">
        
        {!submitted ? (
          <>
            {/* Progress Header */}
            <Card className="mb-6 shadow-lg border-t-4 border-t-blue-500">
              <CardHeader className="bg-gradient-to-r from-blue-50 to-indigo-50">
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <CardTitle className="text-2xl font-bold text-gray-800">Test your Understanding: {moduleName}</CardTitle>
                    {/* <CardDescription className="text-lg text-gray-600">
                      Test your knowledge on this module content
                    </CardDescription> */}
                  </div>
                  <div className="text-right">
                    <div className="text-sm text-gray-500 mb-1">Progress</div>
                    <div className="text-2xl font-bold text-blue-600">
                      {answeredQuestions}/{quiz?.length || 0}
                    </div>
                  </div>
                </div>
                
                {/* Progress Bar */}
                <div className="space-y-2">
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Questions Answered</span>
                    <span>{Math.round(progressPercentage)}% Complete</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3 shadow-inner">
                    <div 
                      className="bg-gradient-to-r from-blue-500 to-blue-600 h-3 rounded-full transition-all duration-500 shadow-sm"
                      style={{ width: `${progressPercentage}%` }}
                    ></div>
                  </div>
                </div>

                {/* Page Indicator */}
                {totalPages > 1 && (
                  <div className="flex justify-center mt-4">
                    <div className="flex space-x-2">
                      {Array.from({ length: totalPages }).map((_, idx) => (
                        <div
                          key={idx}
                          className={`w-3 h-3 rounded-full transition-colors ${
                            idx === currentPage 
                              ? 'bg-blue-500' 
                              : idx < currentPage 
                                ? 'bg-green-400' 
                                : 'bg-gray-300'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </CardHeader>
            </Card>

            {/* Questions Card */}
            <Card className="mb-6 shadow-xl">
              <CardHeader className="bg-white border-b">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-xl text-gray-800">
                    Questions {currentPage * questionsPerPage + 1}-{Math.min((currentPage + 1) * questionsPerPage, quiz?.length || 0)}
                  </CardTitle>
                  {totalPages > 1 && (
                    <div className="text-sm text-gray-500">
                      Page {currentPage + 1} of {totalPages}
                    </div>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-8">
                <div className="space-y-8">
                  {currentQuestions.map((q, idx) => {
                    const globalIdx = currentPage * questionsPerPage + idx;
                    const isAnswered = answers[globalIdx] !== -1 && answers[globalIdx] !== '';
                    
                    return (
                      <div key={globalIdx} className={`p-6 rounded-lg border-2 transition-all ${
                        isAnswered 
                          ? 'border-green-200 bg-green-50' 
                          : 'border-gray-200 bg-white hover:border-blue-200'
                      }`}>
                        <div className="flex items-start gap-4">
                          {/* Question Number */}
                          <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                            isAnswered 
                              ? 'bg-green-500 text-white' 
                              : 'bg-blue-100 text-blue-700'
                          }`}>
                            {globalIdx + 1}
                          </div>
                          
                          <div className="flex-1">
                            {/* Question Text */}
                            <div className="font-semibold text-lg text-gray-800 mb-4">
                              {q.question}
                            </div>
                            
                            {/* Answer Options */}
                            {(Array.isArray(q.options) && q.options.length > 0) ? (
                              <div className="space-y-3">
                                {q.options.map((opt: string, oIdx: number) => (
                                  <label 
                                    key={oIdx} 
                                    className={`flex items-center p-3 rounded-lg border cursor-pointer transition-all ${
                                      answers[globalIdx] === oIdx
                                        ? 'border-blue-500 bg-blue-50 shadow-md'
                                        : 'border-gray-200 hover:border-blue-300 hover:bg-blue-25'
                                    }`}
                                  >
                                    <input
                                      type="radio"
                                      name={`q${globalIdx}`}
                                      checked={answers[globalIdx] === oIdx}
                                      onChange={() => handleSelect(globalIdx, oIdx)}
                                      disabled={submitted}
                                      className="sr-only"
                                    />
                                    <div className={`w-5 h-5 rounded-full border-2 mr-3 flex items-center justify-center ${
                                      answers[globalIdx] === oIdx
                                        ? 'border-blue-500 bg-blue-500'
                                        : 'border-gray-300'
                                    }`}>
                                      {answers[globalIdx] === oIdx && (
                                        <div className="w-2 h-2 rounded-full bg-white"></div>
                                      )}
                                    </div>
                                    <span className="text-gray-700 flex-1">{opt}</span>
                                  </label>
                                ))}
                              </div>
                            ) : (
                              <div className="text-red-600 text-sm bg-red-50 p-3 rounded">
                                No options available for this question.
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* Navigation */}
            <div className="flex justify-between items-center">
              <Button
                variant="outline"
                onClick={handlePrevious}
                disabled={currentPage === 0}
                className="px-6 py-3"
              >
                Previous
              </Button>
              
              <div className="text-sm text-gray-500">
                {totalPages > 1 && `Page ${currentPage + 1} of ${totalPages}`}
              </div>
              
              {currentPage === totalPages - 1 ? (
                <Button
                  onClick={handleSubmit}
                  disabled={answers.some(a => a === -1) || isSubmitting}
                  className="px-8 py-3 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700"
                >
                  {isSubmitting ? (
                    <div className="flex items-center gap-2">
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      Submitting...
                    </div>
                  ) : (
                    'Submit Quiz'
                  )}
                </Button>
              ) : (
                <Button
                  onClick={handleNext}
                  disabled={currentPage === totalPages - 1}
                  className="px-6 py-3"
                >
                  Next
                </Button>
              )}
            </div>
          </>
        ) : (
          /* Results Card */
          <Card className="shadow-2xl border-t-4 border-t-green-500">
            <CardHeader className="bg-gradient-to-r from-green-50 to-blue-50 text-center">
              <CardTitle className="text-3xl font-bold text-gray-800 mb-2">
                Quiz Complete! 🎉
              </CardTitle>
              <CardDescription className="text-lg text-gray-600">
                Here are your results
              </CardDescription>
            </CardHeader>
            <CardContent className="p-8">
              <div className="text-center mb-8">
                <div className="text-6xl font-bold text-green-600 mb-2">
                  {score !== null && maxScore !== null ? (
                    `${Math.round((score / maxScore) * 100)}%`
                  ) : (
                    <div className="flex items-center justify-center gap-2">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-green-600"></div>
                      <span className="text-2xl">Grading...</span>
                    </div>
                  )}
                </div>
                {score !== null && maxScore !== null && (
                  <div className="text-xl text-gray-600 mb-4">
                    You scored {score} out of {maxScore} questions correctly
                  </div>
                )}
              </div>

              {feedback && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-6 mb-6">
                  <h3 className="font-semibold text-blue-800 mb-3">Feedback & Analysis</h3>
                  <div className="text-blue-900 whitespace-pre-line leading-relaxed">
                    {feedback}
                  </div>
                </div>
              )}

              <div className="text-center">
                <Button 
                  onClick={() => router.back()}
                  className="px-8 py-3 text-lg"
                  variant="outline"
                >
                  Back to Training Plan
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        </div>
      </div>
    </div>
  );
}
