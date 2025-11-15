"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Home, Menu, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { LayoutDashboard, BookOpen, User, FileText, KeyRound, LogOut, Shield } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import { useState, useEffect } from "react";

interface EmployeeNavigationProps {
  showBack?: boolean;
  showForward?: boolean;
  customBackPath?: string;
  customForwardPath?: string;
  className?: string;
  user?: any;  // Optional - if not provided, will fetch from auth context
  onLogout?: () => void;  // Optional - if not provided, will use default logout
}

const EmployeeNavigation = ({ 
  showBack = true, 
  showForward = true,
  customBackPath,
  customForwardPath,
  className = "",
  user: providedUser,
  onLogout: providedOnLogout
}: EmployeeNavigationProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const { user: authUser, logout } = useAuth();
  const [employee, setEmployee] = useState<any>(null);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [userRoles, setUserRoles] = useState<string[]>([]);

  // Use provided user or fetch employee data from auth context
  const displayUser = providedUser || employee;
  const handleLogout = providedOnLogout || (async () => {
    await logout();
    router.push("/");
  });

  useEffect(() => {
    // If user is not provided as prop, fetch employee data
    if (!providedUser && authUser?.email) {
      const fetchEmployee = async () => {
        try {
          const { data: employeeData, error } = await supabase
            .from("users")
            .select("*")
            .eq("email", authUser.email)
            .single();
            
            console.log("Outside the employee Data")
          if (!error && employeeData) {
            console.log("Not getting inside the employee Data")
            setEmployee(employeeData);
            
            // Fetch user roles
            const { data: roleData, error: roleError } = await supabase
              .from("user_role_assignments")
              .select(`
                roles!inner(name)
              `)
              .eq("user_id", employeeData.user_id)
              .eq("is_active", true);

            if (!roleError && roleData) {
              // @ts-ignore
              const roles = roleData.map(assignment => assignment.roles?.name).filter(Boolean);
              console.log("These are the roles assigned to the user:");
              console.log(roles);
              setUserRoles(roles);
            }
          }
        } catch (error) {
          console.error("Failed to fetch employee data:", error);
        }
      };

      fetchEmployee();
    }
  }, [providedUser, authUser?.email]);

  // Helper function to check if a route is active
  const isActiveRoute = (route: string) => {
    if (route === '/employee/welcome') {
      return pathname === '/employee/welcome';
    }
    return pathname.startsWith(route);
  };

  // Check if user has admin access
  const hasAdminAccess = () => {
    return userRoles.some(role => 
      role === 'ADMIN' || role === 'SUPER_ADMIN'
    );
  };

  const handleBack = () => {
    if (customBackPath) {
      router.push(customBackPath);
    } else {
      router.back();
    }
  };

  const handleForward = () => {
    if (customForwardPath) {
      router.push(customForwardPath);
    } else {
      // Default forward behavior - could be customized per page
      router.push("/employee/welcome");
    }
  };

  const handleHome = () => {
    router.push("/employee/welcome");
  };

  const toggleSidebar = () => {
    setIsCollapsed(!isCollapsed);
  };

  const toggleMobileSidebar = () => {
    setIsMobileOpen(!isMobileOpen);
  };

  const closeMobileSidebar = () => {
    setIsMobileOpen(false);
  };

  return (
    <div>
      {/* Set CSS custom property for sidebar width */}
      <style jsx global>{`
        :root {
          --sidebar-width: ${isCollapsed ? '5rem' : '18rem'};
        }
        
        @media (max-width: 1024px) {
          :root {
            --sidebar-width: 0;
          }
        }
      `}</style>
      
      {/* Mobile Hamburger Button */}
      <div className="lg:hidden fixed top-4 left-4 z-50">
        <Button
          variant="outline"
          size="sm"
          onClick={toggleMobileSidebar}
          className="bg-white shadow-lg border-2 hover:shadow-xl transition-shadow w-10 h-10 p-0 rounded-lg"
        >
          {isMobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </Button>
      </div>

      {/* Mobile Overlay */}
      {isMobileOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-40"
          onClick={closeMobileSidebar}
        />
      )}

      {/* Top Navigation Bar - Commented Out */}
      {/*
      <Card className={`p-3 mb-4 ${className}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {showBack && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleBack}
                className="flex items-center gap-2"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={handleHome}
            className="flex items-center gap-2"
          >
            <Home className="h-4 w-4" />
            Dashboard
          </Button>

          <div className="flex items-center gap-2">
            {showForward && customForwardPath && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleForward}
                className="flex items-center gap-2"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            )}
          </div>
        </div>
      </Card>
      */}

      {/* Sidebar Navigation */}
      <aside className={`
        fixed top-0 left-0 h-screen bg-white border-r flex flex-col transition-all duration-300 z-40
        ${isCollapsed ? 'w-20' : 'w-72'}
        ${isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Logo and Toggle */}
        <div className="flex items-center justify-between px-6 py-6 border-b">
          <div
            className={`flex items-center gap-3 cursor-pointer ${isCollapsed ? 'justify-center' : ''}`}
            onClick={() => router.push('/employee/welcome')}
          >
            <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-xl">L</span>
            </div>
            {!isCollapsed && (
              <span className="font-semibold text-lg text-gray-900">Lucid</span>
            )}
          </div>
          
          {/* Desktop Toggle Button */}
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleSidebar}
            className={`hidden lg:flex ${isCollapsed ? 'absolute -right-3 top-6 bg-white border shadow-md rounded-full w-6 h-6 p-0' : ''}`}
          >
            {isCollapsed ? (
              <ChevronRight className="h-3 w-3" />
            ) : (
              <ChevronLeft className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Profile */}
        <div className={`flex items-center gap-3 px-6 py-6 border-b ${isCollapsed ? 'justify-center' : ''}`}>
          <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold text-lg flex-shrink-0">
            {displayUser?.name ? displayUser.name.split(" ").map((n: string) => n[0]).join("") : ""}
          </div>
          {!isCollapsed && (
            <div>
              <div className="font-semibold text-gray-900">{displayUser?.name}</div>
              <div className="text-xs text-gray-500">Employee</div>
            </div>
          )}
        </div>

        {/* Menu */}
        <nav className="flex flex-col gap-1 px-2 py-6 flex-1">
          {/* Phase 1 (Learning Style Only): Only dashboard link visible */}
          <Link 
            href="/employee/welcome" 
            onClick={closeMobileSidebar}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${
              isActiveRoute('/employee/welcome') 
                ? 'text-blue-600 bg-blue-100' 
                : 'text-gray-700 hover:bg-gray-100'
            } ${isCollapsed ? 'justify-center' : ''}`}
            title={isCollapsed ? 'Dashboard' : ''}
          >
            <LayoutDashboard className="w-5 h-5 flex-shrink-0" />
            {!isCollapsed && <span>Dashboard</span>}
          </Link>

          {/* Admin Panel - Only visible to admins */}
          {hasAdminAccess() && (
            <Link 
              href="/admin/dashboard" 
              onClick={closeMobileSidebar}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${
                isActiveRoute('/admin/dashboard') 
                  ? 'text-blue-600 bg-blue-100' 
                  : 'text-gray-700 hover:bg-gray-100'
              } ${isCollapsed ? 'justify-center' : ''}`}
              title={isCollapsed ? 'Admin Panel' : ''}
            >
              <Shield className="w-5 h-5 flex-shrink-0" />
              {!isCollapsed && <span>Admin Panel</span>}
            </Link>
          )}

          {/* Baseline Assessment (Phase 2) */}
          {/*}
          <Link
            href="/employee/assessment"
            onClick={closeMobileSidebar}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${
              isActiveRoute('/employee/assessment')
                ? 'text-blue-600 bg-blue-100'
                : 'text-gray-700 hover:bg-gray-100'
            } ${isCollapsed ? 'justify-center' : ''}`}
            title={isCollapsed ? 'Baseline' : ''}
          >
            <FileText className="w-5 h-5 flex-shrink-0" />
            {!isCollapsed && <span>Baseline Assessment</span>}
          </Link>
            */}
          <Link 
            href="/employee/score-history" 
            onClick={closeMobileSidebar}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${
              isActiveRoute('/employee/score-history') 
                ? 'text-blue-600 bg-blue-100' 
                : 'text-gray-700 hover:bg-gray-100'
            } ${isCollapsed ? 'justify-center' : ''}`}
            title={isCollapsed ? 'Reports' : ''}
          >
            <FileText className="w-5 h-5 flex-shrink-0" />
            {!isCollapsed && <span>Reports</span>}
          </Link>

          {/* Phase 3 (Enable with learning plan rollout)
          <Link 
            href="/employee/training-plan" 
            onClick={closeMobileSidebar}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${
              isActiveRoute('/employee/training-plan') 
                ? 'text-blue-600 bg-blue-100' 
                : 'text-gray-700 hover:bg-gray-100'
            } ${isCollapsed ? 'justify-center' : ''}`}
            title={isCollapsed ? 'My Learning Plan' : ''}
          >
            <BookOpen className="w-5 h-5 flex-shrink-0" />
            {!isCollapsed && <span>My Learning Plan</span>}
          </Link>
          */}
          
          <Link 
            href="/employee/account" 
            onClick={closeMobileSidebar}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${
              isActiveRoute('/employee/account') 
                ? 'text-blue-600 bg-blue-100' 
                : 'text-gray-700 hover:bg-gray-100'
            } ${isCollapsed ? 'justify-center' : ''}`}
            title={isCollapsed ? 'My Profile' : ''}
          >
            <User className="w-5 h-5 flex-shrink-0" />
            {!isCollapsed && <span>My Profile</span>}
          </Link>

        </nav>

        {/* Logout */}
        <div className={`px-6 py-6 border-t ${isCollapsed ? 'px-2' : ''}`}>
          <button
            onClick={() => {
              handleLogout();
              closeMobileSidebar();
            }}
            className={`flex items-center gap-2 text-red-600 font-semibold hover:underline transition-colors w-full ${
              isCollapsed ? 'justify-center px-4 py-2' : ''
            }`}
            title={isCollapsed ? 'Log Out' : ''}
          >
            <LogOut className="w-5 h-5 flex-shrink-0" />
            {!isCollapsed && <span>Log Out</span>}
          </button>
        </div>
      </aside>
    </div>
  );
};

export default EmployeeNavigation;
