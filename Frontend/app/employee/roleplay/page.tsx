"use client";

import { useEffect, useState, Suspense, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { 
  ChevronLeft, Loader2, Edit2, Trash2, UserPlus, Search, X, 
  CheckSquare, Square, Filter, Users, Layers, Building2, Check,
  Sparkles, Plus, Play, ArrowRight, Shield, Award, Clock, Star, 
  Bot, User as UserIcon, CheckCircle2, SlidersHorizontal, RefreshCw, Compass
} from 'lucide-react';
import { useAuth } from '@/contexts/auth-context';
import { Scenario, AppScreen, Message } from '@/lib/roleplayApi';
import { fetchRoleplayBootstrap, deleteCustomScenarioAPI, assignScenarioAPI, finishRoleplaySession } from '@/lib/roleplayApi';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import RolePlayConversation from '@/components/roleplay/RolePlayConversation';
import RoleplayConfigPage, { RoleplayConfig } from '@/components/roleplay/RoleplayConfigPage';
import AssessmentReportComponent from '@/components/roleplay/AssessmentReport';
// import { createRolePlayAssessment } from '@/lib/roleplayDatabase';
// import { supabase } from '@/lib/supabase';
// import { callGemini } from '@/lib/gemini-helper';
// import { fetchWithAuth } from '@/lib/fetch-with-auth';

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
  metrics?: {
    user_talk_percent: number;
    ai_talk_percent: number;
    user_word_count?: number;
    ai_word_count?: number;
    words_per_minute?: number;
    duration_seconds?: number;
  };
}

