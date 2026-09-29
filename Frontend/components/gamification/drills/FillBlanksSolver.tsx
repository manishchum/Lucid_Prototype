"use client";

import React, { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Check, X } from "lucide-react";

interface Props {
  drillData: any;
  isAlreadyCompleted: boolean;
  earnedXp?: number;
  onComplete: (payload: { completed: boolean; wrong_attempts: number; completion_time_seconds: number }) => void;
}

export default function FillBlanksSolver({ drillData, isAlreadyCompleted, earnedXp, onComplete }: Props) {
  const [startTime] = useState(Date.now());
  const [wrongAttempts, setWrongAttempts] = useState(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, string>>({});
  const [isError, setIsError] = useState(false);

  // Parse payload robustly
  const textWithBlanks = drillData?.text_with_blanks || drillData?.text || "";
  const blanks = (textWithBlanks.match(/\[BLANK\]/g) || []).length;
  const options = Array.isArray(drillData?.options) ? drillData.options : [];
  const correctAnswers = Array.isArray(drillData?.correct_answers) ? drillData.correct_answers : [];

  // Split text by [BLANK] to render inline dropdowns
  const parts = textWithBlanks.split(/\[BLANK\]/g);

  useEffect(() => {
    if (isAlreadyCompleted) {
      const correct: Record<number, string> = {};
      correctAnswers.forEach((ans: string, i: number) => {
        correct[i] = ans;
      });
      setSelectedAnswers(correct);
    }
  }, [isAlreadyCompleted, correctAnswers]);

  const handleSubmit = () => {
    // Check if all blanks filled
    if (Object.keys(selectedAnswers).length < blanks) return;

    let isCorrect = true;
    for (let i = 0; i < blanks; i++) {
      if (selectedAnswers[i] !== correctAnswers[i]) {
        isCorrect = false;
        break;
      }
    }

    if (isCorrect) {
      const timeSecs = Math.floor((Date.now() - startTime) / 1000);
      onComplete({ completed: true, wrong_attempts: wrongAttempts, completion_time_seconds: timeSecs });
    } else {
      setWrongAttempts((prev) => prev + 1);
      setIsError(true);
      setTimeout(() => setIsError(false), 1000);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-lg text-slate-800 leading-loose bg-slate-50 p-6 rounded-2xl border border-slate-200">
        {parts.map((part: string, idx: number) => (
          <React.Fragment key={idx}>
            <span>{part}</span>
            {idx < parts.length - 1 && (
              <select
                disabled={isAlreadyCompleted}
                className={`mx-2 p-1.5 rounded-lg border font-bold text-sm bg-white ${
                  isAlreadyCompleted ? "opacity-80 bg-slate-50 cursor-not-allowed" : "cursor-pointer"
                } ${
                  isError ? "border-rose-500 bg-rose-50 text-rose-700" : "border-slate-300 text-indigo-700"
                } focus:outline-none focus:ring-2 focus:ring-indigo-500`}
                value={selectedAnswers[idx] || ""}
                onChange={(e) => setSelectedAnswers({ ...selectedAnswers, [idx]: e.target.value })}
              >
                <option value="" disabled>Select option...</option>
                {options.map((opt: string, i: number) => (
                  <option key={i} value={opt}>{opt}</option>
                ))}
              </select>
            )}
          </React.Fragment>
        ))}
      </div>

      {isAlreadyCompleted ? (
        <div className="w-full py-3 px-4 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 font-black text-center flex items-center justify-center gap-2">
          <Check className="w-5 h-5 stroke-[3]" /> Successfully Completed! (+{earnedXp || 0} XP)
        </div>
      ) : (
        <motion.button
          animate={isError ? { x: [-10, 10, -10, 10, 0] } : {}}
          transition={{ duration: 0.4 }}
          onClick={handleSubmit}
          disabled={Object.keys(selectedAnswers).length < blanks}
          className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white font-black transition-all"
        >
          Submit Answer
        </motion.button>
      )}
    </div>
  );
}
