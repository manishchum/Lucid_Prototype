"use client";

import React, { useEffect } from 'react';
import Link from "next/link";
import { useRouter } from "next/navigation";
import { 
  BookOpen, 
  Puzzle, 
  Map, 
  TrendingUp, 
  UserCheck 
} from "lucide-react";
import Footer from "@/components/Footer";
import { useAuth, hasActiveSession } from "@/contexts/auth-context";
import { auth } from "@/lib/firebase";

export default function LandingPage() {
  const router = useRouter();
  const { user } = useAuth();

  useEffect(() => {
    if (user || hasActiveSession()) {
      router.replace('/employee/welcome');
    }
  }, [user, router]);

  useEffect(() => {
    const handleFocusCheck = () => {
      if (document.visibilityState === "visible") {
        if (hasActiveSession() || auth?.currentUser) {
          router.replace('/employee/welcome');
        }
      }
    };

    window.addEventListener("focus", handleFocusCheck);
    document.addEventListener("visibilitychange", handleFocusCheck);
    window.addEventListener("storage", handleFocusCheck);

    return () => {
      window.removeEventListener("focus", handleFocusCheck);
      document.removeEventListener("visibilitychange", handleFocusCheck);
      window.removeEventListener("storage", handleFocusCheck);
    };
  }, [router]);
  const rowOneFeatures = [
    {
      title: 'Living Knowledge Base',
      description: 'Brings your playbooks, product facts and deal learnings into one place that updates itself as your business changes.',
      icon: BookOpen,
    },
    {
      title: 'Smart Intelligence',
      description: 'Removes repeated manual work and tells every sales rep which account to act on next and why.',
      icon: Puzzle,
    },
    {
      title: 'Adaptive Pathways',
      description: "Builds each sales rep's learning journey from their own performance, and refreshes it after every Performance Sprint",
      icon: Map,
    },
  ];

  const rowTwoFeatures = [
    {
      title: 'Performance Coach',
      description: 'Gives sales reps clear guidance right before a customer visit, so they act on it instead of finding out later what they missed.',
      icon: TrendingUp,
    },
    {
      title: 'Competency Proofing',
      description: 'Confirms a sales rep has the skill by checking what they did in the field, not what they scored on a test.',
      icon: UserCheck,
    },
  ];

  return (
    <div className="h-screen max-h-screen w-full bg-[#F6F7FD] font-sans flex flex-col justify-between relative overflow-hidden select-none">
      
      {/* Background Ambience and Glowing Architectural Lines */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        {/* Soft radial background glow */}
        <div 
          className="absolute inset-0"
          style={{
            background: 'radial-gradient(circle at 50% 20%, #FFFFFF 0%, #F6F7FD 65%, #EEF0FA 100%)'
          }}
        />

        {/* Dynamic Architectural Geometric Lines */}
        <svg 
          className="absolute inset-0 w-full h-full" 
          viewBox="0 0 1440 900" 
          preserveAspectRatio="none" 
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            {/* Neon Glow Filter */}
            <filter id="neon-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="8" result="blur1" />
              <feGaussianBlur stdDeviation="3" result="blur2" />
              <feMerge>
                <feMergeNode in="blur1" />
                <feMergeNode in="blur2" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>

            <linearGradient id="purple-laser" x1="0%" y1="100%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#8B5CF6" stopOpacity="0.1" />
              <stop offset="35%" stopColor="#A855F7" stopOpacity="0.85" />
              <stop offset="80%" stopColor="#7C3AED" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#9333EA" stopOpacity="0.7" />
            </linearGradient>

            <linearGradient id="left-arc" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#A5B4FC" stopOpacity="0.15" />
              <stop offset="50%" stopColor="#818CF8" stopOpacity="0.65" />
              <stop offset="100%" stopColor="#6366F1" stopOpacity="0.45" />
            </linearGradient>
          </defs>

          {/* Sweeping elegant arc from left edge flowing smoothly behind cards */}
          <path
            d="M -40 460 C 160 480 300 550 480 580 L 720 580"
            stroke="url(#left-arc)"
            strokeWidth="1.75"
            strokeLinecap="round"
          />

          {/* Subtle connecting bridge behind cards */}
          <path
            d="M 480 580 L 720 580 L 820 580"
            stroke="#818CF8"
            strokeWidth="1.5"
            strokeOpacity="0.45"
            strokeLinecap="round"
          />

          {/* Continuous Glowing neon purple laser shooting out from behind cards to top-right edge */}
          <line
            x1="720"
            y1="580"
            x2="1480"
            y2="280"
            stroke="url(#purple-laser)"
            strokeWidth="3.2"
            filter="url(#neon-glow)"
            strokeLinecap="round"
          />
          <line
            x1="720"
            y1="580"
            x2="1480"
            y2="280"
            stroke="#C084FC"
            strokeWidth="1.25"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* Top Navbar */}
      <header className="relative z-10 w-full max-w-[1320px] mx-auto px-6 sm:px-10 lg:px-12 pt-3 sm:pt-4 pb-1 flex items-center justify-between shrink-0">
        {/* Brand Logo & Tagline */}
        <Link href="/" className="flex items-center gap-2.5 group">
          <div className="relative w-7 h-7 sm:w-8 sm:h-8 flex-shrink-0">
            <img
              src="/images/icons/logo-2.png"
              alt="Lucid Logo"
              className="w-full h-full object-contain mix-blend-multiply"
            />
          </div>
          
          <div className="flex flex-col leading-none">
            <span className="text-[18px] sm:text-[19px] font-bold text-[#0F172A] tracking-[-0.02em]">
              Lucid
            </span>
            <span className="text-[11px] sm:text-[11.5px] text-slate-500 font-normal mt-0.5 tracking-tight">
              by workfloww.ai
            </span>
          </div>
        </Link>

        {/* Log In Button */}
        <div>
          <Link
            href="/login"
            className="inline-flex items-center justify-center px-5 sm:px-6 py-1.5 rounded-full border border-slate-700/80 text-slate-800 font-medium text-[13px] sm:text-[14px] hover:bg-slate-900 hover:text-white hover:border-slate-900 transition-all duration-200 shadow-sm"
          >
            Log in
          </Link>
        </div>
      </header>

      {/* Main Hero Section: Fits cleanly within available viewport height */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-1 max-w-6xl mx-auto w-full min-h-0">
        {/* Typography Hero */}
        <div className="text-center max-w-5xl mx-auto space-y-1 sm:space-y-1.5 shrink-0">
          <h1 className="text-[34px] sm:text-[44px] md:text-[54px] lg:text-[62px] xl:text-[70px] font-black text-[#0F172A] tracking-[-0.04em] leading-[1.04]">
            Accelerate
            <br />
            your{" "}
            <span 
              className="italic font-normal text-[#7952F5] tracking-normal inline-block pr-1.5"
              style={{
                fontFamily: "'Newsreader', 'Instrument Serif', 'Playfair Display', Georgia, serif",
                fontSize: '1.09em',
              }}
            >
              workforce
            </span>
            <br />
            for peak performance
          </h1>

          <p className="text-slate-500 text-[12px] sm:text-[13.5px] md:text-[14.5px] font-normal pt-0.5 tracking-tight">
            Enterprise Productivity Platform Accelerating Business Outcomes
          </p>
        </div>

        {/* Feature Cards Grid (Compact Bento Rows to eliminate scrollbar) */}
        <div className="w-full max-w-[1040px] mx-auto mt-2.5 sm:mt-3.5 lg:mt-4 space-y-2 sm:space-y-2.5 shrink-0">
          {/* Row 1: 3 Equal Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2 sm:gap-3">
            {rowOneFeatures.map((item, idx) => {
              const Icon = item.icon;
              return (
                <div
                  key={idx}
                  className="bg-white/95 backdrop-blur-sm rounded-[18px] md:rounded-[20px] p-3.5 sm:p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04),0_1px_2px_rgba(15,23,42,0.02)] border border-slate-100/90 hover:shadow-[0_12px_30px_rgba(99,102,241,0.07)] transition-all duration-300 text-left flex flex-col justify-between"
                >
                  <div>
                    {/* Outline icon */}
                    <div className="text-[#4F46E5] mb-1.5">
                      <Icon size={19} strokeWidth={1.8} />
                    </div>
                    {/* Title */}
                    <h3 className="text-[13.5px] sm:text-[14.5px] font-bold text-[#0F172A] tracking-tight leading-snug">
                      {item.title}
                    </h3>
                    {/* Description */}
                    <p className="text-[11px] sm:text-[11.5px] text-slate-500 font-normal mt-0.5 leading-snug">
                      {item.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Row 2: 2 Wide Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 sm:gap-3">
            {rowTwoFeatures.map((item, idx) => {
              const Icon = item.icon;
              return (
                <div
                  key={idx}
                  className="bg-white/95 backdrop-blur-sm rounded-[18px] md:rounded-[20px] p-3.5 sm:p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04),0_1px_2px_rgba(15,23,42,0.02)] border border-slate-100/90 hover:shadow-[0_12px_30px_rgba(99,102,241,0.07)] transition-all duration-300 text-left flex flex-col justify-between"
                >
                  <div>
                    {/* Outline icon */}
                    <div className="text-[#4F46E5] mb-1.5">
                      <Icon size={19} strokeWidth={1.8} />
                    </div>
                    {/* Title */}
                    <h3 className="text-[13.5px] sm:text-[14.5px] font-bold text-[#0F172A] tracking-tight leading-snug">
                      {item.title}
                    </h3>
                    {/* Description */}
                    <p className="text-[11px] sm:text-[11.5px] text-slate-500 font-normal mt-0.5 leading-snug">
                      {item.description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </main>

      {/* Footer matching Footer.tsx, positioned cleanly at bottom within single screen */}
      <Footer className="bg-transparent border-none z-20 shrink-0 py-1.5 sm:py-2" showPrivacy={true} />
    </div>
  );
}
