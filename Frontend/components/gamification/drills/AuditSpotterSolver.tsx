"use client";

import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Check, ShieldAlert } from "lucide-react";

interface Props {
  drillData: any;
  isAlreadyCompleted: boolean;
  earnedXp?: number;
  onComplete: (payload: { completed: boolean; wrong_attempts: number; completion_time_seconds: number }) => void;
}

export default function AuditSpotterSolver({ drillData, isAlreadyCompleted, earnedXp, onComplete }: Props) {
  const [startTime] = useState(Date.now());
  const [wrongAttempts, setWrongAttempts] = useState(0);

  // Payload: { text: "The policy allows surrender after 1 year.", red_flags: ["1 year"] }
  const fullText: string = drillData?.text || drillData?.document || drillData?.scenario || "";
  const rawFlags = Array.isArray(drillData?.red_flags) ? drillData.red_flags : (Array.isArray(drillData?.flags) ? drillData.flags : []);
  
  // Create clickable spans for words
  const words = fullText.split(/(\s+)/);
  const [selectedWords, setSelectedWords] = useState<number[]>([]);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    if (isAlreadyCompleted) {
      const newSelected: number[] = [];
      const cleanStr = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
      
      for (const flag of rawFlags) {
        const cleanFlag = cleanStr(flag);
        if (!cleanFlag) continue;
        
        const flagWords = cleanFlag.split(" ");
        for (let i = 0; i <= words.length - flagWords.length; i++) {
          let match = true;
          for (let j = 0; j < flagWords.length; j++) {
            if (cleanStr(words[i+j]) !== flagWords[j]) {
              match = false;
              break;
            }
          }
          if (match) {
            for (let j = 0; j < flagWords.length; j++) {
              newSelected.push(i+j);
            }
          }
        }
      }
      setSelectedWords(Array.from(new Set(newSelected)));
    }
  }, [isAlreadyCompleted, rawFlags.length]);

  const toggleWord = (index: number) => {
    if (selectedWords.includes(index)) {
      setSelectedWords(prev => prev.filter(i => i !== index));
    } else {
      setSelectedWords(prev => [...prev, index]);
    }
  };

  const handleSubmit = () => {
    // Sort selected indices so text is in original order
    const sortedIndices = [...selectedWords].sort((a, b) => a - b);
    
    // Clean punctuation for robust matching
    const cleanStr = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
    
    const selectedText = cleanStr(sortedIndices.map(i => words[i]).join(" "));
    
    let foundCount = 0;

    for (const flag of rawFlags) {
      const cleanFlag = cleanStr(flag);
      if (!cleanFlag) continue;
      
      // Strict match
      if (selectedText.includes(cleanFlag)) {
        foundCount++;
      } else {
        // Fallback: check if the user selected at least 70% of the words in the flag
        const flagWords = cleanFlag.split(" ");
        let matchCount = 0;
        for (const fw of flagWords) {
          if (selectedText.includes(fw)) matchCount++;
        }
        if (flagWords.length > 0 && (matchCount / flagWords.length) >= 0.7) {
          foundCount++;
        }
      }
    }

    // Must find all red flags
    const isCorrect = rawFlags.length > 0 && foundCount >= rawFlags.length;

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
      <div className="bg-amber-50 border border-amber-200 text-amber-800 p-4 rounded-xl flex gap-3 text-sm font-semibold">
        <ShieldAlert className="w-5 h-5 shrink-0 text-amber-600" />
        <p>Audit this document. Tap the words/phrases that represent non-compliant rules or red flags based on standard policy.</p>
      </div>
      
      {(!fullText || rawFlags.length === 0) && (
        <div className="p-4 bg-rose-50 text-rose-600 rounded-xl font-medium border border-rose-200">
          Error: This drill was generated with invalid data. Please regenerate the sprint.
        </div>
      )}

      <div className="text-lg text-slate-800 leading-loose bg-white p-6 sm:p-8 rounded-3xl border-2 border-slate-200 shadow-sm">
        {words.map((word, idx) => {
          if (word.trim() === "") return <span key={idx}>{word}</span>;
          
          const isSelected = selectedWords.includes(idx);
          return (
            <span
              key={idx}
              onClick={() => !isAlreadyCompleted && toggleWord(idx)}
              className={`transition-colors px-1 py-0.5 rounded-md ${
                isAlreadyCompleted ? (isSelected ? "bg-rose-200 text-rose-900 font-bold border-b-2 border-rose-500 cursor-default" : "cursor-default") : (isSelected ? "bg-rose-200 text-rose-900 font-bold border-b-2 border-rose-500 cursor-pointer" : "hover:bg-slate-100 cursor-pointer")
              }`}
            >
              {word}
            </span>
          );
        })}
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
          disabled={selectedWords.length === 0}
          className={`w-full py-4 rounded-2xl font-black text-lg transition-all ${
            isError ? "bg-rose-500 text-white" : "bg-amber-500 hover:bg-amber-600 disabled:bg-slate-200 disabled:text-slate-400 text-white shadow-lg shadow-amber-500/20"
          }`}
        >
          {isError ? "Incorrect! Spot the real red flags." : "Flag Selected Text"}
        </motion.button>
      )}
    </div>
  );
}
