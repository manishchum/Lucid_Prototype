"use client";

import React, { useEffect, useState } from 'react';
import ContentLibrary from '@/components/content-library/ContentLibrary';
import EmployeeNavigation from '@/components/employee-navigation';
import EmployeeLayout from '@/components/employee-layout';
import { useAuth } from '@/contexts/auth-context';
import { supabase } from '@/lib/supabase';
import Link from 'next/link';

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
        const { data: employeeData, error } = await supabase
          .from('users')
          .select('user_id')
          .eq('email', user.email)
          .single();

        if (error || !employeeData) {
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

  if (!isAdmin) {
    return (
      <div className="p-8">
        <h2 className="text-xl font-semibold mb-4">Not authorized</h2>
        <p className="mb-6">You do not have access to the Content Library. If you believe this is an error, contact your administrator.</p>
        <Link href="/employee/welcome" className="inline-block bg-blue-600 text-white px-4 py-2 rounded">Back to dashboard</Link>
      </div>
    );
  }

  return (
    <>
      <EmployeeNavigation />
      <EmployeeLayout>
        <ContentLibrary role="admin" onNavigate={(s) => console.log('nav', s)} />
      </EmployeeLayout>
    </>
  );
}
