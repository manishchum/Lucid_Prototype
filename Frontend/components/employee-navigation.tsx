"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ChevronDown, Home, Menu, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { LayoutDashboard, BookOpen, Book, User, FileText, KeyRound, LogOut, Shield, Calendar, Users, Mail, Settings } from "lucide-react";
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
  const [isCollapsed, setIsCollapsed] = useState(true);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const [coursesOpen, setCoursesOpen] = useState(false);
  const [userRoles, setUserRoles] = useState<string[]>([]);

  // Use provided user or fetch employee data from auth context
  const displayUser = providedUser || employee;
  const handleLogout = providedOnLogout || (async () => {
    await logout();
    router.push("/");
  });

  useEffect(() => {
    // Open courses submenu when route is under /employee/courses
    if (pathname && pathname.startsWith('/employee/courses')) {
      setCoursesOpen(true);
    }

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

  // Render icons with a consistent size to keep vertical alignment stable.
  // We wrap the icon and use CSS to size any inner SVG to avoid cloning/typing issues.
  const renderIcon = (icon: any) => {
    return (
      <span className="w-5 h-5 flex items-center justify-center nav-icon">
        {icon}
      </span>
    );
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
        /* Normalize SVG icon sizing inside our nav wrappers to avoid baseline shifts */
        .nav-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 20px;   /* ensures identical optical canvas */
          height: 20px;
          flex-shrink: 0;
        }

        .nav-icon svg {
          width: 20px;
          height: 20px;
          display: block;
          margin: auto;
          vertical-align: middle;
          transform-origin: center;
        }

        /* FORCE ALL ROWS TO BE THE SAME HEIGHT */
        .nav-row {
          height: 48px !important;      /* exact consistent row height */
          min-height: 48px !important;
          align-items: center !important;
        }

        /* ICON CONTAINER FIX — ensures perfect center alignment */
        .icon-box {
          width: 40px !important;
          height: 40px !important;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
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

      {/* Single resizable sidebar to avoid remounting icons */}
      <aside className={`fixed top-0 left-0 h-screen bg-white border-r z-40 transition-all duration-300 ${isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} ${isCollapsed ? 'w-20' : 'w-72'}`}>
        <div className="flex flex-col h-full">
          {/* Top: logo + toggle */}
          <div className="flex items-center justify-between px-4 py-4 border-b">
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => router.push('/employee/welcome')}>
              <div className="w-10 h-10 bg-gradient-to-br from-violet-400 to-indigo-600 rounded-lg flex items-center justify-center text-white font-bold">L</div>
              {!isCollapsed && <div className="font-semibold text-lg text-gray-900">Lucid</div>}
            </div>

            <div className="hidden lg:flex">
              <Button variant="ghost" size="sm" onClick={toggleSidebar} className="w-8 h-8 p-0 rounded-full">
                {isCollapsed ? <ChevronRight className="w-4 h-4 text-gray-600" /> : <ChevronLeft className="w-4 h-4 text-gray-600" />}
              </Button>
            </div>
          </div>

          {/* Profile (small when collapsed, expanded when open) */}
          <div className={`flex items-center gap-3 px-4 py-4 border-b ${isCollapsed ? 'justify-center' : ''}`}>
            <div className="flex items-center gap-3 w-full">
              <Link href="/employee/account" onClick={closeMobileSidebar} className="relative inline-block">
                <div className={`rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold ${isCollapsed ? 'w-10 h-10 text-sm' : 'w-12 h-12 text-lg'}`}>
                  {displayUser?.name ? displayUser.name.split(' ').map((n:string)=>n[0]).join('') : ''}
                </div>
                <span className="absolute bottom-0 right-0 block w-3 h-3 rounded-full ring-2 ring-white bg-green-400" />
              </Link>
              {!isCollapsed && (
                <div>
                  <div className="font-semibold text-gray-900">{displayUser?.name}</div>
                  <div className="text-xs text-gray-500">{displayUser?.email || 'Employee'}</div>
                </div>
              )}
            </div>
          </div>

          {/* Menu */}
          <nav className="flex flex-col gap-1 px-2 py-6 flex-1">
            {[
              { href: '/employee/welcome', icon: <Home className="w-5 h-5" /> , label: 'Home'},
              { href: '/employee/courses', icon: <BookOpen className="w-5 h-5" /> , label: 'Learning Plan'},
              { href: '/admin/dashboard', icon: <Shield className="w-5 h-5" /> , label: 'Admin Panel', admin: true},
              { href: '/employee/score-history', icon: <FileText className="w-5 h-5" /> , label: 'Reports'},
            ].map((m) => {
              if (m.admin && !hasAdminAccess()) return null;

              // Special rendering for Courses to allow a nested submenu
              if (m.href === '/employee/courses') {
                return (
                  <div key={m.href} className="flex flex-col">
                    <div className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${isActiveRoute(m.href) ? 'text-violet-600 bg-violet-50' : 'text-gray-700 hover:bg-gray-100'}`}>
                      <Link href={m.href} onClick={closeMobileSidebar} className="flex items-center gap-3 flex-1">
                        <div className={`icon-box rounded-lg transition-colors border ${isActiveRoute(m.href) ? 'bg-violet-50 border-violet-100 text-violet-600' : 'border-transparent text-gray-500 hover:border-gray-200 hover:bg-gray-50'}`}>
                          {renderIcon(m.icon)}
                        </div>
                        {!isCollapsed && <span>{m.label}</span>}
                      </Link>

                      {!isCollapsed && (
                        <button type="button" onClick={(e) => { e.preventDefault(); setCoursesOpen(!coursesOpen); }} className="p-1">
                          <ChevronDown className={`w-4 h-4 transition-transform ${coursesOpen ? 'rotate-180' : ''}`} />
                        </button>
                      )}
                    </div>

                    {/* Submenu only visible when expanded */}
                    {!isCollapsed && coursesOpen && (
                      <div className="pl-14 pr-4 pt-2 pb-2">
                        <ul className="flex flex-col gap-2">
                          <li className="flex items-center justify-between">
                            <div className="relative flex items-center">
                              <span className={`absolute -left-6 top-2 w-2 h-2 rounded-full ${isActiveRoute('/employee/courses/active') ? 'bg-violet-500' : 'border border-gray-300 bg-transparent'}`} />
                              <Link href="/employee/courses/active" onClick={closeMobileSidebar} className="text-sm text-gray-700">Active Modules</Link>
                            </div>
                            {/* <span className="ml-2 text-xs bg-violet-50 text-violet-600 px-2 py-0.5 rounded">2</span> */}
                          </li>

                          <li className="flex items-center justify-between text-sm text-gray-700">
                            <div className="relative flex items-center">
                              <span className={`absolute -left-6 top-2 w-2 h-2 rounded-full ${isActiveRoute('/employee/courses/completed') ? 'bg-violet-500' : 'border border-gray-300 bg-transparent'}`} />
                              <Link href="/employee/courses/completed" onClick={closeMobileSidebar}>Completed</Link>
                            </div>
                            {/* <span className="ml-2 text-xs text-gray-500">4</span> */}
                          </li>

                          <li className="flex items-center justify-between text-sm text-gray-700">
                            <div className="relative flex items-center">
                              <span className={`absolute -left-6 top-2 w-2 h-2 rounded-full ${isActiveRoute('/employee/courses/all') ? 'bg-violet-500' : 'border border-gray-300 bg-transparent'}`} />
                              <Link href="/employee/courses/all" onClick={closeMobileSidebar}>All Modules</Link>
                            </div>
                            {/* <span className="ml-2 text-xs text-gray-500">56</span> */}
                          </li>
                        </ul>
                      </div>
                    )}
                  </div>
                );
              }

              return (
                <Link key={m.href} href={m.href} onClick={closeMobileSidebar} className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors ${isActiveRoute(m.href) ? 'text-violet-600 bg-violet-50' : 'text-gray-700 hover:bg-gray-100'}`}>
                    <div className={`icon-box rounded-lg transition-colors border ${isActiveRoute(m.href) ? 'bg-violet-50 border-violet-100 text-violet-600' : 'border-transparent text-gray-500 hover:border-gray-200 hover:bg-gray-50'}`}>
                    {renderIcon(m.icon)}
                  </div>
                  {!isCollapsed && <span>{m.label}</span>}
                </Link>
              );
            })}
          </nav>

          <div className="px-6 py-6 border-t">
            <button onClick={() => { handleLogout(); closeMobileSidebar(); }} className="flex items-center gap-2 text-red-600 font-semibold hover:underline">
              <LogOut className="w-5 h-5 flex-shrink-0" />
              {!isCollapsed && <span>Log Out</span>}
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
};

export default EmployeeNavigation;
