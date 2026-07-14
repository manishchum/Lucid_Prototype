"use client";

import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface AvatarBubbleProps {
  state: "idle" | "explaining" | "thinking";
  className?: string;
}

export default function AvatarBubble({ state, className }: AvatarBubbleProps) {
  const [mouthHeight, setMouthHeight] = useState(6);

  useEffect(() => {
    if (state !== "explaining") {
      setMouthHeight(6);
      return;
    }

    // Simulate speech mouth opening/closing with random intervals
    const interval = setInterval(() => {
      setMouthHeight(Math.floor(Math.random() * 16) + 4);
    }, 120);

    return () => clearInterval(interval);
  }, [state]);

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center w-64 h-64 select-none",
        className
      )}
    >
      {/* Outer Hologram Glow Ring */}
      <div
        className={cn(
          "absolute inset-0 rounded-full border-2 border-cyan-400/40 transition-all duration-1000",
          state === "explaining" && "animate-pulse border-cyan-400/70 scale-105",
          state === "thinking" && "animate-spin border-purple-500/40 border-dashed"
        )}
        style={{
          boxShadow:
            state === "explaining"
              ? "0 0 35px rgba(34, 211, 238, 0.4), inset 0 0 25px rgba(34, 211, 238, 0.2)"
              : state === "thinking"
              ? "0 0 35px rgba(168, 85, 247, 0.3)"
              : "0 0 20px rgba(6, 182, 212, 0.2)",
        }}
      />

      {/* Internal avatar card */}
      <div
        className={cn(
          "w-56 h-56 rounded-full overflow-hidden flex items-center justify-center transition-all duration-500",
          state === "thinking"
            ? "bg-gradient-to-tr from-indigo-950 via-slate-900 to-purple-950"
            : "bg-gradient-to-tr from-slate-950 via-slate-900 to-cyan-950"
        )}
      >
        <div className="relative w-full h-full flex flex-col items-center justify-center gap-4">
          {/* Futuristic Face Silhouette */}
          <div className="relative flex flex-col items-center justify-center gap-5">
            {/* Eyes */}
            <div className="flex gap-8">
              <div
                className={cn(
                  "w-4 h-4 rounded-full bg-cyan-300 transition-all duration-300 shadow-[0_0_10px_#22d3ee]",
                  state === "thinking" && "bg-purple-300 shadow-[0_0_10px_#c084fc] scale-90"
                )}
                style={{
                  animation: state === "thinking" ? "none" : "blink 4s ease-in-out infinite",
                }}
              />
              <div
                className={cn(
                  "w-4 h-4 rounded-full bg-cyan-300 transition-all duration-300 shadow-[0_0_10px_#22d3ee]",
                  state === "thinking" && "bg-purple-300 shadow-[0_0_10px_#c084fc] scale-90"
                )}
                style={{
                  animation: state === "thinking" ? "none" : "blink 4s ease-in-out infinite",
                }}
              />
            </div>

            {/* Mouth */}
            <div
              className={cn(
                "w-12 rounded-full bg-cyan-300 shadow-[0_0_8px_#22d3ee] transition-all duration-150",
                state === "thinking" && "w-6 h-2 bg-purple-300 shadow-[0_0_8px_#c084fc]"
              )}
              style={{
                height: `${mouthHeight}px`,
                borderRadius: mouthHeight > 8 ? "50%" : "0 0 20px 20px",
              }}
            />
          </div>

          {/* Sound waves overlay when explaining */}
          {state === "explaining" && (
            <div className="absolute bottom-6 flex items-end justify-center gap-1.5 h-6">
              {[...Array(6)].map((_, i) => (
                <div
                  key={i}
                  className="w-1 bg-cyan-400/80 rounded-full animate-bounce"
                  style={{
                    height: `${Math.random() * 100}%`,
                    animationDelay: `${i * 0.1}s`,
                    animationDuration: `${0.6 + Math.random() * 0.4}s`,
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Futuristic Floating Subtitle/Badge */}
      <div
        className={cn(
          "absolute -bottom-3 px-4 py-1.5 rounded-full text-[10px] font-bold tracking-widest uppercase text-white shadow-lg backdrop-blur-md transition-all duration-500",
          state === "explaining"
            ? "bg-cyan-500/80 border border-cyan-400/50 shadow-cyan-500/20"
            : state === "thinking"
            ? "bg-purple-500/80 border border-purple-400/50 shadow-purple-500/20"
            : "bg-slate-800/80 border border-slate-700/50"
        )}
      >
        {state === "explaining" ? "Narrating" : state === "thinking" ? "Thinking" : "Instructor"}
      </div>
    </div>
  );
}
