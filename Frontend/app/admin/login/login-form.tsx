"use client"

import type React from "react"
import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  sendEmailVerification,
} from "firebase/auth"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { auth, googleProvider } from "@/lib/firebase"
import { supabase } from "@/lib/supabase"
import { Building2 } from "lucide-react"

export default function AdminLoginForm() {
  const [isLogin, setIsLogin] = useState(true)
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [companyName, setCompanyName] = useState("")
  const [companyDomain, setCompanyDomain] = useState("")
  const [adminName, setAdminName] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const router = useRouter()
  const searchParams = useSearchParams()

  useEffect(() => {
    const urlError = searchParams.get("error")
    if (urlError) {
      switch (urlError) {
        case "access_denied":
          setError("Access denied. Admin account not found for this Google account.")
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

  const checkAdminAccess = async (userEmail: string) => {
    console.log("Not a valid admin login page")

  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password)

      // Check if user is an admin in Supabase
      await checkAdminAccess(userCredential.user.email!)

      router.push("/admin/dashboard")
    } catch (error: any) {
      setError(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")

    try {
      // First create the company in Supabase
      const { data: companyData, error: companyError } = await supabase
        .from("companies")
        .insert({
          name: companyName,
          domain: companyDomain,
        })
        .select()
        .single()

      if (companyError) throw companyError

      // Create Firebase user
      const userCredential = await createUserWithEmailAndPassword(auth, email, password)

      // Send email verification
      await sendEmailVerification(userCredential.user)

      // Create admin record in Supabase
      // const { error: adminError } = await supabase.from("admins").insert({
      //   email,
      //   name: adminName,
      //   company_id: companyData.company_id,
      // })

      // if (adminError) throw adminError

      setError("Account created successfully! Please check your email to verify your account.")
    } catch (error: any) {
      setError(error.message)
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setLoading(true)
    setError("")

    try {
      const result = await signInWithPopup(auth, googleProvider)

      // Check if user is an admin in Supabase
      await checkAdminAccess(result.user.email!)

      router.push("/admin/dashboard")
    } catch (error: any) {
      if (error.message.includes("Access denied")) {
        setError("Access denied. Admin account not found for this Google account.")
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
        <div className="mx-auto w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mb-4">
          <Building2 className="w-8 h-8 text-blue-600" />
        </div>
        <CardTitle className="text-2xl">{isLogin ? "Admin Login" : "Create Admin Account"}</CardTitle>
        <CardDescription>
          {isLogin ? "Sign in to your admin dashboard" : "Set up your company and admin account"}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={isLogin ? handleLogin : handleSignup} className="space-y-4">
          {!isLogin && (
            <>
              <div className="space-y-2">
                <Label htmlFor="companyName">Company Name</Label>
                <Input
                  id="companyName"
                  type="text"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="companyDomain">Company Domain</Label>
                <Input
                  id="companyDomain"
                  type="text"
                  placeholder="company.com"
                  value={companyDomain}
                  onChange={(e) => setCompanyDomain(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="adminName">Your Name</Label>
                <Input
                  id="adminName"
                  type="text"
                  value={adminName}
                  onChange={(e) => setAdminName(e.target.value)}
                  required
                />
              </div>
            </>
          )}

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Processing..." : isLogin ? "Sign In" : "Create Account"}
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

        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={() => setIsLogin(!isLogin)}
            className="text-blue-600 hover:text-blue-800 text-sm"
          >
            {isLogin ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
          </button>
        </div>
      </CardContent>
    </Card>
  )
}
