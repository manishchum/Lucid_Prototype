"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { signInWithPopup } from "firebase/auth"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Brain, ArrowLeft, Eye, EyeOff } from "lucide-react"
import { auth, googleProvider } from "@/lib/firebase"
import { supabase } from "@/lib/supabase"
import { useAuth } from "@/contexts/auth-context"
import bcrypt from "bcryptjs"

export default function LoginPage() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const router = useRouter()
  const searchParams = useSearchParams()
  const { login } = useAuth() // Get the login function from auth context

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
    // First, get the user from the users table
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("user_id")
      .eq("email", userEmail)
      .maybeSingle()
    console.log(userData)
    if (userError || !userData) {
      throw new Error("Access denied. Your email is not in the allowed users list.")
    }

    // Then, get the user's role assignments with role names
    const { data: roleData, error: roleError } = await supabase
      .from("user_role_assignments")
      .select(`
        user_role_assignment_id,
        roles (
          name
        )
      `)
      .eq("user_id", userData.user_id)

      console.log("Role Data ")
      console.log(roleData)
    if (roleError || !roleData || roleData.length === 0) {
      throw new Error("Access denied. No roles assigned to this user.")
    }

    // Extract role names from the response
    //@ts-ignore
    const userRoles = roleData.map(assignment => assignment.roles?.name).filter(Boolean)

    return {
      userId: userData.user_id,
      roles: userRoles
    }
  }

  const handleEmailPasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")

    try {
      // Get user from database
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("user_id, email, password, name")
        .eq("email", email)
        .maybeSingle()

      if (userError || !userData) {
        throw new Error("Invalid email or password")
      }

      // Check if password exists (for users who signed up with email/password)
      if (!userData.password) {
        throw new Error("This account uses Google sign-in. Please use 'Continue with Google' button.")
      }

      // Verify password
      const isPasswordValid = await bcrypt.compare(password, userData.password)
      if (!isPasswordValid) {
        throw new Error("Invalid email or password")
      }

      // Check user access and get roles
      const userAccessData = await checkUserAccess(email)

      // Create a user object that matches what the auth context expects
      const userForContext = {
        uid: userData.user_id,
        email: userData.email,
        displayName: userData.name,
        name: userData.name
      }

      // Set user in auth context
      await login(userForContext)

      // Redirect all users to the employee dashboard
      router.push('/employee/welcome')
    } catch (error: any) {
      setError(error.message)
      try {
        // send a log entry for login failure
        await fetch('/api/logs', {
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

  const handleGoogleSignIn = async () => {
    setLoading(true)
    setError("")

    try {
      const result = await signInWithPopup(auth, googleProvider)
    console.log(result)
      
      // Check user access and get roles
      const userData = await checkUserAccess(result.user.email!)

    console.log(userData)
      
      // Set user in auth context (Google sign-in should automatically do this via Firebase)
      await login(result.user)

      // Redirect all users to the employee dashboard
      router.push('/employee/welcome')
    } catch (error: any) {
      if (error.message.includes("Access denied")) {
        setError("Access denied. Your Google account email is not in the allowed users list.")
      } else {
        setError(error.message)
      }
      try {
        await fetch('/api/logs', {
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
        {/* Back Button */}
        <Link href="/" className="inline-flex items-center text-gray-600 hover:text-gray-800 mb-6 transition-colors">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Home
        </Link>

        {/* Login Card */}
        <Card className="shadow-xl border-0 bg-white/80 backdrop-blur-sm">
          <CardHeader className="text-center pb-8">
            {/* Logo */}
            <div className="flex items-center justify-center space-x-2 mb-6">
              <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl flex items-center justify-center">
                <Brain className="w-6 h-6 text-white" />
              </div>
              <span className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                Lucid
              </span>
            </div>
            
            <CardTitle className="text-2xl font-bold text-gray-800 mb-2">
              Welcome Back
            </CardTitle>
            <p className="text-gray-600">
              Sign in to continue to your Lucid dashboard
            </p>
          </CardHeader>

          <CardContent className="space-y-6">
            <form onSubmit={handleEmailPasswordLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium text-gray-700">
                  Email Address
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="your.email@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 border-gray-200 focus:border-blue-500 focus:ring-blue-500"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password" className="text-sm font-medium text-gray-700">
                  Password
                </Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="h-11 border-gray-200 focus:border-blue-500 focus:ring-blue-500 pr-10"
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
              </div>

              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Button
                type="submit"
                className="w-full h-11 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-medium transition-all duration-200"
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
              className="w-full h-11 bg-transparent hover:bg-gray-50 border-gray-200"
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

            <div className="text-center text-sm text-gray-600">
              <p>
                Don't have an account?{" "}
                <Link href="/signup" className="text-blue-600 hover:text-blue-700 font-medium">
                  Sign up
                </Link>
              </p>
              <p className="mt-2">Contact us via mail at manish.chum@workfloww.ai</p>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center mt-8">
          <p className="text-sm text-gray-500">
            Secure login powered by Lucid Learning Platform
          </p>
        </div>
      </div>
    </div>
  )
}