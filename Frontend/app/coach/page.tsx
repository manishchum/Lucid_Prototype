"use client"

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { useRouter } from "next/navigation"
import { Cormorant_Garamond } from "next/font/google"
import {
  Sparkles,
  ArrowLeft,
  Send,
  RotateCcw,
  FileText,
  Copy,
  Check,
  Settings2,
  ShieldCheck,
  AlertCircle,
  X,
  Compass,
  Plus,
  MessageSquare,
  Trash2,
  Edit2,
  PanelLeftClose,
  PanelLeft,
  ChevronRight,
  BookOpen,
  ExternalLink,
  Share2,
  Search,
  Clock,
  MoreVertical
} from "lucide-react"

import { useAuth } from "@/contexts/auth-context"
import { fetchWithAuth } from "@/lib/fetch-with-auth"
import CoachOnboarding, { CoachProfileData } from "./components/CoachOnboarding"

const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["700"] })
const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || ""

interface PlaybookStep {
  number: number
  title: string
  description: string
}

interface PlaybookItem {
  id: string
  title: string
  file_name: string
  file_type: string
  summary: string
  category_pills: string[]
  use_when: string
  steps: PlaybookStep[]
  kpis_impacted: string
  reading_time_minutes: number
  created_at?: string
  target_employee_id?: string | null
  target_roles?: string[]
}

interface Citation {
  document_id?: string
  filename?: string
  file_name?: string
  title?: string
  name?: string
  source_type?: string
  file_type?: string
  chunk_index?: number
  score?: number
  similarity?: number
  location?: string
  page_number?: number
  slide_number?: number
  sheet_name?: string
  row_number?: number
  section_title?: string
  eval_period?: string
  excerpt?: string
  content?: string
  text?: string
}

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: string | Date
  citations?: Citation[]
  intent?: string
  isStreaming?: boolean
  error?: string
}

interface ConversationSummary {
  id: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
  last_message?: string
}

