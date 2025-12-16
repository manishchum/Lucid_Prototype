"use client";

import React, { useState, useEffect } from "react";

interface StepButtonProps {
  step: number;
  label: string;
  completed: boolean;
  disabled: boolean;
  onClick: () => void;
  record: string;
}

function StepButton({ step, label, completed, disabled, onClick, record }: StepButtonProps) {
  const [hover, setHover] = useState(false);
  return (
    <div
      className="relative flex flex-col items-center z-10"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <button
        className={`flex items-center justify-center w-16 h-16 rounded-full border-4 transition-all duration-300 focus:outline-none mb-3
          ${completed ? "bg-green-500 border-green-500 text-white shadow-lg" : 
            disabled ? "bg-gray-200 border-gray-300 text-gray-400" : "bg-white border-blue-400 text-blue-600"}
          ${disabled ? "cursor-not-allowed" : "hover:scale-110 cursor-pointer"}`}
        disabled={disabled}
        onClick={onClick}
        type="button"
        aria-disabled={disabled}
      >
        {completed ? (
          <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <span className="text-xl font-bold">{step}</span>
        )}
      </button>
      <div className={`text-center px-2 transition-colors duration-300 ${
        completed ? "text-green-600" : disabled ? "text-gray-400" : "text-gray-700"
      }`}>
        <div className="font-semibold text-sm leading-tight">{label}</div>
      </div>
      {hover && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-3 px-4 py-2 bg-gray-900 text-white text-sm rounded-lg shadow-2xl z-30 max-w-xs w-max text-center whitespace-normal" role="tooltip">
          {record}
        </div>
      )}
    </div>
  );
}

function ConnectorLine({ completed }: { completed: boolean }) {
  return (
    <div className="flex items-center justify-center flex-1 mx-4">
      <div className={`h-1 w-full rounded transition-colors duration-500 ${completed ? "bg-green-500" : "bg-gray-300"}`}></div>
    </div>
  );
}

import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/contexts/auth-context"
import { supabase } from "@/lib/supabase"
import { Users, LogOut, BookOpen, Clock, User, ChevronDown, Trophy, Target, TrendingUp, Zap } from "lucide-react"
import EmployeeNavigation from "@/components/employee-navigation"
import { SidebarProvider, useSidebar } from "@/contexts/sidebar-context"

interface Employee {
  id: string
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
  const { user, loading: authLoading, logout } = useAuth()
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [loading, setLoading] = useState(true)
  const [scoreHistory, setScoreHistory] = useState<any[]>([])
  const [moduleProgress, setModuleProgress] = useState<any[]>([])
  const [assignedModules, setAssignedModules] = useState<any[]>([])
  const [moduleAssessmentStatus, setModuleAssessmentStatus] = useState<Map<string, ModuleAssessmentStatus>>(new Map())
  const [learningStyle, setLearningStyle] = useState<string | null>(null)
  const [baselineScore, setBaselineScore] = useState<number | null>(null)
  const [baselineMaxScore, setBaselineMaxScore] = useState<number | null>(null)
  const [allAssignedCompleted, setAllAssignedCompleted] = useState<boolean>(false)
  const [showProfileDropdown, setShowProfileDropdown] = useState(false)
  const [baselineRequired, setBaselineRequired] = useState<boolean>(true)
  const [companyStats, setCompanyStats] = useState<{
    totalEmployees: number
    completedEmployees: number
    userRank: number | null
    topPercentile: number | null
  }>({ totalEmployees: 0, completedEmployees: 0, userRank: null, topPercentile: null })
  const [nudgeMessage, setNudgeMessage] = useState<string>("")
  const [progressPercentage, setProgressPercentage] = useState<number>(0)
  const router = useRouter()
  
  // Add debugging for nudge component
  useEffect(() => {
    console.log('[DEBUG] Nudge state changed:', {
      nudgeMessage,
      progressPercentage,
      companyStats,
      assignedModules: assignedModules.length
    });
  }, [nudgeMessage, progressPercentage, companyStats, assignedModules]);

  // LOG: Initial state
  console.log("[EmployeeWelcome] Initial user:", user)
  console.log("[EmployeeWelcome] Initial moduleProgress:", moduleProgress)

  useEffect(() => {
    console.log("[EmployeeWelcome] useEffect fired. authLoading:", authLoading, "user:", user)
    if (!authLoading) {
      if (!user) {
        console.log("[EmployeeWelcome] No user, redirecting to login.")
        router.push("/login")
      } else {
        console.log("[EmployeeWelcome] User found, calling checkEmployeeAccess().")
        checkEmployeeAccess()
      }
    }
  }, [user, authLoading, router])

