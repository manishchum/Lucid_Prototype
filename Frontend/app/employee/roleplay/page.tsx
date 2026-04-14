"use client";

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, Loader2, Edit2, Trash2, UserPlus } from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { Scenario, AppScreen, Message } from '@/lib/roleplay/types';
import { fetchScenariosForUser, deleteCustomScenario, assignScenario, getScenarioAssignments } from '@/lib/roleplayDatabase';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import RolePlayConversation from '@/components/roleplay/RolePlayConversation';
import RoleplayConfigPage, { RoleplayConfig } from '@/components/roleplay/RoleplayConfigPage';
import AssessmentReportComponent from '@/components/roleplay/AssessmentReport';
import { createRolePlayAssessment } from '@/lib/roleplayDatabase';
import { supabase } from '@/lib/supabase';
import { callGemini } from '@/lib/gemini-helper';
import { fetchWithAuth } from '@/lib/fetch-with-auth';

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL;
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
  const [allScenarios, setAllScenarios] = useState<Scenario[]>([]);
  const [loadingScenarios, setLoadingScenarios] = useState<boolean>(true);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [showAssignModal, setShowAssignModal] = useState<boolean>(false);
  const [assigningScenario, setAssigningScenario] = useState<Scenario | null>(null);
  const [assignmentType, setAssignmentType] = useState<'department' | 'sub_department' | 'user'>('user');
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [departments, setDepartments] = useState<any[]>([]);
  const [subDepartments, setSubDepartments] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [companyId, setCompanyId] = useState<string>('');
  const [userId, setUserId] = useState<string>('');
  
  // Fetch all scenarios from the database on mount
  useEffect(() => {
    const fetchScenarios = async () => {
      if (!userId) return;
      
      setLoadingScenarios(true);
      console.log('Fetching Scenarios for user id:', userId, 'isAdmin:', isAdmin);
      
      const { data, error } = await fetchScenariosForUser(userId, isAdmin);

      console.log('Fetched scenarios:', data);
      if (data) {
        setAllScenarios(data);
      }
      if (error) setError('Failed to load scenarios');
      setLoadingScenarios(false);
    };

    // Only fetch scenarios after we have userId (which means admin check is done)
    if (userId) {
      fetchScenarios();
    }
  }, [isAdmin]); // Depend on both userId and isAdmin

  useEffect(() => {
    if (!authLoading) {
      if (!user) router.push("/login");
    }
  }, [user, authLoading, router]);

  // Load custom scenario from sessionStorage if custom=true
  useEffect(() => {
    if (isCustom) {
      const customScenarioData = sessionStorage.getItem('customScenario');


      console.log(customScenarioData)
      if (customScenarioData) {
        try {
          const scenario = JSON.parse(customScenarioData);
          
          // Ensure scenario has a scenario_id
          if (!scenario.scenario_id) {
            scenario.scenario_id = `custom-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
          }
          
          console.log('Loaded custom scenario from sessionStorage:', scenario);
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
            .select('user_id, company_id')
            .eq('email', user.email)
            .single();

          if (error) {
            console.error('Error fetching employee ID:', error);
          } else if (data) {
            setEmployeeId(data.user_id);
            setUserId(data.user_id);
            setCompanyId(data.company_id);
          }
        } catch (error) {
          console.error('Exception fetching employee ID:', error);
        }
      }
    };
    fetchEmployeeId();
  }, [user]);

  // Check if user has admin role
  useEffect(() => {
    const fetchUserDataAndCheckAdmin = async () => {
      if (user?.email) {
        try {
          // Get user data
          const { data: userData, error: userError } = await supabase
            .from('users')
            .select('user_id, company_id')
            .eq('email', user.email)
            .eq('is_active', true)
            .single();

          if (userError || !userData) {
            console.error('Error fetching user data:', userError);
            setIsAdmin(false);
            return;
          }

          setEmployeeId(userData.user_id);
          setUserId(userData.user_id);
          setCompanyId(userData.company_id);

          // Check user role assignments
          const { data: roleData, error: roleError } = await supabase
            .from('user_role_assignments')
            .select(`
              role_id,
              roles!inner(name)
            `)
            .eq('user_id', userData.user_id)
            .eq('is_active', true)
            .eq('scope_type', 'COMPANY');

          if (roleError || !roleData || roleData.length === 0) {
            console.log('No admin role found');
            setIsAdmin(false);
            return;
          }

          // Check if user has Admin role
          const hasAdminRole = roleData.some((assignment: any) => 
            ['admin', 'super_admin', 'ceo'].includes(assignment.roles?.name?.toLowerCase())
          );

          console.log('User is admin:', hasAdminRole);
          setIsAdmin(hasAdminRole);
        } catch (error) {
          console.error('Error in fetchUserDataAndCheckAdmin:', error);
          setIsAdmin(false);
        }
      }
    };

    fetchUserDataAndCheckAdmin();
  }, [user]);

  const handleScenarioSelect = (scenario: Scenario) => {
          console.log('Loaded custom scenario from sessionStorage:', scenario);

    setSelectedScenario(scenario);
    setCurrentScreen('config');
    setError(null);
  };

  const handleEditScenario = (scenario: Scenario, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card click
    // Store scenario data in sessionStorage for the create page to load
    sessionStorage.setItem('editScenario', JSON.stringify(scenario));
    router.push('/employee/roleplay/create?edit=true');
  };

  const handleDeleteScenario = async (scenario: Scenario, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card click
    
    // Confirm deletion
    if (!confirm(`Are you sure you want to delete "${scenario.title}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const { error } = await deleteCustomScenario(scenario.scenario_id);
      
      if (error) {
        console.error('Error deleting scenario:', error);
        setError('Failed to delete scenario');
        return;
      }

      // Refresh scenarios list
      const { data, error: fetchError } = await fetchScenariosForUser(userId, isAdmin);
      console.log('scenarios for the admins',data);
      if (data) {
        setAllScenarios(data);
      }
      if (fetchError) {
        console.error('Error refreshing scenarios:', fetchError);
      }

      // Clear selected scenario if it was deleted
      if (selectedScenario?.scenario_id === scenario.scenario_id) {
        setSelectedScenario(null);
      }
    } catch (err) {
      console.error('Exception deleting scenario:', err);
      setError('Failed to delete scenario');
    }
  };

  const handleAssignScenario = async (scenario: Scenario, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent card click


    console.log('Assigning scenario:', scenario);
    setAssigningScenario(scenario);
    setShowAssignModal(true);
    
    // Fetch departments (where sub_department_name IS NULL) and users for the dropdown
    try {
      // Fetch departments (entries with department_name and no sub_department_name)
      const { data: deptData } = await supabase
        .from('sub_department')
        .select('department_id, department_name')
        // .is('sub_department_name', null);
      
      // Remove duplicates based on department_name
      const uniqueDepts = deptData?.reduce((acc: any[], curr: any) => {
        if (!acc.find(d => d.department_name === curr.department_name)) {
          acc.push(curr);
        }
        return acc;
      }, []);
      setDepartments(uniqueDepts || []);

      // Fetch sub-departments (entries with both department_name and sub_department_name)
      const { data: subDeptData } = await supabase
        .from('sub_department')
        .select('department_id, department_name, sub_department_name')
        .not('sub_department_name', 'is', null);
      setSubDepartments(subDeptData || []);

      // Fetch users for this company
      const { data: usersData } = await supabase
        .from('users')
        .select('user_id, name, email, department_id')
        .eq('company_id', companyId)
        .eq('is_active', true);
      setUsers(usersData || []);
    } catch (error) {
      console.error('Error fetching assignment targets:', error);
    }
  };

  const handleSaveAssignment = async () => {
    if (!assigningScenario || selectedTargets.length === 0) {
      alert('Please select at least one target');
      return;
    }

    try {
      console.log("Inside the save assignment");
      console.log(selectedTargets);
      
      const { error } = await assignScenario(
        assigningScenario.scenario_id,
        assignmentType,
        selectedTargets,
        companyId
      );

      if (error) {
        console.error('Error assigning scenario:', error);
        const assignmentErrorMessage = error?.message || 'Failed to assign scenario';
        setError(assignmentErrorMessage);
        alert(assignmentErrorMessage);
        return;
      }

      if (userId) {
        try {
          const notificationResponse = await fetchWithAuth(`${API_URL}/api/notifications/assignment`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-User-ID': userId,
            },
            body: JSON.stringify({
              assignment_type: 'roleplay',
              assignment_title: assigningScenario.title,
              company_id: companyId,
              target_type: assignmentType,
              target_ids: selectedTargets,
              frontend_url: typeof window !== 'undefined' ? window.location.origin : undefined,
            }),
          });

          if (!notificationResponse.ok) {
            console.warn('Roleplay assignment notification failed:', await notificationResponse.text());
          }
        } catch (notificationError) {
          console.warn('Failed to send roleplay assignment notification:', notificationError);
        }
      }

      // Close modal and reset
      setShowAssignModal(false);
      setAssigningScenario(null);
      setSelectedTargets([]);
      alert('Scenario assigned successfully!');
    } catch (err) {
      console.error('Exception assigning scenario:', err);
      setError('Failed to assign scenario');
    }
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
          console.log('Loaded custom scenario from sessionStorage:', updatedScenario);

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

    // console.log()
    console.log(sessionId)
    setCurrentSessionId(sessionId || null);
    setIsGeneratingAssessment(true);
    setError(null);

    try {
      console.log('📊 Generating fresh assessment...');
      const response = await fetchWithAuth(`${API_URL}/api/roleplay/assessment`, {
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
      console.log('📊 Assessment response:', response);
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
          console.log('scenario set to null');

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

    // Create a custom scenario object with a guaranteed scenario_id
    const scenarioId = `custom-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    const newScenario: Scenario = {
      scenario_id: scenarioId,
      title: customScenario.title,
      description: customScenario.description,
      role: customScenario.aiRole,
      difficulty: customScenario.difficulty,
      initialPrompt: `${customScenario.initialPrompt}\n\n[Tone: ${customScenario.tone}]`,
      userRole: customScenario.userRole,
      tone: customScenario.tone
    };

    // Set it as selected and start the roleplay
          console.log('Loaded custom scenario from new scenario sessionStorage:', newScenario);

    setSelectedScenario(newScenario);
    setShowCustomModal(false);
    setCurrentScreen('rolePlay');
  };

  if (authLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-slate-600">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      {currentScreen === 'rolePlay' && selectedScenario ? (
        <RolePlayConversation
          scenario={selectedScenario}
          onEndSession={handleEndSession}
          onBack={handleBackToScenarios}
          moduleId={moduleId || undefined}
          employeeId={employeeId || undefined}
          voiceGender={roleplayConfig?.voiceGender || 'female'}
        />
      ) : (
        <main className="pt-2 pb-12">
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
          <div>
            <div className="bg-white rounded-xl shadow-sm p-8 border border-slate-200 mb-4">
              <h2 className="text-3xl font-bold text-gray-800 mb-2">
                Choose Your <span className="text-purple-600">Role-Play</span> Scenario
              </h2>
              <p className="text-slate-600">
                Select a scenario to start practicing your skills
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              {loadingScenarios ? (
                <div className="col-span-2 text-center text-slate-500">Loading scenarios...</div>
              ) : allScenarios.length === 0 ? (
                <div className="col-span-2 text-center text-slate-500">No scenarios found.</div>
              ) : allScenarios.map((scenario) => (
                <Card
                  key={scenario.scenario_id}
                  className={`cursor-pointer p-6 hover:border-blue-400 hover:shadow-lg transition-all relative ${
                    selectedScenario?.scenario_id === scenario.scenario_id
                      ? 'border-2 border-blue-500 shadow-lg'
                      : 'border border-slate-200'
                  }`}
                  onClick={() => setSelectedScenario(scenario)}
                >
                  {/* Edit, Delete, and Assign buttons for custom scenarios - admin only */}
                  {isAdmin && scenario.isCustom && (
                    
                    <div className="absolute top-3 right-3 flex gap-2">
                      <button
                        onClick={(e) => handleAssignScenario(scenario, e)}
                        className="p-2 rounded-lg bg-slate-100 hover:bg-green-100 text-slate-600 hover:text-green-600 transition-colors"
                        title="Assign scenario"
                      >
                        <UserPlus className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => handleEditScenario(scenario, e)}
                        className="p-2 rounded-lg bg-slate-100 hover:bg-blue-100 text-slate-600 hover:text-blue-600 transition-colors"
                        title="Edit scenario"
                      >
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={(e) => handleDeleteScenario(scenario, e)}
                        className="p-2 rounded-lg bg-slate-100 hover:bg-red-100 text-slate-600 hover:text-red-600 transition-colors"
                        title="Delete scenario"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  
                  <h3 className="text-xl font-semibold text-gray-800 mb-3 pr-10">{scenario.title}</h3>
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
                      scenario.difficulty?.toLowerCase() === 'easy' ? 'bg-green-100 text-green-700' :
                      scenario.difficulty?.toLowerCase() === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                      'bg-red-100 text-red-700'
                    }`}>
                      {scenario.difficulty}
                    </span>
                  </div>
                </Card>
              ))}
              
              {/* Create Your Own Roleplay Card - Only show for admins */}
              {isAdmin === true && (
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
              )}
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
              passingScore={selectedScenario.passingScore ?? 60}
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

      {/* Assignment Modal */}
      {showAssignModal && assigningScenario && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-slate-200">
              <h2 className="text-2xl font-bold text-slate-900">Assign Roleplay Scenario</h2>
              <p className="text-slate-600 mt-1">Assign "{assigningScenario.title}" to departments, sub-departments, or users</p>
            </div>

            <div className="p-6 space-y-4">
              {/* Assignment Type */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Assignment Type *
                </label>
                <select
                  value={assignmentType}
                  onChange={(e) => {
                    setAssignmentType(e.target.value as any);
                    setSelectedTargets([]);
                  }}
                  className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-transparent"
                >
                  <option value="user">Individual Users</option>
                  <option value="sub_department">Sub-Department</option>
                  <option value="department">Department</option>
                </select>
              </div>

              {/* Target Selection */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">
                  Select Targets *
                </label>
                
                {assignmentType === 'department' && (
                  <div className="space-y-2 max-h-64 overflow-y-auto border border-slate-300 rounded-lg p-2">
                    {departments.map((dept) => (
                      <label key={dept.department_id} className="flex items-center gap-2 p-2 hover:bg-slate-50 rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedTargets.includes(dept.department_id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedTargets([...selectedTargets, dept.department_id]);
                            } else {
                              setSelectedTargets(selectedTargets.filter(id => id !== dept.department_id));
                            }
                          }}
                          className="w-4 h-4"
                        />
                        <span className="text-sm">{dept.department_name}</span>
                      </label>
                    ))}
                  </div>
                )}

                {assignmentType === 'sub_department' && (
                  <div className="space-y-2 max-h-64 overflow-y-auto border border-slate-300 rounded-lg p-2">
                    {subDepartments.map((subDept) => (
                      <label key={subDept.department_id} className="flex items-center gap-2 p-2 hover:bg-slate-50 rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedTargets.includes(subDept.department_id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedTargets([...selectedTargets, subDept.department_id]);
                            } else {
                              setSelectedTargets(selectedTargets.filter(id => id !== subDept.department_id));
                            }
                          }}
                          className="w-4 h-4"
                        />
                        <span className="text-sm">{subDept.department_name} - {subDept.sub_department_name}</span>
                      </label>
                    ))}
                  </div>
                )}

                {assignmentType === 'user' && (
                  <div className="space-y-2 max-h-64 overflow-y-auto border border-slate-300 rounded-lg p-2">
                    {users.map((user) => (
                      <label key={user.user_id} className="flex items-center gap-2 p-2 hover:bg-slate-50 rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedTargets.includes(user.user_id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedTargets([...selectedTargets, user.user_id]);
                            } else {
                              setSelectedTargets(selectedTargets.filter(id => id !== user.user_id));
                            }
                          }}
                          className="w-4 h-4"
                        />
                        <span className="text-sm">{user.name} ({user.email})</span>
                      </label>
                    ))}
                  </div>
                )}

                <p className="text-xs text-slate-500 mt-2">
                  {selectedTargets.length} target(s) selected
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setShowAssignModal(false);
                  setAssigningScenario(null);
                  setSelectedTargets([]);
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleSaveAssignment}
                className="bg-green-600 hover:bg-green-700"
                disabled={selectedTargets.length === 0}
              >
                Assign Scenario
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
