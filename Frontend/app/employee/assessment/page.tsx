"use client";
export const dynamic = "force-dynamic";

import React, { useEffect, useState, Suspense } from "react";
import { useSearchParams, useRouter } from 'next/navigation'
import { supabase } from "@/lib/supabase";
import { sharedDataClient, createCacheKey } from "@/lib/data-client";
import MCQQuiz from "./mcq-quiz";
import { useAuth } from "@/contexts/auth-context";
import { ChevronLeft, CheckCircle, XCircle, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";

interface TrainingModule {
  module_id: string;
  title: string;
  ai_modules: string | null;
}

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000"

const AssessmentContent = () => {
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


  const fetchUserByEmail = async (email: string | undefined | null) => {
    if (!email) return null;
    const res = await fetch(`${API_BASE}/api/users/by-email/${encodeURIComponent(email)}`);
    if (!res.ok){
      const txt = await res.text().catch(() => "No response body");
      throw new Error(`Failed to fetch user by email: ${res.status} ${txt}`);
    }
    const data = await res.json();
    let user = data?.user ?? data;
    if (Array.isArray(user)) user = user[0];
    return user || null;
  };

  useEffect(() => {
    const fetchModules = async () => {
      setLoading(true);
      setError("");
      try {
        // Get employee's company_id first via backend API
        let companyId: string | null = null;
        let fetchedUserId: string | null = null;
        if (user?.email) {
          const empData = await fetchUserByEmail(user.email);
          companyId = empData?.company_id || null;
          fetchedUserId = empData?.user_id || null;
          setUserId(fetchedUserId);
        }
        if (!companyId) throw new Error("Could not find company for user");
        // Get modules for this company only
        const moduleRes = await fetch(`${API_BASE}/api/training-modules/company/${encodeURIComponent(companyId)}`,{
          headers: {'X-User-ID': fetchedUserId || ''}
        });
        if (!moduleRes.ok) {
          const txt = await moduleRes.text().catch(() => "");
          throw new Error(`Failed to fetch modules: ${moduleRes.status} ${txt}`);
        }
        const modulesPayload = await moduleRes.json().catch(() => ({}));
        setModules(modulesPayload.modules || []);
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
        // Get employee's company_id and id via backend API
        let companyId: string | null = null;
        let employeeId: string | null = null;
        if (user?.email) {
          const empData = await fetchUserByEmail(user.email);
          companyId = empData?.company_id || null;
          employeeId = empData?.user_id || null;
        }
        console.log("the gpt mcq quiz is called");
        if (!companyId || !employeeId) throw new Error("Could not find employee or company for user");
        
        // Fetch user's learning style
        let learningStyle: string | null = null;
        const { data: learningStyleData } = await supabase
          .from('employee_learning_style')
          .select('learning_style')
          .eq('user_id', employeeId)
          .maybeSingle();
        learningStyle = learningStyleData?.learning_style || 'default';
        // If a moduleId query param is present, request a per-module quiz.
        const urlModuleId = searchParams.get('moduleId');
        console.log("URL Module ID:", urlModuleId);
        console.log(urlModuleId);

        let isBaselineRequest = false;
        let res;
        if (urlModuleId) {
          // Check if this is a baseline assessment request by looking at learning plan via backend API
          try {
            const lpRes = await fetch(
              `${API_BASE}/api/learning-plans/?user_id=${employeeId}&module_id=${urlModuleId}`,
              { headers: { 'X-User-ID': employeeId } }
            );

            console.log("Learning Plan Query - User ID:", employeeId, "Module ID:", urlModuleId);
            
            if (lpRes.ok) {
              const lpData = await lpRes.json();
              const learningPlan = lpData?.plans?.[0] || null;
              
              console.log("Learning Plan Data:", learningPlan);
              
              // baseline_assessment is stored as smallint (0 or 1) in database, not boolean
              if (learningPlan) {
                console.log("baseline_assessment value:", learningPlan.baseline_assessment, "type:", typeof learningPlan.baseline_assessment);
                isBaselineRequest = learningPlan.baseline_assessment === true;
              }
            } else {
              const errorData = await lpRes.json();
              console.error("Error fetching learning plan:", errorData);
            }
            
            console.log("Is Baseline Request:", isBaselineRequest);
          } catch (err) {
            console.error("Exception while checking learning plan:", err);
            isBaselineRequest = false;
          }
          // console.log(isBaselineRequest)
          // console.log")
            console.log("Inside the if statement for per-module quiz request.");
          console.log(urlModuleId)
          res = await fetch(`${API_BASE}/api/gpt-mcq-quiz`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              moduleIds: [urlModuleId],
              companyId:companyId, 
              user_id: employeeId,
              learningStyle: learningStyle,
              isBaseline: isBaselineRequest,
              assessmentType: isBaselineRequest ? 'baseline' : 'module'
            }),
          });
        } else {
          // Request a baseline quiz for all assigned modules (multi-module baseline)
          console.log("Inside the else statement for per-module quiz request.");
          res = await fetch(`${API_BASE}/api/gpt-mcq-quiz`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              moduleIds: modules.map(m => m.module_id), 
              companyId,
              user_id: employeeId,
              learningStyle: learningStyle,
              isBaseline: true,
              assessmentType: 'baseline'
            }),
          });
        }
        // console.log(res)
        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`API returned ${res.status}: ${errorText}`);
        }
        const d = await res.json();
        // console.log('[Assessment] Baseline quiz result:', d);
        
        // Prefer quizMapping (new backend behavior). Fall back to legacy d.quiz.
        let quizzes = [] as Array<{ moduleId: string; title?: string; questions: any[]; assessmentId?: string }>;
        const mapping = (d && Array.isArray(d.quizMapping)) ? d.quizMapping : null;

        if (mapping && mapping.length > 0) {
          // If moduleId is specified, pick that module's baseline.
          let selected = null as any;
          if (urlModuleId) {
            selected = mapping.find((m: any) => String(m.module_id) === String(urlModuleId)) || null;
          }
          if (!selected) {
            selected = mapping[0];
          }

          const selectedQuestions = selected?.questions || [];
          const selectedAssessmentId = selected?.assessment_id;

          if (Array.isArray(selectedQuestions) && selectedQuestions.length > 0) {
            const effectiveModuleId = (urlModuleId && isBaselineRequest) ? 'baseline' : (urlModuleId ? String(urlModuleId) : 'baseline');
            const effectiveTitle = (urlModuleId && !isBaselineRequest)
              ? (modules.find(m => String(m.module_id) === String(urlModuleId))?.title || 'Module')
              : 'Baseline Assessment';

            quizzes = [{
              moduleId: effectiveModuleId,
              title: effectiveTitle,
              questions: selectedQuestions,
              assessmentId: selectedAssessmentId
            }];
          }
        } else if (d && d.quiz && Array.isArray(d.quiz) && d.quiz.length > 0) {
          // Legacy shape
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
  }, [modules, user, searchParams]);

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
    // console.log("handleMCQSubmit called with result successfully.");
    setScore(result.score);
    setLoading(true);
    try {
      // 1. Fetch employee UUID via backend API
      let employeeId: string | null = null;
      if (user?.email) {
        const empData = await fetchUserByEmail(user.email);
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
        // console.log("Inside in this if 1")
        assessmentId = (quizEntry as any).assessmentId;
        // console.log(assessmentId)
        // console.log(mcqQuestionsByModule)
        // console.log(quizEntry)
      } else {
        const urlModuleId = searchParams.get('moduleId');

        if (!urlModuleId) {
          throw new Error('moduleId query param required to resolve baseline assessment');
        }

        if (!urlModuleId) {
          throw new Error('moduleId query param required to resolve baseline assessment');
        }

        // Look up baseline assessment via backend API
        const q = new URLSearchParams({
          type: 'baseline',
          company_id: companyId || '',
          original_module_id: urlModuleId
        });
        const assessRes = await fetch(`${API_BASE}/api/assessments/filter/search?${q.toString()}`, {
          headers: { 'X-User-ID': employeeId || '' }
        });
        if (assessRes.ok) {
          const payload = await assessRes.json().catch(() => ({}));
          const found = payload.assessments ?? payload.data ?? payload ?? [];
          if (found && found.length > 0) {
            assessmentId = found[0]?.assessment_id ?? null;
          }
        }

        // If no baseline exists, create it via backend route
        if (!assessmentId) {
          const questionsForModule = mcqQuestionsByModule.find((m) => m.moduleId === 'baseline')?.questions || [];
          const createRes = await fetch(`${API_BASE}/api/assessments/`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-User-ID': employeeId || '' },
            body: JSON.stringify({
              type: 'baseline',
              company_id: companyId,
              original_module_id: urlModuleId,
              learning_style: null,
              questions: questionsForModule
            })
          });
          if (createRes.ok) {
            const created = await createRes.json().catch(() => ({}));
            const createdAssessment = created.assessment ?? created;
            assessmentId = createdAssessment?.assessment_id ?? createdAssessment?.data?.assessment_id ?? null;
          } else {
            // creation failed — continue without assessmentId (fallback behavior)
            console.warn('Failed to create baseline assessment via backend', await createRes.text().catch(()=>''));
          }
        }
        // console.log(assessmentId)
      }

      // Log score in terminal
      // console.log("Employee ID:", employeeId);
      // console.log("Employee Name:", user?.email);
      // console.log("Employee Score:", result.score, "/", (mcqQuestionsByModule.find(m => m.moduleId === 'baseline')?.questions || []).length);
      // console.log("Employee Feedback:", result.feedback.join("\n"));

      // Call GPT feedback API for AI-generated feedback and store in Supabase
      const res = await fetch(`${API_BASE}/api/gpt-feedback`, {
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
      // console.log("Response from the /api/gpt-feedback endpoint:");
      // console.log(res)
      setFeedback(data.feedback || "");

      try {
        const moduleTitle = mcqQuestionsByModule[0]?.title || (moduleId === 'baseline' ? 'Baseline Assessment' : 'Module Assessment');
        sessionStorage.setItem(
          'pending_score_history_assessment',
          JSON.stringify({
            assessment_id: assessmentId,
            score: result.score,
            max_score: (mcqQuestionsByModule.find(m => m.moduleId === 'baseline')?.questions || []).length,
            feedback: data.feedback || '',
            question_feedback: data.question_feedback || null,
            type: moduleId === 'baseline' ? 'baseline' : 'module',
            module_title: moduleTitle,
            created_at: new Date().toISOString(),
          }),
        );
      } catch {
        // Ignore storage errors in private browsing or restricted contexts.
      }

      if (employeeId) {
        const assessmentsKey = createCacheKey({
          namespace: "assessments",
          userId: String(employeeId),
          path: "/employee-assessments",
        });
        const detailsPrefix = createCacheKey({
          namespace: "assessment-details",
          userId: String(employeeId),
          path: "/assessments/batch",
        });
        const modulesPrefix = createCacheKey({
          namespace: "modules",
          userId: String(employeeId),
          path: "/processed-modules/batch",
        });

        // Remove stale cache immediately after successful submit.
        sharedDataClient.invalidate(assessmentsKey);
        sharedDataClient.invalidateByPrefix(detailsPrefix);
        sharedDataClient.invalidateByPrefix(modulesPrefix);

        // Warm fresh data so score-history sees latest without waiting for TTL.
        await sharedDataClient.query(
          assessmentsKey,
          async () => {
            const freshRes = await fetch(`${API_BASE}/api/employee-assessments/user/${encodeURIComponent(employeeId)}`, {
              headers: { "X-User-ID": employeeId },
            });
            if (!freshRes.ok) {
              throw new Error("Failed to refetch employee assessments");
            }
            return freshRes.json();
          },
          {
            ttlMs: 2 * 60 * 1000,
            swr: true,
            forceRefresh: true,
          },
        );
      }
      
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
    <div className="min-h-screen w-full py-10">
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
                  // console.log(feedback)
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
                              <div key={sectionKey}>
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
  );
};

const AssessmentPage = () => {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading assessment...</p>
        </div>
      </div>
    }>
      <AssessmentContent />
    </Suspense>
  );
};

export default AssessmentPage;
