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
  ChevronDown,
  Bookmark,
  BookOpen,
  Database,
  Brain,
  Code2,
  CheckCircle2,
  Loader2,
  ExternalLink,
  Share2,
  Search,
  Clock,
  MoreVertical,
  ArrowUp,
  Square,
  Maximize2,
  Minimize2,
  Target,
  Zap,
  ArrowUpRight,
  ArrowDown
} from "lucide-react"

import { useAuth } from "@/contexts/auth-context"
import { useTenant, FEATURES } from "@/contexts/tenant-context"
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
  index?: number
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
  paragraph_number?: number
  line_range?: string
  slide_number?: number
  sheet_name?: string
  row_number?: number
  section_title?: string
  eval_period?: string
  excerpt?: string
  content?: string
  text?: string
}

interface ThoughtStep {
  id: string
  step: string
  title?: string
  detail?: string
  timestamp?: number
  duration?: number
  data?: {
    query?: string
    sqlQuery?: string
    rowCount?: number
    tables?: string[]
    files?: Array<{ filename: string; page?: number; period?: string; similarity?: number }>
    intent?: string
    reason?: string
    tableCount?: number
    docCount?: number
    fileCount?: number
    chunkCount?: number
  }
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
  statusStep?: string
  thoughtSteps?: ThoughtStep[]
  thoughtDurationSeconds?: number
  isThoughtExpanded?: boolean
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
  const { hasFeature, loadingCompanies, activeCompany } = useTenant()

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
  // Collapsible Citations State (Zero Modal Popups)
  const [activeInlineCitationKey, setActiveInlineCitationKey] = useState<string | null>(null)
  const [openCitationBoxes, setOpenCitationBoxes] = useState<Record<string, boolean>>({})
  const [expandedBoxItemKey, setExpandedBoxItemKey] = useState<string | null>(null)
  const [copiedCitationText, setCopiedCitationText] = useState<boolean>(false)
  const [isChatExpanded, setIsChatExpanded] = useState<boolean>(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  // Playbooks Directory State
  const [playbooks, setPlaybooks] = useState<PlaybookItem[]>([])
  const [playbookCategories, setPlaybookCategories] = useState<string[]>([])
  const [selectedCategory, setSelectedCategory] = useState<string>("All")
  const [selectedPlaybookId, setSelectedPlaybookId] = useState<string | null>(null)
  const [loadingPlaybooks, setLoadingPlaybooks] = useState<boolean>(false)
  const [playbookSearch, setPlaybookSearch] = useState<string>("")
  const [sharedToast, setSharedToast] = useState<string | null>(null)

  // Auto-scroll ref & smooth stream handling
  const chatContainerRef = useRef<HTMLDivElement>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [showScrollBottom, setShowScrollBottom] = useState(false)
  const isNearBottomRef = useRef(true)

  const handleScroll = useCallback(() => {
    if (!chatContainerRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current
    const isNear = scrollHeight - scrollTop - clientHeight < 140
    isNearBottomRef.current = isNear
    setShowScrollBottom(!isNear)
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (!chatContainerRef.current) return
    if (behavior === "auto") {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
    }
  }, [])

  // Auto-expand textarea like ChatGPT
  const adjustTextareaHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 180)}px`
    }
  }

  // Live stream cancellation (ChatGPT stop button)
  const handleStopGeneration = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
    }
    setIsSending(false)
  }

  // Smooth jitter-free auto-scroll: direct sync during streaming, smooth when messages settle
  useEffect(() => {
    if (!chatContainerRef.current) return
    if (isNearBottomRef.current) {
      if (isSending) {
        // High-frequency token streaming: set scrollTop directly to avoid competing browser smooth animations
        chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight
      } else {
        // Message completion or user message: smooth glide
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
      }
    }
  }, [messages, isSending])

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
              setMessages([])
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

  // Active Chat Title (for header bar)
  const activeChatTitle = useMemo(() => {
    if (!activeConversationId || messages.length === 0) return "New Chat"
    const found = conversations.find((c) => c.id === activeConversationId)
    return found?.title || "New Chat"
  }, [activeConversationId, conversations, messages.length])

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
    setMessages([])
    setInputValue("")
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
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
    setMessages([])
    fetchConversations()
  }

  // Dynamic time-of-day greeting with user name
  const dynamicGreeting = useMemo(() => {
    const hour = new Date().getHours()
    const timeWord = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"
    const rawName = employeeData?.name || user?.displayName || "there"
    const firstName = rawName.trim().split(" ")[0]
    return `${timeWord}, ${firstName}`
  }, [user, employeeData])

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

  // Copy citation excerpt
  const handleCopyCitationExcerpt = (text: string) => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text)
      setCopiedCitationText(true)
      setTimeout(() => setCopiedCitationText(false), 2000)
    }
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
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto"
    }
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
      isStreaming: true,
      statusStep: "Thinking..."
    }

    setMessages((prev) => [...prev, userMessage, assistantMessage])

    try {
      const controller = new AbortController()
      abortControllerRef.current = controller

      const response = await fetchWithAuth(`${API_BASE}/api/coach/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
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

