"use client"

import { useState, useEffect } from "react"
import { useAuth } from "@/contexts/auth-context"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Badge } from "@/components/ui/badge"
import EmployeeNavigation from "@/components/employee-navigation"
import { BookOpen, Smile, Meh, Frown, ChevronLeft, ChevronRight, CheckCircle, Star, Target, Lightbulb, Trophy } from "lucide-react"
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
  "I am motivated when learning is connected to people's lives.",
  "I prefer group projects and collaborative discussions.",
  "I often trust my intuition more than data.",
  "I enjoy free-flowing brainstorming sessions.",
  "I find it easy to sense others' feelings in a group.",
  "I value relationships more than rigid rules.",
  "I like using imagination to explore new ideas.",
  "I prefer flexible plans that allow room for change.",
  "I need an emotional connection to stay interested in learning.",
  "I like trying out new methods, even if they fail.",
  "I enjoy solving problems in unconventional ways.",
  "I learn best by experimenting and adjusting as I go.",
  "I dislike strict rules that limit my creativity.",
  "I am energized by competition and challenges.",
  "I like taking risks if there's a chance of high reward.",
  "I get bored doing the same task repeatedly.",
  "I prefer freedom to explore multiple approaches.",
  "I often act quickly and figure things out later.",
  "I am comfortable making decisions with limited information."
]

