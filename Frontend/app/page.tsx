import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Building2, Users, Brain, TrendingUp, Star, ChevronRight } from "lucide-react"

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-4 bg-white shadow-sm border-b border-gray-200">
        <div className="flex items-center space-x-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
            <Brain className="w-5 h-5 text-white" />
          </div>
          <span className="text-xl font-bold text-gray-900">
            Lucid
          </span>
        </div>
        <div className="flex items-center space-x-3">
          <Link href="/admin/login">
            <Button variant="ghost" className="text-gray-600 hover:text-blue-600">
              Admin Portal
            </Button>
          </Link>
          <Link href="/employee/login">
            <Button className="bg-blue-600 hover:bg-blue-700 text-white px-6">
              Employee Login
            </Button>
          </Link>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex flex-col items-center justify-center px-6 py-16">
        <div className="max-w-4xl w-full text-center">
          <h1 className="text-5xl md:text-6xl font-bold mb-6 text-gray-900">
            Transform Your
            <br />
            <span className="text-blue-600">Learning Experience</span>
          </h1>
          
          <p className="text-xl text-gray-600 mb-12 max-w-2xl mx-auto leading-relaxed">
            AI-powered platform that creates personalized learning journeys, 
            streamlines administration, and delivers exceptional employee 
            experiences from day one.
          </p>

          {/* Portal Cards */}
          <div className="grid md:grid-cols-2 gap-8 mb-16">
            {/* Employee Portal */}
            <Card className="group relative overflow-hidden border border-gray-200 bg-white hover:shadow-lg transition-all duration-300 hover:scale-105">
              <CardHeader className="text-center">
                <div className="mx-auto w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mb-4 group-hover:bg-blue-100 transition-colors duration-300">
                  <Users className="w-8 h-8 text-blue-600" />
                </div>
                <CardTitle className="text-2xl text-gray-900 mb-2">Employee Portal</CardTitle>
                <CardDescription className="text-gray-600 mb-6">
                  Access your personalized learning journey, track progress, and complete assessments
                </CardDescription>
                
                {/* Feature Tags */}
                <div className="flex flex-wrap justify-center gap-2 mb-4">
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-700">
                    ✓ Personalized Learning
                  </span>
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-50 text-blue-700">
                    ✓ Progress Tracking
                  </span>
                </div>
              </CardHeader>
              <CardContent className="text-center">
                <Link href="/employee/login">
                  <Button size="lg" className="w-full bg-blue-600 hover:bg-blue-700 text-white group">
                    Get Started
                    <ChevronRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                  </Button>
                </Link>
              </CardContent>
            </Card>

            {/* Admin Portal */}
            <Card className="group relative overflow-hidden border border-gray-200 bg-white hover:shadow-lg transition-all duration-300 hover:scale-105">
              <CardHeader className="text-center">
                <div className="mx-auto w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mb-4 group-hover:bg-gray-100 transition-colors duration-300">
                  <Building2 className="w-8 h-8 text-gray-700" />
                </div>
                <CardTitle className="text-2xl text-gray-900 mb-2">Admin Portal</CardTitle>
                <CardDescription className="text-gray-600 mb-6">
                  Manage employees, track KPIs, and oversee organizational employee processes
                </CardDescription>
                
                {/* Feature Tags */}
                <div className="flex flex-wrap justify-center gap-2 mb-4">
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-gray-100 text-gray-700">
                    ✓ User Management
                  </span>
                </div>
              </CardHeader>
              <CardContent className="text-center">
                <Link href="/admin/login">
                  <Button size="lg" variant="outline" className="w-full border-2 border-gray-300 hover:border-gray-400 hover:bg-gray-50 group">
                    Access Portal
                    <ChevronRight className="w-4 h-4 ml-2 group-hover:translate-x-1 transition-transform" />
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </div>

          {/* Feature Highlights */}
          <div className="grid md:grid-cols-3 gap-8">
            <div className="text-center group">
              <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mb-4 mx-auto group-hover:bg-blue-100 transition-colors duration-300">
                <Brain className="w-8 h-8 text-blue-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">AI-Powered Learning</h3>
              <p className="text-gray-600 text-sm">
                Personalized content and assessments based on learning styles
              </p>
            </div>

            <div className="text-center group">
              <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mb-4 mx-auto group-hover:bg-gray-100 transition-colors duration-300">
                <TrendingUp className="w-8 h-8 text-gray-700" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Progress Analytics</h3>
              <p className="text-gray-600 text-sm">
                Real-time insights and performance tracking
              </p>
            </div>

            <div className="text-center group">
              <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mb-4 mx-auto group-hover:bg-blue-100 transition-colors duration-300">
                <Star className="w-8 h-8 text-blue-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">Engaging Experience</h3>
              <p className="text-gray-600 text-sm">
                Interactive modules with gamification and rewards
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
