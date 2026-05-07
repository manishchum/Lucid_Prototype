"use client"

import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/contexts/auth-context";
import { supabase } from "@/lib/supabase";
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import { BarChart3, TrendingUp, CheckCircle, User, BookOpen, AlertCircle, Target, Brain, FileText, Clock, Award } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  PointElement,
  LineElement,
} from 'chart.js';
import { Bar, Pie, Doughnut, Line } from 'react-chartjs-2';
import * as xlsx from 'xlsx';
import { useRouter } from "next/navigation";

// Register ChartJS components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  PointElement,
  LineElement
);

interface Admin {
  user_id: string;
  email: string;
  name: string | null;
  company_id: string;
}

const API_URL = process.env.NEXT_PUBLIC_BACKEND_URL;

// helper: fetch users for a company via backend (do not query users table from frontend)
const fetchCompanyUsers = async (companyId: string, adminUserId?: string) => {
  try {
    const res = await fetchWithAuth(`${API_URL}/api/users/company/${companyId}`, {
      headers: adminUserId ? { 'X-User-ID': adminUserId } : undefined
    });
    if (!res.ok) return [];
    const payload = await res.json();
    const users = payload?.data?.users ?? payload?.users ?? payload;
    return Array.isArray(users) ? users : users ? [users] : [];
  } catch (e) {
    console.error('[fetchCompanyUsers] error', e);
    return [];
  }
};

const loadModules = async (companyId: string, adminUserId?: string) => {
  try {
    const res = await fetchWithAuth(`${API_URL}/api/training-modules/company/${encodeURIComponent(companyId)}`, {
      headers: adminUserId ? { 'X-User-ID': adminUserId } : undefined
    });
    if (!res.ok) {
      console.warn('[loadModules] backend returned', res.status);
      return [];
    }
    const payload = await res.json().catch(() => ({}));
    return payload?.data?.modules ?? payload?.modules ?? [];
  } catch (e) {
    console.error('[loadModules] error', e);
    return [];
  }
};

