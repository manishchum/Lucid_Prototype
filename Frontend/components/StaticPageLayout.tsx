import React from "react";
import { Card } from "@/components/ui/card";

/**
 * StaticPageLayout - Use this layout to wrap future pages for consistent look.
 * - Full-width header box
 * - Full-width content cards
 * - Responsive padding and spacing
 */
export default function StaticPageLayout({ title, subtitle, children }: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="px-4 py-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white rounded-xl shadow-sm p-8 border border-slate-200 mb-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">{title}</h1>
            {subtitle && <p className="text-slate-600">{subtitle}</p>}
          </div>
          <div className="space-y-16">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}
