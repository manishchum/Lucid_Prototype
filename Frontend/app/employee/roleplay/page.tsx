"use client";

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, Loader2 } from 'lucide-react';
import EmployeeNavigation from '@/components/employee-navigation';
import { useAuth } from '@/contexts/auth-context';
import { Scenario, AppScreen, Message } from '@/lib/roleplay/types';
import { SCENARIOS } from '@/lib/roleplay/constants';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import RolePlayConversation from '@/components/roleplay/RolePlayConversation';
import AssessmentReportComponent from '@/components/roleplay/AssessmentReport';

interface AssessmentReport {
  overallScore: number;
  summary: string;
  parameters: Array<{
    name: string;
    score: number;
    feedback: string;
  }>;
  recommendations: string[];
}

export default function RolePlayPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const moduleId = searchParams.get('moduleId');
  const moduleTitle = searchParams.get('moduleTitle');
  
  const [currentScreen, setCurrentScreen] = useState<AppScreen>('scenarioSelection');
  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null);
  const [conversationHistory, setConversationHistory] = useState<Message[]>([]);
  const [assessmentReport, setAssessmentReport] = useState<AssessmentReport | null>(null);
  const [isGeneratingAssessment, setIsGeneratingAssessment] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  const handleScenarioSelect = (scenario: Scenario) => {
    setSelectedScenario(scenario);
    setCurrentScreen('rolePlay');
    setError(null);
  };

  const handleBackToScenarios = () => {
    setSelectedScenario(null);
    setConversationHistory([]);
    setCurrentScreen('scenarioSelection');
    setError(null);
  };

  const handleEndSession = async (messages: Message[]) => {
    setConversationHistory(messages);
    setIsGeneratingAssessment(true);
    setError(null);

    try {
      const response = await fetch('/api/roleplay/assessment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages,
          scenarioTitle: selectedScenario?.title,
          scenarioRole: selectedScenario?.role
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate assessment');
      }

      const assessment = await response.json();
      setAssessmentReport(assessment);
      setCurrentScreen('assessmentReport');

    } catch (err: any) {
      console.error('Assessment error:', err);
      setError(err.message || 'Failed to generate assessment report');
    } finally {
      setIsGeneratingAssessment(false);
    }
  };

  const handleStartNew = () => {
    setSelectedScenario(null);
    setConversationHistory([]);
    setAssessmentReport(null);
    setCurrentScreen('scenarioSelection');
    setError(null);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-slate-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <EmployeeNavigation />
      
      <div className="container mx-auto px-4 py-6 max-w-6xl">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
            <span className="font-medium">Back to Module</span>
          </button>
          
          <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-200">
            <div className="flex items-center gap-3">
              <div className="text-4xl">🎭</div>
              <div>
                <h1 className="text-2xl font-bold text-slate-900">Sales Role Play</h1>
                {moduleTitle && (
                  <p className="text-slate-600 mt-1">Practice pitch for: {decodeURIComponent(moduleTitle)}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Error Display */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
            <p className="text-red-800"><strong>Error:</strong> {error}</p>
            <Button onClick={handleStartNew} variant="outline" className="mt-3">
              Start Over
            </Button>
          </div>
        )}

        {/* Main Content */}
        {currentScreen === 'scenarioSelection' && (
          <div className="bg-white rounded-xl shadow-sm p-8 border border-slate-200">
            <h2 className="text-3xl font-bold text-gray-800 mb-2 text-center">
              Choose Your <span className="text-purple-600">Role-Play</span> Scenario
            </h2>
            <p className="text-center text-slate-600 mb-8">
              Select a scenario to start practicing your skills
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              {SCENARIOS.map((scenario) => (
                <Card
                  key={scenario.id}
                  className={`cursor-pointer p-6 hover:border-blue-400 hover:shadow-lg transition-all ${
                    selectedScenario?.id === scenario.id
                      ? 'border-2 border-blue-500 shadow-lg'
                      : 'border border-slate-200'
                  }`}
                  onClick={() => setSelectedScenario(scenario)}
                >
                  <h3 className="text-xl font-semibold text-gray-800 mb-3">{scenario.title}</h3>
                  <p className="text-gray-600 mb-4 text-sm">{scenario.description}</p>
                  <div className="flex justify-between items-center text-sm font-medium">
                    <span className="bg-blue-100 text-blue-800 px-3 py-1 rounded-full">{scenario.role}</span>
                    <span className={`px-3 py-1 rounded-full ${
                      scenario.difficulty === 'Easy' ? 'bg-green-100 text-green-800' :
                      scenario.difficulty === 'Medium' ? 'bg-yellow-100 text-yellow-800' :
                      'bg-red-100 text-red-800'
                    }`}>
                      {scenario.difficulty}
                    </span>
                  </div>
                </Card>
              ))}
            </div>

            <div className="flex justify-center">
              <Button
                onClick={() => selectedScenario && handleScenarioSelect(selectedScenario)}
                disabled={!selectedScenario}
                className="px-8 py-3 text-lg"
              >
                Start Role-Play
              </Button>
            </div>
          </div>
        )}

        {currentScreen === 'rolePlay' && selectedScenario && (
          <div>
            <RolePlayConversation
              scenario={selectedScenario}
              onEndSession={handleEndSession}
            />
          </div>
        )}

        {currentScreen === 'assessmentReport' && (
          isGeneratingAssessment ? (
            <div className="bg-white rounded-xl shadow-sm p-12 text-center border border-slate-200">
              <Loader2 className="w-16 h-16 animate-spin text-blue-600 mx-auto mb-4" />
              <h3 className="text-xl font-semibold text-slate-800 mb-2">Analyzing Your Performance...</h3>
              <p className="text-slate-600">Please wait while we generate your assessment report</p>
            </div>
          ) : assessmentReport && selectedScenario ? (
            <AssessmentReportComponent
              report={assessmentReport}
              scenarioTitle={selectedScenario.title}
              onStartNew={handleStartNew}
            />
          ) : (
            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
              <p className="text-yellow-800">No assessment data available.</p>
              <Button onClick={handleStartNew} className="mt-4">
                Start New Role-Play
              </Button>
            </div>
          )
        )}
      </div>
    </div>
  );
}
