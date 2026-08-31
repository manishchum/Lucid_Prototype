"use client"
import React, { useState } from 'react'
import { AlertOctagon, AlertTriangle, AlertCircle, Clock, Activity, ArrowRight, ShieldAlert, CheckCircle2 } from 'lucide-react'

export const EscalationMetrics = () => {
  const [selectedSeverity, setSelectedSeverity] = useState<string | null>(null)

  const metrics = [
    {
      id: 'critical',
      level: 'Critical',
      color: 'rose',
      icon: <AlertOctagon className="w-6 h-6" />,
      incidents: [
        { type: 'Food Temperature Violation', trigger: 'Outside safe range (41°F - 135°F)', action: 'Immediate discard & re-fire. Log incident.', time: 'Immediate' },
        { type: 'Allergy Contamination Alert', trigger: 'Reported by guest or staff', action: 'Halt kitchen station, notify GM & medic.', time: 'Immediate' }
      ]
    },
    {
      id: 'high',
      level: 'High Priority',
      color: 'amber',
      icon: <AlertTriangle className="w-6 h-6" />,
      incidents: [
        { type: 'Drink Order Delay', trigger: 'Over 5 minutes', action: 'Comp drinks, floor manager table visit.', time: '5m' },
        { type: 'Entree Ticket Time', trigger: 'Over 25 minutes', action: 'Expediter prioritizes, manager updates guest.', time: '25m' }
      ]
    },
    {
      id: 'medium',
      level: 'Standard',
      color: 'blue',
      icon: <AlertCircle className="w-6 h-6" />,
      incidents: [
        { type: 'Guest Greeting Delay', trigger: 'Over 60 seconds', action: 'Host or available server immediate intervene.', time: '1m' },
        { type: 'Table Turn Delay', trigger: 'Guest sat > 90 minutes', action: 'Offer dessert/coffee at bar to free table.', time: '90m' }
      ]
    }
  ]

  const getColorClasses = (color: string, isSelected: boolean) => {
    const base = {
      rose: isSelected ? 'bg-rose-50 border-rose-200' : 'bg-white border-slate-200 hover:border-rose-300',
      amber: isSelected ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200 hover:border-amber-300',
      blue: isSelected ? 'bg-blue-50 border-blue-200' : 'bg-white border-slate-200 hover:border-blue-300',
    }[color]
    return base
  }

  const getBadgeClasses = (color: string) => {
    return {
      rose: 'bg-rose-100 text-rose-700',
      amber: 'bg-amber-100 text-amber-700',
      blue: 'bg-blue-100 text-blue-700',
    }[color]
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-500 max-w-4xl">
      {/* Header */}
      {/* <div className="bg-slate-900 rounded-2xl p-8 text-white relative overflow-hidden shadow-xl">
        <div className="absolute -right-20 -top-20 w-64 h-64 bg-slate-800 rounded-full blur-3xl opacity-50"></div>
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <Activity className="w-5 h-5 text-indigo-400" />
            <h2 className="text-2xl font-bold">System Incident Escalation Matrix</h2>
          </div>
          <p className="text-slate-400 max-w-xl">Automated severity tiering and mandatory response protocols for operational deviations.</p>
        </div>
      </div> */}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4">
        {metrics.map((tier) => (
          <div 
            key={tier.id}
            onClick={() => setSelectedSeverity(tier.id === selectedSeverity ? null : tier.id)}
            className={`rounded-2xl border-2 p-6 cursor-pointer transition-all duration-300 group ${getColorClasses(tier.color, selectedSeverity === tier.id)} ${selectedSeverity && selectedSeverity !== tier.id ? 'opacity-50 scale-95' : 'scale-100'}`}
          >
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center mb-6 shadow-sm transition-transform duration-500 group-hover:scale-110 ${getBadgeClasses(tier.color)}`}>
              {tier.icon}
            </div>
            
            <h3 className="text-xl font-bold text-slate-800 mb-2">{tier.level}</h3>
            <p className="text-sm font-medium text-slate-500 mb-6">{tier.incidents.length} Trigger Conditions</p>
            
            <div className="space-y-4">
              {tier.incidents.map((inc, i) => (
                <div key={i} className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 group-hover:shadow-md transition-shadow">
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-bold text-slate-800 text-sm">{inc.type}</h4>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1 shrink-0 ${getBadgeClasses(tier.color)}`}>
                      <Clock className="w-3 h-3" /> {inc.time}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 mb-3 pb-3 border-b border-slate-50">
                    <span className="font-semibold text-slate-700">Trigger:</span> {inc.trigger}
                  </div>
                  <div className="flex items-start gap-2">
                    <ArrowRight className={`w-4 h-4 shrink-0 mt-0.5 text-${tier.color}-500`} />
                    <p className={`text-xs font-bold leading-relaxed text-${tier.color}-700`}>{inc.action}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
