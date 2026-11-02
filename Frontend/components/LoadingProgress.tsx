"use client";

import React from "react";

interface LoadingProgressProps {
  label?: string;
  sublabel?: string;
}

export function LoadingProgress({
  label = "Loading your dashboard",
  sublabel = "Loading your data securely...",
}: LoadingProgressProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-xl bg-white rounded-[8px] shadow-lg border border-slate-100 p-6 flex flex-col items-center justify-center space-y-4">
        <div className="w-8 h-8 md:w-10 md:h-10 border-4 border-[#4F46E5] border-t-transparent rounded-full animate-spin"></div>
        <p className="text-sm font-semibold text-slate-700">{label}</p>
        <p className="text-xs text-slate-500 font-medium">{sublabel}</p>
      </div>
    </div>
  );
}

export default LoadingProgress;

