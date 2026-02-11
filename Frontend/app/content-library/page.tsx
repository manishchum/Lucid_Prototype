"use client";

import React, { useEffect, useState } from 'react';
import ContentLibrary from '@/components/content-library/ContentLibrary';
import EmployeeNavigation from '@/components/employee-navigation';
import EmployeeLayout from '@/components/employee-layout';
import { useAuth } from '@/contexts/auth-context';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';
export const dynamic = "force-dynamic";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

const fetchUserByEmail = async (email: string | undefined | null) => {
  if (!email) return null;
  try{
  const res = await fetch(`${API_BASE}/api/users/by-email/${encodeURIComponent(email)}`);
  if (!res.ok) return null;
  const payload = await res.json();
  let u = payload?.user ?? payload;
  if (Array.isArray(u)) u = u[0];
  return u || null;
  } catch (e) {
    console.error("Error fetching user by email:", e);
    return null;
  }
};

export default function ContentLibraryPage() {
  const { user, loading } = useAuth();
  const [roles, setRoles] = useState<string[] | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    const fetchRoles = async () => {
      if (!user?.email) {
        setRoles([]);
        setChecking(false);
        return;
      }

      try {
        const employeeData = await fetchUserByEmail(user.email);
        if (!employeeData.user_id) {
          setRoles([]);
          setChecking(false);
          return;
        }

        const { data: roleData, error: roleError } = await supabase
          .from('user_role_assignments')
          .select('roles!inner(name)')
          .eq('user_id', employeeData.user_id)
          .eq('is_active', true);

        if (roleError) {
          setRoles([]);
        } else {
          // @ts-ignore
          const r = (roleData || []).map((a: any) => a.roles?.name).filter(Boolean);
          setRoles(r);
        }
      } catch (e) {
        setRoles([]);
      } finally {
        setChecking(false);
      }
    };

    fetchRoles();
  }, [user]);

    if (loading || checking) return <div className="p-8">Loading...</div>;

    const isAdmin = (roles || []).some(r => r === 'ADMIN' || r === 'SUPER_ADMIN');

    // Allow all authenticated users to view the Content Library.
    // Only surface upload/create-folder controls to admins.
    return (
      <>
        <EmployeeNavigation />
        <EmployeeLayout>
          <ContentLibrary isAdmin={isAdmin} onNavigate={(s) => console.log('nav', s)} />
        </EmployeeLayout>
      </>
    );
}
