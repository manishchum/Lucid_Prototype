"use client";

import React, { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Trophy, Medal } from "lucide-react";
import { fetchWithAuth } from "@/lib/fetch-with-auth";
import { useAuth } from "@/contexts/auth-context";
import Image from "next/image";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

interface LeaderboardEntry {
  user_id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  completion_percentage: number;
  modules_completed: number;
  rank: number;
}

interface UserRankInfo {
  user_id: string;
  name: string;
  avatar_url: string | null;
  rank: number;
  completion_percentage: number;
  modules_completed: number;
  percentile: number;
  total_users: number;
  users_ahead: number;
}

interface LeaderboardModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: any; // Now passing the full employee object
}

export function LeaderboardModal({
  open,
  onOpenChange,
  employee,
}: LeaderboardModalProps) {
  const { loading: authLoading } = useAuth(); // Still need this to know when auth is ready
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [userRank, setUserRank] = useState<UserRankInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debug: Log employee from props whenever it changes
  useEffect(() => {
    console.log("[LeaderboardModal] Employee from props:", {
      employee,
      authLoading,
    });
  }, [employee, authLoading]);

  useEffect(() => {
    // Only fetch when modal is open AND employee object is fully available
    if (open && employee?.user_id && employee?.company_id && !authLoading) {
      console.log("[LeaderboardModal] Conditions met, fetching data for:", {
        user_id: employee.user_id,
        company_id: employee.company_id,
      });
      fetchLeaderboard();
    } else {
      console.log("[LeaderboardModal] Waiting for conditions:", {
        open,
        has_employee: !!employee,
        has_user_id: !!employee?.user_id,
        has_company_id: !!employee?.company_id,
        authLoading,
      });
    }
  }, [open, employee, authLoading]);

  async function fetchLeaderboard() {
    setLoading(true);
    setError(null);

    try {
      if (!employee?.user_id || !employee?.company_id) {
        const errMsg = "Employee data is incomplete.";
        console.error("[LeaderboardModal]", errMsg, { employee });
        throw new Error(errMsg);
      }

      const headers = {
        'X-User-ID': employee.user_id,
        'X-Company-ID': employee.company_id,
      };

      console.log("[LeaderboardModal] Request headers:", headers);

      const [leaderboardRes, rankRes] = await Promise.all([
        fetchWithAuth(
          `${API_BASE}/api/analytics/leaderboard/${employee.company_id}?limit=10`,
          { method: "GET", headers }
        ),
        fetchWithAuth(
          `${API_BASE}/api/analytics/leaderboard/${employee.company_id}/user-rank`,
          { method: "GET", headers }
        ),
      ]);

      // Process leaderboard response
      if (!leaderboardRes.ok) {
        const errorText = await leaderboardRes.text();
        console.error("[LeaderboardModal] Leaderboard error:", { status: leaderboardRes.status, body: errorText });
        throw new Error(`Failed to fetch leaderboard (${leaderboardRes.status})`);
      }
      const leaderboardData = await leaderboardRes.json();
      setLeaderboard(leaderboardData.data || []);

      // Process user rank response
      if (rankRes.ok) {
        const rankData = await rankRes.json();
        setUserRank(rankData.data || null);
      } else {
        console.warn("[LeaderboardModal] Failed to fetch user rank:", rankRes.status);
      }

    } catch (err) {
      console.error("Error fetching leaderboard:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load leaderboard"
      );
    } finally {
      setLoading(false);
    }
  }

  const getMedalIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Trophy className="h-5 w-5 text-yellow-500" />;
      case 2:
        return <Medal className="h-5 w-5 text-gray-400" />;
      case 3:
        return <Medal className="h-5 w-5 text-orange-600" />;
      default:
        return <span className="h-5 w-5 flex items-center justify-center text-sm font-semibold text-gray-600">{rank}</span>;
    }
  };

  const getRankBadgeColor = (rank: number) => {
    switch (rank) {
      case 1:
        return "bg-yellow-100 text-yellow-800";
      case 2:
        return "bg-gray-100 text-gray-800";
      case 3:
        return "bg-orange-100 text-orange-800";
      default:
        return "bg-slate-100 text-slate-800";
    }
  };

  const isUserInTop = leaderboard.some((entry) => entry.user_id === employee?.user_id);
  const currentUserRank = leaderboard.find(entry => entry.user_id === employee?.user_id) || userRank;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] flex flex-col">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-amber-500" />
            <DialogTitle>Leaderboard</DialogTitle>
          </div>
          <DialogDescription>
            Top performers based on module completion percentage.
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable content area */}
        <div className="flex-1 overflow-y-auto min-h-0 px-2">
          <div className="mt-4 space-y-3">
            {loading ? (
              // Loading skeleton
              <div className="space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex items-center gap-3 p-3 rounded-lg">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="flex-1">
                      <Skeleton className="h-4 w-24 mb-2" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                    <Skeleton className="h-6 w-12" />
                  </div>
                ))}
              </div>
            ) : error ? (
              <div className="text-center py-8 text-red-600">
                <p className="text-sm">{error}</p>
              </div>
            ) : leaderboard.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <p className="text-sm">No leaderboard data available yet.</p>
              </div>
            ) : (
              <>
                {/* Top performers list */}
                <div className="space-y-2">
                  {leaderboard.map((entry) => (
                    <div
                      key={entry.user_id}
                      className={`flex items-center gap-3 p-3 rounded-lg transition-colors ${
                        entry.user_id === employee?.user_id
                          ? "bg-blue-50 border border-blue-200"
                          : "bg-slate-50 hover:bg-slate-100"
                      }`}
                    >
                      {/* Rank and medal */}
                      <div className="flex items-center justify-center w-8">
                        {getMedalIcon(entry.rank)}
                      </div>

                      {/* Avatar */}
                      <div className="flex-shrink-0">
                        {entry.avatar_url ? (
                          <Image
                            src={entry.avatar_url}
                            alt={entry.name}
                            width={40}
                            height={40}
                            className="h-10 w-10 rounded-full object-cover"
                          />
                        ) : (
                          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-sm font-semibold">
                            {entry.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>

                      {/* Name and stats */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-semibold text-gray-900 truncate">
                            {entry.name}
                          </p>
                          {entry.user_id === employee?.user_id && (
                            <Badge variant="default" className="text-xs">
                              You
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-gray-500">
                          {entry.modules_completed} module
                          {entry.modules_completed !== 1 ? "s" : ""} completed
                        </p>
                      </div>

                      {/* Completion Percentage */}
                      <div className="flex-shrink-0 text-right">
                        <p className="text-sm font-bold text-blue-600">
                          {entry.completion_percentage}%
                        </p>
                        <p className="text-xs text-gray-500">complete</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* User rank info if not in top 10 */}
                {userRank && !isUserInTop && (
                  <div className="mt-6 pt-4 border-t">
                    <p className="text-xs text-gray-500 mb-2">Your Position</p>
                    <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-50 border border-blue-200">
                      {/* User's rank */}
                      <div className="flex items-center justify-center w-8">
                        <span className="text-sm font-semibold text-blue-600">
                          #{userRank.rank}
                        </span>
                      </div>

                      {/* User's avatar */}
                      <div className="flex-shrink-0">
                        {userRank.avatar_url ? (
                          <Image
                            src={userRank.avatar_url}
                            alt={userRank.name}
                            width={40}
                            height={40}
                            className="h-10 w-10 rounded-full object-cover"
                          />
                        ) : (
                          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-white text-sm font-semibold">
                            {userRank.name.charAt(0).toUpperCase()}
                          </div>
                        )}
                      </div>

                      {/* User's stats */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900">
                          {userRank.name}
                        </p>
                        <p className="text-xs text-gray-600">
                          {userRank.modules_completed} module
                          {userRank.modules_completed !== 1 ? "s" : ""} • Top{" "}
                          {userRank.percentile}%
                        </p>
                      </div>

                      {/* User's Completion Percentage */}
                      <div className="flex-shrink-0 text-right">
                        <p className="text-sm font-bold text-blue-600">
                          {userRank.completion_percentage}%
                        </p>
                        <p className="text-xs text-gray-500">complete</p>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Fixed footer stats - stays at bottom */}
        {!loading && !error && leaderboard.length > 0 && (
          <div className="mt-6 pt-4 border-t flex-shrink-0">
            <div className="grid grid-cols-2 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-gray-900">
                  {userRank?.total_users || 0}
                </p>
                <p className="text-xs text-gray-500">Total Users</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-blue-600">
                  {currentUserRank?.completion_percentage || 0}%
                </p>
                <p className="text-xs text-gray-500">Your Completion</p>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
