"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, X, ArrowDown } from "lucide-react";

interface Props {
  drillData: any;
  isAlreadyCompleted: boolean;
  earnedXp?: number;
  onComplete: (payload: { completed: boolean; wrong_attempts: number; completion_time_seconds: number }) => void;
}

export default function FlowMasterSolver({ drillData, isAlreadyCompleted, earnedXp, onComplete }: Props) {
  const [startTime] = useState(Date.now());
  const [wrongAttempts, setWrongAttempts] = useState(0);
  
  const rawSteps = Array.isArray(drillData?.steps) ? drillData.steps : [];
  const steps = rawSteps.map(s => s.description || s);

  const [availableSteps, setAvailableSteps] = useState<string[]>(() => [...steps].sort(() => isAlreadyCompleted ? 0 : Math.random() - 0.5));
  const [flow, setFlow] = useState<string[]>([]);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    if (isAlreadyCompleted) {
      setFlow([...steps]);
      setAvailableSteps([]);
    }
  }, [isAlreadyCompleted, steps.length]);

  const handleAdd = (step: string) => {
    setAvailableSteps(prev => prev.filter(s => s !== step));
    setFlow(prev => [...prev, step]);
  };

  const handleRemove = (step: string) => {
    setFlow(prev => prev.filter(s => s !== step));
    setAvailableSteps(prev => [...prev, step]);
  };

  const handleSubmit = () => {
    let isCorrect = true;
    for (let i = 0; i < steps.length; i++) {
      if (flow[i] !== steps[i]) {
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
    <div className="flex flex-col md:flex-row gap-8">
      {/* Flow Builder */}
      <div className="flex-1 space-y-4 bg-slate-50 p-6 rounded-3xl border border-slate-200">
        <div className="text-xs font-black text-slate-500 uppercase tracking-widest text-center mb-2">Process Flow</div>
        
        <div className="flex flex-col items-center gap-2">
          <AnimatePresence>
            {flow.map((step, idx) => (
              <React.Fragment key={`flow-${idx}`}>
                <motion.div
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  onClick={() => !isAlreadyCompleted && handleRemove(step)}
                  className={`w-full p-4 rounded-2xl text-white font-semibold text-center shadow-md transition-colors ${
                    isAlreadyCompleted ? "bg-emerald-600 opacity-90 cursor-default" : "bg-cyan-600 cursor-pointer hover:bg-cyan-700"
                  }`}
                >
                  {step}
                </motion.div>
                {idx < flow.length - 1 && (
                  <ArrowDown className="w-5 h-5 text-cyan-300" />
                )}
              </React.Fragment>
            ))}
          </AnimatePresence>
          {flow.length === 0 && (
            <div className="text-slate-400 italic font-medium py-8 text-center border-2 border-dashed border-slate-300 rounded-2xl w-full">
              Tap steps to build the flowchart
            </div>
          )}
        </div>
      </div>

      {/* Available Pool */}
      <div className="flex-1 space-y-6">
        <div className="grid grid-cols-1 gap-3">
          {availableSteps.map((step, idx) => (
            <button
              key={`av-${idx}`}
              onClick={() => !isAlreadyCompleted && handleAdd(step)}
              disabled={isAlreadyCompleted}
              className="p-4 rounded-xl bg-white border-2 border-slate-200 hover:border-cyan-300 text-slate-700 font-semibold text-left transition-all"
            >
              {step}
            </button>
          ))}
        </div>

        {isAlreadyCompleted ? (
          <div className="w-full py-3 px-4 mt-6 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 font-black text-center flex items-center justify-center gap-2">
            <Check className="w-5 h-5 stroke-[3]" /> Successfully Completed! (+{earnedXp || 0} XP)
          </div>
        ) : (
          <motion.button
            animate={isError ? { x: [-10, 10, -10, 10, 0] } : {}}
            transition={{ duration: 0.4 }}
            onClick={handleSubmit}
            disabled={flow.length < steps.length}
            className="w-full mt-6 py-3 rounded-xl bg-cyan-600 hover:bg-cyan-700 disabled:bg-slate-300 text-white font-black transition-all"
          >
            Verify Flow
          </motion.button>
        )}
      </div>
    </div>
  );
}
