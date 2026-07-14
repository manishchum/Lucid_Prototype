"use client";

import React from "react";
import { CheckCircle2, Lock, PlayCircle, HelpCircle, Laptop } from "lucide-react";
import { cn } from "@/lib/utils";

interface Segment {
  id: string;
  title: string;
  type: string;
  order: number;
  duration?: number;
}

interface CourseProgressProps {
  segments: Segment[];
  activeSegmentId: string;
  completedSegmentIds: Set<string>;
  unlockedSegmentIds: Set<string>;
  onSegmentSelect: (segmentId: string) => void;
}

export default function CourseProgress({
  segments,
  activeSegmentId,
  completedSegmentIds,
  unlockedSegmentIds,
  onSegmentSelect,
}: CourseProgressProps) {
  const formatDuration = (sec?: number) => {
    if (!sec) return "0s";
    const m = Math.floor(sec / 60);
    const s = Math.round(sec % 60);
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  };

  return (
    <div className="w-full h-full bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-xl flex flex-col gap-4">
      <div className="border-b border-slate-800 pb-4">
        <h3 className="text-lg font-bold text-white tracking-wide">Course Chapters</h3>
        <p className="text-xs text-slate-500 font-semibold mt-1">Track your progress and unlocks</p>
      </div>

      <div className="flex flex-col gap-2 overflow-y-auto max-h-[450px] pr-1 scrollbar-thin">
        {segments.map((seg, index) => {
          const isCompleted = completedSegmentIds.has(seg.id);
          const isUnlocked = unlockedSegmentIds.has(seg.id);
          const isActive = activeSegmentId === seg.id;

          const getIcon = () => {
            if (!isUnlocked) return <Lock className="w-5 h-5 text-slate-600 shrink-0" />;
            if (isCompleted) return <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />;
            if (seg.type === "quiz_gate") return <HelpCircle className="w-5 h-5 text-amber-500 shrink-0" />;
            if (seg.type === "simulation") return <Laptop className="w-5 h-5 text-blue-400 shrink-0" />;
            return <PlayCircle className="w-5 h-5 text-indigo-400 shrink-0 animate-pulse" />;
          };

          return (
            <button
              key={seg.id}
              onClick={() => isUnlocked && onSegmentSelect(seg.id)}
              disabled={!isUnlocked}
              className={cn(
                "w-full flex items-center justify-between p-4 rounded-2xl border text-left transition-all duration-200",
                isActive
                  ? "bg-indigo-600/10 border-indigo-500 text-white shadow-[0_0_15px_rgba(99,102,241,0.15)]"
                  : isUnlocked
                  ? "bg-slate-850/50 border-slate-800 hover:bg-slate-800/80 hover:border-slate-700 text-slate-350 cursor-pointer"
                  : "bg-slate-950/20 border-slate-900 text-slate-650 cursor-not-allowed opacity-50"
              )}
            >
              <div className="flex items-center gap-3 pr-2 min-w-0">
                {getIcon()}
                <div className="flex flex-col min-w-0">
                  <span className="text-[10px] font-bold text-slate-500 tracking-wider uppercase">
                    Chapter {index + 1}
                  </span>
                  <span className="text-sm font-bold text-slate-200 mt-0.5 truncate">{seg.title}</span>
                </div>
              </div>

              {seg.type === "lecture" && seg.duration && (
                <span className="text-xs text-slate-500 font-semibold">{formatDuration(seg.duration)}</span>
              )}
              {seg.type === "quiz_gate" && (
                <span className="text-[10px] font-bold uppercase tracking-widest text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-md">
                  Quiz
                </span>
              )}
              {seg.type === "simulation" && (
                <span className="text-[10px] font-bold uppercase tracking-widest text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md">
                  Practice
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
