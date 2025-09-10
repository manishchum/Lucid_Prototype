"use client"

import { useState, useEffect } from "react"
import { useAuth } from "@/contexts/auth-context"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import EmployeeNavigation from "@/components/employee-navigation"
import { BookOpen, Smile, Meh, Frown, ChevronLeft, ChevronRight, CheckCircle } from "lucide-react"
import { useToast } from "@/hooks/use-toast"

const questions = [
  "I like having written directions before starting a task.",
  "I prefer to follow a schedule rather than improvise.",
  "I feel most comfortable when rules are clear.",
  "I focus on details before seeing the big picture.",
  "I rely on tried-and-tested methods to get things done.",
  "I need to finish one task before moving to the next.",
  "I learn best by practicing exact procedures.",
  "I find comfort in structure, order, and neatness.",
  "I like working with checklists and measurable steps.",
  "I feel uneasy when things are left open-ended.",
  "I enjoy reading and researching before making decisions.",
  "I like breaking down problems into smaller parts.",
  "I prefer arguments backed by evidence and facts.",
  "I think logically through situations before acting.",
  "I enjoy analyzing patterns, models, and systems.",
  "I often reflect deeply before I share my opinion.",
  "I value accuracy and logical consistency.",
  "I prefer theories and principles to practical examples.",
  "I like well-reasoned debates and discussions.",
  "I enjoy working independently on complex problems.",
  "I learn best through stories or real-life experiences.",
  "I am motivated when learning is connected to people’s lives.",
  "I prefer group projects and collaborative discussions.",
  "I often trust my intuition more than data.",
  "I enjoy free-flowing brainstorming sessions.",
  "I find it easy to sense others’ feelings in a group.",
  "I value relationships more than rigid rules.",
  "I like using imagination to explore new ideas.",
  "I prefer flexible plans that allow room for change.",
  "I need an emotional connection to stay interested in learning.",
  "I like trying out new methods, even if they fail.",
  "I enjoy solving problems in unconventional ways.",
  "I learn best by experimenting and adjusting as I go.",
  "I dislike strict rules that limit my creativity.",
  "I am energized by competition and challenges.",
  "I like taking risks if there’s a chance of high reward.",
  "I get bored doing the same task repeatedly.",
  "I prefer freedom to explore multiple approaches.",
  "I often act quickly and figure things out later.",
  "I am comfortable making decisions with limited information."
]

