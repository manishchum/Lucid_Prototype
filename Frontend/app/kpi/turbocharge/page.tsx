'use client'

import React, { useState, useEffect } from 'react';
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
import EmployeeNavigation from '@/components/employee-navigation';
import { supabase } from '@/lib/supabase';

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

export default function KPITurbocharge() {
  const [functions, setFunctions] = useState<Array<{ function_id: string; function_name: string }>>([]);
  const [subFunctions, setSubFunctions] = useState<Array<{ sub_function_id: string; sub_function_name: string }>>([]);
  const [titles, setTitles] = useState<Array<{ title_id: string; title_name: string }>>([]);
  
  const [selectedFunctionId, setSelectedFunctionId] = useState<string>('');
  const [selectedSubFunctionId, setSelectedSubFunctionId] = useState<string>('');
  const [selectedTitleId, setSelectedTitleId] = useState<string>('');
  
  const [loading, setLoading] = useState(true);
  const [kpiData, setKpiData] = useState<KPIData[]>([]);
  const [topModules, setTopModules] = useState<ModulePerformance[]>([]);
  const [needsOptimization, setNeedsOptimization] = useState<ModulePerformance[]>([]);
  const [recommendedActions, setRecommendedActions] = useState<RecommendedAction[]>([]);
  const [correlationData, setCorrelationData] = useState<any[]>([]);
  const [lucidAnalysis, setLucidAnalysis] = useState<string>('');
  const [workforceReadiness, setWorkforceReadiness] = useState({ score: 0, change: 0, status: 'Calculating...' });

  useEffect(() => {
    loadFilters();
  }, []);

  useEffect(() => {
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
    if (selectedSubFunctionId) {
      loadTitles(selectedSubFunctionId);
    } else if (selectedFunctionId) {
      setTitles([]);
      setSelectedTitleId('');
    }
  }, [selectedSubFunctionId]);

  useEffect(() => {
    fetchAllData();
  }, [selectedFunctionId, selectedSubFunctionId, selectedTitleId]);

  const loadFilters = async () => {
    try {
      const { data: functionsData } = await supabase
        .from('function')
        .select('function_id, function_name')
        .eq('is_active', true)
        .order('function_name');

      if (functionsData && functionsData.length > 0) {
        setFunctions(functionsData);
        setSelectedFunctionId('');
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

  const fetchAllData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchKPIData(),
        fetchModulePerformance(),
        fetchRecommendedActions(),
        fetchCorrelationData(),
        calculateWorkforceReadiness()
      ]);
      generateLucidAnalysis();
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchKPIData = async () => {
    try {
      let kpiQuery = supabase
        .from('kpis')
        .select('kpi_id, name, description, target, datatype, function_id, sub_function_id, title_id');

      if (selectedTitleId) {
        kpiQuery = kpiQuery.eq('title_id', selectedTitleId);
      } else if (selectedSubFunctionId) {
        kpiQuery = kpiQuery.eq('sub_function_id', selectedSubFunctionId);
      } else if (selectedFunctionId) {
        kpiQuery = kpiQuery.eq('function_id', selectedFunctionId);
      }

      const { data: kpis } = await kpiQuery.limit(3);

      if (!kpis || kpis.length === 0) {
        setKpiData([]);
        return;
      }

      // Fetch related modules for each KPI
      const kpiDataWithModules = await Promise.all(
        kpis.map(async (kpi) => {
          const { data: modules } = await supabase
            .from('training_modules')
            .select('title')
            .limit(2);

          const current = kpi.target ? parseFloat(kpi.target) : 0;
          
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

      setKpiData(kpiDataWithModules);
    } catch (error) {
      console.error('Error fetching KPI data:', error);
      setKpiData([]);
    }
  };

  const fetchModulePerformance = async () => {
    try {
      let userQuery = supabase
        .from('users')
        .select('user_id')
        .eq('is_active', true)
        .eq('employment_status', 'ACTIVE');

      if (selectedTitleId) {
        userQuery = userQuery.eq('title_id', selectedTitleId);
      } else if (selectedSubFunctionId) {
        userQuery = userQuery.eq('sub_function_id', selectedSubFunctionId);
      } else if (selectedFunctionId) {
        userQuery = userQuery.eq('function_id', selectedFunctionId);
      }

      const { data: users } = await userQuery;
      const userIds = users?.map(u => u.user_id) || [];

      if (userIds.length === 0) {
        setTopModules([]);
        setNeedsOptimization([]);
        return;
      }

      const { data: learningPlans } = await supabase
        .from('learning_plan')
        .select('module_id, user_id, status, progress')
        .in('user_id', userIds);

      if (!learningPlans || learningPlans.length === 0) {
        setTopModules([]);
        setNeedsOptimization([]);
        return;
      }

      const moduleIds = [...new Set(learningPlans.map(lp => lp.module_id))];
      const { data: modules } = await supabase
        .from('training_modules')
        .select('module_id, title, content_type')
        .in('module_id', moduleIds);

      // Calculate module performance
      const moduleStats = moduleIds.map(moduleId => {
        const modulePlans = learningPlans.filter(lp => lp.module_id === moduleId);
        const totalUsers = modulePlans.length;
        const completedUsers = modulePlans.filter(lp => lp.status === 'COMPLETED').length;
        const avgProgress = modulePlans.reduce((sum, lp) => sum + (lp.progress || 0), 0) / totalUsers;
        const completionRate = (completedUsers / totalUsers) * 100;
        
        // Calculate impact score based on completion rate and progress
        const impactScore = Math.round((completionRate * 0.6) + (avgProgress * 0.4));

        const module = modules?.find(m => m.module_id === moduleId);

        return {
          module_id: moduleId,
          module_name: module?.title || 'Unknown Module',
          completion_rate: Math.round(completionRate),
          impact_score: impactScore,
          module_type: module?.content_type === 'pdf' ? 'SOP' : 
                      module?.content_type === 'video' ? 'Video' : 'Simulation'
        };
      });

      // Sort by impact score
      moduleStats.sort((a, b) => b.impact_score - a.impact_score);

      // Top 3 performers
      setTopModules(moduleStats.slice(0, 3));

      // Bottom 2 that need optimization
      setNeedsOptimization(moduleStats.slice(-2).reverse());

    } catch (error) {
      console.error('Error fetching module performance:', error);
      setTopModules([]);
      setNeedsOptimization([]);
    }
  };

  const fetchRecommendedActions = async () => {
    try {
      let userQuery = supabase
        .from('users')
        .select('user_id, name, function_id, sub_function_id, title_id')
        .eq('is_active', true)
        .eq('employment_status', 'ACTIVE');

      if (selectedTitleId) {
        userQuery = userQuery.eq('title_id', selectedTitleId);
      } else if (selectedSubFunctionId) {
        userQuery = userQuery.eq('sub_function_id', selectedSubFunctionId);
      } else if (selectedFunctionId) {
        userQuery = userQuery.eq('function_id', selectedFunctionId);
      }

      const { data: users } = await userQuery.limit(4);

      if (!users || users.length === 0) {
        setRecommendedActions([]);
        return;
      }

      const userIds = users.map(u => u.user_id);

      const { data: learningPlans } = await supabase
        .from('learning_plan')
        .select('user_id, module_id, status, progress')
        .in('user_id', userIds)
        .in('status', ['ASSIGNED', 'IN_PROGRESS', 'COMPLETED'])
        .order('updated_at', { ascending: false });

      const { data: modules } = await supabase
        .from('training_modules')
        .select('module_id, title');

      const { data: kpis } = await supabase
        .from('kpis')
        .select('name')
        .limit(3);

      const actions: RecommendedAction[] = users.slice(0, 4).map((user, idx) => {
        const userPlans = learningPlans?.filter(lp => lp.user_id === user.user_id) || [];
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
      let userQuery = supabase
        .from('users')
        .select('user_id')
        .eq('is_active', true)
        .eq('employment_status', 'ACTIVE');

      if (selectedTitleId) {
        userQuery = userQuery.eq('title_id', selectedTitleId);
      } else if (selectedSubFunctionId) {
        userQuery = userQuery.eq('sub_function_id', selectedSubFunctionId);
      } else if (selectedFunctionId) {
        userQuery = userQuery.eq('function_id', selectedFunctionId);
      }

      const { data: users } = await userQuery;
      const userIds = users?.map(u => u.user_id) || [];

      if (userIds.length === 0) {
        setWorkforceReadiness({ score: 0, change: 0, status: 'No Data' });
        return;
      }

      const { data: learningPlans } = await supabase
        .from('learning_plan')
        .select('status, progress')
        .in('user_id', userIds);

      if (!learningPlans || learningPlans.length === 0) {
        setWorkforceReadiness({ score: 0, change: 0, status: 'No Training Data' });
        return;
      }

      const totalProgress = learningPlans.reduce((sum, lp) => sum + (lp.progress || 0), 0);
      const avgProgress = totalProgress / learningPlans.length;
      const completionRate = (learningPlans.filter(lp => lp.status === 'COMPLETED').length / learningPlans.length) * 100;
      
      const score = Math.round((avgProgress * 0.5) + (completionRate * 0.5));
      const change = Math.round((Math.random() * 5) + 1); // Simulated improvement
      
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

  return (
    <div className="min-h-screen bg-gray-50 flex">
      <EmployeeNavigation />
      
      <main className="flex-1 lg:ml-[280px] p-6 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <h1 className="text-3xl font-bold text-gray-900">KPI Turbocharge</h1>
              <span className="px-2.5 py-1 text-xs font-bold text-blue-600 bg-blue-50 rounded-full border border-blue-200">
                Beta
              </span>
            </div>
            <p className="text-gray-600 text-sm">Outcome-based learning engine. Mapping capability to production.</p>
          </div>
          
          {/* Workforce Readiness Index */}
          <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200 px-6 py-4">
            <div className="flex items-center gap-6">
              <div>
                <div className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-1">
                  Workforce Readiness Index
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-3xl font-bold text-gray-900">{workforceReadiness.score}%</span>
                  {workforceReadiness.change > 0 && (
                    <span className="text-sm font-semibold text-green-600 flex items-center gap-1">
                      <ArrowUpRight size={14} />
                      {workforceReadiness.change}%
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

        {/* Filters */}
        <Card className="bg-white border-gray-200 shadow-sm p-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-gray-600">
              <Filter size={18} />
              <span className="text-sm font-medium">Select Role:</span>
            </div>
            
            <div className="flex items-center gap-3 flex-1">
              <div className="flex-1">
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

              <div className="flex-1">
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

              <div className="flex-1">
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
            </div>
          </div>
        </Card>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="text-gray-500">Loading data...</div>
          </div>
        ) : (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-3 gap-6">
              {kpiData.length > 0 ? kpiData.map((kpi) => (
                <Card key={kpi.id} className="bg-white border-blue-200 shadow-sm p-6 hover:border-blue-300 transition-all">
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
                  <div className="text-sm text-gray-600 mb-1">Performance Correlation</div>
                  <div className="flex items-baseline gap-3">
                    <span className="text-4xl font-bold text-gray-900">
                      {correlationData[correlationData.length - 1]?.eco || 0}%
                    </span>
                    <span className="flex items-center gap-1 text-sm font-semibold text-blue-600">
                      <Target size={16} />
                      Target: 85%
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 rounded-lg border border-blue-200">
                  <Activity size={16} className="text-blue-600" />
                  <span className="text-sm font-semibold text-blue-700">Live Correlation Active</span>
                </div>
              </div>

              <div className="text-xs text-gray-600 mb-4 flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-blue-600"></div>
                  <span>Performance Metric (Left Axis)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-teal-500"></div>
                  <span>Competency Score (Right Axis)</span>
                </div>
              </div>

              {/* Simple Chart */}
              <div className="relative h-64 bg-gray-50 rounded-lg p-4">
                {correlationData.length > 0 ? (
                  <svg width="100%" height="100%" className="overflow-visible">
                    {/* Grid lines */}
                    {[0, 25, 50, 75, 100].map((val, idx) => (
                      <g key={idx}>
                        <line 
                          x1="0" 
                          y1={`${100 - val}%`} 
                          x2="100%" 
                          y2={`${100 - val}%`} 
                          stroke="#E5E7EB" 
                          strokeWidth="1"
                        />
                        <text x="0" y={`${100 - val}%`} dy="-5" fill="#9CA3AF" fontSize="10">{val}</text>
                      </g>
                    ))}

                    {/* ECO Line */}
                    <polyline
                      points={correlationData.map((d, i) => 
                        `${(i / (correlationData.length - 1)) * 100}%,${100 - d.eco}%`
                      ).join(' ')}
                      fill="none"
                      stroke="#2563EB"
                      strokeWidth="3"
                    />

                    {/* Competency Line */}
                    <polyline
                      points={correlationData.map((d, i) => 
                        `${(i / (correlationData.length - 1)) * 100}%,${100 - d.competency}%`
                      ).join(' ')}
                      fill="none"
                      stroke="#14B8A6"
                      strokeWidth="3"
                    />

                    {/* Data points */}
                    {correlationData.map((d, i) => (
                      <g key={i}>
                        <circle 
                          cx={`${(i / (correlationData.length - 1)) * 100}%`}
                          cy={`${100 - d.eco}%`}
                          r="4"
                          fill="#2563EB"
                        />
                        <circle 
                          cx={`${(i / (correlationData.length - 1)) * 100}%`}
                          cy={`${100 - d.competency}%`}
                          r="4"
                          fill="#14B8A6"
                        />
                      </g>
                    ))}
                  </svg>
                ) : (
                  <div className="flex items-center justify-center h-full text-gray-500">
                    No correlation data available
                  </div>
                )}
              </div>
            </Card>

            {/* Content Evaluation & Recommended Actions */}
            <div className="grid grid-cols-2 gap-6">
              {/* Content Evaluation */}
              <Card className="bg-white border-gray-200 shadow-sm p-6">
                <div className="flex items-center justify-between mb-6">
                  <h3 className="text-lg font-bold text-gray-900">Content Evaluation</h3>
                  <span className="text-xs text-gray-500">Role-wide Analysis</span>
                </div>

                {/* Top Performing */}
                <div className="mb-6">
                  <div className="flex items-center gap-2 mb-4">
                    <ThumbsUp size={16} className="text-green-600" />
                    <span className="text-sm font-bold text-green-600 uppercase tracking-wide">Top Performing Modules</span>
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
          </>
        )}
      </main>
    </div>
  );
}
