"use client"

import { useState, useEffect } from "react"
import { useAuth } from "@/contexts/auth-context"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import EmployeeNavigation from "@/components/employee-navigation"

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
  const [answers, setAnswers] = useState(Array(questions.length).fill(3)) // Default to neutral
  const [submitting, setSubmitting] = useState(false)
  const [employeeId, setEmployeeId] = useState<string | null>(null)
  const [loadingId, setLoadingId] = useState(true)
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()

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
        alert("Employee ID not found. Please log in again.")
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
        alert(data.error || "Failed to submit survey. Please try again.")
      } else {
        router.push("/employee/welcome")
      }
    } catch (err) {
      alert("Failed to submit survey. Please try again.")
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading || loadingId) {
    return <div className="max-w-3xl mx-auto py-10 px-4 text-center">Loading...</div>
  }
  return (
    <div className="max-w-3xl mx-auto py-10 px-4">
      {/* Navigation */}
      <EmployeeNavigation showForward={false} />
      
      <h1 className="text-2xl font-bold mb-6">Learning Style Survey</h1>
      <form onSubmit={handleSubmit}>
        <div className="space-y-6">
          {questions.map((q, idx) => (
            <div key={idx} className="flex flex-col gap-2">
              <label className="font-medium">{idx + 1}. {q}</label>
              <div className="flex gap-2">
                {[1,2,3,4,5].map(val => (
                  <button
                    type="button"
                    key={val}
                    className={`px-3 py-1 rounded border ${answers[idx] === val ? "bg-blue-600 text-white" : "bg-gray-100"}`}
                    onClick={() => handleChange(idx, val)}
                  >{val}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <Button type="submit" className="mt-8 w-full" disabled={submitting}>
          {submitting ? "Submitting..." : "Submit Survey"}
        </Button>
      </form>
    </div>
  )
}
