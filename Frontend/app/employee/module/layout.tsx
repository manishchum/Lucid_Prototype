"use client";

import { ReactNode } from "react";
import { useParams } from "next/navigation";
import ModuleSideNav from "@/components/ModuleSideNav";
import { useAuth } from "@/contexts/auth-context";

export default function EmployeeModuleLayout({ children }: { children: ReactNode }) {
  const { employeeData } = useAuth();
  const params = useParams<{ module_id?: string }>();
  const currentModuleId = params?.module_id ? String(params.module_id) : "";

  return (
    <div className="min-h-screen">
      {employeeData?.user_id && currentModuleId && (
        <ModuleSideNav userId={employeeData.user_id} currentModuleId={currentModuleId} />
      )}
      <div className="ml-0 xl:ml-64 transition-all duration-300 ease-in-out">{children}</div>
    </div>
  );
}
