'use client';

import React, { useState, useEffect } from 'react';
import {
  History,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Copy,
  Check,
  RefreshCw,
  X,
  ExternalLink,
  ChevronRight,
  ShieldAlert,
  Send,
  Eye,
  Smartphone,
  Mail,
  Bell,
  MessageSquare,
} from 'lucide-react';
import { fetchWithAuth } from '@/lib/fetch-with-auth';

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

export interface DispatchAuditRecord {
  id: string;
  correlation_id: string;
  template_id?: string;
  notification_type: string;
  channel: string;
  recipient_user_id?: string;
  users?: {
    name?: string;
    email?: string;
  };
  status: 'DELIVERED' | 'SENT' | 'FAILED' | 'SUPPRESSED' | 'BLOCKED' | 'VALIDATION_FAILED';
  resolved_variables?: Record<string, any>;
  rendered_title?: string;
  rendered_body?: string;
  failure_reason?: string;
  suppression_reason?: string;
  validation_errors?: string[] | any;
  provider_response?: Record<string, any>;
  latency_ms?: number;
  is_test?: boolean;
  created_at: string;
}

export default function DeliveryHistoryTab() {
  const [logs, setLogs] = useState<DispatchAuditRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [channelFilter, setChannelFilter] = useState<string>('ALL');

  // Selected Log for Inspector Slide-Over Drawer
  const [selectedLog, setSelectedLog] = useState<DispatchAuditRecord | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchLogs = async () => {
    try {
      setLoading(true);
      const res = await fetchWithAuth(`${API_BASE}/api/notifications/audit/dispatches?limit=50`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.audit_logs || []);
      }
    } catch (e) {
      console.error('Failed to load dispatch audit logs:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Filter logs
  const filteredLogs = logs.filter((l) => {
    const matchesStatus = statusFilter === 'ALL' || l.status === statusFilter;
    const matchesChannel = channelFilter === 'ALL' || l.channel === channelFilter;
    const q = searchQuery.toLowerCase();
    const matchesSearch =
      !searchQuery ||
      l.id.toLowerCase().includes(q) ||
      l.notification_type.toLowerCase().includes(q) ||
      (l.users?.name && l.users.name.toLowerCase().includes(q)) ||
      (l.users?.email && l.users.email.toLowerCase().includes(q)) ||
      (l.rendered_title && l.rendered_title.toLowerCase().includes(q)) ||
      (l.failure_reason && l.failure_reason.toLowerCase().includes(q));
    return matchesStatus && matchesChannel && matchesSearch;
  });

  const successCount = logs.filter((l) => l.status === 'DELIVERED' || l.status === 'SENT').length;
  const failedCount = logs.filter((l) => l.status === 'FAILED' || l.status === 'VALIDATION_FAILED').length;
  const suppressedCount = logs.filter((l) => l.status === 'SUPPRESSED' || l.status === 'BLOCKED').length;

  return (
    <div className="space-y-6">
      {/* ─── METRIC CARDS ──────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4.5 rounded-2xl border border-slate-200/80 shadow-2xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Total Dispatches
          </div>
          <div className="text-2xl font-black text-slate-900 mt-1">{logs.length}</div>
          <p className="text-[11px] text-slate-500 mt-0.5">Recorded delivery events</p>
        </div>

        <div className="bg-white p-4.5 rounded-2xl border border-slate-200/80 shadow-2xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Successfully Delivered
          </div>
          <div className="text-2xl font-black text-emerald-600 mt-1">{successCount}</div>
          <p className="text-[11px] text-slate-500 mt-0.5">Push, In-App, Email verified</p>
        </div>

        <div className="bg-white p-4.5 rounded-2xl border border-slate-200/80 shadow-2xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Failed / Errors
          </div>
          <div className="text-2xl font-black text-rose-600 mt-1">{failedCount}</div>
          <p className="text-[11px] text-slate-500 mt-0.5">Captured with error reasons</p>
        </div>

        <div className="bg-white p-4.5 rounded-2xl border border-slate-200/80 shadow-2xs">
          <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Suppressed / Guardrails
          </div>
          <div className="text-2xl font-black text-amber-600 mt-1">{suppressedCount}</div>
          <p className="text-[11px] text-slate-500 mt-0.5">Quiet hours & fatigue capping</p>
        </div>
      </div>

      {/* ─── FILTERS & SEARCH ──────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Status Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {[
            { id: 'ALL', label: 'All Statuses' },
            { id: 'DELIVERED', label: 'Delivered' },
            { id: 'SENT', label: 'Sent' },
            { id: 'FAILED', label: 'Failed' },
            { id: 'SUPPRESSED', label: 'Suppressed' },
          ].map((st) => {
            const isSelected = statusFilter === st.id;
            return (
              <button
                key={st.id}
                type="button"
                onClick={() => setStatusFilter(st.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-slate-900 text-white shadow-2xs'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {st.label}
              </button>
            );
          })}
        </div>

        {/* Search */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={fetchLogs}
            className="p-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-600 transition-colors cursor-pointer"
            title="Refresh logs"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>

          <div className="relative min-w-[240px]">
            <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by ID, recipient, or trigger..."
              className="w-full pl-10 pr-9 py-2 bg-white rounded-xl border border-slate-200 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 transition-all font-medium"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-0.5 rounded-full cursor-pointer transition-colors"
                title="Clear search"
              >
                <X size={13} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ─── DATA TABLE ────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <RefreshCw size={24} className="mx-auto text-indigo-600 animate-spin mb-3" />
            <p className="text-xs font-semibold text-slate-600">Loading delivery history...</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="p-12 text-center">
            <History size={28} className="mx-auto text-slate-300 mb-3" />
            <h3 className="text-sm font-bold text-slate-700">No delivery logs recorded</h3>
            <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
              {searchQuery
                ? `No delivery logs matching "${searchQuery}".`
                : 'When workflows or triggers fire notifications, every sent message and error will be permanently logged here.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/50 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-3.5 px-5">Delivery ID</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Channel</th>
                  <th className="py-3.5 px-4">Trigger Event</th>
                  <th className="py-3.5 px-4">Recipient</th>
                  <th className="py-3.5 px-4">Delivered Message Snippet</th>
                  <th className="py-3.5 px-5 text-right">Sent Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredLogs.map((log) => {
                  const isFail = log.status === 'FAILED' || log.status === 'VALIDATION_FAILED';
                  const isSuppressed = log.status === 'SUPPRESSED' || log.status === 'BLOCKED';
                  const isSuccess = log.status === 'DELIVERED' || log.status === 'SENT';

                  return (
                    <tr
                      key={log.id}
                      onClick={() => setSelectedLog(log)}
                      className="hover:bg-slate-50/70 transition-colors cursor-pointer group"
                    >
                      {/* Delivery ID */}
                      <td className="py-3.5 px-5">
                        <div className="flex items-center gap-1.5 font-mono text-[11px] text-slate-700">
                          <span>{log.id.substring(0, 8)}...</span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCopy(log.id, log.id);
                            }}
                            className="p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                            title="Copy full delivery ID"
                          >
                            {copiedId === log.id ? (
                              <Check size={11} className="text-emerald-600" />
                            ) : (
                              <Copy size={11} />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="py-3.5 px-4">
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                            isSuccess
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : isFail
                              ? 'bg-rose-50 text-rose-700 border-rose-200'
                              : isSuppressed
                              ? 'bg-amber-50 text-amber-700 border-amber-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}
                        >
                          {isSuccess && <CheckCircle2 size={11} />}
                          {isFail && <XCircle size={11} />}
                          {isSuppressed && <AlertTriangle size={11} />}
                          <span>{log.status}</span>
                        </span>
                      </td>

                      {/* Channel */}
                      <td className="py-3.5 px-4">
                        <span className="font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200 text-[10px]">
                          {log.channel}
                        </span>
                      </td>

                      {/* Trigger Event */}
                      <td className="py-3.5 px-4">
                        <span className="font-mono text-[11px] text-indigo-700 bg-indigo-50/70 px-2 py-0.5 rounded border border-indigo-100 line-clamp-1">
                          {log.notification_type}
                        </span>
                      </td>

                      {/* Recipient */}
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-800 line-clamp-1">
                          {log.users?.name || 'Portal Learner'}
                        </div>
                        <div className="text-[10px] text-slate-400 line-clamp-1">
                          {log.users?.email || log.recipient_user_id?.substring(0, 8)}
                        </div>
                      </td>

                      {/* Message Snippet */}
                      <td className="py-3.5 px-4">
                        {isFail ? (
                          <div className="text-rose-600 text-[11px] font-medium line-clamp-1">
                            Error: {log.failure_reason || (log.validation_errors ? JSON.stringify(log.validation_errors) : 'Delivery failed')}
                          </div>
                        ) : isSuppressed ? (
                          <div className="text-amber-700 text-[11px] font-medium line-clamp-1">
                            Suppressed: {log.suppression_reason || 'Guardrail restriction'}
                          </div>
                        ) : (
                          <div className="text-slate-600 line-clamp-1 text-[11px]">
                            {log.rendered_title || log.rendered_body || 'Message sent'}
                          </div>
                        )}
                      </td>

                      {/* Sent Time */}
                      <td className="py-3.5 px-5 text-right text-slate-400 whitespace-nowrap text-[11px]">
                        {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── SLIDE-OVER INSPECTOR DRAWER ───────────────────────────── */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 bg-slate-900/30 backdrop-blur-2xs flex justify-end animate-in fade-in duration-100">
          <div className="bg-white w-full max-w-lg h-full shadow-2xl border-l border-slate-200 p-6 overflow-y-auto flex flex-col justify-between animate-in slide-in-from-right duration-150">
            <div className="space-y-5">
              {/* Drawer Header */}
              <div className="flex items-center justify-between pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center text-slate-700">
                    <History size={16} />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-slate-900">Delivery Diagnostics</h3>
                    <div className="flex items-center gap-1.5 font-mono text-[10px] text-slate-400">
                      <span>{selectedLog.id}</span>
                      <button
                        type="button"
                        onClick={() => handleCopy(selectedLog.id, 'drawer_id')}
                        className="p-0.5 hover:text-slate-600"
                      >
                        <Copy size={10} />
                      </button>
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedLog(null)}
                  className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              {/* Status Banner */}
              <div
                className={`p-3.5 rounded-2xl border flex items-center justify-between ${
                  selectedLog.status === 'DELIVERED' || selectedLog.status === 'SENT'
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : selectedLog.status === 'FAILED' || selectedLog.status === 'VALIDATION_FAILED'
                    ? 'bg-rose-50 border-rose-200 text-rose-800'
                    : 'bg-amber-50 border-amber-200 text-amber-800'
                }`}
              >
                <div>
                  <div className="text-xs font-bold uppercase tracking-wider">
                    Status: {selectedLog.status}
                  </div>
                  <div className="text-[11px] mt-0.5">
                    Channel: <strong>{selectedLog.channel}</strong> • Trigger: <strong>{selectedLog.notification_type}</strong>
                  </div>
                </div>

                {selectedLog.latency_ms && selectedLog.latency_ms > 0 && (
                  <span className="text-[10px] font-mono font-bold bg-white/80 px-2 py-0.5 rounded border">
                    {selectedLog.latency_ms}ms
                  </span>
                )}
              </div>

              {/* Failure Error Card if Failed */}
              {(selectedLog.failure_reason || selectedLog.validation_errors) && (
                <div className="p-3.5 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 space-y-1">
                  <div className="text-xs font-bold flex items-center gap-1.5 text-rose-700">
                    <XCircle size={14} />
                    <span>Error Diagnostics</span>
                  </div>
                  <p className="text-xs font-mono break-all leading-relaxed">
                    {selectedLog.failure_reason || JSON.stringify(selectedLog.validation_errors, null, 2)}
                  </p>
                </div>
              )}

              {/* Suppression Reason Card */}
              {selectedLog.suppression_reason && (
                <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 space-y-1">
                  <div className="text-xs font-bold flex items-center gap-1.5 text-amber-700">
                    <AlertTriangle size={14} />
                    <span>Guardrail Suppression</span>
                  </div>
                  <p className="text-xs leading-relaxed">{selectedLog.suppression_reason}</p>
                </div>
              )}

              {/* Rendered Message Card */}
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Delivered Copy
                </div>
                <div className="text-xs font-bold text-slate-900">
                  {selectedLog.rendered_title || '(No title template)'}
                </div>
                <div className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap">
                  {selectedLog.rendered_body || '(No body rendered)'}
                </div>
              </div>

              {/* Recipient Details */}
              <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200 text-xs space-y-1.5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Recipient Identity
                </div>
                <div className="font-semibold text-slate-800">
                  {selectedLog.users?.name || 'Learner User'}
                </div>
                <div className="text-slate-500 font-mono text-[11px]">
                  Email: {selectedLog.users?.email || 'N/A'}
                </div>
                <div className="text-slate-400 font-mono text-[10px]">
                  User ID: {selectedLog.recipient_user_id}
                </div>
              </div>

              {/* Sent Payload JSON */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  <span>Sent Payload Variables</span>
                  <button
                    type="button"
                    onClick={() =>
                      handleCopy(
                        JSON.stringify(selectedLog.resolved_variables || {}, null, 2),
                        'payload'
                      )
                    }
                    className="text-indigo-600 hover:text-indigo-700 cursor-pointer"
                  >
                    Copy JSON
                  </button>
                </div>
                <pre className="p-3 rounded-2xl bg-slate-900 text-slate-200 font-mono text-[11px] overflow-x-auto max-h-[160px] leading-relaxed">
                  {JSON.stringify(selectedLog.resolved_variables || {}, null, 2)}
                </pre>
              </div>
            </div>

            {/* Drawer Close Button */}
            <div className="pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSelectedLog(null)}
                className="w-full py-2.5 rounded-xl border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
