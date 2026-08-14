"use client";
import { useEffect, useState, use } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import { sharedDataClient, createCacheKey } from "@/lib/data-client";
import { fetchWithAuth } from "@/lib/fetch-with-auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, CheckCircle2, XCircle } from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

const parseMaybeJson = (value: any) => {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return value;

  const trimmed = value.trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    try {
      return JSON.parse(trimmed.replace(/^"+|"+$/g, ""));
    } catch {
      return value;
    }
  }
};

const normalizeStoredAnswers = (storedAnswers: any, quizData: any[]) => {
  const parsed = parseMaybeJson(storedAnswers);
  const answersArray = Array.isArray(parsed) ? parsed : [];

  return quizData.map((q, idx) => {
    const rawAnswer = answersArray[idx];
    const options = Array.isArray(q?.options) ? q.options : [];

    if (typeof rawAnswer === "number" && rawAnswer >= 0 && rawAnswer < options.length) {
      return rawAnswer;
    }

    if (typeof rawAnswer === "string") {
      const normalized = rawAnswer.trim();
      const matchedIndex = options.findIndex((opt: string) => String(opt).trim() === normalized);
      if (matchedIndex >= 0) {
        return matchedIndex;
      }
    }

    return -1;
  });
};

const parseQuestionFeedback = (storedQuestionFeedback: any) => {
  const parsed = parseMaybeJson(storedQuestionFeedback);

  if (Array.isArray(parsed)) {
    return parsed.map((item) => String(item ?? ""));
  }

  if (typeof parsed === "string") {
    return parsed
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  return [];
};

const calculateLocalQuizResult = (quizData: any[], answerState: Array<number | string | number[] | Record<string, string>>) => {
  const questionFeedback: string[] = [];
  const correctAnswers: Array<{
    questionIndex: number;
    question: any;
    userAnswer: string;
    correctAnswer: string;
    isCorrect: boolean;
    explanation: any;
    bloomLevel: any;
  }> = [];

  let score = 0;
  const maxScore = Array.isArray(quizData) ? quizData.length : 0;

  quizData.forEach((question, index) => {
    const options = Array.isArray(question?.options) ? question.options : [];
    const correctIndex = typeof question?.correctIndex === "number" ? question.correctIndex : -1;
    const selectedIndex = typeof answerState[index] === "number" ? (answerState[index] as number) : -1;

    const correctAnswer = correctIndex >= 0 && options[correctIndex] !== undefined
      ? String(options[correctIndex]).trim()
      : "Correct answer unavailable";

    const userAnswer = selectedIndex >= 0 && options[selectedIndex] !== undefined
      ? String(options[selectedIndex]).trim()
      : "No answer provided";

    const isCorrect = selectedIndex >= 0 && selectedIndex === correctIndex;

    if (isCorrect) {
      score += 1;
      questionFeedback.push("Correct! Well done.");
    } else {
      const explanation = question?.explanation;
      questionFeedback.push(
        explanation || `Incorrect. The correct answer is: "${correctAnswer}". You answered: "${userAnswer}".`
      );
    }

    correctAnswers.push({
      questionIndex: index,
      question: question?.question,
      userAnswer,
      correctAnswer,
      isCorrect,
      explanation: question?.explanation ?? null,
      bloomLevel: question?.bloomLevel ?? null,
    });
  });

  const percentage = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

  return {
    score,
    maxScore,
    percentage,
    questionFeedback,
    correctAnswers,
  };
};

const fetchUserByEmail = async (email: string) => {
  if(!email) return null;
  try {
    const res = await fetchWithAuth(`${API_BASE}/api/users/by-email/${encodeURIComponent(email)}`);
    if (!res.ok) return null;
    const payload = await res.json();
    let u = payload?.data ?? payload?.user ?? payload;
    if (Array.isArray(u)) u = u[0];
    return u || null;
  } catch (e) {
    console.error("Error fetching user by email:", e);
    return null;
  }
};

export default function ModuleQuizPage({ params }: { params: Promise<{ module_id: string }> }) {
  const unwrappedParams = use(params);
  
  const [originalModuleId, setOriginalModuleId] = useState<string>(unwrappedParams.module_id);

  const { user, loading: authLoading } = useAuth();

  const refreshScoreHistoryCache = async (employeeId: string) => {
    const assessmentsCacheKey = createCacheKey({
      namespace: "assessments",
      userId: String(employeeId),
      path: "/employee-assessments",
    });

    sharedDataClient.invalidate(assessmentsCacheKey);

    await sharedDataClient.query(
      assessmentsCacheKey,
      async () => {
        const res = await fetchWithAuth(`${API_BASE}/api/employee-assessments/user/${encodeURIComponent(employeeId)}`,
          {
            headers: { "X-User-ID": employeeId },
          },
        );
        if (!res.ok) {
          throw new Error("Failed to refetch employee assessments");
        }
        return res.json();
      },
      {
        ttlMs: 2 * 60 * 1000,
        swr: true,
        forceRefresh: true,
      },
    );
  };
  
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
      setError("Error: Could not identify assessment. Please refresh and try again.");
      return;
    }
    setSubmitted(true);
    setIsSubmitting(true);

    const localResult = calculateLocalQuizResult(quiz, answers);
    setScore(localResult.score);
    setMaxScore(localResult.maxScore);
    setQuestionFeedback(localResult.questionFeedback);

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
        const emp = await fetchUserByEmail(user.email);
        employeeId = emp?.user_id || null;
        employeeName = (user as any)?.displayName || user.email || null;
      } catch (err) {
        // console.log('[QUIZ] Error fetching employee record:', err);
      }
    }
    if (!employeeId) {
      setFeedback("Error: Could not identify employee. Please refresh and try again.");
      setSubmitted(false);
      setIsSubmitting(false);
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
      const res = await fetchWithAuth(`${API_BASE}/api/gpt-feedback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-ID": employeeId,
        },
        body: JSON.stringify(payload),
      });
      // console.log(payload);
      // console.log(res);
      const result = await res.json();
      feedbackText = result.feedback || "";
      setFeedback(feedbackText);
      if (Array.isArray(result.questionFeedback) && result.questionFeedback.length > 0) {
        setQuestionFeedback(result.questionFeedback.map((item: any) => String(item ?? "")));
      }

      if (res.ok) {
        try {
          await refreshScoreHistoryCache(employeeId);
        } catch (cacheErr) {
          console.warn('[QUIZ] score-history cache refresh failed', cacheErr);
        }
      }

      // Log quiz taken into module_progress
      try {
        // console.log(result);
        await fetchWithAuth(`${API_BASE}/api/module-progress`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-User-ID': employeeId,
          },
          body: JSON.stringify({
            user_id: employeeId,
            processed_module_id: resolvedModuleId || moduleId,
            module_id: originalModuleId,
            quiz_score: localResult.score,
            max_score: localResult.maxScore,
            quiz_feedback: feedbackText,
            completed_at: new Date().toISOString(),
          }),
        });
        
        sharedDataClient.invalidateByPrefix("v1|dashboard");
        sharedDataClient.invalidateByPrefix("v1|training-plan");
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

  const moduleId = unwrappedParams.module_id;
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
  const [questionFeedback, setQuestionFeedback] = useState<string[]>([]);
  const [assessmentId, setAssessmentId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resolvedModuleId, setResolvedModuleId] = useState<string | null>(null);
  const [isReviewMode, setIsReviewMode] = useState(false);
  const router = useRouter();
  let  userId:any = null;
  let companyId:any = null;
  const questionsPerPage = 10;
  const totalPages = quiz ? Math.ceil(quiz.length / questionsPerPage) : 0;
  const currentQuestions = quiz ? quiz.slice(currentPage * questionsPerPage, (currentPage + 1) * questionsPerPage) : [];
  const answeredQuestions = answers.filter(a => a !== -1 && a !== '').length;
  const progressPercentage = quiz ? (answeredQuestions / quiz.length) * 100 : 0;

  const loadExistingAttempt = async (currentAssessmentId: string, quizData: any[], employeeId: string, processedModuleId: string | null) => {
    try {
      if (!processedModuleId) return false;

      const progressRes = await fetchWithAuth(
        `${API_BASE}/api/module-progress/user/${encodeURIComponent(employeeId)}/module/${encodeURIComponent(processedModuleId)}`,
        {
          headers: { "X-User-ID": employeeId },
        },
      );

      if (!progressRes.ok) return false;

      const progressPayload = await progressRes.json();
      const progressRecord = progressPayload?.progress ?? progressPayload?.data?.progress ?? progressPayload?.data ?? null;
      const isCompleted = Boolean(progressRecord?.completed_at || progressRecord?.quiz_score != null);

      if (!isCompleted) return false;

      const res = await fetchWithAuth(
        `${API_BASE}/api/employee-assessments/user/${encodeURIComponent(employeeId)}?assessment_id=${encodeURIComponent(currentAssessmentId)}&limit=5`,
        {
          headers: { "X-User-ID": employeeId },
        },
      );

      if (!res.ok) return false;

      const payload = await res.json();
      const attempts = payload?.data?.assessments ?? payload?.assessments ?? [];
      const latestAttempt = Array.isArray(attempts) ? attempts[0] : null;

      if (!latestAttempt) return false;

      const hasTakenQuiz = Boolean(
        latestAttempt.completed_at ||
        latestAttempt.score != null ||
        latestAttempt.feedback ||
        latestAttempt.question_feedback,
      );

      if (!hasTakenQuiz) return false;

      setAnswers(normalizeStoredAnswers(latestAttempt.answers, quizData));
      setScore(typeof latestAttempt.score === "number" ? latestAttempt.score : null);
      setMaxScore(
        typeof latestAttempt.max_score === "number" && latestAttempt.max_score > 0
          ? latestAttempt.max_score
          : quizData.length,
      );
      setFeedback(typeof latestAttempt.feedback === "string" ? latestAttempt.feedback : null);
      setQuestionFeedback(parseQuestionFeedback(latestAttempt.question_feedback));
      setSubmitted(true);
      setIsReviewMode(true);
      return true;
    } catch (error) {
      console.warn("[QUIZ] Failed to load existing attempt:", error);
      return false;
    }
  };

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
  // const handleTextAnswer = (qIdx: number, value: string) => {
  //   if (submitted) return;
  //   setAnswers((prev) => {
  //     const next = [...prev];
  //     next[qIdx] = value;
  //     return next;
  //   });
  // };

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
      setSubmitted(false);
      setIsReviewMode(false);
      setScore(null);
      setMaxScore(null);
      setFeedback(null);
      setQuestionFeedback([]);

      // Fetch employee data first to get userId for API calls
      let learningStyle: string | null = null;
      let canonicalProcessedModuleId: string | null = null;
      if (!authLoading && user?.email) {
        // console.log("Inside the quiz tab")
        // console.log(user.email)
        try {
          const emp = await fetchUserByEmail(user.email);
          userId = emp?.user_id || null;
          companyId = emp?.company_id || null;
          if (emp?.user_id) {
            try {
              const styleRes = await fetchWithAuth(`${API_BASE}/api/learning-style?user_id=${emp.user_id}`, {
                headers: { 'X-User-ID': emp.user_id }
              });
              if (styleRes.ok) {
                const styleJson = await styleRes.json();
                const styleData = styleJson?.data || styleJson;
                if (styleData?.learning_style) {
                  learningStyle = styleData.learning_style;
                }
                // console.log("Style Data:- ", styleData);
              }
            } catch (styleErr) {
              console.error('[quiz] error fetching learning style', styleErr);
            }
          }
        } catch (e) {
          // console.log('[quiz] employee fetch error', e);
        }
      }
      
      // Fetch module metadata and resolve canonical processed_module_id
      if (userId) {
        try {
          let moduleData: any = null;
          
          // First try: fetch by processed_module_id
          try {
            const res = await fetchWithAuth(`${API_BASE}/api/processed-modules/${moduleId}`, {
              headers: {
                'X-User-ID': userId
              }
            });

            if (res.ok) {
              const payload = await res.json();
              moduleData = payload?.data || payload;
            }
          } catch (error) {
            console.error('[quiz] Error fetching by processed_module_id:', error);
          }

          // Second try: if not found, fetch by original_module_id
          if (!moduleData) {
            try {
              const res = await fetchWithAuth(`${API_BASE}/api/processed-modules/original-module/${moduleId}`, {
                headers: {
                  'X-User-ID': userId
                }
              });

              if (res.ok) {
                const payload = await res.json();
                const modules = payload?.data || payload || [];
                // Take the first match
                moduleData = modules[0] || null;
              }
            } catch (error) {
              console.error('[quiz] Error fetching by original_module_id:', error);
            }
          }

          if (moduleData) {
            if (moduleData.title) setModuleName(moduleData.title);
            if(moduleData.original_module_id) setOriginalModuleId(String(moduleData.original_module_id));
            if (moduleData.processed_module_id) {
              canonicalProcessedModuleId = String(moduleData.processed_module_id);
              setResolvedModuleId(canonicalProcessedModuleId);
            }
            // console.log('Value of originalModuleId:', originalModuleId);
          }
        } catch (e) {
          // console.log('[quiz] module metadata fetch error', e);
        }
      }
      if (!learningStyle) {
        learningStyle = 'General';
      }
      // 1. Try to fetch existing quiz for this module and Performance Sprint
      let assessment = null;
      try {
        const res = await fetchWithAuth(
          `${API_BASE}/api/assessments/filter/search?type=module&original_module_id=${moduleId}&learning_style=${encodeURIComponent(learningStyle)}&user_id_filter=${userId}`,
          {
            headers: { 'X-User-ID': userId }
          }
        );
        if (res.ok) {
          const data = await res.json();
          const assessmentList = data?.data?.assessments ?? data?.assessments ?? [];
          assessment = assessmentList.length > 0 ? assessmentList[0] : null;
        }
      } catch (e) {
        console.error('[QUIZ] Error fetching assessment:', e);
      }
      // console.log('[QUIZ DEBUG] Assessment fetch result:', assessment);
      // console.log(moduleId, learningStyle);
      if (assessment && assessment.questions) {
        try {
          const quizData = Array.isArray(assessment.questions) ? assessment.questions : JSON.parse(assessment.questions);
          // console.log('[QUIZ DEBUG] Parsed quizData from assessment:', quizData);
          setQuiz(quizData);
          setAnswers(new Array(quizData.length).fill(-1));
          setAssessmentId(assessment.assessment_id);
          if (userId) {
            await loadExistingAttempt(String(assessment.assessment_id), quizData, String(userId), canonicalProcessedModuleId || resolvedModuleId || moduleId);
          }
        } catch (e) {
          // console.log('[QUIZ DEBUG] Failed to parse quiz data:', e, assessment.questions);
          setQuiz(null);
          setError("Failed to parse quiz data.");
        }
        setLoading(false);
        return;
      }
      try {
        const res = await fetchWithAuth(`${API_BASE}/api/gpt-mcq-quiz`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ moduleId, learningStyle, userId,companyId }),
        });
        const result = await res.json();
        // console.log('[QUIZ DEBUG] /api/gpt-mcq-quiz result:', result);
        if (result.quiz) {
          setQuiz(result.quiz);
          setAnswers(new Array(result.quiz.length).fill(-1));
                    if (result.assessmentId) {
             setAssessmentId(result.assessmentId);
          }
          // Fetch the newly created assessment from backend
          try {
            const assessmentRes = await fetchWithAuth(
              `${API_BASE}/api/assessments/filter/search?type=module&processed_module_id=${moduleId}&learning_style=${encodeURIComponent(learningStyle)}`,
              {
                headers: { 'X-User-ID': userId }
              }
            );
            if (assessmentRes.ok) {
              const assessmentData = await assessmentRes.json();
              const newAssessmentList = assessmentData?.data?.assessments ?? assessmentData?.assessments ?? [];
              const newAssessment = newAssessmentList.length > 0 ? newAssessmentList[0] : null;
              // console.log("This is the module id:", moduleId)
              // console.log('[QUIZ DEBUG] New assessment after quiz generation:', newAssessment);
              if (newAssessment && newAssessment.assessment_id) {
                setAssessmentId(newAssessment.assessment_id);
              }
            }
          } catch (e) {
            console.error('[QUIZ] Error fetching new assessment:', e);
          }
       
       
       
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



  // const handleSubmit = async () => {
   
  //   if (!quiz ) return;
  //   if (!assessmentId) {
  //     setFeedback("Error: Could not identify assessment. Please refresh and try again.");
  //     return;
  //   }
  //   setSubmitted(true);
  //   setIsSubmitting(true);
  //   const userAnswers = answers.map((ans, i) => {
  //     const q = quiz[i];
  //     if (typeof ans === 'number' && ans >= 0 && ans < q.options.length) {
  //       return q.options[ans];
  //     }
  //     return '';
  //   });

  //   let employeeId: string | null = null;
  //   let employeeName: string | null = null;
  //   if (!authLoading && user?.email) {
  //     try {
  //       const { data: emp } = await supabase
  //         .from('users')
  //         .select('user_id')
  //         .eq('email', user.email)
  //         .single();
  //       employeeId = emp?.user_id || null;
  // employeeName = (user as any)?.displayName || user.email || null;
  //     } catch (err) {
  //       console.log('[QUIZ] Error fetching employee record:', err);
  //     }
  //   }
  //   if (!employeeId) {
  //     setFeedback("Error: Could not identify employee. Please refresh and try again.");
  //     return;
  //   }
  //   const payload = {
  //     quiz,
  //     userAnswers,
  //     user_id: employeeId,
  //     employee_name: employeeName,
  //     assessment_id: assessmentId,
  //     modules: [{ module_id: moduleId }],
  //   };
  //   let feedbackText = "";
  //   try {
  //     const res = await fetch("/api/gpt-feedback", {
  //       method: "POST",
  //       headers: { "Content-Type": "application/json" },
  //       body: JSON.stringify(payload),
  //     });
  //     console.log("Inside the quiz page and the data is this",moduleId)
  //     console.log(payload);
  //     // console.log(res);
  //     const result = await res.json();
  //     feedbackText = result.feedback || "";
  //     if (typeof result.score === 'number') setScore(result.score);
  //     if (typeof result.maxScore === 'number') setMaxScore(result.maxScore);
  //     setFeedback(feedbackText);

  //     // Log quiz taken into module_progress
  //     try {
  //       const{data:originalModuleIID} = await supabase
  //       .from('processed_modules')
  //       .select('original_module_id')
  //       .eq('processed_module_id', moduleId);


  //       // .maybeSingle();
  //       console.log(moduleId)
  //       console.log("Original Module ID Query Result:", originalModuleIID);

  //       originalModuleId = originalModuleIID[0]?.original_module_id;
  //       console.log("Inside the module progress log")
  //       console.log(moduleId)

  //       console.log(originalModuleId)
  //       // console.log(result);
  //       await fetch('/api/module-progress', {
  //         method: 'POST',
  //         headers: { 'Content-Type': 'application/json' },
  //         body: JSON.stringify({
  //           user_id: employeeId,
  //           processed_module_id: resolvedModuleId || moduleId,
  //           quiz_score: typeof result.score === 'number' ? result.score : null,
  //           max_score: typeof result.maxScore === 'number' ? result.maxScore : quiz.length,
  //           quiz_feedback: feedbackText,
  //           completed_at: new Date().toISOString(),
  //           viewOnly: false,
  //           module_id: originalModuleId,
  //         }),

  //       });

  //       console.log("Inside the try and it is successfull")
  //     } catch (e) {
  //       console.log('[QUIZ] progress log error', e);
  //     }
  //   } catch (err) {
  //     feedbackText = "Could not generate feedback.";
  //     setFeedback(feedbackText);
  //   } finally {
  //     setIsSubmitting(false);
  //   }
  // };




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
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 px-4 py-8">
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
            <Card className="mb-6 shadow-lg border-t-4 border-t-transparent">
              <CardHeader className="bg-gradient-to-r from-blue-50 via-white to-purple-50">
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
                                className={`w-full p-3 sm:p-4 text-left border-2 rounded-lg transition-all duration-200 hover:shadow-md active:scale-[0.99] ${
                                answers[globalIdx] === oIdx
                                  ? "border-blue-500 bg-blue-50 shadow-sm ring-1 ring-blue-500/50"
                                  : "border-gray-200 hover:border-gray-300 hover:bg-slate-50"
                              } ${submitted ? "cursor-not-allowed" : "cursor-pointer"}`}
                            >
                              <div className="grid grid-cols-[20px_minmax(0,1fr)] items-start gap-3">
                                <div className={`w-5 h-5 aspect-square shrink-0 rounded-full border-2 flex items-center justify-center mt-0.5 ${
                                  answers[globalIdx] === oIdx
                                    ? "border-blue-500 bg-blue-500"
                                    : "border-gray-300"
                                  }`}>
                                    {answers[globalIdx] === oIdx && (
                                    <div className="w-2 h-2 rounded-full bg-white animate-in zoom-in duration-200 ease-out"></div>
                                  )}
                                </div>
                                <span className="min-w-0 text-sm sm:text-base leading-snug break-words">{opt}</span>
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
            <div className="flex justify-between items-center gap-3 mt-6 px-1">
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
                  className="px-6 py-3 min-w-[96px] bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-100 disabled:bg-blue-200 disabled:text-blue-700 disabled:border disabled:border-blue-300"
                >
                  Next
                </Button>
              )}
            </div>
          </>
        ) : (
          <>
          {/* Results Card */}
          <Card className="shadow-2xl border-t-4 border-t-green-500">
            <CardHeader className="bg-gradient-to-r from-green-50 to-blue-50 text-center">
              <CardTitle className="text-3xl font-bold text-gray-800 mb-2">
                Quiz Complete! 🎉
              </CardTitle>
              <CardDescription className="text-gray-600">
                {isReviewMode
                  ? "This quiz was already taken, so you are viewing a read-only review."
                  : "Your answers have been scored and saved."}
              </CardDescription>
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
                  <div className="text-xl text-gray-600 mb-6">
                    You scored {score} out of {maxScore} questions correctly
                  </div>
                )}
                
                {submitted && (
                  <Button
                    onClick={() => router.push('/employee/score-history')}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-3 text-lg font-semibold rounded-lg shadow-lg transition-all"
                  >
                    View Full Report
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
          <div className="space-y-8 mt-6">
            {currentQuestions.map((q, idx) => {
              const globalIdx = currentPage * questionsPerPage + idx;
              const selectedIndex = typeof answers[globalIdx] === "number" ? (answers[globalIdx] as number) : -1;
              const correctIndex = typeof q.correctIndex === "number" ? q.correctIndex : -1;
              const isCorrect = selectedIndex !== -1 && selectedIndex === correctIndex;
              const selectedText = selectedIndex >= 0 && q.options?.[selectedIndex] ? q.options[selectedIndex] : "No answer provided";
              const correctText = correctIndex >= 0 && q.options?.[correctIndex] ? q.options[correctIndex] : "Correct answer unavailable";
              const perQuestionFeedback = questionFeedback[globalIdx] || "";

              return (
                <Card key={globalIdx} className={`shadow-lg border-2 ${isCorrect ? "border-green-200" : "border-red-200"}`}>
                  <CardContent className="p-6">
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="font-medium text-base sm:text-lg">
                        {globalIdx + 1}. {q.question}
                      </div>
                      <div className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold ${isCorrect ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"}`}>
                        {isCorrect ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                        {isCorrect ? "Correct" : "Incorrect"}
                      </div>
                    </div>

                    {(Array.isArray(q.options) && q.options.length > 0) ? (
                      <div className="space-y-2 mt-3">
                        {q.options.map((opt: string, oIdx: number) => {
                          const isSelected = selectedIndex === oIdx;
                          const isAnswerKey = correctIndex === oIdx;
                          const optionClass = isCorrect
                            ? (isSelected ? "border-green-500 bg-green-50" : isAnswerKey ? "border-green-300 bg-green-50/70" : "border-gray-200 bg-white")
                            : (isSelected ? "border-red-500 bg-red-50" : isAnswerKey ? "border-green-300 bg-green-50/70" : "border-gray-200 bg-white");

                          return (
                            <div
                              key={oIdx}
                              className={`w-full p-3 sm:p-4 text-left border-2 rounded-lg transition-all duration-200 ${optionClass}`}
                            >
                              <div className="grid grid-cols-[20px_minmax(0,1fr)] items-start gap-3">
                                <div className={`w-5 h-5 aspect-square shrink-0 rounded-full border-2 flex items-center justify-center mt-0.5 ${
                                  isSelected
                                    ? isCorrect
                                      ? "border-green-500 bg-green-500"
                                      : "border-red-500 bg-red-500"
                                    : isAnswerKey
                                      ? "border-green-500 bg-green-500"
                                      : "border-gray-300"
                                }`}>
                                  {(isSelected || isAnswerKey) && (
                                    <div className="w-2 h-2 rounded-full bg-white"></div>
                                  )}
                                </div>
                                <span className="min-w-0 text-sm sm:text-base leading-snug break-words">{opt}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-red-600 text-sm bg-red-50 p-3 rounded">
                        No options available for this question.
                      </div>
                    )}

                    {/* <div className="grid gap-3 sm:grid-cols-2 mt-5">
                      <div className="rounded-lg bg-slate-50 p-3 border border-slate-200">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-1">Your answer</div>
                        <div className={`text-sm font-medium ${isCorrect ? "text-green-700" : "text-red-700"}`}>
                          {selectedText}
                        </div>
                      </div>
                      <div className="rounded-lg bg-green-50 p-3 border border-green-200">
                        <div className="text-xs font-semibold uppercase tracking-wide text-green-600 mb-1">Correct answer</div>
                        <div className="text-sm font-medium text-green-800">{correctText}</div>
                      </div>
                    </div> */}

                    {perQuestionFeedback && (
                      <div className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
                        {perQuestionFeedback}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
          {totalPages > 1 && (
            <div className="flex justify-between items-center gap-3 mt-6 px-1">
              <Button
                variant="outline"
                onClick={handlePrevious}
                disabled={currentPage === 0}
                className="px-6 py-3"
              >
                Previous
              </Button>

              <div className="text-sm text-gray-500">
                {`Page ${currentPage + 1} of ${totalPages}`}
              </div>

              <Button
                onClick={handleNext}
                disabled={currentPage >= totalPages - 1}
                className="px-6 py-3 min-w-[96px] bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-100 disabled:bg-blue-200 disabled:text-blue-700 disabled:border disabled:border-blue-300"
              >
                Next
              </Button>
            </div>
          )}
          </>
        )} 
      </div>
    </div>
  );
}
