"use client"

import React, { useState, useMemo } from "react"
import { Cormorant_Garamond } from "next/font/google"
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Sparkles,
  ShieldCheck,
  Target,
  Clock,
  Compass,
  Zap,
  TrendingUp,
  Briefcase,
  Layers,
  Smile,
  Edit3,
  Loader2
} from "lucide-react"

const cormorant = Cormorant_Garamond({ subsets: ["latin"], weight: ["700"] })

export interface CoachProfileData {
  role_title?: string
  stakeholders?: string[]
  time_distribution?: {
    meetings?: number
    reporting?: number
    field?: number
    firefighting?: number
    learning?: number
    [key: string]: any
  }
  three_year_vision?: string
  current_weight?: string
  coaching_tone?: "tactical_direct" | "inspiring" | "thought_partner"
  summary_bio?: string
  skipped_onboarding?: boolean
  [key: string]: any
}

interface CoachOnboardingProps {
  initialName?: string
  onComplete: (profile: CoachProfileData) => Promise<void>
  onSkip?: () => void
}

const STAKEHOLDER_OPTIONS = [
  {
    id: "b2b_enterprise",
    title: "B2B & Enterprise Accounts",
    desc: "Long sales cycles, RFPs, multiple decision makers and committees"
  },
  {
    id: "modern_trade",
    title: "Modern Trade & Large Retail",
    desc: "Supermarkets, buyers, category managers, shelf-space, trade schemes"
  },
  {
    id: "general_trade",
    title: "General Trade & Distributors",
    desc: "Distributors, local kiranas, beat schedules, trade schemes, credit"
  },
  {
    id: "d2c_consumer",
    title: "Direct Customers / B2C",
    desc: "Field visits, phone pitching, fast conversion, individual buyers"
  },
  {
    id: "internal_ops",
    title: "Cross-Functional / Operations",
    desc: "Managing internal teams, fulfillment, marketing, process bottlenecks"
  }
]

const VISION_OPTIONS = [
  "Running my own region or leading a high-impact team",
  "Being the go-to trusted expert whom key clients ask for by name",
  "Transitioning into strategic brand leadership or business head",
  "Consistently smashing targets so financial stress is completely gone",
  "Mastering high-stakes negotiations and executive presence",
  "Honestly, still figuring it out — I want clarity and growth"
]

const WEIGHT_OPTIONS = [
  {
    id: "hitting_numbers",
    title: "Hitting my numbers",
    sub: "Quota, sell-through, target gap, collections",
    color: "from-amber-500/10 to-orange-500/10 border-amber-300 text-amber-900"
  },
  {
    id: "energy_burnout",
    title: "My energy & bandwidth",
    sub: "Travel fatigue, long hours, feeling drained",
    color: "from-rose-500/10 to-red-500/10 border-rose-300 text-rose-900"
  },
  {
    id: "management_perception",
    title: "How I'm perceived",
    sub: "Visibility with leadership, recognition, reviews",
    color: "from-purple-500/10 to-indigo-500/10 border-purple-300 text-purple-900"
  },
  {
    id: "sticky_deals",
    title: "Sticky deals & objections",
    sub: "Price pushback, delayed approvals, stalled POs",
    color: "from-blue-500/10 to-cyan-500/10 border-blue-300 text-blue-900"
  },
  {
    id: "career_growth",
    title: "Where my career is going",
    sub: "Next role, sideways moves, feeling plateaued",
    color: "from-emerald-500/10 to-teal-500/10 border-emerald-300 text-emerald-900"
  }
]

const TONE_OPTIONS = [
  {
    id: "tactical_direct",
    icon: Target,
    title: "Tactical & Direct",
    subtitle: "Give it to me straight",
    desc: "Crisp bullet points, concrete numbers, immediate next steps. Zero corporate fluff."
  },
  {
    id: "inspiring",
    icon: Zap,
    title: "Inspiring & High-Energy",
    subtitle: "Keep momentum high",
    desc: "Acknowledge progress, frame gaps positively, celebrate small wins to keep confidence strong."
  },
  {
    id: "thought_partner",
    icon: Compass,
    title: "Strategic Thought-Partner",
    subtitle: "Unpack root causes",
    desc: "Ask deep coaching questions, provide market benchmarks, challenge my thinking with data."
  }
]

