"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import EmployeeNavigation from "@/components/employee-navigation";
import  AIFeedbackSections  from "@/app/employee/assessment/ai-feedback-sections";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";

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


  // Split into sections if it contains structured feedback
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
  const [loading, setLoading] = useState(true);
  // State to track which items are expanded (must be declared at the top level)
  const [expanded, setExpanded] = useState<{ [key: number]: boolean }>({});
  const [learningStyleExpanded, setLearningStyleExpanded] = useState<boolean>(false);
  const [reportOpenSections, setReportOpenSections] = useState<string[]>([]);
  const router = useRouter();

  useEffect(() => {
    if (!authLoading && user?.email) {
      fetchEmployeeAndHistory(user.email);
    }
  }, [user, authLoading]);

  const fetchEmployeeAndHistory = async (email: string) => {
    setLoading(true);
    try {
      // First, get employee data including name
      const { data: employeeData } = await supabase
        .from("users")
        .select("user_id, name")
        .eq("email", email)
        .single();
      
      if (!employeeData?.user_id) {
        setLoading(false);
        return;
      }
      
      setEmployeeId(employeeData.user_id);
      setEmployeeName(employeeData.name || "");

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

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading score history...</p>
        </div>
      </div>
    );
  }

  const toggleExpand = (idx: number) => {
    setExpanded((prev) => ({ ...prev, [idx]: !prev[idx] }));
  };

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
      label: "Concrete Sequential: The Planner",
      description: "Prefers structure, clear steps, and hands-on practice. Learning emphasizes checklists, examples, and measurable milestones."
    },
    AS: {
      label: "Abstract Sequential: The Analyst", 
      description: "Thinks analytically and values logic. Learning focuses on theory, frameworks, and evidence-based decision making."
    },
    AR: {
      label: "Abstract Random: The Connector",
      description: "Learns through connections and stories. Learning highlights collaboration, reflection, and real-world context."
    },
    CR: {
      label: "Concrete Random: The Explorer",
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
  const tabs: { id: string; title: string; content: string; subsections: { subtitle: string; items: string[] }[] }[] = []
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
      currentTab = { id, title, content: '', subsections: [] }
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
      const item = bullet[1].trim().replace(/^[*\-·•]+\s*/, '')
      if (item && item.length > 0) {
        if (currentSub) currentSub.items.push(item)
        else if (currentTab) currentTab.content += (currentTab.content ? '\n' : '') + item
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

  return (
    <div className="min-h-screen">
      <EmployeeNavigation showForward={false} />
      
      {/* Main content area that adapts to sidebar */}
      <div 
        className="transition-all duration-300 ease-in-out"
        style={{ 
          marginLeft: 'var(--sidebar-width, 0px)',
        }}
      >
        {/* Header as single flat banner */}
        <div className="bg-sky-50 border border-sky-200 rounded-xl shadow-sm mb-6" onClick={(e) => e.stopPropagation()}>
          <div className="max-w-10xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-8">
              <div className="flex items-center">
                <div className="w-8 h-8 text-green-600 mr-3 flex items-center justify-center">
                  📊
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-sky-800">Your Learning Journey: Style & Scores</h1>
                </div>
              </div>
            </div>
          </div>
        </div>
        
        {/* Content area with padding */}
        <div className="px-4 py-8">
        <div className="max-w-6xl mx-auto">
        {/* Learning Style Section */}
        {learningStyleData ? (
          <Card className="mb-8 shadow-md">
            <CardHeader className="bg-sky-50 rounded-t-xl py-5 px-6 border-b-2 border-sky-200">
              <CardTitle className="text-2xl font-bold text-sky-700">Discover how you learn best</CardTitle>
              <CardDescription className="text-sm mt-1 text-sky-600">
                Understand your learning DNA to achieve outcomes faster
              </CardDescription>
            </CardHeader>
            <CardContent className="p-6">
              <div className="border-b pb-4 mb-4">
                <div className="flex items-center justify-between mb-3 cursor-pointer" onClick={() => setLearningStyleExpanded(!learningStyleExpanded)}>
                  <div className="flex items-center gap-4">
                    <div className="bg-sky-50 border border-sky-200 rounded-lg shadow-sm px-4 py-3 flex items-center gap-3 hover:shadow-md transition-shadow">
                      <div className="w-12 h-12 rounded-md bg-sky-500 text-white flex items-center justify-center text-lg font-bold shadow-sm">
                        {learningStyleData.learning_style}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-xs font-medium tracking-wide text-sky-600 uppercase">Primary Style</span>
                        <span className="text-sm font-semibold text-gray-800 leading-snug max-w-xs">
                          {getLearningStyleInfo(learningStyleData.learning_style).label}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm text-gray-500">
                      Completed: {new Date(learningStyleData.updated_at || learningStyleData.created_at).toLocaleDateString()}
                    </span>
                    <button
                      aria-label={learningStyleExpanded ? 'Collapse details' : 'Expand details'}
                      className="focus:outline-none p-4 rounded-full hover:bg-gray-100 transition-colors"
                      tabIndex={-1}
                      type="button"
                    >
                      <span className="text-3xl text-gray-600">{learningStyleExpanded ? '▲' : '▼'}</span>
                    </button>
                  </div>
                </div>
                {learningStyleExpanded && (
                  <div className="mt-8 space-y-6">
                    <h3 className="text-2xl font-bold text-gray-800">Your Learning Insights</h3>
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
                        <Card key={section.id} className={`bg-sky-50 border-2 border-sky-200 shadow-sm`}>
                          <CardHeader className="cursor-pointer" onClick={toggle}>
                            <CardTitle className="flex items-center justify-between text-lg sm:text-xl font-semibold text-gray-900">
                              <span>{section.title}</span>
                              <ChevronDown className={`w-6 h-6 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                            </CardTitle>
                          </CardHeader>
                          {isOpen && (
                            <CardContent className="space-y-5">
                              {section.paragraphs.map((para, idx) => (
                                <p key={idx} className="text-gray-800 leading-relaxed text-base">
                                  {para}
                                </p>
                              ))}
                              {section.subsections.length > 0 && (
                                <div className="space-y-5">
                                  {section.subsections.map((sub, subIdx) => (
                                    <div key={subIdx}>
                                      <h4 className="font-extrabold text-gray-900 mb-3 text-base sm:text-lg">{sub.subtitle}</h4>
                                      <ul className="space-y-2 ml-2">
                                        {sub.items.map((item, itemIdx) => (
                                          <li key={itemIdx} className="flex gap-3 text-gray-800 leading-relaxed text-sm">
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
        ) : (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>Your Learning Style</CardTitle>
              <CardDescription>
                Complete your learning style assessment to see personalized recommendations
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-center py-8">
                <div className="text-gray-500 mb-4">
                  You haven't completed your learning style assessment yet.
                </div>
                <button 
                  onClick={() => router.push("/employee/learning-style")}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Take Learning Style Assessment
                </button>
              </div>
            </CardContent>
          </Card>
        )}
        
        {/* Assessment History Section */}
        <Card className="mb-12 shadow-md">
          <CardHeader className="bg-sky-50 rounded-t-xl py-5 px-6 border-b-2 border-sky-200">
            <CardTitle className="text-2xl font-bold text-sky-700">Your Growth Record
</CardTitle>
            <CardDescription className="text-sm mt-1 text-sky-600">Review your scores & track growth
</CardDescription>
          </CardHeader>
          <CardContent className="p-6">
            {scoreHistory.length === 0 && (
              <div className="text-center py-6">
                <div className="text-gray-500 text-sm mb-2">No assessments taken yet.</div>
                <p className="text-gray-400 text-xs">Complete your first assessment to see detailed feedback and insights here.</p>
              </div>
            )}
            {scoreHistory.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {scoreHistory.map((item, idx) => {
                  const isExpanded = expanded[idx] || false;
                  const isBaseline = item.assessments?.type === 'baseline';
                  // If expanded, make the tile span all columns and increase padding/font
                  if (isExpanded) {
                    return (
                      <div key={idx} className={`col-span-1 sm:col-span-2 lg:col-span-3 border-2 border-sky-200 rounded-lg p-6 flex flex-col h-full bg-sky-50 transition-all duration-200 shadow-md z-10 relative`}>
                        <div className="flex items-center justify-between mb-4 cursor-pointer" onClick={() => toggleExpand(idx)}>
                          <div className="flex flex-col gap-2 flex-1">
                            <span className={`text-xl font-bold text-sky-900`}>
                              {isBaseline ? 'Baseline Assessment' : (item.assessments?.module_title || 'Module Assessment')}
                            </span>
                            <div className="flex items-center gap-3 mt-2 text-base">
                              <span className="text-sky-700 font-semibold">Score:</span>
                              <span className={`font-bold text-sky-900`}>{item.score} / {item.max_score ?? '?'}</span>
                              <div className={`px-3 py-1 rounded-md text-sm font-bold bg-sky-200 text-sky-900`}>{Math.round((item.score / (item.max_score || 1)) * 100)}%</div>
                            </div>
                          </div>
                          <button
                            aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
                            className="focus:outline-none p-4 rounded-full hover:bg-white hover:bg-opacity-50 transition-colors"
                            tabIndex={-1}
                            type="button"
                          >
                            <span className={`text-4xl text-gray-600`}>{isExpanded ? '▲' : '▼'}</span>
                          </button>
                        </div>
                        <div className="mt-10 space-y-10">
                          <div>
                            <span className="text-2xl font-bold text-gray-800 mb-3 block">AI Feedback Summary:</span>
                            <AIFeedbackSections feedback={item.feedback?.replace('[Your Name]', 'Lucid').replace('Dear Employee', `Dear ${employeeName || 'Employee'}`) || 'No feedback available.'} />
                          </div>
                          {item.question_feedback && (
                            <div>
                              <span className="text-2xl font-bold text-gray-800 mb-3 block">Question-Specific Feedback:</span>
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
                  // Collapsed tile (grid)
                  return (
                    <div key={idx} className={`border-2 border-sky-200 rounded-lg p-4 flex flex-col h-full bg-sky-50 transition-all duration-200 hover:shadow-md cursor-pointer`} onClick={() => toggleExpand(idx)}>
                      <span className={`text-lg font-bold mb-2 text-sky-900`}>{isBaseline ? 'Baseline Assessment' : (item.assessments?.module_title || 'Module Assessment')}</span>
                      <div className="flex items-center gap-2 text-sm mb-2">
                        <span className="text-sky-700 font-semibold">Score:</span>
                        <span className={`font-bold text-sky-900`}>{item.score} / {item.max_score ?? '?'}</span>
                        <div className={`px-2 py-0.5 rounded text-xs font-bold bg-sky-200 text-sky-900`}>{Math.round((item.score / (item.max_score || 1)) * 100)}%</div>
                      </div>
                      <div className="flex justify-end mt-auto">
                        <span className={`text-3xl text-gray-600`}>▼</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
        </div>
        </div>
      </div>
    </div>
  );
}
