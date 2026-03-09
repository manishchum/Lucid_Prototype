"use client"

import type React from "react"
import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Brain, ArrowLeft, Eye, EyeOff, Search } from "lucide-react"
import { supabase } from "@/lib/supabase"
import bcrypt from "bcryptjs"

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

interface CompanySuggestion {
  company_id: string
  name: string
  domain: string
}

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
  const [companySuggestions, setCompanySuggestions] = useState<CompanySuggestion[]>([])
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [searchingCompany, setSearchingCompany] = useState(false)
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null)
  const suggestionRef = useRef<HTMLDivElement>(null)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const router = useRouter()

  // Close suggestions when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (suggestionRef.current && !suggestionRef.current.contains(event.target as Node)) {
        setShowSuggestions(false)
      }
    }

    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  // Search companies with debounce
  const searchCompanies = async (searchTerm: string) => {
    if (searchTerm.length < 2) {
      setCompanySuggestions([])
      setShowSuggestions(false)
      return
    }

    setSearchingCompany(true)
    try {
      const response = await fetch(`${API_BASE}/api/companies/search?q=${encodeURIComponent(searchTerm)}&limit=10`)
      if (response.ok) {
        const data = await response.json()
        setCompanySuggestions(data.companies || [])
        setShowSuggestions(true)
      } else {
        setCompanySuggestions([])
        setShowSuggestions(false)
      }
    } catch (err) {
      console.error("Error searching companies:", err)
      setCompanySuggestions([])
      setShowSuggestions(false)
    } finally {
      setSearchingCompany(false)
    }
  }

  const handleCompanyInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setFormData(prev => ({ ...prev, companyName: value }))
    setSelectedCompanyId(null)

    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    // Set new timeout for debounced search
    searchTimeoutRef.current = setTimeout(() => {
      searchCompanies(value)
    }, 300)
  }

  const handleCompanySelect = (company: CompanySuggestion) => {
    setFormData(prev => ({ ...prev, companyName: company.name }))
    setSelectedCompanyId(company.company_id)
    setShowSuggestions(false)
    setCompanySuggestions([])
  }

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
      // Get company data - use selectedCompanyId if available from dropdown selection
      let companyData: any = null;
      
      if (selectedCompanyId) {
        // Company was selected from dropdown, fetch by ID
        const companyRes = await fetch(`${API_BASE}/api/companies/${selectedCompanyId}`)
        if (!companyRes.ok) {
          setError("Failed to verify company. Please try again.");
          setLoading(false);
          return;
        }
        const companyPayload = await companyRes.json();
        companyData = companyPayload?.company ?? companyPayload;
      } else {
        // Manual entry, search by name
        const companyRes = await fetch(`${API_BASE}/api/companies/by-name/${encodeURIComponent(formData.companyName)}`)
        
        if (!companyRes.ok) {
          if (companyRes.status === 404) {
            setError("Company not found. Please select from the suggestions or contact support.");
            setLoading(false);
            return;
          } else {
            const txt = await companyRes.text().catch(() => "");
            throw new Error(`Error checking company: ${companyRes.status} ${txt}`);
          }
        }
        
        const companyPayload = await companyRes.json();
        companyData = companyPayload?.company ?? companyPayload;
      }
      
      if (!companyData || !companyData.company_id) {
        setError("Company not found. Please select from the suggestions or contact support.");
        setLoading(false);
        return;
      }
    
      // Check if user already exists
      const cheskRes = await fetch(`${API_BASE}/api/users/by-email/${encodeURIComponent(formData.email)}`)
      if (cheskRes.ok) {
        setError("An account with this email already exists. Please login instead.")
        setLoading(false)
        return
      } else if (cheskRes.status !== 404 && cheskRes.status !== 422) {
        const txt = await cheskRes.text().catch(() => "")
        throw new Error(`Error checking existing user: ${cheskRes.status} ${txt}`)
      }

      // Hash the password
      const saltRounds = 12
      const hashedPassword = await bcrypt.hash(formData.password, saltRounds)

      // Insert user into database with company_id
      const createRes = await fetch(`${API_BASE}/api/users/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          company_id: companyData.company_id,
          name: formData.name,
          email: formData.email,
          password: hashedPassword,
          phone_number: formData.phoneNumber,
          hire_date: new Date().toISOString(),
          is_active: true
        })
      })

      if (!createRes.ok) {
        const errText = await createRes.text().catch(() => "")
        throw new Error(`Failed to create account: ${createRes.status} ${errText}`)
      }

      const createPayload = await createRes.json().catch(() => null)

      const userData = Array.isArray(createPayload.user) 
        ? createPayload.user[0] 
        : createPayload.user;
      console.log("These are the payloads")
      console.log(createPayload);
      console.log(createRes);
      const newUser = (userData && (userData.user || userData)) || null


      console.log("new user payload")
      console.log(userData)
      if (!userData.user_id) {
        throw new Error("User created but response is missing user_id")
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
      const assignRes = await fetch(`${API_BASE}/api/roles/assignments`,{
        method: "POST",
        headers: { 
          "Content-Type": "application/json", 
          "X-User-Id": newUser.user_id
        },
        body: JSON.stringify({
          user_id: newUser.user_id,
          role_id: roleData.role_id,
          scope_type: "COMPANY",
          scope_id: companyData.company_id,
          assigned_by: newUser.user_id,
          assigned_at: new Date().toISOString(),
          expires_at: new Date(), // no expiration
          is_active: true,
          notes: "Assigned during signup"
        })
      })

      if (!assignRes.ok) {
        const errText = await assignRes.text().catch(() => "")
        throw new Error(`Failed to assign USER role: ${assignRes.status} ${errText}`)
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
              <div className="space-y-2 relative" ref={suggestionRef}>
                <Label htmlFor="companyName" className="text-sm font-medium text-gray-700">
                  Company Name
                </Label>
                <div className="relative">
                  <Input
                    id="companyName"
                    name="companyName"
                    type="text"
                    placeholder="Start typing your company name..."
                    value={formData.companyName}
                    onChange={handleCompanyInputChange}
                    className="h-11 border-gray-200 focus:border-blue-500 focus:ring-blue-500 pr-10"
                    required
                    autoComplete="off"
                  />
                  {searchingCompany && (
                    <div className="absolute right-3 top-1/2 transform -translate-y-1/2">
                      <Search className="w-4 h-4 text-gray-400 animate-pulse" />
                    </div>
                  )}
                </div>
                
                {/* Company Suggestions Dropdown */}
                {showSuggestions && companySuggestions.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-60 overflow-y-auto">
                    {companySuggestions.map((company) => (
                      <button
                        key={company.company_id}
                        type="button"
                        onClick={() => handleCompanySelect(company)}
                        className="w-full px-4 py-3 text-left hover:bg-blue-50 transition-colors border-b border-gray-100 last:border-b-0 flex flex-col"
                      >
                        <span className="font-medium text-gray-900">{company.name}</span>
                        <span className="text-sm text-gray-500">{company.domain}</span>
                      </button>
                    ))}
                  </div>
                )}

                {showSuggestions && companySuggestions.length === 0 && !searchingCompany && formData.companyName.length >= 2 && (
                  <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-md shadow-lg p-4">
                    <p className="text-sm text-gray-500">No companies found. Please check the spelling or contact support.</p>
                  </div>
                )}
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