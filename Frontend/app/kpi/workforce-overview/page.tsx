'use client'

import React, { useState, useEffect } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { 
  TrendingUp, 
  Users, 
  ChevronDown, 
  Target,
  FileText,
  Smartphone,
  PlayCircle,
  BarChart3,
  Filter
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";


function parseArrayFromPayload(payload: any): any[] {
if (!payload) return [];
if (Array.isArray(payload)) return payload;
if (Array.isArray(payload.data)) return payload.data;
if (Array.isArray(payload.items)) return payload.items;
if (payload.data && Array.isArray(payload.data.items)) return payload.data.items;
console.warn('Unexpected payload shape for array parsing', payload);
return [];
}
// helper: fetch users by filter via backend (do not query users table from frontend)
const fetchUsersByFilter = async (filters: {
  functionId?: string;
  subFunctionId?: string;
  titleId?: string;
}) => {
  try {
    // Build query params
    const params = new URLSearchParams();
    if (filters.functionId) params.append('function_id', filters.functionId);
    if (filters.subFunctionId) params.append('sub_function_id', filters.subFunctionId);
    if (filters.titleId) params.append('title_id', filters.titleId);
    params.append('is_active', 'true');
    params.append('employment_status', 'ACTIVE');

    // Note: This assumes you have a backend endpoint that supports these filters
    // If not available, you'll need to create one or fetch all and filter client-side
    const res = await fetch(`${API_BASE}/api/users?${params.toString()}`);
    if (!res.ok) return [];
    const payload = await res.json();
    const users = payload?.users ?? payload;
    return Array.isArray(users) ? users : users ? [users] : [];
  } catch (e) {
    console.error('[fetchUsersByFilter] error', e);
    return [];
  }
};

// const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:8000";

// // helper: fetch users by filter via backend (do not query users table from frontend)
// const fetchUsersByFilter = async (filters: {
//   functionId?: string;
//   subFunctionId?: string;
//   titleId?: string;
// }) => {
//   try {
//     // Build query params
//     const params = new URLSearchParams();
//     if (filters.functionId) params.append('function_id', filters.functionId);
//     if (filters.subFunctionId) params.append('sub_function_id', filters.subFunctionId);
//     if (filters.titleId) params.append('title_id', filters.titleId);
//     params.append('is_active', 'true');
//     params.append('employment_status', 'ACTIVE');

//     // Note: This assumes you have a backend endpoint that supports these filters
//     // If not available, you'll need to create one or fetch all and filter client-side
//     const res = await fetch(`${API_BASE}/api/users?${params.toString()}`);
//     if (!res.ok) return [];
//     const payload = await res.json();
//     const users = payload?.users ?? payload;
//     return Array.isArray(users) ? users : users ? [users] : [];
//   } catch (e) {
//     console.error('[fetchUsersByFilter] error', e);
//     return [];
//   }
// };

interface ModuleAssignment {
  module_name: string;
  count: number;
  color: string;
}

interface KPIMapping {
  kpi_name: string;
  target: string;
  description: string;
  formula?: string;
  modules: Array<{
    name: string;
    type: 'SOP' | 'VIDEO' | 'SIMULATION';
    correlation: 'High' | 'Medium' | 'Low';
    icon: any;
  }>;
}

export default function WorkforceOverview() {
  const {user, loading: authLoading} = useAuth();

  const router = useRouter();
  const [functions, setFunctions] = useState<Array<{ function_id: string; function_name: string }>>([]);
  const [subFunctions, setSubFunctions] = useState<Array<{ sub_function_id: string; sub_function_name: string }>>([]);
  const [titles, setTitles] = useState<Array<{ title_id: string; title_name: string }>>([]);
  
  const [selectedFunctionId, setSelectedFunctionId] = useState<string>('');
  const [selectedSubFunctionId, setSelectedSubFunctionId] = useState<string>('');
  const [selectedTitleId, setSelectedTitleId] = useState<string>('');
  
  const [loading, setLoading] = useState(true);
  const { progress: loadingProgress, show: showLoadingProgress } = useIllusionProgress(authLoading || loading);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [userData, setUserData] = useState<any>(null);
  const [activeEmployees, setActiveEmployees] = useState({ count: 0, region: 'All Regions' });
  const [moduleAssignments, setModuleAssignments] = useState<ModuleAssignment[]>([]);
  const [kpiMappings, setKpiMappings] = useState<KPIMapping[]>([]);

  useEffect(() => {
          if (!authLoading) {
            if (!user) router.push("/login");
            else fetchCurrentUser();
          }
        }, [user, authLoading, router]);

  const fetchCurrentUser = async () => {
    if (!user?.email) return;
    try {
      const res = await fetch(`${API_BASE}/api/users/by-email/${encodeURIComponent(user.email)}`);
      if (!res.ok) {
        console.error('Error fetching current user');
        return;
      }
      const payload = await res.json();
      let userData = payload?.user ?? payload;
      if (Array.isArray(userData)) userData = userData[0];
      
      if (userData && userData.user_id) {
        setCurrentUserId(userData.user_id);
        setUserData(userData);
        loadFilters();
      }
    } catch (error) {
      console.error('Error fetching current user:', error);
    }
  };

  useEffect(() => {
    if (selectedFunctionId) {
      loadSubFunctions(selectedFunctionId);
    } else {
      // When "All" functions is selected, clear sub-functions and titles
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
      // When "All" sub-functions is selected but a function is selected, clear titles
      setTitles([]);
      setSelectedTitleId('');
    }
  }, [selectedSubFunctionId]);

  useEffect(() => {
    if (selectedFunctionId || selectedSubFunctionId || selectedTitleId) {
      fetchData();
    } else {
      // Reset data when no filters are selected
      setLoading(false);
      setActiveEmployees({ count: 0, region: 'All Regions' });
      setModuleAssignments([]);
      setKpiMappings([]);
    }
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
        setSelectedFunctionId(''); // Start with "All" selected
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
        setSelectedSubFunctionId(''); // Start with "All" selected
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
        setSelectedTitleId(''); // Start with "All" selected
      } else {
        setTitles([]);
        setSelectedTitleId('');
      }
    } catch (error) {
      console.error('Error loading titles:', error);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        fetchActiveEmployees(),
        fetchModuleAssignments(),
        fetchKPIMappings()
      ]);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchActiveEmployees = async () => {
    try {
      const users = await fetchUsersByFilter({
        functionId: selectedFunctionId || undefined,
        subFunctionId: selectedSubFunctionId || undefined,
        titleId: selectedTitleId || undefined
      });
      setActiveEmployees({
        count: users.length,
        region: 'All Regions'
      });
    } catch (error) {
      console.error('Error fetching active employees:', error);
    }
  };

  const fetchModuleAssignments = async () => {
    try {
      const users = await fetchUsersByFilter({
        functionId: selectedFunctionId || undefined,
        subFunctionId: selectedSubFunctionId || undefined,
        titleId: selectedTitleId || undefined
      });
      console.log(users);
      const userIds = users.map((u: any) => u.user_id);

      if (userIds.length === 0) {
        setModuleAssignments([]);
        return;
      }

      // Fetch learning plans via backend API (filter by IN_PROGRESS status on frontend)
      const lpRes = await fetch(
        `${API_BASE}/api/learning-plans/?limit=1000`,
        { headers: { 'X-User-ID': currentUserId } }
      );

      if (!lpRes.ok) {
        console.error('[workforce-overview] Error fetching learning plans');
        setModuleAssignments([]);
        return;
      }

      const lpData = await lpRes.json();
      const allPlans = lpData?.plans || [];
      
      // Filter to only users in userIds and status ASSIGNED or IN_PROGRESS
      const learningPlans = allPlans.filter((lp: any) =>
        userIds.includes(lp.user_id) &&
        ['ASSIGNED', 'IN_PROGRESS'].includes(lp.status)
      );

      if (!learningPlans || learningPlans.length === 0) {
        setModuleAssignments([]);
        return;
      }

      const moduleIds = [...new Set(learningPlans.map(lp => lp.module_id))];
      
      // Fetch modules from backend API
      let modules: any[] = [];
      if (userData?.company_id && moduleIds.length > 0) {
        const res = await fetch(`${API_BASE}/api/training-modules/company/${userData.company_id}`, {
          headers: {
            'X-User-ID': currentUserId
          }
        });

        if (res.ok) {
          const payload = await res.json();
          const allModules = parseArrayFromPayload(payload);
          modules = allModules.filter((m: any) => moduleIds.includes(m.module_id));
        }
      }

      const moduleCounts = learningPlans.reduce((acc: any, lp) => {
        const moduleId = lp.module_id;
        acc[moduleId] = (acc[moduleId] || 0) + 1;
        return acc;
      }, {});

      const colors = ['#818CF8', '#C084FC', '#60A5FA', '#34D399', '#FBBF24'];
      const assignments = Object.entries(moduleCounts)
        .map(([moduleId, count], idx) => {
          const module = modules?.find(m => m.module_id === moduleId);
          return {
            module_name: module?.title || 'Unknown Module',
            count: count as number,
            color: colors[idx % colors.length]
          };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);

      setModuleAssignments(assignments);
    } catch (error) {
      console.error('Error fetching module assignments:', error);
    }
  };

  const fetchKPIMappings = async () => {
    try {
      let kpiQuery = supabase
        .from('kpis')
        .select('kpi_id, name, description, target, datatype');

      // Only apply filters if they are selected (not empty string)
      if (selectedTitleId) {
        kpiQuery = kpiQuery.eq('title_id', selectedTitleId);
      } else if (selectedSubFunctionId) {
        kpiQuery = kpiQuery.eq('sub_function_id', selectedSubFunctionId);
      } else if (selectedFunctionId) {
        kpiQuery = kpiQuery.eq('function_id', selectedFunctionId);
      }
      // If all are empty, query returns all KPIs

      const { data: kpis } = await kpiQuery.limit(10);

      if (!kpis || kpis.length === 0) {
        setKpiMappings([]);
        return;
      }

      // Fetch modules from backend API
      let modules: any[] = [];
      if (userData?.company_id) {
        const res = await fetch(`${API_BASE}/api/training-modules/company/${userData.company_id}`, {
          headers: {
            'X-User-ID': currentUserId
          }
        });

        if (res.ok) {
          const payload = await res.json();
          modules = parseArrayFromPayload(payload).slice(0,20);
        }
      }

      const mappings: KPIMapping[] = kpis.map(kpi => {
        const relatedModules = (modules || [])
          .slice(0, 3)
          .map(module => ({
            name: module.title || 'Untitled Module',
            type: (module.content_type === 'pdf' ? 'SOP' : 
                   module.content_type === 'video' ? 'VIDEO' : 
                   'SIMULATION') as 'SOP' | 'VIDEO' | 'SIMULATION',
            correlation: 'High' as 'High' | 'Medium' | 'Low',
            icon: module.content_type === 'pdf' ? FileText :
                  module.content_type === 'video' ? PlayCircle :
                  Smartphone
          }));

        const targetValue = kpi.target ? `Target: ${kpi.target}${kpi.datatype === 'percentage' ? '%' : ''}` : 'No target set';

        // Parse description to separate definition and formula
        let definition = kpi.description || 'Performance gap in this metric triggers the associated modules on the right.';
        let formula = '';

        if (definition.includes('Formula:')) {
          const parts = definition.split('Formula:');
          definition = parts[0].trim();
          formula = parts[1].trim();
        }

        return {
          kpi_name: kpi.name,
          target: targetValue,
          description: definition,
          formula: formula,
          modules: relatedModules
        };
      });

      setKpiMappings(mappings);
    } catch (error) {
      console.error('Error fetching KPI mappings:', error);
    }
  };

  const getModuleTypeStyles = (type: string) => {
    switch (type) {
      case 'SOP':
        return 'bg-purple-500/10 text-purple-400 border-purple-500/20';
      case 'VIDEO':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/20';
      case 'SIMULATION':
        return 'bg-teal-500/10 text-teal-400 border-teal-500/20';
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/20';
    }
  };

  const getTotalAssignments = () => moduleAssignments.reduce((sum, m) => sum + m.count, 0);
  const maxCount = moduleAssignments.length > 0 ? Math.max(...moduleAssignments.map(m => m.count)) : 1;

  if (loading) {
    return (
      showLoadingProgress
        ? <LoadingProgress label="Loading workforce overview..." progress={loadingProgress} />
        : <div className="min-h-screen flex items-center justify-center bg-gray-50"><div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600" /></div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
      <main className="p-6 space-y-6">
        {/* Header Card */}
        <div className="bg-white rounded-xl shadow-sm p-8 border border-slate-200">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-800 mb-2">Workforce Overview</h1>
              <p className="text-slate-600">Monitor workforce capabilities and sprint allocation across your organization</p>
            </div>
            
            <Button className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6">
              <Filter size={16} className="mr-2" />
              Export Report
            </Button>
          </div>
        </div>

        {/* Role Analysis Section */}
        <Card className="bg-white border-gray-200 shadow-sm p-6">
          {/* <div className="flex items-center gap-2 mb-6">
            <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
            <h2 className="text-sm font-bold text-blue-600 uppercase tracking-wider">Role Analysis</h2>
          </div> */}

          <h3 className="text-2xl font-bold text-gray-900 mb-4">Learning Overview</h3>
          {/* <p className="text-gray-600 text-sm mb-6">Map business KPIs directly to learning modules by role.</p> */}

          {/* Filters */}
          <div className="flex items-center gap-4 mb-8">
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

          {/* Content Grid */}
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-gray-500">Retrieving information…</div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-6">
              {/* Module Assignments Distribution */}
              <Card className="bg-gray-50 border-gray-200 shadow-sm p-6">
                <div className="flex items-center justify-between mb-6">
                  <div className="flex items-center gap-2">
                    <BarChart3 size={20} className="text-blue-600" />
                    <h3 className="text-lg font-bold text-gray-900">Sprints Distribution</h3>
                  </div>
                </div>

                {/* Bar Chart */}
                {moduleAssignments.length > 0 ? (
                  <div className="space-y-4 mb-6">
                    {moduleAssignments.map((module, idx) => (
                      <div key={idx}>
                        <div className="flex items-center justify-between text-sm mb-2">
                          <span className="text-gray-700 font-medium truncate">{module.module_name}</span>
                          <span className="text-gray-900 font-bold">{module.count}</span>
                        </div>
                        <div className="relative h-8 bg-gray-200 rounded-lg overflow-hidden">
                          <div 
                            className="absolute inset-y-0 left-0 rounded-lg transition-all duration-500"
                            style={{ 
                              width: `${(module.count / maxCount) * 100}%`,
                              background: `linear-gradient(90deg, ${module.color}80, ${module.color})`
                            }}
                          />
                          <div className="absolute inset-0 flex items-center justify-end px-3">
                            <span className="text-xs font-bold text-gray-900">{Math.round((module.count / getTotalAssignments()) * 100)}%</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">No Sprint assignments found</div>
                )}

                {/* Legend */}
                {/* {moduleAssignments.length > 0 && (
                  <div className="flex items-center justify-between pt-4 border-t border-gray-300">
                    {maxCount <= 4 ? (
                      // For small counts, show integer steps
                      Array.from({ length: maxCount + 1 }, (_, i) => (
                        <div key={i} className="text-xs text-gray-500">{i}</div>
                      ))
                    ) : (
                      // For larger counts, show 5 evenly spaced points
                      <>
                        <div className="text-xs text-gray-500">0</div>
                        <div className="text-xs text-gray-500">{Math.ceil(maxCount * 0.25)}</div>
                        <div className="text-xs text-gray-500">{Math.ceil(maxCount * 0.5)}</div>
                        <div className="text-xs text-gray-500">{Math.ceil(maxCount * 0.75)}</div>
                        <div className="text-xs text-gray-500">{maxCount}</div>
                      </>
                    )}
                  </div>
                )} */}
              </Card>

              {/* Active Employees */}
              <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200 shadow-sm p-6 flex flex-col items-center justify-center">
                <div className="w-24 h-24 rounded-full bg-white/80 shadow-lg flex items-center justify-center mb-6 relative">
                  <Users size={40} className="text-blue-600" />
                  <div className="absolute inset-0 rounded-full border-4 border-blue-400/30 animate-pulse"></div>
                </div>
                
                <div className="text-center">
                  <div className="text-6xl font-bold text-gray-900 mb-2">{activeEmployees.count}</div>
                  <div className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-1">Active Employees</div>
                  <div className="text-xs text-blue-600 font-medium">{activeEmployees.region}</div>
                </div>
              </Card>
            </div>
          )}
        </Card>

        {/* KPI to Learning Module Mapping */}
        <Card className="bg-white border-gray-200 shadow-sm p-6">
          <div className="flex items-center gap-2 mb-6">
            <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center">
              <Target size={18} className="text-blue-600" />
            </div>
            <h3 className="text-lg font-bold text-gray-900">KPI to Learning Sprint Mapping</h3>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-gray-500">Retrieving KPI mappings...</div>
            </div>
          ) : kpiMappings.length === 0 ? (
            <div className="text-center py-12 text-gray-500">No KPIs found for this role</div>
          ) : (
            <div className="space-y-6">
              {/* Header Row */}
              <div className="grid grid-cols-2 gap-6">
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                  Key Performance Indicator (KPI)
                </div>
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                  Mapped Learning Modules
                </div>
              </div>

              {/* KPI Mappings - Each KPI with its modules in a row */}
              {kpiMappings.map((kpi, idx) => (
                <div key={idx} className="grid grid-cols-2 gap-6">
                  {/* Business KPI Card */}
                  <Card className="bg-gray-50 border-gray-200 shadow-sm p-6">
                    <h4 className="text-lg font-bold text-gray-900 mb-2">{kpi.kpi_name}</h4>
                    <div className="flex items-center gap-2 mb-3">
                      <div className="w-2 h-2 rounded-full bg-gray-400"></div>
                      <span className="text-sm text-gray-600">{kpi.target}</span>
                    </div>
                    <p className="text-xs text-gray-500 leading-relaxed">{kpi.description}</p>
                    {kpi.formula && (
                      <p className="text-xs text-gray-500 leading-relaxed mt-2">
                        <strong>Formula:</strong> {kpi.formula}
                      </p>
                    )}
                  </Card>

                  {/* Mapped Modules for this KPI */}
                  <div className="space-y-3">
                    {kpi.modules.length > 0 ? (
                      kpi.modules.map((module, moduleIdx) => (
                        <Card key={moduleIdx} className="bg-white border-gray-200 shadow-sm p-4 hover:border-blue-300 hover:shadow transition-all">
                          <div className="flex items-center gap-3">
                            <div className={`w-10 h-10 rounded-lg ${getModuleTypeStyles(module.type).split(' ')[0]} flex items-center justify-center shrink-0`}>
                              <module.icon size={20} className={getModuleTypeStyles(module.type).split(' ')[1]} />
                            </div>
                            <div className="flex-1 min-w-0">
                              <h5 className="text-sm font-semibold text-gray-900 mb-1 truncate">{module.name}</h5>
                              <div className="flex items-center gap-2">
                                <span className={`px-2 py-1 rounded text-xs font-bold border ${getModuleTypeStyles(module.type)}`}>
                                  {module.type}
                                </span>
                                <span className="flex items-center gap-1 text-xs text-green-600 font-medium">
                                  Correlation: {module.correlation}
                                  <TrendingUp size={12} />
                                </span>
                              </div>
                            </div>
                          </div>
                        </Card>
                      ))
                    ) : (
                      <div className="text-sm text-gray-500 italic p-4">No modules mapped yet</div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
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
        <p className="text-xs text-slate-500 font-medium">Preparing workforce overview. This may take a moment.</p>
      </div>
    </div>
  );
}
