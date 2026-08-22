"use client"
import React, { useState } from 'react'
import { Check, X, ShieldCheck, ShieldAlert, ArrowRight, Info } from 'lucide-react'

export const DosAndDonts = () => {
  const [activeTab, setActiveTab] = useState<'dos' | 'donts'>('dos')
  const [hoveredId, setHoveredId] = useState<number | null>(null)

  const dos = [
    { id: 1, title: 'Rapid Guest Interaction', desc: 'Maintain fast and friendly guest interaction. Greet within 30s.', icon: '👋' },
    { id: 2, title: 'Safe Temperatures', desc: 'Keep food out of the temperature danger zone at all times.', icon: '🌡️' },
    { id: 3, title: 'Allergy Protocols', desc: 'Sanitize tools and hands immediately before preparing allergy orders.', icon: '🧼' },
    { id: 4, title: 'Table Maintenance', desc: 'Pre-bus tables continuously to ensure a premium dining environment.', icon: '🍽️' },
    { id: 5, title: 'Menu Knowledge', desc: 'Know 86\'d items and specials before approaching the table.', icon: '📖' },
  ]

  const donts = [
    { id: 1, title: 'Table Clutter', desc: 'Do not leave dirty dishes on guest tables for extended periods.', icon: '🍽️' },
    { id: 2, title: 'Temperature Violations', desc: 'Do not serve food below required safe cooking temperatures.', icon: '🌡️' },
    { id: 3, title: 'Service Delays', desc: 'Do not delay greeting guests or taking initial drink orders.', icon: '⏳' },
    { id: 4, title: 'Cross-Contamination', desc: 'Never use the same cutting board for raw meats and ready-to-eat foods.', icon: '🔪' },
    { id: 5, title: 'Unprofessional Tone', desc: 'Do not use casual slang or negative phrasing with guests.', icon: '💬' },
  ]

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-4xl">
      {/* Header Selector */}
      <div className="flex bg-slate-100 p-1.5 rounded-2xl w-full max-w-md mx-auto relative shadow-inner">
        <div 
          className="absolute inset-y-1.5 w-[calc(50%-6px)] bg-white rounded-xl shadow-sm transition-all duration-300 ease-spring"
          style={{ transform: activeTab === 'dos' ? 'translateX(0)' : 'translateX(calc(100% + 12px))' }}
        />
        <button 
          onClick={() => setActiveTab('dos')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 px-6 rounded-xl font-bold text-sm relative z-10 transition-colors ${activeTab === 'dos' ? 'text-emerald-700' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <ShieldCheck className="w-5 h-5" /> Mandatory Do's
        </button>
        <button 
          onClick={() => setActiveTab('donts')}
          className={`flex-1 flex items-center justify-center gap-2 py-3 px-6 rounded-xl font-bold text-sm relative z-10 transition-colors ${activeTab === 'donts' ? 'text-rose-700' : 'text-slate-500 hover:text-slate-700'}`}
        >
          <ShieldAlert className="w-5 h-5" /> Critical Don'ts
        </button>
      </div>

      <div className="relative overflow-hidden pt-4 pb-12 px-4 -mx-4">
        {/* Do's Scrollable Area */}
        {activeTab === 'dos' && (
          <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory scrollbar-hide pb-8 animate-in slide-in-from-left-8 fade-in duration-500">
            {dos.map((item) => (
              <div 
                key={item.id}
                onMouseEnter={() => setHoveredId(item.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={`snap-center shrink-0 w-72 bg-white rounded-2xl border-2 transition-all duration-300 cursor-pointer p-6 relative overflow-hidden group ${
                  hoveredId === item.id 
                    ? 'border-emerald-400 shadow-xl shadow-emerald-500/10 -translate-y-2' 
                    : 'border-slate-100 shadow-sm'
                }`}
              >
                <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-50 rounded-bl-full -mr-12 -mt-12 transition-transform duration-500 group-hover:scale-150"></div>
                <div className="relative z-10">
                  <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-xl flex items-center justify-center text-xl mb-6 shadow-inner">
                    {item.icon}
                  </div>
                  <h3 className="text-xl font-bold text-slate-800 mb-3 group-hover:text-emerald-700 transition-colors">{item.title}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">{item.desc}</p>
                  
                  <div className={`mt-6 flex items-center gap-2 text-xs font-bold transition-all duration-300 ${
                    hoveredId === item.id ? 'text-emerald-600 opacity-100 translate-x-0' : 'text-slate-400 opacity-0 -translate-x-4'
                  }`}>
                    <Check className="w-4 h-4" /> Best Practice
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Don'ts Scrollable Area */}
        {activeTab === 'donts' && (
          <div className="flex gap-4 overflow-x-auto snap-x snap-mandatory scrollbar-hide pb-8 animate-in slide-in-from-right-8 fade-in duration-500">
            {donts.map((item) => (
              <div 
                key={item.id}
                onMouseEnter={() => setHoveredId(item.id)}
                onMouseLeave={() => setHoveredId(null)}
                className={`snap-center shrink-0 w-72 bg-white rounded-2xl border-2 transition-all duration-300 cursor-pointer p-6 relative overflow-hidden group ${
                  hoveredId === item.id 
                    ? 'border-rose-400 shadow-xl shadow-rose-500/10 -translate-y-2' 
                    : 'border-slate-100 shadow-sm'
                }`}
              >
                <div className="absolute top-0 right-0 w-24 h-24 bg-rose-50 rounded-bl-full -mr-12 -mt-12 transition-transform duration-500 group-hover:scale-150"></div>
                <div className="relative z-10">
                  <div className="w-12 h-12 bg-rose-100 text-rose-600 rounded-xl flex items-center justify-center text-xl mb-6 shadow-inner">
                    {item.icon}
                  </div>
                  <h3 className="text-xl font-bold text-slate-800 mb-3 group-hover:text-rose-700 transition-colors">{item.title}</h3>
                  <p className="text-slate-500 text-sm leading-relaxed">{item.desc}</p>
                  
                  <div className={`mt-6 flex items-center gap-2 text-xs font-bold transition-all duration-300 ${
                    hoveredId === item.id ? 'text-rose-600 opacity-100 translate-x-0' : 'text-slate-400 opacity-0 -translate-x-4'
                  }`}>
                    <X className="w-4 h-4" /> Zero Tolerance
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        
        {/* Scroll Hint */}
        <div className="absolute bottom-0 left-0 right-0 text-center opacity-60 flex justify-center items-center gap-2 text-xs font-medium text-slate-400">
          <ArrowRight className="w-4 h-4 animate-bounce-x" /> Scroll horizontally to view all guidelines
        </div>
      </div>
    </div>
  )
}
