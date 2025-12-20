"use client"

import { useState, useEffect } from "react"
import { useAuth } from "@/contexts/auth-context"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import EmployeeNavigation from "@/components/employee-navigation"
import { BookOpen, Smile, Meh, Frown, ChevronLeft, ChevronRight, CheckCircle, Star, Target, Lightbulb, Trophy, ChevronDown } from "lucide-react"
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

// Extract ONLY the report text from JSON response - ignore everything else before JSON
const extractReportFromJson = (analysis: string) => {
  if (!analysis) return ''
  
  // Remove all markdown code blocks and JSON artifacts
  let cleaned = analysis.replace(/```json[\s\S]*?```/g, '')  // Remove ```json...``` blocks
  cleaned = cleaned.replace(/```[\s\S]*?```/g, '')  // Remove any other ``` blocks
  cleaned = cleaned.replace(/^\s*[{}]\s*$/gm, '')  // Remove standalone { or }
  cleaned = cleaned.replace(/^\s*\*\*[\s\S]*?\*\*\s*$/gm, '') // Remove markdown bold markers
  
  // Extract "Here is your personalized learning style report:" section if it exists
  const reportStart = cleaned.indexOf('Here is your personalized learning style report:')
  if (reportStart !== -1) {
    const reportText = cleaned.substring(reportStart + 'Here is your personalized learning style report:'.length)
    return reportText.trim()
  }
  
  // If no explicit marker, return the cleaned text (it's likely already the report)
  return cleaned.trim()
}

// Helper function to parse report text into 3 main tab sections
const parseReportIntoTabs = (reportText: string) => {
  const tabs: { id: string; title: string; icon: any; color: string; content: string; subsections: { subtitle: string; items: string[] }[] }[] = []
  
  if (!reportText) return tabs
  
  // Remove "Title:" and the title line
  reportText = reportText.replace(/^Title:\s*Your Personal Learning Style Insights\s*\n\n/i, '')
  reportText = reportText.replace(/^Here is your personalized learning style report:\s*\n\n/i, '')
  
  const lines = reportText.split('\n').map(l => l.trim()).filter(l => {
    // Skip empty lines, dividers, JSON brackets, markdown code blocks, markdown bold markers
    if (!l) return false
    if (l.match(/^[-=•·]+$/)) return false
    if (l === '{' || l === '}' || l === '```' || l.startsWith('```json')) return false
    if (l.match(/^\*\*.+\*\*$/)) return false
    // Skip score/calculation lines (contain "Score", "Points", "Preference", "Calculating", "Identifying")
    if (l.match(/Score:|Points|Preference|Calculating|Identifying|Secondary|Dominant/i)) return false
    return true
  })
  
  let currentTab: any = null
  let currentSubsection: any = null
  
  for (const line of lines) {
    // Main section headers: numbered (e.g., "1. Your Natural Learning Style:") OR plain headers
    const mainHeaderMatch = line.match(/^(?:\d+\.\s*)?(.+?):\s*$/)
    const isMainHeader = mainHeaderMatch && (
      mainHeaderMatch[1].toLowerCase().includes('natural learning') ||
      mainHeaderMatch[1].toLowerCase().includes('how you thrive') ||
      mainHeaderMatch[1].toLowerCase().includes('tips to make') ||
      mainHeaderMatch[1].toLowerCase().includes('tips to learn')
    )
    
    if (isMainHeader && mainHeaderMatch) {
      // Save previous tab
      if (currentTab) {
        tabs.push(currentTab)
      }
      
      const title = mainHeaderMatch[1]
      let icon = BookOpen
      let color = 'green'
      let id = 'natural'
      
      if (title.toLowerCase().includes('natural learning')) {
        icon = BookOpen
        color = 'green'
        id = 'natural'
      } else if (title.toLowerCase().includes('how you thrive')) {
        icon = Star
        color = 'purple'
        id = 'thrive'
      } else if (title.toLowerCase().includes('tips')) {
        icon = Lightbulb
        color = 'blue'
        id = 'tips'
      }
      
      currentTab = { id, title, icon, color, content: '', subsections: [] }
      currentSubsection = null
      continue
    }
    
    // Subsection headers: lines that end with : but don't start with bullet
    const subHeaderMatch = line.match(/^(?![•*\-·])(.+?):\s*$/)
    if (subHeaderMatch && currentTab && !line.match(/^\d+\./)) {
      const subtitle = subHeaderMatch[1].trim()
      if (subtitle && subtitle.length < 100) {
        currentSubsection = { subtitle, items: [] }
        currentTab.subsections.push(currentSubsection)
        continue
      }
    }
    
    // Lines starting with bullets or asterisks (both * and •)
    const bulletMatch = line.match(/^[•*\-·]\s*(.+)$/)
    if (bulletMatch) {
      const item = bulletMatch[1].trim().replace(/^[*\-·•]+\s*/, '')
      if (item && item.length > 0) {
        // Initialize default tab if bullets appear before any section header
        if (!currentTab) {
          currentTab = { id: 'natural', title: 'Your Natural Learning Style', icon: BookOpen, color: 'green', content: '', subsections: [] }
        }
        if (!currentSubsection) {
          currentSubsection = { subtitle: 'Tips', items: [] }
          currentTab.subsections.push(currentSubsection)
        }
        currentSubsection.items.push(item)
      }
    } else if (line && currentTab && !line.match(/^\d+\./)) {
      // Non-bullet content
      if (!line.includes(':')) {
        currentTab.content += (currentTab.content ? '\n' : '') + line
      }
    }
  }
  
  // Add the last tab
  if (currentTab) {
    tabs.push(currentTab)
  }
  
  return tabs
}

