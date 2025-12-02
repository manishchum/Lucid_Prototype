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
import { BarChart3, TrendingUp, CheckCircle, User, BookOpen, AlertCircle, Target, Brain, FileText, Clock, Award } from "lucide-react";
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

// Enhanced Progress Analytics Component with real database schema and charts
function ProgressAnalytics({ companyId }: { companyId: string }) {
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

  useEffect(() => {
    if (companyId) {
      loadAnalyticsData();
    }
  }, [companyId, selectedModule, selectedTimeRange, selectedAssessmentType]);

  const loadAnalyticsData = async () => {
    setLoading(true);
    try {
      await Promise.all([
        loadModules(),
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

  const loadModules = async () => {
    const { data: moduleData } = await supabase
      .from('training_modules')
      .select('module_id, title, processing_status, created_at')
      .eq('company_id', companyId)
      .order('title');
    
    setModules(moduleData || []);
  };

  const loadLearningPlanData = async () => {
    let query = supabase
      .from('learning_plan')
      .select(`
        learning_plan_id,
        status,
        assigned_on,
        started_at,
        completed_at,
        due_date,
        baseline_assessment,
        users!inner(user_id, name, email, department_id, employment_status),
        training_modules!inner(title, module_id, processing_status)
      `)
      .eq('users.company_id', companyId);

    // Apply module filter
    if (selectedModule !== 'all') {
      query = query.eq('module_id', selectedModule);
    }

    // Apply time range filter
    if (selectedTimeRange !== 'all') {
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - parseInt(selectedTimeRange));
      query = query.gte('assigned_on', daysAgo.toISOString());
    }

    const { data: progressResults, error } = await query.order('assigned_on', { ascending: false });

    if (error) throw error;

    setProgressData(progressResults || []);
    calculateModuleStatistics(progressResults || []);
  };

  const loadAssessmentData = async () => {
    let assessmentQuery = supabase
      .from('employee_assessments')
      .select(`
        employee_assessment_id,
        score,
        max_score,
        completed_at,
        answers,
        feedback,
        user_id,
        users!inner(name, email, company_id),
        assessments!inner(
          assessment_id,
          type,
          created_at,
          company_id,
          learning_style,
          processed_module_id,
          processed_modules!inner(
            title,
            learning_style,
            original_module_id,
            training_modules!inner(title)
          )
        )
      `)
      .eq('users.company_id', companyId);

    // Apply assessment type filter
    if (selectedAssessmentType !== 'all') {
      assessmentQuery = assessmentQuery.eq('assessments.type', selectedAssessmentType);
    }

    // Apply time range filter
    if (selectedTimeRange !== 'all') {
      const daysAgo = new Date();
      daysAgo.setDate(daysAgo.getDate() - parseInt(selectedTimeRange));
      assessmentQuery = assessmentQuery.gte('completed_at', daysAgo.toISOString());
    }

    const { data: assessmentResults, error: assessmentError } = await assessmentQuery
      .order('completed_at', { ascending: false });

    if (assessmentError) throw assessmentError;

    calculateAssessmentStatistics(assessmentResults || []);
  };

  const loadLearningStyleData = async () => {
    const { data: learningStyleResults, error } = await supabase
      .from('employee_learning_style')
      .select(`
        user_id,
        learning_style,
        gemini_analysis,
        created_at,
        updated_at,
        users!inner(name, email, company_id, department_id)
      `)
      .eq('users.company_id', companyId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    calculateLearningStyleStatistics(learningStyleResults || []);
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
    // Get total employees
    const { data: employeeData } = await supabase
      .from('users')
      .select('user_id, employment_status')
      .eq('company_id', companyId);

    const totalEmployees = employeeData?.length || 0;
    const activeEmployees = employeeData?.filter(emp => emp.employment_status === 'ACTIVE').length || 0;

    // Get total modules
    const { data: moduleData } = await supabase
      .from('training_modules')
      .select('module_id')
      .eq('company_id', companyId);

    const totalModules = moduleData?.length || 0;

    // Get assessment completion data
    const { data: assessmentData } = await supabase
      .from('employee_assessments')
      .select(`
        score,
        max_score,
        users!inner(company_id)
      `)
      .eq('users.company_id', companyId);

    const totalAssessments = assessmentData?.length || 0;
    const completedAssessments = assessmentData?.filter(assessment => assessment.score !== null).length || 0;
    const averageAssessmentScore = assessmentData && assessmentData.length > 0
      ? Math.round(assessmentData
          .filter(assessment => assessment.score !== null && assessment.max_score > 0)
          .reduce((sum, assessment) => sum + (assessment.score / assessment.max_score * 100), 0) / 
          assessmentData.filter(assessment => assessment.score !== null && assessment.max_score > 0).length)
      : 0;

    // Get KPI average score
    const { data: kpiData } = await supabase
      .from('employee_kpi')
      .select('score')
      .eq('company_id', companyId);

    const averageKpiScore = kpiData && kpiData.length > 0
      ? Math.round(kpiData.reduce((sum, kpi) => sum + Number(kpi.score), 0) / kpiData.length)
      : 0;

    // Get learning style completion count
    const { data: learningStyleData } = await supabase
      .from('employee_learning_style')
      .select(`
        user_id,
        users!inner(company_id)
      `)
      .eq('users.company_id', companyId);

    const learningStylesCompleted = learningStyleData?.length || 0;

    setOverallStats(prevStats => ({
      ...prevStats,
      totalEmployees,
      activeEmployees,
      totalModules,
      totalAssessments,
      completedAssessments,
      averageAssessmentScore,
      averageKpiScore,
      learningStylesCompleted
    }));
  };

  const calculateModuleStatistics = (data: any[]) => {
    const moduleMap = new Map();

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
          processingStatus: item.training_modules.processing_status
        });
      }

      const moduleStats = moduleMap.get(moduleId);
      moduleStats.totalAssigned++;

      if (item.baseline_assessment === 1) {
        moduleStats.baselineRequired++;
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
      baselineCompletionRate: stats.baselineRequired > 0 ? Math.round((stats.baselineRequired / stats.totalAssigned) * 100) : 0
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
        const scorePercent = (item.score / item.max_score) * 100;
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
    const styleMap = new Map();
    const departmentMap = new Map();

    data.forEach(item => {
      // Learning style distribution
      const style = item.learning_style || 'Unknown';
      styleMap.set(style, (styleMap.get(style) || 0) + 1);

      // Department breakdown
      const deptId = item.users.department_id || 'unassigned';
      if (!departmentMap.has(deptId)) {
        departmentMap.set(deptId, { total: 0, styles: new Map() });
      }
      const deptStats = departmentMap.get(deptId);
      deptStats.total++;
      deptStats.styles.set(style, (deptStats.styles.get(style) || 0) + 1);
    });

    const learningStyleStatsArray = Array.from(styleMap.entries()).map(([style, count]) => ({
      style,
      count,
      percentage: Math.round((count / data.length) * 100)
    }));

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
      {/* Filters */}
      <div className="flex flex-wrap gap-4 p-4 bg-gray-50 rounded-lg">
        <div className="flex-1 min-w-48">
          <Label htmlFor="moduleFilter">Filter by Module</Label>
          <select
            id="moduleFilter"
            value={selectedModule}
            onChange={(e) => setSelectedModule(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="all">All Modules</option>
            {modules.map(module => (
              <option key={module.module_id} value={module.module_id}>
                {module.title}
              </option>
            ))}
          </select>
        </div>
        
        <div className="flex-1 min-w-48">
          <Label htmlFor="assessmentFilter">Assessment Type</Label>
          <select
            id="assessmentFilter"
            value={selectedAssessmentType}
            onChange={(e) => setSelectedAssessmentType(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="all">All Assessment Types</option>
            <option value="baseline">Baseline Assessments</option>
            <option value="module">Module Assessments</option>
          </select>
        </div>
        
        <div className="flex-1 min-w-48">
          <Label htmlFor="timeFilter">Time Range</Label>
          <select
            id="timeFilter"
            value={selectedTimeRange}
            onChange={(e) => setSelectedTimeRange(e.target.value)}
            className="w-full p-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="7">Last 7 days</option>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last year</option>
            <option value="all">All time</option>
          </select>
        </div>
      </div>

      {/* Overall Statistics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Total Employees</p>
                <p className="text-2xl font-bold text-gray-900">{overallStats.totalEmployees}</p>
                <p className="text-xs text-gray-500">Active: {overallStats.activeEmployees}</p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center">
                <User className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Training Modules</p>
                <p className="text-2xl font-bold text-green-600">{overallStats.totalModules}</p>
                <p className="text-xs text-gray-500">Assignments: {overallStats.totalAssignments}</p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                <BookOpen className="w-6 h-6 text-green-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Assessment Score</p>
                <p className="text-2xl font-bold text-purple-600">{overallStats.averageAssessmentScore}%</p>
                <p className="text-xs text-gray-500">Completed: {overallStats.completedAssessments}</p>
              </div>
              <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center">
                <Award className="w-6 h-6 text-purple-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-600">Learning Styles</p>
                <p className="text-2xl font-bold text-orange-600">{overallStats.learningStylesCompleted}</p>
                <p className="text-xs text-gray-500">KPI Avg: {overallStats.averageKpiScore}</p>
              </div>
              <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center">
                <Brain className="w-6 h-6 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1 - Completion Overview */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Overall Completion Status Doughnut Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <CheckCircle className="w-5 h-5 mr-2" />
              Overall Assignment Status
            </CardTitle>
            <CardDescription>Distribution of assignment statuses across all modules</CardDescription>
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

        {/* Learning Style Distribution Pie Chart */}
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
      </div>

      {/* Charts Row 2 - Performance Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Module Completion Rates Bar Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <BarChart3 className="w-5 h-5 mr-2" />
              Module Completion Rates
            </CardTitle>
            <CardDescription>Completion percentage for each training module</CardDescription>
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

        {/* Assessment Performance Bar Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Award className="w-5 h-5 mr-2" />
              Assessment Performance
            </CardTitle>
            <CardDescription>Average scores across different assessment types</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <Bar
                data={{
                  labels: assessmentStats.map(assessment => 
                    `${assessment.type.charAt(0).toUpperCase() + assessment.type.slice(1)}\n${
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
      </div>

      {/* Charts Row 3 - KPI Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* KPI Benchmark Achievement */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <Target className="w-5 h-5 mr-2" />
              KPI Benchmark Achievement
            </CardTitle>
            <CardDescription>Performance against benchmarks for each KPI</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <Bar
                data={{
                  labels: kpiStats.map(kpi => 
                    kpi.kpiName.length > 15 ? kpi.kpiName.substring(0, 15) + '...' : kpi.kpiName
                  ),
                  datasets: [
                    {
                      label: 'Achievement Rate (%)',
                      data: kpiStats.map(kpi => kpi.benchmarkAchievementRate || 0),
                      backgroundColor: kpiStats.map(kpi => {
                        const rate = kpi.benchmarkAchievementRate || 0;
                        if (rate >= 80) return 'rgba(34, 197, 94, 0.8)'; // green
                        if (rate >= 60) return 'rgba(251, 191, 36, 0.8)'; // yellow
                        return 'rgba(239, 68, 68, 0.8)'; // red
                      }),
                      borderColor: kpiStats.map(kpi => {
                        const rate = kpi.benchmarkAchievementRate || 0;
                        if (rate >= 80) return 'rgb(34, 197, 94)';
                        if (rate >= 60) return 'rgb(251, 191, 36)';
                        return 'rgb(239, 68, 68)';
                      }),
                      borderWidth: 1,
                    }
                  ]
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
                          return kpiStats[index]?.kpiName || '';
                        },
                        label: function(context) {
                          const index = context.dataIndex;
                          const kpi = kpiStats[index];
                          return [
                            `Achievement Rate: ${context.parsed.y}%`,
                            `Above Benchmark: ${kpi.aboveBenchmark}`,
                            `Below Benchmark: ${kpi.belowBenchmark}`,
                            `Average Score: ${kpi.averageScore}`,
                            `Benchmark: ${kpi.benchmark || 'N/A'}`
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

        {/* Module Progress Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center">
              <BookOpen className="w-5 h-5 mr-2" />
              Training Progress Distribution
            </CardTitle>
            <CardDescription>Current status distribution across all modules</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-80">
              <Doughnut
                data={{
                  labels: moduleStats.map(module => 
                    module.title.length > 20 ? module.title.substring(0, 20) + '...' : module.title
                  ),
                  datasets: [{
                    label: 'Completion Rate',
                    data: moduleStats.map(module => module.completionRate),
                    backgroundColor: [
                      'rgba(239, 68, 68, 0.8)',
                      'rgba(34, 197, 94, 0.8)',
                      'rgba(59, 130, 246, 0.8)',
                      'rgba(168, 85, 247, 0.8)',
                      'rgba(245, 158, 11, 0.8)',
                      'rgba(236, 72, 153, 0.8)',
                      'rgba(14, 165, 233, 0.8)',
                      'rgba(249, 115, 22, 0.8)',
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
                          size: 10
                        }
                      }
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
                            `Completion Rate: ${context.parsed}%`,
                            `Completed: ${module.completed}`,
                            `In Progress: ${module.inProgress}`,
                            `Not Started: ${module.notStarted}`,
                            `Total Assigned: ${module.totalAssigned}`
                          ];
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

      {/* Learning Style Distribution */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <Brain className="w-5 h-5 mr-2" />
            Learning Style Distribution
          </CardTitle>
          <CardDescription>Distribution of learning styles among employees</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {learningStyleStats.map((style, index) => (
              <div key={index} className="bg-gradient-to-r from-blue-50 to-purple-50 p-4 rounded-lg border">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium text-gray-900">{style.style}</h3>
                  <Badge variant="outline">{style.percentage}%</Badge>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div 
                    className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full" 
                    style={{ width: `${style.percentage}%` }}
                  ></div>
                </div>
                <p className="text-sm text-gray-600 mt-1">{style.count} employees</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Assessment Performance */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <FileText className="w-5 h-5 mr-2" />
            Assessment Performance
          </CardTitle>
          <CardDescription>Performance metrics for baseline and module assessments</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left p-3 font-medium text-gray-700">Assessment Type</th>
                  <th className="text-left p-3 font-medium text-gray-700">Module</th>
                  <th className="text-center p-3 font-medium text-gray-700">Total Attempts</th>
                  <th className="text-center p-3 font-medium text-gray-700">Completed</th>
                  <th className="text-center p-3 font-medium text-gray-700">Completion Rate</th>
                  <th className="text-center p-3 font-medium text-gray-700">Average Score</th>
                  <th className="text-center p-3 font-medium text-gray-700">Learning Style</th>
                </tr>
              </thead>
              <tbody>
                {assessmentStats.map((assessment, index) => (
                  <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="p-3">
                      <Badge className={assessment.type === 'baseline' ? 'bg-blue-100 text-blue-800' : 'bg-green-100 text-green-800'}>
                        {assessment.type.charAt(0).toUpperCase() + assessment.type.slice(1)}
                      </Badge>
                    </td>
                    <td className="p-3">
                      <div className="font-medium text-gray-900">{assessment.moduleTitle}</div>
                    </td>
                    <td className="text-center p-3">{assessment.totalAttempts}</td>
                    <td className="text-center p-3">
                      <span className="text-green-600 font-medium">{assessment.completed}</span>
                    </td>
                    <td className="text-center p-3">
                      <div className="flex items-center justify-center">
                        <div className="w-16 bg-gray-200 rounded-full h-2 mr-2">
                          <div 
                            className="bg-green-600 h-2 rounded-full" 
                            style={{ width: `${assessment.completionRate}%` }}
                          ></div>
                        </div>
                        <span className="text-sm font-medium">{assessment.completionRate}%</span>
                      </div>
                    </td>
                    <td className="text-center p-3">
                      <span className={`font-medium ${
                        assessment.averageScore >= 80 ? 'text-green-600' : 
                        assessment.averageScore >= 60 ? 'text-yellow-600' : 'text-red-600'
                      }`}>
                        {assessment.averageScore}%
                      </span>
                    </td>
                    <td className="text-center p-3">
                      {assessment.learningStyle ? (
                        <Badge variant="outline">{assessment.learningStyle}</Badge>
                      ) : (
                        <span className="text-gray-400">N/A</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* KPI Performance */}
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
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left p-3 font-medium text-gray-700">KPI Name</th>
                  <th className="text-center p-3 font-medium text-gray-700">Total Scores</th>
                  <th className="text-center p-3 font-medium text-gray-700">Average Score</th>
                  <th className="text-center p-3 font-medium text-gray-700">Benchmark</th>
                  <th className="text-center p-3 font-medium text-gray-700">Above Benchmark</th>
                  <th className="text-center p-3 font-medium text-gray-700">Achievement Rate</th>
                </tr>
              </thead>
              <tbody>
                {kpiStats.map((kpi, index) => (
                  <tr key={index} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="p-3">
                      <div className="font-medium text-gray-900">{kpi.kpiName}</div>
                    </td>
                    <td className="text-center p-3">{kpi.totalScores}</td>
                    <td className="text-center p-3">
                      <span className="font-medium text-blue-600">{kpi.averageScore}</span>
                    </td>
                    <td className="text-center p-3">
                      {kpi.benchmark ? (
                        <Badge variant="outline">{kpi.benchmark}</Badge>
                      ) : (
                        <span className="text-gray-400">N/A</span>
                      )}
                    </td>
                    <td className="text-center p-3">
                      <span className="text-green-600 font-medium">{kpi.aboveBenchmark}</span>
                      <span className="text-gray-400"> / {kpi.belowBenchmark}</span>
                    </td>
                    <td className="text-center p-3">
                      {kpi.benchmarkAchievementRate !== null ? (
                        <div className="flex items-center justify-center">
                          <div className="w-16 bg-gray-200 rounded-full h-2 mr-2">
                            <div 
                              className={`h-2 rounded-full ${
                                kpi.benchmarkAchievementRate >= 80 ? 'bg-green-600' : 
                                kpi.benchmarkAchievementRate >= 60 ? 'bg-yellow-600' : 'bg-red-600'
                              }`}
                              style={{ width: `${kpi.benchmarkAchievementRate}%` }}
                            ></div>
                          </div>
                          <span className="text-sm font-medium">{kpi.benchmarkAchievementRate}%</span>
                        </div>
                      ) : (
                        <span className="text-gray-400">N/A</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Module Performance Overview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center">
            <BarChart3 className="w-5 h-5 mr-2" />
            Module Performance Overview
          </CardTitle>
          <CardDescription>Statistics for each training module including baseline assessments</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left p-3 font-medium text-gray-700">Module</th>
                  <th className="text-center p-3 font-medium text-gray-700">Status</th>
                  <th className="text-center p-3 font-medium text-gray-700">Total Assigned</th>
                  <th className="text-center p-3 font-medium text-gray-700">Completed</th>
                  <th className="text-center p-3 font-medium text-gray-700">In Progress</th>
                  <th className="text-center p-3 font-medium text-gray-700">Not Started</th>
                  <th className="text-center p-3 font-medium text-gray-700">Completion Rate</th>
                  <th className="text-center p-3 font-medium text-gray-700">Baseline Required</th>
                  <th className="text-center p-3 font-medium text-gray-700">Avg Completion Time</th>
                </tr>
              </thead>
              <tbody>
                {moduleStats.map((module, index) => (
                  <tr key={module.moduleId} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                    <td className="p-3">
                      <div className="font-medium text-gray-900">{module.title}</div>
                    </td>
                    <td className="text-center p-3">
                      <Badge className={
                        module.processingStatus === 'completed' ? 'bg-green-100 text-green-800' :
                        module.processingStatus === 'processing' ? 'bg-blue-100 text-blue-800' :
                        'bg-yellow-100 text-yellow-800'
                      }>
                        {module.processingStatus}
                      </Badge>
                    </td>
                    <td className="text-center p-3">{module.totalAssigned}</td>
                    <td className="text-center p-3">
                      <span className="text-green-600 font-medium">{module.completed}</span>
                    </td>
                    <td className="text-center p-3">
                      <span className="text-blue-600 font-medium">{module.inProgress}</span>
                    </td>
                    <td className="text-center p-3">
                      <span className="text-yellow-600 font-medium">{module.notStarted}</span>
                    </td>
                    <td className="text-center p-3">
                      <div className="flex items-center justify-center">
                        <div className="w-16 bg-gray-200 rounded-full h-2 mr-2">
                          <div 
                            className="bg-green-600 h-2 rounded-full" 
                            style={{ width: `${module.completionRate}%` }}
                          ></div>
                        </div>
                        <span className="text-sm font-medium">{module.completionRate}%</span>
                      </div>
                    </td>
                    <td className="text-center p-3">
                      <span className="text-purple-600 font-medium">{module.baselineRequired}</span>
                      <span className="text-gray-400 text-xs"> ({module.baselineCompletionRate}%)</span>
                    </td>
                    <td className="text-center p-3">
                      {module.averageCompletionTime > 0 ? `${module.averageCompletionTime} days` : 'N/A'}
                    </td>
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
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left p-3 font-medium text-gray-700">Employee</th>
                  <th className="text-left p-3 font-medium text-gray-700">Module</th>
                  <th className="text-center p-3 font-medium text-gray-700">Status</th>
                  <th className="text-center p-3 font-medium text-gray-700">Assigned</th>
                  <th className="text-center p-3 font-medium text-gray-700">Started</th>
                  <th className="text-center p-3 font-medium text-gray-700">Completed</th>
                  <th className="text-center p-3 font-medium text-gray-700">Due Date</th>
                  <th className="text-center p-3 font-medium text-gray-700">Baseline Required</th>
                </tr>
              </thead>
              <tbody>
                {progressData.slice(0, 50).map((item, index) => {
                  const daysOverdue = getDaysOverdue(item.due_date, item.status);

                  return (
                    <tr key={item.learning_plan_id} className={index % 2 === 0 ? 'bg-white' : 'bg-gray-50'}>
                      <td className="p-3">
                        <div>
                          <div className="font-medium text-gray-900">{item.users.name}</div>
                          <div className="text-sm text-gray-500">{item.users.email}</div>
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="font-medium text-gray-700">{item.training_modules.title}</div>
                      </td>
                      <td className="text-center p-3">
                        <div className="flex flex-col items-center gap-1">
                          {getStatusBadge(item.status)}
                          {daysOverdue && (
                            <span className="text-xs text-red-600 flex items-center">
                              <AlertCircle className="w-3 h-3 mr-1" />
                              {daysOverdue} days overdue
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="text-center p-3 text-sm">{formatDate(item.assigned_on)}</td>
                      <td className="text-center p-3 text-sm">{formatDate(item.started_at)}</td>
                      <td className="text-center p-3 text-sm">{formatDate(item.completed_at)}</td>
                      <td className="text-center p-3 text-sm">
                        {item.due_date ? (
                          <span className={daysOverdue ? 'text-red-600 font-medium' : ''}>
                            {formatDate(item.due_date)}
                          </span>
                        ) : 'No due date'}
                      </td>
                      <td className="text-center p-3">
                        {item.baseline_assessment === 1 ? (
                          <Badge variant="outline" className="text-blue-600 border-blue-600">Required</Badge>
                        ) : (
                          <Badge variant="outline" className="text-gray-600 border-gray-600">Not Required</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          
          {progressData.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No progress data found</p>
              <p className="text-sm">Assign modules to employees to see progress tracking</p>
            </div>
          )}

          {progressData.length > 50 && (
            <div className="text-center py-4 text-gray-500 border-t">
              <p className="text-sm">Showing first 50 entries of {progressData.length} total records</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function AnalyticsPage() {
  const { user } = useAuth();
  const [admin, setAdmin] = useState<Admin | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (user?.email) {
      checkAdminAccess();
    }
  }, [user]);

  const checkAdminAccess = async () => {
    if (!user?.email) return;

    try {
      // Get user data from users table
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("user_id, email, name, company_id")
        .eq("email", user.email)
        .eq("is_active", true)
        .single();

      if (userError || !userData) {
        console.error("User not found or inactive:", userError);
        return;
      }

      // Check if user has admin role through user_role_assignments
      const { data: roleData, error: roleError } = await supabase
        .from("user_role_assignments")
        .select(`
          role_id,
          roles!inner(name)
        `)
        .eq("user_id", userData.user_id)
        .eq("is_active", true)
        .eq("scope_type", "COMPANY")

      if (roleError || !roleData || roleData.length === 0) {
        console.error("No active roles found for user:", roleError);
        return;
      }

      // Check if user has Admin role
      const hasAdminRole = roleData.some((assignment: any) => 
        assignment.roles?.name?.toLowerCase() === 'admin' || 
        assignment.roles?.name?.toLowerCase() === 'super_admin'
      );

      if (!hasAdminRole) {
        console.error("User does not have admin role");
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
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        <span className="ml-2 text-gray-600">Loading...</span>
      </div>
    );
  }

  if (!admin) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">Access denied. Admin privileges required.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-200 pb-4">
        <h1 className="text-2xl font-bold text-gray-900">Analytics & Reports</h1>
        <p className="text-gray-600 mt-1">Track employee progress across all training modules with detailed insights and performance metrics</p>
      </div>
      
      <ProgressAnalytics companyId={admin.company_id} />
    </div>
  );
}