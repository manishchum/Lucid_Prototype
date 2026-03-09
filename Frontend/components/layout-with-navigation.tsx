'use client'

import React, { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import EmployeeNavigation from "@/components/employee-navigation";

interface LayoutWithNavigationProps {
  children: React.ReactNode;
}

const LayoutWithNavigation = ({ children }: LayoutWithNavigationProps) => {
  const pathname = usePathname();
  const [sidebarWidth, setSidebarWidth] = useState('17.5rem');

  // Pages where we don't show the navigation
  const excludedPaths = [
    '/',
    '/login',
    '/signup',
    '/auth/login',
    '/auth/signup',
    '/auth/reset-password',
    '/auth/forgot-password'
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

  return (
    <>
      <EmployeeNavigation />
      <div 
        className="transition-all duration-300 ease-in-out"
        style={{ 
          marginLeft: sidebarWidth,
          minHeight: '100vh'
        }}
      >
        {children}
      </div>
    </>
  );
};

export default LayoutWithNavigation;