function UserDetailPanel({ user, onBack, allProgressData }: { user: any; onBack: () => void; allProgressData?: any[] }) {
  const sprintsOpened = user.completedItems ?? 0;
  const totalSprints  = user.totalItems ?? 0;
  const quizScore     = user.quizScore ?? 0;
  
  // Get all sprints for this user and calculate time spent from them
  const userSprints = allProgressData?.filter((p: any) => p.user_id === user.user_id) || [];
  const totalTimeSeconds = userSprints.reduce((sum, p: any) => sum + (p.time_spent_seconds || 0), 0);
  const timeSpent = totalTimeSeconds > 0 ? `${(totalTimeSeconds / 3600).toFixed(1)}h` : '—';
  
  const statusStyles: Record<string,string> = { COMPLETED:'bg-green-100 text-green-700', IN_PROGRESS:'bg-yellow-100 text-yellow-700', ASSIGNED:'bg-red-100 text-red-600' };
  const statusLabels: Record<string,string> = { COMPLETED:'COMPLETED', IN_PROGRESS:'IN PROGRESS', ASSIGNED:'NOT STARTED' };
  
  // Create comprehensive activity log with timestamps
  const activities = userSprints
    .sort((a: any, b: any) => new Date(b.assigned_on).getTime() - new Date(a.assigned_on).getTime())
    .map((sprint: any) => [
      { 
        icon:'📖', 
        color:'bg-purple-500', 
        title:`Opened — ${sprint.training_modules?.title || 'Sprint'}`, 
        time: sprint.assigned_on ? new Date(sprint.assigned_on).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '', 
        sprintId: sprint.module_id,
        timestamp: sprint.assigned_on
      },
      (sprint.status === 'IN_PROGRESS' || sprint.status === 'COMPLETED') && sprint.started_at ? { 
        icon:'▶️', 
        color:'bg-blue-500', 
        title:`Started — ${sprint.training_modules?.title || 'Sprint'}`, 
        time: new Date(sprint.started_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), 
        sprintId: sprint.module_id,
        timestamp: sprint.started_at
      } : null,
      sprint.status === 'COMPLETED' && sprint.completed_at ? { 
        icon:'✓', 
        color:'bg-green-500', 
        title:`Completed — ${sprint.training_modules?.title || 'Sprint'}`, 
        time: new Date(sprint.completed_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }), 
        sprintId: sprint.module_id,
        timestamp: sprint.completed_at
      } : null,
    ].filter(Boolean))
    .flat()
    .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()) as any[];

  return (
    <div>
      <div className="flex items-center gap-4 mb-1">
        <button onClick={onBack} className="flex items-center gap-2 text-sm text-gray-600 border border-gray-200 rounded-lg px-4 py-2 hover:bg-gray-50">
          ← Back
        </button>
        <h2 className="text-2xl font-bold text-gray-900">{user.users?.name}</h2>
        <span className={`text-xs font-semibold px-3 py-1 rounded-md ${statusStyles[user.status] || 'bg-gray-100 text-gray-600'}`}>
          {statusLabels[user.status] || user.status}
        </span>
      </div>
      <p className="text-sm text-gray-400 mb-6 ml-24">Last active: {user.last_active_at ? new Date(user.last_active_at).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Never'}</p>
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { label:'Sprints opened', value:`${sprintsOpened}/${totalSprints}` },
          { label:'Time spent', value:timeSpent },
        ].map((s, i) => (
          <div key={i} className="bg-white border border-gray-200 rounded-xl p-6">
            <p className="text-sm text-gray-500 mb-2">{s.label}</p>
            <p className="text-3xl font-bold text-gray-900">{s.value}</p>
          </div>
        ))}
      </div>
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Activity Timeline</p>
      <div className="space-y-1">
        {activities.length === 0 ? (
          <div className="text-center py-8 text-gray-400">
            <p>No activity recorded yet</p>
          </div>
        ) : (
          activities.map((event: any, i: number) => (
            <div key={i} className="flex gap-4 pb-4">
              <div className="flex flex-col items-center">
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-base flex-shrink-0 ${event.color}`}>
                  {event.icon}
                </div>
                {i < activities.length - 1 && <div className="w-0.5 flex-1 bg-gray-200 my-2 min-h-6" />}
              </div>
              <div className="pb-5 flex-1 pt-1">
                <p className="font-medium text-gray-900">{event.title}</p>
                <p className="text-sm text-gray-500 mt-0.5">
                  {event.time}
                </p>
                {event.detail && (
                  <div className="mt-2 bg-blue-50 rounded-lg px-3 py-2 text-sm text-gray-600 border border-blue-100">
                    {event.detail}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Update ProgressAnalytics to accept adminUserId so it can call backend safely
function ProgressAnalytics({ companyId, adminUserId }: { companyId: string, adminUserId?: string }) {
  const [progressData, setProgressData] = useState<any[]>([]);
  const [moduleStats, setModuleStats] = useState<any[]>([]);
  const [assessmentStats, setAssessmentStats] = useState<any[]>([]);
  const [learningStyleStats, setLearningStyleStats] = useState<any[]>([]);
  const [kpiStats, setKpiStats] = useState<any[]>([]);
  const [overallStats, setOverallStats] = useState({
    totalAssignments: 0,
    completedAssignments: 0,
    inProgressAssignments: 0,
    notStartedAssignments: 0,
    totalModules: 0,
    totalEmployees: 0,
    activeEmployees: 0,
    averageAssessmentScore: 0,
    totalAssessments: 0,
    completedAssessments: 0,
    averageKpiScore: 0,
    learningStylesCompleted: 0
  });
  const [loading, setLoading] = useState(true);
  const [selectedModule, setSelectedModule] = useState<string>('all');
  const [selectedTimeRange, setSelectedTimeRange] = useState<string>('30');
  const [selectedAssessmentType, setSelectedAssessmentType] = useState<string>('all');
  const [modules, setModules] = useState<any[]>([]);
  const [companyLearningStyleEnabled, setCompanyLearningStyleEnabled] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<string>('Overview');
  const [selectedUser, setSelectedUser] = useState<any>(null);

  // Memoize loadAnalyticsData to avoid recreating it on every render
  const loadAnalyticsDataHandler = async () => {
    if (!companyId || !adminUserId) {
      console.warn('[Analytics] Missing companyId or adminUserId', { companyId, adminUserId });
      return;
    }
    
    // console.log('[Analytics] Starting data load for company:', companyId);
    setLoading(true);
    try {
      try{
        const compRes = await fetchWithAuth(`${API_URL}/api/companies/${encodeURIComponent(companyId)}`);
        if (compRes.ok) {
          const compPayload = await compRes.json().catch(() => null);
          const companyData = compPayload?.data?.company ?? compPayload?.data ?? compPayload?.company ?? compPayload;
          setCompanyLearningStyleEnabled(companyData?.learning_style_enabled ?? true);
          // console.log('[Analytics] Company data loaded:', companyData?.learning_style_enabled);
        } else {
          console.warn('Failed to fetch company data for learning style setting');
          setCompanyLearningStyleEnabled(false);
        }
      } catch (e) {
        console.error('Error fetching company data:', e);
        setCompanyLearningStyleEnabled(false);
      }

      // Load modules from backend then other analytics (other loaders may depend on modules/state)
      // console.log('[Analytics] Loading modules...');
      const mods = await loadModules(companyId, adminUserId);
      // console.log('[Analytics] Modules loaded:', mods?.length || 0);
      setModules(mods);
      
      // console.log('[Analytics] Loading all analytics data in parallel...');
      await Promise.all([
        loadLearningPlanData(mods),
        loadAssessmentData(),
        loadLearningStyleData(),
        loadKpiData(),
        loadOverallStatistics()
      ]);
      // console.log('[Analytics] All data loaded successfully');
    } catch (error) {
      console.error('Failed to load analytics data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (companyId && adminUserId) {
      loadAnalyticsDataHandler();
    }
  }, [companyId, adminUserId, selectedModule, selectedTimeRange, selectedAssessmentType]);

  const loadAnalyticsData = async () => {
    setLoading(true);
    try {
      try{
        const compRes = await fetchWithAuth(`${API_URL}/api/companies/${encodeURIComponent(companyId)}`);
        if (compRes.ok) {
          const compPayload = await compRes.json().catch(() => null);
          const companyData = compPayload?.data?.company ?? compPayload?.data ?? compPayload?.company ?? compPayload;
          setCompanyLearningStyleEnabled(companyData?.learning_style_enabled ?? true);
        } else {
          console.warn('Failed to fetch company data for learning style setting');
          setCompanyLearningStyleEnabled(false);
        }
      } catch (e) {
        console.error('Error fetching company data:', e);
        setCompanyLearningStyleEnabled(false);
      }

      // Load modules from backend then other analytics (other loaders may depend on modules/state)
      const mods = await loadModules(companyId, adminUserId);
      setModules(mods);
      await Promise.all([
        loadLearningPlanData(),
        loadAssessmentData(),
        loadLearningStyleData(),
        loadKpiData(),
        loadOverallStatistics()
      ]);
    } catch (error) {
      console.error('Failed to load analytics data:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadLearningPlanData = async (modulesData?: any[]) => {
    try {
      // Use passed modules or fall back to state
      const modsToUse = modulesData || modules;
      
      // Fetch company users via backend and build userId list
      const companyUsers = await fetchCompanyUsers(companyId, adminUserId);
      const companyUserIds = (companyUsers || []).map((u: any) => u.user_id).filter(Boolean);
      if (companyUserIds.length === 0) {
        // console.log('[LP] No company users found');
        setProgressData([]);
        return;
      }

      // Query learning_plan for users in this company via backend API
      const lpRes = await fetchWithAuth(
        `${API_URL}/api/learning-plans/?limit=5000`,
        { headers: { 'X-User-ID': adminUserId || '' } }
      );

      if (!lpRes.ok) {
        console.error('[analytics] Error fetching learning plans');
        setProgressData([]);
        return;
      }

      const lpData = await lpRes.json();
      console.log('[LP] raw response count:', lpData?.plans?.length, 'companyUsers count:', companyUserIds?.length);
      let allPlans = lpData?.data?.plans ?? lpData?.plans ?? [];

      // Filter by company users
      let learningPlans = allPlans.filter((lp: any) => companyUserIds.includes(lp.user_id));

      // Apply module filter
      if (selectedModule !== 'all') {
        learningPlans = learningPlans.filter((lp: any) => lp.module_id === selectedModule);
      }

      // Apply time range filter
      if (selectedTimeRange !== 'all') {
        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - parseInt(selectedTimeRange));
        learningPlans = learningPlans.filter((lp: any) =>
          lp.assigned_on && new Date(lp.assigned_on) >= daysAgo
        );
      }

      // Enrich learning plans with training module data
      const moduleMap = new Map((modsToUse || []).map((m: any) => [m.module_id, m]));
      // console.log('[LP] Module map has', moduleMap.size, 'modules');
      
      let enrichedResults = learningPlans.map((lp: any) => {
        const mod = moduleMap.get(lp.module_id);
        // console.log('[LP] Enriching plan for module', lp.module_id, '- found:', !!mod);
        return {
          ...lp,
          training_modules: mod || { 
            module_id: lp.module_id, 
            title: 'Unknown Module',
            processing_status: 'UNKNOWN'
          }
        };
      });
      // const { data: progressResults, error } = await query.order('assigned_on', { ascending: false });

      // if (error) throw error;

      // let enrichedResults = progressResults || [];

      if (enrichedResults.length > 0) {
        // Get original module ids and processed modules as before
        const moduleIds = [...new Set(enrichedResults.map(r => r.module_id))];

        // Fetch processed_modules via backend route per original_module_id (frontend should not query DB directly)
        const processedModulesData: any[] = [];
        for (const origId of moduleIds) {
          try {
            const pmRes = await fetchWithAuth(`${API_URL}/api/processed-modules/original-module/${encodeURIComponent(origId)}`, {
              headers: adminUserId ? { 'X-User-ID': adminUserId } : undefined
            });
            if (!pmRes.ok) {
              const txt = await pmRes.text().catch(()=> '');
              console.warn(`[analytics] failed to fetch processed modules for ${origId}:`, pmRes.status, txt);
              continue;
            }
            const pmPayload = await pmRes.json().catch(()=> ({}));
            const pms = pmPayload?.data?.modules ?? pmPayload?.data ?? pmPayload?.modules ?? pmPayload ?? [];
            (Array.isArray(pms) ? pms : []).forEach((pm: any) => {
              processedModulesData.push({
                processed_module_id: pm.processed_module_id,
                original_module_id: pm.original_module_id
              });
            });
          } catch (e) {
            console.error('[analytics] error fetching processed modules for', origId, e);
          }
        }
 
         const moduleIdToProcessedIds = new Map();
         processedModulesData?.forEach(pm => {
           if (!moduleIdToProcessedIds.has(pm.original_module_id)) {
             moduleIdToProcessedIds.set(pm.original_module_id, []);
           }
           moduleIdToProcessedIds.get(pm.original_module_id).push(pm.processed_module_id);
         });

         const allProcessedModuleIds = Array.from(moduleIdToProcessedIds.values()).flat();

         const moduleProgressData : any[] = [];
          for (const pmId of allProcessedModuleIds) {
            try {
              const mpRes = await fetchWithAuth(`${API_URL}/api/module-progress/module/${encodeURIComponent(pmId)}`, {
                headers: adminUserId ? { 'X-User-ID': adminUserId } : undefined
              });

              if (!mpRes.ok) {
                const txt = await mpRes.text().catch(()=> '');
                console.warn(`[analytics] failed to fetch module progress for ${pmId}:`, mpRes.status, txt);
                continue;
              }

              const mpPayload = await mpRes.json().catch(()=> ({}));
              const items = mpPayload?.data?.progress ?? mpPayload?.data ?? mpPayload?.progress ?? mpPayload ?? [];
              (Array.isArray(items) ? items : [items]).forEach((rec: any) => {
                if (rec.user_id && rec.processed_module_id) {
                  moduleProgressData.push({
                    user_id: rec.user_id,
                    processed_module_id: rec.processed_module_id,
                    completed_at: rec.completed_at
                  });
                }
              });
            } catch (e) {
              console.error('[analytics] error fetching module progress for', pmId, e);
            }
          }

         const progressMap = new Map();
         moduleProgressData.forEach(mp => {
           const key = `${mp.user_id}-${mp.processed_module_id}`;
           progressMap.set(key, mp);
         });
         // Merge user info from companyUsers (avoid direct users table calls)
         const userMap = new Map((companyUsers || []).map((u: any) => [u.user_id, u]));

         enrichedResults = enrichedResults.map(record => {
           const processedModuleIds = moduleIdToProcessedIds.get(record.module_id) || [];
           const completedProcessedModules = processedModuleIds.filter(pmId => {
             const key = `${record.user_id}-${pmId}`;
             return progressMap.has(key);
           });

           const user = userMap.get(record.user_id) || { name: 'Unknown', email: '', department_id: null };

           return {
             ...record,
             users: user,
             status: (completedProcessedModules.length === 0) ? 'ASSIGNED' :
                     (completedProcessedModules.length === processedModuleIds.length) ? 'COMPLETED' : 'IN_PROGRESS',
             completedItems: completedProcessedModules.length,
             totalItems: processedModuleIds.length
           };
         });
         
         // Fetch and enrich with assessment scores
         try {
          //  console.log('[LP] Fetching assessment scores for quiz data enrichment...');
           const assessmentRes = await fetchWithAuth(
             `${API_URL}/api/employee-assessments/company/${encodeURIComponent(companyId)}`,
             { headers: { 'X-User-ID': adminUserId || '' } }
           );

           if (assessmentRes.ok) {
             const assessmentPayload = await assessmentRes.json().catch(() => ({}));
             const allAssessments = assessmentPayload?.data?.assessments || assessmentPayload?.assessments || [];
            //  console.log('[LP] Assessment records fetched:', allAssessments.length);
             
             // Create a map of assessments by user_id for quick lookup
             const assessmentsByUser = new Map();
             allAssessments.forEach((assessment: any) => {
               if (!assessmentsByUser.has(assessment.user_id)) {
                 assessmentsByUser.set(assessment.user_id, []);
               }
               assessmentsByUser.get(assessment.user_id).push(assessment);
             });

             // Enrich progressData with assessment scores
             enrichedResults = enrichedResults.map(record => {
               const userAssessments = assessmentsByUser.get(record.user_id) || [];
               
               // Get assessment scores for this user (calculate average if multiple)
               const scores = userAssessments
                 .filter((a: any) => a.score !== null && a.max_score && a.max_score > 0)
                 .map((a: any) => (a.score / a.max_score) * 100);
               
               const avgScore = scores.length > 0
                 ? Math.round(scores.reduce((sum: number, s: number) => sum + s, 0) / scores.length)
                 : 0;

              //  console.log(`[LP] User ${record.user_id} - ${scores.length} assessments, avg score: ${avgScore}%`);

               return {
                 ...record,
                 score: avgScore,
                 max_score: 100,
                 assessments: userAssessments
               };
             });
           } else {
             console.warn('[LP] Failed to fetch assessments:', assessmentRes.status);
           }
         } catch (e) {
           console.error('[LP] Error fetching assessments for score enrichment:', e);
         }
      }

      setProgressData(enrichedResults);
      // DEBUG
      // console.log('[LP] enrichedResults count:', enrichedResults.length, 'sample:', enrichedResults[0]);
      calculateModuleStatistics(enrichedResults);
    } catch (err) {
      console.error('loadLearningPlanData error', err);
    }
  };

  const loadAssessmentData = async () => {
    try {
      if (!adminUserId) {
        console.warn('[loadAssessmentData] No adminUserId available');
        calculateAssessmentStatistics([]);
        return;
      }

      // Build query parameters
      const params = new URLSearchParams();
      params.append('limit', '500');
      
      // Note: The backend filters by company when we use the company endpoint
      // but we'll fetch assessment details separately if needed

      // Fetch employee assessments from backend
      const assessmentRes = await fetchWithAuth(
        `${API_URL}/api/employee-assessments/company/${encodeURIComponent(companyId)}?${params.toString()}`,
        {
          headers: {
            'X-User-ID': adminUserId
          }
        }
      );

      if (!assessmentRes.ok) {
        const error = await assessmentRes.text().catch(() => 'Unknown error');
        console.error('[loadAssessmentData] Failed to fetch assessments:', assessmentRes.status, error);
        calculateAssessmentStatistics([]);
        return;
      }

      const assessmentPayload = await assessmentRes.json().catch(() => ({ assessments: [] }));
      let assessmentResults = assessmentPayload?.data?.assessments || assessmentPayload?.assessments || [];
      // DEBUG
      // console.log('[Assessments] raw payload:', assessmentPayload);
      // console.log('[Assessments] results count:', assessmentResults.length);

      // Apply time range filter on frontend since backend doesn't support it yet
      if (selectedTimeRange !== 'all') {
        const daysAgo = new Date();
        daysAgo.setDate(daysAgo.getDate() - parseInt(selectedTimeRange));
        const cutoffDate = daysAgo.toISOString();
        assessmentResults = assessmentResults.filter((a: any) => 
          a.completed_at && a.completed_at >= cutoffDate
        );
      }

      // Enrich assessment results with additional data
      // Get unique assessment IDs
      const assessmentIds = [...new Set(assessmentResults.map((a: any) => a.assessment_id).filter(Boolean))];
      
      // Fetch assessment details for all assessments
      const assessmentDetailsMap = new Map();
      for (const assessId of assessmentIds) {
        try {
          const res = await fetchWithAuth(`${API_URL}/api/assessments/${encodeURIComponent(assessId)}`, {
            headers: { 'X-User-ID': adminUserId }
          });
          if (res.ok) {
            const data = await res.json();
            const assessment = data?.data?.assessment ?? data?.data ?? data?.assessment ?? data;
            assessmentDetailsMap.set(assessId, assessment);
          }
        } catch (e) {
          console.error(`[loadAssessmentData] Failed to fetch assessment ${assessId}:`, e);
        }
      }

      // Get unique processed_module_ids from assessments
      const processedModuleIds = [...new Set(
        Array.from(assessmentDetailsMap.values())
          .map((a: any) => a.processed_module_id)
          .filter(Boolean)
      )];

      // Fetch processed module details
      const processedModulesMap = new Map();
      for (const pmId of processedModuleIds) {
        try {
          const res = await fetchWithAuth(`${API_URL}/api/processed-modules/${encodeURIComponent(pmId)}`, {
            headers: { 'X-User-ID': adminUserId }
          });
          if (res.ok) {
            const data = await res.json();
            const pm = data?.data?.module ?? data?.data ?? data?.module ?? data;
            processedModulesMap.set(pmId, pm);
          }
        } catch (e) {
          console.error(`[loadAssessmentData] Failed to fetch processed module ${pmId}:`, e);
        }
      }

      // Get unique original_module_ids
      const originalModuleIds = [...new Set(
        Array.from(processedModulesMap.values())
          .map((pm: any) => pm.original_module_id)
          .filter(Boolean)
      )];

      // Fetch training module details
      const trainingModulesMap = new Map();
      for (const modId of originalModuleIds) {
        try {
          const res = await fetchWithAuth(`${API_URL}/api/training-modules/${encodeURIComponent(modId)}`, {
            headers: { 'X-User-ID': adminUserId }
          });
          if (res.ok) {
            const data = await res.json();
            const module = data?.data?.module ?? data?.data ?? data?.module ?? data;
            trainingModulesMap.set(modId, module);
          }
        } catch (e) {
          console.error(`[loadAssessmentData] Failed to fetch training module ${modId}:`, e);
        }
      }

      // Enrich assessment results with nested data
      const enrichedResults = assessmentResults.map((empAssessment: any) => {
        const assessment = assessmentDetailsMap.get(empAssessment.assessment_id) || {};
        const processedModule = processedModulesMap.get(assessment.processed_module_id) || {};
        const trainingModule = trainingModulesMap.get(processedModule.original_module_id) || {};

        return {
          ...empAssessment,
          assessments: {
            assessment_id: assessment.assessment_id,
            type: assessment.type,
            created_at: assessment.created_at,
            company_id: assessment.company_id,
            learning_style: assessment.learning_style,
            processed_module_id: assessment.processed_module_id,
            processed_modules: {
              title: processedModule.title,
              learning_style: processedModule.learning_style,
              original_module_id: processedModule.original_module_id,
              training_modules: {
                title: trainingModule.title
              }
            }
          }
        };
      });

      // Apply assessment type filter
      let filteredResults = enrichedResults;
      if (selectedAssessmentType !== 'all') {
        filteredResults = enrichedResults.filter((a: any) => 
          a.assessments?.type === selectedAssessmentType
        );
      }

      calculateAssessmentStatistics(filteredResults);
    } catch (error) {
      console.error('[loadAssessmentData] Error:', error);
      calculateAssessmentStatistics([]);
    }
  };

  const loadLearningStyleData = async () => {
    try {
      const { data: learningStyleResults, error: styleError } = await supabase
        .from('employee_learning_style')
        .select('user_id, learning_style, created_at, updated_at');

      if (styleError) {
        console.error('Error fetching learning styles:', styleError);
        return;
      }

      // Get users for this company via backend
      const companyUsers = await fetchCompanyUsers(companyId, adminUserId);

      const userIds = new Set((companyUsers || []).map(u => u.user_id));
      const filteredResults = (learningStyleResults || []).filter((ls: any) => userIds.has(ls.user_id));

      const mergedResults = filteredResults.map((ls: any) => {
        const user = (companyUsers || []).find((u: any) => u.user_id === ls.user_id);
        return {
          ...ls,
          users: user || { name: 'Unknown', email: '', company_id: companyId, department_id: null }
        };
      });

      calculateLearningStyleStatistics(mergedResults);
    } catch (error) {
      console.error('Failed to load learning style data:', error);
    }
  };

  const loadKpiData = async () => {
    let kpiQuery = supabase
      .from('employee_kpi')
      .select(`
        employee_kpi_id,
        score,
        scored_at,
        user_id,
        users!inner(name, email, company_id, department_id),
        kpis!inner(name, description, benchmark, datatype)
      `)
      .eq('company_id', companyId);

    // Apply time range filter
    if (selectedTimeRange !== 'all') {
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - parseInt(selectedTimeRange));
      kpiQuery = kpiQuery.gte('scored_at', daysAgo.toISOString());
    }

    const { data: kpiResults, error } = await kpiQuery.order('scored_at', { ascending: false });

    if (error) throw error;

    calculateKpiStatistics(kpiResults || []);
  };

  const loadOverallStatistics = async () => {
    try {
      // Get company users via backend
      const companyUsers = await fetchCompanyUsers(companyId, adminUserId);
      const totalEmployees = companyUsers.length;
      const activeEmployees = companyUsers.filter(emp => emp.employment_status === 'ACTIVE').length;

      // Other stats remain the same (modules, assessments, kpIs, learning style counts)
      const moduleList = await loadModules(companyId, adminUserId);
      const totalModules = moduleList.length;

      // Fetch employee assessments from backend
      let assessmentData: any[] = [];
      try {
        if (adminUserId) {
          const assessmentRes = await fetchWithAuth(
            `${API_URL}/api/employee-assessments/company/${encodeURIComponent(companyId)}?limit=500`,
            {
              headers: {
                'X-User-ID': adminUserId
              }
            }
          );
          // console.log("Assessment response status:", assessmentRes);
          if (assessmentRes.ok) {
            const payload = await assessmentRes.json().catch(() => ({ assessments: [] }));
            assessmentData = payload?.data?.assessments || payload?.assessments || [];
          } else {
            // console.log("Failed in else");
            console.warn('[loadOverallStatistics] Failed to fetch assessments:', assessmentRes.status);
          }
        }
      } catch (e) {
        console.error('[loadOverallStatistics] Error fetching assessments:', e);
      }

      // DEBUG
      // console.log('[Overall] totalEmployees:', totalEmployees, 'assessmentData count:', assessmentData.length);
      const totalAssessments = assessmentData?.length || 0;
      const completedAssessments = assessmentData?.filter(assessment => assessment.score !== null).length || 0;
      const averageAssessmentScore = assessmentData && assessmentData.length > 0
        ? Math.round(assessmentData
            .filter(assessment => assessment.score !== null && assessment.max_score > 0)
            .reduce((sum: number, assessment: any) => sum + (assessment.score / assessment.max_score * 100), 0) /
              assessmentData.filter((assessment: any) => assessment.score !== null && assessment.max_score > 0).length)
        : 0;

      const { data: kpiData } = await supabase
        .from('employee_kpi')
        .select('score')
        .eq('company_id', companyId);

      const averageKpiScore = kpiData && kpiData.length > 0
        ? Math.round(kpiData.reduce((sum: number, kpi: any) => sum + Number(kpi.score), 0) / kpiData.length)
        : 0;

      const { data: learningStyleData } = await supabase
        .from('employee_learning_style')
        .select(`
          user_id
        `);

      const learningStylesCompleted = (learningStyleData || []).filter((ls: any) => userIdsHas(companyUsers, ls.user_id)).length;

      // Calculate assignment counts from progressData
      const totalAssignments = progressData.length;
      const completedAssignments = progressData.filter((p: any) => p.status === 'COMPLETED').length;
      const inProgressAssignments = progressData.filter((p: any) => p.status === 'IN_PROGRESS').length;
      const notStartedAssignments = progressData.filter((p: any) => p.status === 'ASSIGNED').length;

      setOverallStats(prevStats => ({
        ...prevStats,
        totalEmployees,
        activeEmployees,
        totalModules,
        totalAssignments,
        completedAssignments,
        inProgressAssignments,
        notStartedAssignments,
        totalAssessments,
        completedAssessments,
        averageAssessmentScore,
        averageKpiScore,
        learningStylesCompleted
      }));
    } catch (error) {
      console.error('Failed to load overall statistics:', error);
    }
  };

  // helper to check if a user_id exists in company users
  const userIdsHas = (companyUsers: any[], userId: string) => {
    return companyUsers.some((u: any) => u.user_id === userId);
  };

  const calculateModuleStatistics = (data: any[]) => {
    const moduleMap = new Map();
    const assessmentScores = new Map(); // Track assessment scores per module
    const videoData = new Map(); // Track video data per module

    data.forEach(item => {
      const moduleId = item.training_modules.module_id;
      const moduleTitle = item.training_modules.title;

      if (!moduleMap.has(moduleId)) {
        moduleMap.set(moduleId, {
          moduleId,
          title: moduleTitle,
          totalAssigned: 0,
          completed: 0,
          inProgress: 0,
          notStarted: 0,
          completionTimes: [],
          baselineRequired: 0,
          processingStatus: item.training_modules.processing_status,
          scores: [] // Track assessment scores
        });
      }

      const moduleStats = moduleMap.get(moduleId);
      moduleStats.totalAssigned++;

      if (item.baseline_assessment === 1) {
        moduleStats.baselineRequired++;
      }

      // Track assessment scores from progressData
      if (item.score !== null && item.max_score > 0) {
        const scorePercent = (item.score / item.max_score) * 100;
        moduleStats.scores.push(scorePercent);
      }

      switch (item.status) {
        case 'COMPLETED':
          moduleStats.completed++;
          if (item.assigned_on && item.completed_at) {
            const completionTime = new Date(item.completed_at).getTime() - new Date(item.assigned_on).getTime();
            moduleStats.completionTimes.push(completionTime / (1000 * 60 * 60 * 24));
          }
          break;
        case 'IN_PROGRESS':
          moduleStats.inProgress++;
          break;
        case 'ASSIGNED':
          moduleStats.notStarted++;
          break;
      }
    });

    const moduleStatsArray = Array.from(moduleMap.values()).map(stats => ({
      ...stats,
      completionRate: stats.totalAssigned > 0 ? Math.round((stats.completed / stats.totalAssigned) * 100) : 0,
      averageCompletionTime: stats.completionTimes.length > 0
        ? Math.round(stats.completionTimes.reduce((sum, time) => sum + time, 0) / stats.completionTimes.length)
        : 0,
      baselineCompletionRate: stats.baselineRequired > 0 ? Math.round((stats.baselineRequired / stats.totalAssigned) * 100) : 0,
      averageScore: stats.scores.length > 0
        ? Math.round(stats.scores.reduce((sum, score) => sum + score, 0) / stats.scores.length)
        : 0,
      video_seconds_total: 0, // Placeholder - may be populated from video data if available
      video_seconds_watched: 0 // Placeholder - may be populated from video data if available
    }));

    setModuleStats(moduleStatsArray);

    // Update overall stats from learning plan data
    const totalAssignments = data.length;
    const completedAssignments = data.filter(item => item.status === 'COMPLETED').length;
    const inProgressAssignments = data.filter(item => item.status === 'IN_PROGRESS').length;
    const notStartedAssignments = data.filter(item => item.status === 'ASSIGNED').length;

    setOverallStats(prev => ({
      ...prev,
      totalAssignments,
      completedAssignments,
      inProgressAssignments,
      notStartedAssignments
    }));
  };

  const calculateAssessmentStatistics = (data: any[]) => {
    const assessmentMap = new Map();

    data.forEach(item => {
      const assessmentType = item.assessments.type;
      const moduleTitle = item.assessments.processed_modules?.training_modules?.title || 'Unknown Module';
      const key = `${assessmentType}-${moduleTitle}`;

      if (!assessmentMap.has(key)) {
        assessmentMap.set(key, {
          type: assessmentType,
          moduleTitle,
          totalAttempts: 0,
          completed: 0,
          averageScore: 0,
          scores: [],
          learningStyle: item.assessments.learning_style
        });
      }

      const stats = assessmentMap.get(key);
      stats.totalAttempts++;

      if (item.score !== null && item.max_score > 0) {
        stats.completed++;
        const scorePercent = (item.score /item.max_score) * 100;
        stats.scores.push(scorePercent);
      }
    });

    const assessmentStatsArray = Array.from(assessmentMap.values()).map(stats => ({
      ...stats,
      completionRate: stats.totalAttempts > 0 ? Math.round((stats.completed / stats.totalAttempts) * 100) : 0,
      averageScore: stats.scores.length > 0 
        ? Math.round(stats.scores.reduce((sum, score) => sum + score, 0) / stats.scores.length)
        : 0
    }));

    setAssessmentStats(assessmentStatsArray);
  };

  const calculateLearningStyleStatistics = (data: any[]) => {
    // console.log('Calculating learning style statistics for:', data);
    
    if (!data || data.length === 0) {
      // console.log('No learning style data available');
      setLearningStyleStats([]);
      return;
    }

    const styleMap = new Map();
    const departmentMap = new Map();

    // data.forEach(item => {
    //   // Learning style distribution
    //   const style = item.learning_style || 'Unknown';
    //   styleMap.set(style, (styleMap.get(style) || 0) + 1);

    //   // Department breakdown
    //   const deptId = item.users?.department_id || 'unassigned';
    //   if (!departmentMap.has(deptId)) {
    //     departmentMap.set(deptId, { total: 0, styles: new Map() });
    //   }
    //   const deptStats = departmentMap.get(deptId);
    //   deptStats.total++;
    //   deptStats.styles.set(style, (deptStats.styles.get(style) || 0) + 1);
    // });

    const learningStyleStatsArray = Array.from(styleMap.entries()).map(([style, count]) => ({
      style,
      count,
      percentage: Math.round((count / data.length) * 100)
    }));

    // console.log('Learning style stats calculated:', learningStyleStatsArray);
    setLearningStyleStats(learningStyleStatsArray);
  };

  const calculateKpiStatistics = (data: any[]) => {
    const kpiMap = new Map();

    data.forEach(item => {
      const kpiName = item.kpis.name;
      const benchmark = item.kpis.benchmark;

      if (!kpiMap.has(kpiName)) {
        kpiMap.set(kpiName, {
          kpiName,
          benchmark,
          totalScores: 0,
          scores: [],
          aboveBenchmark: 0,
          belowBenchmark: 0,
          averageScore: 0
        });
      }

      const stats = kpiMap.get(kpiName);
      const score = Number(item.score);
      stats.scores.push(score);
      stats.totalScores++;

      if (benchmark) {
        if (score >= benchmark) {
          stats.aboveBenchmark++;
        } else {
          stats.belowBenchmark++;
        }
      }
    });

    const kpiStatsArray = Array.from(kpiMap.values()).map(stats => ({
      ...stats,
      averageScore: stats.scores.length > 0 
        ? Math.round(stats.scores.reduce((sum, score) => sum + score, 0) / stats.scores.length)
        : 0,
      benchmarkAchievementRate: stats.benchmark && stats.totalScores > 0
        ? Math.round((stats.aboveBenchmark / stats.totalScores) * 100)
        : null
    }));

    setKpiStats(kpiStatsArray);
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'COMPLETED':
        return <Badge className="bg-green-100 text-green-800">Completed</Badge>;
      case 'IN_PROGRESS':
        return <Badge className="bg-blue-100 text-blue-800">In Progress</Badge>;
      case 'ASSIGNED':
        return <Badge className="bg-yellow-100 text-yellow-800">Not Started</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const formatDate = (dateString: string | null) => {
    if (!dateString) return 'N/A';
    return new Date(dateString).toLocaleDateString();
  };

  const getDaysOverdue = (dueDate: string | null, status: string) => {
    if (!dueDate || status === 'COMPLETED') return null;
    const today = new Date();
    const due = new Date(dueDate);
    const diffTime = today.getTime() - due.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : null;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-2 text-gray-600">Loading analytics data...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl">
        {['Overview', 'Sprints', 'Detailed Analytics'].map(tab => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setSelectedUser(null); }}
            className={`px-5 py-2 text-sm rounded-lg transition-all ${
              activeTab === tab
                ? 'bg-white text-gray-900 font-medium shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-5">
        <div className="grid grid-cols-3 gap-6">
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Sprint filter</p>
            <select
              value={selectedModule}
              onChange={(e) => setSelectedModule(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white text-gray-700"
            >
              <option value="all">All Sprints</option>
              {modules.map((module: any) => (
                <option key={module.module_id} value={module.module_id}>
                  {module.title}
                </option>
              ))}
            </select>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Assessment type</p>
            <select
              value={selectedAssessmentType}
              onChange={(e) => setSelectedAssessmentType(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white text-gray-700"
            >
              <option value="all">All Types</option>
              <option value="baseline">Baseline</option>
              <option value="module">Sprint</option>
            </select>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Time range</p>
            <select
              value={selectedTimeRange}
              onChange={(e) => setSelectedTimeRange(e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm bg-white text-gray-700"
            >
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
              <option value="all">All Time</option>
            </select>
          </div>
        </div>
      </div>

      {selectedUser ? (
        <UserDetailPanel user={selectedUser} onBack={() => setSelectedUser(null)} allProgressData={progressData} />
      ) : (
        <>
          {activeTab === 'Overview' && (
            <div className="space-y-8">
              {/* Overall Statistics Cards */}
              <div className="grid grid-cols-2 border border-gray-200 rounded-xl overflow-hidden bg-white mb-8">
                <div className="p-6 border-r border-gray-200">
                  <p className="text-sm text-gray-500">Total learners</p>
                  <p className="text-4xl font-bold text-gray-900 mt-1">{overallStats.totalEmployees}</p>
                </div>
                <div className="p-6 border-r border-gray-200">
                  <p className="text-sm text-gray-500">Completion Rate</p>
                  <p className="text-4xl font-bold text-gray-900 mt-1">
                    {overallStats.totalAssignments > 0
                      ? Math.round(overallStats.completedAssignments / overallStats.totalAssignments * 100)
                      : 0}%
                  </p>
                </div>
              </div>

              {/* Detailed Analytics Graphs */}
              <div className="grid grid-cols-2 gap-6">
                {/* Module Completion Chart */}
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                  <h3 className="text-lg font-bold text-gray-900 mb-4">Sprint Completion Status</h3>
                  {moduleStats.length === 0 ? (
                    <div className="py-12 text-center text-sm text-gray-400">
                      Loading data...
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {moduleStats.slice(0, 5).map((module, idx) => (
                        <div key={module.moduleId} className="space-y-1">
                          <div className="flex justify-between text-sm">
                            <span className="font-medium text-gray-700">{module.title || `Sprint ${idx + 1}`}</span>
                            <span className="text-gray-500">{module.completionRate}%</span>
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full transition-all duration-300"
                              style={{
                                width: `${module.completionRate}%`,
                                background: module.completionRate === 100 ? '#6366F1' : module.completionRate >= 60 ? '#22C55E' : module.completionRate >= 40 ? '#F59E0B' : '#EF4444'
                              }}
                            />
                          </div>
                          <div className="flex justify-between text-xs text-gray-400">
                            <span>{module.completed} / {module.totalAssigned} completed</span>
                            <span>{module.inProgress} in progress</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Assignment Status Breakdown */}
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                  <h3 className="text-lg font-bold text-gray-900 mb-4">Assignment Status Overview</h3>
                  <div className="space-y-4">
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium text-gray-700 flex items-center gap-2">
                          <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                          Completed
                        </span>
                        <span className="font-bold text-gray-900">{overallStats.completedAssignments}</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-green-500"
                          style={{
                            width: `${overallStats.totalAssignments > 0 ? (overallStats.completedAssignments / overallStats.totalAssignments * 100) : 0}%`
                          }}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium text-gray-700 flex items-center gap-2">
                          <span className="w-2 h-2 bg-blue-500 rounded-full"></span>
                          In Progress
                        </span>
                        <span className="font-bold text-gray-900">{overallStats.inProgressAssignments}</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-500"
                          style={{
                            width: `${overallStats.totalAssignments > 0 ? (overallStats.inProgressAssignments / overallStats.totalAssignments * 100) : 0}%`
                          }}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="font-medium text-gray-700 flex items-center gap-2">
                          <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
                          Not Started
                        </span>
                        <span className="font-bold text-gray-900">{overallStats.notStartedAssignments}</span>
                      </div>
                      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-amber-500"
                          style={{
                            width: `${overallStats.totalAssignments > 0 ? (overallStats.notStartedAssignments / overallStats.totalAssignments * 100) : 0}%`
                          }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Assessment Statistics */}
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                  <h3 className="text-lg font-bold text-gray-900 mb-4">Assessment Performance</h3>
                  {assessmentStats.length === 0 ? (
                    <div className="py-12 text-center text-sm text-gray-400">
                      No assessment data available
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {assessmentStats.slice(0, 4).map((assessment, idx) => (
                        <div key={idx} className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="font-medium text-gray-700 truncate">
                              <span className="text-xs bg-gray-100 px-2 py-0.5 rounded mr-1">Sprint</span>
                              {assessment.moduleTitle}
                            </span>
                            <span className="text-gray-900 font-bold">{assessment.averageScore}%</span>
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-indigo-500 transition-all duration-300"
                              style={{ width: `${assessment.averageScore}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Learning Styles Distribution */}
                <div className="bg-white rounded-xl border border-gray-200 p-6">
                  <h3 className="text-lg font-bold text-gray-900 mb-4">Learning Styles Distribution</h3>
                  {learningStyleStats.length === 0 ? (
                    <div className="py-12 text-center text-sm text-gray-400">
                      No learning style data available
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {learningStyleStats.map((style, idx) => {
                        const colors = ['bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500', 'bg-pink-500'];
                        return (
                          <div key={idx} className="space-y-1">
                            <div className="flex justify-between text-sm">
                              <span className="font-medium text-gray-700">{style.style}</span>
                              <span className="text-gray-900 font-bold">{style.percentage}%</span>
                            </div>
                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full transition-all duration-300 ${colors[idx % colors.length]}`}
                                style={{ width: `${style.percentage}%` }}
                              />
                            </div>
                            <div className="text-xs text-gray-400">
                              {style.count} Learners
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* KPI Performance - COMMENTED OUT */}
              {/* 
              <div className="bg-white rounded-xl border border-gray-200 p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">KPI Performance Metrics</h3>
                {kpiStats.length === 0 ? (
                  <div className="py-12 text-center text-sm text-gray-400">
                    No KPI data available
                  </div>
                ) : (
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                    {kpiStats.map((kpi, idx) => (
                      <div key={idx} className="bg-gradient-to-br from-gray-50 to-gray-100 rounded-lg p-4 border border-gray-200">
                        <p className="text-sm font-medium text-gray-700 mb-2 truncate">{kpi.kpiName}</p>
                        <p className="text-2xl font-bold text-gray-900">{kpi.averageScore}</p>
                        <p className="text-xs text-gray-500 mt-1">Average score</p>
                        <div className="mt-3 pt-3 border-t border-gray-200">
                          <p className="text-xs text-gray-600">{kpi.totalScores} records</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              */}
            </div>
          )}

          {/*
          {activeTab === 'Users' && (
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">All learners</h2>
                <select className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700">
                  <option>All status</option>
                  <option>Completed</option>
                  <option>In Progress</option>
                  <option>Not Started</option>
                </select>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {['Name','Sprints opened','Time spent','Status'].map(h => (
                        <th key={h} className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {[...new Map(progressData.map((p: any) => [p.user_id, p])).values()].map((item: any, i: number) => {
                      const userAllSprints = progressData.filter((p: any) => p.user_id === item.user_id);
                      const totalSprints = userAllSprints.length;
                      const completedSprints = userAllSprints.filter((p: any) => p.status === 'COMPLETED').length;
                      const totalTimeSeconds = userAllSprints.reduce((sum, p: any) => sum + (p.time_spent_seconds || 0), 0);
                      const timeSpentHours = totalTimeSeconds > 0 ? (totalTimeSeconds / 3600).toFixed(1) : '—';
                      const userInfo = item.users || {};
                      const allDates = userAllSprints
                        .map((p: any) => [p.completed_at, p.started_at, p.assigned_on].filter(Boolean))
                        .flat()
                        .map((d: any) => new Date(d))
                        .sort((a, b) => b.getTime() - a.getTime());
                      const lastActivityDate = allDates.length > 0 ? allDates[0] : null;
                      const overallStatus = completedSprints > 0 ? 'COMPLETED' : 
                                            userAllSprints.some((p: any) => p.status === 'IN_PROGRESS') ? 'IN_PROGRESS' : 
                                            'ASSIGNED';
                      const initials = userInfo.name?.split(' ').map((n: string) => n[0]).join('') || '?';
                      const avatarColors = ['bg-purple-100 text-purple-600','bg-blue-100 text-blue-600','bg-green-100 text-green-600','bg-amber-100 text-amber-600'];
                      const statusStyles: Record<string,string> = { COMPLETED:'bg-green-100 text-green-700', IN_PROGRESS:'bg-yellow-100 text-yellow-700', ASSIGNED:'bg-red-100 text-red-600' };
                      const statusLabels: Record<string,string> = { COMPLETED:'COMPLETED', IN_PROGRESS:'IN PROGRESS', ASSIGNED:'NOT STARTED' };
                      
                      return (
                        <tr 
                          key={i} 
                          className="hover:bg-gray-50 cursor-pointer transition-colors"
                          onClick={() => setSelectedUser({...item, time_spent_seconds: totalTimeSeconds, completedItems: completedSprints, totalItems: totalSprints, status: overallStatus, last_active_at: lastActivityDate?.toISOString()})}
                          title={`Click to view details for ${userInfo.name}`}
                        >
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-medium flex-shrink-0 ${avatarColors[i % avatarColors.length]}`}>
                                {initials}
                              </div>
                              <span className="font-medium text-gray-900">{userInfo.name || 'Unknown'}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 font-medium text-gray-900">{completedSprints}/{totalSprints}</td>
                          <td className="px-6 py-4 text-gray-500 text-sm">{timeSpentHours === '—' ? '—' : `${timeSpentHours}h`}</td>
                          <td className="px-6 py-4">
                            <span className={`text-xs font-semibold px-3 py-1 rounded-md ${statusStyles[overallStatus] || 'bg-gray-100 text-gray-600'}`}>
                              {statusLabels[overallStatus] || overallStatus}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          */}

          {activeTab === 'Sprints' && (
            <div className="space-y-6">
              {/* <h2 className="text-xl font-bold text-gray-900 mb-6">Sprint performance</h2> */}
              
              {/* Sprint Cards Grid */}
              <div>
                <h3 className="text-lg font-bold text-gray-900 mb-4">Sprint Details</h3>
                {moduleStats.length === 0 ? (
                  <div className="py-12 text-center text-sm text-gray-400">
                    <p>No sprint data available</p>
                    <p className="text-xs mt-2">moduleStats count: {moduleStats.length}</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-4">
                    {moduleStats.map((sprint: any, i: number) => {
                    const barColors = ['#6366F1','#22C55E','#F59E0B','#EF4444','#A855F7','#3B82F6'];
                    const color = barColors[i % barColors.length];
                    const videoPct = (sprint.video_seconds_total ?? 0) > 0
                      ? Math.round((sprint.video_seconds_watched ?? 0) / sprint.video_seconds_total * 100)
                      : null;
                    return (
                      <div key={sprint.moduleId} className="bg-white border border-gray-200 rounded-xl p-6 hover:shadow-md transition-shadow">
                        <div className="mb-4">
                          <h3 className="font-bold text-gray-900 text-lg mb-1">{sprint.title || 'Unknown Sprint'}</h3>
                          {/* <p className="text-xs text-gray-500">ID: {sprint.moduleId}</p> */}
                        </div>
                        
                        {/* Key Metrics */}
                        <div className="grid grid-cols-2 gap-3 mb-6">
                          <div className="bg-blue-50 rounded-lg p-3">
                            <p className="text-xs text-gray-600 mb-1">Assigned</p>
                            <p className="text-xl font-bold text-gray-900">{sprint.totalAssigned || 0}</p>
                          </div>
                          <div className="bg-green-50 rounded-lg p-3">
                            <p className="text-xs text-gray-600 mb-1">Completed</p>
                            <p className="text-xl font-bold text-gray-900">{sprint.completed || 0}</p>
                          </div>
                          <div className="bg-yellow-50 rounded-lg p-3">
                            <p className="text-xs text-gray-600 mb-1">In Progress</p>
                            <p className="text-xl font-bold text-gray-900">{sprint.inProgress || 0}</p>
                          </div>
                          <div className="bg-red-50 rounded-lg p-3">
                            <p className="text-xs text-gray-600 mb-1">Not Started</p>
                            <p className="text-xl font-bold text-gray-900">{sprint.notStarted || 0}</p>
                          </div>
                        </div>

                        {/* Completion Rate */}
                        <div className="mb-6">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-sm text-gray-600 font-medium">Completion Rate</span>
                            <span className="font-bold text-gray-900">{sprint.completionRate || 0}%</span>
                          </div>
                          <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width:`${sprint.completionRate || 0}%`, background:color }} />
                          </div>
                        </div>

                        {/* Performance Metrics */}
                        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-gray-200">
                          <div>
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Score</p>
                            <p className="text-2xl font-bold text-gray-900">{sprint.averageScore ?? 0}%</p>
                            <p className="text-xs text-gray-500 mt-1">Quiz Performance</p>
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Completion Time</p>
                            <p className="text-2xl font-bold text-gray-900">{sprint.averageCompletionTime ?? 0}</p>
                            <p className="text-xs text-gray-500 mt-1">Days To Complete</p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeTab === 'Detailed Analytics' && (
            <div className="space-y-6">
              <div className="grid grid-cols-2 gap-4">
                {/* Overall Completion Status Doughnut Chart */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center">
                      <CheckCircle className="w-5 h-5 mr-2" />
                      Overall Assignment Status
                    </CardTitle>
                    <CardDescription>Distribution Of Assignment Status  Across All Sprints</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-80">
                      <Doughnut
                        data={{
                          labels: ['Completed', 'In Progress', 'Not Started'],
                          datasets: [{
                            data: [
                              overallStats.completedAssignments,
                              overallStats.inProgressAssignments,
                              overallStats.notStartedAssignments
                            ],
                            backgroundColor: [
                              'rgb(34, 197, 94)', // green-500
                              'rgb(59, 130, 246)', // blue-500
                              'rgb(251, 191, 36)', // yellow-500
                            ],
                            borderColor: [
                              'rgb(22, 163, 74)', // green-600
                              'rgb(37, 99, 235)', // blue-600
                              'rgb(245, 158, 11)', // yellow-600
                            ],
                            borderWidth: 2,
                          }]
                        }}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: {
                            legend: {
                              position: 'bottom' as const,
                              labels: {
                                padding: 20,
                                usePointStyle: true,
                              }
                            },
                            tooltip: {
                              callbacks: {
                                label: function(context) {
                                  const label = context.label || '';
                                  const value = context.parsed;
                                  const total = overallStats.totalAssignments;
                                  const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
                                  return `${label}: ${value} (${percentage}%)`;
                                }
                              }
                            }
                          }
                        }}
                      />
                    </div>
                    <div className="mt-4 text-center text-sm text-gray-600">
                      Total Assignments: {overallStats.totalAssignments}
                    </div>
                  </CardContent>
                </Card>

                {/* Sprint Completion Rates Bar Chart */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center">
                      <BarChart3 className="w-5 h-5 mr-2" />
                      Sprint Completion Rates
                    </CardTitle>
                    <CardDescription>Completion Rates For Each Sprint</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-80">
                      <Bar
                        data={{
                          labels: moduleStats.map(module => 
                            module.title.length > 20 ? module.title.substring(0, 20) + '...' : module.title
                          ),
                          datasets: [{
                            label: 'Completion Rate (%)',
                            data: moduleStats.map(module => module.completionRate),
                            backgroundColor: 'rgba(34, 197, 94, 0.8)', // green with transparency
                            borderColor: 'rgb(34, 197, 94)',
                            borderWidth: 1,
                          }]
                        }}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: {
                            legend: {
                              display: false,
                            },
                            tooltip: {
                              callbacks: {
                                title: function(context) {
                                  const index = context[0].dataIndex;
                                  return moduleStats[index]?.title || '';
                                },
                                label: function(context) {
                                  const index = context.dataIndex;
                                  const module = moduleStats[index];
                                  return [
                                    `Completion Rate: ${context.parsed.y}%`,
                                    `Completed: ${module.completed}/${module.totalAssigned}`,
                                    `In Progress: ${module.inProgress}`,
                                    `Not Started: ${module.notStarted}`
                                  ];
                                }
                              }
                            }
                          },
                          scales: {
                            y: {
                              beginAtZero: true,
                              max: 100,
                              ticks: {
                                callback: function(value) {
                                  return value + '%';
                                }
                              }
                            },
                            x: {
                              ticks: {
                                maxRotation: 45,
                                font: {
                                  size: 10
                                }
                              }
                            }
                          }
                        }}
                      />
                    </div>
                  </CardContent>
                </Card>
              </div>

              <div className="grid grid-cols-2 gap-4">
                {/* Assessment Performance Bar Chart */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center">
                      <Award className="w-5 h-5 mr-2" />
                      Assessment Performance
                    </CardTitle>
                    <CardDescription>Scores Across Different Assessment Types</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-80">
                      <Bar
                        data={{
                          labels: assessmentStats.map(assessment => 
                            `Sprint\n${
                              assessment.moduleTitle.length > 15 ? 
                              assessment.moduleTitle.substring(0, 15) + '...' : 
                              assessment.moduleTitle
                            }`
                          ),
                          datasets: [
                            {
                              label: 'Average Score (%)',
                              data: assessmentStats.map(assessment => assessment.averageScore),
                              backgroundColor: assessmentStats.map(assessment => 
                                assessment.type === 'baseline' ? 'rgba(59, 130, 246, 0.8)' : 'rgba(168, 85, 247, 0.8)'
                              ),
                              borderColor: assessmentStats.map(assessment => 
                                assessment.type === 'baseline' ? 'rgb(59, 130, 246)' : 'rgb(168, 85, 247)'
                              ),
                              borderWidth: 1,
                            },
                            {
                              label: 'Completion Rate (%)',
                              data: assessmentStats.map(assessment => assessment.completionRate),
                              backgroundColor: 'rgba(34, 197, 94, 0.6)',
                              borderColor: 'rgb(34, 197, 94)',
                              borderWidth: 1,
                            }
                          ]
                        }}
                        options={{
                          responsive: true,
                          maintainAspectRatio: false,
                          plugins: {
                            legend: {
                              position: 'top' as const,
                            },
                            tooltip: {
                              callbacks: {
                                title: function(context) {
                                  const index = context[0].dataIndex;
                                  const assessment = assessmentStats[index];
                                  return `${assessment.type.charAt(0).toUpperCase() + assessment.type.slice(1)} - ${assessment.moduleTitle}`;
                                },
                                label: function(context) {
                                  const index = context.dataIndex;
                                  const assessment = assessmentStats[index];
                                  if (context.datasetIndex === 0) {
                                    return `Average Score: ${context.parsed.y}%`;
                                  } else {
                                    return `Completion Rate: ${context.parsed.y}% (${assessment.completed}/${assessment.totalAttempts})`;
                                  }
                                }
                              }
                            }
                          },
                          scales: {
                            y: {
                              beginAtZero: true,
                              max: 100,
                              ticks: {
                                callback: function(value) {
                                  return value + '%';
                                }
                              }
                            },
                            x: {
                              ticks: {
                                maxRotation: 45,
                                font: {
                                  size: 9
                                }
                              }
                            }
                          }
                        }}
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Learning Style Distribution Pie Chart - Only show if learning style is enabled */}
                {/* {companyLearningStyleEnabled ? (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center">
                        <Brain className="w-5 h-5 mr-2" />
                        Learning Style Distribution
                      </CardTitle>
                      <CardDescription>Employee learning style preferences breakdown</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-80">
                        <Pie
                          data={{
                            labels: learningStyleStats.map(style => style.style),
                            datasets: [{
                              data: learningStyleStats.map(style => style.count),
                              backgroundColor: [
                                'rgb(239, 68, 68)', // red-500
                                'rgb(34, 197, 94)', // green-500
                                'rgb(59, 130, 246)', // blue-500
                                'rgb(168, 85, 247)', // purple-500
                                'rgb(245, 158, 11)', // yellow-500
                                'rgb(236, 72, 153)', // pink-500
                                'rgb(14, 165, 233)', // sky-500
                                'rgb(249, 115, 22)', // orange-500
                              ],
                              borderColor: 'rgb(255, 255, 255)',
                              borderWidth: 2,
                            }]
                          }}
                          options={{
                            responsive: true,
                            maintainAspectRatio: false,
                            plugins: {
                              legend: {
                                position: 'bottom' as const,
                                labels: {
                                  padding: 15,
                                  usePointStyle: true,
                                  font: {
                                    size: 11
                                  }
                                }
                              },
                              tooltip: {
                                callbacks: {
                                  label: function(context) {
                                    const label = context.label || '';
                                    const value = context.parsed;
                                    const total = learningStyleStats.reduce((sum, style) => sum + style.count, 0);
                                    const percentage = total > 0 ? Math.round((value / total) * 100) : 0;
                                    return `${label}: ${value} employees (${percentage}%)`;
                                  }
                                }
                              }
                            }
                          }}
                        />
                      </div>
                    </CardContent>
                  </Card>
                ) : (
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center">
                        <Brain className="w-5 h-5 mr-2" />
                        Learning Style Distribution
                      </CardTitle>
                      <CardDescription>Learning style preferences are currently disabled</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="h-80 flex flex-col items-center justify-center text-center px-8">
                        <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-6">
                          <Brain className="w-10 h-10 text-gray-400" />
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">Learning Style Disabled</h3>
                        <p className="text-gray-600 max-w-md">
                          Learning style preferences are currently turned off for your company. 
                          All employees use the default learning experience.
                        </p>
                        <p className="text-sm text-gray-500 mt-4">
                          Contact your administrator to enable personalized learning styles.
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}
              </div> */}

              </div>

              {/* Assessment Performance Table */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <FileText className="w-5 h-5 mr-2" />
                    Assessment Performance
                  </CardTitle>
                  <CardDescription>Performance Metrics for baseline and Sprint's assessments</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          {['Assessment Type', 'Sprint', 'Avg Score', 'Completion Rate', 'Total Attempts', 'Completed'].map(h => (
                            <th key={h} className="text-left px-4 py-3 font-medium text-gray-700">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {assessmentStats.map((assessment: any, i: number) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-4 py-3">{assessment.type}</td>
                            <td className="px-4 py-3">{assessment.moduleTitle}</td>
                            <td className="px-4 py-3 font-medium">{assessment.averageScore}%</td>
                            <td className="px-4 py-3">{assessment.completionRate}%</td>
                            <td className="px-4 py-3">{assessment.totalAttempts}</td>
                            <td className="px-4 py-3 text-green-600 font-medium">{assessment.completed}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* KPI Performance Table */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Target className="w-5 h-5 mr-2" />
                    KPI Performance Overview
                  </CardTitle>
                  <CardDescription>Key Performance Indicators and benchmark achievements</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          {['KPI Name', 'Benchmark', 'Avg Score', 'Achievement Rate', 'Above Benchmark', 'Below Benchmark'].map(h => (
                            <th key={h} className="text-left px-4 py-3 font-medium text-gray-700">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {kpiStats.map((kpi: any, i: number) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-4 py-3 font-medium">{kpi.kpiName}</td>
                            <td className="px-4 py-3">{kpi.benchmark || '—'}</td>
                            <td className="px-4 py-3 font-medium">{kpi.averageScore}</td>
                            <td className="px-4 py-3">{kpi.benchmarkAchievementRate !== null ? `${kpi.benchmarkAchievementRate}%` : '—'}</td>
                            <td className="px-4 py-3 text-green-600 font-medium">{kpi.aboveBenchmark}</td>
                            <td className="px-4 py-3 text-red-600 font-medium">{kpi.belowBenchmark}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>

              {/* Detailed Progress Table */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center">
                    <Clock className="w-5 h-5 mr-2" />
                    Detailed User Progress
                  </CardTitle>
                  <CardDescription>Individual progress tracking for all assignments</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b">
                          {['User', 'Sprint', 'Status', 'Assigned Date', 'Started Date', 'Completed Date', 'Days Overdue'].map(h => (
                            <th key={h} className="text-left px-3 py-2 font-medium text-gray-700">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {progressData.slice(0, 50).map((item: any, i: number) => (
                          <tr key={i} className="hover:bg-gray-50">
                            <td className="px-3 py-2">{item.users?.name || 'Unknown'}</td>
                            <td className="px-3 py-2">{item.training_modules?.title || '—'}</td>
                            <td className="px-3 py-2">{getStatusBadge(item.status)}</td>
                            <td className="px-3 py-2">{formatDate(item.assigned_on)}</td>
                            <td className="px-3 py-2">{formatDate(item.started_at)}</td>
                            <td className="px-3 py-2">{formatDate(item.completed_at)}</td>
                            <td className="px-3 py-2">{getDaysOverdue(item.due_date, item.status) ? `${getDaysOverdue(item.due_date, item.status)} days` : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  
                  {progressData.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      <p>No progress data available</p>
                    </div>
                  )}

                  {progressData.length > 50 && (
                    <div className="mt-4 text-sm text-gray-500 text-center">
                      Showing 50 of {progressData.length} records. Use filters to narrow results.
                    </div>
                  )}
                </CardContent>
              </Card>

              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-4">Sprint Performance Overview</h2>
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-100">
                        {['Sprint','Assigned','Completed','In Progress','Completion Rate','Avg Time'].map(h => (
                          <th key={h} className="text-left px-6 py-3 text-xs font-medium text-gray-400 uppercase tracking-wider">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {moduleStats.map((m: any, i: number) => (
                        <tr key={i} className="hover:bg-gray-50">
                          <td className="px-6 py-4 font-medium text-gray-900">{m.title}</td>
                          <td className="px-6 py-4">{m.totalAssigned}</td>
                          <td className="px-6 py-4 text-green-600 font-medium">{m.completed}</td>
                          <td className="px-6 py-4 text-blue-600 font-medium">{m.inProgress}</td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-3">
                              <div className="w-24 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                                <div className="h-full bg-green-500 rounded-full" style={{ width:`${m.completionRate}%` }} />
                              </div>
                              <span className="text-sm font-medium">{m.completionRate}%</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-gray-500">{m.averageCompletionTime > 0 ? `${m.averageCompletionTime} days` : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function AnalyticsPage() {
  const router = useRouter();
  const { user,loading:authLoading, isManager } = useAuth();
  const [admin, setAdmin] = useState<Admin|null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  // const currentUserId = admin?.user_id || null;
  const { progress: loadingProgress, show: showLoadingProgress } = useIllusionProgress(authLoading || loading);
  useEffect(() => {
      if (!authLoading) {
        if (!user) router.push("/login");
        else checkAdminAccess();
        
      }
    }, [user, authLoading, router]);

  const checkAdminAccess = async () => {
    if (!user?.email) return;

    try {
      // Get user data from users table via backend API
      const userRes = await fetchWithAuth(`${API_URL}/api/users/by-email/${encodeURIComponent(user.email)}`);

      if (!userRes.ok) {
        console.error("User not found or inactive:");
        return;
      }

      // Check if user has admin role through user_role_assignments
      const responseData = await userRes.json();
      
      // Handle both wrapped and unwrapped responses
      const userData = responseData?.data?.user ?? responseData?.data ?? responseData?.user ?? responseData;
      
      // Validate response
      if (!userData || !userData.user_id) {
        console.error("Invalid user data returned from backend:", responseData);
        return;
      }
      
      // Check if user has admin role through backend API
      const rolesRes = await fetchWithAuth(`${API_URL}/api/roles/users/${userData.user_id}`, {
        headers: {
          'X-User-ID': userData.user_id
        }
      });

      if (!rolesRes.ok) {
        console.error("Failed to fetch user roles");
        return;
      }

      const rolesResponseData = await rolesRes.json();
      const roleData = rolesResponseData?.data?.assignments ?? rolesResponseData?.data ?? rolesResponseData?.assignments ?? rolesResponseData;

      if (!roleData || roleData.length === 0) {
        console.error("No active roles found for user");
        return;
      }

      // Check if user has Admin or Manager role
      const hasAdminRole = roleData.some((assignment: any) => {
        const roleName = assignment.role?.name?.toLowerCase()?.replace(/[-_\s]/g, '');
        const roleLevel = assignment.role?.level;
        return roleLevel >= 3 || 
               roleName === 'admin' || 
               roleName === 'superadmin' ||
               roleName === 'ceo';
      });

      const hasManagerRole = roleData.some((assignment: any) => {
        const roleName = assignment.role?.name?.toLowerCase()?.replace(/[-_\s]/g, '');
        const roleLevel = assignment.role?.level;
        return roleLevel === 2 || Boolean(roleName?.includes('manager'));
      });

      if (!hasAdminRole && !hasManagerRole && !isManager) {
        console.error("User does not have console access role");
        return;
      }

      // Set admin data using user data
      const adminData: Admin = {
        user_id: userData.user_id,
        email: userData.email,
        name: userData.name,
        company_id: userData.company_id
      };

      setAdmin(adminData);
    } catch (error) {
      console.error("Admin access check failed:", error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      showLoadingProgress
        ? <LoadingProgress label="Loading analytics..." progress={loadingProgress} />
        : (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span className="ml-2 text-gray-600">Loading...</span>
          </div>
        )
    );
  }

  if (!admin) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">Access denied. Console privileges required.</p>
      </div>
    );
  }

  const handleExport = async () => {
    if (!admin?.company_id || !admin?.user_id) return;
    setExporting(true);
    try {
      const res = await fetchWithAuth(
        `${API_URL}/api/analytics/export/users/${encodeURIComponent(admin.company_id)}`,
        { headers: { 'X-User-ID': admin.user_id } }
      );
      if (!res.ok) {
        const errorText = await res.text().catch(() => 'Failed to export');
        throw new Error(errorText);
      }
      const payload = await res.json().catch(() => ({}));
      const rows = payload?.data?.rows ?? payload?.rows ?? [];
      const columns = payload?.data?.columns ?? payload?.columns ?? [];
      if (!Array.isArray(rows) || rows.length === 0) {
        console.warn('[analytics export] No rows returned for export');
      }

      const worksheet = xlsx.utils.json_to_sheet(rows, columns?.length ? { header: columns } : undefined);
      const workbook = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(workbook, worksheet, 'User Analytics');
      const workbookArray = xlsx.write(workbook, { bookType: 'xlsx', type: 'array' });
      const blob = new Blob([workbookArray], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `user-analytics-${admin.company_id}.xlsx`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('[analytics export] Failed to export data:', error);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      {/* Header Card */}
      <div className="bg-white rounded-xl shadow-sm p-8 border border-slate-200 mb-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold text-gray-800 mb-2">
              Analytics & Reports
            </h1>
            <p className="text-slate-600">
              Track Progress Across All Sprints With Detailed Insights & Performance Metrics
            </p>
          </div>
          <button
            type="button"
            onClick={handleExport}
            disabled={exporting}
            className="inline-flex items-center justify-center rounded-lg border border-slate-200 bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm transition disabled:cursor-not-allowed disabled:opacity-70"
          >
            {exporting ? 'Exporting…' : 'Export Excel'}
          </button>
        </div>
      </div>
      
      <ProgressAnalytics companyId={admin.company_id} adminUserId={admin?.user_id} />
    </div>
  );
}

function useIllusionProgress(active: boolean) {
  const [progress, setProgress] = useState(12);
  const [show, setShow] = useState(active);

  useEffect(() => {
    if (!active) {
      setProgress(100);
      const timeout = setTimeout(() => setShow(false), 180);
      return () => clearTimeout(timeout);
    }

    setShow(true);
    setProgress(Math.min(25, 10 + Math.round(Math.random() * 12)));

    const id = setInterval(() => {
      setProgress((prev) => {
        const shouldHold = prev > 70 ? Math.random() < 0.45 : Math.random() < 0.25;
        if (shouldHold) return prev;
        const increment = Math.max(1, Math.round(Math.random() * 7));
        return Math.min(prev + increment, 93);
      });
    }, 420 + Math.round(Math.random() * 240));

    return () => clearInterval(id);
  }, [active]);

  return { progress: Math.min(progress, 100), show };
}

function LoadingProgress({ label, progress }: { label: string; progress: number }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-lg border border-slate-100 p-6 space-y-4">
        <div className="flex items-center justify-between text-sm font-semibold text-slate-700">
          <span>{label}</span>
          <span className="text-slate-900 text-base font-black">{progress}%</span>
        </div>
        <div className="relative h-3 rounded-full bg-slate-100 overflow-hidden">
          <div
            className="absolute left-0 top-0 h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-cyan-400 transition-all duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="text-xs text-slate-500 font-medium">Preparing analytics. This may take a moment.</p>
      </div>
    </div>
  );
}