            if (data.type === "step") {
              setMessages((prev) =>
                prev.map((msg) => {
                  if (msg.id !== assistantMessageId) return msg
                  const currentSteps = msg.thoughtSteps || []
                  const stepKey = data.step
                  const existingIdx = currentSteps.findIndex((s) => s.step === stepKey)
                  let updatedSteps: ThoughtStep[]
                  if (existingIdx >= 0) {
                    updatedSteps = [...currentSteps]
                    updatedSteps[existingIdx] = {
                      ...updatedSteps[existingIdx],
                      title: data.title || updatedSteps[existingIdx].title,
                      detail: data.detail || updatedSteps[existingIdx].detail,
                      data: data.data || updatedSteps[existingIdx].data,
                      duration: data.duration ?? updatedSteps[existingIdx].duration,
                    }
                  } else {
                    updatedSteps = [
                      ...currentSteps,
                      {
                        id: `${msg.id}-${currentSteps.length}`,
                        step: data.step,
                        title: data.title,
                        detail: data.detail,
                        timestamp: data.timestamp || Date.now(),
                        duration: data.duration,
                        data: data.data,
                      },
                    ]
                  }
                  return {
                    ...msg,
                    statusStep: data.detail || data.step,
                    thoughtSteps: updatedSteps,
                    thoughtDurationSeconds: data.duration ?? msg.thoughtDurationSeconds,
                    isThoughtExpanded: msg.isThoughtExpanded ?? true,
                  }
                })
              )
            } else if (data.type === "citations") {
              setMessages((prev) =>
                prev.map((msg) => (msg.id === assistantMessageId ? { ...msg, citations: data.citations } : msg))
              )
            } else if (data.type === "token") {
              setMessages((prev) =>
                prev.map((msg) => {
                  if (msg.id !== assistantMessageId) return msg
                  const isFirstToken = msg.content.length === 0
                  return {
                    ...msg,
                    content: msg.content + data.content,
                    statusStep: undefined,
                    isThoughtExpanded: isFirstToken ? false : msg.isThoughtExpanded,
                  }
                })
              )
            } else if (data.type === "done") {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessageId
                    ? {
                        ...msg,
                        isStreaming: false,
                        intent: data.intent,
                        statusStep: undefined,
                        thoughtDurationSeconds:
                          msg.thoughtDurationSeconds ||
                          (msg.thoughtSteps && msg.thoughtSteps.length > 0 ? 2.5 : undefined),
                      }
                    : msg
                )
              )
              if (data.conversation_id) {
                setActiveConversationId(data.conversation_id)
                if (data.title) {
                  setConversations((prev) => {
                    const exists = prev.some((c) => c.id === data.conversation_id)
                    if (exists) {
                      return prev.map((c) =>
                        c.id === data.conversation_id ? { ...c, title: data.title } : c
                      )
                    } else {
                      return [
                        {
                          id: data.conversation_id,
                          title: data.title,
                          created_at: new Date().toISOString(),
                          updated_at: new Date().toISOString(),
                          message_count: 2,
                          last_message: text
                        },
                        ...prev
                      ]
                    }
                  })
                }
                fetchConversations()
              }
            } else if (data.type === "error") {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessageId
                    ? {
                        ...msg,
                        isStreaming: false,
                        error: data.message || "An error occurred while answering.",
                        statusStep: undefined
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
      if (err.name === "AbortError") {
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  isStreaming: false,
                  statusStep: undefined,
                  content: msg.content || "*(Generation stopped)*"
                }
              : msg
          )
        )
      } else {
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
      }
    } finally {
      setIsSending(false)
      abortControllerRef.current = null
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

  // Toggle thinking accordion expansion
  const toggleThoughtExpanded = (messageId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId ? { ...m, isThoughtExpanded: !m.isThoughtExpanded } : m
      )
    )
  }

  // Render Thought & Real-Time Inspection (Claude Style: Natural Prose Narrative)
  const renderThinkingAccordion = (msg: Message) => {
    const steps = msg.thoughtSteps || []
    if (steps.length === 0) return null

    // Response is considered displayed when content tokens exist OR when stream has completed
    const isResponseDisplayed = Boolean(msg.content && msg.content.length > 0) || !msg.isStreaming
    const isGenerating = msg.isStreaming && !isResponseDisplayed
    const isExpanded = msg.isThoughtExpanded ?? isGenerating
    const duration = msg.thoughtDurationSeconds || (isGenerating ? 1.8 : 2.4)

    // Build narrative paragraphs directly from the execution details
    const narrativeParagraphs = steps
      .map((s) => s.detail)
      .filter(Boolean)

    // Extract unique files reviewed
    const allFiles = steps.flatMap((s) => s.data?.files || [])
    const uniqueFiles: Array<{ filename: string; page?: number; period?: string }> = []
    const seenFiles = new Set<string>()
    for (const f of allFiles) {
      if (!seenFiles.has(f.filename)) {
        seenFiles.add(f.filename)
        uniqueFiles.push(f)
      }
    }

    return (
      <div className="mb-2.5">
        {/* Trigger Button: Pure subtle typography, ZERO container box */}
        <button
          type="button"
          onClick={() => toggleThoughtExpanded(msg.id)}
          className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-700 transition cursor-pointer py-0.5 group select-none"
        >
          {isGenerating ? (
            <span className="relative flex h-2 w-2 mr-0.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-500" />
            </span>
          ) : (
            <Brain className="w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 transition" />
          )}

          <span className="italic font-serif text-slate-500 group-hover:text-slate-800 transition">
            {isResponseDisplayed ? `Thought for ${duration}s` : `Thinking (${duration}s)...`}
          </span>

          <ChevronDown
            className={`w-3.5 h-3.5 text-slate-400 group-hover:text-slate-600 transition-transform duration-200 ${
              isExpanded ? "rotate-180" : ""
            }`}
          />
        </button>

        {/* Expanded Narrative: Smooth CSS Grid transition, ZERO nested boxes */}
        <div
          className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
            isExpanded
              ? "grid-rows-[1fr] opacity-100 my-2"
              : "grid-rows-[0fr] opacity-0 my-0 pointer-events-none"
          }`}
        >
          <div className="overflow-hidden">
            <div className="border-l-2 border-slate-200/90 pl-3.5 space-y-2 text-xs sm:text-[13px] text-slate-500 font-normal italic leading-relaxed">
              {narrativeParagraphs.map((para, pIdx) => (
                <p key={pIdx}>{para}</p>
              ))}

              {/* If source documents were reviewed, show clean subtle inline links (zero drop shadows) */}
              {uniqueFiles.length > 0 && (
                <div className="pt-1.5 not-italic text-xs space-y-1">
                  <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block">
                    Source Documents Reviewed:
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {uniqueFiles.map((file, fIdx) => (
                      <span
                        key={fIdx}
                        className="inline-flex items-center gap-1 text-[11px] text-slate-600 bg-slate-50 hover:bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200/80 transition"
                      >
                        <FileText className="w-3 h-3 text-slate-400 shrink-0" />
                        <span className="font-medium text-slate-700">{file.filename}</span>
                        {file.page && <span className="text-slate-400 text-[10px]">p. {file.page}</span>}
                        {file.period && <span className="text-slate-400 text-[10px]">({file.period})</span>}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Helper: Extract inline citations, strip them from mid-sentence, and return unique numbers
  const extractCitations = (str: string) => {
    const matches = [...str.matchAll(/\[(\d+)\]/g)].map((m) => parseInt(m[1], 10))
    const cleaned = str
      .replace(/\[\d+\]/g, "")
      .replace(/\s+([.,;:!?])/g, "$1")
      .replace(/\s{2,}/g, " ")
      .trim()
    const uniqueNums = Array.from(new Set(matches))
    return { cleaned, uniqueNums }
  }

  // Simple Markdown Parser (renders clean bold headings, bullet points, numbers, tables, code, and collapsible inline citations)
  const renderMarkdown = (text: string, citations?: Citation[], messageId?: string) => {
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

    // Render inline citation badge pills grouped at the end of a block
    const renderInlineCitations = (uniqueNums: number[], blockKey: string) => {
      if (!uniqueNums || uniqueNums.length === 0) return null

      return (
        <span className="inline-flex items-center gap-1 ml-1.5 align-baseline select-none">
          {uniqueNums.map((num) => {
            const itemKey = `${blockKey}-${num}`
            const isSelected = activeInlineCitationKey === itemKey

            return (
              <button
                key={num}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  setActiveInlineCitationKey((prev) => (prev === itemKey ? null : itemKey))
                }}
                className={`inline-flex items-center justify-center px-1.5 py-0.2 mx-0.5 text-[10px] font-bold rounded shadow-2xs cursor-pointer transition active:scale-95 ${
                  isSelected
                    ? "bg-indigo-600 text-white border border-indigo-700 ring-2 ring-indigo-300"
                    : "text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200/80"
                }`}
                title={`Toggle source evidence [${num}]`}
              >
                {num}
              </button>
            )
          })}
        </span>
      )
    }

    // Render collapsible inline card directly below the block (Zero modal popups)
    const renderActiveCitationCard = (blockKey: string) => {
      if (!activeInlineCitationKey || !activeInlineCitationKey.startsWith(`${blockKey}-`)) {
        return null
      }
      const activeNum = parseInt(activeInlineCitationKey.split("-").pop() || "", 10)
      const cit =
        citations?.find((c) => (c.index ?? 0) === activeNum) ||
        citations?.[activeNum - 1]

      if (!cit) return null

      const docName = (cit.filename || cit.file_name || cit.title || cit.name || "Document").trim()
      const locStr = cit.location || (
        cit.page_number ? `Page ${cit.page_number}` :
        cit.slide_number ? `Slide ${cit.slide_number}` :
        cit.sheet_name ? `Sheet ${cit.sheet_name}` :
        cit.paragraph_number ? `Paragraph ${cit.paragraph_number}` :
        ""
      )
      const excerpt = cit.excerpt || cit.content || cit.text || ""

      return (
        <div className="my-2 p-3 rounded-2xl bg-indigo-50/80 border border-indigo-200/90 text-xs shadow-2xs animate-in fade-in slide-in-from-top-1 duration-150 w-full text-left">
          <div className="flex items-center justify-between gap-2 pb-2 border-b border-indigo-100">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-5 h-5 rounded-md bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0 shadow-2xs">
                {cit.index ?? activeNum}
              </span>
              <span className="font-semibold text-slate-900 truncate">
                {docName}
              </span>
              {locStr && (
                <span className="text-[10px] text-indigo-700 bg-white/90 px-1.5 py-0.5 rounded border border-indigo-200/70 font-medium shrink-0">
                  {locStr}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                setActiveInlineCitationKey(null)
              }}
              className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-indigo-100/60 transition cursor-pointer"
              title="Close citation"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {excerpt && (
            <div className="mt-2 p-2.5 rounded-xl bg-white/95 border border-indigo-100/80 text-[11px] text-slate-700 leading-relaxed italic">
              <span className="not-italic font-semibold text-indigo-950">Verified Evidence: </span>
              &ldquo;{excerpt}&rdquo;
            </div>
          )}

          <div className="mt-2 flex items-center justify-between pt-1 text-[11px]">
            {excerpt ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleCopyCitationExcerpt(excerpt)
                }}
                className="text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer font-medium"
              >
                {copiedCitationText ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-600" />
                    <span className="text-emerald-600 font-semibold">Copied Excerpt</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy Excerpt</span>
                  </>
                )}
              </button>
            ) : <div />}

            {cit.document_id && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  handleDownloadPlaybookOriginal(cit.document_id!)
                }}
                className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-semibold cursor-pointer"
              >
                <span>View Original File</span>
                <ExternalLink className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )
    }

    lines.forEach((line, index) => {
      let trimmed = line.trim()

      // 1. Strip raw markdown headers (###, ##, #) and render as clean bold text
      if (/^#+\s*/.test(trimmed)) {
        if (inTable) flushTable()
        const cleanHeading = trimmed.replace(/^#+\s*/, "").replace(/#+/g, "").trim()
        if (cleanHeading) {
          elements.push(
            <p key={`head-${index}`} className="text-sm font-bold text-slate-900 mt-2.5 mb-1">
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
        const { cleaned, uniqueNums } = extractCitations(itemText)
        const blockKey = `${messageId || "msg"}-b-${index}`
        elements.push(
          <div key={`bullet-${index}`} className="my-1 pl-1">
            <div className="flex items-start gap-2 text-xs sm:text-sm text-slate-700">
              <span className="text-indigo-600 font-bold shrink-0 mt-0.5">•</span>
              <div className="flex-1 min-w-0">
                <span dangerouslySetInnerHTML={{ __html: parseInlineStyles(cleaned) }} />
                {renderInlineCitations(uniqueNums, blockKey)}
              </div>
            </div>
            {renderActiveCitationCard(blockKey)}
          </div>
        )
        return
      }

      // 4. Numbered lists: 1. Item
      const numMatch = trimmed.match(/^(\d+)\.\s+(.*)/)
      if (numMatch) {
        const { cleaned, uniqueNums } = extractCitations(numMatch[2])
        const blockKey = `${messageId || "msg"}-n-${index}`
        elements.push(
          <div key={`num-${index}`} className="my-1 pl-1">
            <div className="flex items-start gap-2 text-xs sm:text-sm text-slate-700">
              <span className="text-xs font-bold text-indigo-600 shrink-0 w-4">{numMatch[1]}.</span>
              <div className="flex-1 min-w-0">
                <span dangerouslySetInnerHTML={{ __html: parseInlineStyles(cleaned) }} />
                {renderInlineCitations(uniqueNums, blockKey)}
              </div>
            </div>
            {renderActiveCitationCard(blockKey)}
          </div>
        )
        return
      }

      // 5. Empty line
      if (!trimmed) {
        elements.push(<div key={`empty-${index}`} className="h-2" />)
        return
      }

      // 6. Normal paragraph: keep inline citations at the last of the paragraph and collapsible
      const { cleaned, uniqueNums } = extractCitations(trimmed)
      const blockKey = `${messageId || "msg"}-p-${index}`
      elements.push(
        <div key={`para-${index}`} className="my-1">
          <p className="text-xs sm:text-sm text-slate-700 leading-relaxed">
            <span dangerouslySetInnerHTML={{ __html: parseInlineStyles(cleaned) }} />
            {renderInlineCitations(uniqueNums, blockKey)}
          </p>
          {renderActiveCitationCard(blockKey)}
        </div>
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

  // Feature gating: Check if company has AI Coach enabled
  if (!loadingCompanies && activeCompany && !hasFeature(FEATURES.AI_COACH)) {
    return (
      <div className="h-screen w-full flex items-center justify-center bg-slate-50 p-6 font-sans">
        <div className="max-w-md w-full bg-white rounded-3xl border border-slate-200 p-8 text-center shadow-xs space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center mx-auto">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900">AI Performance Coach Not Enabled</h3>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              AI Performance Coach is currently disabled for {activeCompany?.name || "your company"}. Please contact your administrator to turn it on from Company Access.
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.push("/employee/welcome")}
            className="w-full py-2.5 px-4 bg-slate-900 hover:bg-black text-white text-xs font-semibold rounded-xl transition cursor-pointer"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
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
        } ${isChatExpanded ? "hidden" : "lg:flex lg:w-2/3"} h-full flex-col min-w-0 bg-slate-50/70 border-r border-slate-200/90 overflow-hidden transition-all duration-200`}
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
        } lg:flex ${
          isChatExpanded ? "lg:w-full" : "lg:w-1/3"
        } h-full flex-col min-w-0 bg-white overflow-hidden shadow-xs border-l border-slate-200/90 transition-all duration-200`}
      >
        {/* Antigravity Header Bar: [ [|]  🔍  Active Title  ⋮  +  ⤢ ] */}
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

          {/* Right Header Controls: ⋮  +  ⤢ */}
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
                      setActiveConversationId(null)
                      setMessages([])
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

            {/* Expand / Minimize Full-Width Toggle */}
            <button
              type="button"
              onClick={() => setIsChatExpanded(!isChatExpanded)}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition hidden lg:inline-flex"
              title={isChatExpanded ? "Restore split view" : "Expand chat full width"}
            >
              {isChatExpanded ? (
                <Minimize2 className="w-4 h-4" />
              ) : (
                <Maximize2 className="w-4 h-4" />
              )}
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
            <main
              ref={chatContainerRef}
              onScroll={handleScroll}
              className="flex-1 overflow-y-auto p-3 sm:p-5 space-y-4 bg-gradient-to-b from-slate-50/50 via-white to-slate-50/30 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent scroll-smooth relative"
            >
              <div className="max-w-3xl w-full mx-auto space-y-5">
                {/* Hero Welcome & Bento Prompt Cards (Shown when new chat / messages empty) */}
                {messages.length === 0 && (
                  <div className="py-6 sm:py-10 flex flex-col items-center text-center space-y-5 animate-in fade-in duration-300">
                    <div className="relative">
                      <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-violet-600 text-white flex items-center justify-center shadow-lg shadow-indigo-500/25">
                        <Sparkles className="w-6 h-6" />
                      </div>
                      <div className="absolute -inset-1 rounded-2xl bg-indigo-500/20 blur-xs animate-pulse -z-10" />
                    </div>

                    <div className="space-y-1.5 max-w-md">
                      <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
                        {dynamicGreeting}
                      </h2>
                      <p className="text-xs text-slate-500 leading-relaxed">
                        Calibrated with your company playbooks, CRM deals, and revenue metrics. What would you like to review today?
                      </p>
                    </div>

                    {/* 2x2 Bento Prompt Cards */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-xl text-left pt-2">
                      {dynamicSuggestions.map((sug, idx) => {
                        const icons = [
                          <Target key={0} className="w-4 h-4 text-indigo-600" />,
                          <BookOpen key={1} className="w-4 h-4 text-emerald-600" />,
                          <Zap key={2} className="w-4 h-4 text-amber-600" />,
                          <Sparkles key={3} className="w-4 h-4 text-violet-600" />
                        ]
                        const categories = [
                          "Quota & Pacing",
                          "Playbook Mastery",
                          "Deal Tactics",
                          "Performance Gap"
                        ]
                        return (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => handleSendMessage(sug)}
                            disabled={isSending}
                            className="group relative p-3.5 sm:p-4 rounded-2xl bg-white/95 hover:bg-white border border-slate-200/90 hover:border-indigo-300 shadow-2xs hover:shadow-md transition-all duration-200 flex flex-col justify-between gap-3 cursor-pointer hover:-translate-y-0.5 active:scale-[0.99] disabled:opacity-50"
                          >
                            <div className="flex items-center justify-between w-full">
                              <div className="flex items-center gap-2">
                                <div className="p-1.5 rounded-lg bg-slate-50 group-hover:bg-indigo-50/80 transition-colors">
                                  {icons[idx % icons.length]}
                                </div>
                                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 group-hover:text-indigo-600 transition-colors">
                                  {categories[idx % categories.length]}
                                </span>
                              </div>
                              <ArrowUpRight className="w-3.5 h-3.5 text-slate-300 group-hover:text-indigo-600 transition-colors" />
                            </div>
                            <p className="text-xs font-medium text-slate-700 group-hover:text-slate-900 leading-snug">
                              {sug}
                            </p>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {loadingActiveThread ? (
                  <div className="py-16 text-center text-xs text-slate-400">Loading conversation history...</div>
                ) : (
                  messages.map((message) => {
                    const isUser = message.role === "user"

                    return (
                      <div
                        key={message.id}
                        className={`flex gap-3 ${isUser ? "justify-end" : "justify-start"} animate-in fade-in slide-in-from-bottom-2 duration-200 ease-out`}
                      >
                        {!isUser && (
                          <div className="w-7 h-7 rounded-xl bg-gradient-to-tr from-indigo-600 via-indigo-500 to-violet-600 text-white flex items-center justify-center shrink-0 shadow-xs mt-1">
                            <Sparkles className="w-3.5 h-3.5" />
                          </div>
                        )}

                        <div className={`max-w-[88%] flex flex-col ${isUser ? "items-end" : "items-start"}`}>
                          {/* Message Bubble */}
                          <div
                            className={`p-3.5 sm:p-4 shadow-2xs transition-all duration-200 ${
                              isUser
                                ? "bg-slate-100 text-slate-800 font-normal text-xs sm:text-sm rounded-[22px] rounded-br-sm"
                                : "bg-white border border-slate-200/90 hover:border-slate-300/80 text-slate-800 rounded-2xl shadow-xs"
                            }`}
                          >
                            {isUser ? (
                              <p className="whitespace-pre-wrap">{message.content}</p>
                            ) : (
                              <>
                                {/* Real-Time Thinking & Document Inspection Accordion (ChatGPT / Claude Style) */}
                                {renderThinkingAccordion(message)}

                                {message.content ? (
                                  <div className={message.thoughtSteps && message.thoughtSteps.length > 0 ? "pt-1" : ""}>
                                    {renderMarkdown(message.content, message.citations, message.id)}
                                  </div>
                                ) : message.isStreaming && (!message.thoughtSteps || message.thoughtSteps.length === 0) ? (
                                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gradient-to-r from-indigo-50/90 via-violet-50/90 to-indigo-50/90 border border-indigo-200/70 shadow-xs text-xs text-indigo-900 font-medium animate-pulse">
                                    <span className="relative flex h-2 w-2">
                                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-500 opacity-75" />
                                      <span className="relative inline-flex rounded-full h-2 w-2 bg-indigo-600" />
                                    </span>
                                    <span className="text-xs font-medium">
                                      {message.statusStep || "Thinking through your question..."}
                                    </span>
                                  </div>
                                ) : null}
                              </>
                            )}

                            {/* Collapsible Evidence & Sources Box (Image 1) */}
                            {!isUser && message.citations && message.citations.length > 0 && (
                              <div className="mt-3 pt-2.5 border-t border-slate-100">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setOpenCitationBoxes((prev) => ({
                                      ...prev,
                                      [message.id]: !prev[message.id],
                                    }))
                                  }}
                                  className="w-full flex items-center justify-between py-1.5 px-2.5 rounded-xl bg-slate-50/90 hover:bg-slate-100/90 border border-slate-200/80 text-xs transition cursor-pointer group"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    <Bookmark className="w-3.5 h-3.5 text-indigo-600 shrink-0" />
                                    <span className="font-semibold text-slate-700 text-[11px] uppercase tracking-wider shrink-0">
                                      Evidence & Sources ({message.citations.length})
                                    </span>
                                    <div className="hidden sm:flex items-center gap-1 ml-1 overflow-hidden">
                                      {message.citations.slice(0, 5).map((c, i) => (
                                        <span
                                          key={i}
                                          className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-indigo-100/70 text-indigo-700 shrink-0"
                                        >
                                          {c.index ?? i + 1}
                                        </span>
                                      ))}
                                      {message.citations.length > 5 && (
                                        <span className="text-[10px] text-slate-400 font-medium shrink-0">
                                          +{message.citations.length - 5}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                  <div className="flex items-center gap-1 text-[11px] text-slate-400 group-hover:text-slate-700 shrink-0 ml-2">
                                    <span>{openCitationBoxes[message.id] ? "Hide" : "Show"}</span>
                                    <ChevronDown
                                      className={`w-3.5 h-3.5 transition-transform duration-200 ${
                                        openCitationBoxes[message.id] ? "rotate-180" : ""
                                      }`}
                                    />
                                  </div>
                                </button>

                                {/* Expanded Box Items with smooth CSS Grid accordion transition */}
                                <div
                                  className={`grid transition-[grid-template-rows,opacity,margin] duration-300 ease-out ${
                                    openCitationBoxes[message.id]
                                      ? "grid-rows-[1fr] opacity-100 mt-2"
                                      : "grid-rows-[0fr] opacity-0 mt-0 pointer-events-none"
                                  }`}
                                >
                                  <div className="overflow-hidden space-y-1.5">
                                    {message.citations.map((cit, idx) => {
                                      const docName = (cit.filename || cit.file_name || cit.title || cit.name || "Document").trim()
                                      const citeNum = cit.index ?? (idx + 1)
                                      const locStr = cit.location || (
                                        cit.page_number ? `Page ${cit.page_number}` :
                                        cit.slide_number ? `Slide ${cit.slide_number}` :
                                        cit.sheet_name ? `Sheet ${cit.sheet_name}` :
                                        cit.paragraph_number ? `Paragraph ${cit.paragraph_number}` :
                                        ""
                                      )
                                      const excerpt = cit.excerpt || cit.content || cit.text || ""
                                      const itemKey = `${message.id}-${citeNum}`
                                      const isItemExpanded = expandedBoxItemKey === itemKey

                                      return (
                                        <div
                                          key={idx}
                                          className="rounded-xl border border-indigo-100/90 bg-white/95 overflow-hidden transition shadow-2xs"
                                        >
                                          <div
                                            onClick={() => {
                                              setExpandedBoxItemKey((prev) => (prev === itemKey ? null : itemKey))
                                            }}
                                            className="flex items-center justify-between p-2 hover:bg-indigo-50/40 cursor-pointer transition text-xs"
                                          >
                                            <div className="flex items-center gap-2 min-w-0">
                                              <span className="w-5 h-5 rounded-md bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                                                {citeNum}
                                              </span>
                                              <span className="font-medium text-slate-800 truncate max-w-[180px] sm:max-w-[260px]">
                                                {docName}
                                              </span>
                                              {locStr && (
                                                <span className="text-[10px] text-indigo-700 bg-indigo-50/80 px-1.5 py-0.5 rounded border border-indigo-200/60 font-normal shrink-0">
                                                  {locStr}
                                                </span>
                                              )}
                                            </div>
                                            <ChevronDown
                                              className={`w-3.5 h-3.5 text-slate-400 transition-transform ${
                                                isItemExpanded ? "rotate-180" : ""
                                              }`}
                                            />
                                          </div>

                                          <div
                                            className={`grid transition-[grid-template-rows,opacity] duration-200 ease-out ${
                                              isItemExpanded
                                                ? "grid-rows-[1fr] opacity-100"
                                                : "grid-rows-[0fr] opacity-0 pointer-events-none"
                                            }`}
                                          >
                                            <div className="overflow-hidden">
                                              <div className="px-3 pb-3 pt-1 border-t border-slate-100 bg-slate-50/50 space-y-2 text-xs">
                                                {excerpt && (
                                                  <div className="p-2.5 rounded-lg bg-white border border-slate-200/80 text-[11px] text-slate-700 italic leading-relaxed">
                                                    <span className="not-italic font-semibold text-slate-900">Verified Evidence: </span>
                                                    &ldquo;{excerpt}&rdquo;
                                                  </div>
                                                )}
                                                <div className="flex items-center justify-between pt-1 text-[11px]">
                                                  {excerpt ? (
                                                    <button
                                                      type="button"
                                                      onClick={(e) => {
                                                        e.stopPropagation()
                                                        handleCopyCitationExcerpt(excerpt)
                                                      }}
                                                      className="text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer font-medium"
                                                    >
                                                      {copiedCitationText ? (
                                                        <>
                                                          <Check className="w-3 h-3 text-emerald-600" />
                                                          <span className="text-emerald-600 font-semibold">Copied Excerpt</span>
                                                        </>
                                                      ) : (
                                                        <>
                                                          <Copy className="w-3 h-3" />
                                                          <span>Copy Excerpt</span>
                                                        </>
                                                      )}
                                                    </button>
                                                  ) : <div />}
                                                  {cit.document_id && (
                                                    <button
                                                      type="button"
                                                      onClick={(e) => {
                                                        e.stopPropagation()
                                                        handleDownloadPlaybookOriginal(cit.document_id!)
                                                      }}
                                                      className="text-indigo-600 hover:text-indigo-800 font-semibold flex items-center gap-1 cursor-pointer"
                                                    >
                                                      <span>View Original File</span>
                                                      <ExternalLink className="w-3 h-3" />
                                                    </button>
                                                  )}
                                                </div>
                                              </div>
                                            </div>
                                          </div>
                                        </div>
                                      )
                                    })}
                                  </div>
                                </div>
                              </div>
                            )}

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

                {/* Floating Jump to Latest Button */}
                {showScrollBottom && (
                  <div className="sticky bottom-2 flex justify-center z-20 pointer-events-none">
                    <button
                      type="button"
                      onClick={() => scrollToBottom("smooth")}
                      className="pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/95 hover:bg-white text-slate-700 hover:text-slate-900 border border-slate-200/90 shadow-md backdrop-blur-sm transition-all duration-200 hover:scale-105 active:scale-95 animate-in fade-in zoom-in-95 cursor-pointer text-xs font-medium"
                      title="Scroll to latest"
                    >
                      <ArrowDown className="w-3.5 h-3.5 text-slate-500" />
                      <span>Scroll to latest</span>
                    </button>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
            </main>

            {/* Bottom Input Dock */}
            <div className="shrink-0 bg-white/95 backdrop-blur-md p-3 sm:p-4 border-t border-slate-100">
              <div className="max-w-3xl w-full mx-auto space-y-2">
                {/* Frosted Glassmorphism Chat Input Capsule */}
                <div className="bg-white/90 backdrop-blur-xl rounded-[28px] border border-slate-200/90 shadow-lg shadow-slate-200/50 hover:shadow-xl hover:border-slate-300 focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-500/10 transition-all p-3 flex flex-col gap-2">
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={inputValue}
                    onChange={(e) => {
                      setInputValue(e.target.value)
                      adjustTextareaHeight()
                    }}
                    onKeyDown={handleKeyDown}
                    placeholder="Ask about targets, playbooks, team performance..."
                    style={{ outline: "none", boxShadow: "none" }}
                    className="w-full bg-transparent border-0 border-transparent resize-none text-xs sm:text-sm text-slate-800 placeholder-slate-400 outline-none ring-0 focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0 shadow-none px-1.5 pt-1 max-h-44 overflow-y-auto leading-relaxed scrollbar-thin"
                  />

                  {/* Inner Action Bar */}
                  <div className="flex items-center justify-between px-1 pt-0.5">
                    {/* Left: Quick Attachment / Grounded Pill */}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          if (selectedPlaybook) {
                            setInputValue((prev) => `Review and summarize "${selectedPlaybook.title}": ` + prev)
                          } else {
                            setInputValue((prev) => "Review company playbook: " + prev)
                          }
                          adjustTextareaHeight()
                          textareaRef.current?.focus()
                        }}
                        className="p-1.5 rounded-full text-slate-500 hover:text-slate-800 hover:bg-slate-200/70 transition cursor-pointer"
                        title="Attach playbook context"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-indigo-50/80 border border-indigo-200/60 text-[10px] font-semibold text-indigo-700 hidden sm:inline-flex">
                        <Sparkles className="w-2.5 h-2.5" />
                        <span>Grounded in company playbooks & metrics</span>
                      </span>
                    </div>

                    {/* Right: Stop Generation OR Send Arrow */}
                    <div className="flex items-center gap-1.5">
                      {isSending ? (
                        <button
                          type="button"
                          onClick={handleStopGeneration}
                          className="w-8 h-8 rounded-full bg-slate-900 hover:bg-black text-white flex items-center justify-center transition active:scale-95 shadow-xs cursor-pointer group"
                          title="Stop generating"
                        >
                          <Square className="w-3.5 h-3.5 fill-current group-hover:scale-105 transition-transform" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSendMessage()}
                          disabled={!inputValue.trim()}
                          className={`w-8 h-8 rounded-full flex items-center justify-center transition active:scale-95 shadow-xs cursor-pointer ${
                            inputValue.trim()
                              ? "bg-slate-900 hover:bg-black text-white"
                              : "bg-slate-200 text-slate-400 cursor-not-allowed"
                          }`}
                          title="Send message"
                        >
                          <ArrowUp className="w-4 h-4 stroke-[2.5]" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="text-center text-[11px] text-slate-400 select-none">
                  AI can make mistakes. Always review critical details before fully relying on them.
                </div>
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
