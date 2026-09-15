"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X, ShieldAlert } from "lucide-react";

interface Props {
  drillData: any;
  isAlreadyCompleted: boolean;
  earnedXp?: number;
  onComplete: (payload: { completed: boolean; wrong_attempts: number; completion_time_seconds: number }) => void;
}

export default function CodeBreakerSolver({ drillData, isAlreadyCompleted, earnedXp, onComplete }: Props) {
  const [startTime] = useState(Date.now());
  const [wrongAttempts, setWrongAttempts] = useState(0);
  
  // Safe extraction
  const sequence = Array.isArray(drillData?.sequence) ? drillData.sequence : [];
  const steps = sequence.map(s => s.step || s);
  
  // Scramble steps for user to order
  const [availableSteps, setAvailableSteps] = useState<string[]>(() => [...steps].sort(() => isAlreadyCompleted ? 0 : Math.random() - 0.5));
  const [orderedSteps, setOrderedSteps] = useState<string[]>([]);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    if (isAlreadyCompleted) {
      setOrderedSteps([...steps]);
      setAvailableSteps([]);
    }
  }, [isAlreadyCompleted, steps.length]);

  const handleSelect = (step: string) => {
    setAvailableSteps(prev => prev.filter(s => s !== step));
    setOrderedSteps(prev => [...prev, step]);
  };

  const handleRemove = (step: string) => {
    setOrderedSteps(prev => prev.filter(s => s !== step));
    setAvailableSteps(prev => [...prev, step]);
  };

  const handleSubmit = () => {
    let isCorrect = true;
    for (let i = 0; i < steps.length; i++) {
      if (orderedSteps[i] !== steps[i]) {
        isCorrect = false;
        break;
      }
    }

    if (isCorrect) {
      const timeSecs = Math.floor((Date.now() - startTime) / 1000);
      onComplete({ completed: true, wrong_attempts: wrongAttempts, completion_time_seconds: timeSecs });
    } else {
      setWrongAttempts(prev => prev + 1);
      setIsError(true);
      setTimeout(() => setIsError(false), 1000);
    }
  };



  return (
    <div className="space-y-6">
      <div className="p-6 rounded-2xl bg-slate-50 border border-slate-200 min-h-[150px]">
        <div className="text-xs font-black text-slate-500 uppercase tracking-widest mb-4">Your Sequence</div>
        <div className="flex flex-col gap-2">
          <AnimatePresence>
            {orderedSteps.map((step, idx) => (
              <motion.div
                key={`ord-${idx}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9 }}
                onClick={() => !isAlreadyCompleted && handleRemove(step)}
                className={`p-4 rounded-xl text-white font-semibold shadow-sm flex gap-3 ${
                  isAlreadyCompleted ? "bg-emerald-600 opacity-90 cursor-default" : "bg-indigo-600 cursor-pointer"
                }`}
              >
                <span className="font-black opacity-50">{idx + 1}.</span> {step}
              </motion.div>
            ))}
          </AnimatePresence>
          {orderedSteps.length === 0 && (
            <div className="text-slate-400 font-medium text-center py-4 italic">Tap steps below to build the sequence</div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {availableSteps.map((step, idx) => (
          <button
            key={`av-${idx}`}
            onClick={() => !isAlreadyCompleted && handleSelect(step)}
            disabled={isAlreadyCompleted}
            className="p-4 rounded-xl bg-white border-2 border-slate-200 hover:border-indigo-300 text-slate-700 font-semibold text-left transition-all"
          >
            {step}
          </button>
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
          disabled={orderedSteps.length < steps.length}
          className={`w-full py-3 rounded-xl font-black transition-all ${
            isError ? "bg-rose-500 text-white" : "bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 text-white"
          }`}
        >
          {isError ? "Incorrect Sequence! Try Again." : "Verify Sequence"}
        </motion.button>
      )}
    </div>
  );
}