// Helper function to parse GPT analysis into structured sections
const parseAnalysisIntoSections = (analysis: string) => {
  const sections: { title: string; content: string; icon: any; color: string }[] = []
  
  const lines = analysis.split('\n').filter(line => line.trim())
  let currentSection = { title: '', content: '', icon: Target, color: 'blue' }
  
  for (const line of lines) {
    const trimmed = line.trim()
    
    // Check for section headers (numbered or bulleted)
    if (trimmed.match(/^\d+\.\s*(.+):|^[•·-]\s*(.+):/)) {
      // Save previous section if it has content
      if (currentSection.title && currentSection.content) {
        sections.push({ ...currentSection })
      }
      
      const title = trimmed.replace(/^\d+\.\s*/, '').replace(/^[•·-]\s*/, '').replace(':', '')
      let icon = Target
      let color = 'blue'
      
      if (title.toLowerCase().includes('learning style') || title.toLowerCase().includes('approach')) {
        icon = BookOpen
        color = 'green'
      } else if (title.toLowerCase().includes('thrive') || title.toLowerCase().includes('superpower')) {
        icon = Star
        color = 'yellow'
      } else if (title.toLowerCase().includes('tip') || title.toLowerCase().includes('easier')) {
        icon = Lightbulb
        color = 'orange'
      } else if (title.toLowerCase().includes('strength') || title.toLowerCase().includes('preference')) {
        icon = Trophy
        color = 'purple'
      }
      
      currentSection = { title, content: '', icon, color }
    } else if (trimmed && currentSection.title) {
      // Add content to current section
      currentSection.content += (currentSection.content ? '\n' : '') + trimmed
    } else if (trimmed && !currentSection.title) {
      // First content without a clear header - make it introduction
      if (!sections.length) {
        currentSection = { 
          title: 'Your Learning Profile', 
          content: trimmed, 
          icon: BookOpen, 
          color: 'blue' 
        }
      }
    }
  }
  
  // Add the last section
  if (currentSection.title && currentSection.content) {
    sections.push({ ...currentSection })
  }
  
  return sections
}

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
      if (data.user_id) {
        setEmployeeId(data.user_id)
      } else {
        setEmployeeId(null)
      }
      setLoadingId(false)
    }
    fetchEmployeeId()
  }, [user, authLoading])

  const [surveyFrozen, setSurveyFrozen] = useState(false);

  const handleChange = (idx: number, value: number) => {
    if (submitting || surveyFrozen) return;
    const updated = [...answers]
    updated[idx] = value
    setAnswers(updated)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setSurveyFrozen(true);
    try {
      if (!employeeId) {
        toast({
          title: "Authentication Error",
          description: "Employee ID not found. Please log in again.",
          variant: "destructive",
        })
        setSubmitting(false)
        setSurveyFrozen(false);
        return
      }
      const res = await fetch("/api/learning-style", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: employeeId, answers })
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
        setSurveyFrozen(false);
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
      setSurveyFrozen(false);
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
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100">
        <EmployeeNavigation showForward={false} />
        
        {/* Main content area that adapts to sidebar */}
        <div 
          className="transition-all duration-300 ease-in-out py-10"
          style={{ 
            marginLeft: 'var(--sidebar-width, 0px)',
          }}
        >
          <div className="max-w-4xl mx-auto px-4 flex flex-col items-center">
        <BookOpen className="w-20 h-20 text-blue-500 mb-4" />
        <h1 className="text-3xl font-bold mb-6">Learning Style Survey</h1>
        
        <div className="text-left max-w-4xl space-y-6">
          {/* Purpose Section */}
          <Card className="bg-blue-50 border-blue-200">
            <CardHeader>
              <CardTitle className="flex items-center text-blue-800">
                {/* <Target className="w-6 h-6 mr-2" /> */}
                Purpose
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-blue-700">
                This survey is designed to identify your <strong> learning style</strong>. Understanding how you naturally learn and process information helps us personalize your learning journey so that  you can learn more effectively and the way you are meant to learn

              </p>
            </CardContent>
          </Card>

          {/* What It Measures Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center text-gray-800">
                {/* <BookOpen className="w-6 h-6 mr-2" /> */}
                What It Measures
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-gray-700 mb-4">Survey identifies your learning preferences into  <strong>four main styles</strong>:</p>
              <div className="grid md:grid-cols-2 gap-4">
                <div className="bg-green-50 p-4 rounded-lg border-l-4 border-green-400">
                  <h3 className="font-bold text-green-800 mb-2">Concrete Sequential (CS): The Planner</h3>
                  <ul className="text-green-700 text-sm space-y-1">
                    <li>Key Traits: Organized, methodical, reliable, disciplined, precise.</li>
                    <li>• Prefers clear instructions, step-by-step learning, structured environment</li>
                    <li>• Learns best with order, rules, and hands-on practice</li>
                  </ul>
                </div>
                <div className="bg-blue-50 p-4 rounded-lg border-l-4 border-blue-400">
                  <h3 className="font-bold text-blue-800 mb-2">Abstract Sequential (AS): The Analyst
</h3>
                  <ul className="text-blue-700 text-sm space-y-1">
                    <li>Key Traits: Rational, critical, objective, systematic, inquisitive.</li>
                    <li>• Prefers logical reasoning, analysis, reading and structured information</li>
                    <li>• Learns best with data, facts, and organized content</li>
                  </ul>
                </div>
                <div className="bg-orange-50 p-4 rounded-lg border-l-4 border-orange-400">
                  <h3 className="font-bold text-orange-800 mb-2">Concrete Random (CR): The Explorer</h3>
                  <ul className="text-orange-700 text-sm space-y-1">
                    <li>Key Traits: Adventurous, inventive, bold, energetic, resourceful.</li>
                    <li>• Prefers experimentation, innovation and "Learning by doing"</li>
                    <li>• Learns best with freedom to explore and test ideas</li>
                  </ul>
                </div>
                <div className="bg-purple-50 p-4 rounded-lg border-l-4 border-purple-400">
                  <h3 className="font-bold text-purple-800 mb-2">Abstract Random (AR): The Connector</h3>
                  <ul className="text-purple-700 text-sm space-y-1">
                    <li>Key Traits: Compassionate, imaginative, sensitive, flexible, expressive.</li>
                    <li>• Prefers stories, feelings, collaboration, and big-picture context.</li>
                    <li>• Learns best through discussions, group work, and creative exploration.</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* How to Take the Survey Section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center text-gray-800">
                {/* <CheckCircle className="w-6 h-6 mr-2" /> */}
                How to Take the Survey
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="text-gray-700 space-y-3">
                <li className="grid grid-cols-[min-content,1fr] gap-x-3 items-start">
                  <span className="bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">
                    1
                  </span>
                  <span>
                    You'll be presented with <strong>statements or scenarios</strong> about
                    how you prefer to learn and solve problems.
                  </span>
                </li>

                <li className="grid grid-cols-[min-content,1fr] gap-x-3 items-start">
                  <span className="bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">
                    2
                  </span>
                  <span>
                    <strong>Read each statement carefully</strong> and select the response
                    that best reflects your natural tendency.
                  </span>
                </li>

                <li className="grid grid-cols-[min-content,1fr] gap-x-3 items-start">
                  <span className="bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">
                    3
                  </span>
                  <span>
                    <strong>Be honest and instinctive</strong> — there are no right or
                    wrong answers. This isn't a test; it's a tool to understand you better.
                  </span>
                </li>

                <li className="grid grid-cols-[min-content,1fr] gap-x-3 items-start">
                  <span className="bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">
                    4
                  </span>
                  <span>
                    The survey usually takes <strong>5–10 minutes</strong> to complete.
                  </span>
                </li>

                <li className="grid grid-cols-[min-content,1fr] gap-x-3 items-start">
                  <span className="bg-blue-500 text-white rounded-full w-6 h-6 flex items-center justify-center text-sm">
                    5
                  </span>
                  <span>
                    For each statement, rate your preference on a scale of <strong>1 to 5 </strong> — where <strong>1 means least preferred</strong> and <strong>5 means most preferred.</strong>
                  </span>
                </li>
              </ul>
            </CardContent>
          </Card>
        </div>
        
        <Button className="mt-8 px-8 py-3 text-lg" onClick={() => setPage('survey')}>Start Survey</Button>
        </div>
      </div>
    </div>
    )
  }

  // Summary page
  if (page === 'summary' && learningStyleResult) {
    const sections = parseAnalysisIntoSections(learningStyleResult.gptAnalysis || learningStyleResult.description)
  const FeaturedIcon = sections[0]?.icon
    
    return (
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100">
        <EmployeeNavigation showForward={false} />
        
        {/* Main content area that adapts to sidebar */}
        <div 
          className="transition-all duration-300 ease-in-out py-10"
          style={{ 
            marginLeft: 'var(--sidebar-width, 0px)',
          }}
        >
          <div className="max-w-4xl mx-auto px-4">
        
        {/* Header Section */}
        <div className="text-center mb-8">
          {/* <CheckCircle className="w-20 h-20 text-green-500 mx-auto mb-4" /> */}
          <h1 className="text-3xl font-bold mb-2">Survey Complete!</h1>
          <div className="inline-flex items-center bg-gradient-to-r from-blue-500 to-purple-600 text-white px-6 py-3 rounded-full text-xl font-semibold mb-4">
            <Star className="w-6 h-6 mr-2" />
            {learningStyleResult.label}
          </div>
        </div>

        {/* Learning Style Overview Card */}
        <Card className="mb-6 bg-gradient-to-br from-blue-50 to-indigo-100 border-blue-200">
          <CardHeader>
            <CardTitle className="flex items-center text-2xl text-blue-800">
              {/* <BookOpen className="w-8 h-8 mr-3" /> */}
              Your Learning Style
            </CardTitle>
            <CardDescription className="text-blue-600 text-lg">
              {learningStyleResult.description}
            </CardDescription>
          </CardHeader>
        </Card>

        {/* Detailed Analysis Sections */}
        {sections.length > 0 ? (
          <div className="space-y-6">
            <h2 className="text-2xl font-bold text-center mb-6">Your Personalized Learning Insights</h2>
            
            {/* First section as a featured card */}
            {sections[0] && FeaturedIcon && (
              <Card className="bg-gradient-to-r from-green-50 to-emerald-100 border-green-200">
                <CardHeader>
                  <CardTitle className="flex items-center text-green-800">
                    {/* <FeaturedIcon className="w-6 h-6 mr-3" /> */}
                    {sections[0].title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-green-700 whitespace-pre-line leading-relaxed">
                    {sections[0].content}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Remaining sections as accordion */}
            {sections.length > 1 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    {/* <Lightbulb className="w-6 h-6 mr-3 text-orange-500" /> */}
                    Detailed Insights & Recommendations
                  </CardTitle>
                  <CardDescription>
                    Expand each section to learn more about your learning preferences and get actionable tips.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Accordion type="single" collapsible className="space-y-2">
                    {sections.slice(1).map((section, index) => {
                      const ItemIcon = section.icon
                      return (
                        <AccordionItem key={index} value={`item-${index}`} className="border rounded-lg px-4">
                          <AccordionTrigger className="hover:no-underline">
                            <div className="flex items-center">
                              {/* {ItemIcon && <ItemIcon className="w-5 h-5 mr-3 text-gray-600" />} */}
                              <span className="font-semibold text-left">{section.title}</span>
                            </div>
                          </AccordionTrigger>
                          <AccordionContent className="pb-4">
                            <div className={`p-4 rounded-lg border-l-4 ${
                              section.color === 'green' ? 'bg-green-50 border-green-400' :
                              section.color === 'yellow' ? 'bg-yellow-50 border-yellow-400' :
                              section.color === 'orange' ? 'bg-orange-50 border-orange-400' :
                              section.color === 'purple' ? 'bg-purple-50 border-purple-400' :
                              'bg-blue-50 border-blue-400'
                            }`}>
                              <p className="whitespace-pre-line leading-relaxed text-gray-700">
                                {section.content}
                              </p>
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      )
                    })}
                  </Accordion>
                </CardContent>
              </Card>
            )}
          </div>
        ) : (
          // Fallback for unstructured analysis
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center">
                <Target className="w-6 h-6 mr-3 text-blue-500" />
                Your Learning Analysis
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="bg-blue-50 p-6 rounded-lg border-l-4 border-blue-400">
                <p className="text-gray-700 whitespace-pre-line leading-relaxed">
                  {learningStyleResult.gptAnalysis || learningStyleResult.description}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Action Button */}
        <div className="text-center mt-8">
          <Button 
            className="px-8 py-3 text-lg bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700" 
            onClick={() => router.push('/employee/welcome')}
          >
            Go to Dashboard
          </Button>
        </div>
        </div>
      </div>
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
      <div className="min-h-screen bg-gradient-to-br from-green-50 to-blue-100">
        <EmployeeNavigation showForward={false} />
        {/* Main content area that adapts to sidebar */}
        <div 
          className="transition-all duration-300 ease-in-out py-10"
          style={{ marginLeft: 'var(--sidebar-width, 0px)' }}
        >
          <div className="max-w-2xl mx-auto px-4 flex flex-col items-center">
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
         {/* Global scale instruction */}
         <div className="w-full flex justify-center mb-4">
           <div className="bg-blue-50 border border-blue-100 rounded px-4 py-2 text-xs text-gray-500 italic">
             Use the scale: 1 = least preferred, 5 = most preferred
           </div>
         </div>
         <form onSubmit={handleSubmit} className="w-full">
           {questions.slice(startIdx, endIdx).map((q, idx) => (
             <div key={startIdx + idx} className="bg-white rounded-xl shadow p-6 flex flex-col items-center mb-6">
               <label className="font-bold text-lg mb-4 text-center">{q}</label>
               <div className="flex gap-3 mt-2">
                 {[1,2,3,4,5].map(val => (
                   <button
                     type="button"
                     key={val}
                     className={`w-12 h-12 rounded-full border-2 flex flex-col items-center justify-center text-lg font-bold transition-all duration-200
                       ${answers[startIdx + idx] === val ? "bg-blue-600 text-white border-blue-600 scale-110" : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-blue-100"}`}
                     onClick={() => handleChange(startIdx + idx, val)}
                     aria-label={`Rate ${val}`}
                     disabled={submitting || surveyFrozen}
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
              disabled={surveyPage === 0 || submitting || surveyFrozen}
              onClick={() => setSurveyPage(surveyPage - 1)}
            >
              <ChevronLeft className="w-4 h-4 mr-1" /> Previous
            </Button>
            {surveyPage === totalPages - 1 ? (
              <Button
                type="submit"
                className="px-8"
                disabled={submitting || !allAnswered || surveyFrozen}
              >
                {submitting ? "Submitting..." : "Submit Survey"}
              </Button>
            ) : (
              <Button
                type="button"
                className="px-8"
                disabled={answers.slice(startIdx, endIdx).some(a => a === null) || submitting || surveyFrozen}
                onClick={() => setSurveyPage(surveyPage + 1)}
              >
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </Button>
            )}
          </div>
        </form>
          </div>
        </div>
      </div>
    )
  }
}