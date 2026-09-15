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
  Clock
} from "lucide-react";

import { fetchAssignedSprints, submitDrillProgress, fetchUserProfile, Sprint, Drill, DrillProgressPayload } from "@/lib/api/gamification";

import FillBlanksSolver from "@/components/gamification/drills/FillBlanksSolver";
import VibeCheckSolver from "@/components/gamification/drills/VibeCheckSolver";
import RiskRizzSolver from "@/components/gamification/drills/RiskRizzSolver";
import CodeBreakerSolver from "@/components/gamification/drills/CodeBreakerSolver";
import FlowMasterSolver from "@/components/gamification/drills/FlowMasterSolver";
import AuditSpotterSolver from "@/components/gamification/drills/AuditSpotterSolver";
import SpeedRunSolver from "@/components/gamification/drills/SpeedRunSolver";
import { GamificationLeaderboard, BadgesVault } from "@/components/gamification/Leaderboard";

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

export default function EmployeeGamifiedArenaPage() {
  const { hasFeature } = useTenant();
  const { user, userId, employeeData } = useAuth();
  const router = useRouter();

  useEffect(() => {
    // Commenting out feature flag check during development to prevent unwanted redirects
    // if (!hasFeature(FEATURES.GAMIFICATION)) {
    //   router.replace("/employee/welcome");
    // }
  }, [hasFeature, router]);

  const [activeTab, setActiveTab] = useState<"sprints" | "leaderboard" | "vault" | "drill">("sprints");
  const [soundMuted, setSoundMuted] = useState<boolean>(false);

  // Arena State
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeSprint, setActiveSprint] = useState<Sprint | null>(null);
  const [activeDrillIndex, setActiveDrillIndex] = useState<number>(0);

  // Stats (Mocks for now until we build Profile fetch route)
  const [userXp, setUserXp] = useState<number>(0);
  const [streakDays, setStreakDays] = useState<number>(0);
  const [streakModalOpen, setStreakModalOpen] = useState<boolean>(false);
  const [completedDrills, setCompletedDrills] = useState<Record<string, number>>({});

  const initialLoadDone = useRef(false);

  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;

    const loadInitialData = async () => {
      try {
        setIsLoading(true);
        
        // Optimize: Fetch profile and sprints concurrently
        const [profile, data] = await Promise.all([
          fetchUserProfile(),
          fetchAssignedSprints()
        ]);

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

    try {
      const data: DrillProgressPayload = {
        sprint_id: activeSprint.sprint_id,
        drill_id: currentDrill.drill_id,
        completed: payload.completed,
        wrong_attempts: payload.wrong_attempts,
        completion_time_seconds: payload.completion_time_seconds
      };

      const result = await submitDrillProgress(data);

      // Update UI with calculated XP & Streak from backend
      if (result.earned_xp) setUserXp(prev => prev + result.earned_xp);
      if (result.new_streak !== undefined) setStreakDays(result.new_streak);

      // Add to completed drills state
      setCompletedDrills(prev => ({
        ...prev,
        [activeSprint.gamification_drills[activeDrillIndex].drill_id]: result.earned_xp || 200
      }));

      playSound("complete");
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

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 font-sans selection:bg-indigo-500 selection:text-white pb-16">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_80%_80%_at_50%_-20%,rgba(99,102,241,0.05),rgba(255,255,255,0))]" />

      <div className="relative max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pt-6 space-y-6">
        {/* TOP COMPACT HEADER */}
        <header className="rounded-3xl bg-white border border-slate-200/80 p-5 shadow-sm space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
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
                <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                  Workfloww.ai Arena ⚡
                </h1>
              </div>
            </div>

            {/* TOP RIGHT ACTION BAR */}
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                onClick={toggleSound}
                className={`p-2 rounded-2xl border transition-all cursor-pointer shadow-2xs flex items-center justify-center ${soundMuted
                  ? "bg-slate-100 text-slate-400 border-slate-200"
                  : "bg-indigo-50 text-indigo-600 border-indigo-200 hover:bg-indigo-100"
                  }`}
              >
                {soundMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
              </button>

              <button
                onClick={() => {
                  playSound("tap");
                  setActiveTab("leaderboard");
                }}
                className="px-3.5 py-2 rounded-2xl border text-xs font-bold transition-all bg-amber-50 text-amber-900 border-amber-200/80 hover:bg-amber-100 cursor-pointer flex items-center gap-2"
              >
                <Trophy className="w-4 h-4 text-amber-500" />
                <span>Leaderboard</span>
              </button>

              <button
                onClick={() => {
                  playSound("tap");
                  setActiveTab("vault");
                }}
                className="px-3.5 py-2 rounded-2xl border text-xs font-bold transition-all bg-indigo-50 text-indigo-900 border-indigo-200/80 hover:bg-indigo-100 cursor-pointer flex items-center gap-2"
              >
                <Shield className="w-4 h-4 text-indigo-600" />
                <span>Badges</span>
              </button>

              <div
                onClick={() => {
                  playSound("tap");
                  setStreakModalOpen(true);
                }}
                className="flex items-center gap-1.5 bg-rose-50 border border-rose-200 text-rose-700 px-3.5 py-2 rounded-2xl text-xs font-extrabold cursor-pointer hover:bg-rose-100 transition-all"
              >
                <Flame className="w-4 h-4 text-rose-500 fill-rose-500" />
                <span>{streakDays} Day Streak 🔥</span>
              </div>

              <div className="flex items-center gap-1.5 bg-indigo-50 border border-indigo-100 text-indigo-700 px-3.5 py-2 rounded-2xl text-xs font-black shadow-2xs">
                <Sparkles className="w-4 h-4 fill-indigo-500 text-indigo-600" />
                <span>+{userXp} XP</span>
              </div>
            </div>
          </div>
        </header>

        {activeTab === "sprints" && (
          <div className="space-y-6">
            <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest bg-indigo-50 px-3 py-1 rounded-full border border-indigo-100">
                  STUDY MODE CURRICULUM
                </span>
                <h2 className="text-xl font-black text-slate-900 mt-2 flex items-center gap-2">
                  <Swords className="w-5 h-5 text-indigo-600" /> Sprint Roadmap
                </h2>
                <p className="text-xs text-slate-500 mt-1">
                  Master the AI-generated drills sequentially.
                </p>
              </div>
            </div>

            {isLoading ? (
              <div className="flex justify-center py-20 text-indigo-600 font-bold animate-pulse">Loading Sprints...</div>
            ) : sprints.length === 0 ? (
              <div className="flex justify-center py-20 text-slate-500 font-bold">No gamification sprints found for this module.</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {sprints.map((sprint, idx) => (
                  <div
                    key={sprint.sprint_id}
                    className="p-6 rounded-3xl border flex flex-col justify-between transition-all relative overflow-hidden bg-white border-indigo-500 ring-2 ring-indigo-500/10 shadow-md"
                  >
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          SPRINT {idx + 1}
                        </span>
                        <Sparkles className="w-5 h-5 text-indigo-600 animate-pulse" />
                      </div>

                      <div>
                        <h3 className="text-base font-black text-slate-900">{sprint.title}</h3>
                        <p className="text-xs text-slate-600 mt-1 leading-relaxed">{sprint.description}</p>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs font-bold pt-2 border-t border-slate-100">
                        <span className="text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-lg">
                          {sprint.gamification_drills?.length || 0} Drills
                        </span>
                      </div>
                    </div>

                    <div className="mt-6">
                      <button
                        onClick={() => {
                          playSound("tap");
                          setActiveSprint(sprint);
                          setActiveDrillIndex(0);
                          setActiveTab("drill");
                        }}
                        className="w-full py-3 px-4 rounded-2xl bg-indigo-600 hover:bg-indigo-700 text-white font-black text-xs transition-all shadow-md shadow-indigo-600/20 flex items-center justify-center gap-2 cursor-pointer"
                      >
                        Start Sprint <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "drill" && activeSprint && (
          <div className="rounded-3xl bg-white border border-slate-200/90 p-6 sm:p-8 shadow-sm space-y-6">
            <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3">
                <span className="px-3.5 py-1.5 rounded-full bg-indigo-100 text-indigo-700 text-xs font-black uppercase tracking-wider">
                  DRILL {activeDrillIndex + 1}: {activeSprint.gamification_drills[activeDrillIndex]?.format_type.replace("_", " ")}
                </span>
                <span className="text-xs font-bold text-slate-500">{activeSprint.gamification_drills[activeDrillIndex]?.title}</span>
              </div>
              <span className="px-3.5 py-1.5 rounded-full bg-rose-50 text-rose-600 border border-rose-100 text-xs font-black flex items-center gap-1">
                <Flame className="w-3.5 h-3.5 text-rose-500" /> Base XP: {activeSprint.gamification_drills[activeDrillIndex]?.base_xp || 200}
              </span>
            </div>

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

        {activeTab === "leaderboard" && (
          <GamificationLeaderboard />
        )}

        {activeTab === "vault" && (
          <BadgesVault completedCount={3} streakDays={streakDays} userXp={userXp} />
        )}
      </div>
    </div>
  );
}
