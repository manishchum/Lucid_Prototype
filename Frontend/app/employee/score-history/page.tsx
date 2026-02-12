"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown, BookOpen } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import EmployeeNavigation from "@/components/employee-navigation";
import AIFeedbackSections from "@/app/employee/assessment/ai-feedback-sections";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import RolePlayReports from "@/components/roleplay/RolePlayReports";

// Helper component to format question-specific feedback
// Robust parsing of: JSON array, comma-separated quoted tokens, or free-form sections
const QuestionFeedbackDisplay = ({ feedback, employeeName, totalQuestions }: { feedback: string; employeeName: string; totalQuestions?: number }) => {
  const processedFeedback = feedback
    .replace('[Your Name]', 'Lucid')
    .replace('Dear Employee', `Dear ${employeeName || 'Employee'}`)
    .trim();

  type ParsedAnswer = { status: 'Correct' | 'Incorrect' | 'Unknown'; explanation?: string };

  const parseAnswers = (): { answers: ParsedAnswer[]; total: number } | null => {
    // Case 1: JSON array already
    if (processedFeedback.startsWith('[') && processedFeedback.includes('Correct')) {
      try {
        const arr = JSON.parse(processedFeedback);
        if (Array.isArray(arr)) {
          return {
            answers: arr.map((raw: string) => {
              if (typeof raw !== 'string') return { status: 'Unknown' };
              if (raw.startsWith('Correct')) return { status: 'Correct' };
              if (raw.startsWith('Incorrect')) return { status: 'Incorrect', explanation: raw.replace(/^Incorrect\.\s*/,'').trim() };
              return { status: 'Unknown' };
            }),
            total: arr.length
          };
        }
      } catch {}
    }
    // Case 2: Comma-separated quoted tokens
    if (processedFeedback.includes('Correct') && processedFeedback.includes('"')) {
      // Normalize: ensure wrapped in quotes groups separated by ","
      const raw = processedFeedback
        .replace(/\r/g,'')
        .replace(/\n/g,'')
        .trim();
      // Wrap in brackets if missing for easier JSON parse attempt
      const tentative = raw.startsWith('[') ? raw : `[${raw}]`;
      try {
        // Replace a pattern of duplicated quotes at ends
        const jsonReady = tentative
          .replace(/([^\\])""/g,'$1"')
          .replace(/,\s*$/,'');
        const arr = JSON.parse(jsonReady);
        if (Array.isArray(arr)) {
          return {
            answers: arr.map((token: string) => {
              if (typeof token !== 'string') return { status: 'Unknown' };
              const clean = token.trim();
              if (clean.startsWith('Correct')) return { status: 'Correct' };
              if (clean.startsWith('Incorrect')) return { status: 'Incorrect', explanation: clean.replace(/^Incorrect\.\s*/,'').trim() };
              return { status: 'Unknown' };
            }),
            total: totalQuestions || arr.length
          };
        }
      } catch {
        // Manual split fallback
        const parts = raw.split(/","/).map(p => p.replace(/^"|"$/g,'').trim()).filter(Boolean);
        if (parts.length) {
          return {
            answers: parts.map(p => {
              if (p.startsWith('Correct')) return { status: 'Correct' };
              if (p.startsWith('Incorrect')) return { status: 'Incorrect', explanation: p.replace(/^Incorrect\.\s*/,'').trim() };
              return { status: 'Unknown' };
            }),
            total: totalQuestions || parts.length
          };
        }
      }
    }
    return null;
  };

  const parsed = parseAnswers();
  if (parsed) {
    const answers = parsed.answers;
    const total = totalQuestions || parsed.total;
    const correctCount = answers.filter(a => a.status === 'Correct').length;
    const incorrectCount = answers.filter(a => a.status === 'Incorrect').length + Math.max(0, (total - answers.length));
    return (
      <TooltipProvider>
        <div className="space-y-4">
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <h4 className="font-semibold text-blue-800 mb-3">Question Results Summary</h4>
            <div className="grid grid-cols-5 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2">
              {Array.from({ length: total }).map((_, idx) => {
                const item = answers[idx];
                const status = item?.status || 'Unknown';
                const isCorrect = status === 'Correct';
                const isIncorrect = status === 'Incorrect';
                const baseClasses = 'text-xs font-medium px-2 py-2 rounded text-center min-h-[2.5rem] flex items-center justify-center border transition-colors cursor-pointer';
                const palette = isCorrect
                  ? 'bg-green-100 text-green-800 border-green-300 hover:bg-green-200'
                  : isIncorrect
                    ? 'bg-red-100 text-red-800 border-red-300 hover:bg-red-200'
                    : 'bg-gray-100 text-gray-500 border-gray-300';
                const box = (
                  <div key={idx} className={`${baseClasses} ${palette}`}>
                    <div className="text-center leading-tight">
                      <div className="text-[10px] text-gray-600">Q{idx + 1}</div>
                      <div className="font-semibold text-base">{isCorrect ? '✓' : isIncorrect ? '✗' : '?'}</div>
                    </div>
                  </div>
                );
                if (isIncorrect) {
                  return (
                    <Tooltip key={idx}>
                      <TooltipTrigger asChild>{box}</TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs text-left">
                        <p className="font-semibold mb-1">Q{idx + 1} - Incorrect</p>
                        <p className="text-xs leading-relaxed">{item?.explanation || 'This answer was incorrect. Review the module content.'}</p>
                      </TooltipContent>
                    </Tooltip>
                  );
                }
                return box;
              })}
            </div>
            <div className="mt-4 flex gap-6 text-sm justify-center">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-green-100 border border-green-300 rounded" />
                <span className="text-green-700 font-medium">Correct: {correctCount}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 bg-red-100 border border-red-300 rounded" />
                <span className="text-red-700 font-medium">Incorrect: {incorrectCount}</span>
              </div>
            </div>
            {answers.some(a => a.status === 'Incorrect' && a.explanation) && (
              <div className="mt-6 bg-white/60 rounded-lg p-4 border border-blue-200">
                <h5 className="font-semibold text-blue-800 mb-3">Incorrect Answer Explanations</h5>
                <ol className="space-y-3 list-decimal list-inside text-sm">
                  {answers.map((a, i) => (
                    a.status === 'Incorrect' ? (
                      <li key={i} className="text-gray-700">
                        <span className="font-medium text-gray-900 mr-1">Q{i + 1}:</span>{' '}
                        {a.explanation || 'Review this concept in the module materials.'}
                      </li>
                    ) : null
                  ))}
                </ol>
              </div>
            )}
          </div>
        </div>
      </TooltipProvider>
    );
  }

  // If not parsed as structured Q&A, split into sections for structured feedback
  const lines = processedFeedback.split('\n').filter(line => line.trim());
  const sections: { title?: string; content: string }[] = [];
  
  let currentSection: { title?: string; content: string } = { content: '' };
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Check if it's a header (like "Question 1:", "Incorrect.", etc.)
    if (trimmed.match(/^(Question \d+|Incorrect|Correct|Explanation):/i) || trimmed.match(/^\d+\./)) {
      // Save previous section
      if (currentSection.content) {
        sections.push({ ...currentSection });
      }
      
      // Start new section
      if (trimmed.includes(':')) {
        const [title, ...rest] = trimmed.split(':');
        currentSection = { 
          title: title.trim(),
          content: rest.join(':').trim()
        };
      } else {
        currentSection = { content: trimmed };
      }
    } else if (trimmed) {
      // Add to current section
      currentSection.content += (currentSection.content ? ' ' : '') + trimmed;
    }
  }
  
  // Add the last section
  if (currentSection.content) {
    sections.push({ ...currentSection });
  }
  
  if (sections.length <= 1) {
    // Simple feedback, just format with paragraphs
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-gray-700 leading-relaxed">
        <div className="space-y-3">
          {processedFeedback.split('\n\n').map((paragraph, index) => (
            <p key={index} className="mb-2 last:mb-0">
              {paragraph}
            </p>
          ))}
        </div>
      </div>
    );
  }
  
  // Structured feedback with sections
  return (
    <div className="space-y-4">
      {sections.map((section, index) => (
        <div key={index} className={`rounded-lg p-4 border-l-4 ${
          section.title?.toLowerCase().includes('incorrect') ? 'bg-red-50 border-red-400' :
          section.title?.toLowerCase().includes('correct') ? 'bg-green-50 border-green-400' :
          'bg-yellow-50 border-yellow-400'
        }`}>
          {section.title && (
            <div className={`font-semibold mb-2 ${
              section.title.toLowerCase().includes('incorrect') ? 'text-red-800' :
              section.title.toLowerCase().includes('correct') ? 'text-green-800' :
              'text-yellow-800'
            }`}>
              {section.title}
            </div>
          )}
          <div className={`leading-relaxed ${
            section.title?.toLowerCase().includes('incorrect') ? 'text-red-700' :
            section.title?.toLowerCase().includes('correct') ? 'text-green-700' :
            'text-gray-700'
          }`}>
            {section.content}
          </div>
        </div>
      ))}
    </div>
  );
};

