"use client";

import React, { useState, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Trophy,
  Shield,
  Zap,
  BookOpen,
  CheckCircle2,
  XCircle,
  Lock,
  Star,
  Award,
  Search,
  Building2,
  Clock,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Swords,
  Brain,
  X,
  Flame,
  Volume2,
  VolumeX,
  Check,
  RotateCcw,
  HelpCircle,
  Layers as LayersIcon,
  FileSearch,
  ListOrdered,
  ShieldAlert,
  Target,
  Users,
  AlertTriangle
} from "lucide-react";

// ==========================================
// WEB AUDIO SOUND EFFECTS UTILITY
// ==========================================
let isAudioMuted = false;

const setGlobalAudioMute = (muted: boolean) => {
  isAudioMuted = muted;
};

const playSound = (type: "tap" | "correct" | "incorrect" | "complete") => {
  if (isAudioMuted || typeof window === "undefined") return;
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    const ctx = new AudioContextClass();

    if (type === "tap") {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(450, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(750, ctx.currentTime + 0.05);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    } else if (type === "correct") {
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.07);
        gain.gain.setValueAtTime(0.18, ctx.currentTime + idx * 0.07);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.07 + 0.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.07);
        osc.stop(ctx.currentTime + idx * 0.07 + 0.2);
      });
    } else if (type === "incorrect") {
      const notes = [220, 174.61]; // A3, F3
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.12);
        gain.gain.setValueAtTime(0.18, ctx.currentTime + idx * 0.12);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + idx * 0.12 + 0.18);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.12);
        osc.stop(ctx.currentTime + idx * 0.12 + 0.18);
      });
    } else if (type === "complete") {
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, ctx.currentTime + idx * 0.09);
        gain.gain.setValueAtTime(0.2, ctx.currentTime + idx * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + idx * 0.09 + 0.3);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(ctx.currentTime + idx * 0.09);
        osc.stop(ctx.currentTime + idx * 0.09 + 0.3);
      });
    }
  } catch (e) {
    // Ignore audio context autoplay errors
  }
};

// ==========================================
// TYPES & MOCK DATA
// ==========================================

interface CompanyTenant {
  company_id: string;
  company_name: string;
  domain: string;
  logo_symbol: string;
  primary_color: string;
}

const COMPANIES: CompanyTenant[] = [
  {
    company_id: "bc335f5e-e0a4-48ee-94d1-4d47f06ccb6d",
    company_name: "Workfloww.ai",
    domain: "workfloww.ai",
    logo_symbol: "⭐",
    primary_color: "from-indigo-600 to-blue-600",
  },
  {
    company_id: "company_apex_99",
    company_name: "Apex Global Systems",
    domain: "apexglobal.com",
    logo_symbol: "🔺",
    primary_color: "from-blue-600 to-cyan-600",
  },
  {
    company_id: "company_nexus_42",
    company_name: "Nexus Innovations",
    domain: "nexusinnovations.tech",
    logo_symbol: "⚡",
    primary_color: "from-emerald-600 to-teal-600",
  },
];

interface LeaderboardUser {
  id: string;
  name: string;
  role: string;
  company_id: string;
  sprints_completed: number;
  xp: number;
  badges_count: number;
  avatar_color: string;
}

const MOCK_LEADERBOARD_USERS: LeaderboardUser[] = [
  { id: "u1", name: "Yomit Khurana (You)", role: "Chief Governance Officer", company_id: "bc335f5e-e0a4-48ee-94d1-4d47f06ccb6d", sprints_completed: 4, xp: 5200, badges_count: 14, avatar_color: "bg-indigo-600" },
  { id: "u2", name: "Riya Jhamb", role: "Compliance Lead", company_id: "bc335f5e-e0a4-48ee-94d1-4d47f06ccb6d", sprints_completed: 4, xp: 4850, badges_count: 12, avatar_color: "bg-purple-600" },
  { id: "u3", name: "Manish Chum", role: "VP Risk & Audit", company_id: "bc335f5e-e0a4-48ee-94d1-4d47f06ccb6d", sprints_completed: 3, xp: 4120, badges_count: 10, avatar_color: "bg-blue-600" },
  { id: "u4", name: "Ansh Gahoi", role: "Senior Statutory Analyst", company_id: "bc335f5e-e0a4-48ee-94d1-4d47f06ccb6d", sprints_completed: 3, xp: 3650, badges_count: 8, avatar_color: "bg-emerald-600" },
  { id: "u5", name: "Khwaish Gahoi", role: "Operations Specialist", company_id: "bc335f5e-e0a4-48ee-94d1-4d47f06ccb6d", sprints_completed: 2, xp: 2980, badges_count: 6, avatar_color: "bg-rose-600" },
  { id: "u6", name: "Monalika Goel", role: "Legal & Policy Lead", company_id: "bc335f5e-e0a4-48ee-94d1-4d47f06ccb6d", sprints_completed: 2, xp: 2450, badges_count: 5, avatar_color: "bg-amber-600" },
  { id: "u7", name: "Shilpa Chitkara", role: "Audit Associate", company_id: "bc335f5e-e0a4-48ee-94d1-4d47f06ccb6d", sprints_completed: 1, xp: 1890, badges_count: 3, avatar_color: "bg-teal-600" },
];