function RolePlayPageContent({ params }: { params: Promise<{ module_id: string, moduleTitle: string, custom: string }> }) {
  const unwrappedParams = use(params);
  const { user, loading: authLoading, userId, employeeData, isAdmin, rolesLoaded } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const moduleId = unwrappedParams.module_id;
  const moduleTitle = unwrappedParams.moduleTitle;
  const isCustom = searchParams.get('custom') === 'true';
  
  const [currentScreen, setCurrentScreen] = useState<AppScreen>('scenarioSelection');
  const [selectedScenario, setSelectedScenario] = useState<Scenario | null>(null);
  const [roleplayConfig, setRoleplayConfig] = useState<RoleplayConfig | null>(null);
  const [conversationHistory, setConversationHistory] = useState<Message[]>([]);
  const [assessmentReport, setAssessmentReport] = useState<AssessmentReport | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  // const [employeeId, setEmployeeId] = useState<string | null>(null);
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
  // const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [showAssignModal, setShowAssignModal] = useState<boolean>(false);
  const [assigningScenario, setAssigningScenario] = useState<Scenario | null>(null);
  const [assignmentType, setAssignmentType] = useState<'function' | 'sub_function' | 'user'>('user');
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [functions, setFunctions] = useState<any[]>([]);
  const [subFunctions, setSubFunctions] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [assignSearchQuery, setAssignSearchQuery] = useState<string>('');
  const [selectedFunctionFilter, setSelectedFunctionFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'customer_service' | 'sales' | 'leadership' | 'custom'>('all');
  const [difficultyFilter, setDifficultyFilter] = useState<'all' | 'Easy' | 'Medium' | 'Hard'>('all');
  // const [companyId, setCompanyId] = useState<string>('');
  // const [userId, setUserId] = useState<string>('');
  const employeeId = userId;
  const companyId = employeeData?.company_id || '';
  
  // Fetch all scenarios from the database on mount
  // useEffect(() => {
  //   const fetchScenarios = async () => {
  //     if (!userId || !rolesLoaded) return;
      
  //     setLoadingScenarios(true);
  //     // console.log('Fetching Scenarios for user id:', userId, 'isAdmin:', isAdmin);
      
  //     const { data, error } = await fetchScenariosForUserAPI(userId, isAdmin || false);

  //     // console.log('Fetched scenarios:', data);
  //     if (data) {
  //       setAllScenarios(data);
  //     }
  //     if (error) setError('Failed to load scenarios');
  //     setLoadingScenarios(false);
  //   };

  //   // Only fetch scenarios after we have userId (which means admin check is done)
  //   if (userId) {
  //     fetchScenarios();
  //   }
  // }, [userId, isAdmin, rolesLoaded, searchParams]); // Depend on both userId and isAdmin

  // Instant scenario hydration from session cache (0ms instant display)
  useEffect(() => {
    try {
      const cached = sessionStorage.getItem('cached_roleplay_scenarios');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setAllScenarios(parsed);
          setLoadingScenarios(false);
        }
      }
    } catch (e) {
      // ignore
    }
  }, []);

  useEffect(() => {
  const fetchBootstrap = async () => {
    if (!userId || !rolesLoaded) return;

    if (allScenarios.length === 0) {
      setLoadingScenarios(true);
    }

    const { data, error } =
      await fetchRoleplayBootstrap();

    if (error) {
      setError("Failed to load roleplay data");
      setLoadingScenarios(false);
      return;
    }

    if (data) {
      setAllScenarios(data.scenarios);
      try {
        sessionStorage.setItem('cached_roleplay_scenarios', JSON.stringify(data.scenarios));
      } catch (e) {
        // ignore
      }

      setFunctions(
        data.assignmentTargets?.functions || []
      );

      setSubFunctions(
        data.assignmentTargets?.sub_functions || []
      );

      setUsers(
        data.assignmentTargets?.users || []
      );
    }

    setLoadingScenarios(false);
  };

  fetchBootstrap();

}, [userId, rolesLoaded]);

  useEffect(() => {
    if (!authLoading) {
      if (!user) {
        router.push("/login");
        return;
      }
      const addons = employeeData?.subscription_addons || employeeData?.company?.subscription_addons || [];
      if (!addons.includes('role_play')) {
        router.push("/employee/welcome");
      }
    }
  }, [user, authLoading, router, employeeData]);

  // const fetchAppUserByEmail = async (email?: string | null) => {
  //   if (!email) return null;
  //   try {
  //     const res = await fetchWithAuth(`${API_URL}/api/users/by-email/${encodeURIComponent(email)}`);
  //     if (!res.ok) return null;
  //     const payload = await res.json();
  //     let appUser = payload?.user ?? payload;
  //     if (Array.isArray(appUser)) appUser = appUser[0];
  //     return appUser?.user_id ? appUser : null;
  //   } catch (error) {
  //     console.error("Error fetching app user by email:", error);
  //     return null;
  //   }
  // };

  // Load custom scenario from sessionStorage if custom=true
  useEffect(() => {
    if (isCustom) {
      const customScenarioData = sessionStorage.getItem('customScenario');


      //console.log(customScenarioData)
      if (customScenarioData) {
        try {
          const scenario = JSON.parse(customScenarioData);
          
          // Ensure scenario has a scenario_id
          if (!scenario.scenario_id) {
            scenario.scenario_id = `custom-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
          }
          
          //console.log('Loaded custom scenario from sessionStorage:', scenario);
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

  // Fetch employee profile via backend auth-aware endpoint
  // useEffect(() => {
  //   const fetchEmployeeId = async () => {
  //     if (user?.email) {
  //       try {
  //         const appUser = await fetchAppUserByEmail(user.email);
  //         if (!appUser) {
  //           console.error("Error fetching employee ID: user not found");
  //           return;
  //         }
  //         setEmployeeId(appUser.user_id);
  //         setUserId(appUser.user_id);
  //         setCompanyId(appUser.company_id);
  //       } catch (error) {
  //         console.error('Exception fetching employee ID:', error);
  //       }
  //     }
  //   };
  //   fetchEmployeeId();
  // }, [user]);

  // Check if user has admin role
  // useEffect(() => {
  //   const fetchUserDataAndCheckAdmin = async () => {
  //     if (user?.email) {
  //       try {
  //         const userData = await fetchAppUserByEmail(user.email);
  //         if (!userData) {
  //           console.error('Error fetching user data: user not found');
  //           setIsAdmin(false);
  //           return;
  //         }

  //         setEmployeeId(userData.user_id);
  //         setUserId(userData.user_id);
  //         setCompanyId(userData.company_id);

  //         // Check user role assignments
  //         const roleRes = await fetchWithAuth(`${API_URL}/api/roles/users/${encodeURIComponent(userData.user_id)}`, {
  //           headers: { 'X-User-ID': userData.user_id }
  //         });

  //         if (!roleRes.ok) {
  //           console.error('Failed to fetch role assignments:', roleRes.status);
  //           setIsAdmin(false);
  //           return;
  //         }

  //         const rolePayload = await roleRes.json().catch(() => null);
  //         const roleData = rolePayload?.assignments ?? rolePayload?.data ?? rolePayload ?? [];
  //         if (!Array.isArray(roleData) || roleData.length === 0) {
  //           // console.log('No admin role found');
  //           setIsAdmin(false);
  //           return;
  //         }

  //         // Check if user has Admin role
  //         const hasAdminRole = roleData.some((assignment: any) => {
  //           const roleObj = assignment?.role ?? assignment?.roles ?? assignment ?? {};
  //           const roleNode = Array.isArray(roleObj) ? roleObj[0] : roleObj;
  //           const roleName = String(roleNode?.name || '').toLowerCase().replace(/[-_\s]/g, '');
  //           const roleLevel = Number(roleNode?.level ?? assignment?.level ?? -1);
  //           return roleLevel >= 3 || ['admin', 'companyadmin', 'superadmin', 'ceo'].includes(roleName);
  //         });

  //         //console.log('User is admin:', hasAdminRole);
  //         setIsAdmin(hasAdminRole);
  //       } catch (error) {
  //         console.error('Error in fetchUserDataAndCheckAdmin:', error);
  //         setIsAdmin(false);
  //       }
  //     }
  //   };

  //   fetchUserDataAndCheckAdmin();
  // }, [user]);

  const handleScenarioSelect = (scenario: Scenario) => {
          //console.log('Loaded custom scenario from sessionStorage:', scenario);

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
      const { error } = await deleteCustomScenarioAPI(scenario.scenario_id, userId || '', companyId);
      
      if (error) {
        console.error('Error deleting scenario:', error);
        setError('Failed to delete scenario');
        return;
      }

      // Refresh scenarios list
      const { data, error: fetchError } = await fetchRoleplayBootstrap();
      // console.log('scenarios for the admins',data);
      if (!fetchError && data){
        setAllScenarios(data.scenarios);
        setFunctions(data.assignmentTargets.functions);
        setSubFunctions(data.assignmentTargets.sub_functions);
        setUsers(data.assignmentTargets.users);
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

  // const handleAssignScenario = async (scenario: Scenario, e: React.MouseEvent) => {
  //   e.stopPropagation(); // Prevent card click


  //   //console.log('Assigning scenario:', scenario);
  //   setAssigningScenario(scenario);
  //   setShowAssignModal(true);
    
  //   // Fetch functions and sub-functions and users for the dropdown
  //   try {
  //     const response = await fetchWithAuth(
  //       `${API_URL}/api/roleplay/assignment-targets`
  //     );

  //     if (!response.ok) {
  //       throw new Error("Failed to load assignment targets");
  //     }

  //     const result = await response.json();
  //     const targets = result.data || {};

  //     setFunctions(targets.functions || []);
  //     setSubFunctions(targets.sub_functions || []);
  //     setUsers(targets.users || []);
  //     } catch (error) {
  //     console.error("Error fetching assignment targets:", error);
  //   }
  // };

  const handleAssignScenario = async (
      scenario: Scenario,
      e: React.MouseEvent
  ) => {
      e.stopPropagation();
      setAssigningScenario(scenario);
      setAssignmentType('function');
      setSelectedTargets([]);
      setAssignSearchQuery('');
      setSelectedFunctionFilter('all');
      setShowAssignModal(true);
  };
  const handleSaveAssignment = async () => {
    if (!assigningScenario || selectedTargets.length === 0) {
      alert('Please select at least one target');
      return;
    }

    try {
      //console.log("Inside the save assignment");
      //console.log(selectedTargets);
      
      const { error } = await assignScenarioAPI(
        assigningScenario.scenario_id,
        assignmentType,
        selectedTargets,
        companyId,
        userId || ''
      );

      if (error) {
        console.error('Error assigning scenario:', error);
        const assignmentErrorMessage = error?.message || 'Failed to assign scenario';
        setError(assignmentErrorMessage);
        alert(assignmentErrorMessage);
        return;
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
          //console.log('Loaded custom scenario from sessionStorage:', updatedScenario);

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
    //console.log('🏁 Ending session with messages:', messages.length);
    // console.log('[handleEndSession] Ending with', messages.length, 'messages, sessionId:', sessionId);
    
    setConversationHistory(messages);

    // //console.log()
    //console.log(sessionId)
    setCurrentSessionId(sessionId || null);
    setIsGeneratingAssessment(true);
    setError(null);

    try {
      //console.log('📊 Generating fresh assessment...');
      // console.log('[Assessment] Sending request with:', {
      //   messagesCount: messages.length,
      //   scenarioTitle: selectedScenario?.title,
      //   hasScenario: !!selectedScenario
      // });

      // ✅ ALLOW EMPTY MESSAGES - backend will return zero-score assessment
      // This handles abrupt session endings gracefully
      if (!selectedScenario) {
        throw new Error('Scenario information not available');
      }

      // const response = await fetchWithAuth(`${API_URL}/api/roleplay/sessions/${sessionId}/assessment`, {
      //   method: 'POST',
      //   cache: 'no-store',
      //   // headers: {
      //   //   'Content-Type': 'application/json',
      //   //   'Cache-Control': 'no-cache, no-store, must-revalidate',
      //   //   'Pragma': 'no-cache',
      //   // },
        
      //   // body: JSON.stringify({
      //   //   messages: messages.length > 0 ? messages : [], // ✅ Send empty array if no messages
      //   //   scenarioTitle: selectedScenario?.title,
      //   //   scenarioRole: selectedScenario?.role,
      //   //   userRole: selectedScenario?.userRole
      //   });
      // // console.log('[Assessment] Response status:', response.status);

      // if (!response.ok) {
      //   let errorData: any = {};
      //   try {
      //     errorData = await response.json();
      //   } catch {
      //     errorData = { error: `HTTP ${response.status}` };
      //   }
      //   console.error('[Assessment] Error response:', errorData);
      //   throw new Error(errorData.error || `Failed to generate assessment (HTTP ${response.status})`);
      // }

      // const assessmentResult = await response.json();
      // const assessment = assessmentResult?.data ?? assessmentResult;

      const {
          data: assessment,
          error,
      } = await finishRoleplaySession(
          sessionId!,
          messages
      );

      if (error) {
          throw new Error(error);
      }
      // console.log('[Assessment] Success, score:', assessment?.overallScore);
      
      // ✅ Validate assessment structure - zero score is valid!
      if (assessment.overallScore === undefined || !assessment.summary || !assessment.parameters) {
        console.error('[Assessment] Invalid structure:', Object.keys(assessment));
        throw new Error('Assessment response missing required fields');
      }

      setAssessmentReport(assessment);
      setCurrentScreen('assessmentReport');

      // Save assessment to database if we have a session ID
      if (sessionId && employeeId) {
        try {
          //console.log('💾 Saving assessment to database...', {

          //   sessionId,
          //   employeeId,
          //   assessment
          // });
          
          // console.log('[Assessment] Saving to DB with sessionId:', sessionId);
          // await createRolePlayAssessment(sessionId, employeeId, assessment);
          // console.log('[Assessment] ✅ Saved to database');
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
      console.error('Error message:', err.message);
      setError(err.message || 'Failed to generate assessment report');
    } finally {
      setIsGeneratingAssessment(false);
    }
  };

  const handleStartNew = () => {
          //console.log('scenario set to null');
    setSelectedScenario(null);
    setConversationHistory([]);
    setAssessmentReport(null);
    setCurrentScreen('scenarioSelection');
    setError(null);
  };

  const handleRetakeRoleplay = () => {
    setConversationHistory([]);
    setAssessmentReport(null);
    setCurrentScreen('config');
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
          //console.log('Loaded custom scenario from new scenario sessionStorage:', newScenario);

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
          isGeneratingAssessment={isGeneratingAssessment}
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

        {currentScreen === 'scenarioSelection' && (() => {
          const filteredScenarios = allScenarios.filter((scenario) => {
            const q = searchQuery.toLowerCase().trim();
            if (q) {
              const matchTitle = (scenario.title || '').toLowerCase().includes(q);
              const matchDesc = (scenario.description || scenario.learnerBrief || '').toLowerCase().includes(q);
              const matchRole = (scenario.role || '').toLowerCase().includes(q);
              const matchUserRole = (scenario.userRole || '').toLowerCase().includes(q);
              if (!matchTitle && !matchDesc && !matchRole && !matchUserRole) return false;
            }

            if (categoryFilter === 'custom') {
              if (!scenario.isCustom) return false;
            } else if (categoryFilter === 'sales') {
              const text = `${scenario.title} ${scenario.description} ${scenario.role}`.toLowerCase();
              if (!text.includes('sale') && !text.includes('negotiat') && !text.includes('pitch') && !text.includes('deal') && !text.includes('pricing')) {
                return false;
              }
            } else if (categoryFilter === 'customer_service') {
              const text = `${scenario.title} ${scenario.description} ${scenario.role}`.toLowerCase();
              if (!text.includes('customer') && !text.includes('service') && !text.includes('support') && !text.includes('client') && !text.includes('guest') && !text.includes('reservation')) {
                return false;
              }
            } else if (categoryFilter === 'leadership') {
              const text = `${scenario.title} ${scenario.description} ${scenario.role}`.toLowerCase();
              if (!text.includes('leader') && !text.includes('coach') && !text.includes('team') && !text.includes('manage') && !text.includes('feedback')) {
                return false;
              }
            }

            if (difficultyFilter !== 'all') {
              if ((scenario.difficulty || '').toLowerCase() !== difficultyFilter.toLowerCase()) {
                return false;
              }
            }

            return true;
          });

          const customCount = allScenarios.filter(s => s.isCustom).length;

          return (
            <div className="space-y-6">
              {/* Header with Title and Sleek Action Button */}
              <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200/80 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-purple-50 text-purple-700 border border-purple-200">
                      Live Simulation
                    </span>
                    <span className="text-xs text-slate-400 font-medium">• {allScenarios.length} Scenarios Available</span>
                  </div>
                  <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
                    Practice with <span className="bg-gradient-to-r from-purple-600 to-indigo-600 bg-clip-text text-transparent">AI Roleplays</span>
                  </h1>
                  <p className="text-slate-600 text-sm mt-1">
                    Select a realistic scenario to sharpen your conversational dynamics, handling, and pace.
                  </p>
                </div>

                {isAdmin && (
                  <div className="flex items-center gap-3 shrink-0">
                    <Button
                      onClick={() => router.push('/employee/roleplay/create')}
                      className="bg-gradient-to-r from-purple-600 via-indigo-600 to-purple-700 hover:from-purple-700 hover:to-indigo-800 text-white font-semibold shadow-md shadow-purple-500/20 rounded-xl px-5 py-2.5 flex items-center gap-2 transition-all hover:scale-[1.02]"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Create Custom Roleplay</span>
                    </Button>
                  </div>
                )}
              </div>

              {/* Create Your Own Roleplay - High Impact Top Card for Admins */}
              {isAdmin && (
                <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-purple-950 via-indigo-950 to-slate-900 p-6 sm:p-7 text-white shadow-xl border border-purple-500/20">
                  <div className="absolute top-0 right-0 -mt-10 -mr-10 w-48 h-48 bg-purple-600/20 rounded-full blur-3xl pointer-events-none"></div>
                  <div className="relative z-10 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
                    <div className="max-w-xl">
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-purple-500/20 text-purple-200 border border-purple-400/30 mb-2.5">
                        <Sparkles className="w-3.5 h-3.5 text-purple-300" />
                        <span>AI Scenario Studio</span>
                      </div>
                      <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                        Create Your Own Roleplay Scenario
                      </h2>
                      <p className="text-purple-200/80 text-xs sm:text-sm mt-1.5 leading-relaxed">
                        Design tailored scenarios with custom customer personas, specific objections, and custom evaluation criteria for your team.
                      </p>
                    </div>
                    <Button
                      onClick={() => router.push('/employee/roleplay/create')}
                      size="lg"
                      className="bg-white text-purple-950 hover:bg-purple-50 font-bold px-6 py-3 rounded-xl shadow-lg shrink-0 flex items-center gap-2 transition-transform hover:scale-105"
                    >
                      <Plus className="w-4 h-4 text-purple-700" />
                      <span>Create Scenario Now</span>
                    </Button>
                  </div>
                </div>
              )}

              {/* Search & Category Filter Directory Controls */}
              <div className="bg-white rounded-2xl p-4 sm:p-5 border border-slate-200/80 shadow-sm space-y-4">
                
                {/* Search Bar & Difficulty Quick Toggle */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search scenarios by title, persona, or skills..."
                      className="w-full pl-10 pr-10 py-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-500 focus:bg-white transition-all text-slate-800 placeholder-slate-400"
                    />
                    {searchQuery && (
                      <button
                        onClick={() => setSearchQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Difficulty Filters */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 shrink-0">
                    <span className="text-xs font-semibold text-slate-400 mr-1 hidden md:inline">Difficulty:</span>
                    {(['all', 'Easy', 'Medium', 'Hard'] as const).map((diff) => (
                      <button
                        key={diff}
                        onClick={() => setDifficultyFilter(diff)}
                        className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                          difficultyFilter === diff
                            ? 'bg-slate-900 text-white shadow-sm'
                            : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                        }`}
                      >
                        {diff === 'all' ? 'All Difficulties' : diff}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Category Pills */}
                <div className="flex items-center gap-2 overflow-x-auto pb-1 pt-1 border-t border-slate-100">
                  <button
                    onClick={() => setCategoryFilter('all')}
                    className={`text-xs px-3.5 py-1.5 rounded-full font-semibold transition-all shrink-0 ${
                      categoryFilter === 'all'
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                    }`}
                  >
                    All Scenarios ({allScenarios.length})
                  </button>

                  <button
                    onClick={() => setCategoryFilter('customer_service')}
                    className={`text-xs px-3.5 py-1.5 rounded-full font-semibold transition-all shrink-0 ${
                      categoryFilter === 'customer_service'
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                    }`}
                  >
                    Customer Service
                  </button>

                  <button
                    onClick={() => setCategoryFilter('sales')}
                    className={`text-xs px-3.5 py-1.5 rounded-full font-semibold transition-all shrink-0 ${
                      categoryFilter === 'sales'
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                    }`}
                  >
                    Sales & Negotiations
                  </button>

                  <button
                    onClick={() => setCategoryFilter('leadership')}
                    className={`text-xs px-3.5 py-1.5 rounded-full font-semibold transition-all shrink-0 ${
                      categoryFilter === 'leadership'
                        ? 'bg-purple-600 text-white shadow-sm'
                        : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                    }`}
                  >
                    Leadership & Team
                  </button>

                  {customCount > 0 && (
                    <button
                      onClick={() => setCategoryFilter('custom')}
                      className={`text-xs px-3.5 py-1.5 rounded-full font-semibold transition-all shrink-0 ${
                        categoryFilter === 'custom'
                          ? 'bg-purple-600 text-white shadow-sm'
                          : 'bg-purple-50 hover:bg-purple-100 text-purple-700 border border-purple-200'
                      }`}
                    >
                      Custom Scenarios ({customCount})
                    </button>
                  )}
                </div>

              </div>

              {/* Scenarios Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {loadingScenarios && allScenarios.length === 0 ? (
                  // Modern Skeleton Loader Cards
                  Array.from({ length: 4 }).map((_, idx) => (
                    <div key={idx} className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-sm animate-pulse space-y-4">
                      <div className="flex justify-between items-center">
                        <div className="w-20 h-5 bg-slate-200 rounded-full"></div>
                        <div className="w-16 h-5 bg-slate-200 rounded-full"></div>
                      </div>
                      <div className="w-3/4 h-6 bg-slate-200 rounded"></div>
                      <div className="w-full h-12 bg-slate-100 rounded"></div>
                      <div className="flex gap-2">
                        <div className="w-1/2 h-8 bg-slate-100 rounded-lg"></div>
                        <div className="w-1/2 h-8 bg-slate-100 rounded-lg"></div>
                      </div>
                    </div>
                  ))
                ) : filteredScenarios.length === 0 ? (
                  <div className="col-span-full bg-white rounded-2xl p-12 text-center border border-slate-200/80 shadow-sm space-y-3">
                    <Compass className="w-10 h-10 text-slate-300 mx-auto" />
                    <h3 className="text-base font-bold text-slate-800">No scenarios match your search or filter</h3>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto">
                      Try clearing your search query or switching categories to browse other practice scenarios.
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSearchQuery('');
                        setCategoryFilter('all');
                        setDifficultyFilter('all');
                      }}
                      className="mt-2 text-xs"
                    >
                      Reset All Filters
                    </Button>
                  </div>
                ) : (
                  filteredScenarios.map((scenario) => {
                    const diff = (scenario.difficulty || 'Medium').toLowerCase();
                    const diffColor =
                      diff === 'easy'
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200/60'
                        : diff === 'hard'
                        ? 'bg-rose-50 text-rose-700 border-rose-200/60'
                        : 'bg-amber-50 text-amber-700 border-amber-200/60';

                    return (
                      <div
                        key={scenario.scenario_id}
                        onClick={() => handleScenarioSelect(scenario)}
                        className="bg-white rounded-2xl p-6 border border-slate-200/80 hover:border-purple-300 hover:shadow-xl transition-all duration-200 flex flex-col justify-between group cursor-pointer relative"
                      >
                        <div>
                          {/* Top Tag Row */}
                          <div className="flex items-center justify-between gap-2 mb-3">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${diffColor}`}>
                                {scenario.difficulty || 'Medium'}
                              </span>
                              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-slate-100 text-slate-600">
                                {scenario.tone || 'Neutral'} Tone
                              </span>
                              {scenario.isCustom && (
                                <span className="px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-purple-50 text-purple-700 border border-purple-200">
                                  Custom
                                </span>
                              )}
                            </div>

                            {/* Admin Actions for Custom Scenarios */}
                            {isAdmin && scenario.isCustom && (
                              <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                                <button
                                  onClick={(e) => handleAssignScenario(scenario, e)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 transition-colors"
                                  title="Assign Scenario"
                                >
                                  <UserPlus className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={(e) => handleEditScenario(scenario, e)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                                  title="Edit Scenario"
                                >
                                  <Edit2 className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={(e) => handleDeleteScenario(scenario, e)}
                                  className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                                  title="Delete Scenario"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Scenario Title */}
                          <h3 className="text-lg font-bold text-slate-900 group-hover:text-purple-600 transition-colors line-clamp-1">
                            {scenario.title}
                          </h3>

                          {/* Description Snippet */}
                          <p className="text-slate-600 text-xs sm:text-sm leading-relaxed line-clamp-2 my-2.5">
                            {scenario.description || scenario.learnerBrief || 'Click to review scenario briefing and launch your AI practice session.'}
                          </p>

                          {/* Roleplay Cast Mini Chips */}
                          <div className="grid grid-cols-2 gap-2 my-3">
                            <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center gap-2">
                              <Bot className="w-3.5 h-3.5 text-purple-600 shrink-0" />
                              <div className="truncate text-xs">
                                <span className="text-[10px] text-slate-400 block font-medium">AI Partner</span>
                                <span className="font-semibold text-slate-700 truncate block">{scenario.role || 'Partner'}</span>
                              </div>
                            </div>

                            <div className="p-2 rounded-lg bg-slate-50 border border-slate-100 flex items-center gap-2">
                              <UserIcon className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                              <div className="truncate text-xs">
                                <span className="text-[10px] text-slate-400 block font-medium">Your Role</span>
                                <span className="font-semibold text-slate-700 truncate block">{scenario.userRole || 'Learner'}</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Card Bottom CTA */}
                        <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-semibold text-purple-600">
                          <span className="text-slate-400 font-normal">Interactive Audio & Dynamics</span>
                          <span className="inline-flex items-center gap-1 group-hover:translate-x-1 transition-transform">
                            Start Practice <ArrowRight className="w-3.5 h-3.5" />
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })()}

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
              scenarioRole={(selectedScenario as any).scenarioRole || (selectedScenario as any).aiRole || selectedScenario.role}
              userRole={selectedScenario.userRole}
              passingScore={selectedScenario.passingScore ?? 60}
              durationSeconds={assessmentReport.metrics?.duration_seconds}
              conversationHistory={conversationHistory}
              onRetake={handleRetakeRoleplay}
              onBackToScenarios={handleStartNew}
              onStartNew={handleStartNew}
            />
          ) : (
            <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-8 text-center">
              <p className="text-blue-800 font-medium mb-4">No assessment data available.</p>
              <Button
                onClick={handleCreateCustomRoleplay}
                className="bg-purple-600 hover:bg-purple-700 text-white"
              >
                Start New Role-play
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
      {showAssignModal && assigningScenario && (() => {
        const filteredFunctions = functions.filter((func) =>
          (func.function_name || '').toLowerCase().includes(assignSearchQuery.toLowerCase())
        );

        const filteredSubFunctions = subFunctions.filter((subFunc) => {
          const matchesFunction =
            selectedFunctionFilter === 'all' || !selectedFunctionFilter
              ? true
              : subFunc.function_id === selectedFunctionFilter;

          const parentFunc = functions.find((f) => f.function_id === subFunc.function_id);
          const searchLower = assignSearchQuery.toLowerCase();
          const matchesSearch =
            (subFunc.sub_function_name || '').toLowerCase().includes(searchLower) ||
            (parentFunc?.function_name || '').toLowerCase().includes(searchLower);

          return matchesFunction && matchesSearch;
        });

        // Group sub-functions under their parent functions
        const groupedSubFunctions = (() => {
          const groups: { [funcId: string]: { funcName: string; items: typeof subFunctions } } = {};
          
          filteredSubFunctions.forEach((subFunc) => {
            const parentFunc = functions.find((f) => f.function_id === subFunc.function_id);
            const funcId = subFunc.function_id || 'other';
            const funcName = parentFunc?.function_name || 'Unassigned / Other Functions';

            if (!groups[funcId]) {
              groups[funcId] = { funcName, items: [] };
            }
            groups[funcId].items.push(subFunc);
          });

          return groups;
        })();

        const filteredUsers = users.filter((u) => {
          const matchesFunction =
            selectedFunctionFilter === 'all' || !selectedFunctionFilter
              ? true
              : u.function_id === selectedFunctionFilter;

          const searchLower = assignSearchQuery.toLowerCase();
          const matchesSearch =
            (u.name || '').toLowerCase().includes(searchLower) ||
            (u.email || '').toLowerCase().includes(searchLower);

          return matchesFunction && matchesSearch;
        });

        const getCurrentlyVisibleIds = () => {
          if (assignmentType === 'function') return filteredFunctions.map((f) => f.function_id);
          if (assignmentType === 'sub_function') return filteredSubFunctions.map((sf) => sf.sub_function_id);
          return filteredUsers.map((u) => u.user_id);
        };

        const currentVisibleIds = getCurrentlyVisibleIds();
        const allVisibleSelected =
          currentVisibleIds.length > 0 &&
          currentVisibleIds.every((id) => selectedTargets.includes(id));

        const handleSelectAllVisible = () => {
          if (allVisibleSelected) {
            setSelectedTargets((prev) => prev.filter((id) => !currentVisibleIds.includes(id)));
          } else {
            setSelectedTargets((prev) => Array.from(new Set([...prev, ...currentVisibleIds])));
          }
        };

        const handleClearAll = () => {
          setSelectedTargets([]);
        };

        return (
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-50 p-4 transition-opacity">
            <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] flex flex-col overflow-hidden border border-slate-100 animate-in fade-in zoom-in-95 duration-200">
              
              {/* Modal Header */}
              <div className="p-6 border-b border-slate-100 flex items-start justify-between bg-slate-50/50">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-purple-100 text-purple-600 flex items-center justify-center shrink-0">
                    <UserPlus className="w-5 h-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-bold text-slate-900">Assign Roleplay Scenario</h2>
                    <p className="text-xs text-slate-500 mt-0.5 font-medium">
                      Assign <span className="text-purple-600 font-semibold">"{assigningScenario.title}"</span> to target functions, sub-functions, or users
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => {
                    setShowAssignModal(false);
                    setAssigningScenario(null);
                    setSelectedTargets([]);
                  }}
                  className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 space-y-4 overflow-y-auto flex-1">
                
                {/* Assignment Type Selector (Tabs - Reordered: Function -> Sub-Function -> Individual Users) */}
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                    Assignment Type
                  </label>
                  <div className="grid grid-cols-3 gap-2 bg-slate-100 p-1.5 rounded-xl">
                    <button
                      type="button"
                      onClick={() => {
                        setAssignmentType('function');
                        setSelectedTargets([]);
                        setAssignSearchQuery('');
                      }}
                      className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-semibold transition-all ${
                        assignmentType === 'function'
                          ? 'bg-purple-600 text-white shadow-md shadow-purple-200'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                      }`}
                    >
                      <Building2 className="w-4 h-4" />
                      Function
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setAssignmentType('sub_function');
                        setSelectedTargets([]);
                        setAssignSearchQuery('');
                      }}
                      className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-semibold transition-all ${
                        assignmentType === 'sub_function'
                          ? 'bg-purple-600 text-white shadow-md shadow-purple-200'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                      }`}
                    >
                      <Layers className="w-4 h-4" />
                      Sub-Function
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setAssignmentType('user');
                        setSelectedTargets([]);
                        setAssignSearchQuery('');
                      }}
                      className={`flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-semibold transition-all ${
                        assignmentType === 'user'
                          ? 'bg-purple-600 text-white shadow-md shadow-purple-200'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/60'
                      }`}
                    >
                      <Users className="w-4 h-4" />
                      Individual Users
                    </button>
                  </div>
                </div>

                {/* Filters & Search Row */}
                <div className="flex flex-col sm:flex-row gap-3">
                  
                  {/* Function Filter Dropdown (for Sub-Function & Users) */}
                  {(assignmentType === 'sub_function' || assignmentType === 'user') && functions.length > 0 && (
                    <div className="sm:w-1/2">
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                        Filter by Function
                      </label>
                      <div className="relative">
                        <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                        <select
                          value={selectedFunctionFilter}
                          onChange={(e) => setSelectedFunctionFilter(e.target.value)}
                          className="w-full pl-9 pr-4 h-10 border border-slate-200 rounded-xl bg-slate-50/50 text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent appearance-none cursor-pointer"
                        >
                          <option value="all">All Functions ({functions.length})</option>
                          {functions.map((f) => (
                            <option key={f.function_id} value={f.function_id}>
                              {f.function_name}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Search Input */}
                  <div className="flex-1">
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      Search
                    </label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
                      <input
                        type="text"
                        placeholder={
                          assignmentType === 'function'
                            ? 'Search functions...'
                            : assignmentType === 'sub_function'
                            ? 'Search sub-functions...'
                            : 'Search by name or email...'
                        }
                        value={assignSearchQuery}
                        onChange={(e) => setAssignSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-9 h-10 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                      />
                      {assignSearchQuery && (
                        <button
                          onClick={() => setAssignSearchQuery('')}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Controls & Counts Bar */}
                <div className="flex items-center justify-between pt-1 pb-1 px-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-full border border-purple-100">
                      {selectedTargets.length} selected
                    </span>
                    <span className="text-xs text-slate-400">
                      ({currentVisibleIds.length} visible)
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleSelectAllVisible}
                      className="text-xs font-semibold text-purple-600 hover:text-purple-700 px-3 py-1 rounded-lg bg-purple-50 hover:bg-purple-100 border border-purple-200/60 transition-colors"
                    >
                      {allVisibleSelected ? 'Deselect Visible' : 'Select All'}
                    </button>
                    {selectedTargets.length > 0 && (
                      <button
                        type="button"
                        onClick={handleClearAll}
                        className="text-xs font-semibold text-slate-500 hover:text-red-600 px-3 py-1 rounded-lg bg-slate-100 hover:bg-red-50 border border-slate-200 transition-colors"
                      >
                        Clear All
                      </button>
                    )}
                  </div>
                </div>

                {/* Target List Container */}
                <div className="space-y-3 max-h-64 overflow-y-auto border border-slate-200 rounded-xl p-3 bg-slate-50/40">
                  
                  {/* FUNCTIONS LIST */}
                  {assignmentType === 'function' && (
                    filteredFunctions.length === 0 ? (
                      <div className="p-8 text-center text-slate-400 text-sm">
                        No functions found matching "{assignSearchQuery}"
                      </div>
                    ) : (
                      filteredFunctions.map((func) => {
                        const isChecked = selectedTargets.includes(func.function_id);
                        return (
                          <label
                            key={func.function_id}
                            className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                              isChecked
                                ? 'bg-purple-50/70 border-purple-200 text-purple-950 font-medium shadow-xs'
                                : 'bg-white border-slate-100 hover:bg-slate-50 text-slate-700'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isChecked ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                                <Building2 className="w-4 h-4" />
                              </div>
                              <span className="text-sm font-semibold">{func.function_name}</span>
                            </div>

                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedTargets([...selectedTargets, func.function_id]);
                                } else {
                                  setSelectedTargets(selectedTargets.filter((id) => id !== func.function_id));
                                }
                              }}
                              className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500 cursor-pointer accent-purple-600"
                            />
                          </label>
                        );
                      })
                    )
                  )}

                  {/* SUB-FUNCTIONS LIST GROUPED UNDER FUNCTIONS */}
                  {assignmentType === 'sub_function' && (
                    filteredSubFunctions.length === 0 ? (
                      <div className="p-8 text-center text-slate-400 text-sm">
                        No sub-functions found matching your filter
                      </div>
                    ) : (
                      <div className="space-y-4">
                        {Object.entries(groupedSubFunctions).map(([funcId, group]) => (
                          <div key={funcId} className="space-y-1.5">
                            {/* Function Header */}
                            <div className="flex items-center justify-between px-3 py-1.5 bg-slate-100/90 rounded-lg text-xs font-bold text-slate-700 border border-slate-200/80 sticky top-0 z-10 backdrop-blur-xs">
                              <div className="flex items-center gap-2">
                                <Building2 className="w-3.5 h-3.5 text-purple-600" />
                                <span className="uppercase tracking-wider">{group.funcName}</span>
                              </div>
                              <span className="text-slate-400 font-normal">
                                ({group.items.length} sub-function{group.items.length > 1 ? 's' : ''})
                              </span>
                            </div>

                            {/* Sub-functions under this Function */}
                            <div className="space-y-1.5 pl-2">
                              {group.items.map((subFunc) => {
                                const isChecked = selectedTargets.includes(subFunc.sub_function_id);
                                return (
                                  <label
                                    key={subFunc.sub_function_id}
                                    className={`flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer ${
                                      isChecked
                                        ? 'bg-purple-50/70 border-purple-200 text-purple-950 font-medium shadow-xs'
                                        : 'bg-white border-slate-100 hover:bg-slate-50 text-slate-700'
                                    }`}
                                  >
                                    <div className="flex items-center gap-2.5">
                                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${isChecked ? 'bg-purple-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                                        <Layers className="w-3.5 h-3.5" />
                                      </div>
                                      <span className="text-sm font-semibold text-slate-900">{subFunc.sub_function_name}</span>
                                    </div>

                                    <input
                                      type="checkbox"
                                      checked={isChecked}
                                      onChange={(e) => {
                                        if (e.target.checked) {
                                          setSelectedTargets([...selectedTargets, subFunc.sub_function_id]);
                                        } else {
                                          setSelectedTargets(selectedTargets.filter((id) => id !== subFunc.sub_function_id));
                                        }
                                      }}
                                      className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500 cursor-pointer accent-purple-600"
                                    />
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  )}

                  {/* USERS LIST */}
                  {assignmentType === 'user' && (
                    filteredUsers.length === 0 ? (
                      <div className="p-8 text-center text-slate-400 text-sm">
                        No users found matching "{assignSearchQuery}"
                      </div>
                    ) : (
                      filteredUsers.map((u) => {
                        const isChecked = selectedTargets.includes(u.user_id);
                        const initial = (u.name || u.email || 'U')[0].toUpperCase();
                        return (
                          <label
                            key={u.user_id}
                            className={`flex items-center justify-between p-3 rounded-xl border transition-all cursor-pointer ${
                              isChecked
                                ? 'bg-purple-50/70 border-purple-200 text-purple-950 font-medium shadow-xs'
                                : 'bg-white border-slate-100 hover:bg-slate-50 text-slate-700'
                            }`}
                          >
                            <div className="flex items-center gap-3">
                              <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 ${isChecked ? 'bg-purple-600 text-white' : 'bg-purple-100 text-purple-700'}`}>
                                {initial}
                              </div>
                              <div className="overflow-hidden">
                                <p className="text-sm font-semibold text-slate-900 truncate">{u.name || 'Unnamed User'}</p>
                                <p className="text-xs text-slate-500 truncate">{u.email}</p>
                              </div>
                            </div>

                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedTargets([...selectedTargets, u.user_id]);
                                } else {
                                  setSelectedTargets(selectedTargets.filter((id) => id !== u.user_id));
                                }
                              }}
                              className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500 cursor-pointer accent-purple-600"
                            />
                          </label>
                        );
                      })
                    )
                  )}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-6 border-t border-slate-100 flex items-center justify-between bg-slate-50/50">
                <span className="text-xs font-semibold text-slate-500">
                  {selectedTargets.length} item(s) selected
                </span>
                <div className="flex items-center gap-3">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setShowAssignModal(false);
                      setAssigningScenario(null);
                      setSelectedTargets([]);
                    }}
                    className="border-slate-200 text-slate-700 hover:bg-slate-100 font-medium"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSaveAssignment}
                    className="bg-purple-600 hover:bg-purple-700 text-white font-semibold shadow-md shadow-purple-200"
                    disabled={selectedTargets.length === 0}
                  >
                    Assign Scenario ({selectedTargets.length})
                  </Button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

export default function RolePlayPage({ params }: { params: Promise<{ module_id: string, moduleTitle: string, custom: string }> }) {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-4 text-slate-600">Loading...</p>
        </div>
      </div>
    }>
      <RolePlayPageContent params={params} />
    </Suspense>
  );
}