  const checkEmployeeAccess = async () => {
    if (!user?.email) return

    try {
      // LOG: Fetching employee data
      console.log("[EmployeeWelcome] Fetching employee data for email:", user.email)
      const { data: employeeData, error: employeeError } = await supabase
        .from("users")
        .select("*")
        .eq("email", user.email)
        .single()

      if (employeeError || !employeeData) {
        console.error("[EmployeeWelcome] Employee fetch error:", employeeError)
        router.push("/login")
        return
      }

      setEmployee(employeeData)
      console.log("[EmployeeWelcome] Employee data:", employeeData)

      // Fetch employee learning style
      try {
        const { data: styleData, error: styleError } = await supabase
          .from("employee_learning_style")
          .select("learning_style")
          .eq("user_id", employeeData.user_id)
          .maybeSingle()
        if (styleError) {
          console.warn("[EmployeeWelcome] learning style fetch warning:", styleError)
        }
        if (styleData?.learning_style) {
          setLearningStyle(styleData.learning_style)
        } else {
          setLearningStyle(null)
        }
      } catch (e) {
        console.warn("[EmployeeWelcome] learning style fetch error:", e)
        setLearningStyle(null)
      }

      // Fetch all assessment results for this employee (history)
      const { data: assessments, error: assessmentError } = await supabase
        .from("employee_assessments")
        .select("employee_assessment_id, score, max_score, feedback, question_feedback, assessment_id, assessments(type, questions)")
        .eq("user_id", employeeData.user_id)
        .order("employee_assessment_id", { ascending: false })
      setScoreHistory(assessments || [])
      console.log("[EmployeeWelcome] Assessment history:", assessments)

      // Determine baseline completion by checking the company's baseline assessment ID
      try {
        const companyId = (employeeData as any)?.company_id
        if (companyId) {
          const { data: baselineAssessment, error: baError } = await supabase
            .from('assessments')
            .select('assessment_id')
            .eq('type', 'baseline')
            .eq('company_id', companyId)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle()
          if (baError) {
            console.warn('[EmployeeWelcome] baseline assessment lookup warning:', baError)
          }
          if (baselineAssessment?.assessment_id) {
            const { data: baselineEAList, error: beaError } = await supabase
              .from('employee_assessments')
              .select('score, max_score')
              .eq('user_id', employeeData.user_id)
              .eq('assessment_id', baselineAssessment.assessment_id)
              .order('employee_assessment_id', { ascending: false })
              .limit(1)
            if (beaError) {
              console.warn('[EmployeeWelcome] baseline employee_assessments lookup warning:', beaError)
            }
            const baselineEA = Array.isArray(baselineEAList) ? baselineEAList[0] : null
            if (baselineEA && baselineEA.score !== null && baselineEA.score !== undefined) {
              const s = typeof baselineEA.score === 'number' ? baselineEA.score : parseFloat(String(baselineEA.score))
              if (!Number.isNaN(s)) setBaselineScore(s)
              const ms = (baselineEA as any)?.max_score
              if (ms !== null && ms !== undefined) {
                const msv = typeof ms === 'number' ? ms : parseFloat(String(ms))
                if (!Number.isNaN(msv)) setBaselineMaxScore(msv)
              }
            }
          }
        }
      } catch (e) {
        console.warn('[EmployeeWelcome] baseline completion check failed:', e)
      }

      // Fallback: derive latest baseline by joined type if direct lookup didn't set it
      if (baselineScore === null) {
        try {
          const baselineRows = (assessments || []).filter((row: any) => {
            const arr = Array.isArray(row?.assessments) ? row.assessments : [row?.assessments].filter(Boolean)
            return arr.some((a: any) => a?.type === 'baseline')
          })
          const latestBaseline = baselineRows?.[0]
          const s = typeof latestBaseline?.score === 'number' ? latestBaseline.score : parseFloat(String(latestBaseline?.score))
          if (!Number.isNaN(s)) setBaselineScore(s)
          const ms = (latestBaseline as any)?.max_score
          if (ms !== null && ms !== undefined) {
            const msv = typeof ms === 'number' ? ms : parseFloat(String(ms))
            if (!Number.isNaN(msv)) setBaselineMaxScore(msv)
          }
        } catch (e) {
          console.warn('[EmployeeWelcome] baseline score derivation failed:', e)
        }
      }

      // Get learning plans and check baseline_assessment requirement
      const { data: planRows } = await supabase
        .from('learning_plan')
        .select('learning_plan_id, module_id, status, plan_json, baseline_assessment, user_id')
        .eq('user_id', employeeData.user_id)
        .order('learning_plan_id', { ascending: false })

      // Check if any learning plan requires baseline assessment
      let requiresBaseline = false
      if (planRows && planRows.length > 0) {
        requiresBaseline = planRows.some((plan: any) => plan.baseline_assessment === 1)
      }
      setBaselineRequired(requiresBaseline)

      // If baseline not required, set default scores
      if (!requiresBaseline && baselineScore === null) {
        setBaselineScore(50);
        setBaselineMaxScore(100);
      }

      console.log("Plan Rows", planRows);
      
      // Get assigned plans and calculate completion
      const assignedPlans = planRows?.filter((plan: any) => plan.status === 'ASSIGNED') || []
      let completed = false
      let completedModules = 0
      let totalModules = 0
      
      console.log("Assigned Plans", assignedPlans);
      
      if (assignedPlans.length > 0) {
        totalModules = assignedPlans.length
        const moduleIds = assignedPlans.map((plan: any) => plan.module_id).filter(Boolean)
        
        if (moduleIds.length > 0) {
          console.log("Module IDs to check:", moduleIds);
          
          // Get processed modules for the training modules
          const { data: processedModules } = await supabase
            .from('processed_modules')
            .select('processed_module_id, original_module_id')
            .in('original_module_id', moduleIds)
          
          console.log("Processed modules data:", processedModules);
          
          if (processedModules && processedModules.length > 0) {
            const processedModuleIds = processedModules.map(pm => pm.processed_module_id).filter(Boolean)
            
            // Check completion status using processed_module_ids
            const { data: moduleProgressData } = await supabase
              .from('module_progress')
              .select('processed_module_id, completed_at')
              .eq('user_id', employeeData.user_id)
              .in('processed_module_id', processedModuleIds)
            
            console.log("Module progress data:", moduleProgressData);
            
            // Count completed modules
            const completedSet = new Set(
              (moduleProgressData || [])
                .filter((progress: any) => progress.completed_at)
                .map((progress: any) => String(progress.processed_module_id))
            )
            
            // Map back to count how many of our original modules are completed
            const completedTrainingModules = new Set()
            processedModules.forEach(pm => {
              if (completedSet.has(String(pm.processed_module_id))) {
                completedTrainingModules.add(String(pm.original_module_id))
              }
            })
            
            completedModules = completedTrainingModules.size
            completed = completedModules >= totalModules
            
            console.log("Completion status:", { 
              totalModules, 
              completedModules, 
              completed, 
              processedModuleIds,
              completedProcessedModuleIds: Array.from(completedSet),
              completedTrainingModuleIds: Array.from(completedTrainingModules)
            });
          } else {
            console.log("No processed modules found for the assigned module IDs");
            completedModules = 0
            completed = false
          }
        }
      }

      setAllAssignedCompleted(completed)
      console.log("Module completion check result:", completed, completedModules, totalModules)
      
      // Calculate progress percentage
      const progress = totalModules > 0 ? Math.round((completedModules / totalModules) * 100) : 0
      setProgressPercentage(progress)

      // Fetch company statistics for nudges
      if (employeeData.company_id) {
        console.log('[DEBUG] Employee has company_id, calling fetchCompanyStats:', employeeData.company_id);
        await fetchCompanyStats(employeeData.company_id, employeeData.user_id, progress)
      } else {
        console.log('[DEBUG] No company_id found for employee, nudges disabled:', employeeData);
      }

      // Extract assigned modules and check their baseline assessment status
      await loadAssignedModulesWithBaselineStatus(employeeData, assignedPlans)

      // Fetch module progress for this employee
      const { data: progressData, error: progressError } = await supabase
        .from("module_progress")
        .select("*, processed_modules(title)")
        .eq("user_id", employeeData.user_id)
      if (progressError) {
        console.error("[EmployeeWelcome] module_progress fetch error:", progressError)
      }
      console.log("[EmployeeWelcome] module_progress data:", progressData)
      setModuleProgress(progressData || [])
    } catch (error) {
      console.error("Employee access check failed:", error)
      router.push("/login")
    } finally {
      setLoading(false)
    }
  }

