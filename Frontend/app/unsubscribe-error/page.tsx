'use client'

import React, { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AlertCircle, ArrowLeft, Mail, CheckCircle2, RefreshCw } from 'lucide-react';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

function UnsubscribeErrorContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const reason = searchParams.get('reason') || 'invalid_token';

  const [manualEmail, setManualEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [manualSuccess, setManualSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const getReasonDetails = (code: string) => {
    switch (code) {
      case 'expired_token':
        return {
          title: 'Link Has Expired',
          desc: 'For your security, email unsubscribe links expire after 30 days. You can opt out manually below.',
        };
      case 'missing_token':
      case 'invalid_token':
        return {
          title: 'Invalid Unsubscribe Link',
          desc: 'This unsubscribe link is incomplete or no longer valid. Enter your email below to unsubscribe directly.',
        };
      case 'user_not_found':
        return {
          title: 'Account Not Found',
          desc: 'We could not locate an active account associated with this token. Please enter your email address below.',
        };
      default:
        return {
          title: 'Unsubscribe Request Issue',
          desc: 'We encountered an unexpected issue processing your link. You can unsubscribe manually below.',
        };
    }
  };

  const details = getReasonDetails(reason);

  const handleManualUnsubscribe = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualEmail.trim()) return;
    setSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await fetch(`${BACKEND_URL}/api/unsubscribe-manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: manualEmail.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setManualSuccess(true);
      } else {
        setErrorMessage(data.detail || 'Could not process unsubscribe. Please try again.');
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Network error occurred.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-rose-50/30 flex items-center justify-center p-4 sm:p-6 font-sans">
      <div className="w-full max-w-lg bg-white rounded-3xl border border-slate-200/80 shadow-xl shadow-slate-200/40 p-8 sm:p-10 text-center relative overflow-hidden">
        {/* Accent Glow */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-amber-500 via-rose-500 to-indigo-500" />

        {/* Icon Squircle */}
        <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-amber-50 border border-amber-100/80 flex items-center justify-center text-amber-600 shadow-sm">
          {manualSuccess ? <CheckCircle2 size={32} className="text-emerald-600" /> : <AlertCircle size={32} />}
        </div>

        {/* Title */}
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          {manualSuccess ? 'Unsubscribed Successfully' : details.title}
        </h1>

        {/* Description */}
        <p className="mt-3 text-sm text-slate-600 leading-relaxed max-w-md mx-auto">
          {manualSuccess
            ? `You will no longer receive automated email updates at ${manualEmail}.`
            : details.desc}
        </p>

        {/* Fallback Manual Opt-Out Form */}
        {!manualSuccess ? (
          <form onSubmit={handleManualUnsubscribe} className="mt-8 text-left space-y-4">
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider">
              Unsubscribe Manually
            </label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="email"
                required
                value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)}
                placeholder="name@company.com"
                className="w-full pl-10 pr-4 py-3 text-sm rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-[#3B66F5] focus:border-transparent transition-all"
              />
            </div>

            {errorMessage && (
              <p className="text-xs text-rose-600 font-medium">{errorMessage}</p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm transition-all duration-200 shadow-md shadow-slate-900/10 cursor-pointer disabled:opacity-50"
            >
              {submitting ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  <span>Processing Opt-Out...</span>
                </>
              ) : (
                <span>Confirm Email Unsubscribe</span>
              )}
            </button>
          </form>
        ) : null}

        {/* Return Button */}
        <div className="mt-6 pt-6 border-t border-slate-100">
          <button
            type="button"
            onClick={() => router.push('/login')}
            className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-white hover:bg-slate-50 text-slate-700 font-semibold text-sm border border-slate-200 transition-all duration-200 cursor-pointer"
          >
            <ArrowLeft size={16} />
            <span>Return to Lucid Platform</span>
          </button>
        </div>
      </div>
    </div>
  );
}

export default function UnsubscribeErrorPage() {
  return (
    <React.Suspense fallback={<div className="min-h-screen bg-slate-50 flex items-center justify-center">Loading...</div>}>
      <UnsubscribeErrorContent />
    </React.Suspense>
  );
}
