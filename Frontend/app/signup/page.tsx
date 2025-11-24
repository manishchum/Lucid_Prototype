"use client"

import type React from "react"
import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Brain, ArrowLeft, Eye, EyeOff } from "lucide-react"
import { supabase } from "@/lib/supabase"
import bcrypt from "bcryptjs"

export default function SignupPage() {
  const [formData, setFormData] = useState({
    companyName: "",
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    phoneNumber: ""
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [success, setSuccess] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const router = useRouter()

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const validateForm = () => {
    const missing: string[] = []
    let message = ""

    if (!formData.companyName.trim()) missing.push("companyName")
    if (!formData.name.trim()) missing.push("name")
    if (!formData.email.trim()) missing.push("email")
    if (!formData.password) missing.push("password")
    if (formData.password && formData.password.length < 8) {
      missing.push("password_length")
      message = "Password must be at least 8 characters long"
    }
    if (formData.password !== formData.confirmPassword) {
      missing.push("confirmPassword")
      message = "Passwords do not match"
    }
    if (!formData.phoneNumber.trim()) missing.push("phoneNumber")

    if (!message && missing.length > 0) {
      // default human message for missing fields
      message = `${missing.length} required field(s) are missing: ${missing.join(", ")}`
    }

    return { valid: missing.length === 0 && !message, missingFields: missing, message }
  }

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError("")
    setSuccess("")

    const { valid, missingFields, message: validationMessage } = validateForm()
    if (!valid) {
      const msg = validationMessage || "Please fill the required fields"
      setError(msg)

      // send a non-blocking log about the validation failure so we capture attempts
      try {
        const ua = typeof navigator !== 'undefined' ? navigator.userAgent : null
        const platform = typeof navigator !== 'undefined' ? (navigator as any).platform || null : null
        const payload = JSON.stringify({
          email_id: (typeof window !== 'undefined' && window.localStorage) ? localStorage.getItem('__CURRENT_USER_EMAIL__') : null,
          error: msg,
          error_type: 'ValidationError',
          action: 'SignupAttempt',
          page_url: typeof window !== 'undefined' ? window.location.href : null,
          browser: ua,
          os: platform,
          device: platform,
          stack_trace: new Error().stack || null,
          meta: { missingFields, // do not send full form values to avoid PII
            formPresent: {
              companyName: Boolean(formData.companyName),
              name: Boolean(formData.name),
              email: Boolean(formData.email),
              phoneNumber: Boolean(formData.phoneNumber),
            }
          }
        })

        if (typeof navigator !== 'undefined' && (navigator as any).sendBeacon) {
          const blob = new Blob([payload], { type: 'application/json' })
          try { (navigator as any).sendBeacon('/api/logs', blob) } catch (e) { /* swallow */ }
        } else {
          // best-effort, keepalive so it can be sent when page unloads
          fetch('/api/logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload, keepalive: true }).catch(() => {})
        }
      } catch (e) {
        // ignore logging errors
      }

      setLoading(false)
      return
    }

    try {
      // First, check if the company exists in the companies table
      const { data: companyData, error: companyError } = await supabase
        .from("companies")
        .select("company_id")
        .eq("name", formData.companyName)
        .maybeSingle()

      if (companyError) {
        throw new Error("Error checking company: " + companyError.message)
      }

      if (!companyData) {
        setError("Company not found. Please contact your administrator to register your company first.")
        setLoading(false)
        return
      }

      // Check if user already exists
      const { data: existingUser } = await supabase
        .from("users")
        .select("email")
        .eq("email", formData.email)
        .maybeSingle()

      if (existingUser) {
        setError("User with this email already exists")
        setLoading(false)
        return
      }

      // Hash the password
      const saltRounds = 12
      const hashedPassword = await bcrypt.hash(formData.password, saltRounds)

      // Insert user into database with company_id
      const { data: newUser, error: insertError } = await supabase
        .from("users")
        .insert({
          company_id: companyData.company_id,
          name: formData.name,
          email: formData.email,
          password: hashedPassword,
          phone: formData.phoneNumber,
          created_at: new Date().toISOString(),
          hire_date:new Date().toISOString(),
          is_active: true
        })
        .select()
        .single()

      if (insertError) {
        throw new Error(insertError.message)
      }

      // Get the USER role ID from roles table
      const { data: roleData, error: roleError } = await supabase
        .from("roles")
        .select("role_id")
        .eq("name", "USER")
        .maybeSingle()

      if (roleError) {
        throw new Error("Error fetching USER role: " + roleError.message)
      }

      if (!roleData) {
        throw new Error("USER role not found in roles table")
      }

      // Assign USER role to the new user
      const { error: roleAssignmentError } = await supabase
        .from("user_role_assignments")
        .insert({
          user_id: newUser.user_id,
          role_id: roleData.role_id,
          scope_type: "COMPANY",
          assigned_by: newUser.user_id,
          scope_id: companyData.company_id,
          assigned_at: new Date().toISOString(),
          is_active: true
        })

      if (roleAssignmentError) {
        throw new Error("Error assigning role: " + roleAssignmentError.message)
      }

      setSuccess("Account created successfully! You can now login.")
      
      // Redirect to login page after 2 seconds
      setTimeout(() => {
        router.push('/login')
      }, 2000)

    } catch (error: any) {
      setError(error.message || "Failed to create account")
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

        {/* Signup Card */}
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
              Create Account
            </CardTitle>
            <p className="text-gray-600">
              Join Lucid and make your team extraordinary
            </p>
          </CardHeader>

          <CardContent className="space-y-6">
            <form onSubmit={handleSignup} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="companyName" className="text-sm font-medium text-gray-700">
                  Company Name
                </Label>
                <Input
                  id="companyName"
                  name="companyName"
                  type="text"
                  placeholder="Your Company"
                  value={formData.companyName}
                  onChange={handleInputChange}
                  className="h-11 border-gray-200 focus:border-blue-500 focus:ring-blue-500"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="name" className="text-sm font-medium text-gray-700">
                  Full Name
                </Label>
                <Input
                  id="name"
                  name="name"
                  type="text"
                  placeholder="John Doe"
                  value={formData.name}
                  onChange={handleInputChange}
                  className="h-11 border-gray-200 focus:border-blue-500 focus:ring-blue-500"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium text-gray-700">
                  Email Address
                </Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="your.email@company.com"
                  value={formData.email}
                  onChange={handleInputChange}
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
                    name="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="At least 8 characters"
                    value={formData.password}
                    onChange={handleInputChange}
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

              <div className="space-y-2">
                <Label htmlFor="confirmPassword" className="text-sm font-medium text-gray-700">
                  Confirm Password
                </Label>
                <div className="relative">
                  <Input
                    id="confirmPassword"
                    name="confirmPassword"
                    type={showConfirmPassword ? "text" : "password"}
                    placeholder="Confirm your password"
                    value={formData.confirmPassword}
                    onChange={handleInputChange}
                    className="h-11 border-gray-200 focus:border-blue-500 focus:ring-blue-500 pr-10"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="phoneNumber" className="text-sm font-medium text-gray-700">
                  Phone Number
                </Label>
                <Input
                  id="phoneNumber"
                  name="phoneNumber"
                  type="tel"
                  placeholder="+1 (555) 123-4567"
                  value={formData.phoneNumber}
                  onChange={handleInputChange}
                  className="h-11 border-gray-200 focus:border-blue-500 focus:ring-blue-500"
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
                  <AlertDescription>{success}</AlertDescription>
                </Alert>
              )}

              <Button
                type="submit"
                className="w-full h-11 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white font-medium transition-all duration-200"
                disabled={loading}
              >
                {loading ? "Creating Account..." : "Create Account"}
              </Button>
            </form>

            <div className="text-center text-sm text-gray-600">
              <p>
                Already have an account?{" "}
                <Link href="/login" className="text-blue-600 hover:text-blue-700 font-medium">
                  Sign in
                </Link>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center mt-8">
          <p className="text-sm text-gray-500">
            Secure signup powered by Lucid Learning Platform
          </p>
        </div>
      </div>
    </div>
  )
}