// Helper to safely parse the structured JSON report produced by the new prompt
const parseStructuredReport = (analysis?: string) => {
  if (!analysis) return null
  try {
    const parsed = JSON.parse(analysis)
    // Basic shape guard
    if (!parsed || typeof parsed !== 'object' || !parsed.scores || !parsed.style_meta) return null
    return parsed as {
      scores: { CS: number; AS: number; AR: number; CR: number }
      style_meta: { code: string; name: string; persona: string; tagline: string; strength: string }
      thrive: string[]
      strengths: string[]
      watchouts: string[]
      strategies: string[]
      content_formats: string[]
      collaboration: string[]
      quick_actions: string[]
      recommended_tags: string[]
      report_intro: string
    }
  } catch (e) {
    return null
  }
}

// Pull score metadata from mixed GPT outputs (even when wrapped in extra prose)
const extractScoreData = (analysis?: string) => {
  if (!analysis) return null
  const candidates: string[] = []

  const fenced = analysis.match(/```json\s*([\s\S]*?)```/i)
  if (fenced?.[1]) candidates.push(fenced[1])

  const inline = analysis.match(/\{[\s\S]*?"scores"[\s\S]*?\}/)
  if (inline?.[0]) candidates.push(inline[0])

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate)
      if (parsed?.scores && typeof parsed.scores === 'object') {
        return {
          scores: parsed.scores as Record<string, number>,
          dominant: parsed.dominant_style as string | undefined,
          secondary: parsed.secondary_style as string | undefined
        }
      }
    } catch (err) {
      continue
    }
  }
  return null
}

// Map learning codes to palette and microcopy for cards
const learningStylePalette = {
  CS: {
    label: 'Concrete Sequential',
    description: 'Prefers structure, clear steps, and hands-on practice.',
    gradient: 'from-sky-50 to-blue-100',
    text: 'text-blue-900',
    border: 'border-blue-200'
  },
  AS: {
    label: 'Abstract Sequential',
    description: 'Thinks analytically with models, patterns, and depth.',
    gradient: 'from-slate-50 to-indigo-100',
    text: 'text-indigo-900',
    border: 'border-indigo-200'
  },
  AR: {
    label: 'Abstract Random',
    description: 'Connects through reflection, people, and meaning.',
    gradient: 'from-rose-50 to-orange-100',
    text: 'text-rose-900',
    border: 'border-rose-200'
  },
  CR: {
    label: 'Concrete Random',
    description: 'Experiments boldly and learns by doing and iterating.',
    gradient: 'from-emerald-50 to-lime-100',
    text: 'text-emerald-900',
    border: 'border-emerald-200'
  }
} as const

