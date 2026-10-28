'use client'

import React, { useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { CheckCircle2, ArrowLeft, RefreshCw, MailCheck } from 'lucide-react';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

export default function UnsubscribeSuccessPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const email = searchParams.get('email') || '';
  const [resubscribing, setResubscribing] = useState(false);
  const [resubscribed, setResubscribed] = useState(false);
  const [resubError, setResubError] = useState<string | null>(null);

  const handleResubscribe = async () => {
    if (!email) return;
    setResubscribing(true);
    setResubError(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/unsubscribe/resubscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setResubscribed(true);
      } else {
        setResubError(data.detail || 'Failed to re-subscribe. Please try again later.');
      }
    } catch (err: any) {
      setResubError(err.message || 'Network error occurred.');
    } finally {
      setResubscribing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50/40 flex items-center justify-center p-4 sm:p-6 font-sans">
      <div className="w-full max-w-lg bg-white rounded-3xl border border-slate-200/80 shadow-xl shadow-slate-200/40 p-8 sm:p-10 text-center relative overflow-hidden">
        {/* Decorative Top Accent Glow */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-emerald-500 via-teal-500 to-blue-500" />

        {/* Icon Squircle */}
        <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-emerald-50 border border-emerald-100/80 flex items-center justify-center text-emerald-600 shadow-sm">
          {resubscribed ? <MailCheck size={32} /> : <CheckCircle2 size={32} />}
        </div>

        {/* Title */}
        <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
          {resubscribed ? 'Welcome Back!' : 'Unsubscribed Successfully'}
        </h1>

        {/* Message */}
        <p className="mt-3 text-sm text-slate-600 leading-relaxed max-w-md mx-auto">
          {resubscribed ? (
            <>
              You have been successfully re-subscribed to notifications for{' '}
              <strong className="text-slate-800 font-semibold">{email}</strong>. You won&apos;t miss any critical learning reminders.
            </>
          ) : (
            <>
              You will no longer receive automated email updates or reminders at{' '}
              <strong className="text-slate-800 font-semibold">{email || 'your email address'}</strong>.
            </>
          )}
        </p>

        {/* Informational Callout */}
        <div className="mt-6 p-4 rounded-xl bg-slate-50 border border-slate-100 text-xs text-slate-500 leading-normal text-left">
          <p className="font-semibold text-slate-700 mb-1">Please note:</p>
          <ul className="list-disc list-inside space-y-1">
            <li>Essential account and security emails (e.g. password resets) will still be delivered.</li>
            <li>In-app and mobile push notification preferences can be customized anytime from your profile settings.</li>
          </ul>
        </div>

        {/* Action Buttons */}
        <div className="mt-8 space-y-3">
          {!resubscribed && email && (
            <button
              onClick={handleResubscribe}
              disabled={resubscribing}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm transition-all duration-200 shadow-md shadow-slate-900/10 cursor-pointer disabled:opacity-50"
            >
              {resubscribing ? (
                <>
                  <RefreshCw size={16} className="animate-spin" />
                  <span>Re-subscribing...</span>
                </>
              ) : (
                <>
                  <RefreshCw size={16} />
                  <span>Unsubscribed by mistake? Re-subscribe</span>
                </>
              )}
            </button>
          )}

          {resubError && (
            <p className="text-xs text-rose-600 font-medium">{resubError}</p>
          )}

          <button
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
