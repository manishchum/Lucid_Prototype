"use client"

import type React from "react"
import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { signInWithPopup, signInWithEmailAndPassword, signInWithCustomToken, sendPasswordResetEmail } from "firebase/auth"
import Link from "next/link"
import { 
  ArrowLeft, 
  Lock, 
  Mail, 
  Eye, 
  EyeOff, 
  AlertCircle, 
  CheckCircle2 
} from "lucide-react"
import { auth, googleProvider } from "@/lib/firebase"
import { useAuth, isBrowserSessionActive, setBrowserSessionActive, updateLastActiveTimestamp, clearBrowserSessionActive, clearManualAuthUser } from "@/contexts/auth-context"
import { signOut } from "firebase/auth"
import { fetchWithAuth } from "@/lib/fetch-with-auth"
import { headers } from "next/headers"

import LoginContent from "@/components/auth/LoginContent"
import { isEYTenant } from "@/lib/tenant"
import { LoadingProgress } from "@/components/LoadingProgress"

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const headerList = await headers()
  const host = headerList.get("host") || ""
  const resolvedParams = searchParams ? await searchParams : {}
  const tenantParam = typeof resolvedParams.tenant === "string" ? resolvedParams.tenant : null

  const isEY = 
    isEYTenant(host, null) || 
    tenantParam === "ey" ||
    (typeof resolvedParams.brand === "string" && resolvedParams.brand === "ey")

  return (
    <Suspense fallback={<LoadingProgress label="Loading your dashboard" />}>
      <LoginContent initialIsEY={isEY} />
    </Suspense>
  )
}
