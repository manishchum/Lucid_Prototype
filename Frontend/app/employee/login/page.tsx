import { Suspense } from "react"
import Link from "next/link"
import { ArrowLeft, Users, Check } from "lucide-react"
import EmployeeLoginForm from "./login-form"

export default function EmployeeLogin() {
  return (
    <div className="min-h-screen flex">
      {/* Left Side - Blue Gradient */}
      <div className="hidden lg:flex lg:w-1/2 bg-gradient-to-br from-blue-600 to-blue-800 flex-col justify-center items-center text-white p-12 relative overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-20 w-32 h-32 rounded-full border border-white/20"></div>
          <div className="absolute bottom-32 right-16 w-24 h-24 rounded-full border border-white/20"></div>
          <div className="absolute top-1/2 right-32 w-16 h-16 rounded-full border border-white/20"></div>
        </div>
        
        {/* Content */}
        <div className="relative z-10 text-center max-w-md">
          {/* Icon */}
          <div className="w-20 h-20 bg-white/20 rounded-2xl flex items-center justify-center mb-8 mx-auto backdrop-blur-sm">
            <Users className="w-10 h-10 text-white" />
          </div>
          
          {/* Title */}
          <h1 className="text-4xl font-bold mb-4">Employee Portal</h1>
          
          {/* Description */}
          <p className="text-lg text-blue-100 mb-8 leading-relaxed">
            Your personalized learning journey awaits. 
            Access training modules, track your progress, 
            and unlock your potential.
          </p>
          
          {/* Features List */}
          <div className="space-y-4 text-left">
            <div className="flex items-center space-x-3">
              <div className="w-5 h-5 bg-white rounded-full flex items-center justify-center flex-shrink-0">
                <Check className="w-3 h-3 text-blue-600" />
              </div>
              <span className="text-blue-100">Personalized AI-powered assessments</span>
            </div>
            <div className="flex items-center space-x-3">
              <div className="w-5 h-5 bg-white rounded-full flex items-center justify-center flex-shrink-0">
                <Check className="w-3 h-3 text-blue-600" />
              </div>
              <span className="text-blue-100">Interactive learning modules</span>
            </div>
            <div className="flex items-center space-x-3">
              <div className="w-5 h-5 bg-white rounded-full flex items-center justify-center flex-shrink-0">
                <Check className="w-3 h-3 text-blue-600" />
              </div>
              <span className="text-blue-100">Real-time progress tracking</span>
            </div>
          </div>
        </div>
      </div>

      {/* Right Side - Login Form */}
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
          <div className="w-full max-w-md">
            {/* Welcome Header */}
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-gray-900 mb-2">Welcome Back</h2>
              <p className="text-gray-600">Sign in to your employee account</p>
            </div>

            {/* Login Form */}
            <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
              <Suspense fallback={
                <div className="animate-pulse space-y-4">
                  <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                  <div className="h-10 bg-gray-200 rounded"></div>
                  <div className="h-4 bg-gray-200 rounded w-1/4"></div>
                  <div className="h-10 bg-gray-200 rounded"></div>
                  <div className="h-10 bg-gray-200 rounded"></div>
                </div>
              }>
                <EmployeeLoginForm />
              </Suspense>
            </div>

            {/* Help Text */}
            <div className="text-center mt-6">
              <p className="text-sm text-gray-500">
                Need help? Contact your{" "}
                <Link href="/admin/login" className="text-blue-600 hover:text-blue-800 font-medium">
                  HR Administrator
                </Link>
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
