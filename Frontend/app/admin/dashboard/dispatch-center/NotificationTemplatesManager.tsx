'use client';

import React, { useState } from 'react';
import {
  Zap,
  Bell,
  History,
  Settings,
} from 'lucide-react';
import WorkflowManagerTab from './WorkflowManagerTab';
import TemplateManagerTab from './TemplateManagerTab';
import DeliveryHistoryTab from './DeliveryHistoryTab';
import GlobalSettingsTab from './GlobalSettingsTab';

export default function NotificationTemplatesManager() {
  const [activeMainTab, setActiveMainTab] = useState<'workflows' | 'templates' | 'audit' | 'settings'>('workflows');

  return (
    <div className="space-y-6">
      {/* ─── PRIMARY 4-TAB NAVIGATION HEADER ───────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-2xs p-2 flex items-center justify-between overflow-x-auto scrollbar-none">
        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          {/* TAB 0: WORKFLOWS */}
          <button
            type="button"
            onClick={() => setActiveMainTab('workflows')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeMainTab === 'workflows'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Zap size={15} className={activeMainTab === 'workflows' ? 'text-amber-300' : 'text-amber-500'} />
            <span>Automated Workflows</span>
          </button>

          {/* TAB 1: TEMPLATES */}
          <button
            type="button"
            onClick={() => setActiveMainTab('templates')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeMainTab === 'templates'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Bell size={15} className={activeMainTab === 'templates' ? 'text-white' : 'text-indigo-600'} />
            <span>Message Templates</span>
          </button>

          {/* TAB 2: DELIVERY HISTORY */}
          <button
            type="button"
            onClick={() => setActiveMainTab('audit')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeMainTab === 'audit'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <History size={15} className={activeMainTab === 'audit' ? 'text-white' : 'text-emerald-600'} />
            <span>Delivery History</span>
          </button>

          {/* TAB 3: SETTINGS */}
          <button
            type="button"
            onClick={() => setActiveMainTab('settings')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
              activeMainTab === 'settings'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50'
            }`}
          >
            <Settings size={15} className={activeMainTab === 'settings' ? 'text-white' : 'text-slate-700'} />
            <span>Global Settings</span>
          </button>
        </div>
      </div>

      {/* ─── ACTIVE TAB VIEWPORT ───────────────────────────────────── */}
      <div>
        {activeMainTab === 'workflows' && <WorkflowManagerTab />}
        {activeMainTab === 'templates' && <TemplateManagerTab />}
        {activeMainTab === 'audit' && <DeliveryHistoryTab />}
        {activeMainTab === 'settings' && <GlobalSettingsTab />}
      </div>
    </div>
  );
}
