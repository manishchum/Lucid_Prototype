'use client'

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import EmployeeNavigation from "@/components/employee-navigation";
import Footer from "@/components/Footer";
import { useTenant } from "@/contexts/tenant-context";

interface LayoutWithNavigationProps {
  children: React.ReactNode;
}

const LayoutWithNavigation = ({ children }: LayoutWithNavigationProps) => {
  const pathname = usePathname();
  const [sidebarWidth, setSidebarWidth] = useState('17.5rem');
  const { activeCompany } = useTenant();

  // Pages where we don't show the navigation
  // Pages where navigation SHOULD be shown
const includedPathPrefixes = [
  "/employee/welcome",
  "/employee/training-plan",
  "/employee/module",
  "/employee/quiz",
  "/employee/score-history",
  "/admin/content-library",
  "/employee/skill-upgrade",
  "/employee/roleplay",
  "/admin/dashboard/analytics",
  "/admin/dashboard/company-access",
  "/task-manager",
  "/admin/dashboard/employees",
  "/admin/dashboard/uploads",
  "/admin/dashboard/human-in-the-loop",
  "/admin/career-journeys",
  "/admin/dashboard/dispatch-center",
  "/kpi/intelligence",
  "/kpi/configuration",
  "/kpi/turbocharge",
  "/kpi/workforce-overview",
  "/employee/account",
  "/employee/assessment"
];

// Only show navigation for these route groups
const shouldShowNavigation =
  !!pathname &&
  includedPathPrefixes.some(
    (prefix) =>
      pathname === prefix || pathname.startsWith(`${prefix}/`)
  );

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
    return (
      <div className="flex flex-col min-h-screen">
        <div className="flex-1">
          {children}
        </div>
        <Footer />
      </div>
    );
  }

  const companyDisplayName = activeCompany?.name || 'Company';
  const companyLogo = activeCompany?.company_logo;

  return (
    <div className="flex flex-col min-h-screen">
      <EmployeeNavigation />
      {/* <div className="fixed top-4 right-4 z-40 pointer-events-none">
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
      </div> */}
      <div 
        className="flex-1 transition-all duration-300 ease-in-out md:ml-[var(--sidebar-width)]"
      >
        {children}
      </div>
      <Footer />
    </div>
  );
};

export default LayoutWithNavigation;