  const loadAssignedModulesWithBaselineStatus = async (employeeData: any, assignedPlans: any[]) => {
    try {
      const modulesList: { id: string; title: string | null }[] = []
      const assessmentStatusMap = new Map<string, ModuleAssessmentStatus>()
      
      if (assignedPlans && assignedPlans.length > 0) {
        const explicitModuleIds = Array.from(new Set(assignedPlans.map((p: any) => p.module_id).filter(Boolean))).map(String)
        
        if (explicitModuleIds.length > 0) {
          // Get module titles
          const { data: tmRows } = await supabase
            .from('training_modules')
            .select('module_id, title')
            .in('module_id', explicitModuleIds as any[])
          
          if (tmRows && tmRows.length > 0) {
            for (const r of tmRows) {
              if (r?.module_id) {
                modulesList.push({ id: String(r.module_id), title: r.title || null })
              }
            }
          }

          // Check baseline assessment status for each module using the learning_plan table
          for (const moduleId of explicitModuleIds) {
            console.log(`[DEBUG] Checking baseline status for module ${moduleId}`);
            
            // Check if baseline is assigned in learning_plan
            const { data: learningPlan } = await supabase
              .from('learning_plan')
              .select('baseline_assessment')
              .eq('user_id', employeeData.user_id)
              .eq('module_id', moduleId)
              .single()
            
            let hasBaseline = false
            let baselineCompleted = false
            let baselineScore: number | undefined
            let baselineMaxScore: number | undefined
            
            if (learningPlan && learningPlan.baseline_assessment === 1) {
              hasBaseline = true
              console.log(`[DEBUG] Module ${moduleId} has baseline assignment`);
              
              // Check if user has completed baseline assessment for this company
              const { data: baselineAssessments } = await supabase
                .from('assessments')
                .select('assessment_id')
                .eq('type', 'baseline')
                .eq('company_id', employeeData.company_id)
              
              if (baselineAssessments && baselineAssessments.length > 0) {
                // Check if any of these baseline assessments are completed by the user
                const assessmentIds = baselineAssessments.map(a => a.assessment_id)
                
                const { data: completedBaseline } = await supabase
                  .from('employee_assessments')
                  .select('score, max_score, completed_at')
                  .eq('user_id', employeeData.user_id)
                  .in('assessment_id', assessmentIds)
                  .not('completed_at', 'is', null)
                  .order('completed_at', { ascending: false })
                  .limit(1)
                
                if (completedBaseline && completedBaseline.length > 0) {
                  baselineCompleted = true
                  baselineScore = completedBaseline[0].score
                  baselineMaxScore = completedBaseline[0].max_score
                  console.log(`[DEBUG] Module ${moduleId} baseline completed with score:`, baselineScore);
                }
              }
            }
            
            assessmentStatusMap.set(moduleId, {
              moduleId,
              hasBaseline,
              baselineCompleted,
              baselineScore,
              baselineMaxScore
            })
            
            console.log(`[DEBUG] Module ${moduleId} status:`, {
              hasBaseline,
              baselineCompleted,
              baselineScore
            });
          }
        }
      }

      // Dedupe modules by id
      const dedupMap = new Map<string, { id: string; title: string | null }>()
      for (const m of modulesList) {
        if (!dedupMap.has(m.id)) dedupMap.set(m.id, m)
        else if (!dedupMap.get(m.id)?.title && m.title) dedupMap.set(m.id, m)
      }
      const dedup = Array.from(dedupMap.values())
      
      setAssignedModules(dedup)
      setModuleAssessmentStatus(assessmentStatusMap)
      
      console.log('[DEBUG] Final assigned modules:', dedup)
      console.log('[DEBUG] Final assessment status map:', assessmentStatusMap)
      
    } catch (e) {
      console.warn('[EmployeeWelcome] extracting assigned modules with baseline status failed:', e)
      setAssignedModules([])
      setModuleAssessmentStatus(new Map())
    }
  }

