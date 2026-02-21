"use client";

import React, { useEffect, useState } from 'react';
import ContentLibrary from '@/components/content-library/ContentLibrary';

import { useAuth } from '@/contexts/auth-context';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
export const dynamic = "force-dynamic";

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;



export default function ContentLibraryPage() {
  const { user, internalUser, isAdmin, loading: authLoading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!authLoading) {
      if (!user) {
        router.push("/login");
      }
    }
  }, [user, authLoading, router]);

  // fetchRoles();


  if (authLoading || !user) return null;

  // Allow all authenticated users to view the Content Library.
  // Only surface upload/create-folder controls to admins.
  return (
    <ContentLibrary isAdmin={isAdmin} onNavigate={(s) => console.log('nav', s)} />
  );
}
