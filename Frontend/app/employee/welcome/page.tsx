"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import { 
  Users, BookOpen, Clock, User, ChevronDown, 
  Trophy, Target, TrendingUp, Zap, LayoutGrid,
  ShieldCheck, ArrowRight, CheckCircle2, LogOut
} from "lucide-react";
import EmployeeNavigation from "@/components/employee-navigation";

// --- Types ---
interface Employee {
  user_id: string
  email: string
  name: string | null
  joined_at: string
  company_id?: string
}

interface ModuleAssessmentStatus {
  moduleId: string
  hasBaseline: boolean
  baselineCompleted: boolean
  baselineScore?: number
  baselineMaxScore?: number
}

export default function EmployeeWelcome() {
  const { user, loading: authLoading, logout } = useAuth();
  const router = useRouter();

  // --- Logic State (Preserved from your code) ---
  const [employee, setEmployee] = useState<Employee | null>(null);
  const [loading, setLoading] = useState(true);
  const [scoreHistory, setScoreHistory] = useState<any[]>([]);
  const [moduleProgress, setModuleProgress] = useState<any[]>([]);
  const [assignedModules, setAssignedModules] = useState<any[]>([]);
  const [learningStyle, setLearningStyle] = useState<string | null>(null);
  const [baselineScore, setBaselineScore] = useState<number | null>(null);
  const [baselineMaxScore, setBaselineMaxScore] = useState<number | null>(null);
  const [allAssignedCompleted, setAllAssignedCompleted] = useState<boolean>(false);
  const [baselineRequired, setBaselineRequired] = useState<boolean>(true);
  const [companyStats, setCompanyStats] = useState({
    totalEmployees: 0,
    completedEmployees: 0,
    userRank: null as number | null,
    topPercentile: null as number | null,
  });
  const [nudgeMessage, setNudgeMessage] = useState<string>("");
  const [progressPercentage, setProgressPercentage] = useState<number>(0);
  const [showLoginToast, setShowLoginToast] = useState<boolean>(false);
  const [isNavOverlay, setIsNavOverlay] = useState<boolean>(false);
  
  const toastShownRef = useRef(false);
  const prevUserRef = useRef<any>(null);

  // --- Login Toast System (only show when a login/signup flow sets a flag) ---
  // Behavior: login/signup pages should set sessionStorage.setItem('show_login_toast_next', '1')
  // right before redirecting to the home/welcome page. This component will read that flag,
  // show the toast once, then remove the flag so subsequent navigations won't re-show it.
  useEffect(() => {
    if (authLoading) return;

    // If there's no user, nothing to do
    if (!user) {
      prevUserRef.current = null;
      return;
    }

    try {
      const shouldShow = sessionStorage.getItem('show_login_toast_next');
      if (shouldShow) {
        // Remove the flag so it doesn't show again on future navigations
        sessionStorage.removeItem('show_login_toast_next');
        setShowLoginToast(true);
        setTimeout(() => setShowLoginToast(false), 7000);
      }
    } catch (e) {
      // ignore sessionStorage errors (e.g., private mode)
    }

    prevUserRef.current = user;
  }, [user, authLoading]);

  // --- Core Backend Logic (Preserved exactly) ---
  useEffect(() => {
    if (!authLoading) {
      if (!user) router.push("/login");
      else checkEmployeeAccess();
    }
  }, [user, authLoading, router]);

  const checkEmployeeAccess = async () => {
    if (!user?.email) return;
    try {
      const { data: employeeData, error: employeeError } = await supabase
        .from("users").select("*").eq("email", user.email).single();

      if (employeeError || !employeeData) {
        router.push("/login");
        return;
      }
      setEmployee(employeeData);

      // Learning Style Fetch
      const { data: styleData } = await supabase
        .from("employee_learning_style").select("learning_style").eq("user_id", employeeData.user_id).maybeSingle();
      setLearningStyle(styleData?.learning_style || null);

      // Fetch Plans & Progress (Your specific logic)
      const { data: planRows } = await supabase.from('learning_plan').select('*').eq('user_id', employeeData.user_id);
      const requiresBaseline = planRows?.some((plan: any) => plan.baseline_assessment === 1) ?? true;
      setBaselineRequired(requiresBaseline);

      const assignedPlans = planRows?.filter((p: any) => p.status === 'ASSIGNED') || [];
      // TEMP LOGS: inspect returned learning_plan rows and assigned plans
      try {
        console.log('[debug] learning_plan rows:', planRows);
        console.log('[debug] assignedPlans:', assignedPlans);
      } catch (e) {
        /* ignore console errors */
      }
      const mIds = assignedPlans.map((p: any) => p.module_id).filter(Boolean);
      
      // Calculate Progress and resolve module titles
      if (mIds.length > 0) {
        // Fetch processed modules (we need title and mapping to original module id)
        // Try to fetch processed_modules rows where either the original_module_id or the processed_module_id
        // matches any of the module ids we have. Some rows store IDs under processed_module_id instead.
        const { data: pModsByOriginal } = await supabase
          .from('training_modules')
          .select('module_id, title')
          .in('module_id', mIds);

        // const { data: pModsByProcessed } = await supabase
        //   .from('processed_modules')
        //   .select('processed_module_id, title, original_module_id')
        //   .in('processed_module_id', mIds);

        const pMods = Array.from(new Map([...(pModsByOriginal || [])].map((r: any) => [r.module_id  || JSON.stringify(r), r])).values());
        console.log(pMods)
        // TEMP LOG: inspect processed_modules rows
        try {
          console.log('[debug] processed_modules (pMods combined):', pMods);
        } catch (e) { /* ignore */ }

        const pIds = pMods?.map((m: any) => m.module_id) || [];
        const { data: pProg } = await supabase
          .from('module_progress')
          .select('*')
          .eq('user_id', employeeData.user_id)
          .in('processed_module_id', pIds);

        // TEMP LOG: inspect module_progress rows
        try {
          console.log('[debug] module_progress (pProg):', pProg);
        } catch (e) { /* ignore */ }

        const completedCount = pProg?.filter((p: any) => p.completed_at).length || 0;
        const prog = mIds.length > 0 ? Math.round((completedCount / mIds.length) * 100) : 0;
        setProgressPercentage(prog);
        if (employeeData.company_id) await fetchCompanyStats(employeeData.company_id, employeeData.user_id, prog);

        // Build lookups so assigned modules show proper names.
        // processed_modules may reference the original_module_id or have a processed_module_id that
        // matches the learning_plan.module_id depending on how data was stored — build both maps.
        const titleByOriginal: Record<string, string> = {};
        const titleByProcessedId: Record<string, string> = {};
        (pMods || []).forEach((pm: any) => {
          if (pm) {
            if (pm.module_id) {
              titleByOriginal[pm.module_id] = pm.title || `Module ${pm.original_module_id}`;
            }
            if (pm.processed_module_id) {
              titleByProcessedId[pm.processed_module_id] = pm.title || `Module ${pm.processed_module_id}`;
            }
          }
        });

        const mappedAssigned = assignedPlans.map((p: any) => {
          const adminName = p.module_name || p.module_title || p.title || (p.module && (p.module.name || p.module.title)) || null;
          const resolvedTitle =
            titleByOriginal[p.module_id] ||
            titleByProcessedId[p.module_id] ||
            // also try matching by processed_module_id lookup using module_id as processed id
            titleByProcessedId[p.module_id] ||
            adminName ||
            `Module ${p.module_id}`;

          return {
              id: p.module_id,
              title: resolvedTitle,
              moduleName: adminName,
              // Preserve whether admin/learning_plan has baseline enabled for this module
              hasBaseline: (p.baseline_assessment === 1 || p.baseline_assessment === true),
            };
        });

        // TEMP LOG: mapped assigned modules
        try { console.log('[debug] mappedAssignedModules:', mappedAssigned); } catch (e) {}

        setAssignedModules(mappedAssigned);
      }

      const { data: progressData } = await supabase.from("module_progress").select("*, processed_modules(title)").eq("user_id", employeeData.user_id);
      setModuleProgress(progressData || []);

    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const fetchCompanyStats = async (companyId: string, userId: string, userProgress: number) => {
    try {
      const { data: companyEmployees } = await supabase.from('users').select('user_id').eq('company_id', companyId);
      if (!companyEmployees) return;
      const total = companyEmployees.length;
      // Placeholder for your rank logic
      setCompanyStats({ totalEmployees: total, completedEmployees: 5, userRank: 1, topPercentile: 10 });
      generateNudgeMessage(userProgress, 1, total, 10, 5);
    } catch (e) { console.error(e); }
  };

  const generateNudgeMessage = (progress: number, rank: number | null, total: number, percentile: number, completed: number) => {
    if (progress === 100) setNudgeMessage("🎉 Congratulations! You've completed your learning plan and earned the SME tag!");
    else setNudgeMessage(`💪 Great start! Complete your training to join ${completed} successful colleagues!`);
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <EmployeeNavigation showBack={false} showForward={false} />

      {/* Login Success Toast */}
      {showLoginToast && (
        <div className="fixed top-6 right-6 z-[100] animate-in slide-in-from-right fade-in duration-500">
          <div className="max-w-md w-full bg-white rounded-2xl shadow-2xl border border-slate-100 p-4 flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-green-500 flex items-center justify-center text-white shadow-lg">
              <CheckCircle2 size={24} />
            </div>
            <div>
              <div className="text-lg font-extrabold text-slate-900">Successfully logged in!</div>
              <div className="text-sm text-slate-500 font-medium">Your learning dashboard is ready.</div>
            </div>
            <button onClick={() => setShowLoginToast(false)} className="ml-auto text-slate-300 hover:text-slate-500">✕</button>
          </div>
        </div>
      )}

      <main 
        className="transition-all duration-300 ease-in-out pt-8 pb-12"
        style={{ marginLeft: 'var(--sidebar-width, 0px)' }}
      >
        <div className="max-w-6xl mx-auto px-6 lg:px-8">
          
          {/* Dashboard Header */}
          <div className="flex items-center gap-4 mb-10">
            <div className="w-12 h-12 bg-white rounded-2xl shadow-sm flex items-center justify-center border border-slate-100">
              <Users className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h1 className="text-3xl font-black text-slate-900 tracking-tight">
                {employee?.name ? `Welcome, ${employee.name.split(' ')[0]}` : "Learner Dashboard"}
              </h1>
              <p className="text-slate-500 font-medium text-sm">{employee?.email || "Personalized learning hub"}</p>
            </div>
          </div>

          <div className="grid gap-8">
            {/* Progress Nudge Card (Premium Circular Design) */}
            {nudgeMessage && (
              <Card className="rounded-3xl border-none shadow-[0_8px_30px_rgb(0,0,0,0.04)] bg-white overflow-hidden relative">
                <CardContent className="py-10 px-10">
                  <div className="flex flex-col md:flex-row items-center justify-between gap-8">
                    <div className="flex items-center gap-8 flex-1">
                      <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center shrink-0">
                        {progressPercentage === 100 ? <Trophy className="text-blue-600" size={32} /> : <Zap className="text-blue-600" size={32} />}
                      </div>
                      <div>
                        <h3 className="text-2xl font-black text-slate-900">Your Progress</h3>
                        <p className="text-slate-500 mt-2 font-medium max-w-md leading-relaxed">{nudgeMessage}</p>
                        <div className="mt-4 flex gap-3">
                           <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-none font-bold">
                             {companyStats.completedEmployees} COLLEAGUES COMPLETED
                           </Badge>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-center">
                      <div className={`relative w-28 h-28 rounded-full flex items-center justify-center bg-white border-[10px] ${progressPercentage >= 100 ? 'border-green-100' : 'border-blue-50'}`}>
                        <span className={`text-3xl font-black ${progressPercentage >= 100 ? 'text-green-600' : 'text-blue-600'}`}>
                          {progressPercentage}%
                        </span>
                      </div>
                      <div className="mt-4 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                        Rank #{companyStats.userRank || '—'} of {companyStats.totalEmployees}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Learning Style Card (Sequential Logic) */}
            <Card className="rounded-2xl border-none shadow-sm bg-white overflow-visible">
              <CardContent className="p-8">
                {learningStyle ? (
                  <div className="flex items-center gap-10">
                    <div className="w-24 h-24 rounded-full bg-blue-600 text-white flex items-center justify-center text-3xl font-black shadow-xl shadow-blue-100">
                      {learningStyle}
                    </div>
                    <div className="flex-1">
                      <h4 className="text-lg font-extrabold text-slate-900">Your Learning Style</h4>
                      <div className="mt-2 text-slate-500">
                        <LearningStyleBlurb styleCode={learningStyle} />
                      </div>
                      <Button variant="link" className="text-blue-600 font-bold p-0 h-auto mt-4" onClick={() => router.push('/employee/score-history')}>
                        Get full report <ArrowRight size={14} className="ml-1" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between relative">
                    <div className="max-w-md">
                      <h4 className="text-xl font-black text-slate-900 mb-2">Discover Your Learning Style</h4>
                      <p className="text-slate-500 font-medium">Take our 5-minute cognitive survey to unlock your personalized training path.</p>
                    </div>
                    
                    <div className="relative">
                      {/* Profile Dropdown - Commented Out */}
                      {/*
                      <button
                        onClick={() => setShowProfileDropdown(!showProfileDropdown)}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
                  >
                      <div className="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center text-white">
                        <User className="w-5 h-5" />
                      </div>
                      <span className="text-sm font-medium text-gray-700">
                        {employee?.name || user?.displayName || "Profile"}
                </span>
                <ChevronDown className={`w-4 h-4 text-gray-500 transition-transform ${showProfileDropdown ? 'rotate-180' : ''}`} />
              </button>
              
              {showProfileDropdown && (
                <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <div className="font-medium text-gray-900">
                      {employee?.name || user?.displayName || "User"}
                    </div>
                    <div className="text-sm text-gray-500">{user?.email}</div>
                  </div>
                  
                  <div className="py-1">
                    <button
                      onClick={() => {
                        setShowProfileDropdown(false)
                        router.push("/employee/account")
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                    >
                      <User className="w-4 h-4" />
                      Account Settings
                    </button>
                    
                    <button
                      onClick={() => {
                        setShowProfileDropdown(false)
                        handleLogout()
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                    >
                      <LogOut className="w-4 h-4" />
                      Logout
                    </button>
                  </div>
                </div>
              )}
              */}
                      {/* Callout Bubble from Ref Code */}
                      <div className="absolute -top-24 right-0 z-10 w-72 animate-bounce">
                        <div className="bg-blue-600 text-white rounded-2xl px-5 py-3 shadow-xl text-sm">
                          <p className="font-black">Step 1: Start Here!</p>
                          <p className="text-blue-100 text-xs">Complete survey to unlock modules.</p>
                          <div className="absolute right-8 -bottom-2 w-4 h-4 bg-blue-600 rotate-45"></div>
                        </div>
                      </div>
                      <Button onClick={() => router.push('/employee/learning-style')} className="bg-slate-900 hover:bg-black text-white px-8 py-6 rounded-xl font-bold">
                        Take Survey
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Assigned Modules (Locked State preserved) */}
            <Card className="rounded-2xl border-none shadow-sm bg-white overflow-hidden">
              <CardHeader className="bg-slate-50/50 border-b border-slate-50 px-8 py-6">
                <CardTitle className="text-lg font-black text-slate-900">Assigned Modules</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {!learningStyle ? (
                  <div className="py-16 flex flex-col items-center text-center px-8">
                    <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 mb-4">
                      <ShieldCheck size={32} />
                    </div>
                    <h5 className="text-lg font-bold text-slate-900">Modules are currently locked</h5>
                    <p className="text-slate-500 text-sm max-w-xs mt-2 font-medium">Complete your learning preference survey to access your baseline and training plan.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-50">
                    {assignedModules.map((m) => (
                      <div key={m.id} className="flex items-center gap-6 p-6 bg-white">
                        <div className="flex items-center gap-4 min-w-0">
                          <div className="w-14 h-14 rounded-full border-4 border-slate-50 flex items-center justify-center text-sm font-extrabold text-slate-500 bg-white">
                            0%
                          </div>

                          <div className="min-w-0">
                            <p className="text-lg font-extrabold text-slate-900 truncate max-w-[70vw] md:max-w-[40vw]">{m.title || `Module ${m.id}`}</p>
                            {m.moduleName && (
                              <div className="text-sm text-slate-500 truncate mt-1">{m.moduleName}</div>
                            )}
                            <p className="text-xs font-black text-blue-600 uppercase tracking-wide mt-1">Baseline Pending</p>
                          </div>
                        </div>

                        <div className="ml-auto flex items-center gap-3">
                          {/* Only show Baseline button when admin/learning_plan enables baseline for this module */}
                          {m.hasBaseline ? (
                            <button onClick={() => router.push(`/employee/assessment?moduleId=${m.id}`)} className="px-4 py-2 rounded-md border border-slate-200 text-sm font-bold text-slate-700 bg-white hover:bg-slate-50">
                              Baseline
                            </button>
                          ) : null}

                          <button onClick={() => router.push(`/employee/training-plan?module_id=${m.id}`)} className="px-5 py-2 rounded-md bg-blue-600 text-white text-sm font-bold hover:bg-blue-700">
                            Learning Plan
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Progress History */}
            <Card className="rounded-2xl border-none shadow-sm bg-white overflow-hidden">
              <CardHeader className="px-8 py-6">
                <CardTitle className="text-lg font-black text-slate-900">Recent Activity</CardTitle>
              </CardHeader>
              <CardContent className="px-8 pb-8">
                <div className="space-y-4">
                  {moduleProgress.length === 0 ? (
                    <p className="text-slate-400 font-medium text-center py-4">No activity yet.</p>
                  ) : (
                    moduleProgress.map((mod) => (
                      <div key={mod.processed_module_id} className="flex items-center gap-4 p-4 rounded-xl bg-slate-50/50 border border-slate-100/50">
                        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${mod.completed_at ? 'bg-green-100 text-green-600' : 'bg-blue-50 text-blue-600'}`}>
                          {mod.completed_at ? <CheckCircle2 size={20} /> : <Clock size={20} />}
                        </div>
                        <div className="flex-1 overflow-hidden">
                          <p className="font-bold text-slate-900 truncate">{mod.processed_modules?.title || `Module ${mod.processed_module_id}`}</p>
                          <p className="text-xs text-slate-500 font-medium">{mod.completed_at ? 'Finished' : 'In Progress'}</p>
                        </div>
                        {mod.quiz_score !== null && (
                          <Badge className="bg-white border-slate-200 text-slate-600 font-bold">Score: {mod.quiz_score}%</Badge>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}

function LearningStyleBlurb({ styleCode }: { styleCode: string }) {
  const meta: Record<string, { label: string; blurb: string }> = {
    CS: { label: "Concrete Sequential", blurb: "You prefer structure and clear steps. Your plan emphasizes checklists and measurable milestones." },
    AS: { label: "Abstract Sequential", blurb: "You think analytically and value logic. Your plan focuses on evidence-based frameworks." },
    AR: { label: "Abstract Random", blurb: "You learn through connections and stories. Your plan highlights collaboration and reflection." },
    CR: { label: "Concrete Random", blurb: "You enjoy experimentation and iteration. Your plan leans into creative problem solving." },
  };
  const info = meta[styleCode as keyof typeof meta] || { label: "Cognitive Learner", blurb: "Your plan is being personalized to your unique learning style." };
  return (
    <div className="text-sm font-medium leading-relaxed">
      <span className="font-black text-slate-900 block mb-1">{info.label}</span>
      {info.blurb}
    </div>
  );
}