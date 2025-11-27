'use client'

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, ChevronDown, Home, Menu, X, BarChart3, Users, Upload, Building2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { LayoutDashboard, BookOpen, Book, User, FileText, KeyRound, LogOut, Shield, Calendar, Mail, Settings, Folder } from "lucide-react";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import { useState, useEffect } from "react";

interface EmployeeNavigationProps {
  showBack?: boolean;
  showForward?: boolean;
  customBackPath?: string;
  customForwardPath?: string;
  className?: string;
  user?: any;
  onLogout?: () => void;
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
  const [coursesOpen, setCoursesOpen] = useState(false);
  const [adminDropdownOpen, setAdminDropdownOpen] = useState(false);
  const [userRoles, setUserRoles] = useState<string[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);

  const displayUser = providedUser || employee;
  const handleLogout = providedOnLogout || (async () => {
    await logout();
    router.push("/");
  });

  useEffect(() => {
    if (pathname && pathname.startsWith('/employee/courses')) {
      setCoursesOpen(true);
    }

    if (pathname && pathname.startsWith("/admin/dashboard")) {
      setAdminDropdownOpen(true);
    }

    if (!providedUser && authUser?.email) {
      const fetchEmployee = async () => {
        try {
          const { data: employeeData, error } = await supabase
            .from("users")
            .select("*")
            .eq("email", authUser.email)
            .single();
            
          if (!error && employeeData) {
            setEmployee(employeeData);
            
            const { data: roleData, error: roleError } = await supabase
              .from("user_role_assignments")
              .select(`
                roles!inner(name)
              `)
              .eq("user_id", employeeData.user_id)
              .eq("is_active", true);

            if (!roleError && roleData) {
              const roles = roleData.map(assignment => assignment.roles?.name).filter(Boolean);
              setUserRoles(roles);
              setIsAdmin(roles.includes('ADMIN') || roles.includes('SUPER_ADMIN') || roles.includes('Admin'));
            }
          }
        } catch (error) {
          console.error("Failed to fetch employee data:", error);
        }
      };

      fetchEmployee();
    }
  }, [providedUser, authUser?.email, pathname]);

  const isActiveRoute = (route: string) => {
    if (route === '/employee/welcome') {
      return pathname === '/employee/welcome';
    }
    return pathname?.startsWith(route) || false;
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
      router.push("/employee/welcome");
    }
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

  const renderIcon = (icon: any) => {
    return (
      <span className="w-5 h-5 flex items-center justify-center nav-icon">
        {icon}
      </span>
    );
  };

