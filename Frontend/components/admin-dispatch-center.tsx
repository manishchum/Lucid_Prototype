'use client'

import React, { useState } from 'react';
import { X, ChevronDown, MessageSquare, Mail, Calendar, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

interface AdminDispatchCenterProps {
  isOpen: boolean;
  onClose: () => void;
}

const AdminDispatchCenter: React.FC<AdminDispatchCenterProps> = ({ isOpen, onClose }) => {
  const [selectedChannel, setSelectedChannel] = useState<'whatsapp' | 'email'>('email');
  const [selectedSprint, setSelectedSprint] = useState('');
  const [selectedSubModule, setSelectedSubModule] = useState('introduction');
  const [selectedContentType, setSelectedContentType] = useState('podcast');
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [selectedTime, setSelectedTime] = useState('09:00 AM');
  const [selectedDays, setSelectedDays] = useState<number[]>([0, 1, 2, 3, 4]); // Mon-Fri

  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const daysLabel = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

  const sprints = [
    'Regulatory Compliance',
    'Financial Planning',
    'Risk Management',
    'Customer Service Excellence'
  ];

  const subModules = [
    { id: 'introduction', label: 'Introduction' },
    { id: 'global-standards', label: 'Global Standards' },
    { id: 'documentation', label: 'Documentation' },
    { id: 'audit-preparedness', label: 'Audit Preparedness' }
  ];

  const contentTypes = [
    { id: 'podcast', label: 'PODCAST', icon: '🎙️' },
    { id: 'video', label: 'VIDEO', icon: '🎬' },
    { id: 'mindmap', label: 'MINDMAP', icon: '🗺️' },
    { id: 'flashcards', label: 'FLASHCARDS', icon: '🃏' }
  ];

  const toggleDay = (dayIndex: number) => {
    setSelectedDays(prev => 
      prev.includes(dayIndex) 
        ? prev.filter(d => d !== dayIndex)
        : [...prev, dayIndex]
    );
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[999] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="px-8 py-6 border-b border-slate-200 bg-gradient-to-r from-blue-50 to-indigo-50">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-slate-900 flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center">
                  <MessageSquare className="text-white" size={20} />
                </div>
                Admin Dispatch Center
              </h2>
              <p className="text-sm text-slate-600 mt-1">Automate employee encouragement through WhatsApp and Email.</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="rounded-full hover:bg-white/80"
            >
              <X size={20} />
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-8">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Left Column - Configuration */}
              <div className="space-y-6">
                {/* 1. Delivery Channel */}
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 block">
                    1. Delivery Channel
                  </label>
                  <div className="flex gap-3">
                    <button
                      onClick={() => setSelectedChannel('whatsapp')}
                      className={`flex-1 px-4 py-3 rounded-xl border-2 transition-all flex items-center justify-center gap-2 ${
                        selectedChannel === 'whatsapp'
                          ? 'border-green-500 bg-green-50 text-green-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      <MessageSquare size={18} />
                      <span className="font-semibold">WhatsApp</span>
                    </button>
                    <button
                      onClick={() => setSelectedChannel('email')}
                      className={`flex-1 px-4 py-3 rounded-xl border-2 transition-all flex items-center justify-center gap-2 ${
                        selectedChannel === 'email'
                          ? 'border-blue-500 bg-blue-50 text-blue-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                      }`}
                    >
                      <Mail size={18} />
                      <span className="font-semibold">Email</span>
                    </button>
                  </div>
                </div>

                {/* 2. Target Sprint */}
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 block">
                    2. Target Sprint
                  </label>
                  <div className="relative">
                    <Select value={selectedSprint} onValueChange={setSelectedSprint}>
                      <SelectTrigger className="w-full px-4 py-6 rounded-xl border-2 border-slate-200 bg-white text-slate-900 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-left h-auto">
                        <SelectValue placeholder="Select a sprint..." />
                      </SelectTrigger>
                      <SelectContent className="max-h-[300px] w-[var(--radix-select-trigger-width)]">
                        {sprints.map((sprint) => (
                          <SelectItem key={sprint} value={sprint}>
                            {sprint}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* 3. Sub-Module Selection */}
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 block">
                    3. Sub-Module Selection
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {subModules.map((module) => (
                      <button
                        key={module.id}
                        onClick={() => setSelectedSubModule(module.id)}
                        className={`px-4 py-3 rounded-xl border-2 transition-all text-sm font-semibold ${
                          selectedSubModule === module.id
                            ? 'border-blue-500 bg-blue-50 text-blue-700'
                            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                        }`}
                      >
                        {module.label}
                        {selectedSubModule === module.id && (
                          <span className="ml-2 text-blue-500">✓</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 4. Content Type */}
                <div>
                  <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 block">
                    4. Content Type
                  </label>
                  <div className="grid grid-cols-4 gap-3">
                    {contentTypes.map((type) => (
                      <button
                        key={type.id}
                        onClick={() => setSelectedContentType(type.id)}
                        className={`px-3 py-4 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${
                          selectedContentType === type.id
                            ? 'border-blue-500 bg-blue-50'
                            : 'border-slate-200 bg-white hover:border-slate-300'
                        }`}
                      >
                        <span className="text-2xl">{type.icon}</span>
                        <span className={`text-[10px] font-bold ${
                          selectedContentType === type.id ? 'text-blue-700' : 'text-slate-600'
                        }`}>
                          {type.label}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Engagement Question */}
                <div>
                  <div className="bg-red-50 border-2 border-red-100 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-8 h-8 bg-red-500 rounded-lg flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-white font-bold text-lg">?</span>
                      </div>
                      <div>
                        <h4 className="font-bold text-slate-900 text-sm mb-1">Engagement Question</h4>
                        <p className="text-xs text-slate-600">Include a daily challenge in the message</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Dispatch Scheduling */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-2">
                      <Calendar size={14} />
                      Dispatch Scheduling
                    </label>
                    <button
                      onClick={() => setScheduleEnabled(!scheduleEnabled)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        scheduleEnabled ? 'bg-blue-500' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          scheduleEnabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                  
                  {scheduleEnabled && (
                    <div className="space-y-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                      {/* Delivery Time */}
                      <div>
                        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 block">
                          Delivery Time
                        </label>
                        <div className="relative">
                          <Clock className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                          <input
                            type="text"
                            value={selectedTime}
                            onChange={(e) => setSelectedTime(e.target.value)}
                            className="w-full pl-10 pr-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium focus:outline-none focus:border-blue-500"
                          />
                        </div>
                      </div>

                      {/* Active Days */}
                      <div>
                        <label className="text-xs font-semibold text-slate-600 uppercase tracking-wide mb-2 block">
                          Active Days
                        </label>
                        <div className="flex gap-2 justify-between">
                          {days.map((day, index) => (
                            <button
                              key={index}
                              onClick={() => toggleDay(index)}
                              className={`w-10 h-10 rounded-lg font-bold text-sm transition-all ${
                                selectedDays.includes(index)
                                  ? 'bg-blue-500 text-white shadow-md'
                                  : 'bg-white text-slate-400 border border-slate-200 hover:border-slate-300'
                              }`}
                              title={daysLabel[index]}
                            >
                              {day}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Draft Button */}
                      <button className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-500/30">
                        <span className="text-lg">✨</span>
                        Draft {selectedChannel === 'email' ? 'Email' : 'WhatsApp'} Snippet
                      </button>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column - Preview & Queue */}
              <div className="space-y-6">
                {/* Dispatch Preview */}
                <div className="bg-gradient-to-br from-slate-50 to-blue-50 rounded-xl p-6 border border-slate-200">
                  <h3 className="text-lg font-bold text-slate-900 mb-4">Dispatch Preview</h3>
                  <div className="text-center py-12">
                    <div className="w-16 h-16 bg-white rounded-full mx-auto mb-4 flex items-center justify-center shadow-sm">
                      <span className="text-3xl">📊</span>
                    </div>
                    <p className="text-sm text-slate-600 font-medium">
                      Select your <span className="font-bold text-blue-600">Regulatory Compliance</span> targets to
                    </p>
                    <p className="text-sm text-slate-600 font-medium">generate a tailored snippet.</p>
                  </div>
                </div>

                {/* Scheduled Dispatch Queue */}
                <div className="bg-white rounded-xl p-6 border border-slate-200">
                  <div className="flex items-center gap-2 mb-4">
                    <div className="w-8 h-8 bg-orange-100 rounded-lg flex items-center justify-center">
                      <span className="text-lg">📋</span>
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">Scheduled Dispatch Queue</h3>
                      <p className="text-xs text-slate-500">Monitoring active employee engagement cycles.</p>
                    </div>
                  </div>
                  
                  <div className="text-center py-16">
                    <div className="w-20 h-20 bg-slate-50 rounded-full mx-auto mb-4 flex items-center justify-center">
                      <span className="text-4xl">📪</span>
                    </div>
                    <h4 className="font-bold text-slate-900 mb-2">Your Queue is Empty</h4>
                    <p className="text-sm text-slate-500 max-w-xs mx-auto">
                      Configure and set a dispatch to see it appear here for automated delivery.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 py-4 border-t border-slate-200 bg-slate-50 flex justify-end">
        </div>
      </div>
    </div>
  );
};

export default AdminDispatchCenter;
