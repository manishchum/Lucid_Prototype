"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Loader2 } from 'lucide-react';
import EmployeeNavigation from '@/components/employee-navigation';
import { useAuth } from '@/contexts/auth-context';
import { Scenario, AppScreen, Message } from '@/lib/roleplay/types';
import { SCENARIOS } from '@/lib/roleplay/constants';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import RolePlayConversation from '@/components/roleplay/RolePlayConversation';
import RoleplayConfigPage, { RoleplayConfig } from '@/components/roleplay/RoleplayConfigPage';
import AssessmentReportComponent from '@/components/roleplay/AssessmentReport';
import { createRolePlayAssessment } from '@/lib/roleplayDatabase';
import { supabase } from '@/lib/supabase';

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

export default function RolePlayPage({ params }: { params: { module_id: string, moduleTitle: string, custom: string } }) {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  // const searchParams = useSearchParams();
  const moduleId = params.module_id;
  const moduleTitle = params.moduleTitle;
  const isCustom = (params.custom) === 'true';
  
  const [currentScreen, setCurrentScreen] = useState<AppScreen>('scenarioSelection');
  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null);
  const [roleplayConfig, setRoleplayConfig] = useState<RoleplayConfig | null>(null);
  const [conversationHistory, setConversationHistory] = useState<Message[]>([]);
  const [assessmentReport, setAssessmentReport] = useState<AssessmentReport | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [isGeneratingAssessment, setIsGeneratingAssessment] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customScenario, setCustomScenario] = useState({
    title: '',
    description: '',
    aiRole: '',
    userRole: '',
    initialPrompt: '',
    difficulty: 'Medium' as 'Easy' | 'Medium' | 'Hard',
    tone: 'Neutral' as 'Friendly' | 'Neutral' | 'Aggressive'
  });

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  // Load custom scenario from sessionStorage if custom=true
  useEffect(() => {
    if (isCustom) {
      const customScenarioData = sessionStorage.getItem('customScenario');
      if (customScenarioData) {
        try {
          const scenario = JSON.parse(customScenarioData);
          setSelectedScenario(scenario);
          setCurrentScreen('config'); // Show config page first
          // Clear the sessionStorage after loading
          sessionStorage.removeItem('customScenario');
        } catch (error) {
          console.error('Error loading custom scenario:', error);
          setError('Failed to load custom scenario');
        }
      }
    }
  }, [isCustom]);

  // Fetch employee ID from Supabase
  useEffect(() => {
    const fetchEmployeeId = async () => {
      if (user?.email) {
        try {
          const { data, error } = await supabase
            .from('users')
            .select('user_id')
            .eq('email', user.email)
            .single();

          if (error) {
            console.error('Error fetching employee ID:', error);
          } else if (data) {
            setEmployeeId(data.user_id);
          }
        } catch (error) {
          console.error('Exception fetching employee ID:', error);
        }
      }
    };
    fetchEmployeeId();
  }, [user]);

  const handleScenarioSelect = (scenario: Scenario) => {
    setSelectedScenario(scenario);
    setCurrentScreen('config');
    setError(null);
  };

  const handleConfigStart = (config: RoleplayConfig) => {
    setRoleplayConfig(config);
    // Update scenario with config settings
    if (selectedScenario) {
      const updatedScenario: Scenario = {
        ...selectedScenario,
        difficulty: config.difficulty as 'Easy' | 'Medium' | 'Hard',
        tone: config.tone as 'Neutral' | 'Friendly' | 'Aggressive',
        userRole: config.userRole || selectedScenario.userRole,
      };
      setSelectedScenario(updatedScenario);
    }
    setCurrentScreen('rolePlay');
  };

  const handleBackToScenarios = () => {
    setSelectedScenario(null);
    setRoleplayConfig(null);
    setConversationHistory([]);
    setCurrentScreen('scenarioSelection');
    setError(null);
  };

  const handleBackFromConfig = () => {
    setCurrentScreen('scenarioSelection');
    setSelectedScenario(null);
    setRoleplayConfig(null);
  };

  const handleEndSession = async (messages: Message[], sessionId?: string) => {
    console.log('🏁 Ending session with messages:', messages.length);
    console.log('📝 Last 3 messages:', messages.slice(-3));
    
    setConversationHistory(messages);
    setCurrentSessionId(sessionId || null);
    setIsGeneratingAssessment(true);
    setError(null);

    try {
      console.log('📊 Generating fresh assessment...');
      const response = await fetch('/api/roleplay/assessment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        },
        cache: 'no-store',
        body: JSON.stringify({
          messages,
          scenarioTitle: selectedScenario?.title,
          scenarioRole: selectedScenario?.role,
          userRole: selectedScenario?.userRole
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate assessment');
      }

      const assessment = await response.json();
      console.log('✅ Assessment received:', assessment.overallScore);
      setAssessmentReport(assessment);
      setCurrentScreen('assessmentReport');

      // Save assessment to database if we have a session ID
      if (sessionId && employeeId) {
        try {
          console.log('💾 Saving assessment to database...', {
            sessionId,
            employeeId,
            assessment
          });
          
          await createRolePlayAssessment(sessionId, employeeId, assessment);
          console.log('✅ Assessment saved to database successfully');
        } catch (dbError) {
          console.error('❌ Error saving assessment to database:', dbError);
          console.error('Error details:', JSON.stringify(dbError, null, 2));
          // Don't throw - assessment was still generated successfully
        }
      } else {
        console.warn('⚠️ Cannot save assessment - missing:', {
          hasSessionId: !!sessionId,
          hasEmployeeId: !!employeeId
        });
      }

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

  const handleCreateCustomRoleplay = () => {
    // Validate inputs
    if (!customScenario.title || !customScenario.description || !customScenario.aiRole || 
        !customScenario.userRole || !customScenario.initialPrompt) {
      alert('Please fill in all fields');
      return;
    }

    // Create a custom scenario object
    const newScenario: Scenario = {
      id: 'custom-' + Date.now(),
      title: customScenario.title,
      description: customScenario.description,
      role: customScenario.aiRole,
      difficulty: customScenario.difficulty,
      initialPrompt: `${customScenario.initialPrompt}\n\n[Tone: ${customScenario.tone}]`,
      userRole: customScenario.userRole,
      tone: customScenario.tone
    };

    // Set it as selected and start the roleplay
    setSelectedScenario(newScenario);
    setShowCustomModal(false);
    setCurrentScreen('rolePlay');
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
      {currentScreen !== 'rolePlay' && <EmployeeNavigation />}
      
      {currentScreen === 'rolePlay' && selectedScenario ? (
        <RolePlayConversation
          scenario={selectedScenario}
          onEndSession={handleEndSession}
          moduleId={moduleId || undefined}
          voiceGender={roleplayConfig?.voiceGender || 'female'}
        />
      ) : (
        <main 
          className="transition-all duration-300 ease-in-out pt-2 pb-12"
          style={{ marginLeft: 'var(--sidebar-width, 0px)' }}
        >
          <div className="container mx-auto px-4 py-2 max-w-6xl">

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
        {currentScreen === 'config' && selectedScenario && (
          <RoleplayConfigPage
            scenario={selectedScenario}
            onStart={handleConfigStart}
            onBack={handleBackFromConfig}
          />
        )}

        {currentScreen === 'scenarioSelection' && (
          <div className="bg-white rounded-xl shadow-sm p-8 border border-slate-200">
            <h2 className="text-3xl font-bold text-gray-800 mb-2 text-center">
              Choose Your <span className="text-purple-600">Role-Play</span> Scenario
            </h2>
            <p className="text-center text-slate-600 mb-8">
              Select a scenario to start practicing your skills
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
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
                  <p className="text-gray-600 mb-4 text-sm leading-relaxed">{scenario.description}</p>
                  
                  {/* Role Information - Hidden */}
                  {/* <div className="mb-3 p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div>
                        <span className="text-slate-500 font-medium block mb-1">You play as:</span>
                        <span className="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-semibold inline-block">
                          {scenario.userRole || 'Learner'}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-500 font-medium block mb-1">AI plays as:</span>
                        <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-semibold inline-block">
                          {scenario.role}
                        </span>
                      </div>
                    </div>
                  </div> */}
                  
                  <div className="flex justify-between items-center text-sm font-medium">
                    <span className={`px-3 py-1 rounded-full ${
                      scenario.difficulty === 'Easy' ? 'bg-green-100 text-green-700' :
                      scenario.difficulty === 'Medium' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {scenario.difficulty}
                    </span>
                  </div>
                </Card>
              ))}
              
              {/* Create Your Own Roleplay Card */}
              <Card
                className="cursor-pointer p-6 hover:border-purple-400 hover:shadow-lg transition-all border-2 border-dashed border-purple-300 bg-purple-50/30"
                onClick={() => router.push('/employee/roleplay/create')}
              >
                <h3 className="text-xl font-semibold text-purple-700 mb-3 flex items-center gap-2">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Create Your Own Roleplay
                </h3>
                <p className="text-gray-600 mb-4 text-sm leading-relaxed">
                  Design a custom scenario tailored to your specific needs and practice objectives.
                </p>
                <div className="flex justify-between items-center text-sm font-medium">
                  <span className="bg-purple-100 text-purple-700 px-3 py-1 rounded-full">Custom Scenario</span>
                  <span className="px-3 py-1 rounded-full bg-purple-100 text-purple-700">
                    Flexible
                  </span>
                </div>
              </Card>
            </div>

            <div className="flex justify-center">
              <Button
                onClick={() => selectedScenario && handleScenarioSelect(selectedScenario)}
                disabled={!selectedScenario}
                className="px-8 py-3 text-lg bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Start Role-Play
              </Button>
            </div>
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
        </main>
      )}

      {/* Custom Roleplay Creation Modal */}
      {showCustomModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-200">
              <h2 className="text-2xl font-bold text-slate-900">Create Your Own Roleplay</h2>
              <p className="text-slate-600 mt-1">Design a custom scenario tailored to your needs</p>
            </div>

            <div className="p-6 space-y-4">
              {/* Title */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Scenario Title *
                </label>
                <input
                  type="text"
                  value={customScenario.title}
                  onChange={(e) => setCustomScenario({...customScenario, title: e.target.value})}
                  placeholder="e.g., Client Objection Handling"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Scenario Description *
                </label>
                <textarea
                  value={customScenario.description}
                  onChange={(e) => setCustomScenario({...customScenario, description: e.target.value})}
                  placeholder="Describe the situation and context..."
                  rows={3}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>

              {/* AI Role */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  AI Character Role *
                </label>
                <input
                  type="text"
                  value={customScenario.aiRole}
                  onChange={(e) => setCustomScenario({...customScenario, aiRole: e.target.value})}
                  placeholder="e.g., Skeptical Client, Concerned Manager"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>

              {/* User Role */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Your Role *
                </label>
                <input
                  type="text"
                  value={customScenario.userRole}
                  onChange={(e) => setCustomScenario({...customScenario, userRole: e.target.value})}
                  placeholder="e.g., Sales Representative, Team Lead"
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>

              {/* Initial Prompt */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  AI's Opening Line *
                </label>
                <textarea
                  value={customScenario.initialPrompt}
                  onChange={(e) => setCustomScenario({...customScenario, initialPrompt: e.target.value})}
                  placeholder="What should the AI character say first?"
                  rows={2}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                />
              </div>

              {/* Difficulty & Tone */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    Difficulty *
                  </label>
                  <select
                    value={customScenario.difficulty}
                    onChange={(e) => setCustomScenario({...customScenario, difficulty: e.target.value as any})}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  >
                    <option value="Easy">Easy</option>
                    <option value="Medium">Medium</option>
                    <option value="Hard">Hard</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-2">
                    AI Tone *
                  </label>
                  <select
                    value={customScenario.tone}
                    onChange={(e) => setCustomScenario({...customScenario, tone: e.target.value as any})}
                    className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  >
                    <option value="Friendly">Friendly</option>
                    <option value="Neutral">Neutral</option>
                    <option value="Aggressive">Aggressive</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCustomModal(false);
                  setCustomScenario({
                    title: '',
                    description: '',
                    aiRole: '',
                    userRole: '',
                    initialPrompt: '',
                    difficulty: 'Medium',
                    tone: 'Neutral'
                  });
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreateCustomRoleplay}
                className="bg-purple-600 hover:bg-purple-700"
              >
                Start Roleplay
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
