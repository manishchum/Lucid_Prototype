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
  UserCheck, 
  ShieldCheck, 
  Fingerprint, 
  ChevronRight
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function LandingPage() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const features = [
    {
      title: 'Living Knowledge Base',
      description: 'Transforms raw data into learning intelligence',
      icon: <BookOpen size={20} />,
      color: 'bg-[#2563EB]'
    },
    {
      title: 'Smart Intelligence',
      description: 'Eliminates redundant learning',
      icon: <Puzzle size={20} />,
      color: 'bg-[#0F172A]'
    },
    {
      title: 'Adaptive Pathways',
      description: 'Dynamic journeys based on performance & learning style',
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
      <nav className="max-w-7xl mx-auto w-full px-8 md:px-12 h-20 flex items-center justify-between shrink-0 relative z-[60]">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-[#2563EB] rounded-xl flex items-center justify-center text-white shadow-lg shadow-blue-100">
            <Brain size={22} />
          </div>
          <span className="text-xl font-black text-[#0F172A] tracking-tighter">Lucid</span>
        </div>
        
          <div className="hidden md:flex items-center absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
          <div className="flex items-center gap-10">
            <a href="#features" className="text-sm font-bold text-slate-500 hover:text-[#2563EB] transition-colors">Features</a>
            <a href="#pricing" className="text-sm font-bold text-slate-500 hover:text-[#2563EB] transition-colors">Pricing</a>
          </div>
        </div>
        
        <div className="hidden md:flex items-center gap-4">
          <Link href="/login" className="text-sm font-bold text-slate-600 hover:text-blue-600 px-3 py-2">Log In</Link>
          <Link href="/signup">
            <button className="px-5 py-2.5 bg-[#2563EB] text-white rounded-full font-bold text-sm hover:bg-blue-700 transition-all shadow-md shadow-blue-100">
              Sign Up
            </button>
          </Link>
        </div>

        <div className="md:hidden">
          <button onClick={() => setIsMenuOpen(true)} className="text-[#0F172A] p-2">
            <Menu size={24} />
          </button>
        </div>
      </nav>

      {/* Hero Content - Uses flex-1 and justify-center to fill available space */}
      <div className="flex-1 flex flex-col items-center justify-center px-8 relative z-10 pb-4">
        <div className="max-w-6xl w-full text-center space-y-6">
          
          {/* Description */}
          <p className="text-xl text-gray-600 mb-12 max-w-2xl mx-auto leading-relaxed">
            Lucid - Your learning companion which aligns learning with how you learn best and guides you through a clear & personalized path
            <br />
            Lucid helps you learn the way you were meant to.
          </p>

          {/* Single Login Card */}
          <div className="flex justify-center mb-16">
            <Card className="group relative overflow-hidden border border-gray-200 bg-white hover:shadow-lg transition-all duration-300 hover:scale-105 max-w-md w-full">
              <CardHeader className="text-center">
                <CardTitle className="text-3xl text-gray-600 mb-6 ">
                  Discover Your Limitless Potential Today
                </CardTitle>
                
                {/* Feature Tags */}
                <div className="flex flex-wrap justify-center gap-2 mb-6">
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-blue-50 text-blue-700">
                    ✓ AI-Powered Learning
                  </span>
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-700">
                    ✓ Progress Tracking
                  </span>
                  <span className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-blue-50 text-blue-700">
                    ✓ Engaging Experience
                  </span>
                </div>
              </CardHeader>
              <CardContent className="text-center">
                <Link href="/login">
                  <Button size="lg" className="w-full bg-blue-600 hover:bg-blue-700 text-white group text-lg py-4">
                    Start Your Journey
                    <ChevronRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>

          {/* Feature Card (Optimized padding and spacing) */}
          <div className="max-w-[1000px] mx-auto bg-white rounded-[32px] p-8 md:p-10 shadow-[0_20px_50px_-12px_rgba(59,102,245,0.1)] border border-slate-50 relative mt-4">
            <div className="flex flex-col items-center">
              
              {/* Overlapping CTA (shifted slightly below) */}
              <div className="absolute -top-2 left-1/2 -translate-x-1/2">
                <Link href="/signup" className="inline-flex items-center justify-center px-10 py-4 bg-gradient-to-r from-[#2563EB] via-[#6366F1] to-[#9333EA] text-white rounded-full text-xl font-black shadow-xl hover:scale-105 transition-all">
                  Explore Lucid <ArrowRight size={20} className="ml-2" />
                </Link>
              </div>

              <div className="w-full space-y-8 mt-8">
                {/* Row 1 */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-left">
                  {features.slice(0, 3).map((feature, index) => (
                    <div key={index} className="flex items-start gap-4">
                      <div className={`w-12 h-12 rounded-xl ${feature.color} flex items-center justify-center text-white shrink-0 shadow-md`}>
                        {feature.icon}
                      </div>
                      <div>
                        <h4 className="text-base font-black text-[#0F172A] leading-tight">{feature.title}</h4>
                        <p className="text-xs text-slate-500 font-medium mt-1">{feature.description}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="w-full h-px bg-slate-100 hidden md:block"></div>

                {/* Row 2 */}
                <div className="flex flex-col md:flex-row justify-center gap-6 md:gap-20 text-left">
                  {features.slice(3, 5).map((feature, index) => (
                    <div key={index} className="flex items-start gap-4 max-w-[280px]">
                      <div className={`w-12 h-12 rounded-xl ${feature.color} flex items-center justify-center text-white shrink-0 shadow-md`}>
                        {feature.icon}
                      </div>
                      <div>
                        <h4 className="text-base font-black text-[#0F172A] leading-tight">{feature.title}</h4>
                        <p className="text-xs text-slate-500 font-medium mt-1">{feature.description}</p>
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
           <div className="flex items-center gap-3">
             <div className="w-9 h-9 bg-slate-50 rounded-lg flex items-center justify-center text-slate-400">
               <ShieldCheck size={18} />
             </div>
             <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">SOC2 Type II</span>
           </div>
           <div className="flex items-center gap-3">
             <div className="w-9 h-9 bg-slate-50 rounded-lg flex items-center justify-center text-slate-400">
               <Fingerprint size={18} />
             </div>
             <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Encrypted Data</span>
           </div>
        </div>
        <div className="flex items-center gap-4">
          <p className="text-[9px] text-slate-300 font-black uppercase tracking-widest">Powered By</p>
          <div className="px-4 py-2 bg-slate-50 rounded-full border border-slate-100 font-black text-[10px] text-[#0F172A]">Google Gemini</div>
        </div>
      </footer>

      {/* Mobile Menu Overlay */}
      {isMenuOpen && (
        <div className="fixed inset-0 bg-white z-[100] flex flex-col p-8 md:hidden">
          <div className="flex justify-between items-center mb-12">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-[#2563EB] rounded-xl flex items-center justify-center text-white">
                <Brain size={22} />
              </div>
              <span className="text-xl font-black text-[#0F172A] tracking-tighter">Lucid</span>
            </div>
            <button onClick={() => setIsMenuOpen(false)} className="text-slate-500 p-2">
              <X size={28} />
            </button>
          </div>
          <nav className="flex flex-col items-center justify-center flex-1 gap-8 -mt-10">
            <a href="#features" className="text-xl font-black text-[#0F172A]">Features</a>
            <a href="#pricing" className="text-xl font-black text-[#0F172A]">Pricing</a>
            <Link href="/login" className="text-xl font-black text-[#0F172A]">Log In</Link>
            <Link href="/signup" className="w-full max-w-xs">
              <button className="w-full px-6 py-4 bg-[#2563EB] text-white rounded-full font-black text-lg shadow-lg">Sign up</button>
            </Link>
          </nav>
        </div>
      )}
    </div>
  );
}
