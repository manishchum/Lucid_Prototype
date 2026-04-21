'use client'

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import EmployeeNavigation from "@/components/employee-navigation";
import { useTenant } from "@/contexts/tenant-context";

interface LayoutWithNavigationProps {
  children: React.ReactNode;
}

const LayoutWithNavigation = ({ children }: LayoutWithNavigationProps) => {
  const pathname = usePathname();
  const [sidebarWidth, setSidebarWidth] = useState('17.5rem');
  const { activeCompany } = useTenant();

  // Pages where we don't show the navigation
  const excludedPaths = [
    '/',
    '/onboarding',
    '/career-progression',
    '/mobile-learning',
    '/communication',
    '/privacy-policy',
    '/login',
    '/signup',
    '/auth/login',
    '/auth/signup',
    '/auth/reset-password',
    '/auth/forgot-password',
    '/unsubscribe-success',
    '/unsubscribe-error'
  ];

  const shouldShowNavigation = !excludedPaths.includes(pathname || '');

  // Update sidebar width from CSS variable
  useEffect(() => {
    if (!shouldShowNavigation) return;
    
    const updateWidth = () => {
      const width = getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width');
      if (width) setSidebarWidth(width.trim());
    };

    // Initial update
    updateWidth();

    // Listen for changes (in case sidebar collapses/expands)
    const observer = new MutationObserver(updateWidth);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['style']
    });

    return () => observer.disconnect();
  }, [shouldShowNavigation]);

  if (!shouldShowNavigation) {
    return <>{children}</>;
  }

  const companyDisplayName = activeCompany?.name || 'Company';
  const companyLogo = activeCompany?.company_logo;

  return (
    <>
      <EmployeeNavigation />
      <div className="fixed top-4 right-4 z-40 pointer-events-none">
        <div className="bg-white/95 backdrop-blur border border-slate-200 shadow-sm rounded-xl px-3 py-2 flex items-center gap-2 max-w-[260px]">
          {companyLogo ? (
            <img
              src={companyLogo}
              alt={`${companyDisplayName} logo`}
              className="h-8 w-8 shrink-0 object-contain rounded-md bg-white"
            />
          ) : (
            <div className="h-8 w-8 shrink-0 rounded-md bg-slate-100 flex items-center justify-center text-[10px] font-bold text-slate-600">
              {companyDisplayName.slice(0, 2).toUpperCase()}
            </div>
          )}
          <span className="min-w-0 text-xs font-semibold text-slate-700 truncate">{companyDisplayName}</span>
        </div>
      </div>
      <div 
        className="transition-all duration-300 ease-in-out md:ml-[var(--sidebar-width)]"
        style={{ 
          minHeight: '100vh'
        }}
      >
        {children}
      </div>
      <footer className="fixed bottom-3 right-4 z-30 pointer-events-none">
        <div className="text-[11px] font-semibold text-slate-600 bg-white/90 border border-slate-200 px-3 py-1.5 rounded-full shadow-sm">
          Powered by Lucid
        </div>
      </footer>
    </>
  );
};

export default LayoutWithNavigation;
