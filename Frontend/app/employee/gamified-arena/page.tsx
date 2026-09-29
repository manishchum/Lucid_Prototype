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
  Info
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
  const [activeDates, setActiveDates] = useState<string[]>([]);
  const [completedDrills, setCompletedDrills] = useState<Record<string, number>>({});
  const [unlockedBadges, setUnlockedBadges] = useState<any[]>([]);
  const [newBadgesAlert, setNewBadgesAlert] = useState<any[]>([]);

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
                className="px-3.5 py-2 rounded-2xl border text-xs font-bold transition-all bg-blue-50 text-blue-900 border-blue-200/80 hover:bg-blue-100 cursor-pointer flex items-center gap-2 relative"
              >
                <Shield className="w-4 h-4 text-blue-500" />
                <span>Badges <span className="ml-1 bg-blue-200 text-blue-800 px-1.5 py-0.5 rounded-md text-[10px]">{unlockedBadges.length}</span></span>
                {newBadgesAlert.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-3 h-3 bg-rose-500 rounded-full animate-ping"></span>
                )}
                {newBadgesAlert.length > 0 && (
                  <span className="absolute -top-1 -right-1 w-3 h-3 bg-rose-500 rounded-full border-2 border-white"></span>
                )}
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

                  return (
                    <div
                      key={sprint.sprint_id}
                      className="p-6 rounded-3xl border flex flex-col justify-between transition-all relative overflow-hidden bg-white border-indigo-500 ring-2 ring-indigo-500/10 shadow-md"
                    >
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <span className={`text-[10px] font-black uppercase tracking-wider px-3 py-1 rounded-full border ${isLocked ? "bg-slate-50 text-slate-500 border-slate-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>
                            SPRINT {idx + 1}
                          </span>
                          {isLocked ? (
                            <Lock className="w-5 h-5 text-slate-400" />
                          ) : (
                            <Sparkles className="w-5 h-5 text-indigo-600 animate-pulse" />
                          )}
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
                      {(() => {
                        const sprintDrillIds = sprint.gamification_drills?.map((d: any) => d.drill_id) || [];
                        const completedCount = sprintDrillIds.filter((id: string) => completedDrills[id] !== undefined).length;
                        const totalDrills = sprintDrillIds.length;
                        const isCompleted = totalDrills > 0 && completedCount === totalDrills;
                        const isInProgress = completedCount > 0 && completedCount < totalDrills;

                        let btnText = "Let's Cook 🚀"; // Start Sprint
                        let btnStyle = "bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-600/20";
                        let statusText = "0% Rizz";

                        if (isLocked) {
                          btnText = "Locked 🔒";
                          btnStyle = "bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed";
                          statusText = "Complete Previous Sprint To Unlock";
                        } else if (isCompleted) {
                          btnText = "Flex Review 👀"; // Review
                          btnStyle = "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-600/20";
                          statusText = "Completed / Big W 👑";
                        } else if (isInProgress) {
                          btnText = "Keep Grinding 💪"; // Resume
                          btnStyle = "bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/20";
                          statusText = `${Math.round((completedCount / totalDrills) * 100)}% Cooked`;
                        }

                        return (
                          <div className="space-y-3">
                            <div className="flex justify-between items-center text-[10px] font-bold text-slate-500 uppercase tracking-wider px-1">
                              <span>Status:</span>
                              <span className={isLocked ? "text-slate-400" : isCompleted ? "text-emerald-600" : isInProgress ? "text-amber-600" : "text-slate-400"}>{statusText}</span>
                            </div>
                            <button
                              onClick={() => {
                                if (isLocked) return;
                                playSound("tap");
                                setActiveSprint(sprint);
                                setActiveDrillIndex(isCompleted ? 0 : completedCount);
                                setActiveTab("drill");
                                setShowDrillInstructions(false);
                              }}
                              disabled={isLocked}
                              className={`w-full py-3 px-4 rounded-2xl font-black text-xs transition-all flex items-center justify-center gap-2 ${btnStyle} ${!isLocked ? "shadow-md cursor-pointer" : ""}`}
                            >
                              {btnText} {!isLocked && <ArrowRight className="w-4 h-4" />}
                            </button>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                )})}
              </div>
            )}
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

        {activeTab === "leaderboard" && (
          <GamificationLeaderboard />
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
            <div className="text-5xl mb-2">🎉</div>
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
