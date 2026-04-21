'use client'

import React, { useState, useEffect } from 'react';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  TrendingUp,
  Target,
  Users,
  ChevronDown,
  Activity,
  Zap,
  ThumbsUp,
  AlertCircle,
  ArrowUpRight,
  Sparkles,
  Filter
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { fetchWithAuth } from '@/lib/fetch-with-auth';

interface KPIData {
  id: string;
  name: string;
  current_value: number;
  target_value: number;
  unit: string;
  mapped_modules: string[];
}

interface ModulePerformance {
  module_id: string;
  module_name: string;
  completion_rate: number;
  impact_score: number;
  module_type: string;
}

interface RecommendedAction {
  user_id: string;
  employee_name: string;
  employee_initials: string;
  gap: string;
  module: string;
  status: 'In Progress' | 'Pending' | 'Completed';
  progress: number;
}

interface ScatterDataPoint {
  user_id: string;
  user_name: string;
  kpi_score: number;
  module_performance: number;
}

interface SelectedKpiInfo {
  name: string;
  target: number;
}

interface HeatmapData {
  employee_id: string;
  employee_name: string;
  modules: {
    module_id: string;
    module_name: string;
    score: number | null; // null if not attempted, 0-100 if attempted
    status: 'not_started' | 'in_progress' | 'passed' | 'failed';
  }[];
}

interface BackendUser {
  user_id: string;
  company_id: string;
  name: string;
  email?: string;
}

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

const fetchBackendUserByEmail = async (email: string): Promise<BackendUser | null> => {
  try {
    const res = await fetchWithAuth(`${API_BASE}/api/users/by-email/${encodeURIComponent(email)}`);
    if (!res.ok) return null;
    const payload = await res.json();
    let user = payload?.user ?? payload;
    if (Array.isArray(user)) user = user[0];
    return user || null;
  } catch (error) {
    console.error('Error fetching backend user:', error);
    return null;
  }
};

