"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Play, CheckCircle, ArrowRight } from "lucide-react";

interface SimulationStep {
  screenshot_url: string;
  instruction: string;
  hotspot: {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  highlight_text?: string;
}

interface SimulationPlayerProps {
  segmentId: string;
  title: string;
  steps: SimulationStep[];
  onComplete: () => void;
}

export default function SimulationPlayer({
  segmentId,
  title,
  steps,
  onComplete,
}: SimulationPlayerProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const [hasStarted, setHasStarted] = useState(false);

  const handleHotspotClick = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep((prev) => prev + 1);
    } else {
      setIsCompleted(true);
    }
  };

  const handleRestart = () => {
    setCurrentStep(0);
    setIsCompleted(false);
    setHasStarted(true);
  };

  if (!hasStarted) {
    return (
      <div className="absolute inset-0 bg-slate-950/95 flex items-center justify-center p-6 z-20">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center flex flex-col gap-6 shadow-2xl items-center">
          <div className="w-16 h-16 rounded-full bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
            <Play className="w-8 h-8 fill-indigo-400 stroke-none" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">{title}</h3>
            <p className="text-sm text-slate-400 mt-2">
              Practice what you learned in a step-by-step interactive simulation walkthrough. Click the correct elements on the screen to progress.
            </p>
          </div>
          <Button
            onClick={() => setHasStarted(true)}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-6 rounded-xl text-md"
          >
            Start Simulation
          </Button>
        </div>
      </div>
    );
  }

  if (isCompleted) {
    return (
      <div className="absolute inset-0 bg-slate-950/95 flex items-center justify-center p-6 z-20">
        <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-8 text-center flex flex-col gap-6 shadow-2xl items-center animate-fade-in">
          <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <CheckCircle className="w-10 h-10" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">Simulation Completed!</h3>
            <p className="text-sm text-slate-400 mt-2">
              Well done! You successfully navigated through the interactive software walkthrough and clicked all hotspots.
            </p>
          </div>
          <div className="flex w-full gap-3">
            <Button
              onClick={handleRestart}
              variant="outline"
              className="flex-1 border-slate-700 hover:bg-slate-800 text-white font-bold py-6 rounded-xl text-md"
            >
              Retry Walkthrough
            </Button>
            <Button
              onClick={onComplete}
              className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-slate-900 font-bold py-6 rounded-xl text-md flex items-center justify-center gap-2"
            >
              Continue Course
              <ArrowRight className="w-5 h-5" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const step = steps[currentStep];

  return (
    <div className="absolute inset-0 bg-slate-950 flex flex-col md:flex-row z-20 overflow-hidden">
      {/* Simulation Instructions Sidebar */}
      <div className="w-full md:w-80 flex-shrink-0 bg-slate-900 border-b md:border-b-0 md:border-r border-slate-800 p-6 flex flex-col justify-between gap-6">
        <div className="flex flex-col gap-4">
          <div className="flex justify-between items-center">
            <span className="text-[10px] font-bold tracking-widest text-indigo-400 uppercase bg-indigo-500/10 px-3 py-1 rounded-full">
              Interactive Sim
            </span>
            <span className="text-xs text-slate-500 font-semibold">
              Step {currentStep + 1} of {steps.length}
            </span>
          </div>
          <h4 className="text-md font-bold text-white leading-snug">{title}</h4>
          <div className="p-4 bg-slate-800/40 border border-slate-700/50 rounded-xl">
            <p className="text-sm text-slate-300 leading-relaxed font-medium">
              {step.instruction}
            </p>
          </div>
        </div>
        <div className="text-xs text-slate-500 font-medium italic">
          💡 Tip: Click on the pulsing highlight border on the screen.
        </div>
      </div>

      {/* Interactive Screen Simulation Area */}
      <div className="flex-1 bg-slate-950 flex items-center justify-center relative p-6 overflow-hidden">
        {step.screenshot_url ? (
          <div className="relative w-full max-w-4xl aspect-[16/9] rounded-2xl border border-slate-800/80 overflow-hidden shadow-2xl">
            <img
              src={step.screenshot_url}
              alt={`Simulation step ${currentStep + 1}`}
              className="w-full h-full object-cover"
            />
            {/* Pulsing Hotspot overlay */}
            <button
              onClick={handleHotspotClick}
              className="absolute border-2 border-indigo-400 bg-indigo-500/20 rounded-md cursor-pointer animate-pulse hover:bg-indigo-500/40 hover:border-indigo-300 transition-colors duration-250 flex items-center justify-center text-[10px] font-bold text-indigo-300 shadow-[0_0_15px_rgba(99,102,241,0.5)]"
              style={{
                left: `${step.hotspot?.x ? (step.hotspot.x / 1280) * 100 : 80}%`,
                top: `${step.hotspot?.y ? (step.hotspot.y / 720) * 100 : 40}%`,
                width: `${step.hotspot?.w ? (step.hotspot.w / 1280) * 100 : 12}%`,
                height: `${step.hotspot?.h ? (step.hotspot.h / 720) * 100 : 6}%`,
              }}
            >
              Click
            </button>
          </div>
        ) : (
          /* Mock Visual Fallback if screenshots are loading/missing */
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 aspect-[16/9] rounded-2xl flex flex-col items-center justify-center gap-6 p-12 text-center relative shadow-2xl">
            <div className="text-slate-600 text-sm font-semibold tracking-wider uppercase">
              System Interface Mockup
            </div>
            <div className="text-white text-lg font-bold">{step.highlight_text || "SAP SD Interface Mockup"}</div>
            
            {/* Click Button Hotspot */}
            <button
              onClick={handleHotspotClick}
              className="px-6 py-3 border border-indigo-400 bg-indigo-500/20 text-indigo-300 font-bold rounded-xl animate-pulse hover:bg-indigo-500/40 hover:text-white transition-all shadow-[0_0_20px_rgba(99,102,241,0.3)]"
            >
              Click Here to Execute
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
