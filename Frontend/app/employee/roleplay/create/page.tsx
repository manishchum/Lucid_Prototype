"use client";

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { ChevronLeft, Save, Play, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Scenario } from '@/lib/roleplayApi';
import { useAuth } from '@/contexts/auth-context';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL;
import { 
  insertCustomScenarioAPI, 
  updateCustomScenarioAPI 
} from '@/lib/roleplayApi';

interface CustomRoleplayData {
  // Basic Info
  title: string;
  description: string;
  
  // Learner Brief
  learnerBrief: string;
  
  // Avatar Instructions
  aiRole: string;
  aiPersonality: string;
  aiObjectives: string;
  
  // End Conditions
  endConditions: string;
  maxDuration: number; // in minutes
  minTurns: number;
  
  // Evaluation Parameters
  evaluationParameters: Array<{
    name: string;
    description: string;
    weight: number;
  }>;
  
  // Scoring
  cutoffScore: number;
  
  // Other Settings
  difficulty: 'Easy' | 'Medium' | 'Hard';
  tone: 'Friendly' | 'Neutral' | 'Aggressive';
  userRole: string;
  initialPrompt: string;
}
const CreateRoleplayComponent = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isEditMode = searchParams.get('edit') === 'true';
  const { user, loading: authLoading, logout } = useAuth();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [activeTab, setActiveTab] = useState<string>('learner-brief');
  const [hasSavedDraft, setHasSavedDraft] = useState<boolean>(false);
  const [editingScenarioId, setEditingScenarioId] = useState<string | null>(null);
  const [formData, setFormData] = useState<CustomRoleplayData>({
    title: '',
    description: '',
    learnerBrief: '',
    aiRole: '',
    aiPersonality: '',
    aiObjectives: '',
    endConditions: '',
    maxDuration: 15,
    minTurns: 5,
    evaluationParameters: [
      { name: 'Communication Skills', description: 'Clarity and effectiveness of communication', weight: 25 },
      { name: 'Problem Solving', description: 'Ability to address challenges', weight: 25 },
      { name: 'Professionalism', description: 'Professional demeanor and approach', weight: 25 },
      { name: 'Goal Achievement', description: 'Success in meeting objectives', weight: 25 },
    ],
    cutoffScore: 60,
    difficulty: 'Medium',
    tone: 'Neutral',
    userRole: '',
    initialPrompt: '',
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [sidebarLeft, setSidebarLeft] = useState('280px');
  const [userId, setUserId] = useState("");
  const [userCompanyId, setUserCompanyId] = useState("");

  // Track sidebar width so the sticky bar starts after the nav
  useEffect(() => {
    const updateLeft = () => {
      const width = getComputedStyle(document.documentElement).getPropertyValue('--sidebar-width').trim();
      if (width) setSidebarLeft(width);
    };
    updateLeft();
    const observer = new MutationObserver(updateLeft);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!authLoading) {
      if (!user) router.push("/login");
      else {
        fetchUserData();
        checkAdminRole();
      }
    }
  }, [user, authLoading, router]);
  
  useEffect(() =>{
    if (isAdmin === false){
      toast.error("Access Denied: You do not have permission to create or edit roleplay scenarios.");
      const timer = setTimeout(() => {
        router.replace('/employee/roleplay');
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isAdmin, router]);
  // Check for saved draft or edit scenario on component mount
  useEffect(() => {
    // Load scenario for editing if in edit mode
    if (isEditMode) {
      const editScenarioData = sessionStorage.getItem('editScenario');
      if (editScenarioData) {
        try {
          const scenario: Scenario = JSON.parse(editScenarioData);
          setEditingScenarioId(scenario.scenario_id);
          
          // Ensure evaluationParams is an array
          let evalParams = [
            { name: 'Communication Skills', description: 'Clarity and effectiveness of communication', weight: 25 },
            { name: 'Problem Solving', description: 'Ability to address challenges', weight: 25 },
            { name: 'Professionalism', description: 'Professional demeanor and approach', weight: 25 },
            { name: 'Goal Achievement', description: 'Success in meeting objectives', weight: 25 },
          ];
          
          if (scenario.evaluationParams) {
            if (Array.isArray(scenario.evaluationParams)) {
              evalParams = scenario.evaluationParams;
            } else if (typeof scenario.evaluationParams === 'object') {
              // If it's an object, try to convert it to array format
              evalParams = Object.entries(scenario.evaluationParams).map(([name, desc]: [string, any]) => ({
                name,
                description: typeof desc === 'string' ? desc : String(desc),
                weight: 25
              }));
            }
          }
          
          setFormData({
            title: scenario.title || '',
            description: scenario.description || '',
            learnerBrief: scenario.learnerBrief || '',
            aiRole: scenario.role || '',
            aiPersonality: scenario.aiPersonality || '',
            aiObjectives: scenario.aiObjectives || '',
            endConditions: scenario.endConditions || '',
            maxDuration: scenario.maxDuration || 15,
            minTurns: scenario.minTurns || 5,
            evaluationParameters: evalParams,
            cutoffScore: scenario.passingScore || 60,
            difficulty: scenario.difficulty || 'Medium',
            tone: scenario.tone || 'Neutral',
            userRole: scenario.userRole || '',
            initialPrompt: scenario.initialPrompt || '',
          });
          // Clear from sessionStorage
          sessionStorage.removeItem('editScenario');
        } catch (error) {
          console.error('Error loading edit scenario:', error);
        }
      }
    } else {
      // Check for saved draft
      const savedDraft = localStorage.getItem('roleplayDraft');
      if (savedDraft) {
        setHasSavedDraft(true);
      }
    }
  }, [isEditMode]);

  const fetchUserData = async () => {
    // console.log('Fetching user data...');
    if (user) {
      const res = await fetchWithAuth(`${API_URL}/api/users/by-email/${encodeURIComponent(user.email || '')}`);
      if (!res.ok) {
        console.error('Failed to fetch user profile:', res.status);
        return;
      }
      const payload = await res.json();
      let userData = payload?.user ?? payload;
      if (Array.isArray(userData)) userData = userData[0];
      if (userData?.user_id) {
        setUserId(userData.user_id);
        setUserCompanyId(userData.company_id);
        console.log('Fetched user ID:', userId);
        console.log('Fetched user Company ID:', userCompanyId);
      }
    } else {
      console.log('User not logged in yet.');
    }
  }

  const checkAdminRole = async () => {
      if (!user?.email) {
          setIsAdmin(false);
          return;
      }

      try {
          const res = await fetchWithAuth(
              `${API_URL}/api/users/by-email/${encodeURIComponent(user.email)}`
          );

          if (!res.ok) {
              setIsAdmin(false);
              return;
          }

          const payload = await res.json();
          let userData = payload?.user ?? payload;

          if (Array.isArray(userData)) {
              userData = userData[0];
          }

          const roleRes = await fetchWithAuth(
              `${API_URL}/api/roles/users/${encodeURIComponent(userData.user_id)}`,
              {
                  headers: {
                      "X-User-ID": userData.user_id,
                  },
              }
          );

          if (!roleRes.ok) {
              setIsAdmin(false);
              return;
          }

          const rolePayload = await roleRes.json();
          const assignments =
              rolePayload?.assignments ??
              rolePayload?.data ??
              rolePayload ??
              [];

          const hasAdminRole = assignments.some((assignment: any) => {
              const roleObj = assignment?.role ?? assignment?.roles ?? assignment ?? {};
              const roleNode = Array.isArray(roleObj) ? roleObj[0] : roleObj;

              const roleName = String(roleNode?.name || "")
                  .toLowerCase()
                  .replace(/[-_\s]/g, "");

              const roleLevel = Number(
                  roleNode?.level ?? assignment?.level ?? -1
              );

              return (
                  roleLevel >= 3 ||
                  ["admin", "companyadmin", "superadmin", "ceo"].includes(roleName)
              );
          });

          setIsAdmin(hasAdminRole);
      } catch (err) {
          console.error(err);
          setIsAdmin(false);
      }
  };

  // Predefined options
  const scenarioTemplates = [
    { value: 'customer-service', label: 'Customer Service Interaction', description: 'Handle customer inquiries and resolve issues' },
    { value: 'sales-pitch', label: 'Sales Pitch', description: 'Present and sell a product or service' },
    { value: 'team-meeting', label: 'Team Meeting', description: 'Lead or participate in a team discussion' },
    { value: 'conflict-resolution', label: 'Conflict Resolution', description: 'Address and resolve workplace conflicts' },
    { value: 'performance-review', label: 'Performance Review', description: 'Conduct or receive performance feedback' },
    { value: 'client-presentation', label: 'Client Presentation', description: 'Present to stakeholders or clients' },
    { value: 'custom', label: 'Custom Scenario', description: 'Create your own unique scenario' },
  ];

  const roleOptions = [
    'Customer Service Representative',
    'Sales Representative',
    'Team Leader',
    'Manager',
    'Consultant',
    'Trainer',
    'Support Specialist',
    'Account Executive',
    'Project Manager',
  ];

  const aiRoleOptions = [
    'Customer',
    'Client',
    'Manager',
    'Colleague',
    'Supervisor',
    'Team Member',
    'Stakeholder',
    'Vendor',
    'Partner',
  ];

  const evaluationTemplates = {
    'customer-service': [
      { name: 'Active Listening', description: 'Ability to listen and understand customer needs', weight: 25 },
      { name: 'Problem Resolution', description: 'Effectiveness in resolving customer issues', weight: 25 },
      { name: 'Empathy & Courtesy', description: 'Demonstrates empathy and professional courtesy', weight: 25 },
      { name: 'Product Knowledge', description: 'Understanding of products/services', weight: 25 },
    ],
    'sales': [
      { name: 'Value Proposition', description: 'Clear communication of product value', weight: 25 },
      { name: 'Objection Handling', description: 'Ability to address customer concerns', weight: 25 },
      { name: 'Closing Techniques', description: 'Effectiveness in moving towards commitment', weight: 25 },
      { name: 'Relationship Building', description: 'Building rapport and trust', weight: 25 },
    ],
    'leadership': [
      { name: 'Communication Clarity', description: 'Clear and effective communication', weight: 25 },
      { name: 'Team Motivation', description: 'Ability to inspire and motivate', weight: 25 },
      { name: 'Decision Making', description: 'Quality of decisions and problem-solving', weight: 25 },
      { name: 'Conflict Management', description: 'Handling disagreements professionally', weight: 25 },
    ],
    'default': [
      { name: 'Communication Skills', description: 'Clarity and effectiveness of communication', weight: 25 },
      { name: 'Problem Solving', description: 'Ability to address challenges', weight: 25 },
      { name: 'Professionalism', description: 'Professional demeanor and approach', weight: 25 },
      { name: 'Goal Achievement', description: 'Success in meeting objectives', weight: 25 },
    ],
  };

  const cutoffScorePresets = [
    { value: 50, label: '50% - Introductory', description: 'For beginners or practice sessions' },
    { value: 60, label: '60% - Standard', description: 'Typical passing score for most training' },
    { value: 70, label: '70% - Proficient', description: 'For experienced learners' },
    { value: 80, label: '80% - Advanced', description: 'For critical skills or certification' },
    { value: 90, label: '90% - Expert', description: 'For high-stakes scenarios' },
  ];

  const tabs = [
    { id: 'learner-brief', label: 'Learner Brief', icon: '📚' },
    { id: 'avatar-instructions', label: 'AI Coach Instructions', icon: '🎭' },
    { id: 'end-conditions', label: 'End Conditions', icon: '🏁' },
    { id: 'evaluation', label: 'Evaluation parameters', icon: '📊' },
    { id: 'cutoff-score', label: 'Cut off score', icon: '🎯' },
    // { id: 'reviewers', label: 'Reviewers', icon: '👥' },
    // { id: 'insights', label: 'Insights', icon: '💡' },
  ];

  const validateForm = (): boolean => {
    const newErrors: string[] = [];

    if (!formData.title.trim()) newErrors.push('Title is required');
    if (!formData.learnerBrief.trim()) newErrors.push('Learner brief is required');
    if (!formData.aiRole.trim()) newErrors.push('AI role is required');
    if (!formData.userRole.trim()) newErrors.push('Your role is required');
    if (!formData.initialPrompt.trim()) newErrors.push('Initial prompt is required');
    
    const totalWeight = formData.evaluationParameters.reduce((sum, param) => sum + param.weight, 0);
    if (totalWeight !== 100) newErrors.push('Evaluation parameter weights must total 100%');

    setErrors(newErrors);
    return newErrors.length === 0;
  };

  const handleStartRoleplay = async () => {
    if (!validateForm()) {
      alert('Please fix the errors before starting the roleplay');
      return;
    }

    // Create a scenario object from the form data
    const customScenario: Scenario = {
      scenario_id: editingScenarioId || ('custom-' + Date.now()),
      title: formData.title,
      description: formData.description || formData.learnerBrief,
      role: formData.aiRole,
      difficulty: formData.difficulty,
      initialPrompt: formData.initialPrompt,
      userRole: formData.userRole,
      tone: formData.tone,
      learnerBrief: formData.learnerBrief,
      // aiPersonality: formData.aiPersonality,
      aiObjectives: formData.aiObjectives,
      maxDuration: formData.maxDuration,
      minTurns: formData.minTurns,
      endConditions: formData.endConditions,
      evaluationParams: formData.evaluationParameters,
      passingScore: formData.cutoffScore
    };

    // Save or update scenario via backend API
    if (isEditMode && editingScenarioId) {
      // Update existing scenario
      const { error } = await updateCustomScenarioAPI(editingScenarioId, formData, userId, userCompanyId);
      if (error) {
        alert('Failed to update scenario: ' + (typeof error === 'string' ? error : error.message));
        return;
      }
      alert('Scenario updated successfully!');
      // Navigate back to roleplay selection
      router.push('/employee/roleplay');
    } else {
      // Create new scenario via backend API
      const { error } = await insertCustomScenarioAPI(formData, userId, userCompanyId);
      if (error) {
        alert('Failed to create scenario: ' + (typeof error === 'string' ? error : error.message));
        return;
      }

      // Store the custom scenario and evaluation details in sessionStorage for immediate use
      sessionStorage.setItem('customScenario', JSON.stringify(customScenario));
      sessionStorage.setItem('customEvaluation', JSON.stringify({
        parameters: formData.evaluationParameters,
        cutoffScore: formData.cutoffScore,
        endConditions: formData.endConditions,
        maxDuration: formData.maxDuration,
        minTurns: formData.minTurns,
      }));

      // Navigate to the roleplay page
      router.push('/employee/roleplay?custom=true');
    }
  };

  const handleSaveDraft = () => {
    localStorage.setItem('roleplayDraft', JSON.stringify(formData));
    setHasSavedDraft(true);
    alert('Draft saved successfully!');
  };

  const handleLoadDraft = () => {
    const savedDraft = localStorage.getItem('roleplayDraft');
    if (savedDraft) {
      try {
        const draftData = JSON.parse(savedDraft);
        setFormData(draftData);
        alert('Draft loaded successfully!');
      } catch (error) {
        alert('Error loading draft. The draft may be corrupted.');
      }
    }
  };

  const handleClearDraft = () => {
    if (confirm('Are you sure you want to clear the saved draft? This cannot be undone.')) {
      localStorage.removeItem('roleplayDraft');
      setHasSavedDraft(false);
      alert('Draft cleared successfully!');
    }
  };

  const handleSaveChanges = async () => {
    if (!editingScenarioId) return;
    setIsSaving(true);
    const { error } = await updateCustomScenarioAPI(editingScenarioId, formData, userId, userCompanyId);
    setIsSaving(false);
    if (error) {
      alert('Failed to save changes: ' + (typeof error === 'string' ? error : error.message));
    } else {
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    }
  };

  const loadEvaluationTemplate = (templateKey: string) => {
    const template = evaluationTemplates[templateKey as keyof typeof evaluationTemplates] || evaluationTemplates.default;
    setFormData({
      ...formData,
      evaluationParameters: template,
    });
  };

  const addEvaluationParameter = () => {
    setFormData({
      ...formData,
      evaluationParameters: [
        ...formData.evaluationParameters,
        { name: '', description: '', weight: 0 }
      ]
    });
  };

  const updateEvaluationParameter = (index: number, field: string, value: string | number) => {
    const updated = [...formData.evaluationParameters];
    updated[index] = { ...updated[index], [field]: value };
    setFormData({ ...formData, evaluationParameters: updated });
  };

  const removeEvaluationParameter = (index: number) => {
    const updated = formData.evaluationParameters.filter((_, i) => i !== index);
    setFormData({ ...formData, evaluationParameters: updated });
  };

  const handleNext = () => {
    const currentIndex = tabs.findIndex(tab => tab.id === activeTab);
    if (currentIndex < tabs.length - 1) {
      setActiveTab(tabs[currentIndex + 1].id);
    }
  };

  const isLastTab = () => {
    return activeTab === tabs[tabs.length - 1].id;
  };

  const getNextButtonLabel = () => {
    const currentIndex = tabs.findIndex(tab => tab.id === activeTab);
    if (currentIndex < tabs.length - 1) {
      return tabs[currentIndex + 1].label;
    }
    return 'Start Roleplay';
  };

  if (authLoading || isAdmin === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        Loading...
        </div>
    );
  }

  if (isAdmin === false) {
    return null;
  }

  return (
    <div className="min-h-screen bg-slate-50 pt-6 pb-12">
      <main className="container mx-auto px-4 py-6 max-w-7xl" style={{ paddingBottom: isEditMode ? '6rem' : undefined }}>
          {/* Header */}
          <div className="mb-6">
            <button
              onClick={() => router.back()}
              className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4 transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
              <span className="font-medium">Back to Role Play</span>
            </button>
            
            <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="text-4xl">✨</div>
                  <div>
                    <h1 className="text-2xl font-bold text-slate-900">
                      {isEditMode ? 'Edit Roleplay Scenario' : 'Create Your Own Roleplay'}
                    </h1>
                    <p className="text-slate-600 mt-1">
                      {isEditMode ? 'Update your custom scenario configuration' : 'Design a custom scenario tailored to your specific needs'}
                    </p>
                  </div>
                </div>
                <div className="flex gap-3">
                  {hasSavedDraft && !isEditMode && (
                    <>
                      <Button 
                        variant="outline"
                        onClick={handleLoadDraft}
                        className="flex items-center gap-2"
                      >
                        <Save className="w-4 h-4" />
                        Load Draft
                      </Button>
                      <Button 
                        variant="outline"
                        onClick={handleClearDraft}
                        className="flex items-center gap-2 text-red-600 hover:text-red-700 border-red-200 hover:border-red-300"
                      >
                        Clear Draft
                      </Button>
                    </>
                  )}
                  <Button 
                    onClick={isLastTab() ? handleStartRoleplay : handleNext}
                    className="bg-blue-600 hover:bg-blue-700 flex items-center gap-2"
                  >
                    {isLastTab() ? (
                      <>
                        {isEditMode ? (
                          <>
                            <Save className="w-4 h-4" />
                            Update Scenario
                          </>
                        ) : (
                          <>
                            {/* <Play className="w-4 h-4" /> */}
                            Save roleplay
                          </>
                        )}
                      </>
                    ) : (
                      <>
                        {getNextButtonLabel()}
                        <ChevronLeft className="w-4 h-4 rotate-180" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </div>          {/* Error Display */}
          {errors.length > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
                <div>
                  <h3 className="font-semibold text-red-800 mb-2">Please fix the following errors:</h3>
                  <ul className="list-disc list-inside text-red-700 space-y-1">
                    {errors.map((error, index) => (
                      <li key={index}>{error}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-12 gap-6">
            {/* Sidebar Navigation */}
            <div className="col-span-3">
              <Card className="p-6 sticky top-6">
                <nav className="space-y-2">
                  {tabs.map((tab, index) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`w-full text-left px-4 py-4 rounded-lg transition-all flex items-center gap-3 ${
                        activeTab === tab.id
                          ? 'bg-blue-100 text-blue-700 font-medium'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`}
                    >
                      <span className="w-6 h-6 rounded-full flex items-center justify-center bg-slate-200 text-slate-700 text-sm font-semibold">
                        {index + 1}
                      </span>
                      <span className="text-sm">{tab.label}</span>
                    </button>
                  ))}
                </nav>
              </Card>
            </div>

            {/* Main Content */}
            <div className="col-span-9">
              <Card className="p-8">
                {/* Learner Brief Tab */}
                {activeTab === 'learner-brief' && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900 mb-2">Brief For The Learner</h2>
                      <p className="text-slate-600 text-sm mb-6">
                        Brief About The Scenario and Objective During Roleplay.
                      </p>
                    </div>
                    
                    {/* Role Clarification Info Box - Hidden */}
                    {/* <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 mb-6">
                      <div className="flex gap-3">
                        <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                        <div>
                          <h3 className="font-semibold text-blue-900 mb-2">Understanding Roles in Roleplay</h3>
                          <div className="text-sm text-blue-800 space-y-2">
                            <p>
                              <span className="inline-block px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-bold mr-2">YOUR ROLE (Learner)</span>
                              This is the role <strong>YOU</strong> will practice as. For example: "Sales Manager", "Customer Service Rep"
                            </p>
                            <p>
                              <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-bold mr-2">AI COACH ROLE</span>
                              This is who the <strong>AI Coach will play</strong>. For example: "Customer", "Client", "Team Member"
                            </p>
                            <p className="italic pt-2 border-t border-blue-200">
                              Example: If YOU practice as a "Sales Manager" (Your Role), the AI might play a "Customer" (AI Coach Role)
                            </p>
                          </div>
                        </div>
                      </div>
                    </div> */}

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Scenario Template (Optional)
                      </label>
                      <select
                        onChange={(e) => {
                          const template = scenarioTemplates.find(t => t.value === e.target.value);
                          if (template && e.target.value !== 'custom') {
                            setFormData({
                              ...formData,
                              title: template.label,
                              description: template.description,
                            });
                          }
                        }}
                        className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base bg-white"
                      >
                        <option value="">Select a template to get started...</option>
                        {scenarioTemplates.map((template) => (
                          <option key={template.value} value={template.value}>
                            {template.label} - {template.description}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-slate-500 mt-1">Choose a template to auto-fill common scenarios</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Scenario Title *
                      </label>
                      <input
                        type="text"
                        value={formData.title}
                        onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                        placeholder="e.g., Customer Service Interaction, Team Meeting Simulation"
                        className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        <span className="flex items-center gap-2">
                          <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-semibold">YOUR ROLE</span>
                          Learner's Role (What YOU will practice as) *
                        </span>
                      </label>
                      <select
                        value={formData.userRole}
                        onChange={(e) => setFormData({ ...formData, userRole: e.target.value })}
                        className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base bg-white"
                      >
                        <option value="">Select your role...</option>
                        {roleOptions.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-slate-500 mt-1">This is the role YOU will practice as during the roleplay</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Custom Role (if not listed above)
                      </label>
                      <input
                        type="text"
                        value={formData.userRole && !roleOptions.includes(formData.userRole) ? formData.userRole : ''}
                        onChange={(e) => setFormData({ ...formData, userRole: e.target.value })}
                        placeholder="Enter a custom role if none of the above fit"
                        className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Instructions for Learners
                      </label>

                      <textarea
                        value={formData.learnerBrief}
                        onChange={(e) => setFormData({ ...formData, learnerBrief: e.target.value })}
                        placeholder="📣 Instructions for Learners

Welcome to this roleplay practice session.
In this exercise, you will interact with a virtual character to practice and improve your professional communication skills.

✅ What You Need to Do:

1. Greet and introduce yourself professionally.
   Begin with a polite greeting and clearly state your name and role.

2. Present your main points clearly.
   • Communicate your key message
   • Use clear and simple language
   • Stay focused on your objectives

3. Listen and respond appropriately.
   Pay attention to questions or concerns and provide thoughtful responses.

4. Conclude professionally.
   Summarize the conversation and end with a courteous closing statement."
                        rows={15}
                        className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base"
                      />
                    </div>

                    {/* Save Draft Button */}
                    <div className="flex justify-end pt-4">
                      <Button
                        onClick={handleSaveDraft}
                        variant="outline"
                        size="lg"
                        className="px-8"
                      >
                        <Save className="w-4 h-4 mr-2" />
                        Save Draft
                      </Button>
                    </div>
                  </div>
                )}

                {/* AI Coach Instructions Tab */}
                {activeTab === 'avatar-instructions' && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900 mb-2">AI Coach Instructions</h2>
                      <p className="text-slate-600 text-sm mb-6">
                        Define the AI Coach character's role, personality, and behavior guidelines.
                      </p>
                    </div>
                    
                    {/* Role Reminder Box */}
                    <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 mb-6">
                      <div className="flex gap-3">
                        <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                        <div className="text-sm text-blue-800">
                          <p className="font-semibold mb-1">Remember:</p>
                          <p>
                            The <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-bold">AI COACH</span> is the character the AI will play.
                            The <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-bold">LEARNER</span> is the role the user will practice as.
                          </p>
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        <span className="flex items-center gap-2">
                          <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-semibold">AI COACH</span>
                          AI Coach Character Role (Who the AI will play) *
                        </span>
                      </label>
                      <select
                        value={formData.aiRole}
                        onChange={(e) => setFormData({ ...formData, aiRole: e.target.value })}
                        className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base bg-white"
                      >
                        <option value="">Select AI character role...</option>
                        {aiRoleOptions.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                      <p className="text-xs text-slate-500 mt-1">This is the character the AI Coach will play during the roleplay</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Custom AI Coach Role (if not listed above)
                      </label>
                      <input
                        type="text"
                        value={formData.aiRole && !aiRoleOptions.includes(formData.aiRole) ? formData.aiRole : ''}
                        onChange={(e) => setFormData({ ...formData, aiRole: e.target.value })}
                        placeholder="Enter a custom AI Coach role"
                        className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base"
                      />
                      <p className="text-xs text-slate-500 mt-1">E.g., "Frustrated Customer", "Senior Executive", "Technical Expert"</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Personality & Tone *
                      </label>
                      <select
                        value={formData.tone}
                        onChange={(e) => setFormData({ ...formData, tone: e.target.value as any })}
                        className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base bg-white"
                      >
                        <option value="Friendly">😊 Friendly - Warm and approachable</option>
                        <option value="Neutral">😐 Neutral - Professional and balanced</option>
                        <option value="Aggressive">😠 Aggressive - Challenging and critical</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        AI Coach's Opening Line *
                      </label>
                      <textarea
                        value={formData.initialPrompt}
                        onChange={(e) => setFormData({ ...formData, initialPrompt: e.target.value })}
                        placeholder="What should the AI Coach character say first? e.g., 'Hello, how can I help you today?' or 'Good morning. What would you like to discuss?'"
                        rows={3}
                        className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        AI Coach's Objectives & Guidelines
                      </label>
                      <textarea
                        value={formData.aiObjectives}
                        onChange={(e) => setFormData({ ...formData, aiObjectives: e.target.value })}
                        placeholder="What should the AI try to achieve or test? e.g., 'Test the learner's ability to explain concepts clearly, handle objections professionally, and maintain a positive interaction throughout the conversation.'"
                        rows={4}
                        className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base"
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Difficulty Level *
                      </label>
                      <select
                        value={formData.difficulty}
                        onChange={(e) => setFormData({ ...formData, difficulty: e.target.value as any })}
                        className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base"
                      >
                        <option value="Easy">Easy - Basic questions and supportive responses</option>
                        <option value="Medium">Medium - Moderate challenges and objections</option>
                        <option value="Hard">Hard - Complex scenarios with strong objections</option>
                      </select>
                    </div>

                    {/* Save Draft Button */}
                    <div className="flex justify-end pt-4">
                      <Button
                        onClick={handleSaveDraft}
                        variant="outline"
                        size="lg"
                        className="px-8"
                      >
                        <Save className="w-4 h-4 mr-2" />
                        Save Draft
                      </Button>
                    </div>
                  </div>
                )}

                {/* End Conditions Tab */}
                {activeTab === 'end-conditions' && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900 mb-2">End Conditions</h2>
                      <p className="text-slate-600 text-sm mb-6">
                        Define when the roleplay session should automatically end.
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Maximum Duration (minutes)
                      </label>
                      <input
                        type="number"
                        value={formData.maxDuration}
                        onChange={(e) => setFormData({ ...formData, maxDuration: parseInt(e.target.value) || 15 })}
                        min="1"
                        max="60"
                        className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base"
                      />
                      <p className="text-sm text-slate-500 mt-1">
                        The session will end after this many minutes
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Minimum Conversation Turns
                      </label>
                      <input
                        type="number"
                        value={formData.minTurns}
                        onChange={(e) => setFormData({ ...formData, minTurns: parseInt(e.target.value) || 5 })}
                        min="1"
                        max="50"
                        className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base"
                      />
                      <p className="text-sm text-slate-500 mt-1">
                        Number of back-and-forth exchanges required before ending
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Custom End Conditions
                      </label>
                      <textarea
                        value={formData.endConditions}
                        onChange={(e) => setFormData({ ...formData, endConditions: e.target.value })}
                        placeholder="Define specific conditions that should trigger the end of the session, e.g., 'End when the learner has successfully addressed all concerns' or 'End when both parties reach an agreement' or 'End when the main objective has been achieved'"
                        rows={5}
                        className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base"
                      />
                    </div>

                    {/* Save Draft Button */}
                    <div className="flex justify-end pt-4">
                      <Button
                        onClick={handleSaveDraft}
                        variant="outline"
                        size="lg"
                        className="px-8"
                      >
                        <Save className="w-4 h-4 mr-2" />
                        Save Draft
                      </Button>
                    </div>
                  </div>
                )}

                {/* Evaluation Parameters Tab */}
                {activeTab === 'evaluation' && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900 mb-2">Evaluation Parameters</h2>
                      <p className="text-slate-600 text-sm mb-6">
                        Define the criteria for assessing the learner's performance. Total weight must equal 100%.
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Evaluation Template
                      </label>
                      <select
                        onChange={(e) => {
                          if (e.target.value) {
                            loadEvaluationTemplate(e.target.value);
                          }
                        }}
                        className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base bg-white"
                      >
                        <option value="">Select a template...</option>
                        <option value="customer-service">Customer Service - Focus on listening, resolution, empathy</option>
                        <option value="sales">Sales - Focus on value proposition, objection handling, closing</option>
                        <option value="leadership">Leadership - Focus on communication, motivation, decision making</option>
                        <option value="default">General - Balanced communication and problem-solving</option>
                      </select>
                      <p className="text-xs text-slate-500 mt-1">Choose a template or customize your own parameters below</p>
                    </div>

                    <div className="space-y-4">
                      {(Array.isArray(formData.evaluationParameters) ? formData.evaluationParameters : []).map((param, index) => (
                        <Card key={index} className="p-4 bg-slate-50">
                          <div className="flex items-start gap-4">
                            <div className="flex-1 space-y-3">
                              <input
                                type="text"
                                value={param.name}
                                onChange={(e) => updateEvaluationParameter(index, 'name', e.target.value)}
                                placeholder="Parameter name"
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                              />
                              <textarea
                                value={param.description}
                                onChange={(e) => updateEvaluationParameter(index, 'description', e.target.value)}
                                placeholder="Description of what this parameter measures"
                                rows={2}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                              />
                            </div>
                            <div className="w-32">
                              <label className="block text-xs font-medium text-slate-600 mb-1">Weight (%)</label>
                              <input
                                type="number"
                                value={param.weight}
                                onChange={(e) => updateEvaluationParameter(index, 'weight', parseInt(e.target.value) || 0)}
                                min="0"
                                max="100"
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                              />
                            </div>
                            <button
                              onClick={() => removeEvaluationParameter(index)}
                              className="text-red-600 hover:text-red-700 p-2"
                              title="Remove parameter"
                            >
                              ✕
                            </button>
                          </div>
                        </Card>
                      ))}
                    </div>

                    <div className="flex items-center justify-between p-4 bg-purple-50 rounded-lg border border-purple-200">
                      <span className="font-medium text-slate-700">
                        Total Weight: {formData.evaluationParameters.reduce((sum, p) => sum + p.weight, 0)}%
                      </span>
                      {formData.evaluationParameters.reduce((sum, p) => sum + p.weight, 0) !== 100 && (
                        <span className="text-red-600 text-sm">Must equal 100%</span>
                      )}
                    </div>

                    <Button
                      onClick={addEvaluationParameter}
                      variant="outline"
                      className="w-full border-dashed"
                    >
                      + Add Parameter
                    </Button>

                    {/* Save Draft Button */}
                    <div className="flex justify-end pt-4">
                      <Button
                        onClick={handleSaveDraft}
                        variant="outline"
                        size="lg"
                        className="px-8"
                      >
                        <Save className="w-4 h-4 mr-2" />
                        Save Draft
                      </Button>
                    </div>
                  </div>
                )}

                {/* Cut Off Score Tab */}
                {activeTab === 'cutoff-score' && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900 mb-2">Cut Off Score</h2>
                      <p className="text-slate-600 text-sm mb-6">
                        Set the minimum passing score for this roleplay scenario.
                      </p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Quick Presets
                      </label>
                      <div className="grid grid-cols-5 gap-2 mb-4">
                        {cutoffScorePresets.map((preset) => (
                          <button
                            key={preset.value}
                            onClick={() => setFormData({ ...formData, cutoffScore: preset.value })}
                            className={`p-3 rounded-lg border-2 transition-all text-center ${
                              formData.cutoffScore === preset.value
                                ? 'border-blue-500 bg-blue-50'
                                : 'border-slate-200 hover:border-blue-300'
                            }`}
                            title={preset.description}
                          >
                            <div className="text-2xl font-bold text-slate-900">{preset.value}%</div>
                            <div className="text-xs text-slate-600 mt-1">{preset.label.split(' - ')[1]}</div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-2">
                        Custom Passing Score (%)
                      </label>
                      <div className="flex items-center gap-4">
                        <input
                          type="range"
                          value={formData.cutoffScore}
                          onChange={(e) => setFormData({ ...formData, cutoffScore: parseInt(e.target.value) })}
                          min="0"
                          max="100"
                          className="flex-1"
                        />
                        <input
                          type="number"
                          value={formData.cutoffScore}
                          onChange={(e) => setFormData({ ...formData, cutoffScore: parseInt(e.target.value) || 0 })}
                          min="0"
                          max="100"
                          className="w-20 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center"
                        />
                        <span className="text-slate-700 font-medium">%</span>
                      </div>
                    </div>

                    <div className="p-6 bg-slate-50 rounded-lg border border-slate-200">
                      <h3 className="font-semibold text-slate-900 mb-3">Score Interpretation</h3>
                      <div className="space-y-2 text-sm">
                        <div className="flex items-center gap-3">
                          <div className="w-4 h-4 bg-green-500 rounded"></div>
                          <span><strong>Pass:</strong> Score ≥ {formData.cutoffScore}%</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="w-4 h-4 bg-red-500 rounded"></div>
                          <span><strong>Fail:</strong> Score &lt; {formData.cutoffScore}%</span>
                        </div>
                      </div>
                    </div>

                    <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                      <p className="text-sm text-blue-900">
                        <strong>💡 Tip:</strong> A typical passing score is between 60-70%. Set it higher for critical skills or lower for introductory training.
                      </p>
                    </div>

                    {/* Save Draft Button */}
                    <div className="flex justify-end pt-4">
                      <Button
                        onClick={handleSaveDraft}
                        variant="outline"
                        size="lg"
                        className="px-8"
                      >
                        <Save className="w-4 h-4 mr-2" />
                        Save Draft
                      </Button>
                    </div>
                  </div>
                )}

                {/* Reviewers Tab */}
                {/* {activeTab === 'reviewers' && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900 mb-2">Reviewers</h2>
                      <p className="text-slate-600 text-sm mb-6">
                        Add managers or supervisors who can review roleplay sessions and provide feedback.
                      </p>
                    </div>

                    <div className="p-8 text-center bg-slate-50 rounded-lg border-2 border-dashed border-slate-300">
                      <div className="text-5xl mb-3">👥</div>
                      <h3 className="text-lg font-semibold text-slate-700 mb-2">Reviewer Management</h3>
                      <p className="text-slate-600 mb-4">
                        This feature allows you to assign reviewers to assess and provide feedback on roleplay sessions.
                      </p>
                      <Button variant="outline" disabled>
                        Add Reviewers (Coming Soon)
                      </Button>
                    </div>

                    <div className="flex justify-end pt-4">
                      <Button
                        onClick={handleSaveDraft}
                        variant="outline"
                        size="lg"
                        className="px-8"
                      >
                        <Save className="w-4 h-4 mr-2" />
                        Save Draft
                      </Button>
                    </div>
                  </div>
                )} */}

                {/* Insights Tab */}
                {/* {activeTab === 'insights' && (
                  <div className="space-y-6">
                    <div>
                      <h2 className="text-2xl font-bold text-slate-900 mb-2">Insights</h2>
                      <p className="text-slate-600 text-sm mb-6">
                        View analytics and performance trends for this roleplay scenario.
                      </p>
                    </div>

                    <div className="p-8 text-center bg-slate-50 rounded-lg border-2 border-dashed border-slate-300">
                      <div className="text-5xl mb-3">💡</div>
                      <h3 className="text-lg font-semibold text-slate-700 mb-2">Insights & Analytics</h3>
                      <p className="text-slate-600 mb-4">
                        Once learners complete this roleplay, you'll see detailed insights including completion rates, average scores, and common challenges.
                      </p>
                      <div className="grid grid-cols-3 gap-4 mt-6 text-left">
                        <div className="bg-white p-4 rounded-lg border border-slate-200">
                          <div className="text-2xl font-bold text-purple-600">-</div>
                          <div className="text-sm text-slate-600 mt-1">Completions</div>
                        </div>
                        <div className="bg-white p-4 rounded-lg border border-slate-200">
                          <div className="text-2xl font-bold text-green-600">-</div>
                          <div className="text-sm text-slate-600 mt-1">Avg. Score</div>
                        </div>
                        <div className="bg-white p-4 rounded-lg border border-slate-200">
                          <div className="text-2xl font-bold text-blue-600">-</div>
                          <div className="text-sm text-slate-600 mt-1">Pass Rate</div>
                        </div>
                      </div>
                    </div>

                    <div className="flex justify-end pt-4">
                      <Button
                        onClick={handleSaveDraft}
                        variant="outline"
                        size="lg"
                        className="px-8"
                      >
                        <Save className="w-4 h-4 mr-2" />
                        Save Draft
                      </Button>
                    </div>
                  </div>
                )} */}
              </Card>
            </div>
          </div>

          {/* Sticky Save Changes bar — only in edit mode */}
          {isEditMode && (
            <div className="fixed bottom-0 right-0 z-50 bg-white border-t border-slate-200 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] transition-all duration-300" style={{ left: sidebarLeft }}>
              <div className="px-6 pr-20 py-3 flex items-center justify-between gap-4">
                <div className="flex items-center gap-2">
                  {saveSuccess ? (
                    <span className="flex items-center gap-2 text-green-600 font-semibold text-sm">
                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      Changes saved successfully!
                    </span>
                  ) : (
                    <span className="text-slate-500 text-sm">
                      You are editing <span className="font-semibold text-slate-700">{formData.title || 'this scenario'}</span>. Your changes will be saved when you click <span className="font-semibold">Update Changes</span>.
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Button
                    variant="outline"
                    onClick={() => router.push('/employee/roleplay')}
                    className="border-slate-300"
                  >
                    Discard & Exit
                  </Button>
                  <Button
                    onClick={handleSaveChanges}
                    disabled={isSaving}
                    className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white flex items-center gap-2 px-6"
                  >
                    {isSaving ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                        </svg>
                        Saving…
                      </>
                    ) : (
                      <>
                        <Save className="w-4 h-4" />
                        Update Changes
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
      </main>
    </div>
  );
}




export default function CreateRoleplayPage() {
  return(
    <Suspense fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
      <CreateRoleplayComponent />
    </Suspense>
  )
//   const router = useRouter();
//   const searchParams = useSearchParams();
//   const isEditMode = searchParams.get('edit') === 'true';

//   const { user, loading: authLoading, logout } = useAuth();
      
    
//   const [activeTab, setActiveTab] = useState<string>('learner-brief');
//   const [hasSavedDraft, setHasSavedDraft] = useState<boolean>(false);
//   const [editingScenarioId, setEditingScenarioId] = useState<string | null>(null);
//   const [formData, setFormData] = useState<CustomRoleplayData>({
//     title: '',
//     description: '',
//     learnerBrief: '',
//     aiRole: '',
//     aiPersonality: '',
//     aiObjectives: '',
//     endConditions: '',
//     maxDuration: 15,
//     minTurns: 5,
//     evaluationParameters: [
//       { name: 'Communication Skills', description: 'Clarity and effectiveness of communication', weight: 25 },
//       { name: 'Problem Solving', description: 'Ability to address challenges', weight: 25 },
//       { name: 'Professionalism', description: 'Professional demeanor and approach', weight: 25 },
//       { name: 'Goal Achievement', description: 'Success in meeting objectives', weight: 25 },
//     ],
//     cutoffScore: 60,
//     difficulty: 'Medium',
//     tone: 'Neutral',
//     userRole: '',
//     initialPrompt: '',
//   });
//   const [errors, setErrors] = useState<string[]>([]);

//   useEffect(() => {
//     if(user?.email)fetchUserData();
//   },[user, searchParams])
  
//   // Check for saved draft or edit scenario on component mount
//   useEffect(() => {
//     // Load scenario for editing if in edit mode
//     if (isEditMode) {
//       const editScenarioData = sessionStorage.getItem('editScenario');
//       if (editScenarioData) {
//         try {
//           const scenario: Scenario = JSON.parse(editScenarioData);
//           setEditingScenarioId(scenario.id);
          
//           // Ensure evaluationParams is an array
//           let evalParams = [
//             { name: 'Communication Skills', description: 'Clarity and effectiveness of communication', weight: 25 },
//             { name: 'Problem Solving', description: 'Ability to address challenges', weight: 25 },
//             { name: 'Professionalism', description: 'Professional demeanor and approach', weight: 25 },
//             { name: 'Goal Achievement', description: 'Success in meeting objectives', weight: 25 },
//           ];
          
//           if (scenario.evaluationParams) {
//             if (Array.isArray(scenario.evaluationParams)) {
//               evalParams = scenario.evaluationParams;
//             } else if (typeof scenario.evaluationParams === 'object') {
//               // If it's an object, try to convert it to array format
//               evalParams = Object.entries(scenario.evaluationParams).map(([name, desc]: [string, any]) => ({
//                 name,
//                 description: typeof desc === 'string' ? desc : String(desc),
//                 weight: 25
//               }));
//             }
//           }
          
//           setFormData({
//             title: scenario.title || '',
//             description: scenario.description || '',
//             learnerBrief: scenario.learnerBrief || '',
//             aiRole: scenario.role || '',
//             aiPersonality: scenario.aiPersonality || '',
//             aiObjectives: scenario.aiObjectives || '',
//             endConditions: scenario.endConditions || '',
//             maxDuration: scenario.maxDuration || 15,
//             minTurns: scenario.minTurns || 5,
//             evaluationParameters: evalParams,
//             cutoffScore: scenario.passingScore || 60,
//             difficulty: scenario.difficulty || 'Medium',
//             tone: scenario.tone || 'Neutral',
//             userRole: scenario.userRole || '',
//             initialPrompt: scenario.initialPrompt || '',
//           });
//           // Clear from sessionStorage
//           sessionStorage.removeItem('editScenario');
//         } catch (error) {
//           console.error('Error loading edit scenario:', error);
//         }
//       }
//     } else {
//       // Check for saved draft
//       const savedDraft = localStorage.getItem('roleplayDraft');
//       if (savedDraft) {
//         setHasSavedDraft(true);
//       }
//     }
//   }, [isEditMode]);

//   const fetchUserData = async () => {
//     console.log('Fetching user data...');
//     if (user) {
//       const {data:userData} = await supabase.from('users').select('user_id,company_id').eq('email',user.email).single();
//       if(userData) {
//         userId = userData.user_id;
//         userCompanyId = userData.company_id;
//       }
//       console.log('Fetched user ID:', userId);
//       console.log('Fetched user Company ID:', userCompanyId);
//     }else{
//       console.log('User not logged in yet.');
//     }
  
//   }

//   // Predefined options
//   const scenarioTemplates = [
//     { value: 'customer-service', label: 'Customer Service Interaction', description: 'Handle customer inquiries and resolve issues' },
//     { value: 'sales-pitch', label: 'Sales Pitch', description: 'Present and sell a product or service' },
//     { value: 'team-meeting', label: 'Team Meeting', description: 'Lead or participate in a team discussion' },
//     { value: 'conflict-resolution', label: 'Conflict Resolution', description: 'Address and resolve workplace conflicts' },
//     { value: 'performance-review', label: 'Performance Review', description: 'Conduct or receive performance feedback' },
//     { value: 'client-presentation', label: 'Client Presentation', description: 'Present to stakeholders or clients' },
//     { value: 'custom', label: 'Custom Scenario', description: 'Create your own unique scenario' },
//   ];

//   const roleOptions = [
//     'Customer Service Representative',
//     'Sales Representative',
//     'Team Leader',
//     'Manager',
//     'Consultant',
//     'Trainer',
//     'Support Specialist',
//     'Account Executive',
//     'Project Manager',
//   ];

//   const aiRoleOptions = [
//     'Customer',
//     'Client',
//     'Manager',
//     'Colleague',
//     'Supervisor',
//     'Team Member',
//     'Stakeholder',
//     'Vendor',
//     'Partner',
//   ];

//   const evaluationTemplates = {
//     'customer-service': [
//       { name: 'Active Listening', description: 'Ability to listen and understand customer needs', weight: 25 },
//       { name: 'Problem Resolution', description: 'Effectiveness in resolving customer issues', weight: 25 },
//       { name: 'Empathy & Courtesy', description: 'Demonstrates empathy and professional courtesy', weight: 25 },
//       { name: 'Product Knowledge', description: 'Understanding of products/services', weight: 25 },
//     ],
//     'sales': [
//       { name: 'Value Proposition', description: 'Clear communication of product value', weight: 25 },
//       { name: 'Objection Handling', description: 'Ability to address customer concerns', weight: 25 },
//       { name: 'Closing Techniques', description: 'Effectiveness in moving towards commitment', weight: 25 },
//       { name: 'Relationship Building', description: 'Building rapport and trust', weight: 25 },
//     ],
//     'leadership': [
//       { name: 'Communication Clarity', description: 'Clear and effective communication', weight: 25 },
//       { name: 'Team Motivation', description: 'Ability to inspire and motivate', weight: 25 },
//       { name: 'Decision Making', description: 'Quality of decisions and problem-solving', weight: 25 },
//       { name: 'Conflict Management', description: 'Handling disagreements professionally', weight: 25 },
//     ],
//     'default': [
//       { name: 'Communication Skills', description: 'Clarity and effectiveness of communication', weight: 25 },
//       { name: 'Problem Solving', description: 'Ability to address challenges', weight: 25 },
//       { name: 'Professionalism', description: 'Professional demeanor and approach', weight: 25 },
//       { name: 'Goal Achievement', description: 'Success in meeting objectives', weight: 25 },
//     ],
//   };

//   const cutoffScorePresets = [
//     { value: 50, label: '50% - Introductory', description: 'For beginners or practice sessions' },
//     { value: 60, label: '60% - Standard', description: 'Typical passing score for most training' },
//     { value: 70, label: '70% - Proficient', description: 'For experienced learners' },
//     { value: 80, label: '80% - Advanced', description: 'For critical skills or certification' },
//     { value: 90, label: '90% - Expert', description: 'For high-stakes scenarios' },
//   ];

//   const tabs = [
//     { id: 'learner-brief', label: 'Learner Brief', icon: '📚' },
//     { id: 'avatar-instructions', label: 'AI Coach Instructions', icon: '🎭' },
//     { id: 'end-conditions', label: 'End Conditions', icon: '🏁' },
//     { id: 'evaluation', label: 'Evaluation parameters', icon: '📊' },
//     { id: 'cutoff-score', label: 'Cut off score', icon: '🎯' },
//     // { id: 'reviewers', label: 'Reviewers', icon: '👥' },
//     // { id: 'insights', label: 'Insights', icon: '💡' },
//   ];

//   const validateForm = (): boolean => {
//     const newErrors: string[] = [];

//     if (!formData.title.trim()) newErrors.push('Title is required');
//     if (!formData.learnerBrief.trim()) newErrors.push('Learner brief is required');
//     if (!formData.aiRole.trim()) newErrors.push('AI role is required');
//     if (!formData.userRole.trim()) newErrors.push('Your role is required');
//     if (!formData.initialPrompt.trim()) newErrors.push('Initial prompt is required');
    
//     const totalWeight = formData.evaluationParameters.reduce((sum, param) => sum + param.weight, 0);
//     if (totalWeight !== 100) newErrors.push('Evaluation parameter weights must total 100%');

//     setErrors(newErrors);
//     return newErrors.length === 0;
//   };

//   const handleStartRoleplay = async () => {
//     if (!validateForm()) {
//       alert('Please fix the errors before starting the roleplay');
//       return;
//     }

//     // Create a scenario object from the form data
//     const customScenario: Scenario = {
//       id: editingScenarioId || ('custom-' + Date.now()),
//       title: formData.title,
//       description: formData.description || formData.learnerBrief,
//       role: formData.aiRole,
//       difficulty: formData.difficulty,
//       initialPrompt: formData.initialPrompt,
//       userRole: formData.userRole,
//       tone: formData.tone,
//       learnerBrief: formData.learnerBrief,
//       // aiPersonality: formData.aiPersonality,
//       aiObjectives: formData.aiObjectives,
//       maxDuration: formData.maxDuration,
//       minTurns: formData.minTurns,
//       endConditions: formData.endConditions,
//       evaluationParams: formData.evaluationParameters,
//       passingScore: formData.cutoffScore
//     };

//     // Save or update scenario
//     if (isEditMode && editingScenarioId) {
//       // Update existing scenario
//       const { error } = await updateCustomScenario(editingScenarioId, customScenario);
//       if (error) {
//         alert('Failed to update scenario: ' + error.message);
//         return;
//       }
//       alert('Scenario updated successfully!');
//       // Navigate back to roleplay selection
//       router.push('/employee/roleplay');
//     } else {
//       // Create new scenario
//       const { error } = await insertCustomScenario(customScenario, userCompanyId);
//       if (error) {
//         alert('Failed to create scenario: ' + error.message);
//         return;
//       }

//       // Store the custom scenario and evaluation details in sessionStorage for immediate use
//       sessionStorage.setItem('customScenario', JSON.stringify(customScenario));
//       sessionStorage.setItem('customEvaluation', JSON.stringify({
//         parameters: formData.evaluationParameters,
//         cutoffScore: formData.cutoffScore,
//         endConditions: formData.endConditions,
//         maxDuration: formData.maxDuration,
//         minTurns: formData.minTurns,
//       }));

//       // Navigate to the roleplay page
//       router.push('/employee/roleplay?custom=true');
//     }
//   };

//   const handleSaveDraft = () => {
//     localStorage.setItem('roleplayDraft', JSON.stringify(formData));
//     setHasSavedDraft(true);
//     alert('Draft saved successfully!');
//   };

//   const handleLoadDraft = () => {
//     const savedDraft = localStorage.getItem('roleplayDraft');
//     if (savedDraft) {
//       try {
//         const draftData = JSON.parse(savedDraft);
//         setFormData(draftData);
//         alert('Draft loaded successfully!');
//       } catch (error) {
//         alert('Error loading draft. The draft may be corrupted.');
//       }
//     }
//   };

//   const handleClearDraft = () => {
//     if (confirm('Are you sure you want to clear the saved draft? This cannot be undone.')) {
//       localStorage.removeItem('roleplayDraft');
//       setHasSavedDraft(false);
//       alert('Draft cleared successfully!');
//     }
//   };

//   const loadEvaluationTemplate = (templateKey: string) => {
//     const template = evaluationTemplates[templateKey as keyof typeof evaluationTemplates] || evaluationTemplates.default;
//     setFormData({
//       ...formData,
//       evaluationParameters: template,
//     });
//   };

//   const addEvaluationParameter = () => {
//     setFormData({
//       ...formData,
//       evaluationParameters: [
//         ...formData.evaluationParameters,
//         { name: '', description: '', weight: 0 }
//       ]
//     });
//   };

//   const updateEvaluationParameter = (index: number, field: string, value: string | number) => {
//     const updated = [...formData.evaluationParameters];
//     updated[index] = { ...updated[index], [field]: value };
//     setFormData({ ...formData, evaluationParameters: updated });
//   };

//   const removeEvaluationParameter = (index: number) => {
//     const updated = formData.evaluationParameters.filter((_, i) => i !== index);
//     setFormData({ ...formData, evaluationParameters: updated });
//   };

//   const handleNext = () => {
//     const currentIndex = tabs.findIndex(tab => tab.id === activeTab);
//     if (currentIndex < tabs.length - 1) {
//       setActiveTab(tabs[currentIndex + 1].id);
//     }
//   };

//   const isLastTab = () => {
//     return activeTab === tabs[tabs.length - 1].id;
//   };

//   const getNextButtonLabel = () => {
//     const currentIndex = tabs.findIndex(tab => tab.id === activeTab);
//     if (currentIndex < tabs.length - 1) {
//       return tabs[currentIndex + 1].label;
//     }
//     return 'Start Roleplay';
//   };

//   return (
//     <div className="min-h-screen bg-slate-50">
//       <EmployeeNavigation />
      
//       <main 
//         className="transition-all duration-300 ease-in-out pt-6 pb-12"
//         style={{ marginLeft: 'var(--sidebar-width, 0px)' }}
//       >
//         <div className="container mx-auto px-4 py-6 max-w-7xl">
//           {/* Header */}
//           <div className="mb-6">
//             <button
//               onClick={() => router.back()}
//               className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4 transition-colors"
//             >
//               <ChevronLeft className="w-5 h-5" />
//               <span className="font-medium">Back to Role Play</span>
//             </button>
            
//             <div className="bg-white rounded-xl shadow-sm p-6 border border-slate-200">
//               <div className="flex items-center justify-between">
//                 <div className="flex items-center gap-3">
//                   <div className="text-4xl">✨</div>
//                   <div>
//                     <h1 className="text-2xl font-bold text-slate-900">
//                       {isEditMode ? 'Edit Roleplay Scenario' : 'Create Your Own Roleplay'}
//                     </h1>
//                     <p className="text-slate-600 mt-1">
//                       {isEditMode ? 'Update your custom scenario configuration' : 'Design a custom scenario tailored to your specific needs'}
//                     </p>
//                   </div>
//                 </div>
//                 <div className="flex gap-3">
//                   {hasSavedDraft && !isEditMode && (
//                     <>
//                       <Button 
//                         variant="outline"
//                         onClick={handleLoadDraft}
//                         className="flex items-center gap-2"
//                       >
//                         <Save className="w-4 h-4" />
//                         Load Draft
//                       </Button>
//                       <Button 
//                         variant="outline"
//                         onClick={handleClearDraft}
//                         className="flex items-center gap-2 text-red-600 hover:text-red-700 border-red-200 hover:border-red-300"
//                       >
//                         Clear Draft
//                       </Button>
//                     </>
//                   )}
//                   <Button 
//                     onClick={isLastTab() ? handleStartRoleplay : handleNext}
//                     className="bg-blue-600 hover:bg-blue-700 flex items-center gap-2"
//                   >
//                     {isLastTab() ? (
//                       <>
//                         {isEditMode ? (
//                           <>
//                             <Save className="w-4 h-4" />
//                             Update Scenario
//                           </>
//                         ) : (
//                           <>
//                             {/* <Play className="w-4 h-4" /> */}
//                             Save roleplay
//                           </>
//                         )}
//                       </>
//                     ) : (
//                       <>
//                         {getNextButtonLabel()}
//                         <ChevronLeft className="w-4 h-4 rotate-180" />
//                       </>
//                     )}
//                   </Button>
//                 </div>
//               </div>
//             </div>
//           </div>          {/* Error Display */}
//           {errors.length > 0 && (
//             <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
//               <div className="flex items-start gap-2">
//                 <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
//                 <div>
//                   <h3 className="font-semibold text-red-800 mb-2">Please fix the following errors:</h3>
//                   <ul className="list-disc list-inside text-red-700 space-y-1">
//                     {errors.map((error, index) => (
//                       <li key={index}>{error}</li>
//                     ))}
//                   </ul>
//                 </div>
//               </div>
//             </div>
//           )}

//           <div className="grid grid-cols-12 gap-6">
//             {/* Sidebar Navigation */}
//             <div className="col-span-3">
//               <Card className="p-6 sticky top-6">
//                 <nav className="space-y-2">
//                   {tabs.map((tab, index) => (
//                     <button
//                       key={tab.id}
//                       onClick={() => setActiveTab(tab.id)}
//                       className={`w-full text-left px-4 py-4 rounded-lg transition-all flex items-center gap-3 ${
//                         activeTab === tab.id
//                           ? 'bg-blue-100 text-blue-700 font-medium'
//                           : 'text-slate-600 hover:bg-slate-100'
//                       }`}
//                     >
//                       <span className="w-6 h-6 rounded-full flex items-center justify-center bg-slate-200 text-slate-700 text-sm font-semibold">
//                         {index + 1}
//                       </span>
//                       <span className="text-sm">{tab.label}</span>
//                     </button>
//                   ))}
//                 </nav>
//               </Card>
//             </div>

//             {/* Main Content */}
//             <div className="col-span-9">
//               <Card className="p-8">
//                 {/* Learner Brief Tab */}
//                 {activeTab === 'learner-brief' && (
//                   <div className="space-y-6">
//                     <div>
//                       <h2 className="text-2xl font-bold text-slate-900 mb-2">Brief for the learner</h2>
//                       <p className="text-slate-600 text-sm mb-6">
//                         Brief the learner on the scenario and objective during roleplay. Learners will see this.
//                       </p>
//                     </div>
                    
//                     {/* Role Clarification Info Box - Hidden */}
//                     {/* <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 mb-6">
//                       <div className="flex gap-3">
//                         <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
//                         <div>
//                           <h3 className="font-semibold text-blue-900 mb-2">Understanding Roles in Roleplay</h3>
//                           <div className="text-sm text-blue-800 space-y-2">
//                             <p>
//                               <span className="inline-block px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-bold mr-2">YOUR ROLE (Learner)</span>
//                               This is the role <strong>YOU</strong> will practice as. For example: "Sales Manager", "Customer Service Rep"
//                             </p>
//                             <p>
//                               <span className="inline-block px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-bold mr-2">AI COACH ROLE</span>
//                               This is who the <strong>AI Coach will play</strong>. For example: "Customer", "Client", "Team Member"
//                             </p>
//                             <p className="italic pt-2 border-t border-blue-200">
//                               Example: If YOU practice as a "Sales Manager" (Your Role), the AI might play a "Customer" (AI Coach Role)
//                             </p>
//                           </div>
//                         </div>
//                       </div>
//                     </div> */}

//                     <div>
//                       <label className="block text-sm font-medium text-slate-700 mb-2">
//                         Scenario Template (Optional)
//                       </label>
//                       <select
//                         onChange={(e) => {
//                           const template = scenarioTemplates.find(t => t.value === e.target.value);
//                           if (template && e.target.value !== 'custom') {
//                             setFormData({
//                               ...formData,
//                               title: template.label,
//                               description: template.description,
//                             });
//                           }
//                         }}
//                         className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base bg-white"
//                       >
//                         <option value="">Select a template to get started...</option>
//                         {scenarioTemplates.map((template) => (
//                           <option key={template.value} value={template.value}>
//                             {template.label} - {template.description}
//                           </option>
//                         ))}
//                       </select>
//                       <p className="text-xs text-slate-500 mt-1">Choose a template to auto-fill common scenarios</p>
//                     </div>

//                     <div>
//                       <label className="block text-sm font-medium text-slate-700 mb-2">
//                         Scenario Title *
//                       </label>
//                       <input
//                         type="text"
//                         value={formData.title}
//                         onChange={(e) => setFormData({ ...formData, title: e.target.value })}
//                         placeholder="e.g., Customer Service Interaction, Team Meeting Simulation"
//                         className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base"
//                       />
//                     </div>

//                     <div>
//                       <label className="block text-sm font-medium text-slate-700 mb-2">
//                         <span className="flex items-center gap-2">
//                           <span className="px-2 py-1 bg-green-100 text-green-700 rounded text-xs font-semibold">YOUR ROLE</span>
//                           Learner's Role (What YOU will practice as) *
//                         </span>
//                       </label>
//                       <select
//                         value={formData.userRole}
//                         onChange={(e) => setFormData({ ...formData, userRole: e.target.value })}
//                         className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base bg-white"
//                       >
//                         <option value="">Select your role...</option>
//                         {roleOptions.map((role) => (
//                           <option key={role} value={role}>
//                             {role}
//                           </option>
//                         ))}
//                       </select>
//                       <p className="text-xs text-slate-500 mt-1">This is the role YOU will practice as during the roleplay</p>
//                     </div>

//                     <div>
//                       <label className="block text-sm font-medium text-slate-700 mb-2">
//                         Custom Role (if not listed above)
//                       </label>
//                       <input
//                         type="text"
//                         value={formData.userRole && !roleOptions.includes(formData.userRole) ? formData.userRole : ''}
//                         onChange={(e) => setFormData({ ...formData, userRole: e.target.value })}
//                         placeholder="Enter a custom role if none of the above fit"
//                         className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base"
//                       />
//                     </div>

//                     <div>
//                       <label className="block text-sm font-medium text-slate-700 mb-2">
//                         Instructions for Learners
//                       </label>

//                       <textarea
//                         value={formData.learnerBrief}
//                         onChange={(e) => setFormData({ ...formData, learnerBrief: e.target.value })}
//                         placeholder="📣 Instructions for Learners

// Welcome to this roleplay practice session.
// In this exercise, you will interact with a virtual character to practice and improve your professional communication skills.

// ✅ What You Need to Do:

// 1. Greet and introduce yourself professionally.
//    Begin with a polite greeting and clearly state your name and role.

// 2. Present your main points clearly.
//    • Communicate your key message
//    • Use clear and simple language
//    • Stay focused on your objectives

// 3. Listen and respond appropriately.
//    Pay attention to questions or concerns and provide thoughtful responses.

// 4. Conclude professionally.
//    Summarize the conversation and end with a courteous closing statement."
//                         rows={15}
//                         className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base"
//                       />
//                     </div>

//                     {/* Save Draft Button */}
//                     <div className="flex justify-end pt-4">
//                       <Button
//                         onClick={handleSaveDraft}
//                         variant="outline"
//                         size="lg"
//                         className="px-8"
//                       >
//                         <Save className="w-4 h-4 mr-2" />
//                         Save Draft
//                       </Button>
//                     </div>
//                   </div>
//                 )}

//                 {/* AI Coach Instructions Tab */}
//                 {activeTab === 'avatar-instructions' && (
//                   <div className="space-y-6">
//                     <div>
//                       <h2 className="text-2xl font-bold text-slate-900 mb-2">AI Coach Instructions</h2>
//                       <p className="text-slate-600 text-sm mb-6">
//                         Define the AI Coach character's role, personality, and behavior guidelines.
//                       </p>
//                     </div>
                    
//                     {/* Role Reminder Box */}
//                     <div className="bg-blue-50 border-2 border-blue-200 rounded-lg p-4 mb-6">
//                       <div className="flex gap-3">
//                         <AlertCircle className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
//                         <div className="text-sm text-blue-800">
//                           <p className="font-semibold mb-1">Remember:</p>
//                           <p>
//                             The <span className="px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-bold">AI COACH</span> is the character the AI will play.
//                             The <span className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs font-bold">LEARNER</span> is the role the user will practice as.
//                           </p>
//                         </div>
//                       </div>
//                     </div>

//                     <div>
//                       <label className="block text-sm font-medium text-slate-700 mb-2">
//                         <span className="flex items-center gap-2">
//                           <span className="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-semibold">AI COACH</span>
//                           AI Coach Character Role (Who the AI will play) *
//                         </span>
//                       </label>
//                       <select
//                         value={formData.aiRole}
//                         onChange={(e) => setFormData({ ...formData, aiRole: e.target.value })}
//                         className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base bg-white"
//                       >
//                         <option value="">Select AI character role...</option>
//                         {aiRoleOptions.map((role) => (
//                           <option key={role} value={role}>
//                             {role}
//                           </option>
//                         ))}
//                       </select>
//                       <p className="text-xs text-slate-500 mt-1">This is the character the AI Coach will play during the roleplay</p>
//                     </div>

//                     <div>
//                       <label className="block text-sm font-medium text-slate-700 mb-2">
//                         Custom AI Coach Role (if not listed above)
//                       </label>
//                       <input
//                         type="text"
//                         value={formData.aiRole && !aiRoleOptions.includes(formData.aiRole) ? formData.aiRole : ''}
//                         onChange={(e) => setFormData({ ...formData, aiRole: e.target.value })}
//                         placeholder="Enter a custom AI Coach role"
//                         className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base"
//                       />
//                       <p className="text-xs text-slate-500 mt-1">E.g., "Frustrated Customer", "Senior Executive", "Technical Expert"</p>
//                     </div>

//                     <div>
//                       <label className="block text-sm font-medium text-slate-700 mb-2">
//                         Personality & Tone *
//                       </label>
//                       <select
//                         value={formData.tone}
//                         onChange={(e) => setFormData({ ...formData, tone: e.target.value as any })}
//                         className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base bg-white"
//                       >
//                         <option value="Friendly">😊 Friendly - Warm and approachable</option>
//                         <option value="Neutral">😐 Neutral - Professional and balanced</option>
//                         <option value="Aggressive">😠 Aggressive - Challenging and critical</option>
//                       </select>
//                     </div>

//                     <div>
//                       <label className="block text-sm font-medium text-slate-700 mb-2">
//                         AI Coach's Opening Line *
//                       </label>
//                       <textarea
//                         value={formData.initialPrompt}
//                         onChange={(e) => setFormData({ ...formData, initialPrompt: e.target.value })}
//                         placeholder="What should the AI Coach character say first? e.g., 'Hello, how can I help you today?' or 'Good morning. What would you like to discuss?'"
//                         rows={3}
//                         className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base"
//                       />
//                     </div>

//                     <div>
//                       <label className="block text-sm font-medium text-slate-700 mb-2">
//                         AI Coach's Objectives & Guidelines
//                       </label>
//                       <textarea
//                         value={formData.aiObjectives}
//                         onChange={(e) => setFormData({ ...formData, aiObjectives: e.target.value })}
//                         placeholder="What should the AI try to achieve or test? e.g., 'Test the learner's ability to explain concepts clearly, handle objections professionally, and maintain a positive interaction throughout the conversation.'"
//                         rows={4}
//                         className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base"
//                       />
//                     </div>

//                     <div>
//                       <label className="block text-sm font-medium text-slate-700 mb-2">
//                         Difficulty Level *
//                       </label>
//                       <select
//                         value={formData.difficulty}
//                         onChange={(e) => setFormData({ ...formData, difficulty: e.target.value as any })}
//                         className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base"
//                       >
//                         <option value="Easy">Easy - Basic questions and supportive responses</option>
//                         <option value="Medium">Medium - Moderate challenges and objections</option>
//                         <option value="Hard">Hard - Complex scenarios with strong objections</option>
//                       </select>
//                     </div>

//                     {/* Save Draft Button */}
//                     <div className="flex justify-end pt-4">
//                       <Button
//                         onClick={handleSaveDraft}
//                         variant="outline"
//                         size="lg"
//                         className="px-8"
//                       >
//                         <Save className="w-4 h-4 mr-2" />
//                         Save Draft
//                       </Button>
//                     </div>
//                   </div>
//                 )}

//                 {/* End Conditions Tab */}
//                 {activeTab === 'end-conditions' && (
//                   <div className="space-y-6">
//                     <div>
//                       <h2 className="text-2xl font-bold text-slate-900 mb-2">End Conditions</h2>
//                       <p className="text-slate-600 text-sm mb-6">
//                         Define when the roleplay session should automatically end.
//                       </p>
//                     </div>

//                     <div>
//                       <label className="block text-sm font-medium text-slate-700 mb-2">
//                         Maximum Duration (minutes)
//                       </label>
//                       <input
//                         type="number"
//                         value={formData.maxDuration}
//                         onChange={(e) => setFormData({ ...formData, maxDuration: parseInt(e.target.value) || 15 })}
//                         min="1"
//                         max="60"
//                         className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base"
//                       />
//                       <p className="text-sm text-slate-500 mt-1">
//                         The session will end after this many minutes
//                       </p>
//                     </div>

//                     <div>
//                       <label className="block text-sm font-medium text-slate-700 mb-2">
//                         Minimum Conversation Turns
//                       </label>
//                       <input
//                         type="number"
//                         value={formData.minTurns}
//                         onChange={(e) => setFormData({ ...formData, minTurns: parseInt(e.target.value) || 5 })}
//                         min="1"
//                         max="50"
//                         className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base"
//                       />
//                       <p className="text-sm text-slate-500 mt-1">
//                         Number of back-and-forth exchanges required before ending
//                       </p>
//                     </div>

//                     <div>
//                       <label className="block text-sm font-medium text-slate-700 mb-2">
//                         Custom End Conditions
//                       </label>
//                       <textarea
//                         value={formData.endConditions}
//                         onChange={(e) => setFormData({ ...formData, endConditions: e.target.value })}
//                         placeholder="Define specific conditions that should trigger the end of the session, e.g., 'End when the learner has successfully addressed all concerns' or 'End when both parties reach an agreement' or 'End when the main objective has been achieved'"
//                         rows={5}
//                         className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base"
//                       />
//                     </div>

//                     {/* Save Draft Button */}
//                     <div className="flex justify-end pt-4">
//                       <Button
//                         onClick={handleSaveDraft}
//                         variant="outline"
//                         size="lg"
//                         className="px-8"
//                       >
//                         <Save className="w-4 h-4 mr-2" />
//                         Save Draft
//                       </Button>
//                     </div>
//                   </div>
//                 )}

//                 {/* Evaluation Parameters Tab */}
//                 {activeTab === 'evaluation' && (
//                   <div className="space-y-6">
//                     <div>
//                       <h2 className="text-2xl font-bold text-slate-900 mb-2">Evaluation Parameters</h2>
//                       <p className="text-slate-600 text-sm mb-6">
//                         Define the criteria for assessing the learner's performance. Total weight must equal 100%.
//                       </p>
//                     </div>

//                     <div>
//                       <label className="block text-sm font-medium text-slate-700 mb-2">
//                         Evaluation Template
//                       </label>
//                       <select
//                         onChange={(e) => {
//                           if (e.target.value) {
//                             loadEvaluationTemplate(e.target.value);
//                           }
//                         }}
//                         className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent text-base bg-white"
//                       >
//                         <option value="">Select a template...</option>
//                         <option value="customer-service">Customer Service - Focus on listening, resolution, empathy</option>
//                         <option value="sales">Sales - Focus on value proposition, objection handling, closing</option>
//                         <option value="leadership">Leadership - Focus on communication, motivation, decision making</option>
//                         <option value="default">General - Balanced communication and problem-solving</option>
//                       </select>
//                       <p className="text-xs text-slate-500 mt-1">Choose a template or customize your own parameters below</p>
//                     </div>

//                     <div className="space-y-4">
//                       {(Array.isArray(formData.evaluationParameters) ? formData.evaluationParameters : []).map((param, index) => (
//                         <Card key={index} className="p-4 bg-slate-50">
//                           <div className="flex items-start gap-4">
//                             <div className="flex-1 space-y-3">
//                               <input
//                                 type="text"
//                                 value={param.name}
//                                 onChange={(e) => updateEvaluationParameter(index, 'name', e.target.value)}
//                                 placeholder="Parameter name"
//                                 className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
//                               />
//                               <textarea
//                                 value={param.description}
//                                 onChange={(e) => updateEvaluationParameter(index, 'description', e.target.value)}
//                                 placeholder="Description of what this parameter measures"
//                                 rows={2}
//                                 className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
//                               />
//                             </div>
//                             <div className="w-32">
//                               <label className="block text-xs font-medium text-slate-600 mb-1">Weight (%)</label>
//                               <input
//                                 type="number"
//                                 value={param.weight}
//                                 onChange={(e) => updateEvaluationParameter(index, 'weight', parseInt(e.target.value) || 0)}
//                                 min="0"
//                                 max="100"
//                                 className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
//                               />
//                             </div>
//                             <button
//                               onClick={() => removeEvaluationParameter(index)}
//                               className="text-red-600 hover:text-red-700 p-2"
//                               title="Remove parameter"
//                             >
//                               ✕
//                             </button>
//                           </div>
//                         </Card>
//                       ))}
//                     </div>

//                     <div className="flex items-center justify-between p-4 bg-purple-50 rounded-lg border border-purple-200">
//                       <span className="font-medium text-slate-700">
//                         Total Weight: {formData.evaluationParameters.reduce((sum, p) => sum + p.weight, 0)}%
//                       </span>
//                       {formData.evaluationParameters.reduce((sum, p) => sum + p.weight, 0) !== 100 && (
//                         <span className="text-red-600 text-sm">Must equal 100%</span>
//                       )}
//                     </div>

//                     <Button
//                       onClick={addEvaluationParameter}
//                       variant="outline"
//                       className="w-full border-dashed"
//                     >
//                       + Add Parameter
//                     </Button>

//                     {/* Save Draft Button */}
//                     <div className="flex justify-end pt-4">
//                       <Button
//                         onClick={handleSaveDraft}
//                         variant="outline"
//                         size="lg"
//                         className="px-8"
//                       >
//                         <Save className="w-4 h-4 mr-2" />
//                         Save Draft
//                       </Button>
//                     </div>
//                   </div>
//                 )}

//                 {/* Cut Off Score Tab */}
//                 {activeTab === 'cutoff-score' && (
//                   <div className="space-y-6">
//                     <div>
//                       <h2 className="text-2xl font-bold text-slate-900 mb-2">Cut Off Score</h2>
//                       <p className="text-slate-600 text-sm mb-6">
//                         Set the minimum passing score for this roleplay scenario.
//                       </p>
//                     </div>

//                     <div>
//                       <label className="block text-sm font-medium text-slate-700 mb-2">
//                         Quick Presets
//                       </label>
//                       <div className="grid grid-cols-5 gap-2 mb-4">
//                         {cutoffScorePresets.map((preset) => (
//                           <button
//                             key={preset.value}
//                             onClick={() => setFormData({ ...formData, cutoffScore: preset.value })}
//                             className={`p-3 rounded-lg border-2 transition-all text-center ${
//                               formData.cutoffScore === preset.value
//                                 ? 'border-blue-500 bg-blue-50'
//                                 : 'border-slate-200 hover:border-blue-300'
//                             }`}
//                             title={preset.description}
//                           >
//                             <div className="text-2xl font-bold text-slate-900">{preset.value}%</div>
//                             <div className="text-xs text-slate-600 mt-1">{preset.label.split(' - ')[1]}</div>
//                           </button>
//                         ))}
//                       </div>
//                     </div>

//                     <div>
//                       <label className="block text-sm font-medium text-slate-700 mb-2">
//                         Custom Passing Score (%)
//                       </label>
//                       <div className="flex items-center gap-4">
//                         <input
//                           type="range"
//                           value={formData.cutoffScore}
//                           onChange={(e) => setFormData({ ...formData, cutoffScore: parseInt(e.target.value) })}
//                           min="0"
//                           max="100"
//                           className="flex-1"
//                         />
//                         <input
//                           type="number"
//                           value={formData.cutoffScore}
//                           onChange={(e) => setFormData({ ...formData, cutoffScore: parseInt(e.target.value) || 0 })}
//                           min="0"
//                           max="100"
//                           className="w-20 px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center"
//                         />
//                         <span className="text-slate-700 font-medium">%</span>
//                       </div>
//                     </div>

//                     <div className="p-6 bg-slate-50 rounded-lg border border-slate-200">
//                       <h3 className="font-semibold text-slate-900 mb-3">Score Interpretation</h3>
//                       <div className="space-y-2 text-sm">
//                         <div className="flex items-center gap-3">
//                           <div className="w-4 h-4 bg-green-500 rounded"></div>
//                           <span><strong>Pass:</strong> Score ≥ {formData.cutoffScore}%</span>
//                         </div>
//                         <div className="flex items-center gap-3">
//                           <div className="w-4 h-4 bg-red-500 rounded"></div>
//                           <span><strong>Fail:</strong> Score &lt; {formData.cutoffScore}%</span>
//                         </div>
//                       </div>
//                     </div>

//                     <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
//                       <p className="text-sm text-blue-900">
//                         <strong>💡 Tip:</strong> A typical passing score is between 60-70%. Set it higher for critical skills or lower for introductory training.
//                       </p>
//                     </div>

//                     {/* Save Draft Button */}
//                     <div className="flex justify-end pt-4">
//                       <Button
//                         onClick={handleSaveDraft}
//                         variant="outline"
//                         size="lg"
//                         className="px-8"
//                       >
//                         <Save className="w-4 h-4 mr-2" />
//                         Save Draft
//                       </Button>
//                     </div>
//                   </div>
//                 )}

//                 {/* Reviewers Tab */}
//                 {/* {activeTab === 'reviewers' && (
//                   <div className="space-y-6">
//                     <div>
//                       <h2 className="text-2xl font-bold text-slate-900 mb-2">Reviewers</h2>
//                       <p className="text-slate-600 text-sm mb-6">
//                         Add managers or supervisors who can review roleplay sessions and provide feedback.
//                       </p>
//                     </div>

//                     <div className="p-8 text-center bg-slate-50 rounded-lg border-2 border-dashed border-slate-300">
//                       <div className="text-5xl mb-3">👥</div>
//                       <h3 className="text-lg font-semibold text-slate-700 mb-2">Reviewer Management</h3>
//                       <p className="text-slate-600 mb-4">
//                         This feature allows you to assign reviewers to assess and provide feedback on roleplay sessions.
//                       </p>
//                       <Button variant="outline" disabled>
//                         Add Reviewers (Coming Soon)
//                       </Button>
//                     </div>

//                     <div className="flex justify-end pt-4">
//                       <Button
//                         onClick={handleSaveDraft}
//                         variant="outline"
//                         size="lg"
//                         className="px-8"
//                       >
//                         <Save className="w-4 h-4 mr-2" />
//                         Save Draft
//                       </Button>
//                     </div>
//                   </div>
//                 )} */}

//                 {/* Insights Tab */}
//                 {/* {activeTab === 'insights' && (
//                   <div className="space-y-6">
//                     <div>
//                       <h2 className="text-2xl font-bold text-slate-900 mb-2">Insights</h2>
//                       <p className="text-slate-600 text-sm mb-6">
//                         View analytics and performance trends for this roleplay scenario.
//                       </p>
//                     </div>

//                     <div className="p-8 text-center bg-slate-50 rounded-lg border-2 border-dashed border-slate-300">
//                       <div className="text-5xl mb-3">💡</div>
//                       <h3 className="text-lg font-semibold text-slate-700 mb-2">Insights & Analytics</h3>
//                       <p className="text-slate-600 mb-4">
//                         Once learners complete this roleplay, you'll see detailed insights including completion rates, average scores, and common challenges.
//                       </p>
//                       <div className="grid grid-cols-3 gap-4 mt-6 text-left">
//                         <div className="bg-white p-4 rounded-lg border border-slate-200">
//                           <div className="text-2xl font-bold text-purple-600">-</div>
//                           <div className="text-sm text-slate-600 mt-1">Completions</div>
//                         </div>
//                         <div className="bg-white p-4 rounded-lg border border-slate-200">
//                           <div className="text-2xl font-bold text-green-600">-</div>
//                           <div className="text-sm text-slate-600 mt-1">Avg. Score</div>
//                         </div>
//                         <div className="bg-white p-4 rounded-lg border border-slate-200">
//                           <div className="text-2xl font-bold text-blue-600">-</div>
//                           <div className="text-sm text-slate-600 mt-1">Pass Rate</div>
//                         </div>
//                       </div>
//                     </div>

//                     <div className="flex justify-end pt-4">
//                       <Button
//                         onClick={handleSaveDraft}
//                         variant="outline"
//                         size="lg"
//                         className="px-8"
//                       >
//                         <Save className="w-4 h-4 mr-2" />
//                         Save Draft
//                       </Button>
//                     </div>
//                   </div>
//                 )} */}
//               </Card>
//             </div>
//           </div>
//         </div>
//       </main>
//     </div>
//   );
}