export default function LearningStyleSurvey() {
  const [answers, setAnswers] = useState(Array(questions.length).fill(null)) // Default to unanswered
  const [submitting, setSubmitting] = useState(false)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState(true)
  const [page, setPage] = useState<'intro'|'survey'|'summary'>('intro')
  const [surveyPage, setSurveyPage] = useState(0); // 0-based page index for question sets
  const [learningStyleResult, setLearningStyleResult] = useState<{ 
    code: string, 
    label: string, 
    description: string,
    gptAnalysis?: string 
  } | null>(null)
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const { toast } = useToast()

  useEffect(() => {
    async function fetchEmployeeId() {
      if (authLoading || !user?.email) return
      // Fetch employee_id from Supabase using user email
      const res = await fetch(`/api/get-employee-id?email=${encodeURIComponent(user.email)}`)
      const data = await res.json()
      if (data.employee_id) {
        setEmployeeId(data.employee_id)
      } else {
        setEmployeeId(null)
      }
      setLoadingId(false)
    }
    fetchEmployeeId()
  }, [user, authLoading])

  const handleChange = (idx: number, value: number) => {
    const updated = [...answers]
    updated[idx] = value
    setAnswers(updated)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    try {
      if (!employeeId) {
        toast({
          title: "Authentication Error",
          description: "Employee ID not found. Please log in again.",
          variant: "destructive",
        })
        setSubmitting(false)
        return
      }
      const res = await fetch("/api/learning-style", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employee_id: employeeId, answers })
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 403 && data.error?.includes("already submitted")) {
          toast({
            title: "Survey Already Completed",
            description: "You have already submitted your learning style survey. Your results are saved in your profile.",
            variant: "destructive",
          })
        } else {
          toast({
            title: "Submission Failed",
            description: data.error || "Failed to submit survey. Please try again.",
            variant: "destructive",
          })
        }
      } else {
        // Parse GPT result from backend response
        const gptResult = data.gpt || {}
        const learningStyleMap = {
          'CS': { code: 'CS', label: 'Concrete Sequential', description: 'The Organizer - Prefers structure, clear steps, and hands-on practice.' },
          'AS': { code: 'AS', label: 'Abstract Sequential', description: 'The Thinker - Learns through analysis, intellectual exploration, and theoretical models.' },
          'AR': { code: 'AR', label: 'Abstract Random', description: 'The Connector - Learns through reflection, emotional connection, and group harmony.' },
          'CR': { code: 'CR', label: 'Concrete Random', description: 'The Innovator - Learns through experimentation, intuition, and discovery.' }
        }
        
        const dominantStyle = gptResult.dominant_style || 'CS'
        const styleInfo = learningStyleMap[dominantStyle as keyof typeof learningStyleMap] || learningStyleMap.CS
        
        setLearningStyleResult({
          ...styleInfo,
          gptAnalysis: gptResult.report || styleInfo.description
        })
        setPage('summary')
      }
    } catch (err) {
      toast({
        title: "Network Error",
        description: "Failed to submit survey. Please check your connection and try again.",
        variant: "destructive",
      })
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading || loadingId) {
    return <div className="max-w-3xl mx-auto py-10 px-4 text-center">Loading...</div>
  }

  // Intro page
  if (page === 'intro') {
    return (
      <div className="max-w-2xl mx-auto py-10 px-4 flex flex-col items-center">
        <EmployeeNavigation showForward={false} />
        <BookOpen className="w-20 h-20 text-blue-500 mb-4" />
        <h1 className="text-3xl font-bold mb-4">Learning Style Survey</h1>
        <p className="text-lg text-gray-700 mb-6 text-center">
          This quick survey helps us understand your learning preferences so we can personalize your training plan. Answer honestly—there are no right or wrong answers!
        </p>
        <Button className="mt-2 px-8 py-3 text-lg" onClick={() => setPage('survey')}>Start Survey</Button>
      </div>
    )
  }

  // Summary page
  if (page === 'summary' && learningStyleResult) {
    return (
      <div className="max-w-2xl mx-auto py-10 px-4 flex flex-col items-center">
        <CheckCircle className="w-20 h-20 text-green-500 mb-4" />
        <h1 className="text-3xl font-bold mb-2">Survey Complete!</h1>
        <div className="flex flex-col items-center mb-6">
          <span className="text-2xl font-semibold text-blue-700">{learningStyleResult.label}</span>
          <div className="bg-white rounded-lg p-6 mt-4 shadow-sm border max-w-xl">
            <h3 className="font-semibold text-lg mb-3">Your Learning Style Analysis</h3>
            <div className="text-gray-700 whitespace-pre-line">
              {learningStyleResult.gptAnalysis || learningStyleResult.description}
            </div>
          </div>
        </div>
        <Button className="px-8 py-3 text-lg" onClick={() => router.push('/employee/welcome')}>Go to Dashboard</Button>
      </div>
    )
  }

  // Survey page (one question at a time)
  // Survey page (10 questions per page)
  const QUESTIONS_PER_PAGE = 10;
  const totalPages = Math.ceil(questions.length / QUESTIONS_PER_PAGE);
  const startIdx = surveyPage * QUESTIONS_PER_PAGE;
  const endIdx = Math.min(startIdx + QUESTIONS_PER_PAGE, questions.length);
  const allAnswered = answers.every(a => a !== null);

  if (page === 'survey') {
    return (
      <div className="max-w-2xl mx-auto py-10 px-4 flex flex-col items-center">
        <EmployeeNavigation showForward={false} />
        {/* Progress Bar */}
        <div className="w-full mb-8">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">Questions {startIdx + 1} - {endIdx} of {questions.length}</span>
            <span className="text-sm text-gray-600">{Math.round((answers.filter(a => a !== null).length / questions.length) * 100)}% complete</span>
          </div>
          <div className="w-full h-2 bg-gray-200 rounded-full">
            <div className="h-2 bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${(answers.filter(a => a !== null).length / questions.length) * 100}%` }}></div>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="w-full">
          {questions.slice(startIdx, endIdx).map((q, idx) => (
            <div key={startIdx + idx} className="bg-white rounded-xl shadow p-6 flex flex-col items-center mb-6">
              <label className="font-bold text-lg mb-4 text-center">{startIdx + idx + 1}. {q}</label>
              <div className="flex gap-3 mt-2">
                {[1,2,3,4,5].map(val => (
                  <button
                    type="button"
                    key={val}
                    className={`w-12 h-12 rounded-full border-2 flex flex-col items-center justify-center text-lg font-bold transition-all duration-200
                      ${answers[startIdx + idx] === val ? "bg-blue-600 text-white border-blue-600 scale-110" : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-blue-100"}`}
                    onClick={() => handleChange(startIdx + idx, val)}
                    aria-label={`Rate ${val}`}
                  >
                    <span>{val}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div className="flex justify-between items-center w-full">
            <Button
              type="button"
              variant="outline"
              className="px-6"
              disabled={surveyPage === 0}
              onClick={() => setSurveyPage(surveyPage - 1)}
            >
              <ChevronLeft className="w-4 h-4 mr-1" /> Previous
            </Button>
            {surveyPage === totalPages - 1 ? (
              <Button
                type="submit"
                className="px-8"
                disabled={submitting || !allAnswered}
              >
                {submitting ? "Submitting..." : "Submit Survey"}
              </Button>
            ) : (
              <Button
                type="button"
                className="px-8"
                disabled={answers.slice(startIdx, endIdx).some(a => a === null)}
                onClick={() => setSurveyPage(surveyPage + 1)}
              >
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </div>
        </form>
      </div>
    )
  }
}
