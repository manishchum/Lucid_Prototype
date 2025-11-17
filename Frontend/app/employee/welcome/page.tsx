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

import ScoreFeedbackCard from "../assessment/score-feedback"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { useAuth } from "@/contexts/auth-context"
import { supabase } from "@/lib/supabase"
import { Users, LogOut, BookOpen, Clock, User, ChevronDown } from "lucide-react"
import EmployeeNavigation from "@/components/employee-navigation"
import { SidebarProvider, useSidebar } from "@/contexts/sidebar-context"

interface Employee {
  id: string
  email: string
  name: string | null
  joined_at: string
}

export default function EmployeeWelcome() {
  const { user, loading: authLoading, logout } = useAuth()
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [loading, setLoading] = useState(true)
  const [scoreHistory, setScoreHistory] = useState<any[]>([])
  const [moduleProgress, setModuleProgress] = useState<any[]>([])
  const [learningStyle, setLearningStyle] = useState<string | null>(null)
  const [baselineScore, setBaselineScore] = useState<number | null>(null)
  const [baselineMaxScore, setBaselineMaxScore] = useState<number | null>(null)
  const [allAssignedCompleted, setAllAssignedCompleted] = useState<boolean>(false)
  const [showProfileDropdown, setShowProfileDropdown] = useState(false)
  const [baselineRequired, setBaselineRequired] = useState<boolean>(true) // New state for baseline requirement
  const router = useRouter()
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
      // LOG: Employee data fetched
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
      // Note: employee_assessments does not have created_at; avoid selecting/ordering by it
      const { data: assessments, error: assessmentError } = await supabase
        .from("employee_assessments")
        .select("employee_assessment_id, score, max_score, feedback, question_feedback, assessment_id, assessments(type, questions)")
        .eq("user_id", employeeData.user_id)
        .order("employee_assessment_id", { ascending: false })
      setScoreHistory(assessments || [])
      // LOG: Assessment history fetched
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

      // Fallback: derive latest baseline by joined type if direct lookup didn’t set it
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

      // Determine if assigned learning plan modules are all completed
      try {
        const { data: planRows } = await supabase
          .from('learning_plan')
          .select('learning_plan_id, status, plan_json, baseline_assessment') // Fetch baseline_assessment column
          .eq('user_id', employeeData.user_id)
          .order('learning_plan_id', { ascending: false })

        // Check if any learning plan requires baseline assessment
        let requiresBaseline = false
        if (planRows && planRows.length > 0) {
          requiresBaseline = planRows.some(plan => plan.baseline_assessment === 1)
        }
        setBaselineRequired(requiresBaseline) // Set baselineRequired state

        // Check completion status for assigned plans
        const assignedPlan = planRows?.find(plan => plan.status === 'ASSIGNED')
        let completed = false
        if (assignedPlan?.plan_json) {
          let planObj: any = assignedPlan.plan_json
          if (typeof planObj === 'string') {
            try { planObj = JSON.parse(planObj) } catch {}
          }
          // Unwrap common shapes
          const mods = planObj?.modules || planObj?.learning_plan?.modules || planObj?.plan?.modules
          if (Array.isArray(mods) && mods.length > 0) {
            const processedIds = Array.from(new Set(mods.map((m: any) => m?.id).filter(Boolean))).map(String)
            const originalIds = Array.from(new Set(mods.map((m: any) => m?.original_module_id).filter(Boolean))).map(String)
            let completedCount = 0
            const required = mods.length
            if (processedIds.length > 0) {
              const { data: progP } = await supabase
                .from('module_progress')
                .select('processed_module_id, completed_at')
                .eq('user_id', employeeData.user_id)
                .in('processed_module_id', processedIds)
              const completedSet = new Set((progP || []).filter(r => r.completed_at).map(r => String(r.processed_module_id)))
              completedCount += completedSet.size
            }
            if (originalIds.length > 0) {
              const { data: progO } = await supabase
                .from('module_progress')
                .select('module_id, completed_at')
                .eq('user_id', employeeData.user_id)
                .in('module_id', originalIds)
              const completedSet = new Set((progO || []).filter(r => r.completed_at).map(r => String(r.module_id)))
              // Merge: assume overlap minimal; union approximate
              completedCount = Math.max(completedCount, completedSet.size)
            }
            completed = completedCount >= required
          }
        }
        setAllAssignedCompleted(completed)
      } catch (e) {
        console.warn('[EmployeeWelcome] assigned modules completion check failed:', e)
        setAllAssignedCompleted(false)
        setBaselineRequired(true) // Default to requiring baseline if check fails
      }

      // Fetch module progress for this employee, join processed_modules for title
      // LOG: Fetching module_progress for user_id:", employeeData.id)
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

  const handleLogout = async () => {
    await logout()
    router.push("/")
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
                  {/* <p className="text-sm text-gray-600">Welcome to your dashboard</p> */}
              </div>
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
            </div>
          </div>
        </div>
      </div>

        {/* Page content */}
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">        
        <div className="grid gap-8">{/* Welcome Card */}
          {/*
          <Card className="bg-gradient-to-r from-green-500 to-blue-600 text-white">
            <CardHeader>
              <CardTitle className="text-3xl">Welcome, {employee?.name || user?.email}!</CardTitle>
              <CardDescription className="text-green-100">
                You've successfully logged into your personalized training portal
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center text-green-100">
                <Clock className="w-5 h-5 mr-2" />
                <span>Member since {new Date(employee?.joined_at || "").toLocaleDateString()}</span>
              </div>
            </CardContent>
          </Card>
          */}

          {/* Getting Started Flow Guide */}
          {/* Arrow-based horizontal flow for onboarding steps */}
          <Card className="bg-gradient-to-r from-gray-50 to-blue-50 border border-blue-100">
            <CardHeader>
              <CardTitle className="text-gray-900">Follow these steps to maximize your learning experience</CardTitle>
              {/* <CardDescription className="text-gray-600">
                Follow these steps to maximize your learning experience
              </CardDescription> */}
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between py-10 px-2 gap-2">
                <StepCircle
                  step={1}
                  label="Learning Preference"
                  subtitle="Your brain has a style—let’s discover it"
                  completed={!!learningStyle}
                  active={!learningStyle}
                  onClick={() => !learningStyle && router.push("/employee/learning-style")}
                />
                {/* PHASED RELEASE: Steps 2 and 3 hidden until later rollout */}
                
                {baselineRequired && (
                  <StepCircle
                    step={2}
                    label="Baseline Assessment"
                    subtitle="Evaluate your current skill level"
                    completed={!!baselineScore}
                    active={!!learningStyle && baselineScore === null}
                    onClick={() => learningStyle && baselineScore === null && router.push("/employee/assessment")}
                  />
                )}

                
                <StepCircle
                  step={baselineRequired ? 3 : 2}
                  label="Learning Plan"
                  subtitle="Get your personalized learning roadmap"
                  completed={allAssignedCompleted}
                  active={!!learningStyle && baselineScore !== null && !allAssignedCompleted}
                  onClick={() => learningStyle && baselineScore !== null && !allAssignedCompleted && router.push("/employee/training-plan")}
                />
               
              </div>
            </CardContent>
          </Card>

          {/* Learning Style Card with sequential logic */}
          {/* 
          <Card className="border border-blue-200 bg-white/80 backdrop-blur">
            <CardHeader>
              <CardTitle>Your Learning Style</CardTitle>
              <CardDescription>
                Personalized recommendations are tuned to your learning style
              </CardDescription>
            </CardHeader>
            <CardContent>
              {learningStyle ? (
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge className="text-sm px-2 py-1">{learningStyle}</Badge>
                      <span className="text-gray-600">Saved to your profile</span>
                    </div>
                    <LearningStyleBlurb styleCode={learningStyle} />
                  </div>
                  <Button disabled title={`Learning style: ${learningStyle}`} variant="outline">
                    ✓ Completed
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium mb-1">Not set yet</div>
                    <div className="text-sm text-gray-600">Take a 5-minute survey to personalize your plan.</div>
                  </div>
                  <Button onClick={() => router.push("/employee/learning-style")}>Check your learning style</Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Main Cards with sequential activation */}
          {/* 
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Assessments (Baseline) - Only enabled if learning style is completed */}
            {/* 
            <Card className={!learningStyle ? "opacity-60" : ""}>
              <CardHeader>
                <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-4 ${
                  !learningStyle ? "bg-gray-100" : "bg-purple-100"
                }`}>
                  <Users className={`w-6 h-6 ${!learningStyle ? "text-gray-400" : "text-purple-600"}`} />
                </div>
                <CardTitle className={!learningStyle ? "text-gray-500" : ""}>Assessments</CardTitle>
                <CardDescription className={!learningStyle ? "text-gray-400" : ""}>
                  Take baseline and module assessments
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className={`text-sm mb-4 ${!learningStyle ? "text-gray-400" : "text-gray-500"}`}>
                  AI-generated assessments will help track your progress.
                </p>
                {!learningStyle ? (
                  <Button className="w-full" disabled>
                    Complete Learning Style First
                  </Button>
                ) : baselineScore !== null ? (
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-gray-700">
                      <div className="font-medium">Baseline assessment completed</div>
                      <div>Score: <b>{baselineScore}</b>{baselineMaxScore ? <span> / {baselineMaxScore}</span> : null}</div>
                    </div>
                    {allAssignedCompleted ? (
                      <Button className="w-44" onClick={() => router.push('/employee/assessment')} title="You can retake the baseline after completing assigned modules">
                        Retake Baseline
                      </Button>
                    ) : (
                      <Button className="w-44" disabled title="Baseline already completed; finish your assigned modules to retake">
                        ✓ Completed
                      </Button>
                    )}
                  </div>
                ) : (
                  <Button className="w-full" onClick={() => router.push("/employee/assessment")}>
                    Start Baseline Assessment
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Learning Plan - Only enabled if both learning style and baseline are completed */}
            {/* 
            <Card className={(!learningStyle || baselineScore === null) ? "opacity-60" : ""}>
              <CardHeader>
                <div className={`w-12 h-12 rounded-lg flex items-center justify-center mb-4 ${
                  (!learningStyle || baselineScore === null) ? "bg-gray-100" : "bg-orange-100"
                }`}>
                  <Clock className={`w-6 h-6 ${
                    (!learningStyle || baselineScore === null) ? "text-gray-400" : "text-orange-600"
                  }`} />
                </div>
                <CardTitle className={(!learningStyle || baselineScore === null) ? "text-gray-500" : ""}>
                  Learning Plan
                </CardTitle>
                <CardDescription className={(!learningStyle || baselineScore === null) ? "text-gray-400" : ""}>
                  View your personalized learning path
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className={`text-sm mb-4 ${
                  (!learningStyle || baselineScore === null) ? "text-gray-400" : "text-gray-500"
                }`}>
                  AI will create a custom learning plan based on your assessment.
                </p>
                {!learningStyle ? (
                  <Button className="w-full" disabled>
                    Complete Learning Style First
                  </Button>
                ) : baselineScore === null ? (
                  <Button className="w-full" disabled>
                    Complete Baseline Assessment First
                  </Button>
                ) : (
                  <Button className="w-full" onClick={() => router.push("/employee/training-plan")}>
                    View Learning Plan
                  </Button>
                )}
              </CardContent>
            </Card>

            {/* Score & Feedback History - Always available */}
            {/* 
            <Card className="">
              <CardHeader>
                <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center mb-4">
                  <BookOpen className="w-6 h-6 text-blue-600" />
                </div>
                <CardTitle>Score & Feedback History</CardTitle>
                <CardDescription>View all your assessment results and AI feedback</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-500 mb-4">
                  See your full history of scores and feedback for all assessments.
                </p>
                <Button className="w-full" onClick={() => router.push("/employee/score-history")}>
                  View Score & Feedback History
                </Button>
              </CardContent>
            </Card>
          </div>
          */}

          {/* Progress Tracker Card (unchanged) */}
          <Card>
            <CardHeader>
              <CardTitle>Track Your Progress</CardTitle>
            {/*  <CardDescription>
                Track your progress<br />
                {/* <span className="text-xs text-gray-400">(Fetched from <b>module_progress</b> table)</span> */}
              {/* </CardDescription> */}
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

function StepCircle({
  step,
  label,
  subtitle,
  completed,
  active,
  onClick,
}: {
  step: number
  label: string
  subtitle: string
  completed?: boolean
  active?: boolean
  onClick?: () => void
}) {
  return (
    <div className="flex flex-col items-center flex-1 px-2">
      <div
        className={`flex items-center justify-center w-20 h-20 rounded-full border-4 mb-3
          ${completed
            ? "bg-green-500 border-green-500"
            : active
            ? "bg-blue-600 border-blue-600"
            : "bg-gray-100 border-gray-300"}
        `}
      >
        {completed ? (
          <svg className="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <span className={`text-2xl font-bold ${active ? "text-white" : "text-gray-400"}`}>{step}</span>
        )}
      </div>
      <div className={`text-lg font-semibold mb-1 ${active ? "text-blue-900" : completed ? "text-green-900" : "text-gray-700"}`}>
        {label}
      </div>
      <div className="text-gray-500 text-sm mb-3 text-center">{subtitle}</div>
      {completed ? (
        <span className="px-4 py-1 rounded-full bg-green-100 text-green-700 text-sm font-medium">Completed</span>
      ) : active ? (
        <button
          className="px-5 py-2 rounded-full bg-blue-600 text-white font-semibold flex items-center gap-2 shadow hover:bg-blue-700 transition"
          onClick={onClick}
        >
          Start <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
        </button>
      ) : null}
    </div>
  )
}
