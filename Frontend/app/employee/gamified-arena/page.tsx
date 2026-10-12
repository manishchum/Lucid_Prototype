"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useTenant, FEATURES } from "@/contexts/tenant-context";
import { useAuth } from "@/contexts/auth-context";
import { useRouter } from "next/navigation";
import {
  Trophy,
  Shield,
  Zap,
  BookOpen,
  Lock,
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
  ListOrdered,
  FileSearch,
  Clock,
  Info,
  Play,
  Gamepad2,
  ChevronLeft,
  ChevronRight,
  Users,
  RotateCcw,
  Tag,
  Award
} from "lucide-react";

import { fetchAssignedSprints, submitDrillProgress, fetchUserProfile, fetchActivityCalendar, Sprint, Drill, DrillProgressPayload } from "@/lib/api/gamification";

import FillBlanksSolver from "@/components/gamification/drills/FillBlanksSolver";
import VibeCheckSolver from "@/components/gamification/drills/VibeCheckSolver";
import RiskRizzSolver from "@/components/gamification/drills/RiskRizzSolver";
import CodeBreakerSolver from "@/components/gamification/drills/CodeBreakerSolver";
import FlowMasterSolver from "@/components/gamification/drills/FlowMasterSolver";
import AuditSpotterSolver from "@/components/gamification/drills/AuditSpotterSolver";
import SpeedRunSolver from "@/components/gamification/drills/SpeedRunSolver";
import { GamificationLeaderboard, BadgesVault } from "@/components/gamification/Leaderboard";

// ==========================================
// SPRINT CARD GRADIENT THEMES
// ==========================================
const SPRINT_CARD_THEMES = [
  {
    gradient: "from-pink-500 via-rose-500 to-rose-600",
    shadow: "shadow-rose-500/20",
    badge: "AI Sprint"
  },
  {
    gradient: "from-amber-400 via-orange-500 to-orange-600",
    shadow: "shadow-orange-500/20",
    badge: "Challenge"
  },
  {
    gradient: "from-blue-500 via-indigo-500 to-indigo-600",
    shadow: "shadow-indigo-500/20",
    badge: "Quest"
  },
  {
    gradient: "from-purple-500 via-violet-600 to-violet-700",
    shadow: "shadow-purple-500/20",
    badge: "Logic"
  },
  {
    gradient: "from-emerald-400 via-teal-500 to-teal-600",
    shadow: "shadow-teal-500/20",
    badge: "Mastery"
  }
];

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
    }
  } catch (e) {
    // Ignore audio context autoplay errors
  }
};

const getBadgeIcon = (iconName: string) => {
  switch (iconName) {
    case "BookOpen": return <BookOpen className="w-6 h-6 text-indigo-600" />;
    case "Shield": return <Shield className="w-6 h-6 text-blue-600" />;
    case "Trophy": return <Trophy className="w-6 h-6 text-amber-600" />;
    case "Flame": return <Flame className="w-6 h-6 text-rose-600" />;
    case "Zap": return <Zap className="w-6 h-6 text-purple-600" />;
    case "Sparkles": return <Sparkles className="w-6 h-6 text-emerald-600" />;
    default: return <Trophy className="w-6 h-6 text-fuchsia-600" />;
  }
};

