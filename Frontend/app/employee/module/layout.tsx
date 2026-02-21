"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/contexts/auth-context";
import ModuleSideNav from "./[module_id]/ModuleSideNav";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

const fetchUserByEmail = async (email: string) => {
    try {
        const res = await fetch(`${API_BASE}/api/users/by-email/${encodeURIComponent(email)}`);
        if (!res.ok) return null;
        const payload = await res.json();
        let u = payload?.user ?? payload;
        if (Array.isArray(u)) u = u[0];
        return u || null;
    } catch (e) {
        console.error("[ModuleLayout] Error fetching user by email:", e);
        return null;
    }
};

export default function ModuleLayout({ children }: { children: React.ReactNode }) {
    const params = useParams();
    const { user, loading: authLoading } = useAuth();
    const [userId, setUserId] = useState<string | null>(null);

    // Resolve the current module_id from the URL (may be a string or string[])
    const currentModuleId = Array.isArray(params?.module_id)
        ? params.module_id[0]
        : (params?.module_id as string | undefined) ?? "";

    // Fetch the internal user record once the auth user is known
    useEffect(() => {
        if (authLoading || !user?.email) return;
        fetchUserByEmail(user.email).then((emp) => {
            if (emp?.user_id) setUserId(emp.user_id);
        });
    }, [user, authLoading]);

    return (
        <>
            {/* ModuleSideNav persists across [module_id] navigations.
          EmployeeNavigation is provided by the root SidebarWrapper. */}
            {userId && currentModuleId && (
                <ModuleSideNav
                    userId={userId}
                    currentModuleId={currentModuleId}
                />
            )}
            {children}
        </>
    );
}
