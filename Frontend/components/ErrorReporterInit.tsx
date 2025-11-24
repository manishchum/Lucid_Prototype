"use client";
import { useEffect } from 'react';
import { initClientErrorReporting } from '../lib/clientErrorReporter';
import { useAuth } from '../contexts/auth-context';

export default function ErrorReporterInit() {
  const auth = useAuth();
  useEffect(() => {
    // initialize reporter once and keep email in a small global so the reporter
    // can call the getter without being re-initialized (prevents duplicate listeners)
    // set a window-global email value and init once
    try {
      (window as any).__CURRENT_USER_EMAIL__ = auth?.user?.email || null;
      try { if (auth?.user?.email) localStorage.setItem('__CURRENT_USER_EMAIL__', auth.user.email); } catch (e) {}
    } catch (e) {}

    // init once
    initClientErrorReporting({ includeEmail: () => (typeof window !== 'undefined' ? (window as any).__CURRENT_USER_EMAIL__ : null) });
  // run only on mount; email updates are written to the window global above
  }, []);
  // update global when auth changes
  useEffect(() => {
    try {
      (window as any).__CURRENT_USER_EMAIL__ = auth?.user?.email || null;
      try { if (auth?.user?.email) localStorage.setItem('__CURRENT_USER_EMAIL__', auth.user.email); else localStorage.removeItem('__CURRENT_USER_EMAIL__'); } catch (e) {}
    } catch (e) {}
  }, [auth]);
  return null;
}
