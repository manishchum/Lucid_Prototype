import type React from "react"
import type { Metadata } from "next"
import { DM_Sans } from "next/font/google"
import "./globals.css"
import { AuthProvider } from "@/contexts/auth-context"
import { TenantProvider } from "@/contexts/tenant-context"
import { Toaster as ShadcnToaster } from "@/components/ui/toaster"
import ErrorReporterInit from '@/components/ErrorReporterInit'
// import LucidAssistant from '@/components/LucidAssistant'
import LayoutWithNavigation from '@/components/layout-with-navigation'

const dmSans = DM_Sans({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700", "800", "900"] })

export const metadata: Metadata = {
  title: "Lucid Learning Platform",
  description: "AI-powered learning and development platform",
  icons: {
    icon: "/images/icons/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${dmSans.className} antialiased bg-[#f8f9ff] text-slate-900`}>
        <AuthProvider>
          <TenantProvider>
            <ErrorReporterInit />
            {/* <LucidAssistant /> */}
            <ShadcnToaster />
            <LayoutWithNavigation>
              {children}
            </LayoutWithNavigation>
          </TenantProvider>
        </AuthProvider>
      </body>
    </html>
  );
}