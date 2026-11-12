"use client"

import React, { useState, useEffect, useRef, useMemo } from "react"
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
  ChevronRight
} from "lucide-react"

import { useAuth } from "@/contexts/auth-context"
import { fetchWithAuth } from "@/lib/fetch-with-auth"
import CoachOnboarding, { CoachProfileData } from "./components/CoachOnboarding"

const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["700"] })
const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || ""

interface Citation {
  document_id?: string
  filename?: string
  file_name?: string
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
  const { user } = useAuth()

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
  const [sidebarOpen, setSidebarOpen] = useState<boolean>(true)
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null)
  const [editTitleValue, setEditTitleValue] = useState<string>("")

  // Chat State
  const [messages, setMessages] = useState<Message[]>([])
  const [inputValue, setInputValue] = useState<string>("")
  const [isSending, setIsSending] = useState<boolean>(false)
  const [activeCitation, setActiveCitation] = useState<Citation | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  // Auto-scroll ref
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

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

  // Load a specific conversation thread
  const handleSelectConversation = async (convId: string) => {
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

  // Group threads by recency (Today, Yesterday, Previous 7 Days, Older)
  const groupedConversations = useMemo(() => {
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

    conversations.forEach((c) => {
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
  }, [conversations])

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
          target_employee_name: user?.name || user?.displayName || undefined,
          target_employee_id: user?.uid || undefined,
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
    <div className="h-screen w-full bg-slate-50/70 flex overflow-hidden font-sans">
      {/* ==================================================================== */}
      {/* 1. LEFT SIDEBAR: THREAD HISTORY (ChatGPT / Modern Chatbot Style)      */}
      {/* ==================================================================== */}
      <aside
        className={`${
          sidebarOpen ? "w-64 sm:w-72" : "w-0 -translate-x-full"
        } transition-all duration-300 ease-in-out shrink-0 bg-white border-r border-slate-200/90 flex flex-col z-30 h-full overflow-hidden`}
      >
        {/* Sidebar Header */}
        <div className="p-3.5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-xs">
              <Sparkles className="w-4 h-4" />
            </div>
            <span className={`text-base font-bold text-slate-900 tracking-tight ${cormorant.className}`}>
              Coach Threads
            </span>
          </div>

          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition"
            title="Collapse sidebar"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>

        {/* New Chat Button */}
        <div className="p-3">
          <button
            type="button"
            onClick={handleNewChat}
            className="w-full flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl bg-indigo-50/80 hover:bg-indigo-100 border border-indigo-200/80 text-indigo-700 text-xs font-semibold shadow-2xs transition"
          >
            <Plus className="w-4 h-4" />
            <span>New Chat</span>
          </button>
        </div>

        {/* Scrollable Conversation Threads List */}
        <div className="flex-1 overflow-y-auto px-2 py-1 space-y-4">
          {conversations.length === 0 ? (
            <div className="text-center py-10 px-3">
              <MessageSquare className="w-6 h-6 text-slate-300 mx-auto mb-2" />
              <p className="text-xs text-slate-500 font-medium">No previous conversations yet</p>
              <p className="text-[11px] text-slate-400 mt-0.5">Your chat threads will appear here</p>
            </div>
          ) : (
            groupedConversations.map(([groupLabel, items]) => (
              <div key={groupLabel} className="space-y-1">
                <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
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
                          : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
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

                      {/* Thread Hover Action Buttons */}
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

        {/* Sidebar Footer */}
        <div className="p-3 border-t border-slate-100 space-y-1.5 bg-slate-50/50">
          <button
            type="button"
            onClick={() => setShowPersonaModal(true)}
            className="w-full flex items-center justify-between px-2.5 py-2 rounded-xl text-xs font-semibold text-slate-700 hover:bg-white border border-transparent hover:border-slate-200 transition"
          >
            <div className="flex items-center gap-2">
              <Settings2 className="w-3.5 h-3.5 text-indigo-600" />
              <span>My Persona</span>
            </div>
            <ChevronRight className="w-3.5 h-3.5 text-slate-400" />
          </button>

          <button
            type="button"
            onClick={() => router.push("/employee/welcome")}
            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-xs font-medium text-slate-500 hover:text-slate-800 hover:bg-white border border-transparent hover:border-slate-200 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Dashboard</span>
          </button>
        </div>
      </aside>

      {/* ==================================================================== */}
      {/* 2. MAIN CHAT WORKSPACE (Right Panel)                                 */}
      {/* ==================================================================== */}
      <div className="flex-1 flex flex-col h-full overflow-hidden bg-slate-50/70">
        {/* TOP WORKSPACE BAR */}
        <header className="shrink-0 bg-white/90 backdrop-blur-md border-b border-slate-200/90 px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            {!sidebarOpen && (
              <button
                type="button"
                onClick={() => setSidebarOpen(true)}
                className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition"
                title="Open thread history"
              >
                <PanelLeft className="w-4 h-4" />
              </button>
            )}

            <div>
              <div className="flex items-center gap-2">
                <h1 className={`text-lg font-bold text-slate-900 tracking-tight leading-none ${cormorant.className}`}>
                  Performance Coach
                </h1>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Active
                </span>
              </div>
              <p className="text-[11px] text-slate-500 hidden sm:block mt-0.5">
                {profile?.role_title
                  ? `Calibrated for ${profile.role_title} • Private & confidential`
                  : "Private & confidential performance coaching partner"}
              </p>
            </div>
          </div>

          {/* Right Action Tools */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleNewChat}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 text-xs font-semibold shadow-2xs transition"
              title="Start a fresh chat"
            >
              <Plus className="w-3.5 h-3.5 text-indigo-600" />
              <span className="hidden sm:inline">New Chat</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (profile) seedWelcomeMessage(profile)
              }}
              className="p-2 rounded-xl border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 text-xs transition"
              title="Reset current chat"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* MAIN MESSAGES STREAM */}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 flex flex-col justify-between">
          <div className="max-w-3xl w-full mx-auto space-y-5 pb-8">
            {loadingActiveThread ? (
              <div className="py-16 text-center text-xs text-slate-400">Loading conversation history...</div>
            ) : (
              messages.map((message) => {
                const isUser = message.role === "user"

                return (
                  <div
                    key={message.id}
                    className={`flex gap-3 sm:gap-4 ${isUser ? "justify-end" : "justify-start"} animate-in fade-in duration-200`}
                  >
                    {!isUser && (
                      <div className="w-8 h-8 rounded-xl bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-xs mt-1">
                        <Sparkles className="w-4 h-4" />
                      </div>
                    )}

                    <div className={`max-w-[85%] sm:max-w-[78%] flex flex-col ${isUser ? "items-end" : "items-start"}`}>
                      {/* Direct Message Bubble */}
                      <div
                        className={`rounded-2xl p-4 sm:p-5 shadow-2xs transition-all ${
                          isUser
                            ? "bg-indigo-600 text-white font-medium text-xs sm:text-sm rounded-tr-xs"
                            : "bg-white border border-slate-200/90 text-slate-800 rounded-tl-xs"
                        }`}
                      >
                        {/* Direct Content */}
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

                        {/* Citations Badges */}
                        {!isUser && message.citations && message.citations.length > 0 && (
                          <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
                            <span className="text-[10px] font-semibold text-slate-400 mr-1">Sources:</span>
                            {message.citations.map((c, cIdx) => {
                              const displayName = c.filename || c.file_name || `Source ${cIdx + 1}`
                              return (
                                <button
                                  key={cIdx}
                                  type="button"
                                  onClick={() => setActiveCitation(c)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100/90 hover:bg-indigo-50 border border-slate-200 text-slate-600 hover:text-indigo-700 text-[10px] font-medium transition shadow-2xs"
                                  title="Click to view verified excerpt"
                                >
                                  <FileText className="w-2.5 h-2.5 text-indigo-500 shrink-0" />
                                  <span className="max-w-[150px] truncate">{displayName}</span>
                                  {c.page_number && <span className="text-slate-400 font-mono text-[9px]">p.{c.page_number}</span>}
                                </button>
                              )
                            })}
                          </div>
                        )}

                        {/* Error Banner if any */}
                        {!isUser && message.error && (
                          <div className="mt-2 p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs flex items-center gap-1.5">
                            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
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
                            className="text-[11px] text-slate-400 hover:text-slate-700 flex items-center gap-1 transition"
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
          </div>
        </main>

        {/* BOTTOM INPUT DOCK */}
        <div className="shrink-0 bg-linear-to-t from-slate-50 via-slate-50/95 to-transparent pb-4 px-4 sm:px-6">
          <div className="max-w-3xl w-full mx-auto space-y-2.5">
            {/* Suggestion Chips */}
            {messages.length <= 2 && (
              <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
                <span className="text-[11px] font-semibold text-slate-400 shrink-0 flex items-center gap-1 pl-1">
                  <Sparkles className="w-3 h-3 text-indigo-500" />
                  Suggested:
                </span>
                {dynamicSuggestions.map((sug, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleSendMessage(sug)}
                    disabled={isSending}
                    className="shrink-0 px-3 py-1.5 rounded-full bg-white border border-slate-200/90 text-slate-700 text-xs font-medium hover:border-indigo-400 hover:text-indigo-600 hover:bg-indigo-50/40 shadow-2xs transition disabled:opacity-50"
                  >
                    {sug}
                  </button>
                ))}
              </div>
            )}

            {/* Chat Input Container */}
            <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm p-2 sm:p-2.5 flex items-end gap-2 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20 transition-all">
              <textarea
                ref={textareaRef}
                rows={1}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask about your metrics, team rankings, playbooks, or time optimization..."
                className="flex-1 bg-transparent border-0 resize-none text-xs sm:text-sm text-slate-800 placeholder-slate-400 focus:outline-hidden py-1.5 px-2 max-h-32 min-h-[38px]"
              />

              <button
                type="button"
                onClick={() => handleSendMessage()}
                disabled={isSending || !inputValue.trim()}
                className="h-9 w-9 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center shrink-0 shadow-xs transition disabled:opacity-40 disabled:hover:bg-indigo-600"
                title="Send message"
              >
                {isSending ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </button>
            </div>

            <div className="text-center text-[11px] text-slate-400">
              Lucid AI Performance Coach • Synthesized using verified business data & authorized playbooks
            </div>
          </div>
        </div>
      </div>

      {/* CITATION MODAL / DRAWER */}
      {activeCitation && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl border border-slate-200 max-w-lg w-full p-6 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-3 min-w-0">
                <div className="p-2.5 rounded-xl bg-indigo-50 text-indigo-600 border border-indigo-100 shrink-0">
                  <FileText className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-900 truncate" title={activeCitation.filename || activeCitation.file_name}>
                    {activeCitation.filename || activeCitation.file_name || "Document Citation"}
                  </h3>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-500 font-medium mt-0.5">
                    {activeCitation.location && (
                      <span className="text-indigo-600 font-semibold">{activeCitation.location}</span>
                    )}
                    <span className="text-slate-400 font-mono">
                      Chunk #{activeCitation.chunk_index ?? 0}
                    </span>
                    {(activeCitation.score !== undefined || activeCitation.similarity !== undefined) && (
                      <span className="text-emerald-600 font-semibold">
                        • {(((activeCitation.score ?? activeCitation.similarity ?? 0)) * 100).toFixed(0)}% Match
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveCitation(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs sm:text-sm text-slate-700 font-sans leading-relaxed max-h-72 overflow-y-auto whitespace-pre-wrap">
              {activeCitation.excerpt || activeCitation.content || "No excerpt text available for this citation."}
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setActiveCitation(null)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition shadow-xs"
              >
                Close Preview
              </button>
            </div>
          </div>
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
