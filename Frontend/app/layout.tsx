import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { AuthProvider } from "@/contexts/auth-context"
import { Toaster as ShadcnToaster } from "@/components/ui/toaster"
import ErrorReporterInit from '@/components/ErrorReporterInit'
import LucidAssistant from '@/components/LucidAssistant'

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "Lucid Learning Platform",
  description: "AI-powered learning and development platform",
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
          <ErrorReporterInit />
          <LucidAssistant />
          <ShadcnToaster />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
