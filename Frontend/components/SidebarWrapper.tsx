"use client";

import { usePathname } from "next/navigation";
import EmployeeNavigation from "@/components/employee-navigation";

export default function SidebarWrapper({ children }: { children: React.ReactNode }) {
    const pathname = usePathname();

    // Hide sidebar on landing, login, and signup pages
    const isAuthPage = pathname === "/" || pathname === "/login" || pathname === "/signup";

    return (
        <>
            {!isAuthPage && <EmployeeNavigation />}
            <div
                className={`relative transition-all duration-300 ease-in-out ${!isAuthPage ? 'min-h-screen' : ''}`}
                style={{
                    marginLeft: !isAuthPage ? 'var(--sidebar-width, 0px)' : '0px'
                }}
            >
                {children}
            </div>
        </>
    );
}
