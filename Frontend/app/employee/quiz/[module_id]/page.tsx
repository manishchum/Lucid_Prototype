"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft } from "lucide-react";
import EmployeeNavigation from "@/components/employee-navigation";

export default function ModuleQuizPage({ params }: { params: { module_id: string } }) {
  const { user, loading: authLoading } = useAuth();
  
  // Handler for navigation
  const handleNext = () => {
    if (currentPage < totalPages - 1) {
      setCurrentPage(currentPage + 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handlePrevious = () => {
    if (currentPage > 0) {
      setCurrentPage(currentPage - 1);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  // Handler for quiz submission
  const handleSubmit = async () => {
    // console.log("It is submitting")
    // console.log(quiz)
    // console.log(!Array.isArray(quiz))
    if (!quiz ) return;
    // Ensure assessmentId is set before submission
    if (!assessmentId) {
      // console.log("Inside thse !assessmentId block")
      setFeedback("Error: Could not identify assessment. Please refresh and try again.");
      return;
    }
    setSubmitted(true);
    setIsSubmitting(true);
    // Normalize answers for MCQ questions (send selected option values, not indices)
    // console.log("Outside the last return before userAnswers")
    const userAnswers = answers.map((ans, i) => {
      const q = quiz[i];
      // For MCQ questions, send the selected option text, not the index
      // If no answer selected (ans === -1), send empty string
      if (typeof ans === 'number' && ans >= 0 && ans < q.options.length) {
        // console.log("Inside the last return")
        return q.options[ans];
      }
      // No valid answer selected
      // console.log("Outside the last return")
      return '';
    });

    // console.log('[QUIZ] Raw answers:', answers);
    // console.log('[QUIZ] Converted userAnswers:', userAnswers);
    // Always fetch user info before API call
    let employeeId: string | null = null;
    let employeeName: string | null = null;
    if (!authLoading && user?.email) {
      try {
        const { data: emp } = await supabase
          .from('users')
          .select('user_id')
          .eq('email', user.email)
          .single();
        employeeId = emp?.user_id || null;
  employeeName = (user as any)?.displayName || user.email || null;
      } catch (err) {
        // console.log('[QUIZ] Error fetching employee record:', err);
      }
    }
    if (!employeeId) {
      setFeedback("Error: Could not identify employee. Please refresh and try again.");
      return;
    }
    const payload = {
      quiz,
      userAnswers,
      // Let the API score module quizzes using Gemini
      user_id: employeeId,
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
      // console.log(payload);
      // console.log(res);
      const result = await res.json();
      feedbackText = result.feedback || "";
      if (typeof result.score === 'number') setScore(result.score);
      if (typeof result.maxScore === 'number') setMaxScore(result.maxScore);
      setFeedback(feedbackText);
      // Log quiz taken into module_progress
      try {
        // console.log(result);
        await fetch('/api/module-progress', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: employeeId,
            processed_module_id: resolvedModuleId || moduleId,
            quiz_score: typeof result.score === 'number' ? result.score : null,
            max_score: typeof result.maxScore === 'number' ? result.maxScore : quiz.length,
            quiz_feedback: feedbackText,
            completed_at: new Date().toISOString(),
          }),
        });
      } catch (e) {
        // console.log('[QUIZ] progress log error', e);
      }
    } catch (err) {
      feedbackText = "Could not generate feedback.";
      setFeedback(feedbackText);
    } finally {
      setIsSubmitting(false);
    }
  };

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
  const [resolvedModuleId, setResolvedModuleId] = useState<string | null>(null);
  const router = useRouter();
  let  userId:any = null;
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
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentPage]);

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
      
      // Fetch module metadata and resolve canonical processed_module_id
      try {
        let moduleData: any = null;
        const byProcessed = await supabase
          .from('processed_modules')
          .select('processed_module_id, original_module_id, title')
          .eq('processed_module_id', moduleId)
          .maybeSingle();
        moduleData = byProcessed?.data || null;

        if (!moduleData) {
          const byOriginal = await supabase
            .from('processed_modules')
            .select('processed_module_id, original_module_id, title')
            .eq('original_module_id', moduleId)
            .maybeSingle();
          moduleData = byOriginal?.data || null;
        }

        if (moduleData) {
          if (moduleData.title) setModuleName(moduleData.title);
          if (moduleData.processed_module_id) setResolvedModuleId(String(moduleData.processed_module_id));
        }
      } catch (e) {
        // console.log('[quiz] module metadata fetch error', e);
      }
      
      let learningStyle: string | null = null;
      if (!authLoading && user?.email) {
        // console.log("Inside the quiz tab")
        // console.log(user.email)
        try {
          const { data: emp } = await supabase
            .from('users')
            .select('user_id')
            .eq('email', user.email)
            .single();
            userId = emp?.user_id || null;
            // console.log(userId)
          if (emp?.user_id) {
            const { data: styleData } = await supabase
              .from('employee_learning_style')
              .select('learning_style')
              .eq('user_id', emp.user_id)
              .maybeSingle();
            if (styleData?.learning_style) {
              learningStyle = styleData.learning_style;
            }
          }
        } catch (e) {
          // console.log('[quiz] employee fetch error', e);
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
        .select("assessment_id, questions, processed_modules!inner(original_module_id,user_id)")
        .eq("type", "module")
        .eq("processed_modules.original_module_id", moduleId)
        .eq('processed_modules.user_id', userId)
        .eq("learning_style", learningStyle);
      const { data: assessment } = await query.maybeSingle();
      // console.log('[QUIZ DEBUG] Assessment fetch result:', assessment);
      // console.log(moduleId, learningStyle);
      if (assessment && assessment.questions) {
        try {
          const quizData = Array.isArray(assessment.questions) ? assessment.questions : JSON.parse(assessment.questions);
          // console.log('[QUIZ DEBUG] Parsed quizData from assessment:', quizData);
          setQuiz(quizData);
          setAnswers(new Array(quizData.length).fill(-1));
          setAssessmentId(assessment.assessment_id);
        } catch (e) {
          // console.log('[QUIZ DEBUG] Failed to parse quiz data:', e, assessment.questions);
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
          body: JSON.stringify({ moduleId, learningStyle, userId }),
        });
        const result = await res.json();
        // console.log('[QUIZ DEBUG] /api/gpt-mcq-quiz result:', result);
        if (result.quiz) {
          setQuiz(result.quiz);
          setAnswers(new Array(result.quiz.length).fill(-1));
          const { data: newAssessment } = await supabase
            .from("assessments")
            .select("assessment_id")
            .eq("type", "module")
            .eq("processed_module_id", moduleId)
            .eq("learning_style", learningStyle)
            .maybeSingle();
            // console.log("This is the module id:", moduleId)
          // console.log('[QUIZ DEBUG] New assessment after quiz generation:', newAssessment);
          if (newAssessment && newAssessment.assessment_id) setAssessmentId(newAssessment.assessment_id);
       
       
       
        } else {
          // console.log("Inside the else statment of result.quiz")
          setQuiz(null);
          setError(result.error || "Quiz generation failed.");
        }



        
      } catch (err) {
        // console.log('[QUIZ DEBUG] Error during quiz generation:', err);
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
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
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
        <div className="max-w-7xl mx-auto">
          {/* Back Button */}
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-blue-600 hover:text-blue-800 font-medium mb-6 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
            Back
          </button>
        
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

            {/* Individual Question Cards */}
            <div className="space-y-8">
              {currentQuestions.map((q, idx) => {
                const globalIdx = currentPage * questionsPerPage + idx;
                const isAnswered = answers[globalIdx] !== -1 && answers[globalIdx] !== '';
                
                return (
                  <Card key={globalIdx} className="shadow-lg">
                    <CardContent className="p-6">
                      <div className="font-medium text-base sm:text-lg mb-3">
                        {globalIdx + 1}. {q.question}
                      </div>
                      
                      {/* Answer Options */}
                      {(Array.isArray(q.options) && q.options.length > 0) ? (
                        <div className="space-y-2 mt-3">
                          {q.options.map((opt: string, oIdx: number) => (
                            <button
                              key={oIdx}
                              onClick={() => handleSelect(globalIdx, oIdx)}
                              disabled={submitted}
                              className={`w-full p-4 text-left border-2 rounded-lg transition-all duration-200 hover:shadow-md ${
                                answers[globalIdx] === oIdx
                                  ? "border-blue-500 bg-blue-50 shadow-sm"
                                  : "border-gray-200 hover:border-gray-300"
                              } ${submitted ? "cursor-not-allowed" : "cursor-pointer"}`}
                            >
                              <div className="flex items-center gap-3">
                                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                                  answers[globalIdx] === oIdx
                                    ? "border-blue-500 bg-blue-500"
                                    : "border-gray-300"
                                }`}>
                                  {answers[globalIdx] === oIdx && (
                                    <div className="w-2 h-2 rounded-full bg-white"></div>
                                  )}
                                </div>
                                <span className="text-sm sm:text-base">{opt}</span>
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="text-red-600 text-sm bg-red-50 p-3 rounded">
                          No options available for this question.
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Navigation */}
            <div className="flex justify-between items-center mt-6">
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
                  disabled={answers.some(a => a === -1 || a === '') || isSubmitting}
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
                  disabled={currentQuestions.some((_, idx) => {
                    const globalIdx = currentPage * questionsPerPage + idx;
                    return answers[globalIdx] === -1 || answers[globalIdx] === '';
                  })}
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
              {/* <CardDescription className="text-lg text-gray-600">
                Here are your results powered by Gemini AI
              </CardDescription> */}
            </CardHeader>
            <CardContent className="p-8">
              <div className="text-center mb-8">
                <div className="text-6xl font-bold text-green-600 mb-2">
                  {score !== null && maxScore !== null ? (
                    `${Math.round((score / maxScore) * 100)}%`
                  ) : (
                    <div className="flex items-center justify-center gap-2">
                      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
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
                  <h3 className="font-semibold text-blue-800 mb-3">AI Feedback & Analysis</h3>
                  <div className="text-blue-900 leading-relaxed">
                    {feedback.split('\n').map((line, index) => {
                      // Handle markdown headers
                      if (line.startsWith('### ')) {
                        return <h4 key={index} className="text-lg font-semibold mt-4 mb-2 text-blue-800">{line.replace('### ', '')}</h4>;
                      }
                      if (line.startsWith('## ')) {
                        return <h3 key={index} className="text-xl font-bold mt-6 mb-3 text-blue-900">{line.replace('## ', '')}</h3>;
                      }
                      if (line.startsWith('# ')) {
                        return <h2 key={index} className="text-2xl font-bold mt-6 mb-4 text-blue-900">{line.replace('# ', '')}</h2>;
                      }
                      // Handle horizontal rules
                      if (line.trim() === '---') {
                        return <hr key={index} className="my-4 border-blue-300" />;
                      }
                      // Handle bullet points
                      if (line.startsWith('* ')) {
                        const processedLine = line.replace('* ', '').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/<strong>(.*?)<\/strong>/g, '<strong>$1</strong>');
                        return <li key={index} className="ml-4 mb-1 text-blue-900 list-disc" dangerouslySetInnerHTML={{ __html: processedLine }}></li>;
                      }
                      // Handle bold text and empty lines
                      if (line.trim() === '') {
                        return <br key={index} />;
                      }
                      // Handle regular paragraphs with both markdown and HTML bold formatting
                      let processedLine = line
                        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Convert markdown bold to HTML
                        .replace(/<strong>(.*?)<\/strong>/g, '<strong>$1</strong>'); // Keep existing HTML bold tags
                      
                      return <p key={index} className="mb-2 text-blue-900" dangerouslySetInnerHTML={{ __html: processedLine }}></p>;
                    })}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        </div>
      </div>
    </div>
  );
}
