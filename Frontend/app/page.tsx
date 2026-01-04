"use client"

import Link from "next/link"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Brain, TrendingUp, Star, ChevronRight } from "lucide-react"

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
        
        <Link href="/login">
          <Button variant="outline" className="border-blue-600 text-blue-600 hover:bg-blue-600 hover:text-white">
            Login
          </Button>
        </Link>
      </header>

      {/* Hero Section */}
      <main className="flex flex-col items-center justify-center px-6 py-16">
        <div className="max-w-4xl w-full text-center">
          {/* Heading */}
          <h1 className="text-6xl md:text-6xl font-bold mb-6 text-gray-900">
            <span className="text-blue-600">Unlock What You're Truly Capable Of</span>
          </h1>
          
          {/* Description */}
          <p className="text-xl text-gray-600 mb-12 max-w-2xl mx-auto leading-relaxed">
            Lucid - Your learning companion which aligns learning with how you learn best and guides you through a clear & personalized path
            <br />
            Lucid helps you learn the way you were meant to.
          </p>

          {/* Single Login Card */}
          <div className="flex justify-center mb-16">
            <Card className="group relative overflow-hidden border border-gray-200 bg-white hover:shadow-lg transition-all duration-300 hover:scale-105 max-w-md w-full">
              <CardHeader className="text-center">
                <CardTitle className="text-3xl text-gray-600 mb-6 ">
                  Discover Your Limitless Potential Today
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
                <Link href="/login">
                  <Button size="lg" className="w-full bg-blue-600 hover:bg-blue-700 text-white group text-lg py-4">
                    Start Your Journey
                    <ChevronRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
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
          </div>
        </div>
      </main>
    </div>
  )
}
