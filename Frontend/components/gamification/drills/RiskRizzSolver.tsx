"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X } from "lucide-react";

interface Props {
  drillData: any;
  isAlreadyCompleted: boolean;
  earnedXp?: number;
  onComplete: (payload: { completed: boolean; wrong_attempts: number; completion_time_seconds: number }) => void;
}

export default function RiskRizzSolver({ drillData, isAlreadyCompleted, earnedXp, onComplete }: Props) {
  const [startTime] = useState(Date.now());
  const [wrongAttempts, setWrongAttempts] = useState(0);
  
  // Safe extraction of pairs
  const rawPairs = Array.isArray(drillData?.pairs) ? drillData.pairs : [];
  
  // Scramble left and right columns only if not completed
  const [leftItems] = useState(() => rawPairs.map((p, i) => ({ id: i, text: p.left || p.term })).sort(() => isAlreadyCompleted ? 0 : Math.random() - 0.5));
  const [rightItems] = useState(() => rawPairs.map((p, i) => ({ id: i, text: p.right || p.definition })).sort(() => isAlreadyCompleted ? 0 : Math.random() - 0.5));

  const [selectedLeft, setSelectedLeft] = useState<number | null>(null);
  const [matchedPairs, setMatchedPairs] = useState<number[]>([]);
  const [errorPair, setErrorPair] = useState<{ left: number, right: number } | null>(null);

  useEffect(() => {
    if (isAlreadyCompleted) {
      setMatchedPairs(rawPairs.map((_, i) => i));
    }
  }, [isAlreadyCompleted, rawPairs.length]);

  const handleRightClick = (rightId: number) => {
    if (selectedLeft === null) return;

    if (selectedLeft === rightId) {
      // Match correct
      const newMatches = [...matchedPairs, rightId];
      setMatchedPairs(newMatches);
      setSelectedLeft(null);

      if (newMatches.length === rawPairs.length) {
        const timeSecs = Math.floor((Date.now() - startTime) / 1000);
        onComplete({ completed: true, wrong_attempts: wrongAttempts, completion_time_seconds: timeSecs });
      }
    } else {
      // Mismatch
      setWrongAttempts(prev => prev + 1);
      setErrorPair({ left: selectedLeft, right: rightId });
      setTimeout(() => {
        setErrorPair(null);
        setSelectedLeft(null);
      }, 800);
    }
  };



  return (
    <div className="grid grid-cols-2 gap-6">
      {rawPairs.length === 0 ? (
        <div className="col-span-2 p-4 bg-rose-50 text-rose-600 rounded-xl font-medium border border-rose-200">
          Error: This drill was generated with invalid data. Please regenerate the sprint.
        </div>
      ) : (
        <>
          {/* LEFT COLUMN */}
          <div className="space-y-3">
            <div className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4">Terms / Scenarios</div>
            {leftItems.map((item) => {
              const isMatched = matchedPairs.includes(item.id);
              const isSelected = selectedLeft === item.id;
              const isError = errorPair?.left === item.id;

              return (
                <motion.button
                  key={`L-${item.id}`}
                  animate={isError ? { x: [-5, 5, -5, 5, 0] } : {}}
                  onClick={() => !isMatched && setSelectedLeft(isSelected ? null : item.id)}
                  disabled={isMatched}
                  className={`w-full p-4 rounded-2xl border-2 text-left font-semibold transition-all cursor-pointer ${
                    isMatched ? "bg-emerald-50 border-emerald-200 text-emerald-700 opacity-50 cursor-not-allowed" :
                    isSelected ? "bg-indigo-50 border-indigo-500 text-indigo-700 shadow-md" :
                    isError ? "bg-rose-50 border-rose-400 text-rose-700" :
                    "bg-white border-slate-200 text-slate-700 hover:border-indigo-300"
                  }`}
                >
                  {item.text}
                </motion.button>
              );
            })}
          </div>

          {/* RIGHT COLUMN */}
          <div className="space-y-3">
            <div className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4">Definitions / Actions</div>
            {rightItems.map((item) => {
              const isMatched = matchedPairs.includes(item.id);
              const isError = errorPair?.right === item.id;

              return (
                <motion.button
                  key={`R-${item.id}`}
                  animate={isError ? { x: [-5, 5, -5, 5, 0] } : {}}
                  onClick={() => !isMatched && handleRightClick(item.id)}
                  disabled={isMatched || selectedLeft === null}
                  className={`w-full p-4 rounded-2xl border-2 text-left font-semibold transition-all cursor-pointer ${
                    isMatched ? "bg-emerald-50 border-emerald-200 text-emerald-700 opacity-50 cursor-not-allowed" :
                    isError ? "bg-rose-50 border-rose-400 text-rose-700" :
                    "bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100"
                  }`}
                >
                  {item.text}
                </motion.button>
              );
            })}
          </div>
        </>
      )}
      
      {isAlreadyCompleted && (
        <div className="col-span-2 mt-4 w-full py-3 px-4 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 font-black text-center flex items-center justify-center gap-2">
          <Check className="w-5 h-5 stroke-[3]" /> Successfully Completed! (+{earnedXp || 0} XP)
        </div>
      )}
    </div>
  );
}
