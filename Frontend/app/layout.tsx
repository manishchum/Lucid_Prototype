import type React from "react"
import type { Metadata } from "next"
import { Inter } from "next/font/google"
import "./globals.css"
import { AuthProvider } from "@/contexts/auth-context"
import { Toaster } from "react-hot-toast" // Import Toaster
import { Toaster as ShadcnToaster } from "@/components/ui/toaster"
import ErrorReporterInit from '@/components/ErrorReporterInit'

const inter = Inter({ subsets: ["latin"] })

export const metadata: Metadata = {
  title: "AI-Powered Employee Onboarding",
  description: "Streamline your training process with intelligent content management",
    generator: 'v0.dev'
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>
          <ErrorReporterInit />
          {children}
        </AuthProvider>
        <Toaster /> {/* Add Toaster component here */}
        <ShadcnToaster />
      </body>
    </html>
  )
}