  return (
    <div>
      <style jsx global>{`
        :root {
          --sidebar-width: ${isCollapsed ? '5rem' : '18rem'};
        }
        
        @media (max-width: 1024px) {
          :root {
            --sidebar-width: 0;
          }
        }
        
        .nav-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 20px;
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

        .nav-row {
          height: 48px !important;
          min-height: 48px !important;
          align-items: center !important;
        }

        .icon-box {
          width: 40px !important;
          height: 40px !important;
          display: flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
        }

        .admin-dropdown {
          transition: all 0.3s ease-in-out;
          overflow: hidden;
        }

        .admin-dropdown.open {
          max-height: 200px;
          opacity: 1;
        }

        .admin-dropdown.closed {
          max-height: 0;
          opacity: 0;
        }
      `}</style>
      
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

      {isMobileOpen && (
        <div 
          className="lg:hidden fixed inset-0 bg-black bg-opacity-50 z-40"
          onClick={closeMobileSidebar}
        />
      )}

      <aside className={`fixed top-0 left-0 h-screen bg-white border-r z-40 transition-all duration-300 ${isMobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} ${isCollapsed ? 'w-20' : 'w-72'}`}>
        <div className="flex flex-col h-full">
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

          <nav className="flex flex-col gap-1 px-2 py-6 flex-1">
            {[
              { href: '/employee/welcome', icon: <Home className="w-5 h-5" /> , label: 'Home'},
              { href: '/employee/training-plan', icon: <BookOpen className="w-5 h-5" /> , label: 'Learning Plan'},
              { href: '/employee/score-history', icon: <FileText className="w-5 h-5" /> , label: 'Reports'},
              
            ].map((m) => {
              if (m.admin && !isAdmin) return null;

              // Special rendering for Courses to allow a nested submenu
              if (m.href === '/employee/training-plan') {
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

                    {!isCollapsed && coursesOpen && (
                      <div className="pl-14 pr-4 pt-2 pb-2">
                        <ul className="flex flex-col gap-2">
                          <li className="flex items-center justify-between">
                            <div className="relative flex items-center">
                              <span className={`absolute left-3 top-2 w-2 h-2 rounded-full ${isActiveRoute('/employee/welcome') ? 'bg-violet-500' : 'border border-gray-300 bg-transparent'}`} />
                              <Link href="/employee/welcome" onClick={closeMobileSidebar} className="ml-8 text-sm text-gray-700">Active Modules</Link>
                            </div>
                          </li>

                          <li className="flex items-center justify-between text-sm text-gray-700">
                            <div className="relative flex items-center">
                              <span className={`absolute left-3 top-2 w-2 h-2 rounded-full ${isActiveRoute('/employee/welcome') ? 'bg-violet-500' : 'border border-gray-300 bg-transparent'}`} />
                              <Link href="/employee/welcome" onClick={closeMobileSidebar} className="ml-8">Completed</Link>
                            </div>
                          </li>

                          <li className="flex items-center justify-between text-sm text-gray-700">
                            <div className="relative flex items-center">
                              <span className={`absolute left-3 top-2 w-2 h-2 rounded-full ${isActiveRoute('/content-library') ? 'bg-violet-500' : 'border border-gray-300 bg-transparent'}`} />
                              <Link href="/content-library" onClick={closeMobileSidebar} className="ml-8">All Modules</Link>
                            </div>
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

            {isAdmin && (
              <div className="flex flex-col">
                <div
                  className={`flex items-center gap-3 px-4 py-3 rounded-lg font-medium transition-colors cursor-pointer ${
                    isActiveRoute("/admin/dashboard")
                      ? "text-blue-600 bg-blue-50"
                      : "text-gray-700 hover:bg-gray-100"
                  }`}
                  onClick={() => {
                    if (isCollapsed) {
                      router.push("/admin/dashboard/analytics");
                      closeMobileSidebar();
                    } else {
                      setAdminDropdownOpen(!adminDropdownOpen);
                    }
                  }}
                >
                  <div
                    className={`icon-box rounded-lg transition-colors border ${
                      isActiveRoute("/admin/dashboard")
                        ? "bg-blue-50 border-blue-100 text-blue-600"
                        : "border-transparent text-gray-500 hover:border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    {renderIcon(<Shield className="w-5 h-5" />)}
                  </div>
                  {!isCollapsed && (
                    <>
                      <span className="flex-1">Admin Panel</span>
                      <ChevronDown
                        className={`w-4 h-4 transition-transform ${
                          adminDropdownOpen ? "rotate-180" : ""
                        }`}
                      />
                    </>
                  )}
                </div>

                {!isCollapsed && (
                  <div
                    className={`admin-dropdown ${
                      adminDropdownOpen ? "open" : "closed"
                    } pl-14 pr-4`}
                  >
                    <div className="py-2 space-y-1">
                      {[
                        {
                          href: "/admin/dashboard/analytics",
                          icon: <BarChart3 className="w-4 h-4" />,
                          label: "Analytics & Reports",
                        },
                        {
                          href: "/admin/dashboard/employees",
                          icon: <Users className="w-4 h-4" />,
                          label: "Employee Management",
                        },
                        {
                          href: "/admin/dashboard/uploads",
                          icon: <Upload className="w-4 h-4" />,
                          label: "KPI & Content Uploads",
                        },
                      ].map((subItem) => (
                        <Link
                          key={subItem.href}
                          href={subItem.href}
                          onClick={closeMobileSidebar}
                          className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors ${
                            isActiveRoute(subItem.href)
                              ? "text-blue-600 bg-blue-50 border-r-2 border-blue-600"
                              : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                          }`}
                        >
                          <div className="relative flex items-center">
                            <span
                              className={`absolute -left-6 top-2 w-2 h-2 rounded-full ${
                                isActiveRoute(subItem.href)
                                  ? "bg-blue-500"
                                  : "border border-gray-300 bg-transparent"
                              }`}
                            />
                            <div className="flex items-center gap-2">
                              {renderIcon(subItem.icon)}
                              <span>{subItem.label}</span>
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
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
