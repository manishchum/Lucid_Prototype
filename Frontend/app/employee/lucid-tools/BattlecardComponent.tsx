"use client"
import React, { useState } from 'react'
import { Check, Copy, RefreshCw, Send, Shield, Zap, TrendingUp, AlertTriangle, Target, MessageSquare } from 'lucide-react'

export const CompetitiveBattlecards = () => {
  const [activeTab, setActiveTab] = useState('Head-to-Head Radar');
  const [opponent, setOpponent] = useState('Product C');
  const tabs = [
    { name: 'Head-to-Head Radar', icon: <TrendingUp className="w-4 h-4" /> },
    { name: 'Why We Win & Landmines', icon: <Shield className="w-4 h-4" /> },
    { name: 'Objection Buster & Live Coach', icon: <MessageSquare className="w-4 h-4" /> },
    { name: 'Pricing & ROI Ben', icon: <Target className="w-4 h-4" /> }
  ];

  const opponents = [
    { name: 'Product B', winRate: '74%' },
    { name: 'Product C', winRate: '82%' },
    { name: 'Product D', winRate: '78%' }
  ];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      {/* Opponent Selector */}
      <div className="flex items-center gap-4">
        <span className="text-sm font-bold text-slate-500 uppercase tracking-widest">Compare vs:</span>
        <div className="flex gap-2 p-1 bg-slate-100 rounded-xl">
          {opponents.map(opp => (
            <button
              key={opp.name}
              onClick={() => setOpponent(opp.name)}
              className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
                opponent === opp.name 
                  ? 'bg-white text-[#5B3DF8] shadow-sm' 
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'
              }`}
            >
              {opp.name}
            </button>
          ))}
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-slate-200 overflow-x-auto scrollbar-hide pb-0">
        {tabs.map(tab => (
          <button 
            key={tab.name} 
            onClick={() => setActiveTab(tab.name)} 
            className={`flex items-center gap-2 px-4 py-3 text-sm font-bold whitespace-nowrap transition-colors border-b-2 ${
              activeTab === tab.name 
                ? 'text-[#5B3DF8] border-[#5B3DF8] bg-[#EEECF9]/50' 
                : 'text-slate-500 border-transparent hover:text-slate-700 hover:bg-slate-50'
            }`}
          >
            {tab.icon}
            {tab.name}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {activeTab === 'Head-to-Head Radar' && (
          <div className="space-y-6">
            <div className="flex justify-between items-end mb-6">
              <div>
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-1">Direct Metric Scorecard (Product A vs {opponent})</h3>
                <p className="text-sm text-slate-400">Visual index calibrated against certified independent hospitality benchmarks</p>
              </div>
              <div className="flex items-center gap-4 text-xs font-bold">
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-[#5B3DF8]"></div> Product A (Us)</div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded bg-slate-300"></div> {opponent}</div>
              </div>
            </div>

            {[
              {
                id: 1,
                title: 'Complex Multi-Course Kitchen Timing',
                weakness: `${opponent} lacks fire-pacing`,
                advantage: '+47% Advantage',
                us: 97,
                them: 50,
                why: 'Dynamic cook-time auto-pacing synchronizes entree fire times across grill, saute, and salad stations.'
              },
              {
                id: 2,
                title: 'Multi-Location Enterprise Menu Sync',
                weakness: '5-minute batch sync',
                advantage: '+28% Advantage',
                us: 96,
                them: 68,
                why: 'Real-time item 86-ing & tax rules propagated across 100+ stores instantly.'
              },
              {
                id: 3,
                title: 'Deep Table Management & Floor SLA',
                weakness: 'Basic grid layout',
                advantage: '+39% Advantage',
                us: 94,
                them: 55,
                why: 'Visual seat timers, guest VIP history, and automated escalation alerts.'
              }
            ].map(metric => (
              <div key={metric.id} className="border border-slate-200 rounded-2xl p-5 bg-white">
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-6 h-6 rounded bg-[#EEECF9] text-[#5B3DF8] flex items-center justify-center text-xs font-bold">{metric.id}</div>
                    <h4 className="font-bold text-slate-800 text-lg">{metric.title}</h4>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-medium text-slate-400 italic">{metric.weakness}</span>
                    <span className="text-xs font-bold bg-emerald-50 text-emerald-600 px-2 py-1 rounded-md border border-emerald-100">{metric.advantage}</span>
                  </div>
                </div>
                
                <div className="space-y-3 mb-5">
                  <div>
                    <div className="flex justify-between text-xs font-bold mb-1">
                      <span className="flex items-center gap-1 text-emerald-600"><Check className="w-3 h-3"/> Product A Platform</span>
                      <span className="text-[#5B3DF8]">{metric.us}%</span>
                    </div>
                    <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-[#5B3DF8] rounded-full" style={{width: `${metric.us}%`}}></div>
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-xs font-bold mb-1">
                      <span className="text-slate-500">{opponent}</span>
                      <span className="text-slate-500">{metric.them}%</span>
                    </div>
                    <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-slate-400 rounded-full" style={{width: `${metric.them}%`}}></div>
                    </div>
                  </div>
                </div>

                <div className="bg-[#EEECF9]/50 rounded-xl p-4 flex gap-3 items-start border border-indigo-50">
                  <Zap className="w-4 h-4 text-[#5B3DF8] shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold text-[#2A2B4D] text-sm">Why This Closes Deals: </span>
                    <span className="text-sm text-slate-600">{metric.why}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'Why We Win & Landmines' && (
          <div className="space-y-6">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-4">
              <span className="text-amber-500 text-base">🏆</span> Core Differentiators ("Why We Win")
            </h3>
            
            <div className="grid grid-cols-2 gap-4">
              {[
                { label: 'PURPOSE BUILT', title: 'Built for 800+ Covers/Night', sub: 'Engineered for High-Volume Hospitality', desc: 'Not a generic retail terminal adapted for food. Engineered specifically for chaotic kitchen workflows.' },
                { label: 'CULINARY QUALITY', title: 'Eliminate Food Sitting Under Lamps', sub: 'Automated Kitchen Course Pacing', desc: 'Steaks and salads finish at the exact same second with intelligent cook time balancing.' },
                { label: 'GUEST RETENTION', title: '+28% Repeat Visits', sub: 'Custom Loyalty & Direct SMS Marketing', desc: 'Zero third-party marketplace commission fees; retain 100% of guest customer data.' }
              ].map((card, i) => (
                <div key={i} className="border border-slate-200 rounded-2xl p-6 bg-white shadow-sm hover:shadow-md transition-shadow">
                  <span className="inline-block px-2 py-1 bg-indigo-50 text-[#5B3DF8] text-[10px] font-bold rounded mb-3 tracking-wider">{card.label}</span>
                  <h4 className="font-bold text-[#5B3DF8] text-xl mb-1">{card.title}</h4>
                  <div className="font-bold text-slate-800 text-sm mb-3">{card.sub}</div>
                  <p className="text-slate-500 text-sm leading-relaxed">{card.desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'Objection Buster & Live Coach' && (
          <div className="space-y-6">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-4">
              <MessageSquare className="w-4 h-4 text-[#5B3DF8]" /> Verified Fast-Rebuttal Scripts (Acknowledge → Reframe → Differentiate)
            </h3>
            
            <div className="border border-slate-200 rounded-2xl p-6 bg-white shadow-sm">
              <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-3">
                  <span className="px-2 py-1 bg-indigo-50 text-[#5B3DF8] text-[10px] font-bold rounded tracking-wider uppercase">USABILITY</span>
                  <h4 className="font-bold text-slate-800 text-lg">"{opponent} is simpler and our young staff already knows how to use it."</h4>
                </div>
                <button className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-[#5B3DF8] bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors">
                  <Copy className="w-3 h-3" /> Copy Script
                </button>
              </div>

              <div className="bg-slate-50 rounded-xl p-5 border border-slate-100 mb-4">
                <h5 className="font-bold text-[#5B3DF8] mb-3">Winning 3-Step Talk Track:</h5>
                <p className="text-sm text-slate-700 leading-relaxed">
                  <span className="font-bold text-slate-900">Acknowledge:</span> "{opponent} has an intuitive consumer interface." <span className="font-bold text-slate-900 ml-2">Reframe:</span> "Our Product A interface is designed with the same intuitive touch patterns, but with specialized restaurant modifiers, seat mapping, and kitchen fire controls." <span className="font-bold text-slate-900 ml-2">Differentiate:</span> "New servers learn our system in under 12 minutes while managers get enterprise control."
                </p>
              </div>

              <div className="text-xs text-slate-500 font-medium">
                <span className="font-bold text-slate-700">Supporting Proof Asset:</span> Staff Training Benchmark: 12-minute average onboarding time.
              </div>
            </div>

            <div className="bg-[#1E1B4B] rounded-2xl p-6 text-white relative overflow-hidden mt-8 shadow-lg border border-indigo-900">
              <div className="absolute top-0 right-0 w-48 h-48 bg-amber-500 opacity-10 rounded-full blur-3xl -mr-10 -mt-10"></div>
              <div className="relative z-10">
                <h4 className="flex items-center gap-2 font-bold text-lg mb-2">
                  <span className="text-amber-400">✨</span> Live AI Objection Rebuttal Generator <span className="text-xs font-normal text-indigo-300 ml-2">(Powered by Gemini 3.7 Flash)</span>
                </h4>
                <p className="text-sm text-indigo-200 mb-4">Enter any tough question or pushback from your prospect to generate an instant winning script.</p>
                
                <div className="flex gap-3">
                  <input 
                    type="text" 
                    placeholder={`e.g., "The customer said ${opponents[0].name} is giving them 0% hardware financing and free installation..."`}
                    className="flex-1 bg-white/10 border border-white/20 rounded-xl px-4 py-3 text-sm text-white placeholder-indigo-300/50 focus:outline-none focus:border-[#5B3DF8]"
                  />
                  <button className="flex items-center gap-2 px-6 py-3 bg-[#5B3DF8] text-white font-bold rounded-xl hover:bg-indigo-600 transition-colors shrink-0">
                    <Send className="w-4 h-4" /> Generate Script
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Pricing & ROI Ben' && (
          <div className="space-y-6">
            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2 mb-4">
              <Target className="w-4 h-4 text-[#5B3DF8]" /> Pricing & ROI Benchmarks vs {opponent}
            </h3>
            
            <div className="grid grid-cols-2 gap-6">
              <div className="border border-slate-200 rounded-2xl p-6 bg-white shadow-sm">
                <h4 className="font-bold text-slate-800 text-lg mb-4">Total Cost of Ownership (3 Years)</h4>
                <div className="space-y-4">
                  <div>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-semibold text-slate-700">Product A (Us)</span>
                      <span className="font-bold text-[#5B3DF8]">$24,000</span>
                    </div>
                    <div className="text-xs text-slate-500">Includes hardware, software, and 24/7 support. No hidden fees.</div>
                  </div>
                  <div className="border-t border-slate-100 pt-4">
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-semibold text-slate-700">{opponent}</span>
                      <span className="font-bold text-slate-400">$32,500</span>
                    </div>
                    <div className="text-xs text-slate-500">Hidden costs in premium add-ons, implementation, and per-location fees.</div>
                  </div>
                </div>
              </div>

              <div className="border border-indigo-100 rounded-2xl p-6 bg-[#EEECF9]/30 shadow-sm">
                <h4 className="font-bold text-[#5B3DF8] text-lg mb-4">ROI Impact</h4>
                <div className="space-y-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shrink-0 shadow-sm text-emerald-600 font-bold">↑</div>
                    <div>
                      <div className="font-bold text-slate-800">14% Increase in Table Turnover</div>
                      <div className="text-xs text-slate-600 mt-1">Faster kitchen sync directly reduces wait times compared to {opponent}&apos;s batching.</div>
                    </div>
                  </div>
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center shrink-0 shadow-sm text-emerald-600 font-bold">↓</div>
                    <div>
                      <div className="font-bold text-slate-800">22% Reduction in Comped Meals</div>
                      <div className="text-xs text-slate-600 mt-1">Automated fire-pacing prevents food sitting, a major issue reported by {opponent} users.</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