const preferenceTone = (score: number) => {
  if (score >= 16) return { label: 'Very High', badge: 'bg-emerald-100 text-emerald-800 border border-emerald-200' }
  if (score >= 13) return { label: 'High', badge: 'bg-green-100 text-green-800 border border-green-200' }
  if (score >= 9) return { label: 'Moderate', badge: 'bg-amber-100 text-amber-800 border border-amber-200' }
  return { label: 'Low', badge: 'bg-rose-100 text-rose-800 border border-rose-200' }
}

type AccordionSection = {
  id: string
  title: string
  accent: string
  paragraphs: string[]
  bullets?: string[]
  subsections: { subtitle: string; items: string[] }[]
}

// Build accordion sections — mirrors score-history exactly, no structured JSON parsing
const buildAccordionSections = (reportText: string, fallbackDescription: string): AccordionSection[] => {
  const sections: AccordionSection[] = [
    { id: 'natural', title: 'Your Natural Learning Style', accent: 'from-blue-50 to-blue-100 border-blue-200', paragraphs: [], subsections: [] },
    { id: 'thrive', title: 'How You Thrive', accent: 'from-purple-50 to-purple-100 border-purple-200', paragraphs: [], subsections: [] },
    { id: 'tips', title: 'Tips to Make Learning Easier', accent: 'from-green-50 to-emerald-100 border-emerald-200', paragraphs: [], subsections: [] }
  ]

  const tabs = parseReportIntoTabs(reportText)
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
  const [openSections, setOpenSections] = useState<string[]>([])
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
        
        // Check if user already has learning style data
        const styleRes = await fetch(`/api/learning-style?user_id=${data.user_id}`)
        const styleData = await styleRes.json()
        if (styleData.success && styleData.data?.gpt_analysis && styleData.data?.learning_style) {
          const learningStyleMap = {
            'CS': { code: 'CS', label: 'The Planner', description: 'The Planner - Prefers structure, clear steps, and hands-on practice.' },
            'AS': { code: 'AS', label: 'The Analyst', description: 'The Analyst - Learns through analysis, intellectual exploration, and theoretical models.' },
            'AR': { code: 'AR', label: 'The Connector', description: 'The Connector - Learns through reflection, emotional connection, and group harmony.' },
            'CR': { code: 'CR', label: 'The Explorer', description: 'The Explorer - Learns through experimentation, intuition, and discovery.' }
          }
          const styleInfo = learningStyleMap[styleData.data.learning_style as keyof typeof learningStyleMap] || learningStyleMap.CS
          setLearningStyleResult({
            ...styleInfo,
            gptAnalysis: styleData.data.gpt_analysis
          })
          setPage('summary')
        }
      } else {
        setEmployeeId(null)
      }
      setLoadingId(false)
    }
    fetchEmployeeId()
  }, [user, authLoading])

  const [surveyFrozen, setSurveyFrozen] = useState(false);

  // Scroll to top whenever survey page changes
  useEffect(() => {
    if (page === 'survey') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [surveyPage, page]);

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
          'CS': { code: 'CS', label: 'Concrete Sequential', description: 'The Planner - Prefers structure, clear steps, and hands-on practice.' },
          'AS': { code: 'AS', label: 'Abstract Sequential', description: 'The Analyst - Learns through analysis, intellectual exploration, and theoretical models.' },
          'AR': { code: 'AR', label: 'Abstract Random', description: 'The Connector - Learns through reflection, emotional connection, and group harmony.' },
          'CR': { code: 'CR', label: 'Concrete Random', description: 'The Explorer - Learns through experimentation, intuition, and discovery.' }
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
              <p className="text-gray-700 mb-4">Before you start, here’s how this 5‑minute survey improves your learning experience.</p>
              <div className="grid md:grid-cols-2 gap-4">
                {/* Why Take This Survey */}
                <div className="bg-green-50 p-4 rounded-lg border-l-4 border-green-400">
                  <h3 className="font-bold text-green-800 mb-2">Why Take This Survey</h3>
                  <ul className="text-green-700 text-sm space-y-1 list-disc pl-4">
                    <li>Tailors modules to how you naturally work.</li>
                    <li>Improves speed‑to‑skill and retention.</li>
                    <li>Removes generic content that doesn’t fit you.</li>
                    <li>Reduces time spent on what you already know.</li>
                  </ul>
                </div>

                {/* What You’ll Get */}
                <div className="bg-blue-50 p-4 rounded-lg border-l-4 border-blue-400">
                  <h3 className="font-bold text-blue-800 mb-2">What You’ll Get</h3>
                  <ul className="text-blue-700 text-sm space-y-1 list-disc pl-4">
                    <li>Personalized module order and difficulty.</li>
                    <li>Examples and practice that match your style.</li>
                    <li>Focused feedback and quick wins.</li>
                    <li>A clear roadmap that updates as you learn.</li>
                  </ul>
                </div>

                {/* How It Works */}
                <div className="bg-orange-50 p-4 rounded-lg border-l-4 border-orange-400">
                  <h3 className="font-bold text-orange-800 mb-2">How It Works</h3>
                  <ul className="text-orange-700 text-sm space-y-1 list-disc pl-4">
                    <li>Answer quick, scenario‑based questions.</li>
                    <li>We generate your learning profile instantly.</li>
                    <li>Your dashboard and plan adapt immediately.</li>
                    <li>Modules, sequence, pacing, and nudges adjust.</li>
                  </ul>
                </div>

                {/* Tips For Best Results */}
                <div className="bg-purple-50 p-4 rounded-lg border-l-4 border-purple-400">
                  <h3 className="font-bold text-purple-800 mb-2">Tips For Best Results</h3>
                  <ul className="text-purple-700 text-sm space-y-1 list-disc pl-4">
                    <li>Think about a typical workday—answer instinctively.</li>
                    <li>No right or wrong answers; be honest.</li>
                    <li>Avoid overthinking; complete in one sitting.</li>
                    <li>You can retake later if your role changes.</li>
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
    const rawAnalysis = learningStyleResult.gptAnalysis || learningStyleResult.description
    const reportText = extractReportFromJson(rawAnalysis) || rawAnalysis
    const accordionSections = buildAccordionSections(reportText, learningStyleResult.description)
    
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

        {/* Display parsed report sections as dropdown cards */}
        <div className="space-y-4">
          <h2 className="text-2xl font-bold text-center mb-4">Your Learning Insights</h2>
          {accordionSections.filter(section => section.id !== 'checklist').map(section => {
            const isOpen = openSections.includes(section.id)
            const toggleSection = () => {
              setOpenSections(prev => (
                prev.includes(section.id)
                  ? prev.filter(id => id !== section.id)
                  : [...prev, section.id]
              ))
            }

            return (
              <Card key={section.id} className={`bg-gradient-to-br ${section.accent} border-2 shadow-sm`}>
                <CardHeader className="cursor-pointer" onClick={toggleSection}>
                  <CardTitle className="flex items-center justify-between text-lg sm:text-xl font-semibold text-gray-900">
                    <span>{section.title}</span>
                    <ChevronDown className={`w-6 h-6 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </CardTitle>
                </CardHeader>
                {isOpen && (
                  <CardContent className="space-y-5">
                    {section.paragraphs
                      .filter(para => {
                        // Remove learning style descriptions like "The Innovator - Learns through..."
                        const hasLearningStylePattern = /^The (Innovator|Organizer|Thinker|Connector)\s*-\s*Learns through/i.test(para)
                        // Remove standalone "Tips" headings
                        const isTipsHeading = /^Tips\s*$/i.test(para.trim())
                        return !hasLearningStylePattern && !isTipsHeading
                      })
                      .map((para, idx) => (
                        <p key={idx} className="text-gray-800 leading-relaxed text-base">
                          {para}
                        </p>
                      ))
                    }

                    {section.subsections.length > 0 && (
                      <div className="space-y-5">
                        {section.subsections.map((subsection, subIdx) => (
                          <div key={subIdx}>
                            {subsection.subtitle.toLowerCase() !== 'tips' && (
                              <h3 className="font-extrabold text-gray-900 mb-3 text-base sm:text-lg">
                                {subsection.subtitle}
                              </h3>
                            )}
                            <ul className="space-y-2 ml-2">
                              {subsection.items.map((item, itemIdx) => (
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
          <div className="max-w-4xl mx-auto px-4">
        {/* Progress Bar */}
        <Card className="shadow-sm mb-6">
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
              <h2 className="text-lg sm:text-xl font-semibold">Learning Style Assessment</h2>
              <div className="text-sm text-gray-600">
                Page {surveyPage + 1} of {totalPages}
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm text-gray-600">
                <span>Progress</span>
                <span>{Math.round((answers.filter(a => a !== null).length / questions.length) * 100)}% Complete</span>
              </div>
              <div className="w-full h-2 bg-gray-200 rounded-full">
                <div className="h-2 bg-blue-500 rounded-full transition-all duration-300" style={{ width: `${(answers.filter(a => a !== null).length / questions.length) * 100}%` }}></div>
              </div>
            </div>
          </CardContent>
        </Card>

         {/* Global scale instruction */}
         <Card className="shadow-sm mb-6">
           <CardContent className="p-4">
             <div className="text-center text-sm text-gray-600">
               Use the scale: <span className="font-semibold">1 = least preferred</span>, <span className="font-semibold">5 = most preferred</span>
             </div>
           </CardContent>
         </Card>

         {/* Individual Question Cards */}
         <div className="space-y-8">
           {questions.slice(startIdx, endIdx).map((q, idx) => (
             <Card key={startIdx + idx} className="shadow-lg">
               <CardContent className="p-6">
                 <div className="font-medium text-base sm:text-lg mb-3 text-center">
                   {startIdx + idx + 1}. {q}
                 </div>
                 <div className="flex justify-center gap-3 mt-3">
                   {[1,2,3,4,5].map(val => (
                     <button
                       type="button"
                       key={val}
                       className={`w-12 h-12 sm:w-14 sm:h-14 rounded-full border-2 flex items-center justify-center text-lg font-bold transition-all duration-200 ${
                         answers[startIdx + idx] === val 
                           ? "bg-blue-600 text-white border-blue-600 scale-110 shadow-lg" 
                           : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-blue-100 hover:border-blue-300"
                       }`}
                       onClick={() => handleChange(startIdx + idx, val)}
                       aria-label={`Rate ${val}`}
                       disabled={submitting || surveyFrozen}
                     >
                       <span>{val}</span>
                     </button>
                   ))}
                 </div>
               </CardContent>
             </Card>
           ))}
         </div>

         {/* Navigation Buttons */}
         <div className="flex flex-col sm:flex-row gap-4 justify-between mt-6">
           <Button
             type="button"
             variant="outline"
             size="sm"
             className="flex items-center gap-2"
             disabled={surveyPage === 0 || submitting || surveyFrozen}
             onClick={() => setSurveyPage(surveyPage - 1)}
           >
             <ChevronLeft className="w-4 h-4" />
             Previous
           </Button>
           {surveyPage === totalPages - 1 ? (
             <Button
               type="button"
               onClick={handleSubmit}
               className="px-8"
               disabled={submitting || !allAnswered || surveyFrozen}
             >
               {submitting ? "Submitting..." : "Submit Survey"}
             </Button>
           ) : (
             <Button
               type="button"
               size="sm"
               className="flex items-center gap-2"
               disabled={answers.slice(startIdx, endIdx).some(a => a === null) || submitting || surveyFrozen}
               onClick={() => setSurveyPage(surveyPage + 1)}
             >
               Next
               <ChevronRight className="w-4 h-4" />
             </Button>
           )}
         </div>
          </div>
        </div>
      </div>
    )
  }
}