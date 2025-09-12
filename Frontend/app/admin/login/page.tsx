import { Suspense } from "react"
import Link from "next/link"
import { ArrowLeft, Shield, Check } from "lucide-react"
import AdminLoginForm from "./login-form"

export default function AdminLogin() {
  return (
    <div className="min-h-screen flex">
      {/* Left Side - Login Form */}
      <div className="w-full lg:w-1/2 bg-gray-50 flex flex-col">
        {/* Header with Back Link */}
        <div className="p-6">
          <Link 
            href="/" 
            className="inline-flex items-center text-gray-600 hover:text-blue-600 transition-colors"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Link>
        </div>

        {/* Login Form Container */}
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm">
            {/* Login Form */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
              {/* Header */}
              <div className="text-center mb-6">
                <h2 className="text-2xl font-bold text-gray-900 mb-1">Admin Portal</h2>
                <p className="text-gray-600 text-sm">Secure access for administrators</p>
              </div>

              <Suspense fallback={
                <div className="animate-pulse space-y-4">
                  <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                  <div className="h-10 bg-gray-200 rounded"></div>
                  <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                  <div className="h-10 bg-gray-200 rounded"></div>
                  <div className="h-10 bg-gray-200 rounded"></div>
                </div>
              }>
                <AdminLoginForm />
              </Suspense>

              {/* Security Notice */}
              <div className="mt-6 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <h4 className="text-sm font-medium text-gray-900 mb-1">Security Notice</h4>
                <p className="text-xs text-gray-600">
                  Admin access is monitored and logged. Only authorized personnel can access this portal.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Blue Gradient */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-blue-600 to-blue-800 flex-col justify-center items-center text-white p-12 relative overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 right-20 w-32 h-32 rounded-full border border-white/20"></div>
          <div className="absolute bottom-32 left-16 w-24 h-24 rounded-full border border-white/20"></div>
          <div className="absolute top-1/2 left-32 w-16 h-16 rounded-full border border-white/20"></div>
        </div>
        
        {/* Content */}
        <div className="relative z-10 text-center max-w-md">
          {/* Icon */}
          <div className="w-20 h-20 bg-white/20 rounded-2xl flex items-center justify-center mb-8 mx-auto backdrop-blur-sm">
            <Shield className="w-10 h-10 text-white" />
          </div>
          
          {/* Title */}
          <h1 className="text-4xl font-bold mb-4">Admin Dashboard</h1>
          
          {/* Description */}
          <p className="text-lg text-blue-100 mb-8 leading-relaxed">
            Comprehensive management tools for overseeing employee onboarding, tracking KPIs, and analyzing organizational performance.
          </p>
          
          {/* Features List */}
          <div className="space-y-4 text-left">
            <div className="flex items-center space-x-3">
              <div className="w-5 h-5 bg-white rounded-full flex items-center justify-center flex-shrink-0">
                <Check className="w-3 h-3 text-blue-600" />
              </div>
              <span className="text-blue-100">Employee management & analytics</span>
            </div>
            <div className="flex items-center space-x-3">
              <div className="w-5 h-5 bg-white rounded-full flex items-center justify-center flex-shrink-0">
                <Check className="w-3 h-3 text-blue-600" />
              </div>
              <span className="text-blue-100">KPI tracking & benchmarking</span>
            </div>
            <div className="flex items-center space-x-3">
              <div className="w-5 h-5 bg-white rounded-full flex items-center justify-center flex-shrink-0">
                <Check className="w-3 h-3 text-blue-600" />
              </div>
              <span className="text-blue-100">Training content management</span>
            </div>
            <div className="flex items-center space-x-3">
              <div className="w-5 h-5 bg-white rounded-full flex items-center justify-center flex-shrink-0">
                <Check className="w-3 h-3 text-blue-600" />
              </div>
              <span className="text-blue-100">Advanced reporting & insights</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