  const fetchCompanyStats = async (companyId: string, userId: string, userProgress: number) => {
    console.log('[DEBUG] fetchCompanyStats called with:', { companyId, userId, userProgress });
    
    try {
      // Get all employees in the company
      const { data: companyEmployees, error: employeesError } = await supabase
        .from('users')
        .select('user_id')
        .eq('company_id', companyId)

      console.log('[DEBUG] Company employees query result:', { companyEmployees, employeesError });

      if (employeesError || !companyEmployees) {
        console.log('[DEBUG] Early return due to employees error or no data');
        return;
      }

      const totalEmployees = companyEmployees.length
      console.log('[DEBUG] Total employees in company:', totalEmployees);

      // Get learning plan assignments for all company employees
      const employeeIds = companyEmployees.map((emp: any) => emp.user_id)
      const { data: allPlans } = await supabase
        .from('learning_plan')
        .select('user_id, module_id, status')
        .in('user_id', employeeIds)
        .eq('status', 'ASSIGNED')

      console.log('[DEBUG] All plans for company:', allPlans);

      let completedEmployees = 0
      let userRank = null
      const employeeProgressMap = new Map<string, number>()

      // Calculate completion for each employee using the same logic as Track Your Progress
      for (const empUserId of employeeIds) {
        console.log('[DEBUG] Processing employee:', empUserId);
        
        // Get assigned plans for this employee
        const employeePlans = (allPlans || []).filter(plan => plan.user_id === empUserId)
        console.log('[DEBUG] Employee plans for', empUserId, ':', employeePlans);
        
        if (employeePlans.length === 0) {
          employeeProgressMap.set(empUserId, 0)
          console.log('[DEBUG] No plans for employee', empUserId, ', setting progress to 0');
          continue
        }

        const moduleIds = employeePlans.map(plan => plan.module_id).filter(Boolean)
        let completedModules = 0
        let totalModules = employeePlans.length

        console.log('[DEBUG] Module IDs for employee', empUserId, ':', moduleIds);

        if (moduleIds.length > 0) {
          // Get processed modules for the assigned training modules (same as Track Your Progress logic)
          const { data: processedModules } = await supabase
            .from('processed_modules')
            .select('processed_module_id, original_module_id')
            .in('original_module_id', moduleIds)
          
          console.log('[DEBUG] Processed modules for employee', empUserId, ':', processedModules);
          
          if (processedModules && processedModules.length > 0) {
            const processedModuleIds = processedModules.map(pm => pm.processed_module_id).filter(Boolean)
            
            // Check completion status using processed_module_ids (same as Track Your Progress logic)
            const { data: moduleProgressData } = await supabase
              .from('module_progress')
              .select('processed_module_id, completed_at')
              .eq('user_id', empUserId)
              .in('processed_module_id', processedModuleIds)
            
            console.log('[DEBUG] Module progress data for employee', empUserId, ':', moduleProgressData);
            
            // Count completed modules (same logic as Track Your Progress)
            const completedSet = new Set(
              (moduleProgressData || [])
                .filter((progress: any) => progress.completed_at)
                .map((progress: any) => String(progress.processed_module_id))
            )
            
            console.log('[DEBUG] Completed processed module IDs for employee', empUserId, ':', Array.from(completedSet));
            
            // Map back to count how many of our original modules are completed
            const completedTrainingModules = new Set()
            processedModules.forEach(pm => {
              if (completedSet.has(String(pm.processed_module_id))) {
                completedTrainingModules.add(String(pm.original_module_id))
              }
            })
            
            completedModules = completedTrainingModules.size
            console.log('[DEBUG] Completed training modules for employee', empUserId, ':', completedModules, 'out of', totalModules);
          } else {
            completedModules = 0
            console.log('[DEBUG] No processed modules found for employee', empUserId);
          }
        }

        // Calculate progress percentage (same as Track Your Progress logic)
        const progress = totalModules > 0 ? Math.round((completedModules / totalModules) * 100) : 0
        employeeProgressMap.set(empUserId, progress)
        
        console.log('[DEBUG] Final progress for employee', empUserId, ':', progress, '%');
        
        // Count as completed employee if 100% (same as Track Your Progress logic)
        if (progress === 100) {
          completedEmployees++
          console.log('[DEBUG] Employee', empUserId, 'marked as completed (100%)');
        }
      }

      console.log('[DEBUG] Employee progress map:', Object.fromEntries(employeeProgressMap));
      console.log('[DEBUG] Completed employees count:', completedEmployees);

      // Calculate user rank
      const progressValues = Array.from(employeeProgressMap.values()).sort((a, b) => b - a)
      console.log('[DEBUG] All progress values (sorted):', progressValues);
      
      const userProgressIndex = progressValues.findIndex(p => p <= userProgress)
      if (userProgressIndex !== -1) {
        userRank = userProgressIndex + 1
      }

      console.log('[DEBUG] User progress:', userProgress, '%, rank:', userRank);

      const topPercentile = totalEmployees > 0 ? Math.round(((totalEmployees - (userRank || totalEmployees)) / totalEmployees) * 100) : 0

      console.log('[DEBUG] Calculated stats:', { 
        totalEmployees, 
        completedEmployees, 
        userRank, 
        topPercentile,
        userProgress 
      });

      // Force update the state even if values are the same
      const newStats = {
        totalEmployees,
        completedEmployees,
        userRank,
        topPercentile
      }
      
      setCompanyStats(newStats)
      console.log('[DEBUG] Set company stats:', newStats);

      // Generate nudge message with additional debugging
      console.log('[DEBUG] Calling generateNudgeMessage with:', { userProgress, userRank, totalEmployees, topPercentile, completedEmployees });
      generateNudgeMessage(userProgress, userRank, totalEmployees, topPercentile, completedEmployees)

    } catch (error) {
      console.error('[DEBUG] Error in fetchCompanyStats:', error)
    }
  }

