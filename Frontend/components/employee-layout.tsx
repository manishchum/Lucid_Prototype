"use client";

import { ReactNode } from "react";

interface EmployeeLayoutProps {
  children: ReactNode;
}

export default function EmployeeLayout({ children }: EmployeeLayoutProps) {
  return (
    <div 
      className="transition-all duration-300 ease-in-out"
      style={{ 
        marginLeft: 'var(--sidebar-width, 0px)',
      }}
    >
      {children}
    </div>
  );
}