export default function EmployeeGamifiedArenaPage() {
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>("bc335f5e-e0a4-48ee-94d1-4d47f06ccb6d");
  const [activeTab, setActiveTab] = useState<"sprints" | "fill-blanks" | "case-study" | "matching" | "flashcards" | "process-flow" | "fraud-spotter" | "mcq" | "pvp-duel" | "leaderboard" | "vault">("sprints");
  const [userXp, setUserXp] = useState<number>(3450);

  // ... (rest of logic remains continuous) ...
  const [completedActivities, setCompletedActivities] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [soundMuted, setSoundMuted] = useState<boolean>(false);
  const [streakDays, setStreakDays] = useState<number>(5);
  const [streakModalOpen, setStreakModalOpen] = useState<boolean>(false);
  const [lastActiveDateStr, setLastActiveDateStr] = useState<string>("Today");
  const [hasCompletedDrillToday, setHasCompletedDrillToday] = useState<boolean>(false);

  // Auto-check streak on load
  React.useEffect(() => {
    try {
      const todayStr = new Date().toISOString().split("T")[0];
      const savedDate = localStorage.getItem("employee_streak_last_date");
      const savedDays = localStorage.getItem("employee_streak_days");

      if (savedDays !== null) {
        setStreakDays(parseInt(savedDays, 10));
      }

      if (savedDate) {
        const lastDate = new Date(savedDate);
        const today = new Date(todayStr);
        const diffTime = Math.abs(today.getTime() - lastDate.getTime());
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (diffDays === 0) {
          setHasCompletedDrillToday(true);
          setLastActiveDateStr("Today");
        } else if (diffDays === 1) {
          setHasCompletedDrillToday(false);
          setLastActiveDateStr("Yesterday");
        } else if (diffDays > 1) {
          // Missed 1+ days -> Automatically reset streak to 0!
          setStreakDays(0);
          setHasCompletedDrillToday(false);
          setLastActiveDateStr("Missed 1+ Days Ago");
          localStorage.setItem("employee_streak_days", "0");
        }
      }
    } catch (e) {
      // Fallback if localStorage unavailable
    }
  }, []);

  const toggleSound = () => {
    const nextMuted = !soundMuted;
    setSoundMuted(nextMuted);
    setGlobalAudioMute(nextMuted);
    if (!nextMuted) playSound("tap");
  };

  const currentCompany = useMemo(() => {
    return COMPANIES.find((c) => c.company_id === selectedCompanyId) || COMPANIES[0];
  }, [selectedCompanyId]);

  const companyUsers = useMemo(() => {
    return MOCK_LEADERBOARD_USERS.filter((u) => u.company_id === selectedCompanyId).sort((a, b) => b.xp - a.xp);
  }, [selectedCompanyId]);

  const filteredLeaderboard = useMemo(() => {
    return companyUsers.filter((u) => u.name.toLowerCase().includes(searchQuery.toLowerCase()) || u.role.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [companyUsers, searchQuery]);

  // Automatically increment streak when user completes ANY drill activity today!
  const claimReward = (activityId: string, xpReward: number) => {
    if (!completedActivities[activityId]) {
      setCompletedActivities((prev) => ({ ...prev, [activityId]: true }));
      setUserXp((prev) => prev + xpReward);
      playSound("complete");

      // Auto streak increment
      if (!hasCompletedDrillToday) {
        const todayStr = new Date().toISOString().split("T")[0];
        const newStreak = streakDays + 1;
        setStreakDays(newStreak);
        setHasCompletedDrillToday(true);
        setLastActiveDateStr("Today");
        try {
          localStorage.setItem("employee_streak_days", newStreak.toString());
          localStorage.setItem("employee_streak_last_date", todayStr);
        } catch (e) { }
      }
    }
  };

  const completedCount = Object.keys(completedActivities).length;
  const totalActivities = 8;

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 font-sans selection:bg-indigo-500 selection:text-white pb-16">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(99,102,241,0.05),rgba(255,255,255,0))]" />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
        {/* TOP COMPACT HEADER */}
        <header className="rounded-3xl bg-white border border-slate-200/80 p-5 shadow-sm space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            {/* TOP LEFT BRANDING & BACK BUTTON */}
            <div className="flex items-center gap-3">
              {activeTab !== "sprints" && (
                <button
                  onClick={() => {
                    playSound("tap");
                    setActiveTab("sprints");
                  }}
                  className="px-3 py-1.5 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-4 h-4 text-slate-600" />
                  <span className="leading-none">Study Mode</span>
                </button>
              )}

              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                    Workfloww.ai Arena ⚡
                  </h1>
                </div>
              </div>
            </div>

            {/* TOP RIGHT ACTION BAR (Sound, Leaderboard, Badges, Streak, XP) */}
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Sound Toggle */}
              <button
                onClick={toggleSound}
                title={soundMuted ? "Unmute audio effects" : "Mute audio effects"}
                className={`p-2 rounded-2xl border transition-all cursor-pointer shadow-2xs flex items-center justify-center ${soundMuted
                  ? "bg-slate-100 text-slate-400 border-slate-200"
                  : "bg-indigo-50 text-indigo-600 border-indigo-200 hover:bg-indigo-100"
                  }`}
              >
                {soundMuted ? <VolumeX className="w-4 h-4 text-slate-400" /> : <Volume2 className="w-4 h-4 text-indigo-600" />}
              </button>

              {/* Leaderboard Button */}
              <button
                onClick={() => {
                  playSound("tap");
                  setActiveTab("leaderboard");
                }}
                className={`px-3.5 py-2 rounded-2xl border text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${activeTab === "leaderboard"
                  ? "bg-amber-500 text-white border-amber-500 shadow-sm"
                  : "bg-amber-50 hover:bg-amber-100 text-amber-900 border-amber-200/80"
                  }`}
              >
                <Trophy className="w-4 h-4 text-amber-500" />
                <span>Leaderboard</span>
              </button>

              {/* Badges Vault Button */}
              <button
                onClick={() => {
                  playSound("tap");
                  setActiveTab("vault");
                }}
                className={`px-3.5 py-2 rounded-2xl border text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${activeTab === "vault"
                  ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                  : "bg-indigo-50 hover:bg-indigo-100 text-indigo-900 border-indigo-200/80"
                  }`}
              >
                <Shield className="w-4 h-4 text-indigo-600" />
                <span>Badges</span>
              </button>

              {/* Active Streak Counter Pill */}
              <div
                onClick={() => {
                  playSound("tap");
                  setStreakModalOpen(true);
                }}
                className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 text-rose-700 px-3.5 py-2 rounded-2xl text-xs font-extrabold cursor-pointer hover:bg-rose-100 transition-all shadow-2xs"
              >
                <Flame className="w-4 h-4 text-rose-500 fill-rose-500 animate-bounce" />
                <span>{streakDays} Day Streak 🔥</span>
              </div>

              {/* User Total XP Badge */}
              <div className="flex items-center gap-1.5 bg-indigo-50 border border-indigo-100 text-indigo-700 px-3.5 py-2 rounded-2xl text-xs font-black shadow-2xs">
                <Sparkles className="w-4 h-4 fill-indigo-500 text-indigo-600" />
                <span>+{userXp} XP</span>
              </div>
            </div>
          </div>

          {/* BOTTOM ROW: DRILL FORMAT PILLS (Only shown when active in a drill) */}
          {["fill-blanks", "case-study", "matching", "flashcards", "process-flow", "fraud-spotter", "mcq", "pvp-duel"].includes(activeTab) && (
            <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center gap-1.5">
              {[
                { id: "fill-blanks", label: "1. Fill Blanks ✍️", count: completedActivities["fill-blanks"] ? "✓" : "1", icon: Brain },
                { id: "case-study", label: "2. Vibe Check 🕵️‍♂️", count: completedActivities["case-study"] ? "✓" : "2", icon: BookOpen },
                { id: "matching", label: "3. Risk Rizz 🧩", count: completedActivities["matching"] ? "✓" : "3", icon: Sparkles },
                { id: "flashcards", label: "4. Code Breaker 🔓", count: completedActivities["flashcards"] ? "✓" : "4", icon: Lock },
                { id: "process-flow", label: "5. Flow Master 🔄", count: completedActivities["process-flow"] ? "✓" : "5", icon: ListOrdered },
                { id: "fraud-spotter", label: "6. Audit Spotter 🔍", count: completedActivities["fraud-spotter"] ? "✓" : "6", icon: FileSearch },
                { id: "mcq", label: "7. Speed Run ⏱️", count: completedActivities["mcq"] ? "✓" : "7", icon: Clock },
                { id: "pvp-duel", label: "8. 1v1 AI Duel ⚔️", count: completedActivities["pvp-duel"] ? "✓" : "8", icon: Swords },
              ].map((tab) => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => {
                      playSound("tap");
                      setActiveTab(tab.id as any);
                    }}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap border shrink-0 cursor-pointer ${isActive
                      ? "bg-slate-900 text-white border-slate-900 shadow-sm"
                      : "bg-slate-50 hover:bg-slate-100 text-slate-700 border-slate-200/80"
                      }`}
                  >
                    <Icon className={`w-3.5 h-3.5 ${isActive ? "text-cyan-400" : "text-slate-500"}`} />
                    <span>{tab.label}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.2 rounded-md font-black ${isActive ? "bg-white/20 text-white" : "bg-slate-200/80 text-slate-600"
                        }`}
                    >
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </header>

        {/* DRILL PROGRESS BAR — Only rendered during active questionnaire drills */}
        {["fill-blanks", "case-study", "matching", "flashcards", "process-flow", "fraud-spotter", "mcq", "pvp-duel"].includes(activeTab) && (
          <div className="space-y-1.5 px-1">
            <div className="flex items-center justify-between text-xs font-bold text-slate-600">
              <span>Drill {completedCount + 1} of {totalActivities}</span>
              <span>Accuracy: {completedCount > 0 ? Math.round((completedCount / totalActivities) * 100) : 0}%</span>
            </div>
            <div className="w-full h-2 bg-slate-200/80 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-indigo-500 via-purple-500 to-amber-500 transition-all duration-500 rounded-full"
                style={{ width: `${(completedCount / totalActivities) * 100}%` }}
              />
            </div>
          </div>
        )}

        {activeTab === "sprints" && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100">
                  STUDY MODE CURRICULUM
                </span>
                <h2 className="text-xl font-black text-slate-900 mt-2 flex items-center gap-2">
                  <Swords className="w-5 h-5 text-indigo-600" /> Sprint Roadmap & Learning Path
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Master company statutory policies step-by-step. Complete active Sprints to unlock advanced Raid modules!
                </p>
              </div>
              <div className="flex items-center gap-3 bg-slate-50 px-4 py-3 rounded-2xl border border-slate-200">
                <Trophy className="w-5 h-5 text-amber-500 shrink-0" />
                <div className="text-xs font-bold text-slate-700">
                  <div>1 of 4 Sprints Unlocked</div>
                  <div className="text-[10px] text-slate-400 font-normal">Sprint 1 Active</div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {[
                {
                  id: 1,
                  title: "Sprint 1: Policy Surrender Fundamentals",
                  desc: "Master voluntary termination, surrender value factors, process flow, audit spotter, and 1v1 PvP Arena Duel.",
                  unlocked: true,
                  status: completedActivities["pvp-duel"] ? "COMPLETED ✓" : "ACTIVE & UNLOCKED",
                  drillsCount: "8 Interactive Drills",
                  reward: "+1,800 XP Total",
                  badge: "Surrender Guardian Badge",
                  bg: "bg-white border-indigo-500 ring-2 ring-indigo-500/10 shadow-md",
                },
                {
                  id: 2,
                  title: "Sprint 2: Process & Eligibility Criteria",
                  desc: "Master ULIP vs Traditional lock-in periods, submission channels, 10km distance, and 10 Lakh amount rules.",
                  unlocked: !!completedActivities["pvp-duel"],
                  status: completedActivities["pvp-duel"] ? "ACTIVE & UNLOCKED 🎉" : "LOCKED 🔒",
                  drillsCount: "5 Advanced Drills",
                  reward: "+1,200 XP",
                  badge: "Eligibility Master Badge",
                  prereq: completedActivities["pvp-duel"] ? "" : "Complete Sprint 1 Drills to Unlock",
                  bg: completedActivities["pvp-duel"] ? "bg-white border-emerald-500 ring-2 ring-emerald-500/10 shadow-md" : "bg-slate-100/70 border-slate-200 opacity-75",
                },
                {
                  id: 3,
                  title: "Sprint 3: Documentation & Customer Assistance",
                  desc: "Verify Original Policy Documents, masked Aadhaar, Tasha digital assistant, and Senior Citizen/NRI protocols.",
                  unlocked: false,
                  status: "LOCKED 🔒",
                  drillsCount: "6 Interactive Drills",
                  reward: "+1,500 XP",
                  badge: "Documentation Expert Badge",
                  prereq: "Requires Sprint 2 Completion",
                  bg: "bg-slate-100/70 border-slate-200 opacity-75",
                },
                {
                  id: 4,
                  title: "Sprint 4: Calling Script & VOC Masterclass",
                  desc: "Execute 3-point customer verification (Bank, Nominee, DOB), Hold/Refresh, and 1-5 scale VOC survey transfer.",
                  unlocked: false,
                  status: "LOCKED 🔒",
                  drillsCount: "8 Master Drills",
                  reward: "+2,500 XP & Trophy",
                  badge: "VOC Master Champion",
                  prereq: "Requires Sprint 3 Completion",
                  bg: "bg-slate-100/70 border-slate-200 opacity-75",
                },
              ].map((sprint) => (
                <div
                  key={sprint.id}
                  className={`p-6 rounded-3xl border flex flex-col justify-between transition-all relative overflow-hidden ${sprint.bg}`}
                >
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <span
                        className={`text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-full ${sprint.unlocked
                          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                          : "bg-slate-200 text-slate-600"
                          }`}
                      >
                        {sprint.status}
                      </span>
                      {sprint.unlocked ? (
                        <Sparkles className="w-5 h-5 text-indigo-600 animate-pulse" />
                      ) : (
                        <Lock className="w-5 h-5 text-slate-400" />
                      )}
                    </div>

                    <div>
                      <h3 className="text-base font-black text-slate-900">{sprint.title}</h3>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">{sprint.desc}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs font-bold pt-2 border-t border-slate-100">
                      <span className="text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-lg">
                        {sprint.drillsCount}
                      </span>
                      <span className="text-amber-600 bg-amber-50 px-2.5 py-1 rounded-lg">
                        {sprint.reward}
                      </span>
                    </div>

                    {!sprint.unlocked && (
                      <div className="text-[11px] font-semibold text-rose-600 bg-rose-50 p-2.5 rounded-xl border border-rose-100 flex items-center gap-1.5">
                        <Lock className="w-3.5 h-3.5 shrink-0" />
                        <span>{sprint.prereq}</span>
                      </div>
                    )}
                  </div>

                  <div className="mt-6">
                    {sprint.unlocked ? (
                      <button
                        onClick={() => {
                          playSound("tap");
                          setActiveTab("fill-blanks");
                        }}
                        className="w-full py-3 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs transition-all shadow-md shadow-indigo-600/20 flex items-center justify-center gap-2 cursor-pointer"
                      >
                        Enter Sprint 1 Arena <ArrowRight className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        disabled
                        className="w-full py-3 px-4 rounded-2xl bg-slate-200 text-slate-500 font-bold text-xs cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        <Lock className="w-4 h-4" /> Locked Sprint
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "fill-blanks" && (
          <div className="rounded-3xl bg-white border border-slate-200/90 p-6 sm:p-8 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="px-3.5 py-1.5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-black uppercase tracking-wider">DRILL 1: FILL IN THE BLANKS</span>
                <span className="text-xs font-bold text-slate-500">Policy Terms & Definitions</span>
              </div>
              <span className="px-3.5 py-1.5 rounded-full bg-rose-50 text-rose-600 border border-rose-100 text-xs font-black flex items-center gap-1">
                <Flame className="w-3.5 h-3.5 text-rose-500" /> +150 XP
              </span>
            </div>
            <FillBlanksSolver onComplete={(earnedXp) => { claimReward("fill-blanks", earnedXp); setActiveTab("case-study"); }} isAlreadyCompleted={!!completedActivities["fill-blanks"]} />
          </div>
        )}

        {activeTab === "case-study" && (
          <div className="rounded-3xl bg-white border border-slate-200/90 p-6 sm:p-8 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="px-3.5 py-1.5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-black uppercase tracking-wider">DRILL 2: VIBE CHECK (TRUE / FALSE)</span>
                <span className="text-xs font-bold text-slate-500">Procedural Rules Dilemma</span>
              </div>
              <span className="px-3.5 py-1.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 text-xs font-black">+250 XP</span>
            </div>
            <CaseStudySolver onComplete={(earnedXp) => { claimReward("case-study", earnedXp); setActiveTab("matching"); }} isAlreadyCompleted={!!completedActivities["case-study"]} />
          </div>
        )}

        {activeTab === "matching" && (
          <div className="rounded-3xl bg-white border border-slate-200/90 p-6 sm:p-8 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="px-3.5 py-1.5 rounded-full bg-purple-100 text-purple-700 text-xs font-black uppercase tracking-wider">DRILL 3: RISK RIZZ (MATCHING PAIRS)</span>
                <span className="text-xs font-bold text-slate-500">Requirements & Action Matrix</span>
              </div>
              <span className="px-3.5 py-1.5 rounded-full bg-purple-50 text-purple-700 border border-purple-100 text-xs font-black">+200 XP</span>
            </div>
            <MatchingPairsSolver onComplete={(earnedXp) => { claimReward("matching", earnedXp); setActiveTab("flashcards"); }} isAlreadyCompleted={!!completedActivities["matching"]} />
          </div>
        )}

        {activeTab === "flashcards" && (
          <div className="rounded-3xl bg-white border border-slate-200/90 p-6 sm:p-8 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="px-3.5 py-1.5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-black uppercase tracking-wider">DRILL 4: CODE BREAKER 🔓</span>
                <span className="text-xs font-bold text-slate-500">Decipher Policy Terms</span>
              </div>
              <span className="px-3.5 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-100 text-xs font-black">+150 XP</span>
            </div>
            <CodeBreakerSolver onComplete={(earnedXp) => { claimReward("flashcards", earnedXp); setActiveTab("process-flow"); }} isAlreadyCompleted={!!completedActivities["flashcards"]} />
          </div>
        )}

        {activeTab === "process-flow" && (
          <div className="rounded-3xl bg-white border border-slate-200/90 p-6 sm:p-8 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="px-3.5 py-1.5 rounded-full bg-cyan-100 text-cyan-700 text-xs font-black uppercase tracking-wider">DRILL 5: FLOW MASTER 🔄</span>
                <span className="text-xs font-bold text-slate-500">Step-by-Step Sequence Builder</span>
              </div>
              <span className="px-3.5 py-1.5 rounded-full bg-cyan-50 text-cyan-700 border border-cyan-100 text-xs font-black">+250 XP</span>
            </div>
            <ProcessFlowSolver onComplete={(earnedXp) => { claimReward("process-flow", earnedXp); setActiveTab("fraud-spotter"); }} isAlreadyCompleted={!!completedActivities["process-flow"]} />
          </div>
        )}

        {activeTab === "fraud-spotter" && (
          <div className="rounded-3xl bg-white border border-slate-200/90 p-6 sm:p-8 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="px-3.5 py-1.5 rounded-full bg-amber-100 text-amber-800 text-xs font-black uppercase tracking-wider">DRILL 6: AUDIT SPOTTER 🔍</span>
                <span className="text-xs font-bold text-slate-500">Document Inspection Red-Flag Hunter</span>
              </div>
              <span className="px-3.5 py-1.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100 text-xs font-black">+200 XP</span>
            </div>
            <FraudSpotterSolver onComplete={(earnedXp) => { claimReward("fraud-spotter", earnedXp); setActiveTab("mcq"); }} isAlreadyCompleted={!!completedActivities["fraud-spotter"]} />
          </div>
        )}

        {activeTab === "mcq" && (
          <div className="rounded-3xl bg-white border border-slate-200/90 p-6 sm:p-8 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="px-3.5 py-1.5 rounded-full bg-rose-100 text-rose-700 text-xs font-black uppercase tracking-wider">DRILL 7: TIMED SPEED QUIZ ⏱️</span>
                <span className="text-xs font-bold text-slate-500">Verification Protocol Challenge</span>
              </div>
              <span className="px-3.5 py-1.5 rounded-full bg-rose-50 text-rose-700 border border-rose-100 text-xs font-black">+300 XP</span>
            </div>
            <McqSpeedQuizSolver onComplete={(earnedXp) => { claimReward("mcq", earnedXp); setActiveTab("pvp-duel"); }} isAlreadyCompleted={!!completedActivities["mcq"]} />
          </div>
        )}

        {activeTab === "pvp-duel" && (
          <div className="rounded-3xl bg-white border border-slate-200/90 p-6 sm:p-8 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="px-3.5 py-1.5 rounded-full bg-cyan-600 text-white text-xs font-black uppercase tracking-wider shadow-sm flex items-center gap-1.5">
                  <Swords className="w-3.5 h-3.5" /> DRILL 8: 1V1 HUMAN VS AI ARENA DUEL ⚔️
                </span>
                <span className="text-xs font-bold text-slate-500">Real-Time AI Sentinel Clash</span>
              </div>
              <span className="px-3.5 py-1.5 rounded-full bg-rose-50 text-rose-700 border border-rose-100 text-xs font-black">+400 XP Glory</span>
            </div>
            <PvpDuelSolver onComplete={(earnedXp) => { claimReward("pvp-duel", earnedXp); setActiveTab("sprints"); }} isAlreadyCompleted={!!completedActivities["pvp-duel"]} />
          </div>
        )}

        {activeTab === "leaderboard" && (
          <div className="space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <div>
                <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
                  <Trophy className="w-5 h-5 text-amber-500" /> Enterprise Governance Leaderboard
                </h2>
                <p className="text-xs text-slate-500 mt-1">Top statutory compliance performers across enterprise divisions</p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search employee..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-indigo-500 font-medium"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {filteredLeaderboard.slice(0, 3).map((user, idx) => {
                const crowns = ["🥇 1st Place", "🥈 2nd Place", "🥉 3rd Place"];
                const borderColors = ["border-amber-300 bg-amber-50/40", "border-slate-300 bg-slate-50", "border-amber-600/20 bg-amber-50/20"];
                return (
                  <div key={user.id} className={`p-5 rounded-3xl border ${borderColors[idx]} text-center flex flex-col items-center justify-between shadow-sm relative`}>
                    <span className="text-xs font-black text-amber-700 mb-2">{crowns[idx]}</span>
                    <div className={`w-14 h-14 rounded-full ${user.avatar_color} text-white font-black text-lg flex items-center justify-center border-2 border-white mb-3 shadow-xs`}>
                      {user.name.split(" ").map((n) => n[0]).join("")}
                    </div>
                    <h3 className="text-sm font-bold text-slate-900">{user.name}</h3>
                    <p className="text-xs text-slate-500">{user.role}</p>
                    <div className="mt-4 flex items-center justify-center gap-3 text-xs font-bold bg-white px-4 py-2 rounded-2xl border border-slate-200 w-full shadow-xs">
                      <span className="text-amber-600">{user.xp.toLocaleString()} XP</span>
                      <span>•</span>
                      <span className="text-slate-700">{user.badges_count} Badges</span>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="rounded-3xl bg-white border border-slate-200 shadow-sm overflow-hidden">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 text-slate-600 font-bold border-b border-slate-200 uppercase tracking-wider">
                  <tr>
                    <th className="py-4 px-6">Rank</th>
                    <th className="py-4 px-6">Employee</th>
                    <th className="py-4 px-6">Role</th>
                    <th className="py-4 px-6 text-center">Sprints</th>
                    <th className="py-4 px-6 text-center">Badges</th>
                    <th className="py-4 px-6 text-right">Total XP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(searchQuery ? filteredLeaderboard : filteredLeaderboard.slice(3)).map((user, index) => {
                    const actualRank = searchQuery ? filteredLeaderboard.findIndex((u) => u.id === user.id) + 1 : index + 4;
                    return (
                      <tr
                        key={user.id}
                        className={`hover:bg-slate-50 transition-colors ${user.name.includes("(You)") ? "bg-indigo-50/50 font-bold" : ""
                          }`}
                      >
                        <td className="py-4 px-6 font-black text-indigo-600">#{actualRank}</td>
                        <td className="py-4 px-6 font-bold text-slate-900">{user.name}</td>
                        <td className="py-4 px-6 text-slate-500">{user.role}</td>
                        <td className="py-4 px-6 text-center font-semibold">{user.sprints_completed} / 4</td>
                        <td className="py-4 px-6 text-center font-black text-indigo-700">{user.badges_count}</td>
                        <td className="py-4 px-6 text-right font-black text-amber-600">{user.xp.toLocaleString()} XP</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "vault" && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h2 className="text-xl font-black text-slate-900 flex items-center gap-2">
                  <Shield className="w-5 h-5 text-indigo-600" /> Achievement Badges & Milestones
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Generalised milestone badges automatically unlocked as you complete statutory drills, streaks, and earn XP.
                </p>
              </div>
              <div className="px-4 py-2 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-700 text-xs font-black shrink-0">
                {[
                  completedCount >= 1,
                  completedCount >= 3,
                  completedCount === 5,
                  streakDays >= 3,
                  streakDays >= 7,
                  userXp >= 1000,
                ].filter(Boolean).length}{" "}
                / 6 Badges Unlocked
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
              {[
                {
                  id: "badge_1",
                  title: "Main Character 🎯",
                  category: "Drill Milestone",
                  desc: "Complete your 1st interactive drill",
                  icon: Brain,
                  unlocked: completedCount >= 1,
                  iconBg: "bg-indigo-50 text-indigo-600 border-indigo-100",
                },
                {
                  id: "badge_2",
                  title: "Locked In 🔒",
                  category: "Drill Milestone",
                  desc: "Complete 3 statutory drills",
                  icon: BookOpen,
                  unlocked: completedCount >= 3,
                  iconBg: "bg-blue-50 text-blue-600 border-blue-100",
                },
                {
                  id: "badge_3",
                  title: "G.O.A.T. Certified 🏆",
                  category: "Sprint Milestone",
                  desc: "Finish all 5 Sprint 1 drills",
                  icon: Trophy,
                  unlocked: completedCount === 5,
                  iconBg: "bg-amber-50 text-amber-600 border-amber-100",
                },
                {
                  id: "badge_4",
                  title: "On Fire 🔥",
                  category: "Streak Milestone",
                  desc: "Maintain a 3-day active streak",
                  icon: Flame,
                  unlocked: streakDays >= 3,
                  iconBg: "bg-rose-50 text-rose-600 border-rose-100",
                },
                {
                  id: "badge_5",
                  title: "Unstoppable ⚡",
                  category: "Streak Milestone",
                  desc: "Maintain a 7-day active streak",
                  icon: Zap,
                  unlocked: streakDays >= 7,
                  iconBg: "bg-purple-50 text-purple-600 border-purple-100",
                },
                {
                  id: "badge_6",
                  title: "XP Billionaire 🌟",
                  category: "XP Milestone",
                  desc: "Reach 1,000+ total earned XP",
                  icon: Sparkles,
                  unlocked: userXp >= 1000,
                  iconBg: "bg-emerald-50 text-emerald-600 border-emerald-100",
                },
              ].map((badge) => {
                const Icon = badge.icon;
                return (
                  <div
                    key={badge.id}
                    className={`p-6 rounded-3xl border text-center flex flex-col items-center justify-between transition-all ${badge.unlocked
                      ? "bg-white border-indigo-200 shadow-sm"
                      : "bg-slate-50/80 border-slate-200 opacity-60 grayscale"
                      }`}
                  >
                    <span className="text-[10px] font-black uppercase tracking-wider text-indigo-600 mb-2">
                      {badge.category}
                    </span>
                    <div className={`w-14 h-14 rounded-2xl border ${badge.iconBg} flex items-center justify-center mb-3 shadow-2xs`}>
                      <Icon className="w-7 h-7" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">{badge.title}</h3>
                      <p className="text-xs text-slate-500 mt-1 mb-4">{badge.desc}</p>
                    </div>
                    <span
                      className={`w-full py-2 px-3 rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 ${badge.unlocked
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                        : "bg-slate-200/80 text-slate-600"
                        }`}
                    >
                      {badge.unlocked ? (
                        <>
                          <Check className="w-3.5 h-3.5 stroke-[3]" /> Unlocked
                        </>
                      ) : (
                        <>
                          <Lock className="w-3.5 h-3.5" /> Locked
                        </>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {/* INTERACTIVE ACTIVE STREAK MODAL OVERLAY */}
        <AnimatePresence>
          {streakModalOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4"
            >
              <motion.div
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl border border-slate-200 space-y-6 relative overflow-hidden text-center"
              >
                <button
                  onClick={() => {
                    playSound("tap");
                    setStreakModalOpen(false);
                  }}
                  className="absolute top-5 right-5 p-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 transition-all cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>

                <div className="w-16 h-16 rounded-full bg-rose-50 border-2 border-rose-200 text-rose-500 flex items-center justify-center mx-auto shadow-inner">
                  <Flame className={`w-8 h-8 ${streakDays > 0 ? "fill-rose-500 animate-pulse" : "text-slate-400"}`} />
                </div>

                <div>
                  <span className="text-[10px] font-black text-rose-600 uppercase tracking-widest bg-rose-50 px-3 py-1 rounded-full border border-rose-100">
                    DAILY STREAK COUNTER
                  </span>
                  <h3 className="text-3xl font-black text-slate-900 mt-2">
                    {streakDays} {streakDays === 1 ? "Day" : "Days"} Streak
                  </h3>
                  <p className="text-xs font-semibold text-slate-500 mt-1">
                    {streakDays > 0
                      ? "🔥 You're on fire! Keep completing daily statutory drills."
                      : "❄️ Your streak was reset to 0 because a day was missed."}
                  </p>
                </div>

                {/* Days Tracker Visual Pills */}
                <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                  <div className="text-[11px] font-bold text-slate-600 flex justify-between">
                    <span>Weekly Streak Calendar</span>
                    <span className="text-indigo-600 font-extrabold">Last Active: {lastActiveDateStr}</span>
                  </div>
                  <div className="grid grid-cols-7 gap-1.5 pt-1">
                    {["M", "T", "W", "T", "F", "S", "S"].map((day, idx) => {
                      const isCompletedDay = idx < Math.min(streakDays, 7);
                      return (
                        <div
                          key={idx}
                          className={`h-9 rounded-xl flex flex-col items-center justify-center text-[10px] font-black transition-all ${isCompletedDay
                            ? "bg-rose-500 text-white shadow-xs"
                            : "bg-white text-slate-400 border border-slate-200"
                            }`}
                        >
                          <span>{day}</span>
                          {isCompletedDay && <Flame className="w-2.5 h-2.5 fill-white text-white" />}
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="text-[11px] text-slate-500 leading-relaxed bg-amber-50 p-3 rounded-2xl border border-amber-100 text-amber-900 font-medium">
                  ⚡ <strong>Streak Rule:</strong> Complete at least 1 drill per day. If you miss a day without checking in, your streak automatically resets to 0.
                </div>

                <div className="pt-1">
                  <button
                    onClick={() => {
                      playSound("tap");
                      setStreakModalOpen(false);
                    }}
                    className="w-full py-3 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs transition-all shadow-md shadow-indigo-600/20 flex items-center justify-center gap-2 cursor-pointer"
                  >
                    Got It & Continue Learning <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );

  // ------------------------------------------
  // 1. CASE STUDY / TRUE OR FALSE SOLVER
  // ------------------------------------------
  function CaseStudySolver({
    onComplete,
    isAlreadyCompleted,
  }: {
    onComplete: (xp: number) => void;
    isAlreadyCompleted: boolean;
  }) {
    const [selectedOption, setSelectedOption] = useState<number | null>(null);
    const [submitted, setSubmitted] = useState<boolean>(isAlreadyCompleted);
    const [wrongAttempts, setWrongAttempts] = useState<number>(0);

    const earnedXp = Math.max(50, 250 - wrongAttempts * 50);

    const options = [
      {
        id: 1,
        title: "TRUE",
        subtitle: "Branch Visit Mandatory",
        desc: "Require the customer to visit the nearest branch in person to process the 15 Lakh surrender.",
        isCorrect: false,
        feedback: "Incorrect: Under TATA AIA rules, customers >10km away or >10 Lakh amount are guided to DIY (Do-It-Yourself) options.",
      },
      {
        id: 2,
        title: "FALSE",
        subtitle: "Guide Customer to DIY Options",
        desc: "Guide the policyholder to digital DIY options since distance > 10km and amount > 10 Lakh.",
        isCorrect: true,
        feedback: "Correct! Customers located >10km away or with amounts >10 Lakh are guided to DIY options. Customers within 10km or below 10 Lakh visit the branch.",
      },
    ];

    const handleSelect = (id: number) => {
      if (submitted) return;
      playSound("tap");
      setSelectedOption(id);
    };

    const handleSubmit = () => {
      if (selectedOption === null) return;
      const opt = options.find((o) => o.id === selectedOption);
      if (opt?.isCorrect) {
        playSound("correct");
      } else {
        playSound("incorrect");
        setWrongAttempts((prev) => prev + 1);
      }
      setSubmitted(true);
    };

    return (
      <div className="space-y-6">
        <div className="rounded-2xl bg-slate-50 border border-slate-200/90 p-6 sm:p-8 text-center space-y-3 relative">
          <span className="px-3 py-1 rounded-full bg-white border border-slate-200 text-slate-600 text-[10px] font-black uppercase tracking-wider shadow-xs">
            PROCEDURAL RULE FACT CHECK
          </span>
          <h3 className="text-base sm:text-lg font-black text-slate-900 leading-snug px-4">
            &quot;A TATA AIA policyholder living 12km away from the nearest branch requests to surrender a policy valued at 15 Lakh. According to procedural rules, a branch visit is mandatory.&quot;
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <button
            onClick={() => handleSelect(1)}
            className={`p-6 rounded-2xl border-2 text-center transition-all flex flex-col items-center justify-between gap-3 cursor-pointer ${selectedOption === 1
              ? "border-emerald-500 bg-emerald-50/70 ring-4 ring-emerald-500/10 shadow-md"
              : "border-emerald-300/80 bg-emerald-50/30 hover:bg-emerald-50/60 text-slate-800"
              }`}
          >
            <div className="w-12 h-12 rounded-full bg-emerald-500 text-white flex items-center justify-center shadow-md">
              <Check className="w-6 h-6 stroke-[3]" />
            </div>
            <div>
              <div className="text-lg font-black text-emerald-700 tracking-wider">TRUE</div>
              <div className="text-xs font-bold text-emerald-800 mt-0.5">{options[0].subtitle}</div>
              <p className="text-[11px] text-slate-600 mt-2 leading-relaxed">{options[0].desc}</p>
            </div>
          </button>

          <button
            onClick={() => handleSelect(2)}
            className={`p-6 rounded-2xl border-2 text-center transition-all flex flex-col items-center justify-between gap-3 cursor-pointer ${selectedOption === 2
              ? "border-rose-500 bg-rose-50/70 ring-4 ring-rose-500/10 shadow-md"
              : "border-rose-300/80 bg-rose-50/30 hover:bg-rose-50/60 text-slate-800"
              }`}
          >
            <div className="w-12 h-12 rounded-full bg-rose-500 text-white flex items-center justify-center shadow-md">
              <X className="w-6 h-6 stroke-[3]" />
            </div>
            <div>
              <div className="text-lg font-black text-rose-700 tracking-wider">FALSE</div>
              <div className="text-xs font-bold text-rose-800 mt-0.5">{options[1].subtitle}</div>
              <p className="text-[11px] text-slate-600 mt-2 leading-relaxed">{options[1].desc}</p>
            </div>
          </button>
        </div>

        {submitted && selectedOption !== null && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`p-4 rounded-2xl border text-xs font-bold flex items-center gap-3 ${options.find((o) => o.id === selectedOption)?.isCorrect
              ? "bg-emerald-50 border-emerald-300 text-emerald-900"
              : "bg-rose-50 border-rose-300 text-rose-900"
              }`}
          >
            {options.find((o) => o.id === selectedOption)?.isCorrect ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <XCircle className="w-5 h-5 text-rose-600 shrink-0" />
            )}
            <div>
              <span>{options.find((o) => o.id === selectedOption)?.feedback}</span>
              {wrongAttempts > 0 && options.find((o) => o.id === selectedOption)?.isCorrect && (
                <span className="block text-[10px] text-amber-700 font-extrabold mt-0.5">
                  ⚠️ (-{wrongAttempts * 50} XP penalty applied for {wrongAttempts} wrong {wrongAttempts === 1 ? "attempt" : "attempts"})
                </span>
              )}
            </div>
          </motion.div>
        )}

        <div className="pt-2 flex items-center justify-between">
          {submitted && selectedOption !== 2 ? (
            <button
              onClick={() => {
                playSound("tap");
                setSelectedOption(null);
                setSubmitted(false);
              }}
              className="px-4 py-2 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Try Again (-50 XP Penalty)
            </button>
          ) : (
            <div />
          )}

          {!submitted ? (
            <button
              disabled={selectedOption === null}
              onClick={handleSubmit}
              className="px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs disabled:opacity-40 transition-all shadow-md shadow-indigo-600/20 cursor-pointer"
            >
              Submit Decision
            </button>
          ) : selectedOption === 2 ? (
            <button
              onClick={() => {
                playSound("complete");
                onComplete(earnedXp);
              }}
              className="px-6 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs transition-all shadow-md shadow-emerald-600/20 flex items-center gap-2 cursor-pointer"
            >
              Claim {earnedXp} XP & Next Drill <ArrowRight className="w-4 h-4" />
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  // ------------------------------------------
  // 2. FILL-IN-THE-BLANKS SOLVER
  // ------------------------------------------
  function FillBlanksSolver({
    onComplete,
    isAlreadyCompleted,
  }: {
    onComplete: (xp: number) => void;
    isAlreadyCompleted: boolean;
  }) {
    const blank1Options = [
      "surrender",
      "endowment",
      "rider",
      "maturity",
    ];

    const blank2Options = [
      "surrender value",
      "claim amount",
      "grace period",
      "bonus payout",
    ];

    const [blank1, setBlank1] = useState<string>("");
    const [blank2, setBlank2] = useState<string>("");
    const [checked, setChecked] = useState<boolean>(isAlreadyCompleted);
    const [wrongAttempts, setWrongAttempts] = useState<number>(0);

    const earnedXp = Math.max(50, 150 - wrongAttempts * 25);
    const isCorrect = blank1 === "surrender" && blank2 === "surrender value";

    const handleVerify = () => {
      if (!blank1 || !blank2) return;
      if (isCorrect) {
        playSound("correct");
      } else {
        playSound("incorrect");
        setWrongAttempts((prev) => prev + 1);
      }
      setChecked(true);
    };

    return (
      <div className="space-y-6">
        <div className="p-6 sm:p-8 rounded-2xl bg-slate-50 border border-slate-200 text-sm sm:text-base font-medium text-slate-800 leading-relaxed space-y-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <span>At TATA AIA Life Insurance, policy</span>
            <select
              disabled={checked}
              value={blank1}
              onChange={(e) => {
                playSound("tap");
                setBlank1(e.target.value);
              }}
              aria-label="Select Blank 1 Term"
              className={`px-3.5 py-1.5 rounded-2xl font-black text-xs transition-all border cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs ${blank1
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-slate-700 border-indigo-300 hover:border-indigo-500"
                }`}
            >
              <option value="" disabled>
                -- Select Blank 1 --
              </option>
              {blank1Options.map((opt) => (
                <option key={opt} value={opt} className="bg-white text-slate-900 font-bold">
                  {opt}
                </option>
              ))}
            </select>
            <span>is defined as voluntary termination before maturity. The customer receives a</span>
            <select
              disabled={checked}
              value={blank2}
              onChange={(e) => {
                playSound("tap");
                setBlank2(e.target.value);
              }}
              aria-label="Select Blank 2 Term"
              className={`px-3.5 py-1.5 rounded-2xl font-black text-xs transition-all border cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 shadow-2xs ${blank2
                ? "bg-indigo-600 text-white border-indigo-600"
                : "bg-white text-slate-700 border-indigo-300 hover:border-indigo-500"
                }`}
            >
              <option value="" disabled>
                -- Select Blank 2 --
              </option>
              {blank2Options.map((opt) => (
                <option key={opt} value={opt} className="bg-white text-slate-900 font-bold">
                  {opt}
                </option>
              ))}
            </select>
            <span>calculated based on product spec, premium paid, and paying term.</span>
          </div>
        </div>

        {checked && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`p-4 rounded-2xl border text-xs font-bold flex items-center gap-3 ${isCorrect
              ? "bg-emerald-50 border-emerald-300 text-emerald-900"
              : "bg-rose-50 border-rose-300 text-rose-900"
              }`}
          >
            {isCorrect ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <XCircle className="w-5 h-5 text-rose-600 shrink-0" />
            )}
            <div>
              <span>
                {isCorrect
                  ? `All blanks selected correctly! +${earnedXp} XP Earned.`
                  : "Incorrect term selection. Try selecting 'surrender' and 'surrender value'."}
              </span>
              {wrongAttempts > 0 && isCorrect && (
                <span className="block text-[10px] text-amber-700 font-extrabold mt-0.5">
                  ⚠️ (-{wrongAttempts * 25} XP penalty applied for {wrongAttempts} wrong {wrongAttempts === 1 ? "attempt" : "attempts"})
                </span>
              )}
            </div>
          </motion.div>
        )}

        <div className="pt-2 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-500">
            {!blank1 || !blank2 ? "Select terms for both dropdown blanks" : "Ready to verify"}
          </span>

          {!checked ? (
            <button
              disabled={!blank1 || !blank2}
              onClick={handleVerify}
              className="px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs disabled:opacity-40 transition-all shadow-md shadow-indigo-600/20 cursor-pointer"
            >
              Verify Talk Track
            </button>
          ) : isCorrect ? (
            <button
              onClick={() => {
                playSound("complete");
                onComplete(earnedXp);
              }}
              className="px-6 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs transition-all shadow-md shadow-emerald-600/20 flex items-center gap-2 cursor-pointer"
            >
              Claim {earnedXp} XP & Next Drill <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              onClick={() => {
                playSound("tap");
                setChecked(false);
                setBlank1("");
                setBlank2("");
              }}
              className="px-4 py-2 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Try Again (-25 XP Penalty)
            </button>
          )}
        </div>
      </div>
    );
  }

  // ------------------------------------------
  // 3. MATCHING PAIRS SOLVER
  // ------------------------------------------
  function MatchingPairsSolver({
    onComplete,
    isAlreadyCompleted,
  }: {
    onComplete: (xp: number) => void;
    isAlreadyCompleted: boolean;
  }) {
    const [matches, setMatches] = useState<Record<string, string>>({});
    const [selectedRisk, setSelectedRisk] = useState<string | null>(null);
    const [wrongAttempts, setWrongAttempts] = useState<number>(0);

    const earnedXp = Math.max(50, 200 - wrongAttempts * 30);

    const pairs = [
      { risk: "Original Policy Document", mitigation: "Mandatory Primary Proof to Initiate Surrender" },
      { risk: "Masked Aadhaar Card", mitigation: "Mandatory Additional Verification Proof" },
      { risk: "Tasha Digital Assistant", mitigation: "Interactive Chatbot for DIY Surrender Guidance" },
      { risk: "3-Point Call Verification", mitigation: "Bank Name, Nominee Name, and Nominee DOB" },
    ];

    const handleRiskClick = (risk: string) => {
      playSound("tap");
      setSelectedRisk(risk);
    };

    const handleMitigationClick = (mitigation: string) => {
      if (selectedRisk) {
        const correctPair = pairs.find((p) => p.risk === selectedRisk);
        if (correctPair?.mitigation === mitigation) {
          playSound("correct");
        } else {
          playSound("incorrect");
          setWrongAttempts((prev) => prev + 1);
        }
        setMatches((prev) => ({ ...prev, [selectedRisk]: mitigation }));
        setSelectedRisk(null);
      }
    };

    const isCompleted = Object.keys(matches).length === pairs.length;

    return (
      <div className="space-y-6">
        <p className="text-xs font-semibold text-slate-500">
          Tap a Policy Requirement on the left, then tap its exact Mandatory Action / Definition on the right:
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-2.5">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">
              Policy Requirements & Protocols
            </span>
            {pairs.map((p) => {
              const isSelected = selectedRisk === p.risk;
              const isMatched = !!matches[p.risk];
              return (
                <button
                  key={p.risk}
                  onClick={() => handleRiskClick(p.risk)}
                  className={`w-full p-4 rounded-2xl border text-left text-xs font-bold transition-all cursor-pointer ${isSelected
                    ? "bg-indigo-50 border-indigo-600 text-indigo-900 ring-2 ring-indigo-500/20"
                    : isMatched
                      ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                      : "bg-slate-50 hover:bg-white border-slate-200 text-slate-800"
                    }`}
                >
                  <div>{p.risk}</div>
                  {isMatched && (
                    <span className="text-[10px] text-emerald-600 font-extrabold flex items-center gap-1 mt-1">
                      <Check className="w-3 h-3" /> Matched Correctly
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div className="space-y-2.5">
            <span className="text-[10px] font-black text-slate-500 uppercase tracking-wider block">
              Mandatory Definitions & Actions
            </span>
            {pairs.map((p) => {
              const isMatched = Object.values(matches).includes(p.mitigation);
              return (
                <button
                  key={p.mitigation}
                  onClick={() => handleMitigationClick(p.mitigation)}
                  className={`w-full p-4 rounded-2xl border text-left text-xs font-bold transition-all cursor-pointer ${isMatched
                    ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                    : "bg-slate-50 hover:bg-white border-slate-200 text-slate-800"
                    }`}
                >
                  {p.mitigation}
                </button>
              );
            })}
          </div>
        </div>

        <div className="pt-2 flex items-center justify-between">
          {wrongAttempts > 0 ? (
            <span className="text-[11px] font-extrabold text-amber-700 bg-amber-50 px-3 py-1.5 rounded-xl border border-amber-200">
              ⚠️ (-{wrongAttempts * 30} XP penalty applied for {wrongAttempts} mismatch {wrongAttempts === 1 ? "attempt" : "attempts"})
            </span>
          ) : (
            <div />
          )}

          <button
            disabled={!isCompleted}
            onClick={() => {
              playSound("complete");
              onComplete(earnedXp);
            }}
            className="px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs disabled:opacity-40 transition-all shadow-md shadow-indigo-600/20 flex items-center gap-2 cursor-pointer"
          >
            Claim {earnedXp} XP & Next Drill <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  // ------------------------------------------
  // 4. CODE BREAKER / DECIPHER POLICY SOLVER
  // ------------------------------------------
  function CodeBreakerSolver({
    onComplete,
    isAlreadyCompleted,
  }: {
    onComplete: (xp: number) => void;
    isAlreadyCompleted: boolean;
  }) {
    const puzzles = [
      {
        word: "SURRENDER",
        scrambled: ["R", "E", "S", "R", "U", "N", "D", "E", "R"],
        hint: "Voluntary termination of a TATA AIA policy prior to maturity",
      },
      {
        word: "NOMINEE",
        scrambled: ["O", "M", "E", "N", "I", "E", "N"],
        hint: "Required 3-point verification data point along with Bank Name & DOB",
      },
    ];

    const [currentIdx, setCurrentIdx] = useState(0);
    const [selectedLetters, setSelectedLetters] = useState<number[]>([]);
    const [completedPuzzles, setCompletedPuzzles] = useState<Record<number, boolean>>(
      isAlreadyCompleted ? { 0: true, 1: true } : {}
    );
    const [wrongAttempts, setWrongAttempts] = useState<number>(0);

    const earnedXp = Math.max(50, 150 - wrongAttempts * 25);
    const puzzle = puzzles[currentIdx];
    const userConstructed = selectedLetters.map((i) => puzzle.scrambled[i]).join("");
    const isCurrentCorrect = userConstructed === puzzle.word;

    const handleTileClick = (letterIdx: number) => {
      if (selectedLetters.includes(letterIdx)) {
        playSound("tap");
        setSelectedLetters(selectedLetters.filter((i) => i !== letterIdx));
      } else {
        playSound("tap");
        const nextLetters = [...selectedLetters, letterIdx];
        setSelectedLetters(nextLetters);

        const nextWord = nextLetters.map((i) => puzzle.scrambled[i]).join("");
        if (nextWord === puzzle.word) {
          playSound("correct");
          setCompletedPuzzles((prev) => ({ ...prev, [currentIdx]: true }));
        } else if (nextWord.length === puzzle.word.length) {
          playSound("incorrect");
          setWrongAttempts((prev) => prev + 1);
        }
      }
    };

    const handleClear = () => {
      playSound("tap");
      setSelectedLetters([]);
    };

    const allDone = Object.keys(completedPuzzles).length === puzzles.length;

    return (
      <div className="space-y-6 text-center">
        <div className="flex items-center justify-between text-xs font-bold text-slate-500">
          <span>Decoder Challenge {currentIdx + 1} of {puzzles.length}</span>
          <span className="text-indigo-600 font-black">Hint: {puzzle.hint}</span>
        </div>

        {/* TARGET WORD SLOT DISPLAY */}
        <div className="p-6 rounded-3xl bg-slate-900 text-white shadow-xl space-y-4">
          <div className="text-[10px] font-black uppercase tracking-widest text-indigo-400">
            ENTERPRISE CODE BREAKER
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 min-h-[52px]">
            {Array.from({ length: puzzle.word.length }).map((_, idx) => {
              const letter = selectedLetters[idx] !== undefined ? puzzle.scrambled[selectedLetters[idx]] : "";
              return (
                <motion.div
                  key={idx}
                  animate={{ scale: letter ? 1.05 : 1 }}
                  className={`w-11 h-12 rounded-xl flex items-center justify-center text-xl font-black transition-all ${letter
                    ? isCurrentCorrect
                      ? "bg-emerald-500 text-white border-2 border-emerald-400 shadow-md"
                      : "bg-indigo-600 text-white border-2 border-indigo-400 shadow-md"
                    : "bg-slate-800 border-2 border-dashed border-slate-700 text-slate-500"
                    }`}
                >
                  {letter}
                </motion.div>
              );
            })}
          </div>

          {isCurrentCorrect && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="text-xs font-black text-emerald-400 flex items-center justify-center gap-1.5 pt-1"
            >
              <CheckCircle2 className="w-4 h-4" /> CODE DECIPHERED! &quot;{puzzle.word}&quot; MATCHED!
            </motion.div>
          )}
        </div>

        {/* SCRAMBLED LETTER TILES BANK */}
        <div className="space-y-3">
          <div className="text-[11px] font-black text-slate-500 uppercase tracking-wider">
            TAP SCRAMBLED TILES TO BUILD THE GOVERNANCE TERM:
          </div>

          <div className="flex flex-wrap justify-center gap-2.5 max-w-lg mx-auto">
            {puzzle.scrambled.map((letter, idx) => {
              const isUsed = selectedLetters.includes(idx);
              return (
                <button
                  key={idx}
                  disabled={isUsed || isCurrentCorrect}
                  onClick={() => handleTileClick(idx)}
                  className={`w-12 h-12 rounded-2xl text-base font-black transition-all border cursor-pointer shadow-sm active:scale-95 ${isUsed
                    ? "bg-slate-100 text-slate-300 border-slate-200 cursor-not-allowed opacity-40"
                    : "bg-white hover:bg-indigo-50 hover:border-indigo-400 text-slate-900 border-slate-200"
                    }`}
                >
                  {letter}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          <button
            onClick={handleClear}
            disabled={selectedLetters.length === 0 || isCurrentCorrect}
            className="px-4 py-2 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold disabled:opacity-40 transition-all cursor-pointer flex items-center gap-1.5"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Clear Input
          </button>

          {currentIdx < puzzles.length - 1 && isCurrentCorrect ? (
            <button
              onClick={() => {
                playSound("tap");
                setCurrentIdx(currentIdx + 1);
                setSelectedLetters([]);
              }}
              className="px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs transition-all shadow-md shadow-indigo-600/20 flex items-center gap-2 cursor-pointer"
            >
              Next Decoder Challenge <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <button
              disabled={!allDone}
              onClick={() => {
                playSound("complete");
                onComplete(earnedXp);
              }}
              className="px-6 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs disabled:opacity-40 transition-all shadow-md shadow-emerald-600/20 flex items-center gap-2 cursor-pointer"
            >
              Claim {earnedXp} XP & Final Speed Run ⏱️ <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  // ------------------------------------------
  // 5. TIMED MCQ SPEED QUIZ SOLVER
  // ------------------------------------------
  function McqSpeedQuizSolver({
    onComplete,
    isAlreadyCompleted,
  }: {
    onComplete: (xp: number) => void;
    isAlreadyCompleted: boolean;
  }) {
    const [selected, setSelected] = useState<number | null>(null);
    const [finished, setFinished] = useState<boolean>(isAlreadyCompleted);
    const [timeLeft, setTimeLeft] = useState<number>(15);
    const [wrongAttempts, setWrongAttempts] = useState<number>(0);

    const earnedXp = Math.max(50, 300 - wrongAttempts * 50);

    const question = "What are the mandatory 3-point customer verification details required during a TATA AIA Policy Surrender call before proceeding?";
    const choices = [
      "Registered Bank Name, Nominee Name, & Nominee DOB",
      "Policy Number, Aadhaar Number, & Credit Card CVV",
      "Branch Code, Pan Card Number, & Agent ID",
      "Home Address, Alternate Mobile Number, & Email ID",
    ];

    // Live countdown timer effect
    React.useEffect(() => {
      if (finished || isAlreadyCompleted || timeLeft <= 0) return;
      const timer = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearInterval(timer);
            playSound("incorrect");
            setFinished(true);
            setWrongAttempts((w) => w + 1);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }, [finished, isAlreadyCompleted, timeLeft]);

    const handleSelect = (i: number) => {
      if (finished) return;
      playSound("tap");
      setSelected(i);
    };

    const handleSubmit = () => {
      if (selected === null) return;
      if (selected === 0) {
        playSound("correct");
      } else {
        playSound("incorrect");
        setWrongAttempts((prev) => prev + 1);
      }
      setFinished(true);
    };

    const handleRetry = () => {
      playSound("tap");
      setSelected(null);
      setFinished(false);
      setTimeLeft(15);
    };

    return (
      <div className="space-y-6">
        <div
          className={`flex items-center justify-between text-xs font-black p-3.5 rounded-2xl border transition-all ${timeLeft <= 5 && !finished
            ? "bg-rose-50 border-rose-200 text-rose-700 animate-pulse"
            : "bg-indigo-50 border-indigo-100 text-indigo-700"
            }`}
        >
          <span className="flex items-center gap-1.5">
            <Clock className="w-4 h-4 text-indigo-600" /> Speed Run Challenge ⏱️
          </span>
          <span className="font-mono text-sm font-black tracking-wider">
            Timer: 00:{timeLeft.toString().padStart(2, "0")}
          </span>
        </div>

        <div className="p-5 rounded-2xl bg-slate-50 border border-slate-200 text-sm sm:text-base font-bold text-slate-900 leading-snug">
          {question}
        </div>

        <div className="space-y-2.5">
          {choices.map((c, i) => {
            const isSelected = selected === i;
            return (
              <button
                key={i}
                disabled={finished}
                onClick={() => handleSelect(i)}
                className={`w-full p-4 rounded-2xl border text-left text-xs font-bold transition-all cursor-pointer ${isSelected
                  ? i === 0
                    ? "bg-emerald-50 border-emerald-500 text-emerald-900 ring-2 ring-emerald-400/20"
                    : "bg-indigo-50 border-indigo-500 text-indigo-900 ring-2 ring-indigo-400/20"
                  : "bg-white hover:bg-slate-50 border-slate-200 text-slate-800"
                  }`}
              >
                {c}
              </button>
            );
          })}
        </div>

        {finished && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`p-4 rounded-2xl border text-xs font-bold flex items-center gap-3 ${selected === 0
              ? "bg-emerald-50 border-emerald-300 text-emerald-900"
              : "bg-rose-50 border-rose-300 text-rose-900"
              }`}
          >
            {selected === 0 ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <XCircle className="w-5 h-5 text-rose-600 shrink-0" />
            )}
            <div>
              <span>
                {selected === 0
                  ? `Boom! Correct answer with ${timeLeft}s remaining!`
                  : timeLeft === 0
                    ? "Time expired! Select an answer faster next time."
                    : "Incorrect verification details. Bank Name, Nominee Name, and Nominee DOB are the 3 mandatory verification points."}
              </span>
              {wrongAttempts > 0 && selected === 0 && (
                <span className="block text-[10px] text-amber-700 font-extrabold mt-0.5">
                  ⚠️ (-{wrongAttempts * 50} XP penalty applied for {wrongAttempts} wrong {wrongAttempts === 1 ? "attempt" : "attempts"})
                </span>
              )}
            </div>
          </motion.div>
        )}

        <div className="pt-2 flex items-center justify-between">
          {finished && selected !== 0 ? (
            <button
              onClick={handleRetry}
              className="px-4 py-2 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Try Speed Run Again (-50 XP Penalty)
            </button>
          ) : (
            <div />
          )}

          {!finished ? (
            <button
              disabled={selected === null}
              onClick={handleSubmit}
              className="px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs disabled:opacity-40 transition-all shadow-md shadow-indigo-600/20 cursor-pointer"
            >
              Submit Speed Answer
            </button>
          ) : selected === 0 ? (
            <button
              onClick={() => {
                playSound("complete");
                onComplete(earnedXp);
              }}
              className="px-6 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs transition-all shadow-md shadow-emerald-600/20 flex items-center gap-2 cursor-pointer"
            >
              Claim {earnedXp} XP & Unlock Sprint 2 🎉 <ArrowRight className="w-4 h-4" />
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  // ------------------------------------------
  // 5. FLOW MASTER / PROCESS SEQUENCE SOLVER
  // ------------------------------------------
  function ProcessFlowSolver({
    onComplete,
    isAlreadyCompleted,
  }: {
    onComplete: (xp: number) => void;
    isAlreadyCompleted: boolean;
  }) {
    const initialSteps = [
      { id: "s3", title: "3. Guide to Tasha DIY Chatbot or Branch Visit", correctPos: 2 },
      { id: "s1", title: "1. 3-Point Call Verification (Bank, Nominee, DOB)", correctPos: 0 },
      { id: "s4", title: "4. Execute 1-5 Scale VOC Rating & Farewell", correctPos: 3 },
      { id: "s2", title: "2. Evaluate Distance (10km) & Value (10L) Rules", correctPos: 1 },
    ];

    const [selectedSequence, setSelectedSequence] = useState<string[]>(
      isAlreadyCompleted ? ["s1", "s2", "s3", "s4"] : []
    );
    const [submitted, setSubmitted] = useState<boolean>(isAlreadyCompleted);
    const [wrongAttempts, setWrongAttempts] = useState<number>(0);

    const earnedXp = Math.max(50, 250 - wrongAttempts * 35);
    const isCorrect = selectedSequence.join(",") === "s1,s2,s3,s4";

    const handleStepClick = (stepId: string) => {
      if (submitted) return;
      playSound("tap");
      if (selectedSequence.includes(stepId)) {
        setSelectedSequence(selectedSequence.filter((id) => id !== stepId));
      } else if (selectedSequence.length < 4) {
        setSelectedSequence([...selectedSequence, stepId]);
      }
    };

    const handleVerify = () => {
      if (selectedSequence.length !== 4) return;
      if (selectedSequence.join(",") === "s1,s2,s3,s4") {
        playSound("correct");
      } else {
        playSound("incorrect");
        setWrongAttempts((prev) => prev + 1);
      }
      setSubmitted(true);
    };

    const handleReset = () => {
      playSound("tap");
      setSelectedSequence([]);
      setSubmitted(false);
    };

    return (
      <div className="space-y-6">
        <div className="p-4 rounded-2xl bg-cyan-50/60 border border-cyan-200/80 text-xs font-semibold text-cyan-900 flex items-center gap-2.5">
          <ListOrdered className="w-4 h-4 text-cyan-600 shrink-0" />
          <span>Tap each step card below in chronological order to build the official Surrender Workflow:</span>
        </div>

        {/* SEQUENCE SLOTS DISPLAY */}
        <div className="space-y-2.5">
          <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
            SELECTED CHRONOLOGICAL SEQUENCE ({selectedSequence.length}/4):
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[0, 1, 2, 3].map((idx) => {
              const stepId = selectedSequence[idx];
              const stepObj = initialSteps.find((s) => s.id === stepId);
              return (
                <div
                  key={idx}
                  className={`p-3.5 rounded-2xl border flex items-center gap-3 transition-all min-h-[56px] ${
                    stepObj
                      ? isCorrect
                        ? "bg-emerald-50 border-emerald-300 text-emerald-900 shadow-xs"
                        : "bg-indigo-50 border-indigo-200 text-indigo-900 shadow-xs"
                      : "bg-slate-50 border-dashed border-slate-300 text-slate-400 text-xs"
                  }`}
                >
                  <span className="w-7 h-7 rounded-xl bg-slate-900 text-white font-black text-xs flex items-center justify-center shrink-0">
                    #{idx + 1}
                  </span>
                  <span className="text-xs font-bold leading-tight">
                    {stepObj ? stepObj.title : "Tap a step below to place here"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* AVAILABLE STEPS BANK */}
        {!submitted && (
          <div className="space-y-2">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              STEP POOL (TAP TO SELECT/DESELECT):
            </div>
            <div className="grid grid-cols-1 gap-2.5">
              {initialSteps.map((step) => {
                const isSelected = selectedSequence.includes(step.id);
                return (
                  <button
                    key={step.id}
                    disabled={isSelected}
                    onClick={() => handleStepClick(step.id)}
                    className={`p-4 rounded-2xl border text-left text-xs font-bold transition-all cursor-pointer flex items-center justify-between ${
                      isSelected
                        ? "bg-slate-100 border-slate-200 text-slate-400 cursor-not-allowed opacity-50"
                        : "bg-white hover:bg-cyan-50/50 hover:border-cyan-300 border-slate-200 text-slate-800 shadow-2xs"
                    }`}
                  >
                    <span>{step.title}</span>
                    {isSelected && <Check className="w-4 h-4 text-emerald-600 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {submitted && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`p-4 rounded-2xl border text-xs font-bold flex items-center gap-3 ${
              isCorrect
                ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                : "bg-rose-50 border-rose-300 text-rose-900"
            }`}
          >
            {isCorrect ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <XCircle className="w-5 h-5 text-rose-600 shrink-0" />
            )}
            <div>
              <span>
                {isCorrect
                  ? `Boom! Perfect workflow sequence constructed!`
                  : "Incorrect sequence order! Correct flow is: Verification ➔ Distance/Value Rules ➔ Tasha/Branch Guidance ➔ VOC & Farewell."}
              </span>
              {wrongAttempts > 0 && isCorrect && (
                <span className="block text-[10px] text-amber-700 font-extrabold mt-0.5">
                  ⚠️ (-{wrongAttempts * 35} XP penalty applied for {wrongAttempts} wrong {wrongAttempts === 1 ? "attempt" : "attempts"})
                </span>
              )}
            </div>
          </motion.div>
        )}

        <div className="pt-2 flex items-center justify-between">
          {submitted && !isCorrect ? (
            <button
              onClick={handleReset}
              className="px-4 py-2 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Re-Order Sequence (-35 XP Penalty)
            </button>
          ) : (
            <div />
          )}

          {!submitted ? (
            <button
              disabled={selectedSequence.length !== 4}
              onClick={handleVerify}
              className="px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs disabled:opacity-40 transition-all shadow-md shadow-indigo-600/20 cursor-pointer"
            >
              Verify Workflow Order
            </button>
          ) : isCorrect ? (
            <button
              onClick={() => {
                playSound("complete");
                onComplete(earnedXp);
              }}
              className="px-6 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs transition-all shadow-md shadow-emerald-600/20 flex items-center gap-2 cursor-pointer"
            >
              Claim {earnedXp} XP & Next Drill <ArrowRight className="w-4 h-4" />
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  // ------------------------------------------
  // 6. AUDIT SPOTTER / RED FLAG HUNTER SOLVER
  // ------------------------------------------
  function FraudSpotterSolver({
    onComplete,
    isAlreadyCompleted,
  }: {
    onComplete: (xp: number) => void;
    isAlreadyCompleted: boolean;
  }) {
    const [selectedSection, setSelectedSection] = useState<number | null>(null);
    const [submitted, setSubmitted] = useState<boolean>(isAlreadyCompleted);
    const [wrongAttempts, setWrongAttempts] = useState<number>(0);

    const earnedXp = Math.max(50, 200 - wrongAttempts * 30);

    const documentSections = [
      {
        id: 1,
        label: "Section A: Policyholder Details",
        content: "Customer: Yomit Khurana | Policy #TA-99203",
        isRedFlag: false,
        feedback: "Compliant: Policyholder identity details match internal database records.",
      },
      {
        id: 2,
        label: "Section B: Distance & Value Rule",
        content: "Amount: ₹4,50,000 | Branch Distance: 8.5 km",
        isRedFlag: false,
        feedback: "Compliant: Amount < 10 Lakh and Distance <= 10km qualifies for branch visit.",
      },
      {
        id: 3,
        label: "Section C: Identity Proof Attachment",
        content: "Attached ID: Unmasked Aadhaar Copy (Full 12-Digit Visible)",
        isRedFlag: true,
        feedback: "RED FLAG SPOTTED! Protocol requires MASKED Aadhaar (first 8 digits hidden).",
      },
      {
        id: 4,
        label: "Section D: 3-Point Call Verification",
        content: "Verified: Bank Name ✓ | Nominee Name ✓ | Nominee DOB ✓",
        isRedFlag: false,
        feedback: "Compliant: All 3 mandatory verification points confirmed.",
      },
    ];

    const handleSelect = (id: number) => {
      if (submitted) return;
      playSound("tap");
      setSelectedSection(id);
    };

    const handleVerify = () => {
      if (selectedSection === null) return;
      const sec = documentSections.find((s) => s.id === selectedSection);
      if (sec?.isRedFlag) {
        playSound("correct");
      } else {
        playSound("incorrect");
        setWrongAttempts((prev) => prev + 1);
      }
      setSubmitted(true);
    };

    return (
      <div className="space-y-6">
        <div className="p-4 rounded-2xl bg-amber-50/80 border border-amber-200 text-xs font-semibold text-amber-900 flex items-center gap-2.5">
          <FileSearch className="w-4 h-4 text-amber-700 shrink-0" />
          <span>Inspect the incoming Surrender Docket below. Spot the compliance red-flag by tapping the non-compliant section:</span>
        </div>

        {/* DOCUMENT DOCKET CARD */}
        <div className="p-6 rounded-3xl bg-slate-900 text-white shadow-xl space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <span className="text-[10px] font-black text-amber-400 uppercase tracking-widest flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-amber-400" /> SURRENDER REQUEST AUDIT DOCKET #9920
            </span>
            <span className="text-[10px] font-bold text-slate-400 bg-slate-800 px-2.5 py-1 rounded-full">CONFIDENTIAL AUDIT</span>
          </div>

          <div className="space-y-3">
            {documentSections.map((sec) => {
              const isSelected = selectedSection === sec.id;
              return (
                <div
                  key={sec.id}
                  onClick={() => handleSelect(sec.id)}
                  className={`p-4 rounded-2xl border text-left text-xs transition-all cursor-pointer ${
                    isSelected
                      ? sec.isRedFlag && submitted
                        ? "bg-emerald-950/80 border-emerald-400 text-emerald-200 ring-2 ring-emerald-400/30"
                        : "bg-rose-950/80 border-rose-500 text-rose-100 ring-2 ring-rose-500/30"
                      : "bg-slate-800/80 hover:bg-slate-800 border-slate-700 text-slate-200"
                  }`}
                >
                  <div className="font-black text-slate-400 text-[10px] uppercase tracking-wider mb-1 flex items-center justify-between">
                    <span>{sec.label}</span>
                    {isSelected && <span className="text-amber-400 font-extrabold">SELECTED FOR AUDIT</span>}
                  </div>
                  <div className="font-semibold">{sec.content}</div>
                </div>
              );
            })}
          </div>
        </div>

        {submitted && selectedSection !== null && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`p-4 rounded-2xl border text-xs font-bold flex items-center gap-3 ${
              documentSections.find((s) => s.id === selectedSection)?.isRedFlag
                ? "bg-emerald-50 border-emerald-300 text-emerald-900"
                : "bg-rose-50 border-rose-300 text-rose-900"
            }`}
          >
            {documentSections.find((s) => s.id === selectedSection)?.isRedFlag ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            ) : (
              <XCircle className="w-5 h-5 text-rose-600 shrink-0" />
            )}
            <div>
              <span>{documentSections.find((s) => s.id === selectedSection)?.feedback}</span>
              {wrongAttempts > 0 && documentSections.find((s) => s.id === selectedSection)?.isRedFlag && (
                <span className="block text-[10px] text-amber-700 font-extrabold mt-0.5">
                  ⚠️ (-{wrongAttempts * 30} XP penalty applied for {wrongAttempts} wrong {wrongAttempts === 1 ? "attempt" : "attempts"})
                </span>
              )}
            </div>
          </motion.div>
        )}

        <div className="pt-2 flex items-center justify-between">
          {submitted && !documentSections.find((s) => s.id === selectedSection)?.isRedFlag ? (
            <button
              onClick={() => {
                playSound("tap");
                setSelectedSection(null);
                setSubmitted(false);
              }}
              className="px-4 py-2 rounded-2xl bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Re-Inspect Docket (-30 XP Penalty)
            </button>
          ) : (
            <div />
          )}

          {!submitted ? (
            <button
              disabled={selectedSection === null}
              onClick={handleVerify}
              className="px-6 py-3 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs disabled:opacity-40 transition-all shadow-md shadow-indigo-600/20 cursor-pointer"
            >
              Flag Compliance Red-Flag
            </button>
          ) : documentSections.find((s) => s.id === selectedSection)?.isRedFlag ? (
            <button
              onClick={() => {
                playSound("complete");
                onComplete(earnedXp);
              }}
              className="px-6 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs transition-all shadow-md shadow-emerald-600/20 flex items-center gap-2 cursor-pointer"
            >
              Claim {earnedXp} XP & Next Drill <ArrowRight className="w-4 h-4" />
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  // ------------------------------------------
  // 8. 1V1 ARENA PVP DUEL SOLVER (REAL-TIME HUMAN VS AI FIGHT)
  // ------------------------------------------
  function PvpDuelSolver({
    onComplete,
    isAlreadyCompleted,
  }: {
    onComplete: (xp: number) => void;
    isAlreadyCompleted: boolean;
  }) {
    const [playerHp, setPlayerHp] = useState<number>(100);
    const [aiHp, setAiHp] = useState<number>(isAlreadyCompleted ? 0 : 100);
    const [round, setRound] = useState<number>(1);
    const [battleLog, setBattleLog] = useState<string[]>([
      "⚔️ MATCH START: YOU vs TASHA COMPLIANCE AI BOT 🤖 (100 HP vs 100 HP)",
      "🤖 TASHA AI BOT opens Round 1 with 'Shortcut Surge' attack!",
    ]);
    const [isAiTurn, setIsAiTurn] = useState<boolean>(false);
    const [isFinished, setIsFinished] = useState<boolean>(isAlreadyCompleted);
    const [wrongAttempts, setWrongAttempts] = useState<number>(0);
    const [roundTimeLeft, setRoundTimeLeft] = useState<number>(12);

    const roundsData = [
      {
        roundNum: 1,
        aiAttackName: "COMPLIANCE SHORTCUT SURGE ⚡",
        aiPrompt: "TASHA AI: 'Customer wants instant phone refund without ID proof. Bypass 3-point check!'",
        moves: [
          {
            id: "m1_correct",
            name: "🛡️ STRICT 3-POINT SHIELD & VERIFY",
            desc: "Verify Registered Bank, Nominee Name & Nominee DOB.",
            isCorrect: true,
            damageToAi: 50,
            feedback: "PERFECT COUNTER! You shielded the shortcut and slashed TASHA AI BOT for 50 DMG!",
          },
          {
            id: "m1_wrong",
            name: "💥 INSTANT APPROVAL SLASH",
            desc: "Approve phone payout immediately without verification.",
            isCorrect: false,
            damageToPlayer: 35,
            feedback: "COMPLIANCE FLOPS! TASHA AI BOT punished your breach for 35 DMG!",
          },
        ],
      },
      {
        roundNum: 2,
        aiAttackName: "DISTANCE & VALUE CONFUSION 🌀",
        aiPrompt: "TASHA AI: 'Customer is 12km away with 15 Lakh policy. Mandatory branch visit required!'",
        moves: [
          {
            id: "m2_correct",
            name: "⚡ DIY GUIDANCE COUNTER-STRIKE",
            desc: "Under TATA AIA rules, >10km or >10 Lakh MUST be guided to Tasha DIY Chatbot.",
            isCorrect: true,
            damageToAi: 50,
            feedback: "K.O. STRIKE! You caught the AI rule violation and dealt 50 FINISHING DMG!",
          },
          {
            id: "m2_wrong",
            name: "🏢 FORCE BRANCH VISIT SLAM",
            desc: "Force customer to travel 12km to the branch anyway.",
            isCorrect: false,
            damageToPlayer: 35,
            feedback: "RULE MISMATCH! TASHA AI BOT counter-attacked for 35 DMG!",
          },
        ],
      },
    ];

    const currentRoundData = roundsData[Math.min(round - 1, roundsData.length - 1)];

    // Turn timer countdown
    React.useEffect(() => {
      if (isFinished || isAiTurn) return;
      if (roundTimeLeft <= 0) {
        playSound("incorrect");
        setPlayerHp((hp) => Math.max(10, hp - 30));
        setBattleLog((prev) => ["⏰ TIME EXPIRED! TASHA AI BOT dealt 30 DMG due to slow response!", ...prev]);
        setWrongAttempts((prev) => prev + 1);
        setRoundTimeLeft(12);
        return;
      }
      const timer = setInterval(() => {
        setRoundTimeLeft((prev) => prev - 1);
      }, 1000);
      return () => clearInterval(timer);
    }, [roundTimeLeft, isFinished, isAiTurn]);

    const handlePlayerMove = (move: any) => {
      if (isFinished || isAiTurn) return;
      playSound("tap");

      if (move.isCorrect) {
        playSound("correct");
        const nextAiHp = Math.max(0, aiHp - move.damageToAi);
        setAiHp(nextAiHp);
        setBattleLog((prev) => [`💥 ${move.feedback}`, ...prev]);

        if (nextAiHp <= 0) {
          setIsFinished(true);
          playSound("complete");
          setBattleLog((prev) => ["🏆 K.O.! TASHA COMPLIANCE AI BOT DEFEATED! HUMAN VICTORY!", ...prev]);
        } else {
          setRound((r) => r + 1);
          setRoundTimeLeft(12);
        }
      } else {
        playSound("incorrect");
        const nextPlayerHp = Math.max(10, playerHp - move.damageToPlayer);
        setPlayerHp(nextPlayerHp);
        setWrongAttempts((prev) => prev + 1);
        setBattleLog((prev) => [`⚠️ ${move.feedback}`, ...prev]);
        setRoundTimeLeft(12);
      }
    };

    const earnedXp = Math.max(100, 400 - wrongAttempts * 50);

    const handleRetryMatch = () => {
      playSound("tap");
      setPlayerHp(100);
      setAiHp(100);
      setRound(1);
      setWrongAttempts(0);
      setIsFinished(false);
      setRoundTimeLeft(12);
      setBattleLog(["⚔️ MATCH RESTARTED! YOU vs TASHA COMPLIANCE AI BOT 🤖"]);
    };

    return (
      <div className="space-y-6">
        {/* PVP BATTLE ARENA TOP DASHBOARD */}
        <div className="p-6 rounded-3xl bg-slate-900 text-white shadow-2xl relative overflow-hidden space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <Swords className="w-5 h-5 text-cyan-400 animate-pulse" />
              <span className="text-xs font-black text-cyan-400 uppercase tracking-widest">
                1V1 ARENA BATTLE — ROUND {round} OF 2
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black text-amber-400 bg-amber-950 px-3 py-1 rounded-full border border-amber-500/30 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> {roundTimeLeft}s TURN CLOCK
              </span>
              <span className="text-[10px] font-bold text-slate-400 bg-slate-800 px-2.5 py-1 rounded-full">
                WAGER: +400 XP
              </span>
            </div>
          </div>

          {/* HEALTH BARS CLASH */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* PLAYER HP CARD */}
            <div className="p-4 rounded-2xl bg-indigo-950/80 border border-indigo-500/40 space-y-2">
              <div className="flex items-center justify-between text-xs font-black">
                <span className="text-indigo-300 flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-indigo-400" /> YOU (HUMAN CHAMPION)
                </span>
                <span className="text-emerald-400 font-mono text-sm">{playerHp} HP</span>
              </div>
              <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
                <motion.div
                  animate={{ width: `${playerHp}%` }}
                  className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full"
                />
              </div>
            </div>

            {/* AI HP CARD */}
            <div className="p-4 rounded-2xl bg-purple-950/80 border border-purple-500/40 space-y-2">
              <div className="flex items-center justify-between text-xs font-black">
                <span className="text-purple-300 flex items-center gap-1.5">
                  <Brain className="w-4 h-4 text-cyan-400 animate-pulse" /> TASHA AI BOT 🤖
                </span>
                <span className="text-cyan-400 font-mono text-sm">{aiHp} HP</span>
              </div>
              <div className="w-full h-3 bg-slate-800 rounded-full overflow-hidden">
                <motion.div
                  animate={{ width: `${aiHp}%` }}
                  className="h-full bg-gradient-to-r from-cyan-400 to-blue-500 rounded-full"
                />
              </div>
            </div>
          </div>

          {/* BATTLE LOG COMMENTARY STREAM */}
          <div className="p-3 rounded-2xl bg-slate-950/80 border border-slate-800 text-[11px] font-mono text-slate-300 max-h-24 overflow-y-auto space-y-1">
            {battleLog.slice(0, 3).map((log, i) => (
              <div key={i} className={i === 0 ? "text-cyan-300 font-bold" : "text-slate-400"}>
                {log}
              </div>
            ))}
          </div>
        </div>

        {/* AI ATTACK PROMPT */}
        {!isFinished && (
          <div className="p-5 rounded-2xl bg-rose-50/80 border border-rose-200 text-sm font-extrabold text-rose-950 leading-relaxed flex items-start gap-3 shadow-2xs">
            <Flame className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div>
              <span className="text-[10px] font-black text-rose-600 uppercase tracking-wider block mb-1">
                ROUND {round} — {currentRoundData.aiAttackName}
              </span>
              <span>{currentRoundData.aiPrompt}</span>
            </div>
          </div>
        )}

        {/* PLAYER COMBAT MOVES CARDS */}
        {!isFinished && (
          <div className="space-y-3">
            <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
              SELECT YOUR COUNTER-ATTACK MOVE:
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {currentRoundData.moves.map((m) => (
                <button
                  key={m.id}
                  onClick={() => handlePlayerMove(m)}
                  className="p-5 rounded-2xl border text-left text-xs font-bold transition-all cursor-pointer bg-white hover:bg-cyan-50/60 hover:border-cyan-400 border-slate-200 text-slate-900 shadow-2xs hover:shadow-md flex flex-col justify-between space-y-2 group"
                >
                  <div className="text-sm font-black text-indigo-700 group-hover:text-cyan-700 flex items-center justify-between">
                    <span>{m.name}</span>
                    <ArrowRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-all text-cyan-600" />
                  </div>
                  <div className="text-slate-600 text-xs font-semibold leading-relaxed">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* FINISHED / K.O. BANNERS */}
        {isFinished && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="p-6 rounded-3xl bg-gradient-to-r from-emerald-600 to-teal-700 text-white shadow-2xl space-y-3 text-center"
          >
            <Trophy className="w-12 h-12 text-amber-300 mx-auto animate-bounce" />
            <h3 className="text-xl font-black tracking-tight">🤖 TASHA COMPLIANCE AI BOT K.O.&apos;D!</h3>
            <p className="text-xs font-bold text-emerald-100 max-w-md mx-auto">
              Outstanding victory! You proved human compliance superiority over the AI Bot with flawless regulatory execution.
            </p>
            {wrongAttempts > 0 && (
              <span className="block text-[11px] text-amber-200 font-extrabold">
                ⚠️ (-{wrongAttempts * 50} XP penalty applied for {wrongAttempts} missteps)
              </span>
            )}
          </motion.div>
        )}

        {/* BOTTOM ACTION BAR */}
        <div className="pt-2 flex items-center justify-between">
          {!isFinished ? (
            <button
              onClick={handleRetryMatch}
              className="px-4 py-2 rounded-2xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Restart Match
            </button>
          ) : (
            <div />
          )}

          {isFinished && (
            <button
              onClick={() => {
                playSound("complete");
                onComplete(earnedXp);
              }}
              className="px-6 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-black text-xs transition-all shadow-md shadow-emerald-600/20 flex items-center gap-2 cursor-pointer ml-auto"
            >
              Claim {earnedXp} XP Glory & Unlock Sprint 2 🎉 <ArrowRight className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    );
  }
}