export default function CoachPage() {
  const router = useRouter()
  const { user, employeeData } = useAuth()

  // Onboarding & Profile State
  const [loadingProfile, setLoadingProfile] = useState<boolean>(true)
  const [onboarded, setOnboarded] = useState<boolean>(false)
  const [profile, setProfile] = useState<CoachProfileData | null>(null)
  const [showPersonaModal, setShowPersonaModal] = useState<boolean>(false)
  const [retakingOnboarding, setRetakingOnboarding] = useState<boolean>(false)

  // Thread History State
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [loadingConversations, setLoadingConversations] = useState<boolean>(false)
  const [loadingActiveThread, setLoadingActiveThread] = useState<boolean>(false)
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null)
  const [editTitleValue, setEditTitleValue] = useState<string>("")

  // Right 1/3 Antigravity-style Chat & History State
  const [showThreadHistory, setShowThreadHistory] = useState<boolean>(false)
  const [threadSearchQuery, setThreadSearchQuery] = useState<string>("")
  const [showChatMenu, setShowChatMenu] = useState<boolean>(false)
  const [mobileTab, setMobileTab] = useState<"playbooks" | "chat">("playbooks")
  const threadSearchInputRef = useRef<HTMLInputElement>(null)
  const chatMenuRef = useRef<HTMLDivElement>(null)

  // Chat State
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState<string>("")
  const [isSending, setIsSending] = useState<boolean>(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Playbooks Directory State
  const [playbooks, setPlaybooks] = useState<PlaybookItem[]>([])
  const [playbookCategories, setPlaybookCategories] = useState<string[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>("All")
  const [selectedPlaybookId, setSelectedPlaybookId] = useState<string | null>(null)
  const [loadingPlaybooks, setLoadingPlaybooks] = useState<boolean>(false)
  const [playbookSearch, setPlaybookSearch] = useState<string>("")
  const [sharedToast, setSharedToast] = useState<string | null>(null)

  // Auto-scroll ref
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Click outside to close chat options dropdown menu
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (chatMenuRef.current && !chatMenuRef.current.contains(e.target as Node)) {
        setShowChatMenu(false)
      }
    }
    if (showChatMenu) {
      document.addEventListener("mousedown", handleClickOutside)
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
    }
  }, [showChatMenu])

  // Fetch coaching profile on mount
  useEffect(() => {
    let isMounted = true
    async function loadProfile() {
      try {
        setLoadingProfile(true)
        const res = await fetchWithAuth(`${API_BASE}/api/coach/profile`)
        if (res.ok) {
          const data = await res.json()
          if (isMounted) {
            if (data.success && data.onboarded && data.profile) {
              setOnboarded(true)
              setProfile(data.profile)
              seedWelcomeMessage(data.profile)
              fetchConversations()
            } else {
              setOnboarded(false)
            }
          }
        } else {
          if (isMounted) setOnboarded(false)
        }
      } catch (err) {
        console.warn("[Coach] Failed to load coach profile:", err)
        if (isMounted) setOnboarded(false)
      } finally {
        if (isMounted) setLoadingProfile(false)
      }
    }

    loadProfile()
    return () => {
      isMounted = false
    }
  }, [])

  // Fetch list of conversation threads
  const fetchConversations = async () => {
    try {
      setLoadingConversations(true)
      const res = await fetchWithAuth(`${API_BASE}/api/coach/conversations`)
      if (res.ok) {
        const data = await res.json()
        if (data.success && Array.isArray(data.conversations)) {
          setConversations(data.conversations)
        }
      }
    } catch (err) {
      console.warn("[Coach] Failed to fetch conversation list:", err)
    } finally {
      setLoadingConversations(false)
    }
  }

  // Fetch Company Playbooks
  const fetchPlaybooks = useCallback(async () => {
    try {
      setLoadingPlaybooks(true)
      const res = await fetchWithAuth(`${API_BASE}/api/coach/playbooks`)
      if (res.ok) {
        const data = await res.json()
        const fetchedList: PlaybookItem[] = data.playbooks || []
        setPlaybooks(fetchedList)
        setPlaybookCategories(data.categories || [])
        if (fetchedList.length > 0) {
          setSelectedPlaybookId((prev) => prev || fetchedList[0].id)
        }
      }
    } catch (err) {
      console.warn("[Coach] Failed to load company playbooks:", err)
    } finally {
      setLoadingPlaybooks(false)
    }
  }, [])

  useEffect(() => {
    fetchPlaybooks()
  }, [fetchPlaybooks])

  // Active Chat Title (for Antigravity header bar)
  const activeChatTitle = useMemo(() => {
    if (!activeConversationId) return "Agent performance coach"
    const found = conversations.find((c) => c.id === activeConversationId)
    return found?.title || "Agent performance coach"
  }, [activeConversationId, conversations])

  // Filtered Playbooks based on category & search
  const filteredPlaybooks = useMemo(() => {
    return playbooks.filter((pb) => {
      if (selectedCategory !== "All") {
        const matchCategory = pb.category_pills.some(
          (c) => c.toLowerCase() === selectedCategory.toLowerCase()
        )
        if (!matchCategory) return false
      }
      if (playbookSearch.trim()) {
        const query = playbookSearch.toLowerCase()
        const matchTitle = pb.title.toLowerCase().includes(query)
        const matchSummary = pb.summary.toLowerCase().includes(query)
        const matchUseWhen = pb.use_when.toLowerCase().includes(query)
        if (!matchTitle && !matchSummary && !matchUseWhen) return false
      }
      return true
    })
  }, [playbooks, selectedCategory, playbookSearch])

  const selectedPlaybook = useMemo(() => {
    return playbooks.find((pb) => pb.id === selectedPlaybookId) || filteredPlaybooks[0] || null
  }, [playbooks, selectedPlaybookId, filteredPlaybooks])

  const handlePracticePlaybook = (pb: PlaybookItem) => {
    setShowThreadHistory(false)
    setMobileTab("chat")
    const promptText = `I want to practice and review the "${pb.title}" playbook with you. Can you test me with a realistic customer scenario to verify how I apply its steps?`
    setInputValue(promptText)
    handleSendMessage(promptText)
  }

  const handleDownloadPlaybookOriginal = async (docId: string) => {
    try {
      const res = await fetchWithAuth(`${API_BASE}/api/coach/documents/${docId}/download-url`)
      if (res.ok) {
        const data = await res.json()
        if (data.download_url) {
          window.open(data.download_url, "_blank")
        }
      }
    } catch (err) {
      console.error("[Coach] Failed to open download url:", err)
    }
  }

  const handleSharePlaybook = (pb: PlaybookItem) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(
        `📖 Company Playbook: ${pb.title}\n\nSummary: ${pb.summary}\n\nUse it when: ${pb.use_when}\n\nKPIs: ${pb.kpis_impacted}`
      )
      setSharedToast(`Copied "${pb.title}" summary to clipboard!`)
      setTimeout(() => setSharedToast(null), 3000)
    }
  }

  // Load a specific conversation thread
  const handleSelectConversation = async (convId: string) => {
    setShowThreadHistory(false)
    setMobileTab("chat")
    if (convId === activeConversationId || isSending) return

    try {
      setLoadingActiveThread(true)
      setActiveConversationId(convId)
      const res = await fetchWithAuth(`${API_BASE}/api/coach/conversations/${convId}`)
      if (res.ok) {
        const data = await res.json()
        if (data.success && data.conversation) {
          const rawMessages = data.conversation.messages || []
          setMessages(
            rawMessages.map((m: any, idx: number) => ({
              id: m.id || `msg-${idx}-${Date.now()}`,
              role: m.role || "assistant",
              content: m.content || "",
              citations: m.citations || [],
              timestamp: m.timestamp || new Date()
            }))
          )
        }
      }
    } catch (err) {
      console.error("[Coach] Failed to load conversation:", err)
    } finally {
      setLoadingActiveThread(false)
    }
  }

  // Start a fresh chat
  const handleNewChat = () => {
    setShowThreadHistory(false)
    setMobileTab("chat")
    if (isSending) return
    setActiveConversationId(null)
    if (profile) {
      seedWelcomeMessage(profile)
    } else {
      setMessages([])
    }
    setInputValue("")
    setTimeout(() => textareaRef.current?.focus(), 50)
  }

  // Rename a thread
  const handleSaveRename = async (convId: string) => {
    const trimmed = editTitleValue.trim()
    if (!trimmed) {
      setEditingThreadId(null)
      return
    }

    setConversations((prev) =>
      prev.map((c) => (c.id === convId ? { ...c, title: trimmed } : c))
    )
    setEditingThreadId(null)

    try {
      await fetchWithAuth(`${API_BASE}/api/coach/conversations/${convId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed })
      })
    } catch (err) {
      console.error("[Coach] Failed to rename conversation:", err)
    }
  }

  // Delete a thread
  const handleDeleteConversation = async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setConversations((prev) => prev.filter((c) => c.id !== convId))
    if (activeConversationId === convId) {
      handleNewChat()
    }

    try {
      await fetchWithAuth(`${API_BASE}/api/coach/conversations/${convId}`, {
        method: "DELETE"
      })
    } catch (err) {
      console.error("[Coach] Failed to delete conversation:", err)
    }
  }

  // Seeds personalized initial coach greeting
  const seedWelcomeMessage = (prof: CoachProfileData) => {
    const isSkipped = prof.skipped_onboarding || (!prof.role_title && !prof.current_weight && !prof.three_year_vision)

    if (isSkipped) {
      const greetingMessage: Message = {
        id: "welcome-greeting",
        role: "assistant",
        content: `Hello! I'm your **AI Performance Coach**.\n\nYou chose to share your context as we go — no assumptions made. Feel free to tell me about your day-to-day role anytime, or ask me directly about your sales numbers, quotas, team standings, or company playbooks.\n\nHow can I help you today?`,
        timestamp: new Date(),
        intent: "WELCOME"
      }
      setMessages([greetingMessage])
      return
    }

    const role = prof.role_title
    const weight = prof.current_weight
    const tone = prof.coaching_tone || "tactical_direct"

    let toneGreeting = "I'll keep our guidance direct, quantified, and action-oriented."
    if (tone === "inspiring") {
      toneGreeting = "I'm here to back you up, celebrate every win, and keep your momentum unstoppable."
    } else if (tone === "thought_partner") {
      toneGreeting = "I'm ready to dig into root causes, analyze market patterns, and think through high-stakes moves with you."
    }

    let roleFragment = role ? ` for **${role}**` : ""
    let weightFragment = weight ? `I see your immediate focus is **${weight}**. ` : ""

    const greetingMessage: Message = {
      id: "welcome-greeting",
      role: "assistant",
      content: `Hello! I'm calibrated as your **AI Performance Coach**${roleFragment}.\n\n${weightFragment}${toneGreeting}\n\nI have real-time access to your company's uploaded sales data and authorized playbooks. How can I help you excel today?`,
      timestamp: new Date(),
      intent: "WELCOME"
    }

    setMessages([greetingMessage])
  }

  // Handle Onboarding Completion
  const handleSaveProfile = async (profileData: CoachProfileData) => {
    const res = await fetchWithAuth(`${API_BASE}/api/coach/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(profileData)
    })

    if (!res.ok) {
      throw new Error("Failed to save coaching profile.")
    }

    setProfile(profileData)
    setOnboarded(true)
    setRetakingOnboarding(false)
    seedWelcomeMessage(profileData)
    fetchConversations()
  }

  // Role-tailored dynamic suggestion chips
  const dynamicSuggestions = useMemo(() => {
    const isSkipped = profile?.skipped_onboarding || (!profile?.role_title && !profile?.current_weight && !profile?.three_year_vision)

    if (isSkipped) {
      return [
        "How am I tracking against my sales targets?",
        "Who are the top performers in our team?",
        "What documents and playbooks are uploaded?",
        "What can you help me with as my coach?"
      ]
    }

    const suggestions: string[] = []
    const weight = profile?.current_weight?.toLowerCase() || ""

    if (weight.includes("number") || weight.includes("quota")) {
      suggestions.push("How am I tracking against my monthly sales target?")
      suggestions.push("Who are the top performers in my region?")
      suggestions.push("Which client accounts have the largest gap to close?")
    } else if (weight.includes("energy") || weight.includes("burnout")) {
      suggestions.push("How can I cut down my weekly reporting hours?")
      suggestions.push("What repetitive tasks can I automate from my spreadsheets?")
      suggestions.push("Help me prioritize my top 3 high-impact accounts this week")
    } else if (weight.includes("perception") || weight.includes("growth")) {
      suggestions.push("Summarize my quarterly accomplishments for my manager review")
      suggestions.push("What competencies do top regional heads demonstrate?")
      suggestions.push("Where does my performance stand compared to cohort averages?")
    } else {
      suggestions.push("Show my current sales volume and target attainment")
      suggestions.push("Summarize the authorized trade discount policies")
      suggestions.push("What are the key priorities outlined in our recent playbooks?")
    }

    suggestions.push("What documents and spreadsheets are in my coaching knowledge base?")
    return suggestions.slice(0, 4)
  }, [profile])

  // Copy assistant response
  const handleCopyMessage = (id: string, text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  // Group threads by recency (Today, Yesterday, Previous 7 Days, Older) with search filter
  const filteredGroupedConversations = useMemo(() => {
    const query = threadSearchQuery.trim().toLowerCase()
    const list = query
      ? conversations.filter(
          (c) =>
            c.title.toLowerCase().includes(query) ||
            (c.last_message && c.last_message.toLowerCase().includes(query))
        )
      : conversations

    const groups: { [key: string]: ConversationSummary[] } = {
      Today: [],
      Yesterday: [],
      "Previous 7 Days": [],
      Older: []
    }

    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    const yesterdayStart = todayStart - 86400000
    const weekStart = todayStart - 7 * 86400000

    list.forEach((c) => {
      const time = new Date(c.updated_at || c.created_at).getTime()
      if (time >= todayStart) {
        groups["Today"].push(c)
      } else if (time >= yesterdayStart) {
        groups["Yesterday"].push(c)
      } else if (time >= weekStart) {
        groups["Previous 7 Days"].push(c)
      } else {
        groups["Older"].push(c)
      }
    })

    return Object.entries(groups).filter(([_, items]) => items.length > 0)
  }, [conversations, threadSearchQuery])

  // Handle Send Message with SSE streaming & thread persistence
  const handleSendMessage = async (queryText?: string) => {
    const text = (queryText || inputValue).trim()
    if (!text || isSending) return

    setInputValue("")
    setIsSending(true)

    const userMessageId = `user-${Date.now()}`
    const assistantMessageId = `coach-${Date.now()}`

    const userMessage: Message = {
      id: userMessageId,
      role: "user",
      content: text,
      timestamp: new Date()
    }

    const assistantMessage: Message = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
      citations: [],
      isStreaming: true
    }

    setMessages((prev) => [...prev, userMessage, assistantMessage])

    try {
      const response = await fetchWithAuth(`${API_BASE}/api/coach/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: text,
          conversation_id: activeConversationId || undefined,
          target_employee_name: employeeData?.name || user?.displayName || undefined,
          stream: true
        })
      })

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}: ${response.statusText}`)
      }

      if (!response.body) {
        throw new Error("ReadableStream not supported on this response.")
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder("utf-8")
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n\n")
        buffer = lines.pop() || ""

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed.startsWith("data:")) continue

          const jsonStr = trimmed.replace(/^data:\s*/, "")
          try {
            const data = JSON.parse(jsonStr)

            if (data.type === "citations") {
              setMessages((prev) =>
                prev.map((msg) => (msg.id === assistantMessageId ? { ...msg, citations: data.citations } : msg))
              )
            } else if (data.type === "token") {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessageId ? { ...msg, content: msg.content + data.content } : msg
                )
              )
            } else if (data.type === "done") {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessageId ? { ...msg, isStreaming: false, intent: data.intent } : msg
                )
              )
              if (data.conversation_id) {
                setActiveConversationId(data.conversation_id)
                fetchConversations()
              }
            } else if (data.type === "error") {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessageId
                    ? {
                        ...msg,
                        isStreaming: false,
                        error: data.message || "An error occurred while answering."
                      }
                    : msg
                )
              )
            }
          } catch (e) {
            console.warn("[Coach SSE] Failed to parse event JSON:", jsonStr, e)
          }
        }
      }
    } catch (err: any) {
      console.error("[Coach] Error during chat streaming:", err)
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? {
                ...msg,
                isStreaming: false,
                content:
                  msg.content ||
                  "I apologize, but I encountered an error communicating with the intelligence layer. Please try again.",
                error: err.message
              }
            : msg
        )
      )
    } finally {
      setIsSending(false)
      setTimeout(() => textareaRef.current?.focus(), 100)
    }
  }

  // Handle textarea enter
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  // Simple Markdown Parser (renders clean bold headings, bullet points, numbers, tables, code)
  const renderMarkdown = (text: string) => {
    const lines = text.split("\n")
    const elements: React.ReactNode[] = []

    let inTable = false
    let tableRows: string[][] = []

    const flushTable = () => {
      if (!inTable || tableRows.length === 0) return
      const headers = tableRows[0]
      const body = tableRows.slice(1).filter((r) => !r.every((c) => c.match(/^:?-+:?$/)))

      elements.push(
        <div key={`table-${elements.length}`} className="my-3 overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-xs text-left border-collapse">
            <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
              <tr>
                {headers.map((h, i) => (
                  <th key={i} className="px-3 py-2 border-r border-slate-200 last:border-r-0">
                    {h.trim()}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white">
              {body.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-slate-50/60">
                  {row.map((cell, cIdx) => (
                    <td key={cIdx} className="px-3 py-2 text-slate-600 border-r border-slate-200 last:border-r-0">
                      {cell.trim()}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      inTable = false
      tableRows = []
    }

    lines.forEach((line, index) => {
      let trimmed = line.trim()

      // 1. Strip raw markdown headers (###, ##, #) and render as clean bold text
      if (/^#+\s*/.test(trimmed)) {
        if (inTable) flushTable()
        const cleanHeading = trimmed.replace(/^#+\s*/, "").replace(/#+/g, "").trim()
        if (cleanHeading) {
          elements.push(
            <p key={index} className="text-sm font-bold text-slate-900 mt-2.5 mb-1">
              {cleanHeading}
            </p>
          )
        }
        return
      }

      // 2. Table line: starts and ends with |
      if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
        inTable = true
        const cells = trimmed
          .slice(1, -1)
          .split("|")
          .map((c) => c.trim())
        tableRows.push(cells)
        return
      } else {
        if (inTable) flushTable()
      }

      // 3. Bullet lists (- or *)
      if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
        const itemText = trimmed.replace(/^[-*]\s+/, "")
        elements.push(
          <div key={index} className="flex items-start gap-2 text-xs sm:text-sm text-slate-700 my-1 pl-1">
            <span className="text-indigo-600 font-bold shrink-0 mt-0.5">•</span>
            <span dangerouslySetInnerHTML={{ __html: parseInlineStyles(itemText) }} />
          </div>
        )
        return
      }

      // 4. Numbered lists: 1. Item
      const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/)
      if (numMatch) {
        elements.push(
          <div key={index} className="flex items-start gap-2 text-xs sm:text-sm text-slate-700 my-1 pl-1">
            <span className="text-xs font-bold text-indigo-600 shrink-0 w-4">{numMatch[1]}.</span>
            <span dangerouslySetInnerHTML={{ __html: parseInlineStyles(numMatch[2]) }} />
          </div>
        )
        return
      }

      // 5. Empty line
      if (!trimmed) {
        elements.push(<div key={index} className="h-2" />)
        return
      }

      // 6. Normal paragraph (strip any stray hashes)
      elements.push(
        <p
          key={index}
          className="text-xs sm:text-sm text-slate-700 leading-relaxed my-1"
          dangerouslySetInnerHTML={{ __html: parseInlineStyles(trimmed) }}
        />
      )
    })

    if (inTable) flushTable()

    return <div className="space-y-0.5">{elements}</div>
  }

  // Inline styling helper: **bold**, *italic*, `code`, strips any rogue #
  const parseInlineStyles = (str: string) => {
    return str
      .replace(/^#+\s*/g, "") // strip leading #
      .replace(/\s*#+\s*/g, " ") // strip internal # or ###
      .replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold text-slate-900">$1</strong>')
      .replace(/\*(.*?)\*/g, '<em class="italic text-slate-800">$1</em>')
      .replace(
        /`([^`]+)`/g,
        '<code class="px-1.5 py-0.5 text-xs font-mono bg-slate-100 text-indigo-700 rounded-md border border-slate-200/80">$1</code>'
      )
  }

  // Loading state
  if (loadingProfile) {
    return (
      <div className="min-h-screen bg-slate-50/70 flex flex-col items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="relative">
            <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center text-white shadow-md animate-pulse">
              <Sparkles className="w-6 h-6" />
            </div>
            <div className="absolute -inset-1 rounded-2xl bg-indigo-400/20 animate-ping" />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mt-2">
            Loading Coaching Intelligence...
          </p>
        </div>
      </div>
    )
  }

  // If user hasn't onboarded or explicitly requested to retake onboarding
  if (!onboarded || retakingOnboarding) {
    return (
      <CoachOnboarding
        initialName={user?.displayName || "there"}
        onComplete={handleSaveProfile}
        onSkip={() => {
          const emptyProfile: CoachProfileData = {
            onboarded: true,
            skipped_onboarding: true,
            role_title: "",
            stakeholders: [],
            time_distribution: { meetings: 0, reporting: 0, field: 0, firefighting: 0, learning: 0 },
            three_year_vision: "",
            current_weight: "",
            coaching_tone: "tactical_direct",
            summary_bio: ""
          }
          handleSaveProfile(emptyProfile)
        }}
      />
    )
  }

  return (
    <div className="h-screen w-full bg-slate-100 flex flex-col lg:flex-row overflow-hidden font-sans">
      {/* MOBILE TAB BAR (< lg screens) */}
      <div className="lg:hidden shrink-0 bg-white border-b border-slate-200 px-3 py-2 flex items-center justify-around z-20">
        <button
          type="button"
          onClick={() => setMobileTab("playbooks")}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
            mobileTab === "playbooks" ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Playbooks ({playbooks.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setMobileTab("chat")}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
            mobileTab === "chat" ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Coach Chat</span>
        </button>
      </div>

      {/* ==================================================================== */}
      {/* 1. LEFT 2/3 SECTION: COMPANY PLAYBOOKS (Directory + Reader)          */}
      {/* ==================================================================== */}
      <section
        className={`${
          mobileTab === "playbooks" ? "flex" : "hidden"
        } lg:flex lg:w-2/3 h-full flex-col min-w-0 bg-slate-50/70 border-r border-slate-200/90 overflow-hidden`}
      >
        <div className="flex-1 min-h-0 flex flex-col p-4 sm:p-6 overflow-hidden">
          {/* Playbooks Top Header */}
          <div className="shrink-0 space-y-3.5 pb-4 border-b border-slate-200/80">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                  Playbooks • reference guide • {filteredPlaybooks.length}{" "}
                  {filteredPlaybooks.length === 1 ? "playbook" : "playbooks"}
                </div>
                <h2
                  className={`text-2xl sm:text-3xl xl:text-4xl font-bold text-slate-900 tracking-tight leading-tight ${cormorant.className}`}
                >
                  How each sales model works, step by step.
                </h2>
              </div>

              {/* Utility Nav Buttons */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowPersonaModal(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 text-xs font-semibold shadow-2xs transition"
                  title="My Coaching Calibration"
                >
                  <Settings2 className="w-3.5 h-3.5 text-indigo-600" />
                  <span className="hidden sm:inline">My Persona</span>
                </button>

                <button
                  type="button"
                  onClick={() => router.push("/employee/welcome")}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 text-xs font-semibold shadow-2xs transition"
                  title="Back to Dashboard"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Dashboard</span>
                </button>

                <button
                  type="button"
                  onClick={fetchPlaybooks}
                  disabled={loadingPlaybooks}
                  className="p-1.5 rounded-xl border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 text-xs transition"
                  title="Refresh playbooks"
                >
                  <RotateCcw className={`w-3.5 h-3.5 text-indigo-600 ${loadingPlaybooks ? "animate-spin" : ""}`} />
                </button>
              </div>
            </div>

            {/* Filter Pills & Search */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                <button
                  type="button"
                  onClick={() => setSelectedCategory("All")}
                  className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition shrink-0 ${
                    selectedCategory === "All"
                      ? "bg-slate-900 text-white shadow-2xs"
                      : "bg-white text-slate-700 border border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  All
                </button>
                {playbookCategories.map((category) => (
                  <button
                    key={category}
                    type="button"
                    onClick={() => setSelectedCategory(category)}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition shrink-0 ${
                      selectedCategory.toLowerCase() === category.toLowerCase()
                        ? "bg-slate-900 text-white shadow-2xs"
                        : "bg-white text-slate-700 border border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {category}
                  </button>
                ))}
                {profile?.role_title && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCategory((prev) => (prev === profile.role_title ? "All" : profile.role_title!))
                    }}
                    className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition shrink-0 border border-dashed ${
                      selectedCategory === profile.role_title
                        ? "bg-indigo-600 text-white border-indigo-600 shadow-2xs"
                        : "bg-white text-indigo-700 border-indigo-300 hover:bg-indigo-50/50"
                    }`}
                  >
                    Only for my role
                  </button>
                )}
              </div>

              {/* Search Playbooks Bar */}
              <div className="relative min-w-[200px] sm:max-w-xs w-full">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={playbookSearch}
                  onChange={(e) => setPlaybookSearch(e.target.value)}
                  placeholder="Search playbooks..."
                  className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-slate-200 rounded-full text-slate-800 placeholder-slate-400 focus:outline-hidden focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition"
                />
              </div>
            </div>
          </div>

          {/* Playbooks Directory + Reader Content */}
          {loadingPlaybooks ? (
            <div className="flex-1 flex flex-col items-center justify-center py-20 text-xs text-slate-400 space-y-2">
              <div className="w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
              <p>Loading company playbooks...</p>
            </div>
          ) : playbooks.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-8">
              <div className="bg-white rounded-3xl border border-slate-200/90 p-10 text-center max-w-md mx-auto space-y-4">
                <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center mx-auto">
                  <BookOpen className="w-6 h-6" />
                </div>
                <div>
                  <h3 className={`text-xl font-bold text-slate-900 ${cormorant.className}`}>
                    No Company Playbooks Available Yet
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Managers can designate company SOPs, manuals, or training documents as playbooks from Admin Uploads. Once marked, they appear here for all employees.
                  </p>
                </div>
              </div>
            </div>
          ) : filteredPlaybooks.length === 0 ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center text-slate-500 text-xs">
                No playbooks match your current filter or search criteria.
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-0 pt-4 flex gap-5 overflow-hidden">
              {/* LEFT SUB-COLUMN: Scrollable Directory of Playbooks */}
              <div className="w-64 sm:w-72 xl:w-80 shrink-0 h-full overflow-y-auto pr-1 space-y-2.5">
                {filteredPlaybooks.map((pb) => {
                  const isSelected = pb.id === selectedPlaybook?.id
                  return (
                    <div
                      key={pb.id}
                      onClick={() => setSelectedPlaybookId(pb.id)}
                      className={`w-full text-left p-4 rounded-2xl cursor-pointer transition-all ${
                        isSelected
                          ? "bg-slate-900 text-white shadow-sm"
                          : "bg-white hover:bg-slate-100/90 text-slate-900 border border-slate-200/80 shadow-2xs"
                      }`}
                    >
                      <h4 className="font-semibold text-sm leading-snug">
                        {pb.title}
                      </h4>
                      <div
                        className={`flex flex-wrap items-center gap-1.5 mt-2 text-xs ${
                          isSelected ? "text-slate-300" : "text-slate-500"
                        }`}
                      >
                        {pb.category_pills.slice(0, 2).map((cat, idx) => (
                          <span key={idx}>{cat} •</span>
                        ))}
                        <span>{pb.reading_time_minutes || 5} min read</span>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* RIGHT SUB-COLUMN: Playbook Reader / Preview Card */}
              <div className="flex-1 min-w-0 h-full overflow-y-auto pr-1 pb-6">
                {selectedPlaybook && (
                  <div className="bg-white rounded-3xl border border-slate-200/90 p-6 sm:p-7 shadow-xs space-y-6">
                    {/* Tags / Badges */}
                    <div className="flex flex-wrap items-center gap-2">
                      {selectedPlaybook.category_pills.map((pill, idx) => (
                        <span
                          key={idx}
                          className="px-3 py-1 rounded-full text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200/70"
                        >
                          {pill}
                        </span>
                      ))}
                      {selectedPlaybook.target_roles?.map((role, idx) => (
                        <span
                          key={`role-${idx}`}
                          className="px-3 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700 border border-indigo-200/70"
                        >
                          For {role}
                        </span>
                      ))}
                    </div>

                    {/* Title */}
                    <h3
                      className={`text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight ${cormorant.className}`}
                    >
                      {selectedPlaybook.title}
                    </h3>

                    {/* Use it when */}
                    <div className="text-sm text-slate-700 leading-relaxed">
                      <span className="font-bold text-slate-900">Use it when: </span>
                      <span>{selectedPlaybook.use_when || selectedPlaybook.summary}</span>
                    </div>

                    {/* Numbered Steps */}
                    <div className="space-y-4 pt-1">
                      {selectedPlaybook.steps && selectedPlaybook.steps.length > 0 ? (
                        selectedPlaybook.steps.map((st, idx) => (
                          <div
                            key={idx}
                            className="flex items-start gap-4 pb-4 border-b border-slate-100 last:border-b-0"
                          >
                            <span className="text-xl sm:text-2xl font-serif text-slate-400 font-bold shrink-0 w-6">
                              {st.number || idx + 1}
                            </span>
                            <div className="space-y-1">
                              <h5 className="text-sm font-bold text-slate-900">
                                {st.title}
                              </h5>
                              <p className="text-xs sm:text-sm text-slate-600 leading-relaxed whitespace-pre-line">
                                {st.description}
                              </p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">
                          {selectedPlaybook.summary}
                        </div>
                      )}
                    </div>

                    {/* KPIs this moves */}
                    <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-1">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        KPIs this moves
                      </div>
                      <div className="text-xs sm:text-sm font-semibold text-slate-800">
                        {selectedPlaybook.kpis_impacted || "Connect rate, leads to conversion, quota attainment"}
                      </div>
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-wrap items-center gap-3 pt-2">
                      <button
                        type="button"
                        onClick={() => handlePracticePlaybook(selectedPlaybook)}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-slate-900 hover:bg-black text-white text-xs font-bold transition shadow-xs"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Practise this with Coach</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleDownloadPlaybookOriginal(selectedPlaybook.id)}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 text-xs font-semibold transition"
                      >
                        <ExternalLink className="w-3.5 h-3.5 text-slate-500" />
                        <span>View Original Document</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => handleSharePlaybook(selectedPlaybook)}
                        className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 text-xs font-semibold transition"
                      >
                        <Share2 className="w-3.5 h-3.5 text-slate-500" />
                        <span>Share with my team</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      {/* ==================================================================== */}
      {/* 2. RIGHT 1/3 SECTION: ANTIGRAVITY-STYLE CHAT & THREAD HISTORY        */}
      {/* ==================================================================== */}
      <section
        className={`${
          mobileTab === "chat" ? "flex" : "hidden"
        } lg:flex lg:w-1/3 h-full flex-col min-w-0 bg-white overflow-hidden shadow-xs border-l border-slate-200/90`}
      >
        {/* Antigravity Header Bar: [ [|]  🔍  Active Title  ⋮  + ] */}
        <header className="h-12 border-b border-slate-200/80 px-3 flex items-center justify-between bg-white shrink-0 z-20">
          <div className="flex items-center gap-1.5 min-w-0 flex-1 mr-2">
            {/* History Toggle [|] */}
            <button
              type="button"
              onClick={() => setShowThreadHistory(!showThreadHistory)}
              className={`p-1.5 rounded-lg transition ${
                showThreadHistory
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-slate-500 hover:text-slate-800 hover:bg-slate-100"
              }`}
              title={showThreadHistory ? "Return to chat" : "Conversation history"}
            >
              <PanelLeft className="w-4 h-4" />
            </button>

            {/* Search Icon 🔍 */}
            <button
              type="button"
              onClick={() => {
                setShowThreadHistory(true)
                setTimeout(() => threadSearchInputRef.current?.focus(), 50)
              }}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
              title="Search chat threads"
            >
              <Search className="w-4 h-4" />
            </button>

            {/* Active Thread Title */}
            <div className="flex items-center gap-1.5 min-w-0 flex-1 ml-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
              <span className="text-xs font-semibold text-slate-800 truncate" title={activeChatTitle}>
                {showThreadHistory ? "Conversation History" : activeChatTitle}
              </span>
            </div>
          </div>

          {/* Right Header Controls: ⋮  + */}
          <div className="flex items-center gap-1 shrink-0">
            {/* Options Dropdown ⋮ */}
            <div className="relative" ref={chatMenuRef}>
              <button
                type="button"
                onClick={() => setShowChatMenu(!showChatMenu)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
                title="Options"
              >
                <MoreVertical className="w-4 h-4" />
              </button>

              {showChatMenu && (
                <div className="absolute right-0 top-full mt-1 w-52 bg-white rounded-xl border border-slate-200 shadow-lg py-1 z-50 text-xs animate-in fade-in zoom-in-95 duration-100">
                  <button
                    type="button"
                    onClick={() => {
                      setShowChatMenu(false)
                      setShowPersonaModal(true)
                    }}
                    className="w-full text-left px-3 py-2 text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                  >
                    <Settings2 className="w-3.5 h-3.5 text-indigo-600" />
                    <span>Persona Calibration</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowChatMenu(false)
                      if (profile) seedWelcomeMessage(profile)
                    }}
                    className="w-full text-left px-3 py-2 text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                  >
                    <RotateCcw className="w-3.5 h-3.5 text-slate-500" />
                    <span>Reset Chat</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setShowChatMenu(false)
                      setRetakingOnboarding(true)
                    }}
                    className="w-full text-left px-3 py-2 text-slate-700 hover:bg-slate-50 flex items-center gap-2 border-t border-slate-100"
                  >
                    <Compass className="w-3.5 h-3.5 text-slate-500" />
                    <span>Retake Questionnaire</span>
                  </button>
                </div>
              )}
            </div>

            {/* New Chat Button + */}
            <button
              type="button"
              onClick={handleNewChat}
              className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 transition"
              title="Start a fresh chat"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* BODY: Either Thread History OR Messages Stream */}
        {showThreadHistory ? (
          /* THREAD HISTORY VIEW */
          <div className="flex-1 min-h-0 flex flex-col bg-slate-50/50 overflow-hidden">
            {/* Search Threads Bar */}
            <div className="p-3 border-b border-slate-200/80 bg-white">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  ref={threadSearchInputRef}
                  type="text"
                  value={threadSearchQuery}
                  onChange={(e) => setThreadSearchQuery(e.target.value)}
                  placeholder="Search previous chats..."
                  className="w-full pl-8 pr-7 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-hidden focus:border-indigo-500 focus:bg-white transition"
                />
                {threadSearchQuery && (
                  <button
                    type="button"
                    onClick={() => setThreadSearchQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </div>
            </div>

            {/* New Chat Action */}
            <div className="p-3 pb-1">
              <button
                type="button"
                onClick={handleNewChat}
                className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 text-indigo-700 text-xs font-semibold shadow-2xs transition"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>New Chat</span>
              </button>
            </div>

            {/* Grouped Threads List */}
            <div className="flex-1 overflow-y-auto px-2.5 py-2 space-y-4">
              {filteredGroupedConversations.length === 0 ? (
                <div className="text-center py-12 px-3">
                  <MessageSquare className="w-6 h-6 text-slate-300 mx-auto mb-2" />
                  <p className="text-xs text-slate-500 font-medium">
                    {threadSearchQuery ? "No matching conversations" : "No previous conversations yet"}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {threadSearchQuery ? "Try a different search keyword" : "Start a conversation to see history"}
                  </p>
                </div>
              ) : (
                filteredGroupedConversations.map(([groupLabel, items]) => (
                  <div key={groupLabel} className="space-y-1">
                    <div className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                      {groupLabel}
                    </div>

                    {items.map((thread) => {
                      const isActive = activeConversationId === thread.id
                      const isEditing = editingThreadId === thread.id

                      return (
                        <div
                          key={thread.id}
                          onClick={() => handleSelectConversation(thread.id)}
                          className={`group relative flex items-center justify-between px-2.5 py-2 rounded-xl text-xs transition cursor-pointer ${
                            isActive
                              ? "bg-indigo-50/90 text-indigo-950 font-semibold border border-indigo-200/80 shadow-2xs"
                              : "text-slate-600 hover:bg-white hover:text-slate-900 border border-transparent hover:border-slate-200/60"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <MessageSquare
                              className={`w-3.5 h-3.5 shrink-0 ${
                                isActive ? "text-indigo-600" : "text-slate-400 group-hover:text-slate-600"
                              }`}
                            />

                            {isEditing ? (
                              <input
                                type="text"
                                autoFocus
                                value={editTitleValue}
                                onChange={(e) => setEditTitleValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") handleSaveRename(thread.id)
                                  if (e.key === "Escape") setEditingThreadId(null)
                                }}
                                onBlur={() => handleSaveRename(thread.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="w-full bg-white border border-indigo-300 rounded px-1.5 py-0.5 text-xs text-slate-800 focus:outline-hidden"
                              />
                            ) : (
                              <span className="truncate">{thread.title}</span>
                            )}
                          </div>

                          {!isEditing && (
                            <div className="hidden group-hover:flex items-center gap-1 shrink-0 ml-1">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setEditingThreadId(thread.id)
                                  setEditTitleValue(thread.title)
                                }}
                                className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200/70 transition"
                                title="Rename thread"
                              >
                                <Edit2 className="w-3 h-3" />
                              </button>

                              <button
                                type="button"
                                onClick={(e) => handleDeleteConversation(thread.id, e)}
                                className="p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition"
                                title="Delete thread"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                ))
              )}
            </div>

            {/* Thread History Footer */}
            <div className="p-2.5 border-t border-slate-200/80 bg-white flex items-center justify-between text-xs">
              <button
                type="button"
                onClick={() => setShowPersonaModal(true)}
                className="flex items-center gap-1.5 text-slate-600 hover:text-indigo-600 font-medium p-1 transition"
              >
                <Settings2 className="w-3.5 h-3.5" />
                <span>Persona</span>
              </button>
              <button
                type="button"
                onClick={() => setShowThreadHistory(false)}
                className="text-indigo-600 hover:text-indigo-800 font-semibold p-1 transition"
              >
                Back to Chat →
              </button>
            </div>
          </div>
        ) : (
          /* MESSAGES & CHAT STREAM VIEW */
          <div className="flex-1 min-h-0 flex flex-col justify-between overflow-hidden">
            {/* Messages Scroll Area */}
            <main className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4">
              {loadingActiveThread ? (
                <div className="py-16 text-center text-xs text-slate-400">Loading conversation history...</div>
              ) : (
                messages.map((message) => {
                  const isUser = message.role === "user"

                  return (
                    <div
                      key={message.id}
                      className={`flex gap-2.5 ${isUser ? "justify-end" : "justify-start"} animate-in fade-in duration-200`}
                    >
                      {!isUser && (
                        <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-xs mt-1">
                          <Sparkles className="w-3.5 h-3.5" />
                        </div>
                      )}

                      <div className={`max-w-[88%] flex flex-col ${isUser ? "items-end" : "items-start"}`}>
                        {/* Message Bubble */}
                        <div
                          className={`rounded-2xl p-3.5 sm:p-4 shadow-2xs transition-all ${
                            isUser
                              ? "bg-indigo-600 text-white font-medium text-xs sm:text-sm rounded-tr-xs"
                              : "bg-white border border-slate-200/90 text-slate-800 rounded-tl-xs"
                          }`}
                        >
                          {isUser ? (
                            <p className="whitespace-pre-wrap">{message.content}</p>
                          ) : (
                            <>
                              {message.content ? (
                                renderMarkdown(message.content)
                              ) : message.isStreaming ? (
                                <div className="flex items-center gap-2 text-xs text-slate-500 py-1">
                                  <span className="w-2 h-2 rounded-full bg-indigo-600 animate-ping" />
                                  <span>Thinking...</span>
                                </div>
                              ) : null}
                            </>
                          )}

                          {/* Sources / Citations: File name only, no modal */}
                          {!isUser && message.citations && message.citations.length > 0 && (() => {
                            const uniqueDocNames = Array.from(
                              new Set(
                                message.citations
                                  .map((c) => (c.filename || c.file_name || c.title || c.name || "").trim())
                                  .filter(Boolean)
                              )
                            )

                            if (uniqueDocNames.length === 0) return null

                            return (
                              <div className="mt-2.5 pt-2 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
                                <span className="text-[10px] font-semibold text-slate-400 mr-0.5">Sources:</span>
                                {uniqueDocNames.map((docName, idx) => (
                                  <span
                                    key={idx}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-medium"
                                    title={`Source: ${docName}`}
                                  >
                                    <FileText className="w-2.5 h-2.5 text-indigo-500 shrink-0" />
                                    <span className="max-w-[200px] truncate">{docName}</span>
                                  </span>
                                ))}
                              </div>
                            )
                          })()}

                          {/* Error banner */}
                          {!isUser && message.error && (
                            <div className="mt-2 p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-1.5">
                              <AlertCircle className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                              <span>{message.error}</span>
                            </div>
                          )}
                        </div>

                        {/* Actions under Assistant bubble */}
                        {!isUser && !message.isStreaming && message.content && (
                          <div className="flex items-center gap-2 mt-1 px-1">
                            <button
                              type="button"
                              onClick={() => handleCopyMessage(message.id, message.content)}
                              className="text-[10px] text-slate-400 hover:text-slate-700 flex items-center gap-1 transition"
                            >
                              {copiedId === message.id ? (
                                <>
                                  <Check className="w-3 h-3 text-emerald-600" />
                                  <span className="text-emerald-600 font-semibold">Copied</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3 h-3" />
                                  <span>Copy</span>
                                </>
                              )}
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={messagesEndRef} />
            </main>

            {/* Bottom Input Dock */}
            <div className="shrink-0 bg-white border-t border-slate-100 p-3 space-y-2">
              {/* Suggestion Chips */}
              {messages.length <= 2 && (
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
                  {dynamicSuggestions.map((sug, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => handleSendMessage(sug)}
                      disabled={isSending}
                      className="shrink-0 px-2.5 py-1 rounded-full bg-slate-50 border border-slate-200/90 text-slate-700 text-[11px] font-medium hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50/40 transition disabled:opacity-50"
                    >
                      {sug}
                    </button>
                  ))}
                </div>
              )}

              {/* Chat Input Container */}
              <div className="bg-slate-50 rounded-2xl border border-slate-200/90 shadow-2xs p-2 flex items-end gap-2 focus-within:border-indigo-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all">
                <textarea
                  ref={textareaRef}
                  rows={1}
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask about targets, playbooks, team performance..."
                  className="flex-1 bg-transparent border-0 resize-none text-xs text-slate-800 placeholder-slate-400 focus:outline-hidden py-1 px-1.5 max-h-28 min-h-[36px]"
                />

                <button
                  type="button"
                  onClick={() => handleSendMessage()}
                  disabled={isSending || !inputValue.trim()}
                  className="h-8 w-8 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center shrink-0 shadow-xs transition disabled:opacity-40 disabled:hover:bg-indigo-600"
                  title="Send message"
                >
                  {isSending ? (
                    <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <Send className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>

              <div className="text-center text-[10px] text-slate-400">
                AI Performance Coach • Grounded in company documents & playbooks
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Toast Notification */}
      {sharedToast && (
        <div className="fixed bottom-6 left-6 z-50 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-medium shadow-lg flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
          <Check className="w-4 h-4 text-emerald-400" />
          <span>{sharedToast}</span>
        </div>
      )}

      {/* PERSONA SETTINGS MODAL */}
      {showPersonaModal && profile && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 max-w-xl w-full p-6 sm:p-8 shadow-xl space-y-5 animate-in fade-in zoom-in-95 duration-150 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2.5 rounded-2xl bg-indigo-600 text-white shadow-xs">
                  <Settings2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className={`text-xl font-bold text-slate-900 ${cormorant.className}`}>
                    My Coaching Calibration
                  </h3>
                  <p className="text-xs text-slate-500">Your profile guides how the AI synthesizes coaching advice</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowPersonaModal(false)}
                className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Profile Summary Card or Empty Skipped State */}
            {profile.skipped_onboarding || (!profile.role_title && !profile.current_weight && !profile.three_year_vision) ? (
              <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200/80 text-center space-y-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 border border-indigo-100 text-indigo-600 mx-auto flex items-center justify-center">
                  <Compass className="w-5 h-5" />
                </div>
                <div>
                  <h4 className="text-sm font-bold text-slate-800">No profile answers set yet</h4>
                  <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto leading-relaxed">
                    You chose to share your context as you go. You can take the 4-minute coffee-chat questionnaire anytime to personalize your coaching experience.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setShowPersonaModal(false)
                    setRetakingOnboarding(true)
                  }}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition shadow-xs inline-flex items-center gap-1.5"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Start Questionnaire</span>
                </button>
              </div>
            ) : (
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-3 text-xs text-slate-700">
                <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                  <span className="font-semibold text-slate-500 uppercase tracking-wider text-[10px]">Your Role</span>
                  <span className="font-bold text-slate-900">{profile.role_title || "Not specified"}</span>
                </div>

                {profile.current_weight && (
                  <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                    <span className="font-semibold text-slate-500 uppercase tracking-wider text-[10px]">
                      Primary Stressor
                    </span>
                    <span className="font-bold text-indigo-700">{profile.current_weight}</span>
                  </div>
                )}

                <div className="flex items-center justify-between pb-2 border-b border-slate-200">
                  <span className="font-semibold text-slate-500 uppercase tracking-wider text-[10px]">
                    Coaching Tonality
                  </span>
                  <span className="font-bold capitalize text-slate-900">
                    {(profile.coaching_tone || "tactical_direct").replace("_", " ")}
                  </span>
                </div>

                {profile.three_year_vision && (
                  <div>
                    <span className="font-semibold text-slate-500 uppercase tracking-wider text-[10px] block mb-1">
                      3-Year Career Vision
                    </span>
                    <p className="text-slate-800 italic">&ldquo;{profile.three_year_vision}&rdquo;</p>
                  </div>
                )}

                {profile.time_distribution && (
                  <div>
                    <span className="font-semibold text-slate-500 uppercase tracking-wider text-[10px] block mb-1">
                      Weekly Time Profile
                    </span>
                    <div className="flex flex-wrap gap-2 text-[11px] pt-1">
                      <span className="px-2 py-0.5 rounded-md bg-indigo-50 border border-indigo-200 text-indigo-800">
                        Meetings: {profile.time_distribution.meetings ?? 0}h
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-800">
                        Reporting: {profile.time_distribution.reporting ?? 0}h
                      </span>
                      <span className="px-2 py-0.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800">
                        Field: {profile.time_distribution.field ?? 0}h
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="p-3 rounded-2xl bg-indigo-50/70 border border-indigo-200 text-xs text-indigo-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Calibrated 100% privately to your user account. Teammates cannot view this.</span>
            </div>

            {/* Modal Actions */}
            <div className="flex items-center justify-between pt-2">
              <button
                type="button"
                onClick={() => {
                  setShowPersonaModal(false)
                  setRetakingOnboarding(true)
                }}
                className="px-4 py-2 text-xs font-semibold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 rounded-xl transition"
              >
                Re-take Questionnaire
              </button>

              <button
                type="button"
                onClick={() => setShowPersonaModal(false)}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition shadow-xs"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
