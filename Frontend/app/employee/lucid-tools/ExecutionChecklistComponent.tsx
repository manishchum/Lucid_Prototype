"use client"
import React, { useState } from 'react'
import { CheckCircle2, Circle, Sparkles, Clock, ChefHat, Users, Check, AlertCircle } from 'lucide-react'

export const ExecutionChecklist = () => {
  const [fohItems, setFohItems] = useState([
    { id: 'f1', text: 'Greet guests within 30 seconds.', desc: 'Sets the initial impression and hospitality tone.', checked: false, time: '0:30' },
    { id: 'f2', text: 'Take drink/appetizer orders within 2 minutes.', desc: 'Ensures rapid service pacing and guest satisfaction.', checked: false, time: '2:00' },
    { id: 'f3', text: 'Perform 2-bite check-back after food delivery.', desc: 'Verify culinary quality immediately.', checked: false, time: 'Check' },
    { id: 'f4', text: 'Clear tables continuously (pre-bussing).', desc: 'Maintains clean, premium dining environment.', checked: false, time: 'Ongoing' },
    { id: 'f5', text: 'Offer dessert/coffee before billing.', desc: 'Maximize revenue and finalize experience.', checked: false, time: 'End' },
    { id: 'f6', text: 'Process payment quickly and thank guests warmly.', desc: 'Leaves a lasting positive impression.', checked: false, time: 'Fast' },
  ]);

  const [bohItems, setBohItems] = useState([
    { id: 'b1', text: 'Complete mise en place 15 minutes before service.', desc: 'Crucial for smooth high-volume operations.', checked: false, time: '-15:00' },
    { id: 'b2', text: 'Ensure all stations are fully stocked and sanitized.', desc: 'Prevents mid-rush delays.', checked: false, time: 'Pre' },
    { id: 'b3', text: 'Monitor food holding temperatures regularly.', desc: 'Maintains food safety standards.', checked: false, time: 'Ongoing' },
    { id: 'b4', text: 'Follow cooking temperature standards for all proteins.', desc: 'Ensures exact culinary specifications are met.', checked: false, time: 'Critical' },
    { id: 'b5', text: 'Execute allergy protocol immediately upon alert.', desc: 'Zero-tolerance cross-contamination policy.', checked: false, time: 'Alert' },
    { id: 'b6', text: 'Maintain clean tools, towels, and workstations.', desc: 'Professional kitchen standards.', checked: false, time: 'Ongoing' },
  ]);

  const toggleItem = (id: string, section: 'foh' | 'boh') => {
    if (section === 'foh') {
      setFohItems(items => items.map(item => item.id === id ? { ...item, checked: !item.checked } : item));
    } else {
      setBohItems(items => items.map(item => item.id === id ? { ...item, checked: !item.checked } : item));
    }
  };

  const calculateProgress = (items: any[]) => {
    const checked = items.filter(i => i.checked).length;
    return Math.round((checked / items.length) * 100);
  };

  const fohProgress = calculateProgress(fohItems);
  const bohProgress = calculateProgress(bohItems);
  const overallProgress = Math.round((fohProgress + bohProgress) / 2);

  return (
    <div className="space-y-8 animate-in fade-in duration-500 max-w-4xl">
      {/* Premium Header */}
      <div className="bg-gradient-to-br from-slate-900 to-[#1E1B4B] rounded-2xl p-8 text-white relative overflow-hidden shadow-xl border border-indigo-900/50">
        <div className="absolute top-0 right-0 w-96 h-96 bg-[#5B3DF8] opacity-20 rounded-full blur-3xl -mr-32 -mt-32"></div>
        <div className="relative z-10">
          {/* <div className="flex items-center gap-3 mb-6">
            <span className="text-xs font-bold text-indigo-300 uppercase tracking-widest bg-white/10 px-3 py-1 rounded-full border border-white/10 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" /> Standard Operating Procedure
            </span>
            <span className={`text-xs font-bold px-3 py-1 rounded-full border transition-all duration-500 ${overallProgress === 100 ? 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' : 'bg-amber-500/20 text-amber-400 border-amber-500/30'}`}>
              {overallProgress === 100 ? 'FULLY COMPLIANT' : 'IN PROGRESS'}
            </span>
          </div> */}
          
          <div className="flex items-end justify-between">
            {/* <div>
              <h2 className="text-3xl font-bold mb-2">Hospitality Execution Blueprint</h2>
              <p className="text-indigo-200 max-w-lg leading-relaxed">Interactive multi-phase validation gates for staging and deploying premium guest experiences across all venues.</p>
            </div> */}
            
            {/* <div className="text-center bg-white/5 backdrop-blur-sm rounded-2xl p-4 border border-white/10 min-w-[120px]">
              <div className="text-4xl font-bold text-white mb-1">{overallProgress}%</div>
              <div className="text-[10px] font-bold text-indigo-300 uppercase tracking-wider">Overall Readiness</div>
            </div> */}
          </div>
          
          {/* Progress Bar */}
          <div className="mt-2">
            <div className="h-2 w-full bg-white/10 rounded-full overflow-hidden">
              <div 
                className="h-full bg-gradient-to-r from-[#5B3DF8] to-emerald-400 transition-all duration-700 ease-out rounded-full"
                style={{ width: `${overallProgress}%` }}
              ></div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Front of House Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-6 border-b border-slate-200 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center text-[#5B3DF8]">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">Front of House (FOH)</h3>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">{fohProgress}% Completed</div>
              </div>
            </div>
          </div>
          
          <div className="space-y-3">
            {fohItems.map(item => (
              <div 
                key={item.id}
                onClick={() => toggleItem(item.id, 'foh')}
                className={`group flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer ${
                  item.checked 
                    ? 'bg-emerald-50 border-emerald-200 shadow-sm' 
                    : 'bg-white border-slate-200 hover:border-indigo-300 hover:shadow-md'
                }`}
              >
                <div className="mt-0.5 shrink-0 transition-transform group-hover:scale-110">
                  {item.checked ? (
                    <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                  ) : (
                    <Circle className="w-6 h-6 text-slate-300 group-hover:text-indigo-400" />
                  )}
                </div>
                <div className="flex-1">
                  <div className={`font-bold transition-colors ${item.checked ? 'text-emerald-900 line-through opacity-70' : 'text-slate-800'}`}>
                    {item.text}
                  </div>
                  <div className={`text-sm mt-1 ${item.checked ? 'text-emerald-700/60' : 'text-slate-500'}`}>
                    {item.desc}
                  </div>
                </div>
                <div className={`shrink-0 text-xs font-bold px-2 py-1 rounded-md ${item.checked ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {item.time}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Back of House Section */}
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-6 border-b border-slate-200 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-orange-50 flex items-center justify-center text-orange-600">
                <ChefHat className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-800">Back of House (BOH)</h3>
                <div className="text-xs font-bold text-slate-500 uppercase tracking-widest">{bohProgress}% Completed</div>
              </div>
            </div>
          </div>
          
          <div className="space-y-3">
            {bohItems.map(item => (
              <div 
                key={item.id}
                onClick={() => toggleItem(item.id, 'boh')}
                className={`group flex items-start gap-4 p-4 rounded-xl border transition-all cursor-pointer ${
                  item.checked 
                    ? 'bg-emerald-50 border-emerald-200 shadow-sm' 
                    : 'bg-white border-slate-200 hover:border-orange-300 hover:shadow-md'
                }`}
              >
                <div className="mt-0.5 shrink-0 transition-transform group-hover:scale-110">
                  {item.checked ? (
                    <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                  ) : (
                    <Circle className="w-6 h-6 text-slate-300 group-hover:text-orange-400" />
                  )}
                </div>
                <div className="flex-1">
                  <div className={`font-bold transition-colors ${item.checked ? 'text-emerald-900 line-through opacity-70' : 'text-slate-800'}`}>
                    {item.text}
                  </div>
                  <div className={`text-sm mt-1 ${item.checked ? 'text-emerald-700/60' : 'text-slate-500'}`}>
                    {item.desc}
                  </div>
                </div>
                <div className={`flex items-center gap-1 shrink-0 text-xs font-bold px-2 py-1 rounded-md ${item.checked ? 'bg-emerald-100 text-emerald-700' : (item.time === 'Critical' || item.time === 'Alert' ? 'bg-red-50 text-red-600' : 'bg-slate-100 text-slate-500')}`}>
                  {(item.time === 'Critical' || item.time === 'Alert') && !item.checked && <AlertCircle className="w-3 h-3" />}
                  {item.time}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {overallProgress === 100 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-6 text-center animate-in zoom-in duration-300 mt-8">
          <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Sparkles className="w-8 h-8 text-emerald-600" />
          </div>
          <h3 className="text-xl font-bold text-emerald-900 mb-2">All Systems Go!</h3>
          <p className="text-emerald-700">The venue is fully staged and ready for service execution.</p>
        </div>
      )}
    </div>
  )
}
