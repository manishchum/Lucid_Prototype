"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChevronDown, BookOpen } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
// import { supabase } from "@/lib/supabase";
import { sharedDataClient, createCacheKey } from "@/lib/data-client";
import { fetchWithAuth } from "@/lib/fetch-with-auth";
import AIFeedbackSections from "@/app/employee/assessment/ai-feedback-sections";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import RolePlayReports from "@/components/roleplay/RolePlayReports";



const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;
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
              if (typeof raw !== 'string') return { status: 'Incorrect' };
              if (raw.startsWith('Correct')) return { status: 'Correct' };
              if (raw.startsWith('Incorrect')) return { status: 'Incorrect', explanation: raw.replace(/^Incorrect\.\s*/,'').trim() };
              return { status: 'Incorrect' };
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
              if (typeof token !== 'string') return { status: 'Incorrect' };
              const clean = token.trim();
              if (clean.startsWith('Correct')) return { status: 'Correct' };
              if (clean.startsWith('Incorrect')) return { status: 'Incorrect', explanation: clean.replace(/^Incorrect\.\s*/,'').trim() };
              return { status: 'Incorrect' };
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
              return { status: 'Incorrect' };
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
                      <div className="font-semibold text-base">{isCorrect ? 'OK' : isIncorrect ? 'X' : '?'}</div>
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
  const { user, employeeData: authEmployeeData, loading: authLoading } = useAuth();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [employeeName, setEmployeeName] = useState<string>("");
  const [scoreHistory, setScoreHistory] = useState<any[]>([]);
  const groupedScoreHistory = scoreHistory.reduce((acc: any, item: any) => {
    const moduleId =
      item.assessments?.original_module_id ||
      item.assessments?.processed_module_id ||
      item.assessment_id ||
      item.employee_assessment_id;

    if (!moduleId) return acc;

    if (!acc[moduleId]) {
      acc[moduleId] = {
        moduleId,
        moduleTitle:
          item.assessments?.parent_module_title ||
          item.assessments?.module_title ||
          item.assessments?.title ||
          "Untitled Module",
        assessments: [],
      };
    }

    acc[moduleId].assessments.push(item);
    return acc;
  }, {});

  const groupedHistory = Object.values(groupedScoreHistory).map((group: any) => ({
    ...group,
    assessments: group.assessments.sort((a: any, b: any) => {
      if (a.assessments?.type === "baseline") return -1;
      if (b.assessments?.type === "baseline") return 1;
      return 0;
    }),
  }));
  const [hasRolePlayAddon, setHasRolePlayAddon] = useState(false);
  const [learningStyleData, setLearningStyleData] = useState<any>(null);
  const [companyUsesLearningStyle, setCompanyUsesLearningStyle] = useState<boolean>(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'assessments' | 'roleplay'>('assessments');
  // State to track which items are expanded (must be declared at the top level)
  const [expanded, setExpanded] = useState<{ [key: string]: boolean }>({});
  const [learningStyleExpanded, setLearningStyleExpanded] = useState<boolean>(false);
  const [reportOpenSections, setReportOpenSections] = useState<string[]>([]);
  const { progress: loadingProgress, show: showLoadingProgress } = useIllusionProgress(authLoading || loading);
  const router = useRouter();

   useEffect(() => {
        if (!authLoading) {
          if (!user) router.push("/login");
          else fetchAllData();
          
        }
      }, [user, authLoading, router]);

  const getEmployee = async () => {
    if (authEmployeeData?.user_id) {
      return authEmployeeData;
    }

    const email = user?.email ?? "";
    if (!email) {
      return null;
    }

    const userCacheId =
      (user as any)?.uid ||
      (user as any)?.id ||
      authEmployeeData?.user_id ||
      email;

    const { data: employeePayload } = await sharedDataClient.query(
      createCacheKey({
        namespace: "employee",
        userId: String(userCacheId),
        path: "/employee/me",
      }),
      async () => {
        const res = await fetchWithAuth(`${API_BASE}/api/users/by-email/${encodeURIComponent(email)}`,
      {headers:{ "X-User-ID": authEmployeeData?.user_id || "" }});
        if (!res.ok) {
          throw new Error("Failed to fetch employee");
        }
        return res.json();
      },
      {
        ttlMs: 10 * 60 * 1000,
      },
    );

    let employee = (employeePayload as any)?.data?.user ?? (employeePayload as any)?.data ?? (employeePayload as any)?.user ?? employeePayload;
    if (Array.isArray(employee)) {
      employee = employee[0];
    }

    return employee || null;
  };

  const getCompany = async (employee: any) => {
    if (!employee?.company_id) {
      return null;
    }

    const { data: companyPayload } = await sharedDataClient.query(
      createCacheKey({
        namespace: "company",
        tenantId: String(employee.company_id),
        path: `/company/${employee.company_id}`,
      }),
      async () => {
        const res = await fetchWithAuth(`${API_BASE}/api/companies/${encodeURIComponent(employee.company_id)}`,{headers:{ "X-User-ID": employee.user_id }});
        if (!res.ok) {
          throw new Error("Failed to fetch company");
        }
        return res.json();
      },
      {
        ttlMs: 10 * 60 * 1000,
      },
    );

    return (companyPayload as any)?.data?.company ?? (companyPayload as any)?.data ?? (companyPayload as any)?.company ?? companyPayload;
  };

  const getAssessments = async (employee: any) => {
    const { data: assessmentsPayload } = await sharedDataClient.query(
      createCacheKey({
        namespace: "assessments",
        userId: String(employee.user_id),
        path: "/employee-assessments",
      }),
      async () => {
        const res = await fetchWithAuth(`${API_BASE}/api/employee-assessments/user/${encodeURIComponent(employee.user_id)}`,
          {
            headers: { "X-User-ID": employee.user_id },
          },
        );
        if (!res.ok) {
          throw new Error("Failed to fetch employee assessments");
        }
        return res.json();
      },
      {
        ttlMs: 2 * 60 * 1000,
        swr: true,
      },
    );

    const assessments = assessmentsPayload?.data?.assessments ?? assessmentsPayload?.assessments ?? 
      (Array.isArray((assessmentsPayload as any)?.data) ? (assessmentsPayload as any).data : []);

    // console.log("[score-history] assessments payload", assessmentsPayload);
    // console.log(
    //   "[score-history] assessments sample",
    //   (assessments || []).slice(0, 5).map((ea: any) => ({
    //     assessment_id: ea?.assessment_id,
    //     type: ea?.assessments?.type,
    //     processed_module_id: ea?.assessments?.processed_module_id,
    //   })),
    // );

    const assessmentIds: string[] = Array.from(
      new Set<string>(
        assessments
          .map((ea: any) => ea?.assessment_id)
          .filter(Boolean)
          .map((id: any) => String(id)),
      ),
    );

    if (!assessmentIds.length) {
      return assessments;
    }

    const { data: detailsPayload } = await sharedDataClient.query(
      createCacheKey({
        namespace: "assessment-details",
        userId: String(employee.user_id),
        path: "/assessments/batch",
        query: { ids: assessmentIds },
      }),
      async () => {
        const res = await fetchWithAuth(
          `${API_BASE}/api/assessments/batch`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-User-ID": employee.user_id,
            },
            body: JSON.stringify({
              assessment_ids: assessmentIds,
            }),
          }
        );

        if (!res.ok) {
          throw new Error("Failed to fetch assessment details");
        }

        return res.json();
      },
      {
        ttlMs: 5 * 60 * 1000,
      },
    );

    const assessmentMap = new Map<string, any>();
    const assessmentsData =
      detailsPayload?.data ||
      [];

    assessmentsData.forEach((payload: any) => {
      const assessment = payload?.data?.assessment ?? payload?.data ?? payload?.assessment ?? payload;
      if (assessment?.assessment_id) {
        assessmentMap.set(String(assessment.assessment_id), assessment);
      }
    });

    return assessments.map((ea: any) => {
      const mapped = assessmentMap.get(String(ea.assessment_id));
      return {
        ...ea,
        assessments: mapped || ea?.assessments || null,
      };
    });
  };

  const getModules = async (employee: any, assessments: any[]) => {
    // console.log("[score-history] getModules input", {
    //   count: Array.isArray(assessments) ? assessments.length : "not-array",
    //   sample: (Array.isArray(assessments) ? assessments : []).slice(0, 5).map((ea: any) => ({
    //     assessment_id: ea?.assessment_id,
    //     type: ea?.assessments?.type,
    //     processed_module_id: ea?.assessments?.processed_module_id,
    //   })),
    // });

    const moduleIds = (assessments || [])
      .filter((a: any) => a?.assessments?.type === "module" && a.assessments?.processed_module_id)
      .map((a: any) => String(a.assessments.processed_module_id));

    // console.log("[score-history] module IDs for title lookup", moduleIds);

    if (!moduleIds.length) {
      return assessments;
    }

    const { data: modulesPayload } = await sharedDataClient.query(
      createCacheKey({
        namespace: "modules",
        userId: String(employee.user_id),
        path: "/processed-modules/batch",
        query: { ids: moduleIds },
      }),
      async () => {
        const res = await fetchWithAuth(`${API_BASE}/api/processed-modules/batch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-User-ID": employee.user_id,
          },
          body: JSON.stringify({ processed_module_ids: moduleIds }),
        });

        if (!res.ok) {
          throw new Error("Failed to fetch module titles");
        }

        return res.json();
      },
      {
        ttlMs: 10 * 60 * 1000,
      },
    );

    // console.log("[score-history] processed-modules response", modulesPayload);

    const mods = modulesPayload?.data?.modules ?? modulesPayload?.data ?? modulesPayload?.modules ?? modulesPayload ?? [];
    const moduleMap = new Map();

    mods.forEach((m) => {
        moduleMap.set(m.processed_module_id, {
            module_title: m.title,
            original_module_id: m.original_module_id,
            parent_module_title: m.parent_module_title,
        });
    });

    // console.log("[score-history] processed-modules title map", Array.from(titleMap.entries()));
    return assessments.map((a: any) => {

    const pid = String(a.assessments?.processed_module_id || "");

    // const title = pid ? titleMap.get(pid) : undefined;

    const module = moduleMap.get(pid);

return {
    ...a,
    assessments: {
        ...a.assessments,
        module_title: module?.module_title,
        original_module_id: module?.original_module_id,
        parent_module_title: module?.parent_module_title,
    },
};

});
  };

    // return assessments.map((a: any) => {
  //     if (a?.assessments?.type !== "module") {
  //       return a;
  //     }

  //     const pid = String(a.assessments?.processed_module_id || "");
  //     const title = pid ? titleMap.get(pid) : undefined;
  //     // console.log("[score-history] module title resolved", {
  //     //   processed_module_id: pid,
  //     //   title,
  //     //   assessment_id: a?.assessment_id,
  //     // });
  //     return { ...a, assessments: { ...a.assessments, module_title: title } };
  //   });
  // };

  const getLearningStyle = async (employee: any) => {
    const { data: learningStyle } = await sharedDataClient.query(
      createCacheKey({
        namespace: "learning-style",
        userId: String(employee.user_id),
        path: "/learning-style",
      }),
      async () => {
        try {
          const res = await fetchWithAuth(`${API_BASE}/api/learning-style?user_id=${employee.user_id}`, {
            headers: { "X-User-ID": employee.user_id }
          });
          if (res.ok) {
            const result = await res.json();
            return result?.data || result || null;
          }
        } catch (e) {
          console.error("Error fetching learning style", e);
        }
        return null;
      },
      {
        ttlMs: 10 * 60 * 1000,
      },
    );

    return learningStyle;
  };

  const fetchAllData = async () => {
    setLoading(true);
    try {
      const employee = await getEmployee();
      if (!employee?.user_id) {
        return;
      }

      setEmployeeId(employee.user_id);
      setEmployeeName(employee.name || "");

      // const company = await getCompany(employee);
      // const assessments = await getAssessments(employee);
      // // console.log("[score-history] fetchAllData assessments", {
      // //   count: Array.isArray(assessments) ? assessments.length : "not-array",
      // // });
      // const assessmentsWithModules = await getModules(employee, assessments);
      // const learningStyle = await getLearningStyle(employee);

      
      const [company, assessments, learningStyle] = await Promise.all([ getCompany(employee), getAssessments(employee), getLearningStyle(employee) ]);
      console.log("these are the company details");
      console.log(company);

      const addons = company?.subscription_addons || [];

      setHasRolePlayAddon(addons.includes("role_play"));
      const assessmentsWithModules = await getModules(employee, assessments);

      setCompanyUsesLearningStyle(Boolean(company?.learning_style));
      setScoreHistory(assessmentsWithModules);
      setLearningStyleData(learningStyle || null);
    } catch (err) {
      console.error("Error fetching data:", err);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (id:string)=>{

    setExpanded(prev=>({

        ...prev,

        [id]:!prev[id]

    }));

}

  if (showLoadingProgress) {
    return <LoadingProgress label="Loading score history" progress={loadingProgress} />;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="px-4 py-8">
        <div className="container mx-auto">
          <div className="mb-8 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
            <h1 className="mb-2 text-3xl font-bold text-gray-800">Sprint Performance Reports</h1>
            <p className="text-slate-600">Comprehensive analysis of your scores and performance metrics</p>
          </div>

          <main className="w-full px-6 lg:px-8">
            <div className="mb-8 flex gap-2">
              <button
                onClick={() => setActiveTab("assessments")}
                className={`rounded-xl px-6 py-3 text-sm font-bold transition-all ${
                  activeTab === "assessments"
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-200"
                    : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                Assessments
              </button>
              {hasRolePlayAddon && (
                <button
                  onClick={() => setActiveTab("roleplay")}
                  className={`rounded-xl px-6 py-3 text-sm font-bold transition-all ${
                    activeTab === "roleplay"
                      ? "bg-blue-600 text-white shadow-lg shadow-blue-200"
                      : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  Role-Play Sessions
                </button>
              )}
            </div>

            {activeTab === "assessments" && (
              <div className="grid gap-8">
                {companyUsesLearningStyle && learningStyleData ? (
                  <Card className="overflow-hidden rounded-2xl border-none bg-white shadow-sm">
                    <CardContent className="p-8">
                      <div className="mb-6 border-b pb-6">
                        <div
                          className="flex cursor-pointer items-center justify-between"
                          onClick={() => setLearningStyleExpanded(!learningStyleExpanded)}
                        >
                          <div className="flex items-center gap-6">
                            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-blue-600 text-center text-sm font-black leading-tight text-white shadow-xl shadow-blue-100">
                              Primary Style
                            </div>
                            <div>
                              <div className="mt-1 text-lg font-bold text-slate-900">
                                {getLearningStyleInfo(learningStyleData.learning_style).label}
                              </div>
                              <span className="text-sm text-slate-500">
                                Completed: {new Date(learningStyleData.updated_at || learningStyleData.created_at).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                          <button
                            aria-label={learningStyleExpanded ? "Collapse details" : "Expand details"}
                            className="rounded-full p-2 transition-colors hover:bg-slate-100 focus:outline-none"
                            tabIndex={-1}
                            type="button"
                          >
                            <ChevronDown
                              className={`h-6 w-6 text-slate-600 transition-transform ${
                                learningStyleExpanded ? "rotate-180" : ""
                              }`}
                            />
                          </button>
                        </div>

                        {learningStyleExpanded && (
                          <div className="mt-8 space-y-4">
                            <h3 className="text-xl font-bold text-slate-900">Your Insights</h3>
                            {buildLearningSections(
                              learningStyleData.gpt_analysis || "",
                              getLearningStyleInfo(learningStyleData.learning_style).description,
                            )
                              .filter((section) => section.id !== "checklist")
                              .map((section) => {
                                const isOpen = reportOpenSections.includes(section.id);
                                const toggle = () => {
                                  setReportOpenSections((prev) =>
                                    prev.includes(section.id)
                                      ? prev.filter((id) => id !== section.id)
                                      : [...prev, section.id],
                                  );
                                };

                                return (
                                  <Card
                                    key={section.id}
                                    className={`rounded-xl border-2 bg-gradient-to-br shadow-sm ${section.accent}`}
                                  >
                                    <CardHeader className="cursor-pointer" onClick={toggle}>
                                      <CardTitle className="flex items-center justify-between text-lg font-semibold text-gray-900">
                                        <span>{section.title}</span>
                                        <ChevronDown
                                          className={`h-5 w-5 transition-transform ${isOpen ? "rotate-180" : ""}`}
                                        />
                                      </CardTitle>
                                    </CardHeader>
                                    {isOpen && (
                                      <CardContent className="space-y-4">
                                        {section.paragraphs.map((para, idx) => (
                                          <p key={idx} className="text-sm leading-relaxed text-gray-800">
                                            {para}
                                          </p>
                                        ))}
                                        {section.bullets && section.bullets.length > 0 && (
                                          <ul className="list-disc list-inside space-y-1 pl-1 text-sm text-gray-800">
                                            {section.bullets.map((item, bIdx) => (
                                              <li key={bIdx}>{item}</li>
                                            ))}
                                          </ul>
                                        )}
                                        {section.subsections.length > 0 && (
                                          <div className="space-y-4">
                                            {section.subsections.map((sub, subIdx) => (
                                              <div key={subIdx}>
                                                <h4 className="mb-2 text-sm font-bold text-gray-900">{sub.subtitle}</h4>
                                                <ul className="ml-2 space-y-1">
                                                  {sub.items.map((item, itemIdx) => (
                                                    <li key={itemIdx} className="flex gap-2 text-sm leading-relaxed text-gray-800">
                                                      <span className="mt-0.5 flex-shrink-0 font-semibold text-blue-600">-</span>
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
                                );
                              })}
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ) : companyUsesLearningStyle ? (
                  <Card className="overflow-hidden rounded-2xl border-none bg-white shadow-sm">
                    <CardContent className="p-8">
                      <div className="py-8 text-center">
                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                          <BookOpen size={32} />
                        </div>
                        <h4 className="mb-2 text-lg font-bold text-slate-900">Discover Your Sprint</h4>
                        <p className="mb-6 text-slate-500">
                          Complete Your Performance Sprint Assessment To See Personalized Recommendations
                        </p>
                        <button
                          onClick={() => router.push("/employee/learning-style")}
                          className="rounded-lg bg-blue-600 px-4 py-2 text-white transition-colors hover:bg-blue-700"
                        >
                          Take Sprint Assessment
                        </button>
                      </div>
                    </CardContent>
                  </Card>
                ) : null}

                <Card className="overflow-hidden rounded-2xl border-none bg-white shadow-sm">
                  <CardContent className="p-8">
                    <div className="mb-6 border-b pb-6">
                      <h2 className="text-2xl font-bold text-slate-900">Your Growth Record</h2>
                      <p className="mt-1 text-sm text-slate-500">Review Your Scores & Track Growth</p>
                    </div>

                    {scoreHistory.length === 0 ? (
                      <div className="py-12 text-center">
                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
                          <BookOpen size={32} />
                        </div>
                        <div className="mb-2 text-base font-medium text-slate-600">No assessments taken yet</div>
                        <p className="text-sm text-slate-400">
                          Complete your first assessment to see detailed feedback and insights here
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-6">
                        {groupedHistory.map((group: any) => (
                          <Card key={group.moduleId} className="rounded-xl border border-slate-200">
                            <CardHeader>
                              <CardTitle>{group.moduleTitle}</CardTitle>
                              <CardDescription>{group.assessments.length} Assessments</CardDescription>
                            </CardHeader>
                            <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                              {group.assessments.map((item: any) => {
                                const key = item.employee_assessment_id || item.assessment_id;
                                const isExpanded = expanded[key] || false;
                                const isBaseline = item.assessments?.type === "baseline";
                                const percentage = Math.round((item.score / (item.max_score || 1)) * 100);
                                const title = isBaseline
                                  ? "Baseline Assessment"
                                  : item.assessments?.module_title || "Module Assessment";

                                if (isExpanded) {
                                  return (
                                    <div
                                      key={key}
                                      className="col-span-1 rounded-xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-8 shadow-sm transition-all hover:shadow-md sm:col-span-2 lg:col-span-3"
                                    >
                                      <div
                                        className="mb-6 flex cursor-pointer items-center justify-between"
                                        onClick={() => toggleExpand(key)}
                                      >
                                        <div className="flex flex-1 flex-col gap-3">
                                          <span className="text-xl font-bold text-slate-900">{title}</span>
                                          <div className="mt-2 flex items-center gap-4">
                                            <span className="font-medium text-slate-500">Score:</span>
                                            <span className="text-lg font-bold text-slate-900">
                                              {item.score} / {item.max_score ?? "?"}
                                            </span>
                                            <div
                                              className={`rounded-lg px-3 py-1.5 text-sm font-bold ${
                                                percentage >= 80
                                                  ? "bg-green-100 text-green-700"
                                                  : percentage >= 60
                                                    ? "bg-blue-100 text-blue-700"
                                                    : "bg-slate-100 text-slate-700"
                                              }`}
                                            >
                                              {percentage}%
                                            </div>
                                          </div>
                                        </div>
                                        <button
                                          aria-label="Collapse details"
                                          className="rounded-full p-3 transition-colors hover:bg-slate-100 focus:outline-none"
                                          tabIndex={-1}
                                          type="button"
                                        >
                                          <ChevronDown className="h-6 w-6 rotate-180 text-slate-600" />
                                        </button>
                                      </div>

                                      <div className="mt-8 space-y-8">
                                        <div>
                                          <h3 className="mb-4 text-lg font-bold text-slate-900">AI Feedback Summary</h3>
                                          <AIFeedbackSections
                                            feedback={
                                              item.feedback?.replace("[Your Name]", "Lucid").replace("Dear Employee", `Dear ${employeeName || "Employee"}`) ||
                                              "No feedback available."
                                            }
                                          />
                                        </div>
                                        {item.question_feedback && (
                                          <div>
                                            <h3 className="mb-4 text-lg font-bold text-slate-900">Question-Specific Feedback</h3>
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

                                return (
                                  <div
                                    key={key}
                                    className="cursor-pointer rounded-xl border border-slate-200 bg-white p-5 transition-all hover:shadow-md group"
                                    onClick={() => toggleExpand(key)}
                                  >
                                    <span className="mb-3 block text-base font-bold text-slate-900">{title}</span>
                                    <div className="mb-4 flex items-center gap-3">
                                      <span className="text-sm font-medium text-slate-500">Score:</span>
                                      <span className="font-bold text-slate-900">
                                        {item.score} / {item.max_score ?? "?"}
                                      </span>
                                      <div
                                        className={`rounded-md px-2 py-1 text-xs font-bold ${
                                          percentage >= 80
                                            ? "bg-green-100 text-green-700"
                                            : percentage >= 60
                                              ? "bg-blue-100 text-blue-700"
                                              : "bg-slate-100 text-slate-700"
                                        }`}
                                      >
                                        {percentage}%
                                      </div>
                                    </div>
                                    <div className="flex justify-end">
                                      <ChevronDown className="h-5 w-5 text-slate-400 transition-colors group-hover:text-slate-600" />
                                    </div>
                                  </div>
                                );
                              })}
                            </CardContent>
                          </Card>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === "roleplay" && employeeId && (
              <div className="grid grid-cols-1 gap-10">
                <RolePlayReports employeeId={employeeId} />
              </div>
            )}
          </main>
        </div>
      </div>
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

  const lines = reportText.split('\n').map(l => l.trim()).filter(l => l && !l.match(/^[-=-Â·]+$/))
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
    const subHeader = line.match(/^(?![-*\-Â·])(\w.+?):\s*$/)
    if (subHeader && currentTab && !line.match(/^\d+\./)) {
      const subtitle = subHeader[1].trim()
      if (subtitle && subtitle.length < 100) {
        currentSub = { subtitle, items: [] }
        currentTab.subsections.push(currentSub)
        continue
      }
    }

    const bullet = line.match(/^[-*\-Â·]\s*(.+)$/)
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
          items: sub.items.map(item => item.replace(/^[*-\-Â·]+\s*/, ''))
        }))
      }
    }
    if (!section.paragraphs.length) section.paragraphs.push(fallbackDescription)
  })

  return sections
}