export default function ScoreHistoryPage() {
  const { user, loading: authLoading } = useAuth();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employeeName, setEmployeeName] = useState<string>("");
  const [scoreHistory, setScoreHistory] = useState<any[]>([]);
  const [learningStyleData, setLearningStyleData] = useState<any>(null);
  const [companyUsesLearningStyle, setCompanyUsesLearningStyle] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'assessments' | 'roleplay'>('assessments');
  // State to track which items are expanded (must be declared at the top level)
  const [expanded, setExpanded] = useState<{ [key: number]: boolean }>({});
  const [learningStyleExpanded, setLearningStyleExpanded] = useState<boolean>(false);
  const [reportOpenSections, setReportOpenSections] = useState<string[]>([]);
  const { progress: loadingProgress, show: showLoadingProgress } = useIllusionProgress(authLoading || loading);
  const router = useRouter();

   useEffect(() => {
        if (!authLoading) {
          if (!user) router.push("/login");
          else fetchEmployeeAndHistory();
          
        }
      }, [user, authLoading, router]);

  const fetchEmployeeAndHistory = async () => {
    setLoading(true);
    try {
      // First, get employee data including name and company_id
      const { data: employeeData } = await supabase
        .from("users")
        .select("user_id, name, company_id")
        .eq("email", user?.email)
        .single();
      
      if (!employeeData?.user_id) {
        setLoading(false);
        return;
      }
      
      setEmployeeId(employeeData.user_id);
      setEmployeeName(employeeData.name || "");

      // Fetch company's learning_style setting
      if (employeeData.company_id) {
        const { data: companyData } = await supabase
          .from("companies")
          .select("learning_style")
          .eq("company_id", employeeData.company_id)
          .single();
        
        if (companyData) {
          setCompanyUsesLearningStyle(companyData.learning_style === true);
        }
      }

      // Fetch assessment history
      const { data: assessments } = await supabase
        .from("employee_assessments")
        .select("employee_assessment_id, score, max_score, feedback, question_feedback, assessment_id, assessments(type, questions, processed_module_id)")
        .eq("user_id", employeeData.user_id)
        .order("employee_assessment_id", { ascending: false });

      // Enrich with module titles for non-baseline assessments
      let enriched = assessments || [];
      try {
        const moduleIds = (enriched || [])
          .filter((a: any) => a?.assessments?.type === 'module' && a.assessments?.processed_module_id)
          .map((a: any) => String(a.assessments.processed_module_id));
        if (moduleIds.length) {
          const { data: mods } = await supabase
            .from('processed_modules')
            .select('processed_module_id, title')
            .in('processed_module_id', moduleIds);
          const titleMap = new Map<string, string>();
          (mods || []).forEach((m: any) => {
            if (m?.processed_module_id && m?.title) {
              titleMap.set(String(m.processed_module_id), m.title);
            }
          });
          enriched = enriched.map((a: any) => {
            if (a?.assessments?.type === 'module') {
              const pid = String(a.assessments?.processed_module_id || '');
              const title = pid ? titleMap.get(pid) : undefined;
              return { ...a, assessments: { ...a.assessments, module_title: title } };
            }
            return a;
          });
        }
      } catch (e) {
        // console.log('[score-history] module title enrich error', e);
      }

      setScoreHistory(enriched);

      // Fetch learning style data
      const { data: learningStyle, error: learningStyleError } = await supabase
        .from("employee_learning_style")
        .select("user_id, answers, learning_style, gpt_analysis, created_at, updated_at")
        .eq("user_id", employeeData.user_id)
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

  const toggleExpand = (idx: number) => {
    setExpanded((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

  if (showLoadingProgress) {
    return <LoadingProgress label="Loading score history" progress={loadingProgress} />;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <EmployeeNavigation showForward={false} />
      
      {/* Main content area that adapts to sidebar */}
      <main 
        className="transition-all duration-300 ease-in-out pt-8 pb-12"
        style={{ marginLeft: 'var(--sidebar-width, 0px)' }}
      >
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          
          {/* Dashboard Header */}
          <div className="flex items-center gap-4 mb-10">
            <div className="w-12 h-12 bg-white rounded-2xl shadow-sm flex items-center justify-center border border-slate-100">
              <div className="text-2xl">📊</div>
            </div>
            <div>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight">
                Your Learning Journey
              </h1>
              <p className="text-slate-500 font-medium text-sm">Review your style & scores</p>
            </div>
          </div>

          {/* Tabs Navigation */}
          <div className="flex gap-2 mb-8">
            <button
              onClick={() => setActiveTab('assessments')}
              className={`px-6 py-3 rounded-xl font-bold text-sm transition-all ${
                activeTab === 'assessments'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-200'
                  : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
              }`}
            >
              📚 Assessments
            </button>
            <button
              onClick={() => setActiveTab('roleplay')}
              className={`px-6 py-3 rounded-xl font-bold text-sm transition-all ${
                activeTab === 'roleplay'
                  ? 'bg-blue-600 text-white shadow-lg shadow-blue-200'
                  : 'bg-white text-slate-600 hover:bg-slate-50 border border-slate-200'
              }`}
            >
              🎭 Role-Play Sessions
            </button>
          </div>
        
        {activeTab === 'assessments' && (
        <div className="grid gap-8">
        {/* Learning Style Section - Only show if company uses learning styles */}
        {companyUsesLearningStyle && learningStyleData ? (
          <Card className="rounded-2xl border-none shadow-sm bg-white overflow-hidden">
            <CardContent className="p-8">
              <div className="border-b pb-6 mb-6">
                <div className="flex items-center justify-between cursor-pointer" onClick={() => setLearningStyleExpanded(!learningStyleExpanded)}>
                  <div className="flex items-center gap-6">
                    <div className="w-20 h-20 rounded-full bg-blue-600 text-white flex items-center justify-center text-center leading-tight text-sm font-black shadow-xl shadow-blue-100">
                      {/* {learningStyleData.learning_style} */}
                      Primary Style
                    </div>
                    <div>
                      {/* <span className="text-xs font-bold tracking-wide text-blue-600 uppercase">Primary Style</span> */}
                      <div className="text-lg font-bold text-slate-900 mt-1">
                        {getLearningStyleInfo(learningStyleData.learning_style).label}
                      </div>
                      <span className="text-sm text-slate-500">
                        Completed: {new Date(learningStyleData.updated_at || learningStyleData.created_at).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <button
                      aria-label={learningStyleExpanded ? 'Collapse details' : 'Expand details'}
                      className="focus:outline-none p-2 rounded-full hover:bg-slate-100 transition-colors"
                      tabIndex={-1}
                      type="button"
                    >
                      <ChevronDown className={`w-6 h-6 text-slate-600 transition-transform ${learningStyleExpanded ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                </div>
                {learningStyleExpanded && (
                  <div className="mt-8 space-y-4">
                    <h3 className="text-xl font-bold text-slate-900">Your Learning Insights</h3>
                    {buildLearningSections(learningStyleData.gpt_analysis || '', getLearningStyleInfo(learningStyleData.learning_style).description).filter(section => section.id !== 'checklist').map(section => {
                      const isOpen = reportOpenSections.includes(section.id)
                      const toggle = () => {
                        setReportOpenSections(prev => (
                          prev.includes(section.id)
                            ? prev.filter(id => id !== section.id)
                            : [...prev, section.id]
                        ))
                      }
                      return (
                        <Card key={section.id} className={`bg-gradient-to-br ${section.accent} border-2 shadow-sm rounded-xl`}>
                          <CardHeader className="cursor-pointer" onClick={toggle}>
                            <CardTitle className="flex items-center justify-between text-lg font-semibold text-gray-900">
                              <span>{section.title}</span>
                              <ChevronDown className={`w-5 h-5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                            </CardTitle>
                          </CardHeader>
                          {isOpen && (
                            <CardContent className="space-y-4">
                              {section.paragraphs.map((para, idx) => (
                                <p key={idx} className="text-gray-800 leading-relaxed text-sm">
                                  {para}
                                </p>
                              ))}
                              {section.bullets && section.bullets.length > 0 && (
                                <ul className="list-disc list-inside space-y-1 text-gray-800 text-sm pl-1">
                                  {section.bullets.map((item, bIdx) => (
                                    <li key={bIdx}>{item}</li>
                                  ))}
                                </ul>
                              )}
                              {section.subsections.length > 0 && (
                                <div className="space-y-4">
                                  {section.subsections.map((sub, subIdx) => (
                                    <div key={subIdx}>
                                      <h4 className="font-bold text-gray-900 mb-2 text-sm">{sub.subtitle}</h4>
                                      <ul className="space-y-1 ml-2">
                                        {sub.items.map((item, itemIdx) => (
                                          <li key={itemIdx} className="flex gap-2 text-gray-800 leading-relaxed text-sm">
                                            <span className="text-blue-600 font-semibold mt-0.5 flex-shrink-0">•</span>
                                            <span>{item}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </CardContent>
                          )}
                        </Card>
                      )
                    })}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ) : companyUsesLearningStyle ? (
          <Card className="rounded-2xl border-none shadow-sm bg-white overflow-hidden">
            <CardContent className="p-8">
              <div className="text-center py-8">
                <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 mb-4 mx-auto">
                  <BookOpen size={32} />
                </div>
                <h4 className="text-lg font-bold text-slate-900 mb-2">Discover Your Performance Sprint</h4>
                <p className="text-slate-500 mb-6">
                  Complete your Performance Sprint assessment to see personalized recommendations
                </p>
                <button 
                  onClick={() => router.push("/employee/learning-style")}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Take Performance Sprint Assessment
                </button>
              </div>
            </CardContent>
          </Card>
        ) : null}
        
        {/* Assessment History Section */}
        <Card className="rounded-2xl border-none shadow-sm bg-white overflow-hidden">
          <CardContent className="p-8">
            <div className="border-b pb-6 mb-6">
              <h2 className="text-2xl font-bold text-slate-900">Your Growth Record</h2>
              <p className="text-slate-500 text-sm mt-1">Review your scores & track growth</p>
            </div>
            
            {scoreHistory.length === 0 && (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 mb-4 mx-auto">
                  <BookOpen size={32} />
                </div>
                <div className="text-slate-600 text-base font-medium mb-2">No assessments taken yet</div>
                <p className="text-slate-400 text-sm">Complete your first assessment to see detailed feedback and insights here</p>
              </div>
            )}
            
            {scoreHistory.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {scoreHistory.map((item, idx) => {
                  const isExpanded = expanded[idx] || false;
                  const isBaseline = item.assessments?.type === 'baseline';
                  const percentage = Math.round((item.score / (item.max_score || 1)) * 100);
                  
                  // Expanded tile
                  if (isExpanded) {
                    return (
                      <div key={idx} className="col-span-1 sm:col-span-2 lg:col-span-3 border border-slate-200 rounded-xl p-8 bg-gradient-to-br from-slate-50 to-white shadow-sm hover:shadow-md transition-all">
                        <div className="flex items-center justify-between mb-6 cursor-pointer" onClick={() => toggleExpand(idx)}>
                          <div className="flex flex-col gap-3 flex-1">
                            <span className="text-xl font-bold text-slate-900">
                              {isBaseline ? 'Baseline Assessment' : (item.assessments?.module_title || 'Module Assessment')}
                            </span>
                            <div className="flex items-center gap-4 mt-2">
                              <span className="text-slate-500 font-medium">Score:</span>
                              <span className="font-bold text-slate-900 text-lg">{item.score} / {item.max_score ?? '?'}</span>
                              <div className={`px-3 py-1.5 rounded-lg text-sm font-bold ${
                                percentage >= 80 ? 'bg-green-100 text-green-700' :
                                percentage >= 60 ? 'bg-blue-100 text-blue-700' :
                                'bg-slate-100 text-slate-700'
                              }`}>
                                {percentage}%
                              </div>
                            </div>
                          </div>
                          <button
                            aria-label="Collapse details"
                            className="focus:outline-none p-3 rounded-full hover:bg-slate-100 transition-colors"
                            tabIndex={-1}
                            type="button"
                          >
                            <ChevronDown className="w-6 h-6 text-slate-600 rotate-180" />
                          </button>
                        </div>
                        
                        <div className="mt-8 space-y-8">
                          <div>
                            <h3 className="text-lg font-bold text-slate-900 mb-4">AI Feedback Summary</h3>
                            <AIFeedbackSections feedback={item.feedback?.replace('[Your Name]', 'Lucid').replace('Dear Employee', `Dear ${employeeName || 'Employee'}`) || 'No feedback available.'} />
                          </div>
                          {item.question_feedback && (
                            <div>
                              <h3 className="text-lg font-bold text-slate-900 mb-4">Question-Specific Feedback</h3>
                              <QuestionFeedbackDisplay 
                                feedback={item.question_feedback} 
                                employeeName={employeeName} 
                                totalQuestions={item.max_score}
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  }
                  
                  // Collapsed tile
                  return (
                    <div 
                      key={idx} 
                      className="border border-slate-200 rounded-xl p-5 bg-white hover:shadow-md transition-all cursor-pointer group"
                      onClick={() => toggleExpand(idx)}
                    >
                      <span className="text-base font-bold text-slate-900 block mb-3">
                        {isBaseline ? 'Baseline Assessment' : (item.assessments?.module_title || 'Module Assessment')}
                      </span>
                      <div className="flex items-center gap-3 mb-4">
                        <span className="text-slate-500 text-sm font-medium">Score:</span>
                        <span className="font-bold text-slate-900">{item.score} / {item.max_score ?? '?'}</span>
                        <div className={`px-2 py-1 rounded-md text-xs font-bold ${
                          percentage >= 80 ? 'bg-green-100 text-green-700' :
                          percentage >= 60 ? 'bg-blue-100 text-blue-700' :
                          'bg-slate-100 text-slate-700'
                        }`}>
                          {percentage}%
                        </div>
                      </div>
                      <div className="flex justify-end">
                        <ChevronDown className="w-5 h-5 text-slate-400 group-hover:text-slate-600 transition-colors" />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
        </div>
        )}

        {/* Role-Play Sessions Tab */}
        {activeTab === 'roleplay' && employeeId && (
          <RolePlayReports employeeId={employeeId} />
        )}

        </div>
      </main>
    </div>
  );
}

// Helper to safely extract and parse scores from raw data
const parseScoresFromData = (data: any): Record<string, number> | null => {
  if (!data) return null
  
  // If scores already exist as object, return them
  if (data.scores && typeof data.scores === 'object') {
    return data.scores
  }
  
  // Try to parse from gpt_analysis string if it contains JSON
  if (data.gpt_analysis && typeof data.gpt_analysis === 'string') {
    try {
      const jsonMatch = data.gpt_analysis.match(/```json\s*([\s\S]*?)```/) || 
                       data.gpt_analysis.match(/\{[\s\S]*?"scores"[\s\S]*?\}/)
      if (jsonMatch) {
        const jsonStr = jsonMatch[1] || jsonMatch[0]
        const parsed = JSON.parse(jsonStr)
        if (parsed.scores) return parsed.scores
      }
    } catch (e) {
      // Ignore parse errors
    }
  }
  
  return null
}

// Helper to extract clean report text from gpt_analysis
const getCleanReportText = (gptAnalysis: string): string => {
  if (!gptAnalysis) return ''
  
  try {
    // Try to extract JSON
    const jsonMatch = gptAnalysis.match(/```json\s*([\s\S]*?)```/) || 
                     gptAnalysis.match(/\{[\s\S]*?"report"[\s\S]*?\}/)
    if (jsonMatch) {
      const jsonStr = jsonMatch[1] || jsonMatch[0]
      const parsed = JSON.parse(jsonStr)
      if (parsed.report) {
        // Convert escaped newlines to real newlines
        return parsed.report.replace(/\\n/g, '\n')
      }
    }
  } catch (e) {
    // Fall through to direct text
  }
  
  // If it's plain text starting with "Title:", return as-is (with newline conversion)
  if (gptAnalysis.includes('Title:') || gptAnalysis.includes('Your')) {
    return gptAnalysis.replace(/\\n/g, '\n')
  }
  
  return gptAnalysis
}

// Helper function to get learning style display info
const getLearningStyleInfo = (styleCode: string) => {
  const styleMap: Record<string, { label: string; description: string }> = {
    CS: {
      label: "The Planner",
      description: "Prefers structure, clear steps, and hands-on practice. Learning emphasizes checklists, examples, and measurable milestones."
    },
    AS: {
      label: "The Analyst", 
      description: "Thinks analytically and values logic. Learning focuses on theory, frameworks, and evidence-based decision making."
    },
    AR: {
      label: "The Connector",
      description: "Learns through connections and stories. Learning highlights collaboration, reflection, and real-world context."
    },
    CR: {
      label: "The Explorer",
      description: "Enjoys experimentation and rapid iteration. Learning leans into challenges, scenarios, and creative problem solving."
    }
  };
  
  return styleMap[styleCode] || { label: styleCode, description: "Unknown learning style" };
};

// Extract ONLY the report text from JSON response - ignore everything else before JSON
const extractReportFromJson = (analysis: string) => {
  if (!analysis) return ''

  try {
    const jsonMatch = analysis.match(/```json\s*([\s\S]*?)```/) || analysis.match(/\{[\s\S]*?"report"[\s\S]*?\}/)
    if (jsonMatch) {
      const jsonStr = jsonMatch[1] || jsonMatch[0]
      const parsed = JSON.parse(jsonStr)
      if (parsed.report) return parsed.report.replace(/\\n/g, '\n')
    }
  } catch (e) {}

  const reportStart = analysis.indexOf('Here is your personalized learning style report:')
  if (reportStart !== -1) {
    const reportText = analysis.substring(reportStart + 'Here is your personalized learning style report:'.length)
    const jsonStart = reportText.indexOf('```json')
    if (jsonStart !== -1) return reportText.substring(0, jsonStart).trim()
    return reportText.trim()
  }

  return analysis
}

// Parse report text into sections (compatible with learning-style page logic)
const parseReportIntoTabs = (reportText: string) => {
  const tabs: { id: string; title: string; content: string; bullets: string[]; subsections: { subtitle: string; items: string[] }[] }[] = []
  if (!reportText) return tabs

  reportText = reportText.replace(/^Title:\s*Your Personal Learning Style Insights\s*\n\n/i, '')
  reportText = reportText.replace(/^Here is your personalized learning style report:\s*\n\n/i, '')

  const lines = reportText.split('\n').map(l => l.trim()).filter(l => l && !l.match(/^[-=•·]+$/))
  let currentTab: any = null
  let currentSub: any = null

  for (const line of lines) {
    const mainHeader = line.match(/^(\d+)\.\s*(.+?):\s*$/)
    if (mainHeader) {
      if (currentTab) tabs.push(currentTab)
      const title = mainHeader[2]
      let id = 'natural'
      if (title.toLowerCase().includes('thrive')) id = 'thrive'
      else if (title.toLowerCase().includes('tip')) id = 'tips'
      currentTab = { id, title, content: '', bullets: [], subsections: [] }
      currentSub = null
      continue
    }

    // Subsection headers: lines ending with : but not starting with bullet
    const subHeader = line.match(/^(?![•*\-·])(\w.+?):\s*$/)
    if (subHeader && currentTab && !line.match(/^\d+\./)) {
      const subtitle = subHeader[1].trim()
      if (subtitle && subtitle.length < 100) {
        currentSub = { subtitle, items: [] }
        currentTab.subsections.push(currentSub)
        continue
      }
    }

    const bullet = line.match(/^[•*\-·]\s*(.+)$/)
    if (bullet) {
      const rawItem = bullet[1].trim()
      const item = rawItem.length ? rawItem : bullet[1]
      if (item && item.length > 0) {
        if (currentSub) currentSub.items.push(item)
        else if (currentTab) currentTab.bullets.push(item)
      }
      continue
    }

    if (line && currentTab && !line.match(/^\d+\./) && !line.includes(':')) {
      currentTab.content += (currentTab.content ? '\n' : '') + line
    }
  }
  if (currentTab) tabs.push(currentTab)
  return tabs
}

function useIllusionProgress(active: boolean) {
  const [progress, setProgress] = useState(14);
  const [show, setShow] = useState(active);

  useEffect(() => {
    if (!active) {
      setProgress(100);
      const timeout = setTimeout(() => setShow(false), 180);
      return () => clearTimeout(timeout);
    }

    setShow(true);
    setProgress(Math.min(28, 12 + Math.round(Math.random() * 10)));

    const id = setInterval(() => {
      setProgress((prev) => {
        const hold = prev > 72 ? Math.random() < 0.5 : Math.random() < 0.3;
        if (hold) return prev; // occasionally pause to feel more organic
        const increment = Math.max(1, Math.round(Math.random() * 8));
        return Math.min(prev + increment, 95);
      });
    }, 420 + Math.round(Math.random() * 260));

    return () => clearInterval(id);
  }, [active]);

  return { progress: Math.min(progress, 100), show };
}

function LoadingProgress({ label, progress }: { label: string; progress: number }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-lg border border-slate-100 p-6 space-y-4">
        <div className="flex items-center justify-between text-sm font-semibold text-slate-700">
          <span>{label}</span>
          <span className="text-slate-900 text-base font-black">{progress}%</span>
        </div>
        <div className="relative h-3 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="absolute left-0 top-0 h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-cyan-400 transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-slate-500 font-medium">Pulling your history. This will only take a moment.</p>
      </div>
    </div>
  );
}

type LSSection = {
  id: string;
  title: string;
  accent: string;
  paragraphs: string[];
  bullets?: string[];
  subsections: { subtitle: string; items: string[] }[];
};

// Parse GPT report into four accordion sections with graceful fallbacks
const buildLearningSections = (gptAnalysis: string, fallbackDescription: string): LSSection[] => {
  const sections: LSSection[] = [
    { id: 'natural', title: 'Your Natural Learning Style', accent: 'from-blue-50 to-blue-100 border-blue-200', paragraphs: [], subsections: [] },
    { id: 'thrive', title: 'How You Thrive', accent: 'from-purple-50 to-purple-100 border-purple-200', paragraphs: [], subsections: [] },
    { id: 'tips', title: 'Tips to Make Learning Easier', accent: 'from-green-50 to-emerald-100 border-emerald-200', paragraphs: [], subsections: [] },
    { id: 'checklist', title: 'Your Quick Reference Checklist', accent: 'from-amber-50 to-amber-100 border-amber-200', paragraphs: [], subsections: [] }
  ];

  const cleanText = extractReportFromJson(gptAnalysis)
  const tabs = parseReportIntoTabs(cleanText)
  const pool = [...tabs]
  const takeTab = (keywords: string[], id: string) => {
    const idx = pool.findIndex(t => keywords.some(k => t.title.toLowerCase().includes(k)) || t.id === id)
    if (idx >= 0) return pool.splice(idx, 1)[0]
    return pool.shift()
  }

  sections.forEach(section => {
    const tab = takeTab([section.id.split('-')[0], ...section.title.toLowerCase().split(' ')], section.id)
    if (tab) {
      if (tab.content) {
        const introLines = tab.content.split('\n').filter(Boolean)
        section.paragraphs = introLines.length > 0 ? introLines : [fallbackDescription]
      } else if (!tab.subsections?.length) {
        section.paragraphs = [fallbackDescription]
      }
      if (tab.bullets?.length) {
        section.bullets = tab.bullets
      }
      if (tab.subsections?.length) {
        section.subsections = tab.subsections.map(sub => ({
          subtitle: sub.subtitle,
          items: sub.items.map(item => item.replace(/^[*•\-·]+\s*/, ''))
        }))
      }
    }
    if (!section.paragraphs.length) section.paragraphs.push(fallbackDescription)
  })

  return sections
}
