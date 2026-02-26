'use client'

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ChevronDown, Home, Menu, X, BarChart3, Users, Upload, Building2, PlayCircle, CheckCircle2, ListChecks, TrendingUp, Settings as SettingsIcon, Zap, UsersRound, LayoutGrid, Play, Check, List, ClipboardCheck, Bell } from "lucide-react";
import { Card } from "@/components/ui/card";
import { LayoutDashboard, BookOpen, Book, User, FileText, KeyRound, LogOut, Shield, Calendar, Mail, Settings, Folder } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";

interface EmployeeNavigationProps {
  showBack?: boolean;
  showForward?: boolean;
  customBackPath?: string;
  customForwardPath?: string;
  className?: string;
  user?: any;
  onLogout?: () => void;
  forceCollapsed?: boolean;
}

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;



const EmployeeNavigation = ({
  user: providedUser,
  onLogout: providedOnLogout,
  forceCollapsed = false
}: EmployeeNavigationProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const { user: authUser, logout, internalUser, isAdmin } = useAuth();

  // Existing Logic States
  const [isCollapsed, setIsCollapsed] = useState(forceCollapsed);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [coursesOpen, setCoursesOpen] = useState(false);
  const [adminDropdownOpen, setAdminDropdownOpen] = useState(false);
  const [kpiDropdownOpen, setKpiDropdownOpen] = useState(false);

  const [showReportToast, setShowReportToast] = useState(false);

  const displayUser = providedUser || internalUser;

  // Update isCollapsed when forceCollapsed prop changes
  useEffect(() => {
    if (forceCollapsed !== undefined) {
      setIsCollapsed(forceCollapsed);
    }
  }, [forceCollapsed]);

  // Existing Logout Logic
  const handleLogout = providedOnLogout || (async () => {
    await logout();
    router.push("/");
  });

  // Existing Data Fetching Logic
  // Dropdown Auto-open logic
  useEffect(() => {
    if (pathname && pathname.startsWith('/employee/courses')) {
      setCoursesOpen(true);
    }
    if (pathname && pathname.startsWith("/admin/dashboard")) {
      setAdminDropdownOpen(true);
    }

    if (pathname && pathname.startsWith("/kpi")) {
      setKpiDropdownOpen(true);
    }
  }, [pathname]);



  // Read one-shot toast flag set when an assessment/quiz result is shown
  useEffect(() => {
    try {
      const v = sessionStorage.getItem('show_report_toast');
      if (v === '1') {
        setShowReportToast(true);
        // remove the flag so it doesn't show repeatedly
        sessionStorage.removeItem('show_report_toast');
        // auto-hide after a few seconds
        const t = setTimeout(() => setShowReportToast(false), 6000);
        return () => clearTimeout(t);
      }
    } catch (e) {
      // ignore (SSR or privacy)
    }
  }, [pathname]);

  // Sync Side-bar Width CSS Variable
  useEffect(() => {
    try {
      document.documentElement.style.setProperty('--sidebar-width', isCollapsed ? '5rem' : '17.5rem');
    } catch (e) { }
    return () => {
      try { document.documentElement.style.removeProperty('--sidebar-width'); } catch (e) { }
    };
  }, [isCollapsed]);

  const isActive = (path: string) => pathname === path;

  const handleNavigate = (href: string) => {
    setIsMobileOpen(false);
    router.push(href);
  };

  // UI Component: Tooltip for collapsed state
  const NavTooltip = ({ label }: { label: string }) => (
    <div className="absolute left-full ml-2 px-2.5 py-1.5 bg-slate-900 text-white text-xs font-medium rounded-md opacity-0 invisible group-hover:opacity-100 group-hover:visible pointer-events-none transition-all duration-200 z-[9999] whitespace-nowrap shadow-lg top-1/2 -translate-y-1/2">
      {label}
    </div>
  );

  return (
    <>


      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div className="lg:hidden fixed inset-0 bg-black/40 backdrop-blur-sm z-[45]" onClick={() => setIsMobileOpen(false)} />
      )}

      {/* Mobile Toggle */}
      <div className="lg:hidden fixed top-4 left-4 z-50">
        <Button variant="outline" size="sm" onClick={() => setIsMobileOpen(!isMobileOpen)} className="bg-white shadow-md border-slate-200 w-10 h-10 p-0 rounded-lg">
          {isMobileOpen ? <X size={20} /> : <Menu size={20} />}
        </Button>
      </div>

      <aside className={`fixed top-0 left-0 h-screen bg-white border-r border-slate-100 z-50 transition-all duration-300 ease-in-out flex flex-col overflow-visible
        ${isMobileOpen ? 'translate-x-0 w-[280px]' : '-translate-x-full lg:translate-x-0'} 
        ${isCollapsed ? 'lg:w-20' : 'lg:w-[280px]'}`}>

        {/* Header */}
        <div className="p-6 pb-4 flex items-center justify-between">
          <div className="flex items-center gap-3 cursor-pointer" onClick={() => handleNavigate('/employee/welcome')}>
            <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center shrink-0 shadow-sm">
              <svg className="w-5 h-5 text-[#3B66F5]" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="6" y="4" width="3" height="14" fill="#3B66F5" rx="0.5" />
                <rect x="6" y="15" width="9" height="3" fill="#3B66F5" rx="0.5" />
              </svg>
            </div>
            {!isCollapsed && <span className="text-[21px] font-bold text-[#1E293B] tracking-tight">Lucid</span>}
          </div>
          <button onClick={() => setIsCollapsed(!isCollapsed)} className="hidden lg:block text-slate-400 hover:text-slate-600 transition-colors">
            {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        {/* Profile */}
        {!isCollapsed && (
          <div className="px-4 mb-4">
            <div className="flex items-center gap-3 p-3.5 rounded-[18px] border border-slate-50 bg-white shadow-[0_2px_10px_rgba(0,0,0,0.02)]">
              <div className="w-10 h-10 rounded-full bg-[#E0E9FF] flex items-center justify-center text-[#3B66F5] font-bold text-sm relative shrink-0">
                {displayUser?.name ? displayUser.name.split(' ').map((n: any) => n[0]).join('').toUpperCase() : 'U'}
                <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-[#4ADE80] border-2 border-white rounded-full"></div>
              </div>
              <div className="overflow-hidden">
                <p className="text-[14px] font-bold text-[#1E293B] leading-tight truncate">{displayUser?.name || 'User'}</p>
                <p className="text-[11px] text-slate-500 truncate font-medium mt-0.5">{displayUser?.email}</p>
              </div>
            </div>
          </div>
        )}

        <nav className="flex-1 px-3 overflow-y-visible overflow-x-visible space-y-1 custom-scrollbar pt-2">
          {/* Home */}
          <div className="relative group">
            <button
              onClick={() => handleNavigate('/employee/welcome')}
              className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-[12px] transition-all duration-200 ${isActive('/employee/welcome') ? 'bg-[#F5F8FF] text-[#3B66F5] font-bold' : 'text-[#1E293B] hover:bg-slate-50'}`}
            >
              <LayoutGrid size={20} className="shrink-0" />
              {!isCollapsed && <span className="text-[15px] font-bold">Home</span>}
            </button>
            {isCollapsed && <NavTooltip label="Home" />}
          </div>

          {/* Training Plan (Dropdown) */}
          <div className="relative group">
            <button
              onClick={() => isCollapsed ? handleNavigate('/employee/welcome') : setCoursesOpen(!coursesOpen)}
              className={`w-full flex items-center justify-between px-4 py-2.5 rounded-[12px] transition-all duration-200 text-[#1E293B] hover:bg-slate-50`}
            >
              <div className="flex items-center gap-3.5">
                <BookOpen size={20} className="shrink-0" />
                {!isCollapsed && <span className="text-[15px] font-bold">Performance Sprint</span>}
              </div>
              {!isCollapsed && <ChevronDown size={14} className={`text-slate-400 transition-transform duration-300 ${coursesOpen ? '' : '-rotate-90'}`} />}
            </button>
            {isCollapsed && <NavTooltip label="Performance Sprint" />}

            {coursesOpen && !isCollapsed && (
              <div className="ml-9 mt-1 space-y-0.5 border-l border-slate-100 pl-1">
                {[
                  { href: '/employee/welcome', label: 'In Progress', icon: Play },
                  { href: '/employee/welcome', label: 'Completed', icon: Check },
                  { href: '/content-library', label: 'All Sprints', icon: List }
                ].map((item) => (
                  <button
                    key={item.label}
                    onClick={() => handleNavigate(item.href)}
                    className={`w-full flex items-center gap-3.5 py-2 px-2.5 rounded-lg transition-all duration-200 text-[14px] ${isActive(item.href) ? 'bg-[#F5F8FF] text-[#3B66F5] font-bold' : 'text-[#64748B] hover:text-[#1E293B] hover:bg-slate-50'}`}
                  >
                    <item.icon size={18} className="shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Reports */}
          <div className="relative group">
            <button
              onClick={() => handleNavigate('/employee/score-history')}
              className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-[12px] transition-all duration-200 ${isActive('/employee/score-history') ? 'bg-[#F5F8FF] text-[#3B66F5] font-bold' : 'text-[#1E293B] hover:bg-slate-50'}`}
            >
              <FileText size={20} className="shrink-0" />
              {!isCollapsed && <span className="text-[15px] font-bold">Reports</span>}
            </button>
            {isCollapsed && <NavTooltip label="Reports" />}
            {/* One-shot toast shown to the right of Reports when an assessment/quiz result was just produced */}
            {!isCollapsed && showReportToast && (
              <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 z-[60]">
                <div
                  className="flex items-center gap-3 bg-[#111827] text-white text-sm font-medium px-3 py-2 rounded-lg shadow-lg cursor-pointer select-none"
                  onClick={() => { setShowReportToast(false); handleNavigate('/employee/score-history'); }}
                >
                  <span>Click for detailed report</span>
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
              </div>
            )}
          </div>

          <div className="relative group">
            <button
              onClick={() => handleNavigate('/employee/roleplay')}
              className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-[12px] transition-all duration-200 ${isActive('/employee/roleplay') ? 'bg-[#F5F8FF] text-[#3B66F5] font-bold' : 'text-[#1E293B] hover:bg-slate-50'}`}
            >
              <UsersRound size={20} className="shrink-0" />
              {!isCollapsed && <span className="text-[15px] font-bold">Role-Play</span>}
            </button>
            {isCollapsed && <NavTooltip label="Role-Play" />}
          </div>
          {/* Console */}
          {isAdmin && (
            <>

              <div className="relative group">
                <button
                  onClick={() => isCollapsed ? handleNavigate('/admin/dashboard/analytics') : setAdminDropdownOpen(!adminDropdownOpen)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-[#1E293B] hover:bg-slate-50 rounded-[12px] transition-all"
                >
                  <div className="flex items-center gap-3.5">
                    <Shield size={20} className="shrink-0" />
                    {!isCollapsed && <span className="text-[15px] font-bold">Console</span>}
                  </div>
                  {!isCollapsed && <ChevronDown size={14} className={`text-slate-400 transition-transform duration-300 ${adminDropdownOpen ? '' : '-rotate-90'}`} />}
                </button>
                {isCollapsed && <NavTooltip label="Console" />}
                {adminDropdownOpen && !isCollapsed && (
                  <div className="ml-9 mt-1 space-y-0.5 border-l border-slate-100 pl-1">
                    {[
                      { href: "/admin/dashboard/analytics", label: "Analytics", icon: BarChart3 },
                      { href: "/admin/dashboard/employees", label: "Employees", icon: Users },
                      { href: "/admin/dashboard/uploads", label: "Uploads", icon: Upload },
                      { href: "/admin/dashboard/human-in-the-loop", label: "Expert in the Loop", icon: ClipboardCheck },
                    ].map((item) => (
                      <Link
                        key={item.label}
                        href={item.href}
                        className={`w-full flex items-center gap-3.5 py-2 px-2.5 rounded-lg transition-all duration-200 text-[14px] ${isActive(item.href) ? 'bg-[#F5F8FF] text-[#3B66F5] font-bold' : 'text-[#64748B] hover:text-[#1E293B] hover:bg-slate-50'}`}
                        onClick={() => setIsMobileOpen(false)}
                      >
                        <item.icon size={18} className="shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    ))}
                    {/* Notify Button */}
                    <button
                        onClick={() => handleNavigate('/admin/dashboard/dispatch-center')}
                        className={`w-full flex items-center gap-3.5 py-2 px-2.5 rounded-lg transition-all duration-200 text-[14px] ${isActive('/admin/dashboard/dispatch-center') ? 'bg-[#F5F8FF] text-[#3B66F5] font-bold' : 'text-[#64748B] hover:text-[#1E293B] hover:bg-slate-50'} relative`}
                    >
                      <Bell size={18} className="shrink-0" />
                      <span className="truncate">Notify</span>
                      {/* Notification badge */}
                      <div className="absolute top-2 left-2 w-2 h-2 bg-red-500 rounded-full ring-2 ring-white"></div>
                    </button>
                  </div>
                )}

              </div>

              {/* KPI Panel */}
              <div className="relative group">
                <button
                  onClick={() => isCollapsed ? handleNavigate('/kpi/intelligence') : setKpiDropdownOpen(!kpiDropdownOpen)}
                  className="w-full flex items-center justify-between px-4 py-2.5 text-[#1E293B] hover:bg-slate-50 rounded-[12px] transition-all"
                >
                  <div className="flex items-center gap-3.5">
                    <TrendingUp size={20} className="shrink-0" />
                    {!isCollapsed && <span className="text-[15px] font-bold">KPI</span>}
                  </div>
                  {!isCollapsed && <ChevronDown size={14} className={`text-slate-400 transition-transform duration-300 ${kpiDropdownOpen ? '' : '-rotate-90'}`} />}
                </button>
                {isCollapsed && <NavTooltip label="KPI" />}
                {kpiDropdownOpen && !isCollapsed && (
                  <div className="ml-9 mt-1 space-y-0.5 border-l border-slate-100 pl-1">
                    {[
                      { href: "/kpi/intelligence", label: "KPI Intelligence", icon: TrendingUp },
                      { href: "/kpi/configuration", label: "KPI Configuration", icon: SettingsIcon },
                      { href: "/kpi/turbocharge", label: "KPI TurboCharge", icon: Zap },
                      { href: "/kpi/workforce-overview", label: "Workforce Overview", icon: UsersRound },
                    ].map((item) => (
                      <Link
                        key={item.label}
                        href={item.href}
                        className={`w-full flex items-center gap-3.5 py-2 px-2.5 rounded-lg transition-all duration-200 text-[14px] ${isActive(item.href) ? 'bg-[#F5F8FF] text-[#3B66F5] font-bold' : 'text-[#64748B] hover:text-[#1E293B] hover:bg-slate-50'}`}
                        onClick={() => setIsMobileOpen(false)}
                      >
                        <item.icon size={18} className="shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          <div className="relative group">
            <button
              onClick={() => handleNavigate('/employee/account')}
              className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-[12px] transition-all duration-200 ${isActive('/employee/account') ? 'bg-[#F5F8FF] text-[#3B66F5] font-bold' : 'text-[#1E293B] hover:bg-slate-50'}`}
            >
              <UsersRound size={20} className="shrink-0" />
              {!isCollapsed && <span className="text-[15px] font-bold">Profile</span>}
            </button>
            {isCollapsed && <NavTooltip label="Profile" />}
          </div>
        </nav>


        {/* Logout */}
        <div className="p-4 border-t border-slate-50 mt-auto">
          <button onClick={handleLogout} className="relative group w-full flex items-center gap-3.5 px-4 py-3 text-[#EF4444] font-bold text-[15px] hover:bg-red-50 rounded-xl transition-all duration-200">
            <LogOut size={20} className="shrink-0 group-hover:translate-x-0.5 transition-transform" />
            {!isCollapsed && <span>Log Out</span>}
            {isCollapsed && (
              <div className="absolute left-full ml-2 px-2.5 py-1.5 bg-red-600 text-white text-xs font-medium rounded-md opacity-0 invisible group-hover:opacity-100 group-hover:visible pointer-events-none transition-all duration-200 z-[9999] whitespace-nowrap shadow-lg top-1/2 -translate-y-1/2">
                Log Out
              </div>
            )}
          </button>
        </div>
      </aside>
    </>
  );
};

export default EmployeeNavigation;