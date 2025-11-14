"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { signInWithPopup, sendSignInLinkToEmail, isSignInWithEmailLink, signInWithEmailLink } from "firebase/auth"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { auth, googleProvider } from "@/lib/firebase"
import { supabase } from "@/lib/supabase"
import { Users, Mail } from "lucide-react"

export default function EmployeeLoginForm() {
  const [email, setEmail] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const urlError = searchParams.get("error")
    if (urlError) {
      switch (urlError) {
        case "access_denied":
          setError("Access denied. Your Google account email is not in the allowed employees list.")
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

    // Check if this is a sign-in with email link
    if (isSignInWithEmailLink(auth, window.location.href)) {
      handleEmailLinkSignIn()
    }
  }, [searchParams])

  const checkEmployeeAccess = async (userEmail: string) => {
    const { data: employeeData, error: employeeError } = await supabase
      .from("employees")
      .select("*")
      .eq("email", userEmail)
      .single()

    if (employeeError || !employeeData) {
      throw new Error("Access denied. Your email is not in the allowed employees list.")
    }

    return employeeData
  }

  const handleEmailLinkSignIn = async () => {
    setLoading(true)
    try {
      const email = window.localStorage.getItem("emailForSignIn")
      if (!email) {
        setError("Email not found. Please try signing in again.")
        return
      }

      const result = await signInWithEmailLink(auth, email, window.location.href)

      // Check if user is an allowed employee
      await checkEmployeeAccess(result.user.email!)

      window.localStorage.removeItem("emailForSignIn")
      router.push("/employee/welcome")
    } catch (error: any) {
      setError(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")
    setSuccess("")

    try {
      // First check if email is in allowed employees list
      await checkEmployeeAccess(email)

      // Send sign-in link to email
      const actionCodeSettings = {
        url: `${window.location.origin}/login`,
        handleCodeInApp: true,
      }

      await sendSignInLinkToEmail(auth, email, actionCodeSettings)

      // Save email locally for the sign-in completion
      window.localStorage.setItem("emailForSignIn", email)

      setSuccess("Check your email for the login link!")
    } catch (error: any) {
      setError(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setLoading(true)
    setError("")
    setSuccess("")

    try {
      const result = await signInWithPopup(auth, googleProvider)

      // Check if user is an allowed employee
      await checkEmployeeAccess(result.user.email!)

      router.push("/employee/welcome")
    } catch (error: any) {
      if (error.message.includes("Access denied")) {
        setError("Access denied. Your Google account email is not in the allowed employees list.")
      } else {
        setError(error.message)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card>
      <CardHeader className="text-center">
        {/* <div className="mx-auto w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mb-4"> */}
          {/* <Users className="w-8 h-8 text-green-600" /> */}
        {/* </div> */}
        <CardTitle className="text-xl">Learner Login</CardTitle>
        <CardDescription>While others are building AI that replaces humans, we built Lucid that makes humans extraordinary.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleLogin} className="space-y-4">
          <div className="space-y-2"> 
            <Label htmlFor="email">Email Address</Label>
            <Input
              id="email"
              type="email"
              placeholder="your.email@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {success && (
            <Alert>
              <Mail className="w-4 h-4" />
              <AlertDescription>{success}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Sending login link..." : "Send Login Link"}
          </Button>
        </form>

        <div className="relative my-4">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
          </div>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={handleGoogleSignIn}
          disabled={loading}
          className="w-full bg-transparent"
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

        <div className="mt-6 text-center text-sm text-gray-600">
          <p>We'll send you a secure login link via email or sign in with Google.</p>
          <p className="mt-2">Don't have access? Contact us via mail at manish.chum@workfloww.ai</p>
        </div>
      </CardContent>
    </Card>
  )
}