const fetchUserByFilter = async (filters: {
  functionId?: string;
  subFunctionId?: string;
  titleId?: string;
}): Promise<BackendUser[]> => {
  try{
    const params = new URLSearchParams();
    if (filters.functionId) params.append('function_id', filters.functionId);
    if (filters.subFunctionId) params.append('sub_function_id', filters.subFunctionId);
    if (filters.titleId) params.append('title_id', filters.titleId);
    params.append('is_active', 'true');
    params.append('employment_status', 'ACTIVE');

    const res = await fetchWithAuth(`${API_BASE}/api/users?${params.toString()}`);
    if (!res.ok) return [];
    const payload = await res.json();
    const users = payload?.users ?? payload;
    return Array.isArray(users) ? users : users ? [users] : [];
  } catch(e) {
    console.error('Error fetching users:', e);
    return [];
  }
};
export default function KPITurbocharge() {
  const [functions, setFunctions] = useState<Array<{ function_id: string; function_name: string }>>([]);
  const [subFunctions, setSubFunctions] = useState<Array<{ sub_function_id: string; sub_function_name: string }>>([]);
  const [titles, setTitles] = useState<Array<{ title_id: string; title_name: string }>>([]);
  const [modules, setModules] = useState<Array<{ module_id: string; title: string }>>([]);
 
  const [selectedFunctionId, setSelectedFunctionId] = useState<string>('');
  const [selectedSubFunctionId, setSelectedSubFunctionId] = useState<string>('');
  const [selectedTitleId, setSelectedTitleId] = useState<string>('');
  const [selectedModuleId, setSelectedModuleId] = useState<string>('');
  const [selectedKpiId, setSelectedKpiId] = useState<string>('');
  const {user, loading:authLoading} = useAuth();
  const router = useRouter();
  const [currentEmployee, setCurrentEmployee] = useState<BackendUser | null>(null);

  const [loading, setLoading] = useState(true);
  const [kpiData, setKpiData] = useState<KPIData[]>([]);
  const [topModules, setTopModules] = useState<ModulePerformance[]>([]);
  const [needsOptimization, setNeedsOptimization] = useState<ModulePerformance[]>([]);
  const [recommendedActions, setRecommendedActions] = useState<RecommendedAction[]>([]);
  const [correlationData, setCorrelationData] = useState<any[]>([]);
  const [scatterData, setScatterData] = useState<ScatterDataPoint[]>([]);
  const [selectedKpiInfo, setSelectedKpiInfo] = useState<SelectedKpiInfo | null>(null);
  const [heatmapData, setHeatmapData] = useState<HeatmapData[]>([]);
  const [lucidAnalysis, setLucidAnalysis] = useState<string>('');
  const [workforceReadiness, setWorkforceReadiness] = useState({ score: 0, change: 0, status: 'Calculating...' });
  const { progress: loadingProgress, show: showLoadingProgress } = useIllusionProgress(authLoading || loading);

  useEffect(() => {
          if (!authLoading) {
            if (!user) router.push("/login");
            // else checkAdminAccess();
           
          }
        }, [user, authLoading, router]);
  useEffect(() => {
    const loadCurrentEmployee = async () => {
      if (!user?.email) {
        setCurrentEmployee(null);
        return;
      }

      const backendUser = await fetchBackendUserByEmail(user.email);
      setCurrentEmployee(backendUser);
    };

    loadCurrentEmployee();
  }, [user?.email]);
  useEffect(() => {
    loadFilters();

    if (selectedFunctionId) {
      loadSubFunctions(selectedFunctionId);
    } else {
      setSubFunctions([]);
      setSelectedSubFunctionId('');
      setTitles([]);
      setSelectedTitleId('');
    }
  }, [selectedFunctionId]);

  useEffect(() => {
    if (currentEmployee) {
      loadModules();
    }
  }, [currentEmployee]);

  useEffect(() => {
    if (selectedSubFunctionId) {
      loadTitles(selectedSubFunctionId);
    } else if (selectedFunctionId) {
      setTitles([]);
      setSelectedTitleId('');
    }
  }, [selectedSubFunctionId]);

  useEffect(() => {
   
    console.log("Changes in the selectedSubFunctionId, selectedTitleId")
    fetchAllData();
  }, [selectedSubFunctionId, selectedTitleId]);
  useEffect(() => {
    console.log("Changes in the selectedKPiId, selectedModuleId")
    fetchAllData();
  }, [selectedKpiId,selectedModuleId]);
 
 
  useEffect(() => {

    console.log("Calling beacause of the changes in function Id")
    fetchAllData();
  },[selectedFunctionId]);

  const loadFilters = async () => {
    try {
      const { data: functionsData } = await supabase
        .from('function')
        .select('function_id, function_name')
        .eq('is_active', true)
        .order('function_name');

      if (functionsData && functionsData.length > 0) {
        console.log("Selected Functions:", functionsData);
        console.log("Selected Function Id:", selectedFunctionId);
        setFunctions(functionsData);
        // setSelectedFunctionId('');
      }
    } catch (error) {
      console.error('Error loading filters:', error);
    }
  };

  const loadSubFunctions = async (functionId: string) => {
    try {
      const { data: subFunctionsData } = await supabase
        .from('sub_function')
        .select('sub_function_id, sub_function_name')
        .eq('function_id', functionId)
        .eq('is_active', true)
        .order('sub_function_name');

      if (subFunctionsData && subFunctionsData.length > 0) {
        setSubFunctions(subFunctionsData);
        setSelectedSubFunctionId('');
      } else {
        setSubFunctions([]);
        setSelectedSubFunctionId('');
      }
    } catch (error) {
      console.error('Error loading sub-functions:', error);
    }
  };

  const loadTitles = async (subFunctionId: string) => {
    try {
      const { data: titlesData } = await supabase
        .from('titles')
        .select('title_id, title_name')
        .eq('sub_function_id', subFunctionId)
        .eq('is_active', true)
        .order('title_name');

      if (titlesData && titlesData.length > 0) {
        setTitles(titlesData);
        setSelectedTitleId('');
      } else {
        setTitles([]);
        setSelectedTitleId('');
      }
    } catch (error) {
      console.error('Error loading titles:', error);
    }
  };

  const loadModules = async () => {
    try {
      if (!currentEmployee?.company_id) return;

      const res = await fetchWithAuth(`${API_BASE}/api/training-modules/company/${currentEmployee.company_id}`, {
        headers: {
          'X-User-ID': currentEmployee.user_id
        }
      });

      if (!res.ok) {
        console.error('Error loading modules:', await res.text());
        return;
      }

      const payload = await res.json();
      const modulesData = payload?.data || payload;

      if (modulesData && modulesData.length > 0) {
        setModules(modulesData.map((m: any) => ({
          module_id: m.module_id,
          title: m.title
        })));
      }
    } catch (error) {
      console.error('Error loading modules:', error);
    }
  };

  const fetchAllData = async () => {
    setLoading(true);
    console.log("Calling the fetch all data")
    try {
      await Promise.all([
        fetchKPIData(),
        fetchModulePerformance(),
        fetchRecommendedActions(),
        fetchScatterPlotData(),
        fetchHeatmapData(),
        // Call appropriate readiness calculation based on filter selection
        selectedModuleId ? calculateWorkforceReadiness() : calculateOrganizationFunctionReadiness()
      ]);
      await generateLucidAnalysis();
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchKPIData = async () => {
    try {
      console.log('Fetching KPIs with filters:', { selectedFunctionId, selectedSubFunctionId, selectedTitleId });
     
      let kpiQuery = supabase
        .from('kpis')
        .select('kpi_id, name, description, target, datatype, function_id, sub_function_id, title_id');

      // Apply filters in order of specificity
      if (selectedTitleId && selectedTitleId !== '') {
        console.log('Filtering by title_id:', selectedTitleId);
        kpiQuery = kpiQuery.eq('title_id', selectedTitleId);
      } else if (selectedSubFunctionId && selectedSubFunctionId !== '') {
        console.log('Filtering by sub_function_id:', selectedSubFunctionId);
        kpiQuery = kpiQuery.eq('sub_function_id', selectedSubFunctionId);
      } else if (selectedFunctionId && selectedFunctionId !== '') {
        console.log('Filtering by function_id:', selectedFunctionId);
        kpiQuery = kpiQuery.eq('function_id', selectedFunctionId);
      }

      const { data: kpis, error: kpiError } = await kpiQuery.limit(3);

      console.log('KPI Query Result:', { kpis, kpiError });

      if (kpiError) {
        console.error('Error fetching KPIs:', kpiError);
        setKpiData([]);
        return;
      }

      if (!kpis || kpis.length === 0) {
        console.log('No KPIs found for selected filters');
        setKpiData([]);
        return;
      }

      // Fetch related modules for each KPI
      const kpiDataWithModules = await Promise.all(
        kpis.map(async (kpi: any) => {
          let modules: any[] = [];
          if (currentEmployee?.company_id) {
            const res = await fetchWithAuth(`${API_BASE}/api/training-modules/company/${currentEmployee.company_id}`, {
              headers: {
                'X-User-ID': currentEmployee.user_id
              }
            });

            if (res.ok) {
              const payload = await res.json();
              const modulesData = payload?.data || payload;
              modules = (modulesData || []).slice(0, 2);
            }
          }

          const current = kpi.target ? parseFloat(kpi.target.toString()) : 0;
         
          return {
            id: kpi.kpi_id,
            name: kpi.name,
            current_value: current,
            target_value: current,
            unit: kpi.datatype === 'percentage' ? 'target' : kpi.datatype === 'number' ? 'SKUs target' : 'target',
            mapped_modules: modules?.map(m => m.title) || []
          };
        })
      );

      console.log('Setting KPI Data:', kpiDataWithModules);
      setKpiData(kpiDataWithModules);
    } catch (error) {
      console.error('Error fetching KPI data:', error);
      setKpiData([]);
    }
  };

  const fetchModulePerformance = async () => {
    try {
      const users = await fetchUserByFilter({
        functionId: selectedFunctionId,
        subFunctionId: selectedSubFunctionId,
        titleId: selectedTitleId
      });

      const userIds = users.map(u => u.user_id);

      if (userIds.length === 0) {
        setTopModules([]);
        setNeedsOptimization([]);
        return;
      }

      // Get all training modules
      let allModules: any[] = [];
      if (currentEmployee?.company_id) {
        const res = await fetchWithAuth(`${API_BASE}/api/training-modules/company/${currentEmployee.company_id}`, {
          headers: {
            'X-User-ID': currentEmployee.user_id
          }
        });

        if (res.ok) {
          const payload = await res.json();
          allModules = payload?.data || payload || [];
        }
      }

      if (!allModules || allModules.length === 0) {
        setTopModules([]);
        setNeedsOptimization([]);
        return;
      }

      // Calculate performance for each module
      const moduleStats = await Promise.all(
        allModules.map(async (module) => {
          // Get learning plans for this module and filtered users
          const { data: learningPlans } = await supabase
            .from('learning_plan')
            .select('user_id, overall_status, processed_module_ids')
            .eq('module_id', module.module_id)
            .in('user_id', userIds);

          if (!learningPlans || learningPlans.length === 0) {
            return null; // No data for this module
          }

          // Filter only users who have started the module (processed_module_ids is not null/empty)
          const startedUsers = learningPlans.filter(
            (lp: { processed_module_ids: string | null; overall_status: boolean | null }) => lp.processed_module_ids !== null && lp.processed_module_ids !== ''
          );

          if (startedUsers.length === 0) {
            return null; // No users have started this module
          }

          // Count users who passed (overall_status === true)
          const passedUsers = startedUsers.filter((lp: { overall_status: boolean | null }) => lp.overall_status === true).length;
          const totalStartedUsers = startedUsers.length;

          // Calculate pass rate (completion rate)
          const passRate = Math.round((passedUsers / totalStartedUsers) * 100);

          // Impact score is the pass rate
          const impactScore = passRate;

          return {
            module_id: module.module_id,
            module_name: module.title,
            completion_rate: passRate,
            impact_score: impactScore,
            module_type: module.content_type === 'pdf' ? 'SOP' :
                        module.content_type === 'video' ? 'Video' : 'Simulation'
          };
        })
      );

      // Filter out null values (modules with no data)
      const validModuleStats = moduleStats.filter(stat => stat !== null) as ModulePerformance[];

      if (validModuleStats.length === 0) {
        setTopModules([]);
        setNeedsOptimization([]);
        return;
      }

      // Sort by impact score (pass rate)
      validModuleStats.sort((a, b) => b.impact_score - a.impact_score);

      // Top 3 performers
      setTopModules(validModuleStats.slice(0, 3));

      // Bottom 2 that need optimization (only if we have at least 3 modules)
      if (validModuleStats.length >= 3) {
        setNeedsOptimization(validModuleStats.slice(-2).reverse());
      } else {
        setNeedsOptimization([]);
      }

    } catch (error) {
      console.error('Error fetching module performance:', error);
      setTopModules([]);
      setNeedsOptimization([]);
    }
  };

  const fetchRecommendedActions = async () => {
    try {
      const allUsers = await fetchUserByFilter({
        functionId: selectedFunctionId,
        subFunctionId: selectedSubFunctionId,
        titleId: selectedTitleId
      });

      const users = allUsers.slice(0, 4);

      if (!users || users.length === 0) {
        setRecommendedActions([]);
        return;
      }

      const userIds = users.map(u => u.user_id);

      const { data: learningPlans } = await supabase
        .from('learning_plan')
        .select('user_id, module_id, status')
        .in('user_id', userIds)
        .in('status', ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED'])
        .order('assigned_on', { ascending: false });

      let modules: any[] = [];
      if (currentEmployee?.company_id) {
        const res = await fetchWithAuth(`${API_BASE}/api/training-modules/company/${currentEmployee.company_id}`, {
          headers: {
            'X-User-ID': currentEmployee.user_id
          }
        });

        if (res.ok) {
          const payload = await res.json();
          modules = payload?.data || payload || [];
        }
      }

      const { data: kpis } = await supabase
        .from('kpis')
        .select('name')
        .limit(3);

      const actions: RecommendedAction[] = users.slice(0, 4).map((user, idx) => {
        const userPlans = learningPlans?.filter((lp: { user_id: string }) => lp.user_id === user.user_id) || [];
        const latestPlan = userPlans[0];
       
        const module = modules?.find(m => m.module_id === latestPlan?.module_id);
        const kpi = kpis?.[idx % kpis.length];

        const nameParts = user.name.split(' ');
        const initials = nameParts.length >= 2
          ? `${nameParts[0][0]}${nameParts[1][0]}`
          : nameParts[0]?.substring(0, 2) || 'XX';

        let status: 'In Progress' | 'Pending' | 'Completed' = 'Pending';
        if (latestPlan?.status === 'COMPLETED') status = 'Completed';
        else if (latestPlan?.status === 'IN_PROGRESS') status = 'In Progress';

        return {
          user_id: user.user_id,
          employee_name: user.name,
          employee_initials: initials.toUpperCase(),
          gap: kpi?.name || 'Performance Gap',
          module: module?.title || 'Training Module',
          status,
          progress: latestPlan?.progress || 0
        };
      });

      setRecommendedActions(actions);
    } catch (error) {
      console.error('Error fetching recommended actions:', error);
      setRecommendedActions([]);
    }
  };

  const fetchScatterPlotData = async () => {
    try {
      const users = await fetchUserByFilter({
        functionId: selectedFunctionId,
        subFunctionId: selectedSubFunctionId,
        titleId: selectedTitleId
      });

      if (!users || users.length === 0) {
        setScatterData([]);
        setSelectedKpiInfo(null);
        return;
      }

      const userIds = users.map(u => u.user_id);

      // If a specific KPI is selected, fetch its details including target
      if (selectedKpiId) {
        const { data: kpiDetails } = await supabase
          .from('kpis')
          .select('name, target')
          .eq('kpi_id', selectedKpiId)
          .single();

        if (kpiDetails) {
          setSelectedKpiInfo({
            name: kpiDetails.name,
            target: kpiDetails.target || 0
          });
        }
      } else {
        setSelectedKpiInfo(null);
      }

      // Get KPI scores for these users
      let kpiScoreQuery = supabase
        .from('employee_kpi_history')
        .select('user_id, score, kpi_id, recorded_at')
        .in('user_id', userIds)
        .order('recorded_at', { ascending: false });

      // Filter by selected KPI if one is selected
      if (selectedKpiId) {
        kpiScoreQuery = kpiScoreQuery.eq('kpi_id', selectedKpiId);
      }

      const { data: kpiScores } = await kpiScoreQuery;

      // Get module performance (average quiz scores from employee_assessments)
      let assessmentScores: any[] = [];
      if (currentEmployee?.company_id) {
        const res = await fetchWithAuth(`${API_BASE}/api/employee-assessments/company/${currentEmployee.company_id}?limit=500`, {
          headers: {
            'X-User-ID': currentEmployee.user_id
          }
        });

        if (res.ok) {
          const payload = await res.json();
          const allAssessments = payload?.assessments || payload?.data || [];
          // Filter by userIds and only include rows with valid scores
          assessmentScores = allAssessments.filter(
            (a: any) => userIds.includes(a.user_id) && a.score != null && a.max_score != null
          );
        } else {
          console.error('Error loading employee assessments:', await res.text());
        }
      }

      // Calculate data for each user
      const scatterPoints: ScatterDataPoint[] = [];

      for (const user of users) {
        // Get KPI scores for this user
        const userKpiScores = kpiScores?.filter((k: { user_id: string; score: number }) => k.user_id === user.user_id) || [];
       
        if (userKpiScores.length === 0) continue;

        // Calculate average KPI score
        let avgKpiScore;
        if (selectedKpiId) {
          // If specific KPI is selected, use only that KPI's latest score
          avgKpiScore = Number(userKpiScores[0].score);
        } else {
          // Otherwise, average across all KPIs
          avgKpiScore = userKpiScores.reduce((sum: number, k: { score: number }) => sum + Number(k.score), 0) / userKpiScores.length;
        }

        // Get assessment scores for this user
        const userAssessments = assessmentScores?.filter(a => a.user_id === user.user_id) || [];
       
        if (userAssessments.length === 0) continue;

        // Calculate average module performance (percentage)
        const avgModulePerformance = userAssessments.reduce((sum, a) => {
          const percentage = (a.score / a.max_score) * 100;
          return sum + percentage;
        }, 0) / userAssessments.length;

        scatterPoints.push({
          user_id: user.user_id,
          user_name: user.name,
          kpi_score: Math.round(avgKpiScore),
          module_performance: Math.round(avgModulePerformance)
        });
      }

      setScatterData(scatterPoints);
    } catch (error) {
      console.error('Error fetching scatter plot data:', error);
      setScatterData([]);
      setSelectedKpiInfo(null);
    }
  };

  const fetchHeatmapData = async () => {
    try {
      const users = await fetchUserByFilter({
        functionId: selectedFunctionId,
        subFunctionId: selectedSubFunctionId,
        titleId: selectedTitleId
      });

      if (!users || users.length === 0) {
        setHeatmapData([]);
        return;
      }

      // Get all training modules
      let allModules: any[] = [];
      if (currentEmployee?.company_id) {
        const res = await fetchWithAuth(`${API_BASE}/api/training-modules/company/${currentEmployee.company_id}`, {
          headers: {
            'X-User-ID': currentEmployee.user_id
          }
        });

        if (res.ok) {
          const payload = await res.json();
          allModules = (payload?.data || payload || []).slice(0, 10);
        }
      }

      if (!allModules || allModules.length === 0) {
        setHeatmapData([]);
        return;
      }

      const userIds = users.map(u => u.user_id);
      const moduleIds = allModules.map(m => m.module_id);

      // Get all learning plans for these users and modules
      const { data: learningPlans } = await supabase
        .from('learning_plan')
        .select('user_id, module_id, overall_status, processed_module_ids, status')
        .in('user_id', userIds)
        .in('module_id', moduleIds);

      // Get all module progress with quiz scores via backend
      let moduleProgress: any[] = [];
      if (currentEmployee?.company_id) {
        const res = await fetchWithAuth(`${API_BASE}/api/module-progress/company/${currentEmployee.company_id}`, {
          headers: {
            'X-User-ID': currentEmployee.user_id
          }
        });

        if (res.ok) {
          const payload = await res.json();
          const allProgress = payload?.progress || payload?.data || payload || [];
          moduleProgress = allProgress.filter((mp: any) => userIds.includes(mp.user_id) && mp.quiz_score != null);
        } else {
          console.error('Error loading module progress:', await res.text());
        }
      }

      // Get max_score for each sub-module (processed_module_id) via backend
      console.log(userIds);
      let maxScoreData: any[] = [];
      if (currentEmployee?.company_id) {
        const res = await fetchWithAuth(`${API_BASE}/api/employee-assessments/company/${currentEmployee.company_id}?limit=500`, {
          headers: {
            'X-User-ID': currentEmployee.user_id
          }
        });

        if (res.ok) {
          const payload = await res.json();
          const allAssessments = payload?.assessments || payload?.data || [];
          // Filter by userIds and only include rows with valid max_score and assessments data
          maxScoreData = allAssessments.filter(
            (a: any) => userIds.includes(a.user_id) && a.max_score != null && a.assessments
          ).map((a: any) => ({
            user_id: a.user_id,
            score: a.score,
            max_score: a.max_score,
            assessments: a.assessments
          }));
        } else {
          console.error('Error loading employee assessments:', await res.text());
        }
      }

      console.log(maxScoreData);
      // Get processed modules mapping
      let processedModules: Array<{ processed_module_id: string; original_module_id: string }> = [];
      
      // Fetch processed modules for each original module
      for (const moduleId of moduleIds) {
        if (!currentEmployee?.user_id) continue;
        
        const res = await fetchWithAuth(`${API_BASE}/api/processed-modules/original-module/${moduleId}`, {
          headers: {
            'X-User-ID': currentEmployee.user_id
          }
        });

        if (res.ok) {
          const payload = await res.json();
          const modules = payload?.data || payload || [];
          processedModules.push(...modules.map((m: any) => ({
            processed_module_id: m.processed_module_id,
            original_module_id: m.original_module_id
          })));
        }
      }

      // Build heatmap data structure
      const heatmap: HeatmapData[] = users.map(user => {
        const userModules = allModules.map(module => {
          // Find learning plan for this user-module combination
          const plan = learningPlans?.find(
            (lp: { user_id: string; module_id: string; processed_module_ids: string | null; overall_status: boolean | null }) => lp.user_id === user.user_id && lp.module_id === module.module_id
          );

          if (!plan) {
            return {
              module_id: module.module_id,
              module_name: module.title,
              score: null,
              status: 'not_started' as const
            };
          }

          // Check if module has been started
          const hasStarted = plan.processed_module_ids &&
                           plan.processed_module_ids !== '' &&
                           plan.processed_module_ids !== '[]';

          if (!hasStarted) {
            return {
              module_id: module.module_id,
              module_name: module.title,
              score: null,
              status: 'not_started' as const
            };
          }

          // Get all processed module IDs for this module
          const processedModuleIds = processedModules
            ?.filter((pm: { original_module_id: string; processed_module_id: string }) => pm.original_module_id === module.module_id)
            .map((pm: { processed_module_id: string }) => pm.processed_module_id) || [];

          // Get quiz scores for this user's sub-modules
          const userQuizzes = moduleProgress?.filter(
            (mp: { user_id: string; processed_module_id: string; quiz_score: number | null }) => mp.user_id === user.user_id &&
                  processedModuleIds.includes(mp.processed_module_id)
          ) || [];

          if (userQuizzes.length === 0) {
            return {
              module_id: module.module_id,
              module_name: module.title,
              score: 0,
              status: 'in_progress' as const
            };
          }

          // Calculate average quiz score
          const avgScore = Math.round(
            userQuizzes.reduce((sum: number, q: { quiz_score: number | null }) => sum + (q.quiz_score || 0), 0) / userQuizzes.length
          );

          // Determine status
          let status: 'not_started' | 'in_progress' | 'passed' | 'failed';
          if (plan.overall_status === true) {
            status = 'passed';
          } else {
            status = avgScore >= 60 ? 'in_progress' : 'failed';
          }

          return {
            module_id: module.module_id,
            module_name: module.title,
            score: avgScore,
            status
          };
        });

        return {
          employee_id: user.user_id,
          employee_name: user.name,
          modules: userModules
        };
      });

      setHeatmapData(heatmap);
    } catch (error) {
      console.error('Error fetching heatmap data:', error);
      setHeatmapData([]);
    }
  };

  const fetchCorrelationData = async () => {
    // Generate sample correlation data based on time period
    const data = [];
    const today = new Date();
   
    for (let i = 12; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - (i * 2));
     
      const baseEco = 52 + (12 - i) * 2.5;
      const baseCompetency = 55 + (12 - i) * 2.4;
     
      data.push({
        date: date.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }),
        eco: Math.round(Math.min(baseEco, 85)),
        competency: Math.round(Math.min(baseCompetency, 88))
      });
    }
   
    setCorrelationData(data);
  };

  const calculateWorkforceReadiness = async () => {
    try {
      // Get modules based on filter
      let modulesToProcess;
     
      if (selectedModuleId) {
        // Single module selected - get only that module
        modulesToProcess = [{ module_id: selectedModuleId }];
      } else {
        // No module filter - get all modules
        let allModules: any[] = [];
        if (currentEmployee?.company_id) {
          const res = await fetchWithAuth(`${API_BASE}/api/training-modules/company/${currentEmployee.company_id}`, {
            headers: {
              'X-User-ID': currentEmployee.user_id
            }
          });

          if (res.ok) {
            const payload = await res.json();
            allModules = payload?.data || payload || [];
          }
        }
       
        modulesToProcess = allModules;
      }

      if (modulesToProcess.length === 0) {
        setWorkforceReadiness({ score: 0, change: 0, status: 'No Modules Available' });
        return;
      }

      // Get users based on selected filters
      const users = await fetchUserByFilter({
        functionId: selectedFunctionId,
        subFunctionId: selectedSubFunctionId,
        titleId: selectedTitleId
      });
     
      const userIds = users.map((u: BackendUser) => u.user_id);

      if (userIds.length === 0) {
        setWorkforceReadiness({ score: 0, change: 0, status: 'No Users Found' });
        return;
      }

      // Module-wise calculation
      let totalReadyCount = 0;
      let totalNotReadyCount = 0;

      for (const module of modulesToProcess) {
        let moduleReadyCount = 0;
        let moduleNotReadyCount = 0;

        for (const userId of userIds) {
          // Get learning plan for this user and module
          const { data: learningPlan } = await supabase
            .from('learning_plan')
            .select('overall_status, processed_module_ids')
            .eq('user_id', userId)
            .eq('module_id', module.module_id)
            .single();

          if (learningPlan) {
            // Check if user has passed the module (overall_status is true)
            if (learningPlan.overall_status === true) {
              moduleReadyCount++;
            } else {
              // User has not passed - check processed_module_ids
              if (learningPlan.processed_module_ids === null || learningPlan.processed_module_ids === '') {
                // Don't count this user (not started yet)
                continue;
              } else {
                // User has started but not passed
                moduleNotReadyCount++;
              }
            }
          }
          // If no learning plan exists, don't count the user
        }

        totalReadyCount += moduleReadyCount;
        totalNotReadyCount += moduleNotReadyCount;
      }

      const totalUsers = totalReadyCount + totalNotReadyCount;
     
      if (totalUsers === 0) {
        setWorkforceReadiness({ score: 0, change: 0, status: 'No Training Data' });
        return;
      }

      const score = Math.round((totalReadyCount / totalUsers) * 100);
      const change = Math.round((Math.random() * 5) + 1); // Simulated improvement - can be calculated from historical data
     
      let status = 'Developing';
      if (score >= 80) status = 'High Performance Zone';
      else if (score >= 60) status = 'On Track';
      else if (score >= 40) status = 'Needs Attention';

      setWorkforceReadiness({ score, change, status });
    } catch (error) {
      console.error('Error calculating workforce readiness:', error);
      setWorkforceReadiness({ score: 0, change: 0, status: 'Error' });
    }
  };

  const calculateOrganizationFunctionReadiness = async () => {
    try {
      const users = await fetchUserByFilter({
        functionId: selectedFunctionId,
        subFunctionId: selectedSubFunctionId,
        titleId: selectedTitleId
      });

      if (!users || users.length === 0) {
        setWorkforceReadiness({ score: 0, change: 0, status: 'No Users Found' });
        return;
      }

      let readyCount = 0;
      let notReadyCount = 0;

      // Check each user
      for (const user of users) {
        // Get all learning plans for this user
        const { data: learningPlans, error } = await supabase
          .from('learning_plan')
          .select('module_id, overall_status, processed_module_ids')
          .eq('user_id', user.user_id);

        // Skip users who haven't generated any modules
        if (!learningPlans || learningPlans.length === 0) {
          continue;
        }

        // Filter out modules that haven't been started (processed_module_ids is null or empty)
        const startedModules = learningPlans.filter(
          (lp: { processed_module_ids: string | null; overall_status: boolean | null }) => lp.processed_module_ids !== null && lp.processed_module_ids !== ''
        );

        // If no modules have been started, don't count this user
        if (startedModules.length === 0) {
          continue;
        }

        // Check if user has passed ALL their started modules
        const allModulesPassed = startedModules.every((lp: { overall_status: boolean | null }) => lp.overall_status === true);

        if (allModulesPassed) {
          // User has completed all assigned modules
          readyCount++;
        } else {
          // User has started but not completed all modules
          notReadyCount++;
        }
      }

      const totalUsers = readyCount + notReadyCount;

      if (totalUsers === 0) {
        setWorkforceReadiness({ score: 0, change: 0, status: 'No Training Data' });
        return;
      }

      // Calculate readiness score
      const score = Math.round((readyCount / totalUsers) * 100);
      const change = Math.round((Math.random() * 5) + 1); // Simulated improvement - can be calculated from historical data
     
      let status = 'Developing';
      if (score >= 80) status = 'High Performance Zone';
      else if (score >= 60) status = 'On Track';
      else if (score >= 40) status = 'Needs Attention';

      setWorkforceReadiness({ score, change, status });
    } catch (error) {
      console.error('Error calculating organization/function readiness:', error);
      setWorkforceReadiness({ score: 0, change: 0, status: 'Error' });
    }
  };

  const generateLucidAnalysis = async () => {
    const hasData = kpiData.length > 0 && correlationData.length > 0;
   
    if (!hasData) {
      setLucidAnalysis('LUCID here. Awaiting sufficient data for analysis. Please ensure KPIs and training modules are properly configured for your selected role.');
      return;
    }

    const kpiName = kpiData[0]?.name || 'KPI';
    const topModule = topModules[0]?.module_name || 'training module';
    const trend = workforceReadiness.change > 0 ? 'upward' : 'steady';
    const recentDate = correlationData[correlationData.length - 1]?.date || 'recent period';
   
    setLucidAnalysis(
      `LUCID here. I have analyzed your ${kpiName} performance data, which shows a consistent ${trend} trend. This improvement correlates directly with the deployment of the "${topModule}" module. The data suggests that the team is successfully applying new strategies, resulting in gains in overall efficiency. With a workforce readiness score of ${workforceReadiness.score}%, the team is ${workforceReadiness.status.toLowerCase()}. I recommend reinforcing the specific techniques covered in high-impact training during your next team huddle.`
    );
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Completed': return 'text-green-500 bg-green-50';
      case 'In Progress': return 'text-orange-500 bg-orange-50';
      case 'Pending': return 'text-yellow-600 bg-yellow-50';
      default: return 'text-gray-500 bg-gray-50';
    }
  };

  const getProgressPercentage = (progress: number) => {
    if (progress >= 40) return '(40%)';
    if (progress >= 10) return '(10%)';
    return '';
  };

  if (loading) {
    return (
      showLoadingProgress
        ? <LoadingProgress label="Loading KPI turbocharge..." progress={loadingProgress} />
        : <div className="min-h-screen flex items-center justify-center bg-gray-50"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" /></div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <main className="p-6 space-y-6">
        {/* Header Card */}
        <div className="bg-white rounded-xl shadow-sm p-8 border border-slate-200">
          <div className="flex flex-col md:flex-row items-start justify-between gap-4">
            <div className="flex-1">
              <h1 className="text-3xl font-bold text-gray-800 mb-2">KPI Turbocharge</h1>
              <p className="text-slate-600 max-w-md">Outcome-based learning engine mapping capability to business performance.</p>
            </div>
            {/* Workforce Readiness Index */}
            <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200 px-6 py-4 w-full md:w-auto">
              <div className="flex items-center gap-6">
                <div>
                  <div className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">
                    Workforce Readiness Index
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-gray-900">{workforceReadiness.score}%</span>
                    {workforceReadiness.change > 0 && (
                      <span className="text-sm font-semibold text-green-600 flex items-center gap-1">
                        {/* <ArrowUpRight size={14} /> */}
                        {/* {workforceReadiness.change}% */}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 mt-1">
                    <Activity size={12} className="text-blue-600" />
                    <span className="text-xs text-gray-600">{workforceReadiness.status}</span>
                  </div>
                </div>
                <div className="relative w-24 h-24">
                  <svg className="transform -rotate-90 w-24 h-24">
                    <circle cx="48" cy="48" r="40" stroke="#E0E7FF" strokeWidth="8" fill="none" />
                    <circle
                      cx="48"
                      cy="48"
                      r="40"
                      stroke="url(#gradient)"
                      strokeWidth="8"
                      fill="none"
                      strokeDasharray={`${2 * Math.PI * 40 * (workforceReadiness.score / 100)} ${2 * Math.PI * 40}`}
                      strokeLinecap="round"
                    />
                    <defs>
                      <linearGradient id="gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                        <stop offset="0%" stopColor="#818CF8" />
                        <stop offset="100%" stopColor="#3B66F5" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="w-3 h-3 bg-blue-500 rounded-full animate-pulse" />
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>

        {/* Filters */}
        <Card className="bg-white border-gray-200 shadow-sm p-4">
          <div className="flex flex-col md:flex-row items-center gap-4 w-full">
            <div className="flex items-center gap-2 text-gray-600">
              <Filter size={18} />
              <span className="text-sm font-medium">Select Role:</span>
            </div>
           
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 flex-1 w-full">
              <div className="flex-1 min-w-[150px]">
                <div className="text-xs text-gray-500 uppercase font-semibold mb-1 tracking-wide">Function</div>
                <select
                  value={selectedFunctionId}
                  onChange={(e) => setSelectedFunctionId(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">All Functions</option>
                  {functions.map(func => (
                    <option key={func.function_id} value={func.function_id}>{func.function_name}</option>
                  ))}
                </select>
              </div>

              <div className="flex-1 min-w-[150px]">
                <div className="text-xs text-gray-500 uppercase font-semibold mb-1 tracking-wide">Sub-Function</div>
                <select
                  value={selectedSubFunctionId}
                  onChange={(e) => setSelectedSubFunctionId(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={!selectedFunctionId}
                >
                  <option value="">All Sub-Functions</option>
                  {subFunctions.map(subFunc => (
                    <option key={subFunc.sub_function_id} value={subFunc.sub_function_id}>{subFunc.sub_function_name}</option>
                  ))}
                </select>
              </div>

              <div className="flex-1 min-w-[150px]">
                <div className="text-xs text-gray-500 uppercase font-semibold mb-1 tracking-wide">Role</div>
                <select
                  value={selectedTitleId}
                  onChange={(e) => setSelectedTitleId(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  disabled={!selectedSubFunctionId}
                >
                  <option value="">All Roles</option>
                  {titles.map(title => (
                    <option key={title.title_id} value={title.title_id}>{title.title_name}</option>
                  ))}
                </select>
              </div>

              <div className="flex-1 min-w-[150px]">
                <div className="text-xs text-gray-500 uppercase font-semibold mb-1 tracking-wide">Module</div>
                <select
                  value={selectedModuleId}
                  onChange={(e) => setSelectedModuleId(e.target.value)}
                  className="w-full bg-white border border-gray-300 rounded-lg px-4 py-2.5 text-gray-900 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="">All Modules</option>
                  {modules.map(module => (
                    <option key={module.module_id} value={module.module_id}>{module.title}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </Card>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-gray-500">Retrieving information…</div>
          </div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {kpiData.length > 0 ? kpiData.map((kpi) => (
                <Card
                  key={kpi.id}
                  className={`bg-white border-blue-200 shadow-sm p-6 hover:border-blue-300 transition-all cursor-pointer ${
                    selectedKpiId === kpi.id ? 'border-blue-500' : ''
                  }`}
                  onClick={() => setSelectedKpiId(kpi.id)}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="text-xs text-gray-600 uppercase font-semibold tracking-wider mb-2">
                        {kpi.name}
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-4xl font-bold text-gray-900">{kpi.current_value}{kpi.unit === 'target' ? '%' : kpi.unit === 'SKUs target' ? '' : '%'}</span>
                        <span className="text-sm text-gray-500">{kpi.unit}</span>
                      </div>
                    </div>
                    <div className="w-12 h-12 rounded-full bg-blue-50 border border-blue-200 flex items-center justify-center">
                      <Target size={24} className="text-blue-600" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="text-xs text-gray-500 uppercase font-semibold tracking-wide">Mapped Modules</div>
                    <div className="flex flex-wrap gap-2">
                      {kpi.mapped_modules.length > 0 ? kpi.mapped_modules.map((module, idx) => (
                        <span
                          key={idx}
                          className="px-3 py-1.5 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium border border-blue-200"
                        >
                          {module}
                        </span>
                      )) : (
                        <span className="text-xs text-gray-400 italic">No modules mapped</span>
                      )}
                    </div>
                  </div>
                </Card>
              )) : (
                <div className="col-span-3 text-center py-8 text-gray-500">
                  No KPIs found for selected filters
                </div>
              )}
            </div>

            {/* Performance Correlation Chart */}
            <Card className="bg-white border-gray-200 shadow-sm p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <div className="text-sm text-gray-600 mb-1">Actual vs Target</div>
                  <div className="flex items-baseline gap-3">
                    <span className="text-3xl font-bold text-gray-900">
                      Actual: {scatterData.length > 0
                        ? `${Math.round(scatterData.reduce((sum, d) => sum + d.module_performance, 0) / scatterData.length)}%`
                        : '0%'}
                    </span>
                    {selectedKpiInfo && selectedKpiInfo.target > 0 && (
                      <span className="flex items-center gap-1 text-sm font-semibold text-blue-600">
                        <Target size={16} />
                        Target: {selectedKpiInfo.target}%
                      </span>
                    )}
                  </div>
                </div>
                {/* <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg border border-blue-200">
                  <Activity size={16} className="text-blue-600" />
                  <span className="text-sm font-semibold text-blue-700">Live Correlation Active</span>
                </div> */}
              </div>

              <div className="text-xs text-gray-600 mb-4 flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-blue-600"></div>
                  <span>KPI Score {selectedKpiInfo ? `(${selectedKpiInfo.name})` : '(Average)'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                  <span>Sprint Performance (%)</span>
                </div>
              </div>

              {/* Scatter Plot */}
              <div className="relative h-80 bg-gradient-to-br from-gray-50 to-blue-50 rounded-lg p-6">
                {scatterData.length > 0 ? (
                  <svg width="100%" height="100%" viewBox="0 0 700 300" className="overflow-visible">
                    {/* Y-axis grid lines and labels */}
                    {[0, 20, 40, 60, 80, 100].map((val, idx) => (
                      <g key={`y-${idx}`}>
                        <line
                          x1="60"
                          y1={280 - (val * 2.6)}
                          x2="680"
                          y2={280 - (val * 2.6)}
                          stroke="#E5E7EB"
                          strokeWidth="1"
                          strokeDasharray="2,2"
                        />
                        <text
                          x="45"
                          y={280 - (val * 2.6)}
                          dy="4"
                          fill="#6B7280"
                          fontSize="11"
                          textAnchor="end"
                        >
                          {val}
                        </text>
                      </g>
                    ))}

                    {/* X-axis grid lines and labels */}
                    {[0, 20, 40, 60, 80, 100].map((val, idx) => (
                      <g key={`x-${idx}`}>
                        <line
                          x1={60 + (val * 6.2)}
                          y1="20"
                          x2={60 + (val * 6.2)}
                          y2="280"
                          stroke="#E5E7EB"
                          strokeWidth="1"
                          strokeDasharray="2,2"
                        />
                        <text
                          x={60 + (val * 6.2)}
                          y="295"
                          fill="#6B7280"
                          fontSize="11"
                          textAnchor="middle"
                        >
                          {val}
                        </text>
                      </g>
                    ))}

                    {/* Target line - only show if KPI is selected */}
                    {selectedKpiInfo && selectedKpiInfo.target > 0 && (
                      <g>
                        <line
                          x1="60"
                          y1={280 - (selectedKpiInfo.target * 2.6)}
                          x2="680"
                          y2={280 - (selectedKpiInfo.target * 2.6)}
                          stroke="#EF4444"
                          strokeWidth="2"
                          strokeDasharray="8,4"
                        />
                        <text
                          x="685"
                          y={280 - (selectedKpiInfo.target * 2.6)}
                          dy="4"
                          fill="#EF4444"
                          fontSize="12"
                          fontWeight="600"
                        >
                          Target: {selectedKpiInfo.target}
                        </text>
                      </g>
                    )}

                    {/* Axis labels */}
                    <text
                      x="370"
                      y="295"
                      fill="#374151"
                      fontSize="13"
                      fontWeight="600"
                      textAnchor="middle"
                    >
                      KPI Score {selectedKpiInfo ? `(${selectedKpiInfo.name})` : '(Average)'} →
                    </text>
                    <text
                      x="25"
                      y="150"
                      fill="#374151"
                      fontSize="13"
                      fontWeight="600"
                      textAnchor="middle"
                      transform="rotate(-90, 25, 150)"
                    >
                      ↑ Sprint Performance (%)
                    </text>

                    {/* Scatter Points with improved styling */}
                    {scatterData.map((d, i) => {
                      const x = 60 + ((d.kpi_score / 100) * 620);
                      const y = 280 - ((d.module_performance / 100) * 260);
                     
                      return (
                        <g key={i}>
                          {/* Outer glow */}
                          <circle
                            cx={x}
                            cy={y}
                            r="10"
                            fill="#3B82F6"
                            opacity="0.2"
                          />
                          {/* Main circle */}
                          <circle
                            cx={x}
                            cy={y}
                            r="7"
                            fill="#3B82F6"
                            opacity="0.9"
                            stroke="#1E40AF"
                            strokeWidth="2"
                            className="hover:r-9 transition-all cursor-pointer"
                          />
                          {/* User name label */}
                          <text
                            x={x}
                            y={y - 18}
                            fill="#1F2937"
                            fontSize="11"
                            fontWeight="600"
                            textAnchor="middle"
                            className="pointer-events-none"
                          >
                            {d.user_name.split(' ')[0]}
                          </text>
                          {/* Score tooltip */}
                          <text
                            x={x}
                            y={y + 25}
                            fill="#6B7280"
                            fontSize="9"
                            textAnchor="middle"
                            className="pointer-events-none"
                          >
                            ({d.kpi_score}, {d.module_performance})
                          </text>
                        </g>
                      );
                    })}

                    {/* Axes lines */}
                    <line x1="60" y1="280" x2="680" y2="280" stroke="#374151" strokeWidth="2" />
                    <line x1="60" y1="20" x2="60" y2="280" stroke="#374151" strokeWidth="2" />
                  </svg>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-gray-500">
                    <AlertCircle size={48} className="mb-3 text-gray-400" />
                    <p className="text-sm font-medium">No correlation data available</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {selectedKpiId ? 'Select users have not completed assessments for this KPI' : 'Please select a KPI to view correlation data'}
                    </p>
                  </div>
                )}
              </div>
            </Card>
              {/* Lucid Engine Analysis */}
            <Card className="bg-gradient-to-br from-blue-50 to-purple-50 border-blue-200 shadow-sm p-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shrink-0">
                  <Sparkles size={24} className="text-white" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-gray-900 mb-3 flex items-center gap-2">
                    Lucid Engine Analysis
                  </h3>
                  <p className="text-gray-700 text-sm leading-relaxed">
                    {lucidAnalysis}
                  </p>
                </div>
              </div>
            </Card>
            {/* Content Evaluation & Recommended Actions */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Content Evaluation */}
              <Card className="bg-white border-gray-200 shadow-sm p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-bold text-gray-900">Content Evaluation</h3>
                  {/* <span className="text-xs text-gray-500">Role-wide Analysis</span> */}
                </div>

                {/* Top Performing */}
                <div className="mb-6">
                  <div className="flex items-center gap-2 mb-4">
                    <ThumbsUp size={16} className="text-green-600" />
                    <span className="text-sm font-bold text-green-600 uppercase tracking-wide">Top Performing Sprints</span>
                  </div>
                  <div className="space-y-3">
                    {topModules.length > 0 ? topModules.map((module, idx) => (
                      <div key={idx} className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-medium text-gray-900 text-sm">{module.module_name}</div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">{module.module_type}</span>
                            <span className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs font-bold border border-green-200">
                              {module.impact_score}/100
                            </span>
                          </div>
                        </div>
                        <div className="text-xs text-gray-600">
                          {module.completion_rate}% Complete • <span className="text-green-600">High Impact</span>
                        </div>
                      </div>
                    )) : (
                      <div className="text-sm text-gray-500 text-center py-4">No module data available</div>
                    )}
                  </div>
                </div>

                {/* Needs Optimization */}
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <AlertCircle size={16} className="text-orange-600" />
                    <span className="text-sm font-bold text-orange-600 uppercase tracking-wide">Needs Optimization</span>
                  </div>
                  <div className="space-y-3">
                    {needsOptimization.length > 0 ? needsOptimization.map((module, idx) => (
                      <div key={idx} className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-medium text-gray-900 text-sm">{module.module_name}</div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">{module.module_type}</span>
                            <span className="px-2 py-1 bg-orange-50 text-orange-700 rounded text-xs font-bold border border-orange-200">
                              {module.impact_score}/100
                            </span>
                          </div>
                        </div>
                        <div className="text-xs text-gray-600">
                          {module.completion_rate}% Complete • <span className="text-orange-600">Needs Review</span>
                        </div>
                      </div>
                    )) : (
                      <div className="text-sm text-gray-500 text-center py-4">All modules performing well</div>
                    )}
                  </div>
                </div>
              </Card>

              {/* Recommended JIT Actions */}
              <Card className="bg-white border-gray-200 shadow-sm p-6">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <Zap size={20} className="text-yellow-600" />
                    <h3 className="text-lg font-bold text-gray-900">Recommended JIT Actions</h3>
                  </div>
                  {recommendedActions.filter(a => a.status === 'Pending').length > 0 && (
                    <span className="px-2.5 py-1 bg-yellow-50 text-yellow-700 rounded-full text-xs font-bold border border-yellow-200">
                      {recommendedActions.filter(a => a.status === 'Pending').length} Pending
                    </span>
                  )}
                </div>

                <div className="space-y-3">
                  {recommendedActions.length > 0 ? recommendedActions.map((action, idx) => (
                    <div key={idx} className="p-4 bg-gray-50 rounded-lg border border-gray-200 hover:border-blue-300 transition-all">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-full ${
                          action.status === 'Completed' ? 'bg-green-50 text-green-700' :
                          action.status === 'In Progress' ? 'bg-orange-50 text-orange-700' :
                          'bg-yellow-50 text-yellow-700'
                        } flex items-center justify-center font-bold text-sm shrink-0 border ${
                          action.status === 'Completed' ? 'border-green-200' :
                          action.status === 'In Progress' ? 'border-orange-200' :
                          'border-yellow-200'
                        }`}>
                          {action.employee_initials}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1">
                            <div className="font-semibold text-gray-900 text-sm">{action.employee_name}</div>
                            <span className={`px-2 py-1 rounded text-xs font-semibold ${getStatusColor(action.status)}`}>
                              {action.status}
                            </span>
                          </div>
                          <div className="text-xs text-gray-600 mb-1">Gap: <span className="text-gray-900">{action.gap}</span></div>
                          <div className="flex items-center gap-1.5 text-xs">
                            <Target size={12} className="text-blue-600" />
                            <span className="text-blue-700">{action.module}</span>
                            {action.progress > 0 && action.progress < 100 && (
                              <span className="text-gray-500 ml-auto">{getProgressPercentage(action.progress)}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  )) : (
                    <div className="text-sm text-gray-500 text-center py-8">No recommended actions at this time</div>
                  )}
                </div>

                {recommendedActions.filter(a => a.status === 'Pending').length > 0 && (
                  <Button className="w-full mt-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold">
                    <Users size={16} className="mr-2" />
                    Auto-Assign All Modules
                  </Button>
                )}
              </Card>
            </div>

           

            {/* Employee Performance Heatmap */}
            {/* <Card className="bg-white border-gray-200 shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-base font-bold text-gray-900">Employee Performance Heatmap</h3>
                  <p className="text-xs text-gray-600 mt-1">Module completion scores across your team</p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2 text-xs">
                    <div className="flex items-center gap-1">
                      <div className="w-3 h-3 bg-gray-200 rounded"></div>
                      <span className="text-gray-600">Not Started</span>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <div className="w-3 h-3 bg-red-500 rounded"></div>
                      <span className="text-gray-600">0-40</span>
                    </div>
                    <div className="flex items-center gap-1 ml-1">
                      <div className="w-3 h-3 bg-orange-400 rounded"></div>
                      <span className="text-gray-600">41-60</span>
                    </div>
                    <div className="flex items-center gap-1 ml-1">
                      <div className="w-3 h-3 bg-yellow-400 rounded"></div>
                      <span className="text-gray-600">61-80</span>
                    </div>
                    <div className="flex items-center gap-1 ml-1">
                      <div className="w-3 h-3 bg-green-500 rounded"></div>
                      <span className="text-gray-600">81-100</span>
                    </div>
                  </div>
                </div>
              </div>

              {heatmapData.length > 0 ? (
                <div className="overflow-x-auto">
                  <div className="inline-block min-w-full"> */}
                    {/* Header row with module names */}
                    {/* <div className="flex items-stretch border-b-2 border-gray-300">
                      <div className="w-36 shrink-0 p-2 bg-gray-50 font-semibold text-xs text-gray-700 border-r-2 border-gray-300 flex items-center">
                        Employee
                      </div>
                      {heatmapData[0]?.modules.map((module, idx) => (
                        <div
                          key={idx}
                          className="w-20 shrink-0 p-2 bg-gray-50 border-r border-gray-200 last:border-r-0"
                        >
                          <div className="text-[10px] font-semibold text-gray-700 transform -rotate-45 origin-left whitespace-nowrap">
                            {module.module_name.length > 20
                              ? module.module_name.substring(0, 20) + '...'
                              : module.module_name}
                          </div>
                        </div>
                      ))} */}
                    {/* </div> */}

                    {/* Employee rows */}
                    {/* {heatmapData.map((employee, empIdx) => (
                      <div key={empIdx} className="flex items-stretch border-b border-gray-200 hover:bg-blue-50 transition-colors">
                        <div className="w-36 shrink-0 p-2 bg-gray-50 font-medium text-xs text-gray-900 border-r-2 border-gray-300 flex items-center">
                          <div className="flex items-center gap-1.5">
                            <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-[10px] font-bold">
                              {employee.employee_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()}
                            </div>
                            <span className="truncate text-xs">{employee.employee_name}</span>
                          </div>
                        </div>
                        {employee.modules.map((module, modIdx) => {
                          let bgColor = 'bg-gray-200';
                          let textColor = 'text-gray-600';
                         
                          if (module.score !== null) {
                            if (module.score >= 81) {
                              bgColor = 'bg-green-500';
                              textColor = 'text-white';
                            } else if (module.score >= 61) {
                              bgColor = 'bg-yellow-400';
                              textColor = 'text-gray-900';
                            } else if (module.score >= 41) {
                              bgColor = 'bg-orange-400';
                              textColor = 'text-white';
                            } else {
                              bgColor = 'bg-red-500';
                              textColor = 'text-white';
                            }
                          }

                          return (
                            <div
                              key={modIdx}
                              className={`w-20 shrink-0 p-2 border-r border-gray-200 last:border-r-0 flex items-center justify-center ${bgColor} ${textColor} font-semibold text-xs transition-all hover:scale-105 hover:shadow-lg cursor-pointer relative group`}
                              title={`${employee.employee_name} - ${module.module_name}: ${module.score !== null ? module.score + '%' : 'Not Started'} (${module.status})`}
                            >
                              {module.score !== null ? `${module.score}%` : '-'} */}
                             
                              {/* Tooltip on hover */}
                              {/* <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1.5 bg-gray-900 text-white text-[10px] rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap z-10 shadow-lg">
                                <div className="font-semibold mb-0.5">{module.module_name}</div>
                                <div>Score: {module.score !== null ? module.score + '%' : 'Not Started'}</div>
                                <div className="capitalize">Status: {module.status.replace('_', ' ')}</div>
                                <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900"></div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))} */}

                    {/* Summary row - Module averages */}
                    {/* <div className="flex items-stretch border-t-2 border-gray-300 bg-blue-50">
                      <div className="w-36 shrink-0 p-2 bg-blue-100 font-bold text-xs text-blue-900 border-r-2 border-gray-300 flex items-center">
                        Module Avg
                      </div>
                      {heatmapData[0]?.modules.map((_, modIdx) => {
                        const scores = heatmapData
                          .map(emp => emp.modules[modIdx]?.score)
                          .filter(score => score !== null) as number[];
                       
                        const avg = scores.length > 0
                          ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length)
                          : 0;

                        let bgColor = 'bg-gray-300';
                        let textColor = 'text-gray-700';
                       
                        if (avg >= 81) {
                          bgColor = 'bg-green-400';
                          textColor = 'text-green-900';
                        } else if (avg >= 61) {
                          bgColor = 'bg-yellow-300';
                          textColor = 'text-yellow-900';
                        } else if (avg >= 41) {
                          bgColor = 'bg-orange-300';
                          textColor = 'text-orange-900';
                        } else if (avg > 0) {
                          bgColor = 'bg-red-400';
                          textColor = 'text-red-900';
                        }

                        return (
                          <div
                            key={modIdx}
                            className={`w-20 shrink-0 p-2 border-r border-gray-200 last:border-r-0 flex items-center justify-center ${bgColor} ${textColor} font-bold text-xs`}
                          >
                            {scores.length > 0 ? `${avg}%` : '-'}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-gray-500">
                  <AlertCircle size={40} className="mb-2 text-gray-400" />
                  <p className="text-sm font-medium">No heatmap data available</p>
                  <p className="text-xs text-gray-400 mt-1">
                    Employees need to complete module assessments to populate this view
                  </p>
                </div>
              )}
            </Card> */}
          </>
        )}
      </main>
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
        <p className="text-xs text-slate-500 font-medium">Preparing KPI turbocharge. This may take a moment.</p>
      </div>
    </div>
  );
}
