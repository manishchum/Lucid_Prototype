"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Home } from "lucide-react";
import { Card } from "@/components/ui/card";
import { LayoutDashboard, BookOpen, User, FileText, KeyRound, LogOut } from "lucide-react";
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
            .from("employees")
            .select("*")
            .eq("email", authUser.email)
            .single();

          if (!error && employeeData) {
            setEmployee(employeeData);
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

  return (
    <div>
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
      <aside className="fixed top-0 left-0 h-screen w-72 bg-white border-r flex flex-col">
        {/* Logo */}
        <div
          className="flex items-center gap-3 px-6 py-6 border-b cursor-pointer"
          onClick={() => router.push('/employee/welcome')}
        >
          <div className="w-10 h-10 bg-blue-600 rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-xl">L</span>
          </div>
          <span className="font-semibold text-lg text-gray-900">Lucid</span>
        </div>
        {/* Profile */}
        <div className="flex items-center gap-3 px-6 py-6 border-b">
          <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center text-blue-700 font-bold text-lg">
            {displayUser?.name ? displayUser.name.split(" ").map((n: string) => n[0]).join("") : ""}
          </div>
          <div>
            <div className="font-semibold text-gray-900">{displayUser?.name}</div>
            <div className="text-xs text-gray-500">Employee</div>
          </div>
        </div>
        {/* Menu */}
        <nav className="flex flex-col gap-1 px-2 py-6 flex-1">
          <Link 
            href="/employee/welcome" 
            className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium ${
              isActiveRoute('/employee/welcome') 
                ? 'text-blue-600 bg-blue-100' 
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <LayoutDashboard className="w-5 h-5" />
            Dashboard
          </Link>
          <Link 
            href="/employee/training-plan" 
            className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium ${
              isActiveRoute('/employee/training-plan') 
                ? 'text-blue-600 bg-blue-100' 
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <BookOpen className="w-5 h-5" />
            My Learning Plan
          </Link>
          <Link 
            href="/employee/account" 
            className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium ${
              isActiveRoute('/employee/account') 
                ? 'text-blue-600 bg-blue-100' 
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <User className="w-5 h-5" />
            My Profile
          </Link>
          <Link 
            href="/employee/score-history" 
            className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium ${
              isActiveRoute('/employee/score-history') 
                ? 'text-blue-600 bg-blue-100' 
                : 'text-gray-700 hover:bg-gray-100'
            }`}
          >
            <FileText className="w-5 h-5" />
            Reports
          </Link>
          {/* <Link href="/employee/change-password" className="flex items-center gap-3 px-4 py-3 rounded-lg font-medium text-gray-700 hover:bg-gray-100">
            <KeyRound className="w-5 h-5" />
            Change Password
          </Link> */}
        </nav>
        {/* Logout */}
        <div className="px-6 py-6 border-t">
          <button
            onClick={() => {
                        handleLogout()
                      }}
            className="flex items-center gap-2 text-red-600 font-semibold hover:underline"
          >
            <LogOut className="w-5 h-5" />
            Log Out
          </button>
        </div>
      </aside>
    </div>
  );
};

export default EmployeeNavigation;
