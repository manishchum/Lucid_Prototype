"use client";

import React, { useState } from 'react';
import Link from "next/link";
import { 
  Brain, 
  Menu, 
  X, 
  ArrowRight, 
  BookOpen, 
  Puzzle, 
  Map, 
  TrendingUp, 
  UserCheck
} from "lucide-react";

export default function LandingPage() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const features = [
    {
      title: 'Living Knowledge Base',
      description: 'Transform Raw Data Into Sales & Operations Intelligence',
      icon: <BookOpen size={20} />,
      color: 'bg-[#2563EB]'
    },
    {
      title: 'Smart Intelligence',
      description: 'Eliminates Redundancy',
      icon: <Puzzle size={20} />,
      color: 'bg-[#0F172A]'
    },
    {
      title: 'Adaptive Pathways',
      description: 'Dynamic journeys based on performance & Performance Sprint',
      icon: <Map size={20} />,
      color: 'bg-[#2563EB]'
    },
    {
      title: 'Performance Coach',
      description: 'Instant, contextual guidance in the flow of work',
      icon: <TrendingUp size={20} />,
      color: 'bg-[#0F172A]'
    },
    {
      title: 'Competency Proofing',
      description: 'Proof of action, not just knowledge.',
      icon: <UserCheck size={20} />,
      color: 'bg-[#2563EB]'
    },
  ];

  return (
    /* h-screen and overflow-hidden removes the scroller */
    <div className="h-screen w-screen bg-white font-sans selection:bg-blue-100 flex flex-col relative overflow-hidden">
      
      {/* Navbar - Reduced height for one-pager */}
      <nav className="max-w-7xl mx-auto w-full px-4 sm:px-6 md:px-8 lg:px-12 h-16 md:h-20 flex items-center justify-between shrink-0 relative z-[60]">
        <div className="flex items-center gap-2 md:gap-3">
          <div className="w-8 md:w-10 h-8 md:h-10 bg-[#2563EB] rounded-lg md:rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-100">
            <Brain size={18} className="md:hidden" />
            <Brain size={22} className="hidden md:block" />
          </div>
          <span className="text-lg md:text-xl font-black text-[#0F172A] tracking-tighter">Lucid</span>
        </div>
        
        <div className="hidden md:flex items-center gap-4">
          {/* <Link href="/login" className="text-sm font-bold text-slate-600 hover:text-blue-600 px-3 py-2">Log In</Link> */}
          <Link href="/login">
            <button className="px-5 py-2.5 bg-[#2563EB] text-white rounded-full font-bold text-sm hover:bg-blue-700 transition-all shadow-md shadow-blue-100">
              Log In
            </button>
          </Link>
        </div>

        <div className="md:hidden">
          <button onClick={() => setIsMenuOpen(true)} className="text-[#0F172A] p-2">
            <Menu size={20} />
          </button>
        </div>
      </nav>

      {/* Hero Content - Uses flex-1 and justify-center to fill available space */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 relative z-10 py-4 md:pb-4">
        <div className="max-w-6xl w-full text-center space-y-4 md:space-y-6">
          
          {/* Adjusted Heading Sizes for better fit */}
          <div className="space-y-2 md:space-y-4 animate-in slide-in-from-bottom-4 duration-700">
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-black tracking-tighter leading-tight md:leading-[0.9] text-[#0F172A]">
              Accelerate Your <br className="hidden sm:block" /> Workforce <br className="hidden sm:block" />
              <span className="bg-clip-text text-transparent bg-gradient-to-r from-[#2563EB] via-[#6366F1] to-[#9333EA] pr-1 md:pr-2">
                For Peak Performance
              </span>
            </h1>
            <p className="max-w-2xl mx-auto text-slate-500 text-xs sm:text-sm md:text-base font-medium leading-relaxed">
              Enterprise Productivity Platform Accelerating Sales & Operations Outcomes
            </p>
          </div>

          {/* Centered CTA with equal spacing above and below */}
          <div className="flex justify-center my-4 md:my-8">
            <Link href="/login" className="inline-flex items-center justify-center px-6 sm:px-8 md:px-10 py-2.5 sm:py-3 md:py-4 bg-gradient-to-r from-[#2563EB] via-[#6366F1] to-[#9333EA] text-white rounded-full text-sm md:text-lg lg:text-xl font-black shadow-xl hover:scale-105 transition-all">
              Explore Lucid <ArrowRight size={16} className="sm:w-5 sm:h-5 md:w-5 md:h-5 ml-1 md:ml-2" />
            </Link>
          </div>

          {/* Feature Card (Optimized padding and spacing) */}
          <div className="max-w-[1000px] mx-auto bg-white rounded-2xl md:rounded-3xl p-4 sm:p-6 md:p-8 shadow-[0_20px_50px_-12px_rgba(59,102,245,0.1)] border border-slate-50 relative mt-2 md:mt-4">
            <div className="flex flex-col items-center">
              
              <div className="w-full space-y-4 md:space-y-8 mt-4 md:mt-8">
                {/* Row 1 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 md:gap-6 text-left">
                  {features.slice(0, 3).map((feature, index) => (
                    <div key={index} className="flex items-start gap-3 md:gap-4 p-2 md:p-0">
                      <div className={`w-10 md:w-12 h-10 md:h-12 rounded-lg md:rounded-xl ${feature.color} flex items-center justify-center text-white shrink-0 shadow-md`}>
                        {feature.icon}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-xs md:text-sm lg:text-base font-black text-[#0F172A] leading-tight">{feature.title}</h4>
                        <p className="text-[10px] md:text-xs text-slate-500 font-medium mt-0.5 md:mt-1 line-clamp-2 md:line-clamp-none">{feature.description}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="w-full h-px bg-slate-100 hidden md:block"></div>

                {/* Row 2 */}
                <div className="flex flex-col md:flex-row justify-center gap-3 md:gap-20 text-left">
                  {features.slice(3, 5).map((feature, index) => (
                    <div key={index} className="flex items-start gap-3 md:gap-4 p-2 md:p-0 max-w-[280px]">
                      <div className={`w-10 md:w-12 h-10 md:h-12 rounded-lg md:rounded-xl ${feature.color} flex items-center justify-center text-white shrink-0 shadow-md`}>
                        {feature.icon}
                      </div>
                      <div className="min-w-0">
                        <h4 className="text-xs md:text-sm lg:text-base font-black text-[#0F172A] leading-tight">{feature.title}</h4>
                        <p className="text-[10px] md:text-xs text-slate-500 font-medium mt-0.5 md:mt-1 line-clamp-2 md:line-clamp-none">{feature.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>
        </div>
      </div>

      {/* Trust Footer - Slimmer version */}
      <footer className="shrink-0 py-6 px-8 border-t border-slate-50 max-w-7xl mx-auto w-full flex flex-row justify-between items-center gap-4">
        <div className="flex gap-8">
           {/* <div className="flex items-center gap-3">
             <div className="w-9 h-9 bg-slate-50 rounded-lg flex items-center justify-center text-slate-400">
               <ShieldCheck size={18} />
             </div>
           </div>
           <div className="flex items-center gap-3">
             <div className="w-9 h-9 bg-slate-50 rounded-lg flex items-center justify-center text-slate-400">
               <Fingerprint size={18} />
             </div>
           </div> */}
        </div>
        <div className="flex items-center gap-4">
          <Link href="/privacy-policy" className="text-xs font-semibold text-slate-500 hover:text-[#2563EB] transition-colors">
            Privacy Policy
          </Link>
          {/* <p className="text-[9px] text-slate-300 font-black uppercase tracking-widest">Powered By</p>
          <div className="px-4 py-2 bg-slate-50 rounded-full border border-slate-100 font-black text-[10px] text-[#0F172A]">Google Gemini</div> */}
        </div>
      </footer>

      {/* Mobile Menu Overlay */}
      {isMenuOpen && (
        <div className="fixed inset-0 bg-white z-[100] flex flex-col p-4 md:hidden">
          <div className="flex justify-between items-center mb-8 md:mb-12">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-[#2563EB] rounded-lg flex items-center justify-center text-white">
                <Brain size={18} />
              </div>
              <span className="text-lg font-black text-[#0F172A] tracking-tighter">Lucid</span>
            </div>
            <button onClick={() => setIsMenuOpen(false)} className="text-slate-500 p-2">
              <X size={24} />
            </button>
          </div>
          <nav className="flex flex-col items-center justify-center flex-1 gap-6 -mt-10">
            <a href="#features" className="text-lg font-black text-[#0F172A]">Features</a>
            <a href="#pricing" className="text-lg font-black text-[#0F172A]">Pricing</a>
            <Link href="/login" className="text-lg font-black text-[#0F172A]">Log In</Link>
            <Link href="/signup" className="w-full max-w-xs">
              <button className="w-full px-6 py-3 bg-[#2563EB] text-white rounded-full font-black text-base shadow-lg">Sign up</button>
            </Link>
          </nav>
        </div>
      )}
    </div>
  );
}
