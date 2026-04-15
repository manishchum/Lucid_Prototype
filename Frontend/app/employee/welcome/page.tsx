"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/auth-context";
import { useTenant } from "@/contexts/tenant-context";
import CompanySelector from "@/components/company-selector";
import { createCacheKey, sharedDataClient } from "@/lib/data-client";
import { fetchWithAuth } from "@/lib/fetch-with-auth";
import {
  Users, BookOpen, Clock, User, ChevronDown,
  Trophy, Target, TrendingUp, Zap, LayoutGrid,
  ShieldCheck, ArrowRight, CheckCircle2, LogOut
} from "lucide-react";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

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
  const { activeCompanyId, isDeveloperMode } = useTenant();
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
  const [showAllModules, setShowAllModules] = useState<boolean>(false);
  const [companyLearningStyleEnabled, setCompanyLearningStyleEnabled] = useState<boolean>(false);
  const { progress: loadingProgress, show: showLoadingProgress } = useIllusionProgress(authLoading || loading);
 
  const toastShownRef = useRef(false);
  const prevUserRef = useRef<any>(null);

  const fetchUserByEmail = async (email: string) => {
    try {
      const res = await fetchWithAuth(
        `${API_BASE}/api/users/by-email/${encodeURIComponent(email)}`,
      );
      if (!res.ok) return null;
      const payload = await res.json();
      let u = payload?.user ?? payload;
      if (Array.isArray(u)) u = u[0];
      return u || null;
    } catch {
      return null;
    }
  };

  // --- Login Toast System (only show when a login/signup flow sets a flag) ---
  // Behavior: login/signup pages should set sessionStorage.setItem('show_login_toast_next', '1')
  // right before redirecting to the home/welcome page. This component will read that flag,
  // show the toast once, then remove the flag so subsequent navigations won't re-show it.
  const fetchDashboardData = async (employeeData: any, effectiveCompanyId: string) => {
    const result = await sharedDataClient.query(
      createCacheKey({
        namespace: "dashboard",
        tenantId: effectiveCompanyId,
        userId: employeeData.user_id,
        path: "/employee/dashboard"
      }),
      async () => {
        const headers = {
          'X-User-ID': employeeData.user_id,
          'X-Company-ID': effectiveCompanyId,
        };

        const [plansRes, modulesRes, progressRes, usersRes, companyRes, learningStyleRes] = await Promise.all([
          fetchWithAuth(`${API_BASE}/api/learning-plans/?user_id=${employeeData.user_id}`, { headers }).then((r) => r.ok ? r.json() : {}),
          fetchWithAuth(`${API_BASE}/api/training-modules/company/${employeeData.company_id}`, { headers }).then((r) => r.ok ? r.json() : {}),
          fetchWithAuth(`${API_BASE}/api/module-progress/user/${employeeData.user_id}`, { headers }).then((r) => r.ok ? r.json() : {}),
          fetchWithAuth(`${API_BASE}/api/users/company/${employeeData.company_id}`, { headers }).then((r) => r.ok ? r.json() : {}),
          fetchWithAuth(`${API_BASE}/api/companies/${encodeURIComponent(employeeData.company_id)}`, { headers }).then((r) => r.ok ? r.json() : {}),
          fetchWithAuth(`${API_BASE}/api/learning-style?user_id=${encodeURIComponent(employeeData.user_id)}`, { headers }).then((r) => r.ok ? r.json() : {}),
        ]);


        console.log("Fetched dashboard data:", { plansRes, modulesRes, progressRes, usersRes, companyRes, learningStyleRes });
        return {
          plans: plansRes?.plans || [],
          modules: modulesRes?.modules || [],
          progress: progressRes?.progress || [],
          users: usersRes?.users || [],
          company: companyRes?.company ||companyRes?.data|| companyRes || null,
          learningStyle: learningStyleRes?.data?.learning_style || null,
        };
      },
      {
        ttlMs: 5 * 1000, // Short fallback TTL because assignments/progress change externally
        swr: true,
        swrMs: 30 * 1000,
      }
    );
    console.log(result)
    return result.data;
  };

  const loadDashboard = async () => {
    if (!user?.email) return;

    try {
      setLoading(true);
      const emp = await fetchUserByEmail(user.email);
      if (!emp) {
        router.push("/login");
        return;
      }

      setEmployee(emp);

      const selectedCompanyId = isDeveloperMode && activeCompanyId
        ? activeCompanyId
        : emp.company_id;

      if (!selectedCompanyId) {
        setLoading(false);
        return;
      }

      const data = await fetchDashboardData(emp, selectedCompanyId);
      const plans = data?.plans || [];
      const modules = data?.modules || [];
      const progress = Array.isArray(data?.progress) ? data.progress : [];

      const assignedPlans = plans.filter((p: any) => p.status === "ASSIGNED" || p.status === "IN_PROGRESS");
      const moduleTitleById: Record<string, string> = {};
      for (const m of modules) {
        if (m?.module_id) {
          moduleTitleById[m.module_id] = m.title || `Module ${m.module_id}`;
        }
      }

      const mappedAssigned = assignedPlans.map((p: any) => ({
        id: p.module_id,
        title: moduleTitleById[p.module_id] || p.module_name || p.module_title || p.title || `Module ${p.module_id}`,
        moduleName: p.module_name || p.module_title || p.title || null,
        hasBaseline: p.baseline_assessment === 1 || p.baseline_assessment === true,
      }));

      setAssignedModules(mappedAssigned);
      setModuleProgress(progress);
      setLearningStyle(data?.learningStyle || null);
      setCompanyLearningStyleEnabled(Boolean(data?.company?.learning_style_enabled));

      const baselineNeeded = plans.some((plan: any) => plan.baseline_assessment === 1 || plan.baseline_assessment === true);
      setBaselineRequired(baselineNeeded);

      const totalUsers = Array.isArray(data?.users) ? data.users.length : 0;
      const completedCount = progress.filter((p: any) => p.completed_at).length;
      const progressValue = mappedAssigned.length > 0 ? Math.round((completedCount / mappedAssigned.length) * 100) : 0;
      setProgressPercentage(progressValue);
      setCompanyStats({ totalEmployees: totalUsers, completedEmployees: 5, userRank: 1, topPercentile: 10 });
      generateNudgeMessage(progressValue, 1, totalUsers, 10, 5);
    } catch (e) {
      console.error("[Welcome] loadDashboard failed:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!authLoading && user) {
      loadDashboard();
    }

    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, activeCompanyId, isDeveloperMode]);

   const generateNudgeMessage = (progress: number, rank: number | null, total: number, percentile: number, completed: number) => {
     if (progress === 100) setNudgeMessage("🎉 Congratulations! You've completed your Performance Sprint and earned the SME tag!");
     else setNudgeMessage(`💪 One step in! Complete your sprints and stand among the top 5%.`);
   };

   if (showLoadingProgress) {
     return <LoadingProgress label="Preparing your dashboard" progress={loadingProgress} />;
   }

   return (
     <div className="min-h-screen">
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

       <main className="min-h-screen pt-4 md:pt-8 pb-8 md:pb-12 px-4 sm:px-6 lg:px-8">
          <div className="max-w-6xl mx-auto w-full">
         
           {/* Dashboard Header */}
           <div className="mb-6 md:mb-10 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
             <div className="flex items-center gap-3 sm:gap-4 min-w-0">
               <div className="w-10 h-10 sm:w-12 sm:h-12 bg-white rounded-2xl shadow-sm flex items-center justify-center border border-slate-100 shrink-0">
                 <Users className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />
               </div>
               <div className="min-w-0 flex-1">
                 <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight break-words">
                   {employee?.name ? `Welcome, ${employee.name.split(" ")[0]}` : "Learner Dashboard"}
                 </h1>
                 <p className="text-xs sm:text-sm text-slate-500 font-medium break-all sm:break-normal">
                   {employee?.email || "Personalized learning hub"}
                 </p>
               </div>
             </div>
             <div className="w-full md:w-[320px]">
               <CompanySelector showLabel />
             </div>
           </div>

           <div className="grid gap-4 md:gap-8">
             {/* Progress Nudge Card (Premium Circular Design) */}
             {nudgeMessage && (
              <Card className="rounded-3xl border-none shadow-[0_8px_30px_rgb(0,0,0,0.04)] bg-white overflow-hidden">
                <CardContent className="p-4 sm:p-6">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div className="flex items-start gap-4 flex-1 min-w-0">
                      <div className="w-10 h-10 sm:w-14 sm:h-14 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
                        {progressPercentage === 100 ? (
                          <Trophy className="text-blue-600 w-5 h-5 sm:w-6 sm:h-6" />
                        ) : (
                          <Zap className="text-blue-600 w-5 h-5 sm:w-6 sm:h-6" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <h3 className="text-base sm:text-lg font-black text-slate-900">
                          Your Progress
                        </h3>
                        <p className="text-slate-500 mt-1 font-medium leading-relaxed text-xs sm:text-sm">
                          {nudgeMessage}
                        </p>

                        <div className="flex flex-wrap gap-2 mt-3">
                          <Badge
                            variant="secondary"
                            className="bg-slate-100 text-slate-600 border-none font-bold text-[10px] sm:text-xs"
                          >
                            63 COMPLETED
                          </Badge>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col items-center justify-center self-center sm:self-auto">
                      <div
                        className={`relative w-20 h-20 sm:w-24 sm:h-24 rounded-full flex items-center justify-center bg-white border-4 ${
                          progressPercentage >= 100 ? "border-green-100" : "border-blue-50"
                        }`}
                      >
                        <span
                          className={`text-lg sm:text-2xl font-black ${
                            progressPercentage >= 100 ? "text-green-600" : "text-blue-600"
                          }`}
                        >
                          27.6%
                        </span>
                      </div>

                      <div className="mt-2 text-[10px] sm:text-xs font-black uppercase tracking-[0.05em] text-slate-400 text-center">
                        96 of 348
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
             {/* {nudgeMessage && (
               <Card className="rounded-3xl border-none shadow-[0_8px_30px_rgb(0,0,0,0.04)] bg-white overflow-hidden relative">
                 <CardContent className="py-4 sm:py-6 md:py-8 px-4 sm:px-6 md:px-8">
                   <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-6">
                     <div className="flex flex-col gap-3 w-full md:w-auto md:flex-1">
                       <div className="flex items-start gap-3">
                         <div className="w-12 md:w-14 h-12 md:h-14 bg-blue-50 rounded-xl md:rounded-2xl flex items-center justify-center shrink-0">
                           {progressPercentage === 100 ? <Trophy className="text-blue-600 w-5 md:w-6 h-5 md:h-6" /> : <Zap className="text-blue-600 w-5 md:w-6 h-5 md:h-6" />}
                         </div>
                         <div className="min-w-0 flex-1">
                           <h3 className="text-base sm:text-lg md:text-lg font-black text-slate-900">Your Progress</h3>
                           <p className="text-slate-500 mt-1 font-medium leading-relaxed text-xs sm:text-sm md:text-sm line-clamp-3">{nudgeMessage}</p>
                         </div>
                       </div>
                       <div className="flex gap-1.5 md:gap-2 flex-wrap">
                         <Badge variant="secondary" className="bg-slate-100 text-slate-600 border-none font-bold text-[8px] sm:text-[9px] md:text-xs whitespace-nowrap">
                           63 COMPLETED
                         </Badge>
                       </div>
                     </div>

                     <div className="flex flex-col items-center w-full md:w-auto md:ml-auto">
                       <div className={`relative w-16 md:w-20 h-16 md:h-20 rounded-full flex items-center justify-center bg-white border-4 md:border-6 ${progressPercentage >= 100 ? 'border-green-100' : 'border-blue-50'}`}>
                         <span className={`text-lg md:text-xl font-black ${progressPercentage >= 100 ? 'text-green-600' : 'text-blue-600'}`}>
                           27.6%
                         </span>
                       </div>
                       <div className="mt-1 md:mt-2 text-[7px] md:text-[8px] font-black uppercase tracking-[0.05em] text-slate-400 text-center">
                         96 of 348
                       </div>
                     </div>
                   </div>
                 </CardContent>
               </Card>
             )} */}

             {/* Learning Style Card (Sequential Logic) */}
             {companyLearningStyleEnabled && (
               <Card className="rounded-2xl border-none shadow-sm bg-white overflow-visible">
                 <CardContent className="p-4 sm:p-6">
                   {learningStyle ? (
                     <div className="flex flex-col sm:flex-row items-center sm:items-start gap-4 text-center sm:text-left">
                      <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-blue-600 text-white flex items-center justify-center text-xl sm:text-2xl font-black shadow-xl shadow-blue-100 shrink-0">
                        {learningStyle}
                      </div>

                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm sm:text-base font-extrabold text-slate-900">
                          Your Learning Style
                        </h4>
                        <div className="mt-2 text-xs sm:text-sm text-slate-500">
                          <LearningStyleBlurb styleCode={learningStyle} />
                        </div>
                        <Button
                          variant="link"
                          className="text-blue-600 font-bold p-0 h-auto mt-3 text-xs sm:text-sm"
                          onClick={() => router.push("/employee/score-history")}
                        >
                          Get full report <ArrowRight size={14} className="ml-1" />
                        </Button>
                      </div>
                    </div>
                   ) : (
                     <div className="flex flex-col sm:flex-row items-center justify-center sm:justify-between gap-4">
                       <div className="w-full sm:max-w-md text-center sm:text-left">
                         <h4 className="text-base md:text-lg font-black text-slate-900 mb-1">Discover Your Learning Style</h4>
                         <p className="text-xs md:text-sm text-slate-500 font-medium">Take our 5-minute survey to unlock your personalized path.</p>
                       </div>
                     
                       <div className="relative mt-2 sm:mt-0">
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
                         <div className="hidden sm:block absolute -top-20 sm:-top-24 right-0 z-10 w-64 sm:w-72 animate-bounce">
                           <div className="bg-blue-600 text-white rounded-2xl px-4 sm:px-5 py-2 sm:py-3 shadow-xl text-xs sm:text-sm">
                             <p className="font-black text-xs sm:text-sm">Step 1: Start Here!</p>
                             <p className="text-blue-100 text-[10px] sm:text-xs">Complete survey to unlock modules.</p>
                             <div className="absolute right-8 -bottom-2 w-4 h-4 bg-blue-600 rotate-45"></div>
                           </div>
                         </div>
                         <Button onClick={() => router.push('/employee/learning-style')} className="bg-slate-900 hover:bg-black text-white px-6 sm:px-8 py-2 sm:py-3 rounded-xl font-bold h-10 sm:h-11 text-xs sm:text-sm">
                           Take Survey
                         </Button>
                       </div>
                     </div>
                   )}
                 </CardContent>
               </Card>
             )}

             {/* Assigned Modules (Locked State preserved) */}
             <Card className="rounded-2xl border-none shadow-sm bg-white overflow-hidden">
               <CardHeader className="bg-slate-50/50 border-b border-slate-50 px-4 md:px-6 py-3 md:py-4">
                 <CardTitle className="text-sm md:text-base font-black text-slate-900">Assigned Sprints</CardTitle>
               </CardHeader>
               <CardContent className="p-0">
                 {/* Only lock modules if learning style is enabled AND user hasn't completed survey */}
                 {companyLearningStyleEnabled && !learningStyle ? (
                   <div className="py-8 sm:py-12 flex flex-col items-center text-center px-4">
                     <div className="w-12 h-12 sm:w-14 sm:h-14 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-400 mb-3">
                       <ShieldCheck size={24} className="sm:w-7 sm:h-7" />
                     </div>
                     <h5 className="text-sm sm:text-base font-bold text-slate-900">Modules are currently locked</h5>
                     <p className="text-xs sm:text-sm text-slate-500 max-w-xs mt-1 font-medium">Complete your learning preference survey to access your baseline and training plan.</p>
                   </div>
                 ) : assignedModules.length === 0 ? (
                   <div className="py-8 sm:py-12 flex flex-col items-center text-center px-4">
                     <p className="text-slate-500 text-xs sm:text-sm font-medium">No Sprints Assigned</p>
                   </div>
                 ) : (
                   <div>
                     <div className={`divide-y divide-slate-50 ${showAllModules ? 'max-h-[500px] overflow-y-auto' : ''}`}>
                       {(showAllModules ? assignedModules : assignedModules.slice(0, 3)).map((m) => (
                         <div key={m.id} className="flex flex-col items-start gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:p-4 md:p-6 bg-white">
                           <div className="flex-1 min-w-0 w-full sm:w-auto">
                             <p className="text-sm sm:text-base font-extrabold text-slate-900 break-words">{m.title || `Module ${m.id}`}</p>
                             {m.moduleName && (
                               <div className="text-xs text-slate-500 break-words mt-0.5">{m.moduleName}</div>
                             )}
                           </div>

                           <div className="flex gap-2 w-full sm:w-auto flex-shrink-0">
                             {m.hasBaseline ? (
                               <button onClick={() => router.push(`/employee/assessment?moduleId=${m.id}`)} className="px-3 py-2 rounded-lg text-xs border border-slate-200 font-bold text-slate-700 bg-white hover:bg-slate-50 flex-1 sm:flex-none h-10">
                                 Baseline
                               </button>
                             ) : null}

                             <button onClick={() => router.push(`/employee/training-plan?module_id=${m.id}`)} className="px-6 sm:px-8 py-2.5 sm:py-3 rounded-xl text-xs sm:text-sm bg-blue-600 text-white font-bold hover:bg-blue-700 flex-1 sm:flex-none h-11 sm:h-12 transition-all duration-200">
                               Start Your Sprint
                             </button>
                           </div>
                         </div>
                       ))}
                     </div>
                     
                     {/* Show More / Show Less button */}
                     {assignedModules.length > 3 && (
                       <div className="p-3 sm:p-4 bg-slate-50/50 flex justify-center sm:justify-end">
                         <button
                           onClick={() => setShowAllModules(!showAllModules)}
                           className="px-4 py-2 rounded-lg bg-blue-500 text-white text-xs sm:text-sm font-semibold hover:bg-blue-600 transition-all flex items-center gap-1.5 h-9 w-full sm:w-auto justify-center"
                         >
                           {showAllModules ? (
                             <>
                               Show Less
                               <ChevronDown size={14} className="rotate-180 transition-transform" />
                             </>
                           ) : (
                             <>
                               Show More
                               <ChevronDown size={14} className="transition-transform" />
                             </>
                           )}
                         </button>
                       </div>
                     )}
                   </div>
                 )}
               </CardContent>
             </Card>

             {/* Progress History */}
             {/* <Card className="rounded-2xl border-none shadow-sm bg-white overflow-hidden">
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
             </Card> */}
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
    <div className="text-xs sm:text-sm font-medium leading-relaxed">
      <span className="font-black text-slate-900 block mb-1">{info.label}</span>
      {info.blurb}
    </div>
  );
}

function useIllusionProgress(active: boolean) {
  const [progress, setProgress] = useState(12);
  const [show, setShow] = useState(active);

  useEffect(() => {
    if (!active) {
      setProgress(100);
      const timeout = setTimeout(() => setShow(false), 180);
      return () => clearTimeout(timeout);
    }

    setShow(true);
    setProgress(Math.min(25, 10 + Math.round(Math.random() * 12)));

    const id = setInterval(() => {
      setProgress((prev) => {
        const shouldHold = prev > 70 ? Math.random() < 0.45 : Math.random() < 0.25;
        if (shouldHold) return prev; // create a brief stall so progress looks more natural
        const increment = Math.max(1, Math.round(Math.random() * 7));
        return Math.min(prev + increment, 93);
      });
    }, 420 + Math.round(Math.random() * 240));

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
        <p className="text-xs text-slate-500 font-medium">We are personalizing your experience. This will only take a moment.</p>
      </div>
    </div>
  );
}