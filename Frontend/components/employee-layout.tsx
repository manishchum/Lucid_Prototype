"use client";

import { ReactNode } from "react";

interface EmployeeLayoutProps {
  children: ReactNode;
}

export default function EmployeeLayout({ children }: EmployeeLayoutProps) {
  return (
    <div 
      className="transition-all duration-300 ease-in-out ml-0 md:ml-64 px-4 sm:px-6 md:px-8"
      style={{ 
        marginLeft: 'var(--sidebar-width, 0px)',
      }}
    >
      {children}
    </div>
  );
}