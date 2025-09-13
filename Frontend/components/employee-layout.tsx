"use client";

import { useSidebar } from "@/contexts/sidebar-context";
import { ReactNode } from "react";

interface EmployeeLayoutProps {
  children: ReactNode;
}

export default function EmployeeLayout({ children }: EmployeeLayoutProps) {
  const { isCollapsed } = useSidebar();

  return (
    <div className={`transition-all duration-300 ${
      isCollapsed 
        ? 'lg:ml-20' // Collapsed sidebar width
        : 'lg:ml-72' // Full sidebar width  
    }`}>
      {children}
    </div>
  );
}