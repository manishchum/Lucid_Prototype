"use client";

import React, { useEffect, useState } from 'react';
import ContentLibrary from '@/components/content-library/ContentLibrary';
import { useAuth } from '@/contexts/auth-context';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
export const dynamic = "force-dynamic";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

const fetchUserByEmail = async (email: string | undefined | null) => {
  if (!email) return null;
  try {
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
  const { user, loading: authLoading } = useAuth();
  const [roles, setRoles] = useState<string[] | null>(null);
  const router = useRouter();
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!authLoading) {
      if (!user) router.push("/login");
      else fetchRoles();

    }
  }, [user, authLoading, router]);

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

      const res = await fetch(`${API_BASE}/api/roles/users/${employeeData.user_id}`, {
        headers: { 'X-User-ID': employeeData.user_id.toString() }
      });

      if (!res.ok) {
        setRoles([]);
      } else {
        const roleData = await res.json();
        const r = (roleData || []).map((a: any) => a.role_name).filter(Boolean);
        setRoles(r);
      }
    } catch (e) {
      setRoles([]);
    } finally {
      setChecking(false);
    }
  };

  // fetchRoles();


  if (authLoading || checking) return <div className="p-8">Loading...</div>;

  const isAdmin = (roles || []).some(r => r === 'ADMIN' || r === 'SUPER_ADMIN');

  // Allow all authenticated users to view the Content Library.
  // Only surface upload/create-folder controls to admins.
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <div className="px-4 py-8">
        <div className="max-w-7xl mx-auto">
          <div className="bg-white rounded-xl shadow-sm p-8 border border-slate-200 mb-4">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">Browse Sprints</h1>
            <p className="text-slate-600">Browse, manage, and launch your sprints</p>
          </div>
          <ContentLibrary isAdmin={isAdmin} onNavigate={(s) => console.log('nav', s)} />
        </div>
      </div>
    </div>
  );
}
