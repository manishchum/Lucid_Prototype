'use client';

import React, { useState, useEffect } from 'react';
import {
  Settings,
  Shield,
  Clock,
  Sliders,
  CheckCircle2,
  AlertCircle,
  Save,
  Bell,
  Smartphone,
  Mail,
  MessageSquare,
  RefreshCw,
  Flame,
  BookOpen,
} from 'lucide-react';
import { fetchWithAuth } from '@/lib/fetch-with-auth';

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

export interface GlobalNotificationSettings {
  id: string;
  in_app_enabled: boolean;
  push_enabled: boolean;
  email_enabled: boolean;
  whatsapp_enabled: boolean;
  deadline_reminders_enabled: boolean;
  post_completion_enabled: boolean;
  streak_notifications_enabled: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  max_daily_per_user: number;
}

export default function GlobalSettingsTab() {
  const [settings, setSettings] = useState<GlobalNotificationSettings>({
    id: 'global_default',
    in_app_enabled: true,
    push_enabled: true,
    email_enabled: true,
    whatsapp_enabled: false,
    deadline_reminders_enabled: true,
    post_completion_enabled: true,
    streak_notifications_enabled: true,
    quiet_hours_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '08:00',
    max_daily_per_user: 5,
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchSettings = async () => {
    try {
      setLoading(true);
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/admin/global-settings`);
      if (res.ok) {
        const data = await res.json();
        if (data.settings) {
          setSettings(data.settings);
        }
      }
    } catch (e) {
      console.error('Failed to load global settings:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErrorMsg(null);
    setSaveSuccess(false);

    try {
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/admin/global-settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Failed to save settings');
      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err: any) {
      setErrorMsg(err.message || 'An error occurred while saving.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSave} className="space-y-6 w-full">
      {/* ─── HEADER ────────────────────────────────────────────────── */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <Settings size={18} className="text-slate-700" />
            <span>Platform-Wide Notification Governance</span>
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Global delivery limits, channel toggles, and quiet hours that apply across all workflows.
          </p>
        </div>

        <button
          type="submit"
          disabled={saving || loading}
          className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold shadow-xs hover:shadow-sm transition-all cursor-pointer disabled:opacity-50"
        >
          {saving ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : saveSuccess ? (
            <CheckCircle2 size={14} className="text-emerald-300" />
          ) : (
            <Save size={14} />
          )}
          <span>{saving ? 'Saving...' : saveSuccess ? 'Saved Successfully!' : 'Save Settings'}</span>
        </button>
      </div>

      {errorMsg && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
          <AlertCircle size={15} className="shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* ─── CARD 1: MASTER DELIVERY CHANNELS ──────────────────────── */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-4">
        <div className="border-b border-slate-100 pb-3">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <Shield size={14} className="text-indigo-600" />
            <span>Master Channel Gateways</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Toggling a channel off immediately halts that transport layer across all automated workflows.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            {
              key: 'in_app_enabled',
              label: 'In-App Notification Feed',
              desc: 'Header bell notifications & real-time WebSocket popups.',
              icon: Bell,
              color: 'text-indigo-600',
            },
            {
              key: 'push_enabled',
              label: 'Mobile Push Notifications',
              desc: 'Lockscreen alerts via FCM & APNs devices.',
              icon: Smartphone,
              color: 'text-emerald-600',
            },
            {
              key: 'email_enabled',
              label: 'Transactional Email Gateway',
              desc: 'Resend / SMTP digests and deadline reminders.',
              icon: Mail,
              color: 'text-blue-600',
            },
            {
              key: 'whatsapp_enabled',
              label: 'Meta WhatsApp Gateway',
              desc: 'Direct enterprise WhatsApp HSM messaging.',
              icon: MessageSquare,
              color: 'text-green-600',
            },
          ].map((item) => {
            const isEnabled = (settings as any)[item.key];
            const Icon = item.icon;
            return (
              <div
                key={item.key}
                onClick={() =>
                  setSettings((prev) => ({ ...prev, [item.key]: !isEnabled }))
                }
                className={`p-4 rounded-2xl border transition-all cursor-pointer flex items-start justify-between gap-3 ${
                  isEnabled
                    ? 'bg-slate-50/60 border-slate-300'
                    : 'bg-white border-slate-200 opacity-60'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className={`p-2 rounded-xl bg-white border border-slate-200 shrink-0 ${item.color}`}>
                    <Icon size={16} />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-900">{item.label}</div>
                    <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{item.desc}</p>
                  </div>
                </div>

                <div
                  className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer shrink-0 mt-1 ${
                    isEnabled ? 'bg-indigo-600' : 'bg-slate-200'
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded-full bg-white shadow-xs absolute top-0.5 transition-transform ${
                      isEnabled ? 'left-4.5' : 'left-0.5'
                    }`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ─── CARD 2: FATIGUE & FREQUENCY CAPPING ───────────────────── */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-4">
        <div className="border-b border-slate-100 pb-3">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <Sliders size={14} className="text-indigo-600" />
            <span>Learner Fatigue & Frequency Capping</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Prevents notification fatigue by setting a hard ceiling on maximum nudges sent per learner in a 24-hour window.
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-800">
              Maximum Notifications per Learner / 24 Hours
            </span>
            <span className="text-sm font-black text-indigo-600 bg-white px-3 py-1 rounded-xl border border-slate-200">
              {settings.max_daily_per_user} max / day
            </span>
          </div>

          <input
            type="range"
            min={1}
            max={20}
            step={1}
            value={settings.max_daily_per_user}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                max_daily_per_user: Number(e.target.value),
              }))
            }
            className="w-full accent-indigo-600 cursor-pointer"
          />

          <div className="flex justify-between text-[10px] text-slate-400 font-medium">
            <span>1 (Ultra-Quiet)</span>
            <span>5 (Balanced Default)</span>
            <span>20 (High Frequency)</span>
          </div>
        </div>
      </div>

      {/* ─── CARD 3: QUIET HOURS & TIMEZONES ───────────────────────── */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-4">
        <div className="border-b border-slate-100 pb-3 flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
              <Clock size={14} className="text-indigo-600" />
              <span>Quiet Hours Policy</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Blackout non-urgent notifications during recipient sleep hours.
            </p>
          </div>

          <div
            onClick={() =>
              setSettings((prev) => ({
                ...prev,
                quiet_hours_enabled: !prev.quiet_hours_enabled,
              }))
            }
            className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer shrink-0 ${
              settings.quiet_hours_enabled ? 'bg-indigo-600' : 'bg-slate-200'
            }`}
          >
            <span
              className={`w-4 h-4 rounded-full bg-white shadow-xs absolute top-0.5 transition-transform ${
                settings.quiet_hours_enabled ? 'left-4.5' : 'left-0.5'
              }`}
            />
          </div>
        </div>

        {settings.quiet_hours_enabled && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-2xl bg-slate-50 border border-slate-200 animate-in fade-in duration-100">
            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                Quiet Hours Start (Evening)
              </label>
              <input
                type="time"
                value={settings.quiet_hours_start}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, quiet_hours_start: e.target.value }))
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 bg-white"
              />
            </div>

            <div>
              <label className="text-xs font-bold text-slate-700 block mb-1">
                Quiet Hours End (Morning)
              </label>
              <input
                type="time"
                value={settings.quiet_hours_end}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, quiet_hours_end: e.target.value }))
                }
                className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-800 bg-white"
              />
            </div>
          </div>
        )}
      </div>

      {/* ─── CARD 4: CATEGORY SYSTEM SWITCHES ──────────────────────── */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-2xs space-y-4">
        <div className="border-b border-slate-100 pb-3">
          <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
            <Flame size={14} className="text-indigo-600" />
            <span>Category Automation Switches</span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Turn off entire background automation pipelines if needed during sprints or maintenance.
          </p>
        </div>

        <div className="space-y-2">
          {[
            {
              key: 'deadline_reminders_enabled',
              label: 'Curriculum & Sprint Deadlines',
              desc: 'Automated 48h and 24h milestone reminder sweeps.',
              icon: BookOpen,
            },
            {
              key: 'streak_notifications_enabled',
              label: 'Daily Streak Rescue Alerts',
              desc: 'Evening nudges to maintain daily learning habits.',
              icon: Flame,
            },
            {
              key: 'post_completion_enabled',
              label: 'Post-Completion CSAT Feedback',
              desc: 'Prompts learners for feedback upon finishing a module.',
              icon: CheckCircle2,
            },
          ].map((item) => {
            const isEnabled = (settings as any)[item.key];
            const Icon = item.icon;
            return (
              <div
                key={item.key}
                onClick={() =>
                  setSettings((prev) => ({ ...prev, [item.key]: !isEnabled }))
                }
                className="p-3.5 rounded-2xl border border-slate-200 hover:border-slate-300 transition-colors flex items-center justify-between cursor-pointer"
              >
                <div className="flex items-center gap-3">
                  <Icon size={16} className="text-slate-500" />
                  <div>
                    <div className="text-xs font-bold text-slate-800">{item.label}</div>
                    <div className="text-[11px] text-slate-400">{item.desc}</div>
                  </div>
                </div>

                <div
                  className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer shrink-0 ${
                    isEnabled ? 'bg-indigo-600' : 'bg-slate-200'
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded-full bg-white shadow-xs absolute top-0.5 transition-transform ${
                      isEnabled ? 'left-4.5' : 'left-0.5'
                    }`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </form>
  );
}
