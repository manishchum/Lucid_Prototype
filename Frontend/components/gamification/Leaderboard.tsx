"use client";

import React, { useState, useEffect, useRef } from "react";
import { Trophy, Shield, Flame, Zap, Sparkles, BookOpen, Check, Lock, Search, Loader2, Clock, X, Target, ShieldCheck, Crown, Award, Star } from "lucide-react";
import { fetchLeaderboard } from "@/lib/api/gamification";

interface UserStat {
  id: string;
  name: string;
  role: string;
  sprints_completed: number;
  xp: number;
  badges_count: number;
  avatar_color: string;
  is_current_user?: boolean;
}

export interface GamificationLeaderboardProps {
  isOpen?: boolean;
  onClose?: () => void;
}

/**
 * Calculates progressive player level based on total XP using an exponential/Fibonacci curve.
 * Level 1: 0 XP
 * Level 2: 200 XP (1 Drill)
 * Level 3: 600 XP (3 Drills)
 * Level 4: 1,200 XP (6 Drills)
 * Level 5: 2,000 XP (10 Drills)
 */
export function calculateLevel(xp: number): number {
  if (!xp || xp <= 0) return 1;
  return Math.max(1, Math.floor((1 + Math.sqrt(1 + (8 * xp) / 200)) / 2));
}