  const generateNudgeMessage = (progress: number, rank: number | null, total: number, percentile: number, completed: number) => {
    console.log('[DEBUG] generateNudgeMessage called with:', { progress, rank, total, percentile, completed });
    
    if (progress === 100) {
      const message = "🎉 Congratulations! You've completed your learning plan and earned the SME (Subject Matter Expert) tag!";
      console.log('[DEBUG] Setting nudge message (100% complete):', message);
      setNudgeMessage(message);
      return;
    }

    let message = "";
    
    // Ensure we have valid data before generating messages
    if (total === 0) {
      message = "🎯 Welcome! Complete your learning modules to get started on your learning journey!";
    } else if (percentile >= 80) {
      message = `🏆 Amazing! You're in the top ${100 - percentile}% of learners in your company (${total} employees). Complete your training to maintain your lead!`;
    } else if (percentile >= 60) {
      message = `🎯 You're in the top ${100 - percentile}% of your company (${total} employees). Complete this training to join the top 20% and earn SME status!`;
    } else if (percentile >= 40) {
      const peopleToSurpass = Math.max(0, total - (rank || total) - Math.round(total * 0.2));
      message = `⚡ Push forward! Complete your training to surpass ${peopleToSurpass} colleagues and reach the top 20% in your company of ${total} employees!`;
    } else if (progress >= 50) {
      message = `🚀 You're halfway there! Complete your training to join ${completed} successful colleagues and earn your SME tag!`;
    } else if (progress > 0) {
      const peopleAhead = Math.max(0, total - completed);
      message = `💪 Great start! Complete this training and you'll be ahead of ${peopleAhead} colleagues in your company of ${total} employees!`;
    } else {
      message = `🎯 Start your learning journey! Join ${completed} colleagues who have already completed their training and earned SME status in your company of ${total} employees!`;
    }
    
    console.log('[DEBUG] Setting nudge message:', message);
    setNudgeMessage(message);
  }