export default function EmployeeGamifiedArenaPage() {
  const { hasFeature, activeCompany } = useTenant();
  const { user, userId, employeeData } = useAuth();
  const router = useRouter();

  const companyDisplayName = activeCompany?.name || (employeeData as any)?.company_name || "Company";

  useEffect(() => {
    // Commenting out feature flag check during development to prevent unwanted redirects
    // if (!hasFeature(FEATURES.GAMIFICATION)) {
    //   router.replace("/employee/welcome");
    // }
  }, [hasFeature, router]);

  const [activeTab, setActiveTab] = useState<"sprints" | "leaderboard" | "vault" | "drill">("sprints");
  const [soundMuted, setSoundMuted] = useState<boolean>(false);
  const [showDrillInstructions, setShowDrillInstructions] = useState<boolean>(false);

  // Arena State
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeSprint, setActiveSprint] = useState<Sprint | null>(null);
  const [activeDrillIndex, setActiveDrillIndex] = useState<number>(0);

  // Stats (Mocks for now until we build Profile fetch route)
  const [userXp, setUserXp] = useState<number>(0);
  const [streakDays, setStreakDays] = useState<number>(0);
  const [streakModalOpen, setStreakModalOpen] = useState<boolean>(false);
  const [leaderboardModalOpen, setLeaderboardModalOpen] = useState<boolean>(false);
  const [activeDates, setActiveDates] = useState<string[]>([]);
  const [completedDrills, setCompletedDrills] = useState<Record<string, number>>({});
  const [unlockedBadges, setUnlockedBadges] = useState<any[]>([]);
  const [newBadgesAlert, setNewBadgesAlert] = useState<any[]>([]);
  const [flippedSprintId, setFlippedSprintId] = useState<string | null>(null);

  const carouselRef = useRef<HTMLDivElement>(null);
  const initialLoadDone = useRef(false);

  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;

    const loadInitialData = async () => {
      try {
        setIsLoading(true);

        // Optimize: Fetch profile, sprints, and calendar concurrently
        const [profile, data, calendar] = await Promise.all([
          fetchUserProfile(),
          fetchAssignedSprints(),
          fetchActivityCalendar()
        ]);
        
        setActiveDates(calendar || []);

        if (profile) {
          setUserXp(profile.total_xp || 0);
          setStreakDays(profile.current_streak_days || 0);
          if (profile.completed_drills) {
            const drillsRecord: Record<string, number> = {};
            profile.completed_drills.forEach((d: any) => {
              drillsRecord[d.drill_id] = d.earned_xp;
            });
            setCompletedDrills(drillsRecord);
          }
          if (profile.unlocked_badges) {
            setUnlockedBadges(profile.unlocked_badges);
          }
        }

        setSprints(data || []);
      } catch (e) {
        console.error("Failed to load arena data:", e);
      } finally {
        setIsLoading(false);
      }
    };
    loadInitialData();
  }, []);

  const handleDrillComplete = async (payload: { completed: boolean; wrong_attempts: number; completion_time_seconds: number }) => {
    if (!activeSprint || !userId) return;
    const currentDrill = activeSprint.gamification_drills[activeDrillIndex];
    if (!currentDrill) return;

    const estimatedXp = Math.max(50, 200 - (payload.wrong_attempts * 25));

    // 1. Optimistic UI Update for instant feedback
    setCompletedDrills(prev => ({
      ...prev,
      [currentDrill.drill_id]: estimatedXp
    }));
    setUserXp(prev => prev + estimatedXp);
    playSound("complete");

    // 2. Background Sync
    try {
      const data: DrillProgressPayload = {
        sprint_id: activeSprint.sprint_id,
        drill_id: currentDrill.drill_id,
        completed: payload.completed,
        wrong_attempts: payload.wrong_attempts,
        completion_time_seconds: payload.completion_time_seconds
      };

      submitDrillProgress(data).then(result => {
        if (result.earned_xp && result.earned_xp !== estimatedXp) {
          const diff = result.earned_xp - estimatedXp;
          setUserXp(prev => prev + diff);
          setCompletedDrills(prev => ({
            ...prev,
            [currentDrill.drill_id]: result.earned_xp
          }));
        }
        if (result.new_streak !== undefined) setStreakDays(result.new_streak);
        
        // Handle new badges
        if (result.new_badges && result.new_badges.length > 0) {
          setUnlockedBadges(prev => [...prev, ...result.new_badges!]);
          setNewBadgesAlert(result.new_badges);
          playSound("complete");
        }
        
        // Optimistically update calendar for today
        const todayStr = new Date().toISOString().split('T')[0];
        if (!activeDates.includes(todayStr)) {
          setActiveDates(prev => [...prev, todayStr]);
        }
      }).catch(console.error);
    } catch (e) {
      console.error(e);
    }
  };

  const renderActiveDrill = () => {
    if (!activeSprint) return null;
    const drill = activeSprint.gamification_drills[activeDrillIndex];
    if (!drill) return null;

    const isCompleted = completedDrills[drill.drill_id] !== undefined;
    const earnedXp = completedDrills[drill.drill_id] || 0;

    const commonProps = {
      drillData: drill.content_payload,
      isAlreadyCompleted: isCompleted,
      earnedXp: earnedXp,
      onComplete: handleDrillComplete
    };

    switch (drill.format_type) {
      case "FILL_BLANKS": return <FillBlanksSolver {...commonProps} />;
      case "VIBE_CHECK": return <VibeCheckSolver {...commonProps} />;
      case "RISK_RIZZ": return <RiskRizzSolver {...commonProps} />;
      case "CODE_BREAKER": return <CodeBreakerSolver {...commonProps} />;
      case "FLOW_MASTER": return <FlowMasterSolver {...commonProps} />;
      case "AUDIT_SPOTTER": return <AuditSpotterSolver {...commonProps} />;
      case "SPEED_RUN": return <SpeedRunSolver {...commonProps} />;
      default:
        return (
          <div className="text-center p-8 bg-slate-50 text-slate-500 rounded-2xl">
            {drill.format_type} Solver is under construction...
            <button onClick={() => handleDrillComplete({ completed: true, wrong_attempts: 0, completion_time_seconds: 5 })} className="block mx-auto mt-4 px-4 py-2 bg-indigo-600 text-white rounded-lg">Skip for now</button>
          </div>
        );
    }
  };

  const toggleSound = () => {
    const nextMuted = !soundMuted;
    setSoundMuted(nextMuted);
    setGlobalAudioMute(nextMuted);
    if (!nextMuted) playSound("tap");
  };

  const scrollCarousel = (direction: "left" | "right") => {
    if (carouselRef.current) {
      const scrollAmount = direction === "left" ? -320 : 320;
      carouselRef.current.scrollBy({ left: scrollAmount, behavior: "smooth" });
    }
  };

  const handleGetStarted = () => {
    playSound("tap");
    if (!sprints || sprints.length === 0) return;

    for (let idx = 0; idx < sprints.length; idx++) {
      const sprint = sprints[idx];
      let isLocked = sprint.is_locked;
      if (idx > 0) {
        const prevSprint = sprints[idx - 1];
        const prevDrillIds = prevSprint.gamification_drills?.map((d: any) => d.drill_id) || [];
        const prevCompletedCount = prevDrillIds.filter((id: string) => completedDrills[id] !== undefined).length;
        isLocked = (prevDrillIds.length === 0 || prevCompletedCount < prevDrillIds.length);
      } else {
        isLocked = false;
      }

      if (isLocked) continue;

      const sprintDrillIds = sprint.gamification_drills?.map((d: any) => d.drill_id) || [];
      const completedCount = sprintDrillIds.filter((id: string) => completedDrills[id] !== undefined).length;

      if (completedCount < sprintDrillIds.length) {
        setActiveSprint(sprint);
        setActiveDrillIndex(completedCount);
        setActiveTab("drill");
        setShowDrillInstructions(false);
        return;
      }
    }

    // Default fallback to first sprint drill 0 if all completed
    setActiveSprint(sprints[0]);
    setActiveDrillIndex(0);
    setActiveTab("drill");
    setShowDrillInstructions(false);
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 font-sans selection:bg-indigo-500 selection:text-white pb-16">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(99,102,241,0.05),rgba(255,255,255,0))]" />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
        {/* TOP COMPACT HEADER */}
        <header className="rounded-2xl bg-white border border-blue-200/60 px-6 py-4 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {activeTab !== "sprints" && (
                <button
                  onClick={() => {
                    playSound("tap");
                    setActiveTab("sprints");
                  }}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-4 h-4 text-slate-600" />
                  <span className="leading-none">Study Mode</span>
                </button>
              )}

              <div>
                <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
                  <span>{companyDisplayName} Arena</span>
                  <Zap className="w-4.5 h-4.5 text-amber-500 fill-amber-400 shrink-0 stroke-[2.5]" />
                </h1>
              </div>
            </div>

            {/* TOP RIGHT ACTION BAR */}
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={toggleSound}
                className={`p-2.5 rounded-xl border transition-all cursor-pointer flex items-center justify-center ${
                  soundMuted
                    ? "bg-slate-100 text-slate-400 border-slate-200"
                    : "bg-blue-50/50 text-blue-600 border-blue-200/80 hover:bg-blue-100/60"
                }`}
                title={soundMuted ? "Unmute Audio" : "Mute Audio"}
              >
                {soundMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>

              <button
                onClick={() => {
                  playSound("tap");
                  setLeaderboardModalOpen(true);
                }}
                className="px-4 py-2 rounded-xl border border-amber-200/90 bg-amber-50/50 hover:bg-amber-100/60 text-amber-900 font-semibold text-xs sm:text-sm transition-all cursor-pointer flex items-center gap-2"
              >
                <Trophy className="w-4 h-4 text-amber-500" />
                <span>Leaderboard</span>
              </button>

              <button 
                onClick={() => {
                  playSound("tap");
                  setActiveTab("vault");
                }}
                className="px-4 py-2 rounded-xl border border-blue-200/90 bg-blue-50/50 hover:bg-blue-100/60 text-blue-900 font-semibold text-xs sm:text-sm transition-all cursor-pointer flex items-center gap-2 relative"
              >
                <Shield className="w-4 h-4 text-blue-500" />
                <span>Badges</span>
                <span className="ml-0.5 bg-blue-600 text-white text-[11px] font-bold w-5 h-5 rounded-full inline-flex items-center justify-center leading-none">
                  {unlockedBadges.length}
                </span>
                {newBadgesAlert.length > 0 && (
                  <>
                    <span className="absolute -top-1 -right-1 w-3 h-3 bg-rose-500 rounded-full animate-ping"></span>
                    <span className="absolute -top-1 -right-1 w-3 h-3 bg-rose-500 rounded-full border-2 border-white"></span>
                  </>
                )}
              </button>

              <button
                onClick={() => {
                  playSound("tap");
                  setStreakModalOpen(true);
                }}
                className="px-4 py-2 rounded-xl border border-rose-200/90 bg-rose-50/50 hover:bg-rose-100/60 text-rose-600 font-semibold text-xs sm:text-sm transition-all cursor-pointer flex items-center gap-2"
              >
                <Flame className="w-4 h-4 text-rose-500 fill-rose-500" />
                <span>{streakDays} Day Streak</span>
              </button>

              <div className="px-4 py-2 rounded-xl border border-purple-200/90 bg-purple-50/60 text-purple-700 font-bold text-xs sm:text-sm flex items-center gap-2 shadow-2xs">
                <Sparkles className="w-4 h-4 text-purple-600 fill-purple-200" />
                <span>+{userXp.toLocaleString()} XP</span>
              </div>
            </div>
          </div>
        </header>

        {activeTab === "sprints" && (
          <div className="space-y-6">
            {/* HERO BANNER CARD */}
            <div className="relative rounded-2xl bg-white border border-blue-200/60 p-6 sm:p-8 shadow-xs overflow-hidden bg-gradient-to-r from-blue-50/30 via-indigo-50/20 to-white">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
                <div className="lg:col-span-7 space-y-4">
                  <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight leading-tight">
                    Master Concepts, Play & Level Up!
                  </h2>
                  <p className="text-slate-600 text-sm sm:text-base leading-relaxed max-w-xl">
                    Complete AI-generated sprint drills, earn XP, build your daily streak, and climb the arena leaderboard to demonstrate your skills.
                  </p>
                  <div className="pt-2">
                    <button
                      onClick={handleGetStarted}
                      className="px-6 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm shadow-md hover:shadow-lg transition-all cursor-pointer flex items-center gap-2.5 active:scale-[0.98]"
                    >
                      <Play className="w-4 h-4 fill-white text-white" />
                      <span>Get Started</span>
                    </button>
                  </div>
                </div>

                <div className="lg:col-span-5 flex justify-center lg:justify-end">
                  <div className="relative w-full max-w-[300px] aspect-[4/3] flex items-center justify-center">
                    {/* SVG Gaming / Arena Setup Illustration */}
                    <svg viewBox="0 0 320 220" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full h-full">
                      {/* Floating dots & stars background decor */}
                      <circle cx="45" cy="40" r="4" fill="#F43F5E" />
                      <circle cx="270" cy="50" r="3" fill="#A855F7" />
                      <circle cx="35" cy="115" r="5" fill="#3B82F6" />
                      <circle cx="295" cy="120" r="4" fill="#10B981" />
                      <path d="M90 30L93 36L100 37L95 42L96 49L90 46L84 49L85 42L80 37L87 36L90 30Z" fill="#F59E0B" />
                      <path d="M280 150L282 154L287 155L283 159L284 164L280 162L276 164L277 159L273 155L278 154L280 150Z" fill="#60A5FA" />
                      
                      {/* Floating Keyhole Card */}
                      <g filter="drop-shadow(0px 4px 6px rgba(0,0,0,0.06))">
                        <rect x="110" y="25" width="28" height="36" rx="6" fill="white" stroke="#E2E8F0" strokeWidth="2" />
                        <path d="M124 38C126.209 38 128 36.2091 128 34C128 31.7909 126.209 30 124 30C121.791 30 120 31.7909 120 34C120 36.2091 121.791 38 124 38Z" fill="#1E293B" />
                        <path d="M122.5 36H125.5L126.5 45H121.5L122.5 36Z" fill="#1E293B" />
                      </g>

                      {/* Floating Gold Hexagon Badge */}
                      <g filter="drop-shadow(0px 4px 8px rgba(245,158,11,0.25))">
                        <path d="M260 60L275 68.6603V86L260 94.6603L245 86V68.6603L260 60Z" fill="#F59E0B" />
                        <path d="M260 65L270 70.7735V82.3205L260 88.094L250 82.3205V70.7735L260 65Z" fill="#FBBF24" />
                        <circle cx="260" cy="76.5" r="4" fill="#FFF" />
                      </g>

                      {/* Gaming Desk Frame */}
                      <rect x="30" y="150" width="260" height="8" rx="4" fill="#0F172A" />
                      <rect x="55" y="158" width="10" height="42" fill="#0F172A" />
                      <rect x="255" y="158" width="10" height="42" fill="#0F172A" />

                      {/* Dual Gaming Monitors */}
                      {/* Left Monitor */}
                      <rect x="70" y="90" width="75" height="52" rx="5" fill="#1E293B" stroke="#0F172A" strokeWidth="3" />
                      <rect x="74" y="94" width="67" height="44" rx="3" fill="#0284C7" />
                      {/* Code lines on left monitor */}
                      <line x1="80" y1="104" x2="110" y2="104" stroke="white" strokeWidth="2.5" strokeLinecap="round" />
                      <line x1="80" y1="112" x2="125" y2="112" stroke="#38BDF8" strokeWidth="2.5" strokeLinecap="round" />
                      <line x1="80" y1="120" x2="100" y2="120" stroke="#F43F5E" strokeWidth="2.5" strokeLinecap="round" />
                      <line x1="80" y1="128" x2="118" y2="128" stroke="#10B981" strokeWidth="2.5" strokeLinecap="round" />

                      {/* Right Monitor */}
                      <rect x="155" y="90" width="75" height="52" rx="5" fill="#1E293B" stroke="#0F172A" strokeWidth="3" />
                      <rect x="159" y="94" width="67" height="44" rx="3" fill="#0F172A" />
                      <rect x="165" y="100" width="28" height="20" rx="2" fill="#F59E0B" />
                      <rect x="198" y="100" width="22" height="20" rx="2" fill="#3B82F6" />

                      {/* Monitor Stands */}
                      <rect x="102" y="142" width="10" height="8" fill="#0F172A" />
                      <rect x="188" y="142" width="10" height="8" fill="#0F172A" />

                      {/* Left Gamer Avatar with Pink Headset */}
                      <path d="M50 150C50 135 60 125 70 125C80 125 90 135 90 150H50Z" fill="#0F172A" />
                      <circle cx="70" cy="118" r="12" fill="#FECDD3" />
                      {/* Pink Headphones */}
                      <path d="M56 118C56 110 62 104 70 104C78 104 84 110 84 118" stroke="#E11D48" strokeWidth="4" strokeLinecap="round" />
                      <rect x="54" y="112" width="5" height="12" rx="2" fill="#E11D48" />
                      <rect x="81" y="112" width="5" height="12" rx="2" fill="#E11D48" />

                      {/* Right Gamer Avatar with Blue Headset */}
                      <path d="M210 150C210 135 220 125 230 125C240 125 250 135 250 150H210Z" fill="#0F172A" />
                      <circle cx="230" cy="118" r="12" fill="#BAE6FD" />
                      {/* Blue Headphones */}
                      <path d="M216 118C216 110 222 104 230 104C238 104 244 110 244 118" stroke="#0284C7" strokeWidth="4" strokeLinecap="round" />
                      <rect x="214" y="112" width="5" height="12" rx="2" fill="#0284C7" />
                      <rect x="241" y="112" width="5" height="12" rx="2" fill="#0284C7" />

                      {/* Golden Trophy on Desk Right */}
                      <g filter="drop-shadow(0px 3px 5px rgba(0,0,0,0.15))">
                        <path d="M275 125H285V132C285 137 280 141 275 141V125Z" fill="#D97706" />
                        <path d="M265 125H255V132C255 137 260 141 265 141V125Z" fill="#D97706" />
                        <path d="M262 120H278V134C278 139 274 143 270 143C266 143 262 139 262 134V120Z" fill="#F59E0B" />
                        <rect x="268" y="143" width="4" height="5" fill="#D97706" />
                        <rect x="264" y="148" width="12" height="4" rx="1" fill="#92400E" />
                      </g>
                    </svg>
                  </div>
                </div>
              </div>
            </div>
            {/* MINI GAMES & AI SPRINTS CAROUSEL SECTION */}
            <div className="space-y-4 pt-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-bold text-slate-900 tracking-tight">
                      Mini Games & AI Sprints
                    </h3>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold text-slate-400">
                      {sprints.length} Live Sprints Active
                    </span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => scrollCarousel("left")}
                        className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
                        title="Scroll Left"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => scrollCarousel("right")}
                        className="p-2 rounded-xl bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
                        title="Scroll Right"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>

                {isLoading ? (
                  <div className="flex justify-center py-20 text-indigo-600 font-bold animate-pulse">Loading Sprints...</div>
                ) : sprints.length === 0 ? (
                  <div className="flex justify-center py-20 text-slate-500 font-bold">No gamification sprints found for this module.</div>
                ) : (
                  <div
                    ref={carouselRef}
                    className="flex gap-5 overflow-x-auto pb-4 pt-1 snap-x snap-mandatory scrollbar-none scroll-smooth"
                    style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                  >
                    {sprints.map((sprint, idx) => {
                      let isLocked = sprint.is_locked;
                      if (idx > 0) {
                        const prevSprint = sprints[idx - 1];
                        const prevDrillIds = prevSprint.gamification_drills?.map((d: any) => d.drill_id) || [];
                        const prevCompletedCount = prevDrillIds.filter((id: string) => completedDrills[id] !== undefined).length;
                        isLocked = (prevDrillIds.length === 0 || prevCompletedCount < prevDrillIds.length);
                      } else {
                        isLocked = false;
                      }

                      const theme = SPRINT_CARD_THEMES[idx % SPRINT_CARD_THEMES.length];
                      const sprintDrillIds = sprint.gamification_drills?.map((d: any) => d.drill_id) || [];
                      const completedCount = sprintDrillIds.filter((id: string) => completedDrills[id] !== undefined).length;
                      const totalDrills = sprintDrillIds.length;
                      const isCompleted = totalDrills > 0 && completedCount === totalDrills;
                      const isInProgress = completedCount > 0 && completedCount < totalDrills;

                      let playBtnText = "Play Now";
                      if (isLocked) {
                        playBtnText = "Locked 🔒";
                      } else if (isCompleted) {
                        playBtnText = "Review";
                      } else if (isInProgress) {
                        playBtnText = "Continue";
                      }

                      const isFlipped = flippedSprintId === sprint.sprint_id;

                      return (
                        <div
                          key={sprint.sprint_id}
                          className="min-w-[270px] max-w-[290px] w-[280px] shrink-0 h-[310px] snap-start"
                          style={{ perspective: "1000px" }}
                        >
                          <motion.div
                            className="relative w-full h-full rounded-2xl"
                            style={{ transformStyle: "preserve-3d" }}
                            animate={{ rotateY: isFlipped ? 180 : 0 }}
                            transition={{ duration: 0.5, ease: [0.23, 1, 0.32, 1] }}
                          >
                            {/* FRONT SIDE OF CARD */}
                            <div
                              onClick={() => {
                                playSound("tap");
                                setFlippedSprintId(sprint.sprint_id);
                              }}
                              className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${theme.gradient} p-5 flex flex-col justify-between shadow-lg ${theme.shadow} overflow-hidden cursor-pointer ${
                                isFlipped ? "pointer-events-none opacity-0" : "pointer-events-auto opacity-100"
                              } transition-opacity duration-300`}
                              style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
                            >
                              {/* Top Row: Title, Drills & Flip Indicator */}
                              <div className="space-y-1.5 z-10">
                                <div className="flex items-center justify-between gap-2">
                                  <h4 className="text-base font-extrabold text-white tracking-tight line-clamp-1 flex-1">
                                    {sprint.title}
                                  </h4>
                                  <div className="flex items-center gap-1.5 shrink-0">
                                    {isLocked ? (
                                      <Lock className="w-4 h-4 text-white/70" />
                                    ) : (
                                      <div className="p-1 rounded-lg bg-white/20 text-white/90 backdrop-blur-xs" title="Click card to flip details">
                                        <RotateCcw className="w-3.5 h-3.5 opacity-90" />
                                      </div>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 text-xs text-white/80 font-medium">
                                  <Users className="w-3.5 h-3.5 opacity-80" />
                                  <span>{sprint.gamification_drills?.length || 0} Drills</span>
                                  {isInProgress && (
                                    <span className="ml-auto bg-white/20 backdrop-blur-xs px-2 py-0.5 rounded-full text-[10px] text-white font-bold">
                                      {Math.round((completedCount / totalDrills) * 100)}%
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Center Illustration Graphic */}
                              <div className="flex items-center justify-center my-auto z-10">
                                {idx % 4 === 0 && (
                                  <div className="w-24 h-24 relative flex items-center justify-center">
                                    <div className="w-20 h-20 bg-white/15 backdrop-blur-xs rounded-3xl border border-white/20 flex items-center justify-center shadow-inner">
                                      <Brain className="w-11 h-11 text-white drop-shadow-md" />
                                    </div>
                                    <span className="absolute top-1 right-2 w-3 h-3 bg-amber-400 rounded-full animate-ping" />
                                  </div>
                                )}

                                {idx % 4 === 1 && (
                                  <div className="w-24 h-24 relative flex items-center justify-center">
                                    <div className="w-20 h-20 bg-white/15 backdrop-blur-xs rounded-3xl border border-white/20 flex items-center justify-center shadow-inner">
                                      <Swords className="w-11 h-11 text-white drop-shadow-md" />
                                    </div>
                                  </div>
                                )}

                                {idx % 4 === 2 && (
                                  <div className="w-24 h-24 relative flex items-center justify-center">
                                    <div className="w-20 h-20 bg-white/15 backdrop-blur-xs rounded-3xl border border-white/20 flex items-center justify-center shadow-inner">
                                      <Trophy className="w-11 h-11 text-amber-200 fill-amber-300 drop-shadow-md" />
                                    </div>
                                  </div>
                                )}

                                {idx % 4 === 3 && (
                                  <div className="w-24 h-24 relative flex items-center justify-center">
                                    <div className="w-20 h-20 bg-white/15 backdrop-blur-xs rounded-3xl border border-white/20 flex items-center justify-center shadow-inner">
                                      <Zap className="w-11 h-11 text-yellow-300 fill-yellow-300 drop-shadow-md" />
                                    </div>
                                  </div>
                                )}
                              </div>

                              {/* Bottom Full-width White Button */}
                              <div className="z-10">
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (isLocked) return;
                                    playSound("tap");
                                    setActiveSprint(sprint);
                                    setActiveDrillIndex(isCompleted ? 0 : completedCount);
                                    setActiveTab("drill");
                                    setShowDrillInstructions(false);
                                  }}
                                  disabled={isLocked}
                                  className={`w-full py-3 px-4 rounded-xl font-bold text-xs sm:text-sm transition-all flex items-center justify-center gap-2 shadow-md ${
                                    isLocked
                                      ? "bg-white/35 text-white/70 cursor-not-allowed border border-white/20"
                                      : "bg-white hover:bg-slate-50 text-slate-900 cursor-pointer active:scale-[0.98]"
                                  }`}
                                >
                                  {!isLocked && <Gamepad2 className="w-4 h-4 text-slate-800" />}
                                  <span>{playBtnText}</span>
                                </button>
                              </div>
                            </div>

                            {/* BACK SIDE OF CARD (FLIPPED 3D Y-180deg) */}
                            <div
                              onClick={() => {
                                playSound("tap");
                                setFlippedSprintId(null);
                              }}
                              className={`absolute inset-0 rounded-2xl bg-slate-900 border border-slate-800 p-5 flex flex-col justify-between shadow-2xl text-white overflow-hidden cursor-pointer ${
                                isFlipped ? "pointer-events-auto z-20 opacity-100" : "pointer-events-none opacity-0"
                              } transition-opacity duration-300`}
                              style={{
                                backfaceVisibility: "hidden",
                                WebkitBackfaceVisibility: "hidden",
                                transform: "rotateY(180deg)"
                              }}
                            >
                              {/* Header with Title & Flip Back Button */}
                              <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                                <div className="flex items-center gap-2 flex-1 min-w-0 pr-2">
                                  <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                                  <h4 className="text-sm font-extrabold text-white tracking-tight line-clamp-1">
                                    {sprint.title}
                                  </h4>
                                </div>
                                <div className="p-1.5 rounded-lg bg-slate-800 text-slate-300 flex items-center gap-1 text-[11px] font-semibold shrink-0">
                                  <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                                  <span>Flip</span>
                                </div>
                              </div>

                              {/* Complete Description Content */}
                              <div className="flex-1 overflow-y-auto my-2 pr-1 space-y-3 scrollbar-thin scrollbar-thumb-slate-700">
                                <div>
                                  <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Overview</span>
                                  <p className="text-xs text-slate-200 leading-relaxed font-normal mt-0.5">
                                    {sprint.description || "Interactive AI sprint drill module designed to master core operational procedures."}
                                  </p>
                                </div>

                                {/* XP Breakdown & Drills */}
                                <div className="grid grid-cols-2 gap-2 pt-1">
                                  <div className="bg-slate-800/80 p-2 rounded-xl border border-slate-700/60">
                                    <span className="text-[9px] font-bold text-slate-400 uppercase block">Total Drills</span>
                                    <span className="text-xs font-black text-amber-400 flex items-center gap-1 mt-0.5">
                                      <BookOpen className="w-3.5 h-3.5 text-amber-400" />
                                      {sprint.gamification_drills?.length || 0} Drills
                                    </span>
                                  </div>

                                  <div className="bg-slate-800/80 p-2 rounded-xl border border-slate-700/60">
                                    <span className="text-[9px] font-bold text-slate-400 uppercase block">XP Potential</span>
                                    <span className="text-xs font-black text-emerald-400 flex items-center gap-1 mt-0.5">
                                      <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                                      +{(sprint.gamification_drills?.reduce((acc: number, d: any) => acc + (d.base_xp || 200), 0) || 200).toLocaleString()} XP
                                    </span>
                                  </div>
                                </div>

                                {/* Topic Tags */}
                                <div className="pt-1">
                                  <span className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Topics</span>
                                  <div className="flex flex-wrap gap-1.5">
                                    <span className="px-2 py-0.5 rounded-md bg-indigo-500/20 text-indigo-300 text-[10px] font-semibold flex items-center gap-1">
                                      <Tag className="w-3 h-3" /> #{theme.badge}
                                    </span>
                                    <span className="px-2 py-0.5 rounded-md bg-rose-500/20 text-rose-300 text-[10px] font-semibold">
                                      #Interactive
                                    </span>
                                    <span className="px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-300 text-[10px] font-semibold">
                                      #Module-{sprint.sprint_number || idx + 1}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              {/* Action Button on Back (Reflects dynamic status) */}
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (isLocked) return;
                                  setFlippedSprintId(null);
                                  playSound("tap");
                                  setActiveSprint(sprint);
                                  setActiveDrillIndex(isCompleted ? 0 : completedCount);
                                  setActiveTab("drill");
                                  setShowDrillInstructions(false);
                                }}
                                disabled={isLocked}
                                className={`w-full py-2.5 px-3 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1.5 shadow-md ${
                                  isLocked
                                    ? "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700"
                                    : isCompleted
                                    ? "bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer active:scale-[0.98]"
                                    : isInProgress
                                    ? "bg-amber-600 hover:bg-amber-500 text-white cursor-pointer active:scale-[0.98]"
                                    : "bg-blue-600 hover:bg-blue-500 text-white cursor-pointer active:scale-[0.98]"
                                }`}
                              >
                                <span>{playBtnText}</span>
                                {!isLocked && <ArrowRight className="w-3.5 h-3.5" />}
                              </button>
                            </div>
                          </motion.div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
          </div>
        )}

        {activeTab === "drill" && activeSprint && (
          <div className="rounded-3xl bg-white border border-slate-200/90 p-6 sm:p-8 shadow-sm space-y-6">
            <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <span className="px-3.5 py-1.5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-black uppercase tracking-wider flex items-center gap-1.5">
                  DRILL {activeDrillIndex + 1}: {activeSprint.gamification_drills[activeDrillIndex]?.format_type.replace("_", " ")}
                  <button 
                    onClick={() => {
                      playSound("tap");
                      setShowDrillInstructions(!showDrillInstructions);
                    }}
                    className="hover:bg-indigo-200 p-0.5 rounded-full transition-colors cursor-pointer"
                    title="How to play"
                  >
                    <Info className="w-4 h-4 text-indigo-500" />
                  </button>
                </span>
                <span className="text-xs font-bold text-slate-500 hidden sm:inline-block">{activeSprint.gamification_drills[activeDrillIndex]?.title}</span>
              </div>
              <span className="px-3.5 py-1.5 rounded-full bg-rose-50 text-rose-600 border border-rose-100 text-xs font-black flex items-center gap-1">
                <Flame className="w-3.5 h-3.5 text-rose-500" /> Base XP: {activeSprint.gamification_drills[activeDrillIndex]?.base_xp || 200}
              </span>
            </div>

            {showDrillInstructions && (
              <div className="mb-6 p-4 rounded-2xl bg-indigo-50 border border-indigo-100 flex gap-3 text-sm text-indigo-800 animate-in fade-in slide-in-from-top-2">
                <Info className="w-5 h-5 text-indigo-600 shrink-0 mt-0.5" />
                <div>
                  <h4 className="font-bold mb-1">How to play</h4>
                  <p className="opacity-90 leading-relaxed">
                    {activeSprint.gamification_drills[activeDrillIndex]?.format_type === "FILL_BLANKS" && "Read the scenario and select the correct terms from the dropdown menus to complete the paragraph."}
                    {activeSprint.gamification_drills[activeDrillIndex]?.format_type === "VIBE_CHECK" && "Review the scenario and determine if it's a 'Green Flag' (Safe/Compliant) or 'Red Flag' (Violation/Risk)."}
                    {activeSprint.gamification_drills[activeDrillIndex]?.format_type === "RISK_RIZZ" && "Match the related pairs! Select an item on the left, then click its corresponding match on the right."}
                    {activeSprint.gamification_drills[activeDrillIndex]?.format_type === "CODE_BREAKER" && "Decipher the scrambled sequence or text and type the exact hidden meaning to unlock it."}
                    {activeSprint.gamification_drills[activeDrillIndex]?.format_type === "FLOW_MASTER" && "Drag and drop the procedure steps into the correct chronological order."}
                    {activeSprint.gamification_drills[activeDrillIndex]?.format_type === "AUDIT_SPOTTER" && "Carefully review the checklist and click on any hidden compliance violations or errors."}
                    {activeSprint.gamification_drills[activeDrillIndex]?.format_type === "SPEED_RUN" && "Answer the multiple-choice questions as fast as you can before the timer runs out."}
                  </p>
                </div>
              </div>
            )}

            {renderActiveDrill()}

            <div className="flex items-center justify-between mt-8 border-t border-slate-100 pt-6">
              <button
                onClick={() => setActiveDrillIndex(prev => prev - 1)}
                disabled={activeDrillIndex === 0}
                className="px-4 py-2 text-sm font-bold rounded-xl transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed bg-slate-100 text-slate-600 hover:bg-slate-200 flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" /> Previous
              </button>

              <span className="text-xs font-bold text-slate-400">
                {activeDrillIndex + 1} of {activeSprint.gamification_drills.length}
              </span>

              <button
                onClick={() => {
                  if (activeDrillIndex + 1 < activeSprint.gamification_drills.length) {
                    setActiveDrillIndex(prev => prev + 1);
                  } else {
                    setActiveTab("sprints");
                    setActiveSprint(null);
                  }
                }}
                className="px-4 py-2 text-sm font-bold rounded-xl transition-all cursor-pointer bg-indigo-50 text-indigo-700 hover:bg-indigo-100 flex items-center gap-2"
              >
                {activeDrillIndex + 1 < activeSprint.gamification_drills.length ? (
                  <>Next <ArrowRight className="w-4 h-4" /></>
                ) : (
                  <>Finish Sprint <Check className="w-4 h-4" /></>
                )}
              </button>
            </div>
          </div>
        )}

        {(leaderboardModalOpen || activeTab === "leaderboard") && (
          <GamificationLeaderboard 
            isOpen={leaderboardModalOpen || activeTab === "leaderboard"} 
            onClose={() => {
              setLeaderboardModalOpen(false);
              if (activeTab === "leaderboard") setActiveTab("sprints");
            }} 
          />
        )}

        {activeTab === "vault" && (
          <BadgesVault 
            unlockedBadges={unlockedBadges} 
            userXp={userXp} 
            streakDays={streakDays} 
          />
        )}
      </div>

      {/* New Badges Modal/Toast */}
      {newBadgesAlert.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl p-8 max-w-sm w-full text-center space-y-6 shadow-2xl scale-in-center">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-tr from-amber-400 via-orange-500 to-amber-500 text-white flex items-center justify-center shadow-lg shadow-amber-500/25 border border-amber-300/40 mb-2">
              <Award className="w-8 h-8 drop-shadow-sm" />
            </div>
            <h2 className="text-2xl font-black text-slate-900">New Badges Unlocked!</h2>
            <div className="space-y-4 max-h-60 overflow-y-auto p-2">
              {newBadgesAlert.map((badge, idx) => (
                <div key={idx} className="p-4 rounded-2xl bg-indigo-50 border border-indigo-100 flex items-center gap-4 text-left">
                  <div className="w-12 h-12 bg-white rounded-xl shadow-sm border border-indigo-50 flex items-center justify-center text-xl shrink-0">
                    {getBadgeIcon(badge.icon_symbol)}
                  </div>
                  <div>
                    <div className="text-[10px] font-black uppercase text-indigo-600 mb-0.5">{badge.metadata?.category || "Milestone"}</div>
                    <div className="text-sm font-bold text-slate-900">{badge.badge_title || badge.title}</div>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => {
                setNewBadgesAlert([]);
                setActiveTab("vault");
              }}
              className="w-full py-3.5 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold transition-all shadow-md active:scale-[0.98]"
            >
              View in Vault
            </button>
          </div>
        </div>
      )}

      {/* Streak Calendar Modal */}
      {streakModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-3xl p-6 max-w-sm w-full text-center space-y-6 shadow-2xl scale-in-center relative overflow-hidden">
            <button 
              onClick={() => setStreakModalOpen(false)}
              className="absolute top-4 right-4 p-2 bg-slate-100 rounded-full hover:bg-slate-200 text-slate-500 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="w-16 h-16 mx-auto bg-rose-50 rounded-2xl flex items-center justify-center mb-2">
              <Flame className="w-8 h-8 text-rose-500 fill-rose-500 animate-pulse" />
            </div>
            <div>
              <h2 className="text-2xl font-black text-slate-900">Your Streak</h2>
              <p className="text-sm text-slate-500 mt-1 font-medium">Keep completing drills daily to grow your streak!</p>
            </div>
            
            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
              <div className="flex justify-between text-xs font-bold text-slate-400 mb-3 px-1">
                {Array.from({length: 7}).map((_, i) => {
                  const d = new Date();
                  d.setDate(d.getDate() - (6 - i));
                  return <span key={i} className="w-8">{d.toLocaleDateString('en-US', {weekday: 'narrow'})}</span>;
                })}
              </div>
              <div className="flex justify-between">
                {Array.from({length: 7}).map((_, i) => {
                  const d = new Date();
                  d.setDate(d.getDate() - (6 - i));
                  const dateStr = d.toISOString().split('T')[0];
                  const isActive = activeDates.includes(dateStr);
                  
                  return (
                    <div 
                      key={i} 
                      className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black transition-all ${
                        isActive 
                          ? "bg-rose-500 text-white shadow-md shadow-rose-200" 
                          : "bg-white text-slate-300 border border-slate-200"
                      }`}
                    >
                      {isActive ? <Flame className="w-3.5 h-3.5 fill-white" /> : d.getDate()}
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 text-rose-600 font-black text-lg bg-rose-50 p-3 rounded-2xl">
              <Flame className="w-5 h-5 fill-rose-500" /> {streakDays} Days
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
