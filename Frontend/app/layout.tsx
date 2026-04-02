import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { AuthProvider } from "@/contexts/auth-context"
import { TenantProvider } from "@/contexts/tenant-context"
import { Toaster as ShadcnToaster } from "@/components/ui/toaster"
import ErrorReporterInit from '@/components/ErrorReporterInit'
import LucidAssistant from '@/components/LucidAssistant'
import LayoutWithNavigation from '@/components/layout-with-navigation'

const inter = Inter({ subsets: ["latin"] })

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
      <body className="antialiased bg-gradient-to-br from-blue-50 via-white to-purple-50">
        <AuthProvider>
          <TenantProvider>
            <ErrorReporterInit />
            <LucidAssistant />
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