  const handleLogout = async () => {
    await logout()
    router.push("/")
  }

  const getBaselineButtonState = (moduleId: string) => {
    const status = moduleAssessmentStatus.get(moduleId)
    if (!status) {
      return { disabled: true, text: 'Loading...', variant: 'outline' as const }
    }
    
    if (!status.hasBaseline) {
      return { disabled: true, text: 'No Baseline Required', variant: 'outline' as const }
    }
    
    if (status.baselineCompleted) {
      return { 
        disabled: true, 
        text: `Completed (${status.baselineScore}/${status.baselineMaxScore})`, 
        variant: 'outline' as const 
      }
    }
    
    return { disabled: false, text: 'Take Baseline Assessment', variant: 'default' as const }
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-green-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading your dashboard...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100" onClick={() => setShowProfileDropdown(false)}>
      <EmployeeNavigation showBack={false} showForward={false} />
      
      {/* Main content area that adapts to sidebar */}
      <div 
        className="transition-all duration-300 ease-in-out"
        style={{ 
          marginLeft: 'var(--sidebar-width, 0px)',
        }}
      >
        {/* Header */}
        <div className="bg-white shadow-sm border-b" onClick={(e) => e.stopPropagation()}>
          <div className="max-w-10xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center py-4">
              <div className="flex items-center">
                <Users className="w-8 h-8 text-green-600 mr-3" />
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Learner's Dashboard</h1>
              </div>
            </div>
          </div>
        </div>
      </div>

        {/* Page content */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">        
        <div className="grid gap-8">
          {/* Progress Nudge Card */}
          {nudgeMessage && (
            <Card className="bg-gradient-to-r from-blue-50 to-purple-50 border-2 border-blue-200">
              <CardContent className="pt-6">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0">
                    {progressPercentage === 100 ? (
                      <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center">
                        <Trophy className="w-6 h-6 text-white" />
                      </div>
                    ) : progressPercentage >= 50 ? (
                      <div className="w-12 h-12 bg-blue-500 rounded-full flex items-center justify-center">
                        <TrendingUp className="w-6 h-6 text-white" />
                      </div>
                    ) : (
                      <div className="w-12 h-12 bg-purple-500 rounded-full flex items-center justify-center">
                        <Zap className="w-6 h-6 text-white" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-lg font-semibold text-gray-900">Your Progress</h3>
                      <div className="flex items-center gap-2">
                        <div className="text-2xl font-bold text-blue-600">{progressPercentage}%</div>
                        {companyStats.userRank && (
                          <Badge variant="outline" className="bg-white">
                            Rank #{companyStats.userRank} of {companyStats.totalEmployees}
                          </Badge>
                        )}
                      </div>
                    </div>
                    <p className="text-gray-700 mb-3">{nudgeMessage}</p>
                    <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
                      <div 
                        className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full transition-all duration-500 ease-out"
                        style={{ width: `${progressPercentage}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-sm text-gray-600">
                      <span>{companyStats.completedEmployees} colleagues completed</span>
                      {companyStats.topPercentile !== null && (
                        <span>Top {companyStats.topPercentile}% in company</span>
                      )}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Learning Preference Card */}
          {/* COMMENTED OUT - Learning Preference Card
          <Card>
            <CardHeader>
              <CardTitle>Learning Preference</CardTitle>
              <CardDescription>Tell us how you learn best so we can personalize your plan</CardDescription>
            </CardHeader>
            <CardContent>
              {learningStyle ? (
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0">
                      <div className="w-20 h-20 rounded-full bg-green-600 text-white flex items-center justify-center text-2xl font-semibold">{learningStyle}</div>
                    </div>
                    <div className="min-w-0">
                      <LearningStyleBlurb styleCode={learningStyle} />
                      <div className="mt-4 md:mt-2">
                        <Button variant="outline" onClick={() => router.push('/employee/score-history')}>
                          Get your full report
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium mb-1">Not set yet</div>
                    <div className="text-sm text-gray-600">Take a short 5-minute survey to personalize your learning experience.</div>
                  </div>
                  <Button onClick={() => router.push('/employee/learning-style')}>Set Learning Preference</Button>
                </div>
              )}
            </CardContent>
          </Card>
          */}

          {/* If learning preference not completed, block rest of dashboard */}
          {!learningStyle ? (
            <Card>
              <CardHeader>
                <CardTitle>Complete Your Learning Preference</CardTitle>
                <CardDescription>We need this before showing your assigned modules and learning plan</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-gray-700 mb-4">Please complete the Learning Preference survey to unlock your Baseline Assessment, Assigned Modules, and Learning Plan.</div>
                <div className="flex gap-2">
                  <Button onClick={() => router.push('/employee/learning-style')}>Take Survey</Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Assigned Modules Card */}
              <Card>
                <CardHeader>
                  <CardTitle>Assigned Modules</CardTitle>
                  <CardDescription>Modules assigned to you from your learning plan</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {assignedModules.length === 0 ? (
                      <div className="text-gray-500">You have no modules assigned yet.</div>
                    ) : (
                      assignedModules.map((m) => {
                        const buttonState = getBaselineButtonState(m.id)
                        
                        return (
                          <div key={m.id} className="flex items-center justify-between p-3 rounded-lg border bg-white">
                            <div className="font-medium text-gray-800">{m.title || `Module ${m.id}`}</div>

                            <div className="flex items-center gap-3">
                              {(() => {
                                let percent = 0
                                const matches = (moduleProgress || []).filter((mp: any) => {
                                  try {
                                    if (mp?.processed_module_id && String(mp.processed_module_id) === String(m.id)) return true
                                    if (mp?.module_id && String(mp.module_id) === String(m.id)) return true
                                    if (
                                      mp?.processed_modules?.title &&
                                      m?.title &&
                                      String(mp.processed_modules.title).toLowerCase().includes(String(m.title).toLowerCase())
                                    ) return true
                                  } catch (e) {}
                                  return false
                                })
                                if (matches.length > 0) {
                                  for (const mp of matches) {
                                    if (mp.completed_at) {
                                      percent = 100
                                      break
                                    }
                                    let indicators = 0
                                    if (mp.viewed_at) indicators++
                                    if (mp.audio_listen_duration && mp.audio_listen_duration > 0) indicators++
                                    if (mp.quiz_score !== null && mp.quiz_score !== undefined) indicators++
                                    const p = indicators > 0 ? Math.round((indicators / 3) * 90) : 0
                                    if (p > percent) percent = p
                                  }
                                }

                                return (
                                  <div className="w-48 sm:w-64 lg:w-72">
                                    <div className="w-full bg-gray-200 rounded-full h-2">
                                      <div
                                        className={`h-2 rounded-full transition-all duration-500 ${percent >= 100 ? 'bg-green-500' : 'bg-gradient-to-r from-blue-500 to-green-400'}`}
                                        style={{ width: `${percent}%` }}
                                        aria-valuenow={percent}
                                        aria-valuemin={0}
                                        aria-valuemax={100}
                                      />
                                    </div>
                                  </div>
                                )
                              })()}

                              <Button 
                                variant={buttonState.variant}
                                disabled={buttonState.disabled}
                                onClick={() => !buttonState.disabled && router.push(`/employee/assessment?moduleId=${m.id}`)}
                                className="min-w-[180px]"
                              >
                                {buttonState.text}
                              </Button>
                              
                              <Button onClick={async () => {
                                try {
                                  if (!employee?.user_id) {
                                    alert('Could not determine employee. Please reload or login again.');
                                    return;
                                  }
                                  const res = await fetch(`/api/training-plan?module_id=${encodeURIComponent(m.id)}`, {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ user_id: employee.user_id }),
                                  });
                                  const data = await res.json().catch(() => ({}));
                                  if (!res.ok) {
                                    const msg = data?.error || data?.message || 'Failed to generate learning plan';
                                    alert(`Error: ${msg}`);
                                    return;
                                  }
                                  // Redirect to training plan page scoped to this module
                                  router.push(`/employee/training-plan?module_id=${encodeURIComponent(m.id)}`);
                                } catch (e) {
                                  console.error('Error requesting module training plan', e);
                                  alert('Network error while requesting training plan.');
                                }
                              }}>Learning Plan</Button>
                            </div>
                          </div>
                        )
                      })
                    )}
                  </div>
                </CardContent>
              </Card>
            </>
          )}

          {/* Progress Tracker Card */}
          <Card>
            <CardHeader>
              <CardTitle>Track Your Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {moduleProgress.length === 0 ? (
                  <div className="text-gray-500">Nothing here (yet) — complete your first module to see progress.</div>
                ) : (
                  moduleProgress.map((mod, idx) => {
                    // LOG: Each module progress row
                    console.log(`[EmployeeWelcome] Rendering moduleProgress[${idx}]:`, mod)
                    return (
                      <div key={mod.processed_module_id} className={`flex items-center justify-between p-3 rounded-lg ${mod.completed_at ? "bg-green-50" : "bg-gray-50"}`}>
                        <span className={`font-medium ${mod.completed_at ? "text-green-800" : "text-gray-600"}`}>{mod.processed_modules?.title || `Module ${mod.processed_module_id}`}</span>
                        <div className="flex gap-2 items-center">
                          {mod.viewed_at && (
                            <span className="px-2 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium">Viewed</span>
                          )}
                          {mod.audio_listen_duration > 0 && (
                            <span className="px-2 py-1 bg-purple-100 text-purple-800 rounded-full text-xs font-medium">Audio: {mod.audio_listen_duration}s</span>
                          )}
                          {mod.quiz_score !== null && (
                            <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full text-xs font-medium">Quiz: {mod.quiz_score}</span>
                          )}
                          {mod.completed_at ? (
                            <span className="px-2 py-1 bg-green-200 text-green-800 rounded-full text-xs font-medium">✓ Complete</span>
                          ) : (
                            <span className="px-2 py-1 bg-gray-200 text-gray-600 rounded-full text-xs font-medium">In Progress</span>
                          )}
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
            </CardContent>
          </Card>
        </div>
        </div>
      </div>
    </div>
  )
}

// Small helper component for a friendly style description
function LearningStyleBlurb({ styleCode }: { styleCode: string }) {
  const meta: Record<string, { label: string; blurb: string }> = {
    CS: {
      label: "Concrete Sequential",
      blurb: "Prefers structure, clear steps, and hands‑on practice. Your plan emphasizes checklists, examples, and measurable milestones.",
    },
    AS: {
      label: "Abstract Sequential",
      blurb: "Thinks analytically and values logic. Your plan focuses on theory, frameworks, and evidence‑based decision making.",
    },
    AR: {
      label: "Abstract Random",
      blurb: "Learns through connections and stories. Your plan highlights collaboration, reflection, and real‑world context.",
    },
    CR: {
      label: "Concrete Random",
      blurb: "Enjoys experimentation and rapid iteration. Your plan leans into challenges, scenarios, and creative problem solving.",
    },
  };
  const info = meta[styleCode as keyof typeof meta];
  if (!info) return null;
  return (
    <div className="text-sm text-gray-700">
      <div className="font-semibold">{info.label}</div>
      <div>{info.blurb}</div>
    </div>
  );
}