"use client"

import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Building2, Users, Brain, TrendingUp, Star, ChevronRight, ToggleLeft, ToggleRight } from "lucide-react"
import { useState } from "react"

export default function LandingPage() {
  const [isEmployeeView, setIsEmployeeView] = useState(true)

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
        <div className="flex items-center space-x-4">
          {/* View Toggle */}
          <div className="flex items-center space-x-3 bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setIsEmployeeView(false)}
              className={`flex items-center space-x-2 px-3 py-2 rounded-md transition-all duration-200 ${
                !isEmployeeView 
                  ? "bg-white text-gray-900 shadow-sm" 
                  : "text-gray-600 hover:text-gray-800"
              }`}
            >
              <Building2 className="w-4 h-4" />
              <span className="text-sm font-medium">Admin Login</span>
            </button>
            <button
              onClick={() => setIsEmployeeView(true)}
              className={`flex items-center space-x-2 px-3 py-2 rounded-md transition-all duration-200 ${
                isEmployeeView 
                  ? "bg-white text-gray-900 shadow-sm" 
                  : "text-gray-600 hover:text-gray-800"
              }`}
            >
              <Users className="w-4 h-4" />
              <span className="text-sm font-medium">Learner Login</span>
            </button>
          </div>

          {/* Single Login Button based on current view */}
        {/*  {isEmployeeView ? (
            <Link href="/employee/login">
              <Button className="bg-blue-600 hover:bg-blue-700 text-white px-6">
                Learner Login
              </Button>
            </Link>
          ) : (
            <Link href="/admin/login">
              <Button variant="outline" className="border-gray-300 hover:border-gray-400 hover:bg-gray-50 px-6">
                Admin Login
              </Button>
            </Link>
          )} */}
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex flex-col items-center justify-center px-6 py-16">
        <div className="max-w-4xl w-full text-center">
          {/* Dynamic Heading based on view */}
          <h1 className="text-6xl md:text-6xl font-bold mb-6 text-gray-900">
            {isEmployeeView ? (
              <>
                {/* Lucid
                <br />
                <br/> */}
                <span className="text-blue-600">Unlock What You're Truly Capable Of</span>
              </>
            ) : (
              <>
                Streamline Your
                <br />
                <span className="text-gray-700">Organization</span>
              </>
            )}
          </h1>
          
          {/* Dynamic Description based on view */}
          <p className="text-xl text-gray-600 mb-12 max-w-2xl mx-auto leading-relaxed">
            {isEmployeeView ? (
              <>
                Lucid - Your learning companion which aligns learning with how you learn best and guides you through a clear & personalized path
                <br />
                Lucid helps you learn the way you were meant to.
              </>
            ) : (
              "Comprehensive admin dashboard to manage employees, track KPIs, oversee training programs, and drive organizational growth effectively."
            )}
          </p>

          {/* Single Portal Card based on current view */}
          <div className="flex justify-center mb-16">
            {isEmployeeView ? (
              <Card className="group relative overflow-hidden border border-gray-200 bg-white hover:shadow-lg transition-all duration-300 hover:scale-105 max-w-md w-full">
                <CardHeader className="text-center">
                  {/* <div className="mx-auto w-20 h-20 bg-blue-50 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-blue-100 transition-colors duration-300"> */}
                    {/* <Users className="w-10 h-10 text-blue-600" /> */}
                  {/* </div> */}
                  {/* <CardTitle className="text-3xl text-gray-900 mb-3">Login Here!</CardTitle> */}
                  <CardTitle className="text-3xl text-gray-600 mb-6 text-base">
                    Discover Your Limitless Potential Today
                  </CardTitle>
                  
                  {/* Feature Tags */}
                  <div className="flex flex-wrap justify-center gap-2 mb-6">
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-blue-50 text-blue-700">
                      ✓ AI-Powered Learning
                    </span>
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-700">
                      ✓ Progress Tracking
                    </span>
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-blue-50 text-blue-700">
                      ✓ Engaging Experience
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="text-center">
                  <Link href="/employee/login">
                    <Button size="lg" className="w-full bg-blue-600 hover:bg-blue-700 text-white group text-lg py-4">
                      Start Your Journey
                      <ChevronRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ) : (
              <Card className="group relative overflow-hidden border border-gray-200 bg-white hover:shadow-lg transition-all duration-300 hover:scale-105 max-w-md w-full">
                <CardHeader className="text-center">
                  <div className="mx-auto w-20 h-20 bg-gray-50 rounded-2xl flex items-center justify-center mb-6 group-hover:bg-gray-100 transition-colors duration-300">
                    <Building2 className="w-10 h-10 text-gray-700" />
                  </div>
                  <CardTitle className="text-3xl text-gray-900 mb-3">Admin Portal</CardTitle>
                  <CardDescription className="text-gray-600 mb-6 text-base">
                    Manage employees, track KPIs, oversee training programs, and drive organizational growth with comprehensive analytics
                  </CardDescription>
                  
                  {/* Feature Tags */}
                  <div className="flex flex-wrap justify-center gap-2 mb-6">
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-700">
                      ✓ Employee Management
                    </span>
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-700">
                      ✓ KPI Tracking
                    </span>
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-700">
                      ✓ Analytics Dashboard
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="text-center">
                  <Link href="/admin/login">
                    <Button size="lg" variant="outline" className="w-full border-2 border-gray-300 hover:border-gray-400 hover:bg-gray-50 group text-lg py-4">
                      Access Dashboard
                      <ChevronRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Dynamic Feature Highlights based on view */}
          <div className="grid md:grid-cols-3 gap-8">
            {isEmployeeView ? (
              <>
                <div className="text-center group">
                  <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mb-4 mx-auto group-hover:bg-blue-100 transition-colors duration-300">
                    <Brain className="w-8 h-8 text-blue-600" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">AI-Powered Learning</h3>
                  <p className="text-gray-600 text-sm">
                    Personalized content and assessments based on your unique learning style
                  </p>
                </div>

                <div className="text-center group">
                  <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mb-4 mx-auto group-hover:bg-blue-100 transition-colors duration-300">
                    <TrendingUp className="w-8 h-8 text-blue-600" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Progress Tracking</h3>
                  <p className="text-gray-600 text-sm">
                    Real-time insights into your learning journey and skill development
                  </p>
                </div>

                <div className="text-center group">
                  <div className="w-16 h-16 bg-blue-50 rounded-2xl flex items-center justify-center mb-4 mx-auto group-hover:bg-blue-100 transition-colors duration-300">
                    <Star className="w-8 h-8 text-blue-600" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Engaging Experience</h3>
                  <p className="text-gray-600 text-sm">
                    Interactive modules with gamification and achievement rewards
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="text-center group">
                  <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mb-4 mx-auto group-hover:bg-gray-100 transition-colors duration-300">
                    <Users className="w-8 h-8 text-gray-700" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Employee Management</h3>
                  <p className="text-gray-600 text-sm">
                    Comprehensive tools to manage team members and track their progress
                  </p>
                </div>

                <div className="text-center group">
                  <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mb-4 mx-auto group-hover:bg-gray-100 transition-colors duration-300">
                    <TrendingUp className="w-8 h-8 text-gray-700" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Analytics Dashboard</h3>
                  <p className="text-gray-600 text-sm">
                    Real-time KPI tracking and comprehensive performance analytics
                  </p>
                </div>

                <div className="text-center group">
                  <div className="w-16 h-16 bg-gray-50 rounded-2xl flex items-center justify-center mb-4 mx-auto group-hover:bg-gray-100 transition-colors duration-300">
                    <Building2 className="w-8 h-8 text-gray-700" />
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">Organization Control</h3>
                  <p className="text-gray-600 text-sm">
                    Streamlined administration and organizational workflow management
                  </p>
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
