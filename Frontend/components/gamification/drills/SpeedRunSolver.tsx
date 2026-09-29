"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Check, Clock } from "lucide-react";

interface Props {
  drillData: any;
  isAlreadyCompleted: boolean;
  earnedXp?: number;
  onComplete: (payload: { completed: boolean; wrong_attempts: number; completion_time_seconds: number }) => void;
}

export default function SpeedRunSolver({ drillData, isAlreadyCompleted, earnedXp, onComplete }: Props) {
  const [startTime] = useState(Date.now());
  const [wrongAttempts, setWrongAttempts] = useState(0);
  const [timeLeft, setTimeLeft] = useState(30);

  // Payload: { question: "...", options: ["A", "B"], correct_answer: "A" }
  const question = drillData?.question || "";
  const options = Array.isArray(drillData?.options) ? drillData.options : [];
  const correctAnswer = drillData?.correct_answer || "";

  const [isError, setIsError] = useState(false);

  useEffect(() => {
    if (isAlreadyCompleted) return;
    const timer = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          // Auto fail out of time? For now just record high time.
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isAlreadyCompleted]);

  const handleSelect = (option: string) => {
    if (option === correctAnswer) {
      const timeSecs = Math.floor((Date.now() - startTime) / 1000);
      onComplete({ completed: true, wrong_attempts: wrongAttempts, completion_time_seconds: timeSecs });
    } else {
      setWrongAttempts(prev => prev + 1);
      setIsError(true);
      // Penalize time!
      setTimeLeft(prev => Math.max(0, prev - 5));
      setTimeout(() => setIsError(false), 800);
    }
  };



  return (
    <div className="space-y-6">
      {!isAlreadyCompleted && (
        <>
          <div className="flex items-center justify-center gap-2 text-rose-500 font-black text-2xl">
            <Clock className="w-7 h-7" /> {timeLeft}s
          </div>
          
          <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
            <motion.div
              animate={{ width: `${(timeLeft / 30) * 100}%` }}
              className={`h-full ${timeLeft > 10 ? "bg-emerald-500" : "bg-rose-500"}`}
            />
          </div>
        </>
      )}

      <motion.div
        animate={isError ? { x: [-10, 10, -10, 10, 0] } : {}}
        transition={{ duration: 0.4 }}
        className={`p-6 sm:p-8 rounded-3xl border-2 shadow-sm text-lg sm:text-xl font-bold text-center text-slate-800 ${
          isError ? "border-rose-400 bg-rose-50" : "border-slate-200 bg-white"
        }`}
      >
        {question}
      </motion.div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {options.map((opt, idx) => (
          <button
            key={idx}
            onClick={() => !isAlreadyCompleted && handleSelect(opt)}
            disabled={isAlreadyCompleted}
            className={`p-4 rounded-2xl border-2 font-semibold transition-all text-left ${
              isAlreadyCompleted && opt === correctAnswer
                ? "bg-emerald-500 text-white border-emerald-600"
                : isAlreadyCompleted
                ? "bg-slate-50 border-slate-200 text-slate-400 opacity-50 cursor-not-allowed"
                : "bg-white border-slate-200 hover:border-indigo-500 hover:bg-indigo-50 text-slate-700"
            }`}
          >
            {opt}
          </button>
        ))}
      </div>

      {isAlreadyCompleted && (
        <div className="w-full py-3 px-4 mt-4 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 font-black text-center flex items-center justify-center gap-2">
          <Check className="w-5 h-5 stroke-[3]" /> Successfully Completed! (+{earnedXp || 0} XP)
        </div>
      )}
    </div>
  );
}
