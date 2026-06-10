'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function CreateRedirectPage() {
  const router = useRouter();
  
  useEffect(() => {
    router.replace('/admin/task-manager');
  }, [router]);

  return (
    <div className="flex h-screen items-center justify-center text-sm font-semibold text-slate-500 bg-slate-50">
      Redirecting to Task Manager...
    </div>
  );
}
