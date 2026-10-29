"use client"

import type React from "react"
import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { signInWithPopup, signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth"
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
import { useAuth, hasActiveSession } from "@/contexts/auth-context"
import { fetchWithAuth } from "@/lib/fetch-with-auth"

function LoginContent() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [resetMessage, setResetMessage] = useState("")
  const [resetLoading, setResetLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const { user, login } = useAuth()
  const [isRedirecting, setIsRedirecting] = useState(() => {
    return hasActiveSession() || Boolean(user)
  })

  // Synchronous and immediate redirect if session exists
  useEffect(() => {
    if (user || hasActiveSession()) {
      setIsRedirecting(true)
      router.replace('/employee/welcome')
    }
  }, [user, router])

  // Instant response to tab switching, window focus, and cross-tab storage updates
  useEffect(() => {
    const handleTabFocusOrSwitch = () => {
      if (document.visibilityState === "visible") {
        if (hasActiveSession() || auth?.currentUser) {
          setIsRedirecting(true)
          router.replace('/employee/welcome')
        }
      }
    }

    window.addEventListener("focus", handleTabFocusOrSwitch)
    document.addEventListener("visibilitychange", handleTabFocusOrSwitch)
    window.addEventListener("storage", handleTabFocusOrSwitch)

    return () => {
      window.removeEventListener("focus", handleTabFocusOrSwitch)
      document.removeEventListener("visibilitychange", handleTabFocusOrSwitch)
      window.removeEventListener("storage", handleTabFocusOrSwitch)
    }
  }, [router])

  useEffect(() => {
    const urlError = searchParams.get("error")
    if (urlError) {
      switch (urlError) {
        case "access_denied":
          setError("Access denied. Your email is not in the allowed users list.")
          break
        case "auth_failed":
          setError("Authentication failed. Please try again.")
          break
        case "callback_failed":
          setError("Login process failed. Please try again.")
          break
        default:
          setError("An error occurred during login.")
      }
    }
  }, [searchParams])

  const mapLoginErrorMessage = (err: any): string => {
    const code = err?.code || ""
    const message = err?.message || ""

    if (message.includes("Access denied")) {
      return "Access denied. Your email is not in the allowed users list."
    }
    if (message.includes("deactivated") || message.includes("organization")) {
      return message
    }

    switch (code) {
      case "auth/user-not-found":
      case "auth/wrong-password":
      case "auth/invalid-credential":
        return "Invalid email or password."
      case "auth/invalid-email":
        return "Please enter a valid email address."
      case "auth/too-many-requests":
        return "Too many failed attempts. Please wait and try again."
      case "auth/network-request-failed":
        return "Network request failed. Please check your connection and try again."
      default:
        return message || "Unable to sign in right now. Please try again."
    }
  }

  const handleEmailPasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")
    setResetMessage("")

    try {
      const emailAuthResult = await signInWithEmailAndPassword(auth, email, password)
      await login(emailAuthResult.user)

      try { sessionStorage.setItem('show_login_toast_next', '1'); } catch (e) { /* ignore */ }
      router.push('/employee/welcome')
    } catch (error: any) {
      setError(mapLoginErrorMessage(error))
      try {
        await fetchWithAuth('/api/logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email_id: email || null,
            error: error?.message || 'Login failed',
            error_type: 'AuthError',
            browser: navigator.userAgent,
            os: navigator.platform,
            device: navigator.platform,
            action: 'email-password-login',
            page_url: location.href
          })
        })
      } catch (e) {
        // swallow logging errors
      }
    } finally {
      setLoading(false)
    }
  }

  const handleForgotPassword = async () => {
    setError("")
    setResetMessage("")

    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) {
      setError("Enter your email first, then click Forgot password.")
      return
    }

    setResetLoading(true)
    try {
      await sendPasswordResetEmail(auth, normalizedEmail)
      setResetMessage("Password reset email sent. Check your inbox and spam folder.")
    } catch (err: any) {
      const code = err?.code || ""
      if (code === "auth/invalid-email") {
        setError("Please enter a valid email address.")
      } else if (code === "auth/too-many-requests") {
        setError("Too many attempts. Please wait and try again.")
      } else {
        setError("Unable to send reset email right now. Please try again.")
      }
    } finally {
      setResetLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setLoading(true)
    setError("")
    let result = null
    try {
      result = await signInWithPopup(auth, googleProvider)
      await login(result.user)

      try { sessionStorage.setItem('show_login_toast_next', '1'); } catch (e) { /* ignore */ }
      router.push('/employee/welcome')
    } catch (error: any) {
      if (error?.message?.includes("Access denied")) {
        setError("Access denied. Your Google account email is not in the allowed users list.")
      } else {
        setError(mapLoginErrorMessage(error))
      }
      try {
        await fetchWithAuth('/api/logs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email_id: (result && (result as any).user && (result as any).user.email) || null,
            error: error?.message || 'Google sign-in failed',
            error_type: 'AuthError',
            browser: navigator.userAgent,
            os: navigator.platform,
            device: navigator.platform,
            action: 'google-signin',
            page_url: location.href
          })
        })
      } catch (e) {
        // swallow logging errors
      }
    } finally {
      setLoading(false)
    }
  }

  if (isRedirecting) {
    return <div className="h-screen w-screen bg-[#F6F7FD]" />
  }

  return (
    <div className="h-screen max-h-screen w-screen bg-white font-sans relative overflow-hidden flex flex-col justify-between select-none">
      {/* Dynamic Background Organic Curve dividing Left and Right */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0 hidden lg:block">
        <svg
          className="absolute inset-0 w-full h-full"
          viewBox="0 0 1440 900"
          preserveAspectRatio="none"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Left panel soft background fill */}
          <path
            d="M 0 0 L 535 0 C 555 60 598 120 598 180 C 598 320 505 440 480 570 C 450 700 560 810 590 900 L 0 900 Z"
            fill="#F6F7FD"
          />

          {/* Soft lavender ribbon outline */}
          <path
            d="M 535 0 C 555 60 598 120 598 180 C 598 320 505 440 480 570 C 450 700 560 810 590 900"
            stroke="#E0E7FF"
            strokeWidth="16"
            strokeOpacity="0.75"
            strokeLinecap="round"
          />

          {/* Crisp delicate periwinkle line */}
          <path
            d="M 535 0 C 555 60 598 120 598 180 C 598 320 505 440 480 570 C 450 700 560 810 590 900"
            stroke="#A5B4FC"
            strokeWidth="1.75"
            strokeLinecap="round"
          />
        </svg>
      </div>

      {/* Main Split Layout Container */}
      <div className="relative z-10 w-full h-full flex flex-col lg:flex-row overflow-hidden">
        {/* Left Side: Brand Logo & Typography Hero */}
        <div className="w-full lg:w-[42%] xl:w-[40%] flex flex-col justify-between p-6 sm:p-8 lg:p-10 xl:p-12 lg:pr-4 bg-[#F6F7FD] lg:bg-transparent shrink-0">
          {/* Logo & Tagline */}
          <Link href="/" className="flex items-center gap-2.5 group w-fit">
            <div className="relative w-7 h-7 sm:w-8 sm:h-8 flex-shrink-0">
              <img
                src="/images/icons/logo-2.png"
                alt="Lucid Logo"
                className="w-full h-full object-contain mix-blend-multiply"
              />
            </div>
            <div className="flex flex-col leading-none">
              <span className="text-[18px] sm:text-[19px] font-bold text-[#0F172A] tracking-[-0.02em]">
                Lucid
              </span>
              <span className="text-[11px] sm:text-[11.5px] text-slate-500 font-normal mt-0.5 tracking-tight">
                by workfloww.ai
              </span>
            </div>
          </Link>

          {/* Left Hero Text */}
          <div className="my-auto py-4 max-w-md">
            <h1 className="text-[36px] sm:text-[42px] lg:text-[46px] xl:text-[52px] font-black text-[#0F172A] tracking-[-0.035em] leading-[1.08]">
              Good to see you
              <br />
              <span
                className="italic font-normal text-[#7952F5] tracking-normal inline-block"
                style={{
                  fontFamily: "'Newsreader', 'Instrument Serif', 'Playfair Display', Georgia, serif",
                  fontSize: '1.08em',
                }}
              >
                again
              </span>
            </h1>

            <p className="text-slate-500 text-[13px] sm:text-[14px] font-normal pt-2.5 sm:pt-3.5 tracking-tight leading-relaxed whitespace-nowrap">
              Enterprise Productivity Platform Accelerating Business Outcomes
            </p>
          </div>

          {/* Spacer to balance bottom */}
          <div className="h-4 sm:h-6" />
        </div>

        {/* Right Side: Back to Home + Login Form */}
        <div className="w-full lg:w-[58%] xl:w-[60%] flex flex-col justify-between p-6 sm:p-8 lg:p-10 xl:p-12 bg-white lg:bg-transparent h-full overflow-hidden flex-1">
          {/* Top Right "Back to Home" Link */}
          <div className="flex justify-end w-full shrink-0">
            <Link
              href="/"
              className="inline-flex items-center text-slate-500 hover:text-slate-900 transition-colors text-[13px] sm:text-[13.5px] font-medium group"
            >
              <ArrowLeft className="w-4 h-4 mr-1.5 text-slate-400 group-hover:text-slate-900 group-hover:-translate-x-0.5 transition-all" />
              Back to Home
            </Link>
          </div>

          {/* Centered Login Card Form */}
          <div className="w-full max-w-[370px] sm:max-w-[385px] mx-auto my-auto py-1">
            {/* Lock Icon Badge */}
            <div className="w-11 h-11 sm:w-12 sm:h-12 rounded-2xl bg-[#EEF2FF] flex items-center justify-center mx-auto mb-3 sm:mb-3.5 text-[#4F46E5] shadow-[0_2px_8px_rgba(79,70,229,0.08)]">
              <Lock className="w-5 h-5 text-[#4F46E5]" strokeWidth={1.8} />
            </div>

            {/* Header Titles */}
            <h2 className="text-[22px] sm:text-[24px] font-bold text-[#0F172A] text-center tracking-tight leading-snug">
              Login to your account
            </h2>
            <p className="text-slate-500 text-[12.5px] sm:text-[13px] text-center mt-0.5 mb-5 sm:mb-6 tracking-tight">
              Enter your credentials to continue
            </p>

            <form onSubmit={handleEmailPasswordLogin} className="space-y-3.5 sm:space-y-4">
              {/* Email Address */}
              <div>
                <label
                  htmlFor="email"
                  className="block text-[12px] sm:text-[12.5px] font-medium text-slate-700 mb-1"
                >
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="w-[17px] h-[17px] text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="email"
                    type="email"
                    placeholder="your.email@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    className="w-full pl-10 pr-4 py-2 sm:py-2.5 bg-white border border-slate-200/90 rounded-xl text-[13.5px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#4F46E5] focus:ring-2 focus:ring-[#4F46E5]/10 hover:border-slate-300 transition-all shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
                  />
                </div>
              </div>

              {/* Password */}
              <div>
                <label
                  htmlFor="password"
                  className="block text-[12px] sm:text-[12.5px] font-medium text-slate-700 mb-1"
                >
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-[17px] h-[17px] text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    className="w-full pl-10 pr-10 py-2 sm:py-2.5 bg-white border border-slate-200/90 rounded-xl text-[13.5px] text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#4F46E5] focus:ring-2 focus:ring-[#4F46E5]/10 hover:border-slate-300 transition-all shadow-[0_1px_2px_rgba(15,23,42,0.03)]"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <div className="flex justify-end mt-1">
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={loading || resetLoading}
                    className="text-[12px] text-[#3B82F6] hover:text-[#2563EB] font-medium transition-colors disabled:opacity-60"
                  >
                    {resetLoading ? "Sending reset email..." : "Forgot password?"}
                  </button>
                </div>
              </div>

              {/* Error Alert */}
              {error && (
                <div className="p-2.5 rounded-xl bg-red-50 border border-red-200/80 text-red-700 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  <span className="leading-snug">{error}</span>
                </div>
              )}

              {/* Reset Message */}
              {resetMessage && (
                <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200/80 text-emerald-700 text-xs flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  <span className="leading-snug">{resetMessage}</span>
                </div>
              )}

              {/* Continue Submit Button */}
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 rounded-xl text-white font-medium text-[13.5px] sm:text-[14px] bg-gradient-to-r from-[#3B5FEB] via-[#5C45EE] to-[#8E32E6] hover:opacity-95 shadow-sm active:scale-[0.99] transition-all disabled:opacity-60 flex items-center justify-center cursor-pointer"
              >
                {loading ? "Signing in..." : "Continue"}
              </button>
            </form>

            {/* "or" Divider */}
            <div className="relative my-3.5 sm:my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200" />
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="bg-white px-2.5 text-slate-400 font-normal">or</span>
              </div>
            </div>

            {/* Google Sign In Button */}
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full py-2 sm:py-2.5 px-4 rounded-xl border border-slate-200/90 bg-white hover:bg-slate-50/80 text-slate-700 font-medium text-[13px] sm:text-[13.5px] shadow-[0_1px_2px_rgba(15,23,42,0.03)] transition-all flex items-center justify-center gap-2.5 active:scale-[0.99] disabled:opacity-60 cursor-pointer"
            >
              <svg className="w-[17px] h-[17px]" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              <span>Continue with Google</span>
            </button>

            {/* Need help? Contact admin */}
            <div className="text-center mt-3.5 sm:mt-4 text-[12.5px] sm:text-[13px] text-slate-500">
              Need help?{" "}
              <a
                href="mailto:manish@workfloww.ai"
                className="text-[#3B82F6] hover:underline font-medium transition-colors"
              >
                Contact admin
              </a>
            </div>
          </div>

          {/* Secure Login Footer */}
          <div className="text-center pb-1 pt-2 text-[11.5px] text-slate-400 font-normal shrink-0">
            Secure login powered by lucid.workfloww.ai
          </div>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="h-screen w-screen bg-[#F6F7FD]" />}>
      <LoginContent />
    </Suspense>
  )
}