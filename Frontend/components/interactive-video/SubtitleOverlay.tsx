"use client";

import React from "react";

interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

interface SubtitleOverlayProps {
  cues: SubtitleCue[];
  currentTime: number;
}

export default function SubtitleOverlay({ cues, currentTime }: SubtitleOverlayProps) {
  // Find current active cue
  const activeCue = cues.find(
    (cue) => currentTime >= cue.start && currentTime <= cue.end
  );

  if (!activeCue) return null;

  return (
    <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-[80%] max-w-3xl z-10 px-6 py-4 rounded-2xl bg-slate-950/80 backdrop-blur-md border border-white/10 shadow-2xl flex items-center justify-center text-center animate-fade-in">
      <p className="text-white text-lg sm:text-xl font-medium tracking-wide leading-relaxed drop-shadow-[0_2px_4px_rgba(0,0,0,0.8)]">
        {activeCue.text}
      </p>
    </div>
  );
}
