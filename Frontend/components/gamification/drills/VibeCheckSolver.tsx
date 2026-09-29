"use client";

import React, { useState } from "react";
import { motion } from "framer-motion";
import { Check, X, ThumbsUp, ThumbsDown } from "lucide-react";

interface Props {
  drillData: any;
  isAlreadyCompleted: boolean;
  earnedXp?: number;
  onComplete: (payload: { completed: boolean; wrong_attempts: number; completion_time_seconds: number }) => void;
}

export default function VibeCheckSolver({ drillData, isAlreadyCompleted, earnedXp, onComplete }: Props) {
  const [startTime] = useState(Date.now());
  const [wrongAttempts, setWrongAttempts] = useState(0);
  const [isError, setIsError] = useState(false);

  const scenario = drillData?.scenario || drillData?.statement || drillData?.question || "";
  const isTrue = drillData?.is_true === true || drillData?.is_true === "true" || drillData?.correct_answer === true;

  const handleSelect = (userChoice: boolean) => {
    if (userChoice === isTrue) {
      const timeSecs = Math.floor((Date.now() - startTime) / 1000);
      onComplete({ completed: true, wrong_attempts: wrongAttempts, completion_time_seconds: timeSecs });
    } else {
      setWrongAttempts((prev) => prev + 1);
      setIsError(true);
      setTimeout(() => setIsError(false), 1000);
    }
  };

  return (
    <div className="space-y-6 text-center">
      <motion.div
        animate={isError ? { x: [-10, 10, -10, 10, 0] } : {}}
        transition={{ duration: 0.4 }}
        className={`p-8 rounded-3xl border-2 shadow-sm text-lg font-semibold text-slate-800 ${
          isError ? "border-rose-400 bg-rose-50" : "border-slate-200 bg-white"
        }`}
      >
        "{scenario}"
      </motion.div>

      <div className="grid grid-cols-2 gap-4">
        <button
          onClick={() => !isAlreadyCompleted && handleSelect(true)}
          disabled={isAlreadyCompleted}
          className={`flex flex-col items-center justify-center gap-2 p-6 rounded-2xl border-2 font-black transition-all ${
            isAlreadyCompleted && isTrue
              ? "bg-emerald-500 text-white border-emerald-600"
              : isAlreadyCompleted && !isTrue
              ? "opacity-50 bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed"
              : "bg-emerald-50 hover:bg-emerald-100 border-emerald-200 text-emerald-700 cursor-pointer"
          }`}
        >
          <ThumbsUp className="w-8 h-8" />
          True / Pass
        </button>
        
        <button
          onClick={() => !isAlreadyCompleted && handleSelect(false)}
          disabled={isAlreadyCompleted}
          className={`flex flex-col items-center justify-center gap-2 p-6 rounded-2xl border-2 font-black transition-all ${
            isAlreadyCompleted && !isTrue
              ? "bg-rose-500 text-white border-rose-600"
              : isAlreadyCompleted && isTrue
              ? "opacity-50 bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed"
              : "bg-rose-50 hover:bg-rose-100 border-rose-200 text-rose-700 cursor-pointer"
          }`}
        >
          <ThumbsDown className="w-8 h-8" />
          False / Flag
        </button>
      </div>

      {isAlreadyCompleted && (
        <div className="w-full py-3 px-4 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 font-black text-center flex items-center justify-center gap-2">
          <Check className="w-5 h-5 stroke-[3]" /> Successfully Completed! (+{earnedXp || 0} XP)
        </div>
      )}
    </div>
  );
}
