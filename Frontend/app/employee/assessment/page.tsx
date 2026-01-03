"use client";

import React, { useEffect, useState } from "react";
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from "@/lib/supabase";
import MCQQuiz from "./mcq-quiz";
import { useAuth } from "@/contexts/auth-context";
import EmployeeNavigation from "@/components/employee-navigation";
import { ChevronLeft, CheckCircle, XCircle, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";

interface TrainingModule {
  module_id: string;
  title: string;
  ai_modules: string | null;
}

const AssessmentPage = () => {
  const { user } = useAuth();
  const [modules, setModules] = useState<TrainingModule[]>([]);
  const searchParams = useSearchParams();
  const [mcqQuestionsByModule, setMcqQuestionsByModule] = useState<Array<{ moduleId: string; title?: string; questions: any[] }>>([]);
  const [currentModuleIndex, setCurrentModuleIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [score, setScore] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [correctAnswers, setCorrectAnswers] = useState<any[]>([]);
  const [quizQuestions, setQuizQuestions] = useState<any[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [expandedSections, setExpandedSections] = useState<{[key: string]: boolean}>({
    learningStyle: false,
    howYouThrive: false,
    tips: false,
    questions: false
  });

  const router = useRouter();

  useEffect(() => {
    const fetchModules = async () => {
      setLoading(true);
      setError("");
      try {
        // Get employee's company_id first
        let companyId: string | null = null;
        if (user?.email) {
          const { data: empData } = await supabase
            .from("users")
            .select("company_id, user_id")
            .eq("email", user.email)
            .maybeSingle();
          companyId = empData?.company_id || null;
          setUserId(empData?.user_id || null);
        }
        if (!companyId) throw new Error("Could not find company for user");
        // Get modules for this company only
        const { data, error } = await supabase
          .from("training_modules")
          .select("module_id, title, ai_modules")
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
            .from("users")
            .select("user_id, company_id")
            .eq("email", user.email)
            .maybeSingle();
          companyId = empData?.company_id || null;
          employeeId = empData?.user_id || null;
        }
        if (!companyId || !employeeId) throw new Error("Could not find employee or company for user");
        
        // If a moduleId query param is present, request a per-module quiz.
        const urlModuleId = searchParams.get('moduleId');
        console.log("Error in getting learning_plan");
        let res;
        if (urlModuleId) {
          // Check if this is a baseline assessment request by looking at learning plan
          const { data: learningPlan } = await supabase
            .from('learning_plan')
            .select('baseline_assessment')
            .eq('user_id', employeeId)
            .eq('module_id', urlModuleId)
            .single()

          const isBaselineRequest = learningPlan && learningPlan.baseline_assessment === 1;
          console.log(isBaselineRequest)
          // console.log")
            console.log("Inside the if statement for per-module quiz request.");
          console.log(urlModuleId)
          res = await fetch('/api/gpt-mcq-quiz', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              moduleIds: [urlModuleId],
              companyId:companyId, 
              user_id: employeeId,
              isBaseline: isBaselineRequest,
              assessmentType: isBaselineRequest ? 'baseline' : 'module'
            }),
          });
        } else {
          // Request a baseline quiz for all assigned modules (multi-module baseline)
          console.log("Inside the else statement for per-module quiz request.");
          res = await fetch('/api/gpt-mcq-quiz', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              moduleIds: modules.map(m => m.module_id), 
              companyId,
              isBaseline: true,
              assessmentType: 'baseline'
            }),
          });
        }
        console.log(res)
        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`API returned ${res.status}: ${errorText}`);
        }
        const d = await res.json();
        console.log('[Assessment] Baseline quiz result:', d);
        
        // For per-module requests, the server returns an assessmentId we'll
        // attach so submissions can reference the created assessment. For
        // multi-module baselines we keep the existing 'baseline' behavior.
        let quizzes = [] as Array<{ moduleId: string; title?: string; questions: any[]; assessmentId?: string }>;
        if (d && d.quiz && Array.isArray(d.quiz) && d.quiz.length > 0) {
          if (d.assessmentId && urlModuleId) {
            quizzes = [{ moduleId: String(urlModuleId), title: modules.find(m => String(m.module_id) === String(urlModuleId))?.title || 'Module', questions: d.quiz, assessmentId: d.assessmentId }];
          } else {
            quizzes = [{ moduleId: 'baseline', title: 'Baseline Assessment', questions: d.quiz }];
          }
        }
        setMcqQuestionsByModule(quizzes);
      } catch (err: any) {
        setError("Failed to get quiz: " + err.message);
      } finally {
        setLoading(false);
      }
    };
    if (modules.length > 0) getMCQQuiz();
  }, [modules, user]);

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  const parseFeedbackSections = (feedback: string) => {
    // Extract main title/header from the feedback
    const headerMatch = feedback.match(/^##\s*(.+?)(?:\n|$)/m);
    const mainTitle = headerMatch ? headerMatch[1].trim() : "Assessment Results";
    
    // Parse sections from the feedback
    const sections: {[key: string]: string} = {};
    const sectionRegex = /###?\s*(.+?)(?:\n([\s\S]*?))?(?=###?|$)/g;
    let match;
    
    while ((match = sectionRegex.exec(feedback)) !== null) {
      const title = match[1].trim();
      const content = match[2]?.trim() || '';
      
      // Skip empty sections and the main header
      if (content && title !== mainTitle) {
        sections[title] = content;
      }
    }
    
    return { mainTitle, sections };
  };

  const formatContent = (content: string) => {
    return content
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/^\* (.*?)$/gm, '<li class="ml-4">$1</li>')
      .replace(/^(\d+)\.\s+(.*?)$/gm, '<li class="ml-4"><strong>$1.</strong> $2</li>')
      .replace(/\n\n/g, '</p><p class="mb-3">')
      .replace(/^(?!<[h|l|p])(.*?)$/gm, '<p class="mb-3">$1</p>');
  };

  const handleMCQSubmit = async (result: { score: number; answers: number[]; feedback: string[] }, moduleId: string) => {
    console.log("handleMCQSubmit called with result successfully.");
    setScore(result.score);
    setLoading(true);
    try {
      // 1. Fetch employee UUID from users table using user.email
      let employeeId: string | null = null;
      if (user?.email) {
        const { data: empData, error: empError } = await supabase
          .from("users")
          .select("user_id")
          .eq("email", user.email)
          .maybeSingle();
        if (empData?.user_id) {
          employeeId = empData.user_id;
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

      // 2. Determine assessmentId to attach to the employee_assessments row.
      // Prefer the assessmentId returned by the quiz endpoint for per-module
      // requests; otherwise fallback to a company baseline row (existing behavior).
      let assessmentId: string | null = null;
      const quizEntry = mcqQuestionsByModule[0];
      if (quizEntry && (quizEntry as any).assessmentId) {
        console.log("Inside in this if 1")
        assessmentId = (quizEntry as any).assessmentId;
        console.log(assessmentId)
        console.log(mcqQuestionsByModule)
        console.log(quizEntry)
      } else {
        const urlModuleId = searchParams.get('moduleId');

        // Look up (or create) the baseline assessment for this company
        console.log("Inside in this else 1")
        const { data: assessmentDef, error } = await supabase
              .from('assessments')
              .select(`
                assessment_id,
                processed_modules!inner (
                  user_id,
                  original_module_id
                )
              `)
              .eq('type', 'baseline')
              .eq('company_id', companyId)
              .eq('processed_modules.original_module_id', urlModuleId)
              .eq('processed_modules.user_id', userId)
              .limit(1)
              .maybeSingle();

        console.log("New Query to get the result")
        console.log(assessmentDef)
        if (assessmentDef?.assessment_id) {
          console.log("Inside in this if 2")
          assessmentId = assessmentDef.assessment_id;
        } else {
          console.log("Inside in this else 2")
          console.log(mcqQuestionsByModule)
          const questionsForModule = mcqQuestionsByModule.find((m) => m.moduleId === 'baseline')?.questions || [];
          const { data: newDef } = await supabase
            .from('assessments')
            .insert({ type: 'baseline', company_id: companyId, questions: JSON.stringify(questionsForModule) })
            .select()
            .single();
            assessmentId = newDef?.assessment_id || null;
          }
          console.log(assessmentId)
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
          user_id: employeeId,
          employee_name: user?.email,
          assessment_id: assessmentId,
        }),
      });
      const data = await res.json();
      console.log("Response from the /api/gpt-feedback endpoint:");
      console.log(res)
      setFeedback(data.feedback || "");
      
      setQuizQuestions(mcqQuestionsByModule.find(m => m.moduleId === 'baseline')?.questions || []);
      
      const questions = mcqQuestionsByModule.find(m => m.moduleId === 'baseline')?.questions || [];
      const answersData = questions.map((q: any, idx: number) => ({
        question: q.question,
        userAnswer: q.options[result.answers[idx]] || 'No answer',
        correctAnswer: q.options[q.correctIndex] || 'Unknown',
        isCorrect: result.answers[idx] === q.correctIndex,
        explanation: q.explanation || '',
        bloomLevel: q.bloomLevel || 'Unknown'
      }));
      setCorrectAnswers(answersData);
      // Notify the navigation to show a one-time "click for detailed report" toast
      try {
        // Set a session flag so the sidebar can show the toast once
        sessionStorage.setItem('show_report_toast', '1');
      } catch (e) {
        // ignore in server or privacy-restricted contexts
      }
      
    } catch (err: any) {
      setFeedback("Could not generate feedback.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full">
      <EmployeeNavigation showBack={true} showForward={false} />
      
      <div 
        className="transition-all duration-300 ease-in-out py-10"
        style={{ 
          marginLeft: 'var(--sidebar-width, 0px)',
        }}
      >
        <div className="max-w-8xl mx-auto px-4">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-blue-600 hover:text-blue-800 font-medium mb-6 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
            Back
          </button>
          <h1 className="text-3xl font-bold mb-4">Starting Baseline</h1>
          <p className="mb-6 text-gray-700">
            Every learner is different. This short assessment helps us tailor the program to your strengths and needs, so you can learn smarter, apply faster and move closer to your career ambitions.
          </p>
          {error && <div className="mb-4 text-red-600">{error}</div>}
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                <p className="mt-4 text-gray-600">Loading assessment...</p>
              </div>
            </div>
          )}
          {!loading && score === null && mcqQuestionsByModule.length > 0 && (
            <MCQQuiz
              questions={mcqQuestionsByModule[0]?.questions || []}
              onSubmit={(res) => handleMCQSubmit(res, mcqQuestionsByModule[0].moduleId)}
            />
          )}
          {!loading && score !== null && (
            <div className="space-y-6 w-full">
              {/* Main Results Card - Similar to Learning Style */}
              <div className="bg-white rounded-lg shadow-lg p-8 border-t-4 border-blue-600 w-full">
                {(() => {
                  const { mainTitle, sections } = parseFeedbackSections(feedback);
                  console.log(feedback)
                  const sectionKeys = Object.keys(sections);
                  
                  return (
                    <>
                      <div className="text-center mb-8">
                        <h2 className="text-4xl font-bold text-gray-900 mb-4">{mainTitle}</h2>
                        <p className="text-gray-600 mb-6">
                          Understand your performance to achieve better outcomes
                        </p>
                      </div>

                      {/* Score Display */}
                      <div className="bg-blue-50 rounded-lg p-6 mb-8 border-2 border-blue-200">
                        <div className="flex items-center justify-between mb-4">
                          <div>
                            <p className="text-sm text-gray-600 mb-1">Assessment Score</p>
                            <div className="flex items-baseline gap-3">
                              <span className="text-4xl font-bold text-blue-600">
                                {score}/{(mcqQuestionsByModule[0]?.questions || []).length}
                              </span>
                              <span className="text-2xl text-gray-600">
                                ({Math.round((score / (mcqQuestionsByModule[0]?.questions || []).length) * 100)}%)
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-600">Completed:</span>
                            <span className="text-sm font-medium text-green-600">
                              {new Date().toLocaleDateString()}
                            </span>
                          </div>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-3">
                          <div 
                            className="bg-gradient-to-r from-blue-500 to-green-500 h-3 rounded-full transition-all duration-500"
                            style={{ width: `${Math.round((score / (mcqQuestionsByModule[0]?.questions || []).length) * 100)}%` }}
                          />
                        </div>
                      </div>

                      {/* Performance Insights - Expandable Sections */}
                      <div className="mb-8">
                        {/* <h3 className="text-2xl font-bold text-gray-900 mb-4">Your Performance Insights</h3> */}
                        <div className="space-y-3">
                          {sectionKeys.map((sectionTitle, idx) => {
                            const sectionKey = `section_${idx}`;
                            const isExpanded = expandedSections[sectionKey];
                            
                            // Determine background color based on section
                            let bgColor = 'bg-blue-50';
                            let borderColor = 'border-blue-200';
                            if (sectionTitle.toLowerCase().includes('strength')) {
                              bgColor = 'bg-green-50';
                              borderColor = 'border-green-200';
                            } else if (sectionTitle.toLowerCase().includes('improve') || sectionTitle.toLowerCase().includes('weakness')) {
                              bgColor = 'bg-orange-50';
                              borderColor = 'border-orange-200';
                            } else if (sectionTitle.toLowerCase().includes('recommend') || sectionTitle.toLowerCase().includes('action')) {
                              bgColor = 'bg-purple-50';
                              borderColor = 'border-purple-200';
                            }
                            
                            
                            return (
                              <div>
                                {/* <button
                                  onClick={() => toggleSection(sectionKey)}
                                  className="w-full px-6 py-4 flex items-center justify-between hover:opacity-80 transition-opacity"
                                >
                                  <h4 className="text-lg font-semibold text-gray-900 text-left">
                                    {sectionTitle}
                                  </h4>
                                  {isExpanded ? (
                                    <ChevronUp className="w-5 h-5 text-gray-600 flex-shrink-0" />
                                  ) : (
                                    <ChevronDown className="w-5 h-5 text-gray-600 flex-shrink-0" />
                                  )}
                                </button> */}
                                {/* {isExpanded && (
                                  <div className="px-6 pb-4">
                                    <div 
                                      className="prose prose-sm max-w-none text-gray-700"
                                      dangerouslySetInnerHTML={{ 
                                        __html: formatContent(sections[sectionTitle])
                                      }}
                                    />
                                  </div>
                                )} */}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </>
                  );
                })()}
              </div>

              {/* Question Review - Expandable */}
              <div className="bg-white rounded-lg shadow-lg overflow-hidden">
                <button
                  onClick={() => toggleSection('questions')}
                  className="w-full px-8 py-6 flex items-center justify-between bg-gradient-to-r from-blue-50 to-purple-50 hover:from-blue-100 hover:to-purple-100 transition-colors border-b-2 border-blue-200"
                >
                  <h3 className="text-2xl font-bold text-gray-900">Question-by-Question Review</h3>
                  {expandedSections.questions ? (
                    <ChevronUp className="w-6 h-6 text-gray-600 flex-shrink-0" />
                  ) : (
                    <ChevronDown className="w-6 h-6 text-gray-600 flex-shrink-0" />
                  )}
                </button>
                {expandedSections.questions && (
                  <div className="p-8 space-y-6">
                    {correctAnswers.map((answer, idx) => (
                      <div 
                        key={idx} 
                        className={`p-6 rounded-lg border-2 ${
                          answer.isCorrect 
                            ? 'bg-green-50 border-green-300' 
                            : 'bg-red-50 border-red-300'
                        }`}
                      >
                        <div className="flex items-start gap-3 mb-4">
                          {answer.isCorrect ? (
                            <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-1" />
                          ) : (
                            <XCircle className="w-6 h-6 text-red-600 flex-shrink-0 mt-1" />
                          )}
                          <div className="flex-1">
                            <div className="flex items-center justify-between mb-2">
                              <h4 className="font-semibold text-gray-900">Question {idx + 1}</h4>
                              <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">
                                {answer.bloomLevel}
                              </span>
                            </div>
                            <p className="text-gray-800 font-medium mb-4">{answer.question}</p>
                            
                            <div className="space-y-2 mb-4">
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-gray-700">Your answer:</span>
                                <span className={answer.isCorrect ? 'text-green-700' : 'text-red-700'}>
                                  {answer.userAnswer}
                                </span>
                              </div>
                              {!answer.isCorrect && (
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-gray-700">Correct answer:</span>
                                  <span className="text-green-700">{answer.correctAnswer}</span>
                                </div>
                              )}
                            </div>
                            
                            {answer.explanation && (
                              <div className="flex items-start gap-2 mt-3 p-3 bg-white rounded border border-gray-200">
                                <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                                <div>
                                  <span className="font-semibold text-gray-900">Explanation: </span>
                                  <span className="text-gray-700">{answer.explanation}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="flex gap-4 justify-center">
                <button
                  onClick={() => router.push('/employee/welcome')}
                  className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors"
                >
                  Return to Dashboard
                </button>
                <button
                  onClick={() => router.push('/employee/score-history')}
                  className="px-6 py-3 bg-white text-blue-600 border-2 border-blue-600 rounded-lg font-semibold hover:bg-blue-50 transition-colors"
                >
                  View Reports
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AssessmentPage;
