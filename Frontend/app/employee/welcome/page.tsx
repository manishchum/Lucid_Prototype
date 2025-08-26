"use client"

import { useState, useEffect } from "react"
import ScoreFeedbackCard from "../assessment/score-feedback"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/contexts/auth-context"
import { supabase } from "@/lib/supabase"
import { Users, LogOut, BookOpen, Clock } from "lucide-react"

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
  const router = useRouter()
  // LOG: Initial state
  console.log("[EmployeeWelcome] Initial user:", user)
  console.log("[EmployeeWelcome] Initial moduleProgress:", moduleProgress)

  useEffect(() => {
    console.log("[EmployeeWelcome] useEffect fired. authLoading:", authLoading, "user:", user)
    if (!authLoading) {
      if (!user) {
        console.log("[EmployeeWelcome] No user, redirecting to login.")
        router.push("/employee/login")
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
        .from("employees")
        .select("*")
        .eq("email", user.email)
        .single()

      if (employeeError || !employeeData) {
        console.error("[EmployeeWelcome] Employee fetch error:", employeeError)
        router.push("/employee/login")
        return
      }

      setEmployee(employeeData)
      // LOG: Employee data fetched
      console.log("[EmployeeWelcome] Employee data:", employeeData)

      // Fetch all assessment results for this employee (history)
      const { data: assessments, error: assessmentError } = await supabase
        .from("employee_assessments")
        .select("score, feedback, question_feedback, assessment_id, created_at, assessments(type, questions)")
        .eq("employee_id", employeeData.id)
        .order("created_at", { ascending: false })
      setScoreHistory(assessments || [])
      // LOG: Assessment history fetched
      console.log("[EmployeeWelcome] Assessment history:", assessments)

      // Fetch module progress for this employee, join processed_modules for title
      // LOG: Fetching module_progress for employee_id:", employeeData.id)
      const { data: progressData, error: progressError } = await supabase
        .from("module_progress")
        .select("*, processed_modules(title)")
        .eq("employee_id", employeeData.id)
      if (progressError) {
        console.error("[EmployeeWelcome] module_progress fetch error:", progressError)
      }
      console.log("[EmployeeWelcome] module_progress data:", progressData)
      setModuleProgress(progressData || [])
    } catch (error) {
      console.error("Employee access check failed:", error)
      router.push("/employee/login")
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
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100">
      {/* Header */}
      <div className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center py-4">
            <div className="flex items-center">
              <Users className="w-8 h-8 text-green-600 mr-3" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Employee Portal</h1>
                <p className="text-sm text-gray-600">Welcome to your training dashboard</p>
              </div>
            </div>
            <Button onClick={handleLogout} variant="outline">
              <LogOut className="w-4 h-4 mr-2" />
              Logout
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid gap-8">
          {/* Welcome Card */}
          <Card className="bg-gradient-to-r from-green-500 to-blue-600 text-white">
            <CardHeader>
              <CardTitle className="text-3xl">Welcome, {user?.displayName || employee?.name || user?.email}!</CardTitle>
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

          {/* Coming Soon Cards */}
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
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
                <Button className="w-full" onClick={() => router.push("/employee/score-history") }>
                  View Score & Feedback History
                </Button>
              </CardContent>
            </Card>

            <Card className="">
              <CardHeader>
                <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center mb-4">
                  <Users className="w-6 h-6 text-purple-600" />
                </div>
                <CardTitle>Assessments</CardTitle>
                <CardDescription>Take baseline and module assessments</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-500 mb-4">AI-generated assessments will help track your progress.</p>
                <a href="/employee/assessment">
                  <Button className="w-full">
                    Start Baseline Assessment
                  </Button>
                </a>
              </CardContent>
            </Card>

            <Card className="">
              <CardHeader>
                <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center mb-4">
                  <Clock className="w-6 h-6 text-orange-600" />
                </div>
                <CardTitle>Learning Plan</CardTitle>
                <CardDescription>View your personalized learning path</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-500 mb-4">
                  AI will create a custom learning plan based on your assessment.
                </p>
                <Button className="w-full" onClick={() => router.push("/employee/training-plan") }>
                  View Learning Plan
                </Button>
              </CardContent>
            </Card>
          </div>

          <Button className="mb-6" onClick={() => router.push("/employee/learning-style")}>Check your learning style</Button>

          {/* Progress Tracker Card */}
          <Card>
            <CardHeader>
              <CardTitle>Module Progress Tracker</CardTitle>
              <CardDescription>
                Track your progress for each training module<br />
                {/* <span className="text-xs text-gray-400">(Fetched from <b>module_progress</b> table)</span> */}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {moduleProgress.length === 0 ? (
                  <div className="text-gray-500">No module progress tracked yet.</div>
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
  )
}
