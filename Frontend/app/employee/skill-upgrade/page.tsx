'use client';

import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import SkillUpgrade from '@/components/career-journey/SkillUpgrade';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, X, Info } from 'lucide-react';

function useIllusionProgress(active: boolean) {
  const [progress, setProgress] = useState(12);
  const [show, setShow] = useState(active);

  useEffect(() => {
    if (!active) {
      setProgress(100);
      const timeout = setTimeout(() => setShow(false), 180);
      return () => clearTimeout(timeout);
    }

    setShow(true);
    setProgress(Math.min(25, 10 + Math.round(Math.random() * 12)));

    const id = setInterval(() => {
      setProgress((prev) => {
        const shouldHold = prev > 70 ? Math.random() < 0.45 : Math.random() < 0.25;
        if (shouldHold) return prev;
        const increment = Math.max(1, Math.round(Math.random() * 7));
        return Math.min(prev + increment, 93);
      });
    }, 420 + Math.round(Math.random() * 240));

    return () => clearInterval(id);
  }, [active]);

  return { progress: Math.min(progress, 100), show };
}

function LoadingProgress({ label, progress }: { label: string; progress: number }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: '#05050a' }}>
      <div className="w-full max-w-xl rounded-2xl p-6 space-y-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <div className="flex items-center justify-between text-sm font-semibold text-slate-300">
          <span>{label}</span>
          <span className="text-white font-black">{progress}%</span>
        </div>
        <div className="relative h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.05)' }}>
          <div
            className="absolute left-0 top-0 h-full transition-all duration-500 ease-out"
            style={{ width: `${progress}%`, background: 'linear-gradient(to right, #2563eb, #6366f1, #06b6d4)' }}
          />
        </div>
        <p className="text-xs text-slate-600 font-medium uppercase tracking-widest">Loading SprintVerse Paths…</p>
      </div>
    </div>
  );
}

const notifStyles = {
  success: { bg: 'rgba(37,99,235,0.95)',  border: 'rgba(59,130,246,0.5)',  icon: <CheckCircle2 size={16} /> },
  error:   { bg: 'rgba(220,38,38,0.95)',   border: 'rgba(239,68,68,0.5)',   icon: <X size={16} /> },
  info:    { bg: 'rgba(99,102,241,0.95)',  border: 'rgba(129,140,248,0.5)', icon: <Info size={16} /> },
};

export default function SkillUpgradePage() {
  const { user, loading: authLoading, employeeData } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const router = useRouter();
  const { progress: loadingProgress, show: showLoadingProgress } = useIllusionProgress(authLoading || isLoading);

  const [notification, setNotification] = useState<{
    message: string;
    type: 'success' | 'error' | 'info';
  } | null>(null);

  useEffect(() => {
    if (!authLoading) {
      if (!user) {
        router.push("/login");
        return;
      }
      
      const addons = employeeData?.subscription_addons || employeeData?.company?.subscription_addons || [];
      if (!addons.includes('sprintverse')) {
        router.push("/employee/welcome");
        return;
      }
      
      setIsLoading(false);
    }
  }, [authLoading, user, employeeData, router]);

  const handleNotification = (message: string, type: 'success' | 'error' | 'info') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  };

  if (isLoading || authLoading) {
    return showLoadingProgress
      ? <LoadingProgress label="Loading skill upgrades..." progress={loadingProgress} />
      : (
        <div className="flex items-center justify-center h-screen" style={{ background: '#05050a' }}>
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500" />
        </div>
      );
  }

  return (
    <div
      className="min-h-screen pb-6 selection:bg-blue-500/30 text-slate-100"
      style={{ background: '#05050a', fontFamily: "'Space Grotesk', ui-sans-serif, system-ui, sans-serif" }}
    >
      {/* ── Toast Notification ── */}
      <AnimatePresence>
        {notification && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl font-bold shadow-2xl"
            style={{
              background: notifStyles[notification.type].bg,
              border: `1px solid ${notifStyles[notification.type].border}`,
              backdropFilter: 'blur(16px)',
            }}
          >
            {notifStyles[notification.type].icon}
            <span className="text-sm">{notification.message}</span>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="max-w-5xl mx-auto px-6 py-4">
        <SkillUpgrade onNotification={handleNotification} />
      </div>
    </div>
  );
}