export default function CoachOnboarding({ initialName = "there", onComplete, onSkip }: CoachOnboardingProps) {
  const [currentStep, setCurrentStep] = useState(0)
  const [saving, setSaving] = useState(false)

  // Form State
  const [roleTitle, setRoleTitle] = useState("")
  const [selectedStakeholders, setSelectedStakeholders] = useState<string[]>(["modern_trade"])
  const [timeDistribution, setTimeDistribution] = useState({
    meetings: 18,
    reporting: 14,
    field: 10,
    firefighting: 5,
    learning: 3
  })
  const [selectedVision, setSelectedVision] = useState(VISION_OPTIONS[1])
  const [selectedWeight, setSelectedWeight] = useState(WEIGHT_OPTIONS[0].title)
  const [selectedTone, setSelectedTone] = useState<"tactical_direct" | "inspiring" | "thought_partner">("tactical_direct")

  // Total Hours calculation
  const totalHours = useMemo(() => {
    return Object.values(timeDistribution).reduce((a, b) => a + b, 0)
  }, [timeDistribution])

  const toggleStakeholder = (id: string) => {
    if (selectedStakeholders.includes(id)) {
      if (selectedStakeholders.length > 1) {
        setSelectedStakeholders(selectedStakeholders.filter((s) => s !== id))
      }
    } else {
      setSelectedStakeholders([...selectedStakeholders, id])
    }
  }

  const handleTimeChange = (key: keyof typeof timeDistribution, val: number) => {
    setTimeDistribution((prev) => ({
      ...prev,
      [key]: Math.max(0, val)
    }))
  }

  // Synthesis summary generator
  const generatedSummaryBio = useMemo(() => {
    const roleText = roleTitle.trim() || "Commercial & Account Professional"
    const stText = selectedStakeholders
      .map((s) => STAKEHOLDER_OPTIONS.find((opt) => opt.id === s)?.title || s)
      .join(", ")
    return `${roleText} working with ${stText}. Spends ~${timeDistribution.reporting}h weekly on reporting and ~${timeDistribution.meetings}h on meetings. 3-year ambition: ${selectedVision}. Immediate focus: ${selectedWeight}.`
  }, [roleTitle, selectedStakeholders, timeDistribution, selectedVision, selectedWeight])

  const handleFinalSubmit = async () => {
    try {
      setSaving(true)
      const payload: CoachProfileData = {
        role_title: roleTitle.trim() || "Area Commercial Specialist",
        stakeholders: selectedStakeholders,
        time_distribution: timeDistribution,
        three_year_vision: selectedVision,
        current_weight: selectedWeight,
        coaching_tone: selectedTone,
        summary_bio: generatedSummaryBio
      }
      await onComplete(payload)
    } finally {
      setSaving(false)
    }
  }

  const totalSteps = 6 // 0: intro, 1: domain, 2: time, 3: ambition, 4: stressor, 5: tone, 6: summary

  return (
    <div className="min-h-screen bg-slate-50/70 flex flex-col justify-between py-6 sm:py-10 px-4 sm:px-6 font-sans">
      {/* Top Header Bar */}
      <div className="max-w-2xl w-full mx-auto flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 animate-pulse" />
          <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
            Performance Coach • Onboarding
          </span>
        </div>

        {currentStep > 0 && currentStep <= totalSteps && (
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-slate-500">
              {currentStep} of {totalSteps}
            </span>
            <div className="w-24 sm:w-32 h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-600 transition-all duration-300 rounded-full"
                style={{ width: `${(currentStep / totalSteps) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Main Interactive Container */}
      <div className="max-w-2xl w-full mx-auto my-auto py-6">
        <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm p-6 sm:p-10 transition-all">
          {/* STEP 0: WELCOME & PSYCHOLOGICAL SAFETY */}
          {currentStep === 0 && (
            <div className="space-y-6 animate-in fade-in duration-300">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-semibold">
                <Sparkles className="w-3.5 h-3.5" />
                <span>Personalized Intelligence Setup</span>
              </div>

              <div>
                <h1 className={`text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight ${cormorant.className}`}>
                  Hi {initialName}. <br />
                  <span className="italic font-normal text-slate-600">I&apos;m not here to grade you.</span>
                </h1>
                <p className="mt-3 text-slate-600 text-sm sm:text-base leading-relaxed">
                  I&apos;m your AI Performance Coach. Before I give you advice on your sales figures or quotas, I&apos;d
                  like to understand how you actually work — the way a great manager would over coffee.
                </p>
              </div>

              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>100% Private to You</span>
                </div>
                <p className="text-xs text-slate-500 leading-normal">
                  Your manager and teammates never see your answers. This profile is used solely to calibrate my coaching
                  tone, time-saving tips, and tactical recommendations for you.
                </p>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row items-center gap-3">
                <button
                  type="button"
                  onClick={() => setCurrentStep(1)}
                  className="w-full sm:w-auto px-6 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition shadow-xs flex items-center justify-center gap-2"
                >
                  <span>Let&apos;s talk</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                {onSkip && (
                  <button
                    type="button"
                    onClick={onSkip}
                    className="w-full sm:w-auto px-5 py-3 text-xs font-medium text-slate-500 hover:text-slate-800 transition"
                  >
                    I&apos;d rather tell you as we go
                  </button>
                )}
              </div>
            </div>
          )}

          {/* STEP 1: STAKEHOLDERS & DOMAIN */}
          {currentStep === 1 && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div>
                <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">
                  Stakeholders & Market Context
                </span>
                <h2 className={`text-2xl sm:text-3xl font-bold text-slate-900 mt-1 ${cormorant.className}`}>
                  Who do you deal with, on a normal Tuesday?
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 mt-1">
                  Most people do a mix. Pick everything that applies to your day-to-day.
                </p>
              </div>

              <div className="space-y-2.5">
                {STAKEHOLDER_OPTIONS.map((item) => {
                  const isSelected = selectedStakeholders.includes(item.id)
                  return (
                    <div
                      key={item.id}
                      onClick={() => toggleStakeholder(item.id)}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-start justify-between gap-3 ${
                        isSelected
                          ? "border-indigo-600 bg-indigo-50/50 shadow-2xs"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50"
                      }`}
                    >
                      <div>
                        <div className={`text-sm font-semibold ${isSelected ? "text-indigo-950" : "text-slate-800"}`}>
                          {item.title}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">{item.desc}</div>
                      </div>
                      <div
                        className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 mt-0.5 transition ${
                          isSelected ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300 bg-white"
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 stroke-[3]" />}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Freeform Role Title */}
              <div className="pt-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Your specific role, in your words:
                </label>
                <input
                  type="text"
                  value={roleTitle}
                  onChange={(e) => setRoleTitle(e.target.value)}
                  placeholder="e.g. Key Account Manager, Large Format Retail (West)"
                  className="w-full px-4 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition"
                />
              </div>

              {/* Navigation */}
              <div className="pt-4 flex items-center justify-between border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCurrentStep(0)}
                  className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 transition flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition shadow-xs flex items-center gap-1.5"
                >
                  <span>Next</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: TIME & ENERGY ALLOCATION */}
          {currentStep === 2 && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div>
                <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">
                  Time & Energy Reality
                </span>
                <h2 className={`text-2xl sm:text-3xl font-bold text-slate-900 mt-1 ${cormorant.className}`}>
                  Roughly, where do your 50 hours a week go?
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 mt-1">
                  Adjust hours to reflect your reality. Rough estimates are completely fine.
                </p>
              </div>

              {/* Visual Multi-Segment Bar */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-500 font-medium">
                  <span>Estimated Total:</span>
                  <span className="font-bold text-slate-800">{totalHours} hrs / week</span>
                </div>
                <div className="h-3 w-full bg-slate-100 rounded-full overflow-hidden flex shadow-inner">
                  <div
                    style={{ width: `${(timeDistribution.meetings / totalHours) * 100}%` }}
                    className="bg-indigo-600 transition-all duration-200"
                    title={`Client Meetings: ${timeDistribution.meetings}h`}
                  />
                  <div
                    style={{ width: `${(timeDistribution.reporting / totalHours) * 100}%` }}
                    className="bg-amber-500 transition-all duration-200"
                    title={`Reporting: ${timeDistribution.reporting}h`}
                  />
                  <div
                    style={{ width: `${(timeDistribution.field / totalHours) * 100}%` }}
                    className="bg-emerald-500 transition-all duration-200"
                    title={`Field/Outlets: ${timeDistribution.field}h`}
                  />
                  <div
                    style={{ width: `${(timeDistribution.firefighting / totalHours) * 100}%` }}
                    className="bg-rose-500 transition-all duration-200"
                    title={`Firefighting: ${timeDistribution.firefighting}h`}
                  />
                  <div
                    style={{ width: `${(timeDistribution.learning / totalHours) * 100}%` }}
                    className="bg-purple-500 transition-all duration-200"
                    title={`Strategy/Learning: ${timeDistribution.learning}h`}
                  />
                </div>
                <div className="flex flex-wrap gap-3 text-[11px] text-slate-500 pt-1">
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-indigo-600" /> Buyer Meetings ({timeDistribution.meetings}h)
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-amber-500" /> Reporting & Spreadsheets ({timeDistribution.reporting}h)
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" /> Store/Field Visits ({timeDistribution.field}h)
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full bg-rose-500" /> Escalations/Collections ({timeDistribution.firefighting}h)
                  </span>
                </div>
              </div>

              {/* Sliders */}
              <div className="space-y-4 pt-2">
                <div>
                  <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                    <span>Buyer / Client Meetings</span>
                    <span className="text-indigo-600 font-bold">{timeDistribution.meetings} hrs</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={35}
                    value={timeDistribution.meetings}
                    onChange={(e) => handleTimeChange("meetings", parseInt(e.target.value))}
                    className="w-full accent-indigo-600"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                    <span>Reporting, Admin & Spreadsheets</span>
                    <span className="text-amber-600 font-bold">{timeDistribution.reporting} hrs</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={30}
                    value={timeDistribution.reporting}
                    onChange={(e) => handleTimeChange("reporting", parseInt(e.target.value))}
                    className="w-full accent-amber-500"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                    <span>Field, Store & Beat Visits</span>
                    <span className="text-emerald-600 font-bold">{timeDistribution.field} hrs</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={25}
                    value={timeDistribution.field}
                    onChange={(e) => handleTimeChange("field", parseInt(e.target.value))}
                    className="w-full accent-emerald-500"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-xs font-semibold text-slate-700 mb-1">
                    <span>Firefighting, Stock Delays & Payment Follow-ups</span>
                    <span className="text-rose-600 font-bold">{timeDistribution.firefighting} hrs</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={20}
                    value={timeDistribution.firefighting}
                    onChange={(e) => handleTimeChange("firefighting", parseInt(e.target.value))}
                    className="w-full accent-rose-500"
                  />
                </div>
              </div>

              {/* Live AI Insight Callout */}
              {timeDistribution.reporting >= 12 && (
                <div className="p-3.5 rounded-2xl bg-amber-50/70 border border-amber-200/80 text-xs text-amber-900 flex items-start gap-2.5">
                  <Sparkles className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p>
                    <span className="font-semibold">Coach Note:</span> Spending {timeDistribution.reporting} hours on
                    reporting is very common, but it drains selling time. I will actively compute numbers and draft
                    summaries directly from your uploaded spreadsheets to give you hours back.
                  </p>
                </div>
              )}

              {/* Navigation */}
              <div className="pt-4 flex items-center justify-between border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCurrentStep(1)}
                  className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 transition flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentStep(3)}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition shadow-xs flex items-center gap-1.5"
                >
                  <span>Next</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 3: 3-YEAR CAREER ASPIRATION */}
          {currentStep === 3 && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div>
                <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">
                  Intrinsic Motivation
                </span>
                <h2 className={`text-2xl sm:text-3xl font-bold text-slate-900 mt-1 ${cormorant.className}`}>
                  Forget job titles for a second. Three years from now, what would make you proud?
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 mt-1">
                  Choose the statement that feels most genuine to you right now.
                </p>
              </div>

              <div className="space-y-2.5">
                {VISION_OPTIONS.map((opt) => {
                  const isSelected = selectedVision === opt
                  return (
                    <div
                      key={opt}
                      onClick={() => setSelectedVision(opt)}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-center justify-between gap-3 ${
                        isSelected
                          ? "border-indigo-600 bg-indigo-50/50 text-indigo-950 font-semibold shadow-2xs"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50/60"
                      }`}
                    >
                      <span className="text-xs sm:text-sm leading-snug">&ldquo;{opt}&rdquo;</span>
                      <div
                        className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                          isSelected ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300"
                        }`}
                      >
                        {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Navigation */}
              <div className="pt-4 flex items-center justify-between border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 transition flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentStep(4)}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition shadow-xs flex items-center gap-1.5"
                >
                  <span>Next</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 4: CURRENT WEIGHT / PRIMARY STRESSOR */}
          {currentStep === 4 && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div>
                <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">
                  Current Priority & Friction
                </span>
                <h2 className={`text-2xl sm:text-3xl font-bold text-slate-900 mt-1 ${cormorant.className}`}>
                  What&apos;s weighing on you the most right now?
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 mt-1">
                  Select your primary focus area. We will anchor our very first coaching sprint around this.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {WEIGHT_OPTIONS.map((item) => {
                  const isSelected = selectedWeight === item.title
                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedWeight(item.title)}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer flex flex-col justify-between ${
                        isSelected
                          ? `border-indigo-600 bg-indigo-50/60 shadow-xs ring-2 ring-indigo-500/20`
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50"
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className={`text-sm font-bold ${isSelected ? "text-indigo-950" : "text-slate-800"}`}>
                          {item.title}
                        </div>
                        <div
                          className={`w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                            isSelected ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-300"
                          }`}
                        >
                          {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                        </div>
                      </div>
                      <div className="text-xs text-slate-500 mt-2">{item.sub}</div>
                    </div>
                  )
                })}
              </div>

              <div className="p-3.5 rounded-2xl bg-indigo-50/70 border border-indigo-200 text-xs text-indigo-900 flex items-center gap-2">
                <Target className="w-4 h-4 text-indigo-600 shrink-0" />
                <span>
                  Our initial coaching recommendations will directly focus on{" "}
                  <strong>&ldquo;{selectedWeight}&rdquo;</strong>.
                </span>
              </div>

              {/* Navigation */}
              <div className="pt-4 flex items-center justify-between border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCurrentStep(3)}
                  className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 transition flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentStep(5)}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition shadow-xs flex items-center gap-1.5"
                >
                  <span>Next</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 5: COACHING TONALITY */}
          {currentStep === 5 && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div>
                <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">
                  Coaching Tonality & Style
                </span>
                <h2 className={`text-2xl sm:text-3xl font-bold text-slate-900 mt-1 ${cormorant.className}`}>
                  How do you prefer your coaching advice delivered?
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 mt-1">
                  I will calibrate my response depth, formatting, and tone to match your personality.
                </p>
              </div>

              <div className="space-y-3">
                {TONE_OPTIONS.map((item) => {
                  const isSelected = selectedTone === item.id
                  const Icon = item.icon
                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedTone(item.id as any)}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-start gap-4 ${
                        isSelected
                          ? "border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-500/20 shadow-xs"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/50"
                      }`}
                    >
                      <div
                        className={`p-2.5 rounded-xl shrink-0 ${
                          isSelected ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        <Icon className="w-5 h-5" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between">
                          <span className={`text-sm font-bold ${isSelected ? "text-indigo-950" : "text-slate-800"}`}>
                            {item.title}
                          </span>
                          <span className="text-[11px] font-medium text-slate-400">{item.subtitle}</span>
                        </div>
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">{item.desc}</p>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Navigation */}
              <div className="pt-4 flex items-center justify-between border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setCurrentStep(4)}
                  className="px-4 py-2 text-xs font-semibold text-slate-500 hover:text-slate-800 transition flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCurrentStep(6)}
                  className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-xl transition shadow-xs flex items-center gap-1.5"
                >
                  <span>Review Profile</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 6: AI REFLECTION & CONFIRMATION */}
          {currentStep === 6 && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div>
                <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wider">
                  Personalized Reflection
                </span>
                <h2 className={`text-2xl sm:text-3xl font-bold text-slate-900 mt-1 ${cormorant.className}`}>
                  Here&apos;s what I heard...
                </h2>
                <p className="text-xs sm:text-sm text-slate-500 mt-1">
                  Check if this captures you accurately before we start our first session.
                </p>
              </div>

              {/* Reflection Card */}
              <div className="p-6 rounded-2xl bg-slate-50/90 border border-slate-200 space-y-4 text-slate-700 text-sm leading-relaxed">
                <p>
                  You work as a{" "}
                  <strong className="text-slate-900 font-semibold">{roleTitle.trim() || "Commercial Specialist"}</strong>
                  , primarily partnering with{" "}
                  <strong className="text-slate-900 font-semibold">
                    {selectedStakeholders
                      .map((s) => STAKEHOLDER_OPTIONS.find((o) => o.id === s)?.title)
                      .filter(Boolean)
                      .join(", ")}
                  </strong>
                  .
                </p>

                <p>
                  Reporting & spreadsheets consume roughly{" "}
                  <strong className="text-slate-900 font-semibold">{timeDistribution.reporting} hours</strong> of your
                  week alongside{" "}
                  <strong className="text-slate-900 font-semibold">{timeDistribution.meetings} hours</strong> in buyer
                  meetings.
                </p>

                <p>
                  In three years, you want to be proud of{" "}
                  <span className="text-indigo-900 font-semibold italic">&ldquo;{selectedVision}&rdquo;</span>.
                </p>

                <p>
                  Right now,{" "}
                  <strong className="text-indigo-900 font-semibold">&ldquo;{selectedWeight}&rdquo;</strong> is your
                  heaviest priority. You prefer coaching delivered in a{" "}
                  <strong className="text-slate-900 font-semibold">
                    {TONE_OPTIONS.find((t) => t.id === selectedTone)?.title}
                  </strong>{" "}
                  style.
                </p>

                <div className="pt-2 border-t border-slate-200 text-xs text-slate-500 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Your manager never sees this unless you choose to share it.</span>
                </div>
              </div>

              <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setCurrentStep(1)}
                  disabled={saving}
                  className="w-full sm:w-auto px-4 py-2.5 text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 rounded-xl transition flex items-center justify-center gap-1.5"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Fix something</span>
                </button>

                <button
                  type="button"
                  onClick={handleFinalSubmit}
                  disabled={saving}
                  className="w-full sm:w-auto px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl transition shadow-xs flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Calibrating Coach...</span>
                    </>
                  ) : (
                    <>
                      <span>Yes, that&apos;s me — Start Coaching</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="max-w-2xl w-full mx-auto text-center text-xs text-slate-400">
        Lucid AI Coach • Designed for Personal Growth & Commercial Excellence
      </div>
    </div>
  )
}

