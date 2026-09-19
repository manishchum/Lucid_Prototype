"use client";

import React, { useState, useEffect, useRef } from "react";
import { Trophy, Shield, Flame, Zap, Sparkles, BookOpen, Check, Lock, Search, Loader2 } from "lucide-react";
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

export function GamificationLeaderboard() {
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

  const filteredLeaderboard = leaderboardData.filter((u) => 
    u.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
    u.role.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-64 bg-white rounded-3xl border border-slate-200">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex justify-center items-center h-64 bg-white rounded-3xl border border-red-200 text-red-500">
        {error}
      </div>
    );
  }

  return (
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
                  className={`hover:bg-slate-50 transition-colors ${user.is_current_user ? "bg-indigo-50/50 font-bold" : ""}`}
                >
                  <td className="py-4 px-6 font-black text-indigo-600">#{actualRank}</td>
                  <td className="py-4 px-6 font-bold text-slate-900">{user.name}</td>
                  <td className="py-4 px-6 text-slate-500">{user.role}</td>
                  <td className="py-4 px-6 text-center font-semibold">{user.sprints_completed}</td>
                  <td className="py-4 px-6 text-center font-black text-indigo-700">{user.badges_count}</td>
                  <td className="py-4 px-6 text-right font-black text-amber-600">{user.xp.toLocaleString()} XP</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function BadgesVault({ unlockedBadges, streakDays, userXp }: { unlockedBadges: any[], streakDays: number, userXp: number }) {
  return (
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
          {unlockedBadges.length} Badges Unlocked
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {(() => {
          const unlockedKeys = new Set(unlockedBadges.map(b => b.badge_key));
          const coreBadges = [
            {
              id: "badge_1", title: "Main Character 🎯", category: "Drill Milestone", desc: "Complete your 1st drill",
              icon: BookOpen, iconBg: "bg-indigo-50 text-indigo-600 border-indigo-100",
            },
            {
              id: "badge_2", title: "Locked In 🔒", category: "Drill Milestone", desc: "Complete 10 drills",
              icon: Shield, iconBg: "bg-blue-50 text-blue-600 border-blue-100",
            },
            {
              id: "badge_3", title: "G.O.A.T. Certified 🏆", category: "Drill Milestone", desc: "Complete 25 drills",
              icon: Trophy, iconBg: "bg-amber-50 text-amber-600 border-amber-100",
            },
            {
              id: "badge_4", title: "On Fire 🔥", category: "Streak Milestone", desc: "Maintain a 7-day active streak",
              icon: Flame, iconBg: "bg-rose-50 text-rose-600 border-rose-100",
            },
            {
              id: "badge_5", title: "Unstoppable ⚡", category: "Streak Milestone", desc: "Maintain a 14-day active streak",
              icon: Zap, iconBg: "bg-purple-50 text-purple-600 border-purple-100",
            },
            {
              id: "badge_6", title: "XP Billionaire 🌟", category: "XP Milestone", desc: "Reach 5,000+ total earned XP",
              icon: Sparkles, iconBg: "bg-emerald-50 text-emerald-600 border-emerald-100",
            }
          ];

          const renderedBadges = coreBadges.map(b => ({ ...b, unlocked: unlockedKeys.has(b.id) }));
          
          // Append any special/limited-time badges that the user unlocked but aren't in the core list
          unlockedBadges.forEach(b => {
            if (!coreBadges.some(core => core.id === b.badge_key)) {
              renderedBadges.push({
                id: b.badge_key,
                title: b.badge_title || "Special Badge",
                category: b.metadata?.category || "Event Milestone",
                desc: b.badge_description || "You unlocked a special badge!",
                icon: Trophy, // Fallback icon
                iconBg: "bg-fuchsia-50 text-fuchsia-600 border-fuchsia-100",
                unlocked: true
              });
            }
          });

          return renderedBadges.map((badge) => {
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
                  <><Check className="w-3.5 h-3.5 stroke-[3]" /> Unlocked</>
                ) : (
                  <><Lock className="w-3.5 h-3.5" /> Locked</>
                )}
              </span>
            </div>
          );
        })})()}
      </div>
    </div>
  );
}
