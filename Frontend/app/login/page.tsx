"use client"

import type React from "react"
import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { signInWithPopup, signInWithEmailAndPassword, sendPasswordResetEmail } from "firebase/auth"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Brain, ArrowLeft, Eye, EyeOff } from "lucide-react"
import { auth, googleProvider } from "@/lib/firebase"
import { useAuth } from "@/contexts/auth-context"
import { fetchWithAuth } from "@/lib/fetch-with-auth"

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

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
  const { login } = useAuth()

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

  const checkUserAccess = async (userEmail: string) => {
    try{
      const res = await fetchWithAuth(`${API_BASE}/api/users/by-email/${encodeURIComponent(userEmail)}`)
      if (!res.ok) {
        throw new Error("Access denied. Your email is not in the allowed users list.")
      }
    
      const payload = await res.json();
      let employeeData = payload?.user ?? payload;
      if (Array.isArray(employeeData)) employeeData = employeeData[0];
      if (!employeeData) {
        throw new Error("Access denied. Your email is not in the allowed users list.")
      }
      if (employeeData.is_active === false) {
        throw new Error("Your account has been deactivated. Please contact your administrator.")
      }

      // Company must exist
      const companyRes = await fetchWithAuth(
        `${API_BASE}/api/companies/${employeeData.company_id}`
      )

      if (!companyRes.ok) {
        throw new Error("Your organization is no longer available. Please contact your administrator.")
      }

      const companyPayload = await companyRes.json()

      if (!companyPayload?.data) {
        throw new Error("Your organization is no longer available. Please contact your administrator.")
      }

      if (companyPayload.data.is_company_active === false) {
        throw new Error("Your organization account has been deactivated. Please contact your administrator.")
      }
      return employeeData;
    } catch (error: any) {
      throw new Error(error.message || "Failed to verify user access.")
    }
  }

  const mapLoginErrorMessage = (err: any): string => {
    const code = err?.code || ""
    const message = err?.message || ""

    if (message.includes("Access denied")) {
      return "Access denied. Your email is not in the allowed users list."
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
      const sessionRes = await fetchWithAuth(`${API_BASE}/api/auth/session`,
        {
          method: 'POST',
          registerSession: true as any,
        } as any
      );
      if(!sessionRes.ok) {
        throw new Error("Failed to register session after login.")
      }
      await new Promise(resolve => setTimeout(resolve, 750)); // Wait for session to be registered
      await checkUserAccess(email)

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
      const sessionRes = await fetchWithAuth(`${API_BASE}/api/auth/session`,
        {
          method: 'POST',
          registerSession: true as any,
        } as any
      );
      if(!sessionRes.ok) {
        throw new Error("Failed to register session after login.")
      }
      await new Promise(resolve => setTimeout(resolve, 750)); // Wait for session to be registered
      const userData = await checkUserAccess(result.user.email!)
      await login(result.user)

      try { sessionStorage.setItem('show_login_toast_next', '1'); } catch (e) { /* ignore */ }
      router.push('/employee/welcome')
    } catch (error: any) {
      if (error.message.includes("Access denied")) {
        setError("Access denied. Your Google account email is not in the allowed users list.")
      } else {
        setError(error.message)
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <Link href="/" className="inline-flex items-center text-gray-600 hover:text-gray-800 mb-4 md:mb-6 transition-colors text-xs md:text-sm">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Home
        </Link>

        <Card className="shadow-xl border-0 bg-white/80 backdrop-blur-sm">
          <CardHeader className="text-center pb-6 md:pb-8">
            <div className="flex items-center justify-center space-x-2 mb-4 md:mb-6">
              <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl flex items-center justify-center">
                <Brain className="w-6 h-6 text-white" />
              </div>
              <span className="text-xl md:text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Lucid
              </span>
            </div>
            
            <CardTitle className="text-xl md:text-2xl font-bold text-gray-800 mb-2">
              Welcome Back
            </CardTitle>
            <p className="text-xs md:text-sm text-gray-600">
              Sign in to continue to your Lucid dashboard
            </p>
          </CardHeader>

          <CardContent className="space-y-6">
            <form onSubmit={handleEmailPasswordLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-xs md:text-sm font-medium text-gray-700">
                  Email Address
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="your.email@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-10 md:h-11 border-gray-200 focus:border-blue-500 focus:ring-blue-500 text-sm"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-xs md:text-sm font-medium text-gray-700">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-10 md:h-11 border-gray-200 focus:border-blue-500 focus:ring-blue-500 pr-10 text-sm"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    disabled={loading || resetLoading}
                    className="text-xs md:text-sm text-blue-600 hover:text-blue-700 disabled:opacity-60"
                  >
                    {resetLoading ? "Sending reset email..." : "Forgot password?"}
                  </button>
                </div>
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription className="text-xs md:text-sm">{error}</AlertDescription>
                </Alert>
              )}

              {resetMessage && (
                <Alert>
                  <AlertDescription className="text-xs md:text-sm">{resetMessage}</AlertDescription>
                </Alert>
              )}

              <Button
                type="submit"
                className="w-full h-10 md:h-11 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-medium transition-all duration-200 text-sm"
                disabled={loading}
              >
                {loading ? "Signing in..." : "Sign In"}
              </Button>
            </form>

            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-gray-500">Or continue with</span>
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              onClick={handleGoogleSignIn}
              disabled={loading}
              className="w-full h-10 md:h-11 bg-transparent hover:bg-gray-50 border-gray-200 text-xs md:text-sm"
            >
              <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continue with Google
            </Button>

            <div className="text-center text-xs md:text-sm text-gray-600">
              <p className="mt-2">Contact us via mail at manish.chum@workfloww.ai</p>
            </div>
          </CardContent>
        </Card>

        <div className="text-center mt-8">
          <p className="text-sm text-gray-500">
            Secure login powered by Lucid Platform
          </p>
        </div>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <LoginContent />
    </Suspense>
  )
}