export function GamificationLeaderboard({ isOpen = true, onClose }: GamificationLeaderboardProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [leaderboardData, setLeaderboardData] = useState<UserStat[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const hasFetched = useRef(false);

  useEffect(() => {
    async function loadData() {
      if (hasFetched.current) return;
      hasFetched.current = true;
      try {
        const data = await fetchLeaderboard();
        setLeaderboardData(data);
      } catch (err: any) {
        setError(err.message || "Failed to load leaderboard");
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  if (isOpen === false) return null;

  const filteredLeaderboard = leaderboardData.filter((u) =>
    u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    u.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const currentUserIndex = leaderboardData.findIndex((u) => u.is_current_user);
  const currentUser = currentUserIndex !== -1 ? leaderboardData[currentUserIndex] : null;
  const currentUserRank = currentUserIndex !== -1 ? currentUserIndex + 1 : null;

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in"
      onClick={onClose}
    >
      <div 
        className="bg-white rounded-3xl max-w-md sm:max-w-lg w-full shadow-2xl overflow-hidden border border-slate-100 flex flex-col max-h-[90vh] animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* HEADER BANNER */}
        <div className="bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600 p-5 sm:p-6 text-white flex items-center justify-between shadow-sm relative overflow-hidden shrink-0">
          <div className="flex items-center gap-3.5 z-10">
            <div className="w-11 h-11 rounded-2xl bg-white/15 border border-white/20 backdrop-blur-md flex items-center justify-center text-white shrink-0 shadow-inner">
              <Trophy className="w-6 h-6 text-amber-300 drop-shadow-xs" />
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-widest text-blue-200/90">
                GLOBAL RANKINGS
              </div>
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight leading-tight">
                Arena Leaderboard
              </h2>
            </div>
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-white/15 hover:bg-white/30 backdrop-blur-md transition-colors cursor-pointer text-white z-10"
              title="Close Leaderboard"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* SEARCH & PARTICIPANT CONTROLS */}
        <div className="p-4 sm:p-5 bg-white border-b border-slate-100 flex items-center justify-between gap-3 shrink-0">
          <div className="text-xs font-bold text-slate-500 hidden sm:flex items-center gap-1.5">
            <span>Standings</span>
            <span className="w-1 h-1 rounded-full bg-slate-300"></span>
            <span className="text-blue-600 font-extrabold">{leaderboardData.length} Competitors</span>
          </div>

          {/* Search Input */}
          <div className="relative w-full sm:w-64">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by name or tier..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium"
            />
          </div>
        </div>

        {/* LEADERBOARD LIST */}
        <div className="overflow-y-auto p-4 sm:p-5 space-y-2.5 max-h-[440px] scrollbar-thin scrollbar-thumb-slate-200 flex-1">
          {isLoading ? (
            <div className="flex justify-center items-center py-16">
              <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-rose-500 font-bold text-sm">
              {error}
            </div>
          ) : filteredLeaderboard.length === 0 ? (
            <div className="text-center py-12 text-slate-400 font-medium text-xs">
              No participants found matching &quot;{searchQuery}&quot;
            </div>
          ) : (
            filteredLeaderboard.map((user, index) => {
              const actualRank = leaderboardData.findIndex((u) => u.id === user.id) + 1;
              const isCurrentUser = user.is_current_user;
              const level = calculateLevel(user.xp || 0);
              const isTopRank = actualRank === 1;

              return (
                <div
                  key={user.id}
                  className={`p-3.5 sm:p-4 rounded-2xl border transition-all flex items-center justify-between gap-3 ${isCurrentUser
                      ? "bg-blue-50/80 border-blue-200/90 shadow-2xs text-blue-900"
                      : "bg-white border-slate-100 hover:border-slate-200 hover:bg-slate-50/60"
                    }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Rank Indicator */}
                    <span
                      className={`text-sm font-black w-6 text-center shrink-0 ${actualRank === 1
                          ? "text-amber-500"
                          : actualRank === 2
                            ? "text-slate-400"
                            : actualRank === 3
                              ? "text-amber-700"
                              : "text-slate-400 font-bold text-xs"
                        }`}
                    >
                      #{actualRank}
                    </span>

                    {/* Avatar */}
                    <div
                      className={`w-10 h-10 rounded-full font-black text-xs text-white flex items-center justify-center shrink-0 border border-white shadow-2xs ${user.avatar_color || "bg-indigo-600"
                        }`}
                    >
                      {user.name
                        ? user.name
                          .split(" ")
                          .map((n) => n[0])
                          .join("")
                          .substring(0, 2)
                          .toUpperCase()
                        : "U"}
                    </div>

                    {/* User Details */}
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-slate-900 flex items-center gap-1.5 flex-wrap leading-tight">
                        <span className="truncate">{user.name}</span>
                        {isTopRank && <span className="text-base leading-none">👑</span>}
                        {isCurrentUser && (
                          <span className="px-2 py-0.5 rounded-md bg-blue-600/90 text-white text-[10px] font-black tracking-wide shrink-0">
                            You
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 font-medium mt-0.5 truncate">
                        Lv. {level} · {user.role || "Grand Master"}
                      </div>
                    </div>
                  </div>

                  {/* Points */}
                  <div className="text-right shrink-0">
                    <span className="text-sm font-black text-blue-900 tracking-tight">
                      {user.xp.toLocaleString()} PTS
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* PINNED CURRENT USER FOOTER BAR */}
        {currentUser && (
          <div className="bg-gradient-to-r from-slate-900 via-blue-950 to-indigo-950 p-3.5 sm:p-4 text-white border-t border-blue-900/60 shadow-[0_-6px_20px_rgba(0,0,0,0.3)] flex items-center justify-between gap-3 shrink-0 z-20">
            <div className="flex items-center gap-3 min-w-0">
              {/* Rank Indicator */}
              <span className="text-sm font-black text-amber-400 w-6 text-center shrink-0">
                #{currentUserRank}
              </span>

              {/* Avatar */}
              <div
                className={`w-10 h-10 rounded-full font-black text-xs text-white flex items-center justify-center shrink-0 border border-white/30 shadow-2xs ${
                  currentUser.avatar_color || "bg-indigo-600"
                }`}
              >
                {currentUser.name
                  ? currentUser.name
                      .split(" ")
                      .map((n) => n[0])
                      .join("")
                      .substring(0, 2)
                      .toUpperCase()
                  : "U"}
              </div>

              {/* Details */}
              <div className="min-w-0">
                <div className="text-sm font-extrabold text-white flex items-center gap-1.5 leading-tight">
                  <span className="truncate">{currentUser.name}</span>
                  <span className="px-2 py-0.5 rounded-md bg-blue-600 text-white text-[10px] font-black tracking-wide uppercase shrink-0 shadow-2xs">
                    You
                  </span>
                </div>
                <div className="text-xs text-blue-200/80 font-medium mt-0.5 truncate">
                  Lv. {calculateLevel(currentUser.xp || 0)} · {currentUser.role || "Grand Master"}
                </div>
              </div>
            </div>

            {/* Points */}
            <div className="text-right shrink-0">
              <div className="text-[9px] font-extrabold text-blue-300/90 uppercase tracking-wider mb-0.5">Your Position</div>
              <span className="text-sm font-black text-amber-300 tracking-tight">
                {(currentUser.xp || 0).toLocaleString()} PTS
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function BadgesVault({ unlockedBadges, streakDays, userXp }: { unlockedBadges: any[], streakDays: number, userXp: number }) {
  return (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-slate-900 flex items-center gap-2.5">
            <Shield className="w-6 h-6 text-blue-600" />
            <span>Achievement Badges & Milestones</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1 font-medium">
            Milestone badges automatically unlocked as you complete statutory drills, streaks, and earn XP.
          </p>
        </div>
        {/* <div className="px-4 py-2 rounded-2xl bg-blue-50 border border-blue-100 text-blue-700 text-xs font-extrabold shrink-0">
          {unlockedBadges.length} Badges Unlocked
        </div> */}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {(() => {
          const unlockedKeys = new Set(unlockedBadges.map(b => b.badge_key));
          const coreBadges = [
            {
              id: "badge_1",
              title: "Main Character",
              category: "Drill Milestone",
              desc: "Complete your 1st drill",
              icon: Target,
              gradient: "from-indigo-600 via-violet-600 to-purple-500",
              shadow: "shadow-indigo-500/25",
              accentBg: "bg-indigo-50 text-indigo-700 border-indigo-200",
            },
            {
              id: "badge_2",
              title: "Locked In",
              category: "Drill Milestone",
              desc: "Complete 10 drills",
              icon: ShieldCheck,
              gradient: "from-blue-600 via-indigo-600 to-cyan-500",
              shadow: "shadow-blue-500/25",
              accentBg: "bg-blue-50 text-blue-700 border-blue-200",
            },
            {
              id: "badge_3",
              title: "G.O.A.T. Certified",
              category: "Drill Milestone",
              desc: "Complete 25 drills",
              icon: Crown,
              gradient: "from-amber-500 via-orange-500 to-yellow-400",
              shadow: "shadow-amber-500/25",
              accentBg: "bg-amber-50 text-amber-800 border-amber-200",
            },
            {
              id: "badge_4",
              title: "On Fire",
              category: "Streak Milestone",
              desc: "Maintain a 7-day active streak",
              icon: Flame,
              gradient: "from-rose-500 via-red-500 to-orange-500",
              shadow: "shadow-rose-500/25",
              accentBg: "bg-rose-50 text-rose-700 border-rose-200",
            },
            {
              id: "badge_5",
              title: "Unstoppable",
              category: "Streak Milestone",
              desc: "Maintain a 14-day active streak",
              icon: Zap,
              gradient: "from-purple-600 via-violet-600 to-indigo-500",
              shadow: "shadow-purple-500/25",
              accentBg: "bg-purple-50 text-purple-700 border-purple-200",
            },
            {
              id: "badge_6",
              title: "XP Billionaire",
              category: "XP Milestone",
              desc: "Reach 5,000+ total earned XP",
              icon: Star,
              gradient: "from-emerald-500 via-teal-500 to-cyan-500",
              shadow: "shadow-emerald-500/25",
              accentBg: "bg-emerald-50 text-emerald-800 border-emerald-200",
            }
          ];

          const renderedBadges = coreBadges.map(b => ({ ...b, unlocked: unlockedKeys.has(b.id) }));

          // Append any special/limited-time badges that the user unlocked but aren't in the core list
          unlockedBadges.forEach(b => {
            if (!coreBadges.some(core => core.id === b.badge_key)) {
              renderedBadges.push({
                id: b.badge_key,
                title: (b.badge_title || "Special Badge").replace(/[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').trim(),
                category: b.metadata?.category || "Event Milestone",
                desc: b.badge_description || "You unlocked a special badge!",
                icon: Award,
                gradient: "from-fuchsia-600 to-pink-500",
                shadow: "shadow-fuchsia-500/25",
                accentBg: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
                unlocked: true
              });
            }
          });

          return renderedBadges.map((badge) => {
            const Icon = badge.icon;
            return (
              <div
                key={badge.id}
                className={`p-6 rounded-3xl border text-center flex flex-col items-center justify-between transition-all duration-300 ${badge.unlocked
                    ? "bg-white border-slate-200/90 shadow-md hover:shadow-xl hover:-translate-y-1 hover:border-slate-300"
                    : "bg-slate-50/70 border-slate-200 opacity-65 grayscale-[0.5]"
                  }`}
              >
                {/* Category Pill */}
                <span className={`text-[10px] font-black uppercase tracking-wider px-2.5 py-1 rounded-full mb-4 border ${badge.unlocked ? badge.accentBg : "bg-slate-200/60 text-slate-500 border-slate-300/50"
                  }`}>
                  {badge.category}
                </span>

                {/* 3D Premium Badge Emblem Container */}
                <div className="relative mb-4">
                  <div
                    className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-transform ${badge.unlocked
                        ? `bg-gradient-to-tr ${badge.gradient} ${badge.shadow} shadow-lg text-white ring-4 ring-white/60 border border-white/40`
                        : "bg-slate-200 text-slate-400 border border-slate-300"
                      }`}
                  >
                    <Icon className="w-8 h-8 drop-shadow-sm" />
                  </div>

                  {badge.unlocked && (
                    <span className="absolute -bottom-1 -right-1 w-5 h-5 bg-emerald-500 text-white rounded-full flex items-center justify-center shadow-xs border-2 border-white">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </span>
                  )}
                </div>

                {/* Badge Title & Description */}
                <div className="mb-5">
                  <h3 className="text-base font-extrabold text-slate-900 tracking-tight">
                    {badge.title}
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 font-medium leading-relaxed">
                    {badge.desc}
                  </p>
                </div>

                {/* Unlocked / Locked Status Button */}
                <div
                  className={`w-full py-2.5 px-3 rounded-2xl text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${badge.unlocked
                      ? "bg-emerald-50 text-emerald-700 border border-emerald-200/80 shadow-2xs"
                      : "bg-slate-100 text-slate-500 border border-slate-200/60"
                    }`}
                >
                  {badge.unlocked ? (
                    <>
                      <Check className="w-4 h-4 stroke-[3] text-emerald-600" />
                      <span>Unlocked</span>
                    </>
                  ) : (
                    <>
                      <Lock className="w-3.5 h-3.5 text-slate-400" />
                      <span>Locked</span>
                    </>
                  )}
                </div>
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}
