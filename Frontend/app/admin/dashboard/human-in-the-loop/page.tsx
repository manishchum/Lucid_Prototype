'use client'

import React, { useState, useEffect } from 'react';
import { supabaseAdmin as supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import { Search, Filter, FileText, Clock, AlertCircle, Upload, UserCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { fetchWithAuth } from '@/lib/fetch-with-auth';
import { CustomPagination } from '@/components/ui/custom-pagination';

interface TrainingModule {
  module_id: string;
  title: string;
  description: string;
  review_stage: string;
  processing_status: string;
  created_at: string;
  company_id: string;
  reviewer_id: string;
  uploaded_by: string;
  user_role?: 'uploader' | 'reviewer' | 'both';
  reviewer_name?: string;
  uploader_name?: string;
  reviewer?: { user_id?: string; name?: string; email?: string } | null;
  uploader?: { user_id?: string; name?: string; email?: string } | null;
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
        <p className="text-xs text-slate-500 font-medium">Preparing modules. This may take a moment.</p>
      </div>
    </div>
  );
}

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

const fetchUserByEmail = async (email: string | null) => {
  if (!email) return null;
  try {
    const res = await fetchWithAuth(`${API_BASE}/api/users/by-email/${encodeURIComponent(email)}`);
    if (!res.ok) return null;
    const payload = await res.json();
    let u = payload?.user ?? payload;
    if (Array.isArray(u)) u = u[0];
    return u || null;
  } catch(e){
    console.error("Error fetching user by email:", e);
    return null;
  }
};

export default function HumanInTheLoopPage() {
  const { user, loading:authLoading, employeeData } = useAuth();
  const router = useRouter();
  const [modules, setModules] = useState<TrainingModule[]>([]);
  const [filteredModules, setFilteredModules] = useState<TrainingModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [reviewFilter, setReviewFilter] = useState('All');
  const [roleFilter, setRoleFilter] = useState('All');
  const [sortBy, setSortBy] = useState('newest');
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [stats, setStats] = useState({
    pending: 0,
    inReview: 0,
    approved: 0,
    rejected: 0,
    asUploader: 0,
    asReviewer: 0
  });

  const { progress: loadingProgress, show: showLoadingProgress } = useIllusionProgress(authLoading || loading);

  useEffect(() => {
    if (user?.email) {
      getCurrentUser();
    }
  }, [user]);

  useEffect(() => {
    if (currentUserId && employeeData?.company_id) {
      fetchModules();
    }
  }, [currentUserId, employeeData?.company_id]);

  useEffect(() => {
    filterModules();
  }, [searchQuery, reviewFilter, roleFilter, modules, sortBy]);
  
  
  useEffect(() => {
      if (!authLoading) {
        if (!user) router.push("/login");
        else getCurrentUser();
        
      }
    }, [user, authLoading, router]);


  const getCurrentUser = async () => {
    try {
      if (!user?.email) return;

      const emp = await fetchUserByEmail(user.email);
      if (emp &&  emp.user_id) {
        setCurrentUserId(emp.user_id);
      } else {
        console.warn("Current user not found in database:", user.email);
      }
    } catch (error) {
      console.error('Error fetching current user:', error);
    }
  };

  const fetchModules = async () => {
    try {
      setLoading(true);
      if (!currentUserId) return;
      const companyId = employeeData?.company_id;
      if (!companyId) return;

      // Fetch ALL modules for the user's company via backend properly scoped by JWT
      const response = await fetchWithAuth(`${API_BASE}/api/training-modules/company/${companyId}`);
      if (!response.ok) throw new Error('Failed to fetch modules');
      
      const parsed = await response.json();
      if (parsed.error) throw new Error(parsed.error);
      
      const allCompanyModules = parsed.modules || [];

      // Filter locally based on currentUserId
      const uploadedModules = allCompanyModules.filter((m: any) => m.uploaded_by === currentUserId);
      const reviewModules = allCompanyModules.filter((m: any) => 
        m.reviewer_id === currentUserId && 
        m.uploaded_by !== currentUserId
      );

      // Build sets for quick lookup
      const uploadedIds = new Set((uploadedModules || []).map((m: any) => m.module_id));
      const reviewIds = new Set((reviewModules || []).map((m: any) => m.module_id));

      // Merge both lists, deduplicate by module_id, and tag with user_role
      const allModules = [...(uploadedModules || []), ...(reviewModules || [])];
      const uniqueModules: TrainingModule[] = [];
      const seen = new Set<string>();

      for (const mod of allModules) {
        if (seen.has(mod.module_id)) continue;
        seen.add(mod.module_id);

        const isUploader = uploadedIds.has(mod.module_id);
        const isReviewer = reviewIds.has(mod.module_id) || (isUploader && mod.reviewer_id === currentUserId);

        let role: 'uploader' | 'reviewer' | 'both' = 'uploader';
        if (isUploader && isReviewer) role = 'both';
        else if (isReviewer) role = 'reviewer';
        else if (isUploader) role = 'uploader';

        const reviewerName = 
          (mod as any).reviewer?.name || 
          (mod as any).reviewer?.email || 
          (mod.reviewer_id === currentUserId ? 'You' : (mod.reviewer_id ? 'Assigned' : 'Not Assigned'));

        const uploaderName = 
          (mod as any).uploader?.name || 
          (mod as any).uploader?.email || 
          (mod.uploaded_by === currentUserId ? 'You' : 'Unknown');

        uniqueModules.push({ 
          ...mod, 
          user_role: role,
          reviewer_name: reviewerName,
          uploader_name: uploaderName
        });
      }

      setModules(uniqueModules);
      calculateStats(uniqueModules);
    } catch (error) {
      console.error('Error fetching modules:', error);
    } finally {
      setLoading(false);
    }
  };

  const calculateStats = (data: TrainingModule[]) => {
    const pending = data.filter(m => m.review_stage === 'pending').length;
    const inReview = data.filter(m => m.review_stage === 'in_review').length;
    const approved = data.filter(m => m.review_stage === 'approved').length;
    const rejected = data.filter(m => m.review_stage === 'rejected').length;
    const asUploader = data.filter(m => m.user_role === 'uploader' || m.user_role === 'both').length;
    const asReviewer = data.filter(m => m.user_role === 'reviewer' || m.user_role === 'both').length;

    setStats({
      pending,
      inReview,
      approved,
      rejected,
      asUploader,
      asReviewer
    });
  };

  const filterModules = () => {
    let filtered = [...modules];

    if (searchQuery) {
      filtered = filtered.filter(m => 
        m.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        m.description?.toLowerCase().includes(searchQuery.toLowerCase())
      );
    }

    if (reviewFilter !== 'All') {
      filtered = filtered.filter(m => m.review_stage === reviewFilter.toLowerCase().replace(' ', '_'));
    }

    if (roleFilter !== 'All') {
      if (roleFilter === 'Uploader') {
        filtered = filtered.filter(m => m.user_role === 'uploader' || m.user_role === 'both');
      } else if (roleFilter === 'Reviewer') {
        filtered = filtered.filter(m => m.user_role === 'reviewer' || m.user_role === 'both');
      }
    }

    if (sortBy === 'newest') {
      filtered.sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
    } else if (sortBy === 'oldest') {
      filtered.sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
    } else if (sortBy === 'name-asc') {
      filtered.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    } else if (sortBy === 'name-desc') {
      filtered.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
    }

    setFilteredModules(filtered);
    setCurrentPage(1);
  };

  const getReviewStageColor = (stage?: string) => {
    switch (stage) {
      case 'approved': return 'text-green-700 bg-green-50';
      case 'in_review': return 'text-blue-700 bg-blue-50';
      case 'rejected': return 'text-red-700 bg-red-50';
      case 'pending': return 'text-gray-700 bg-gray-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const getReviewStageLabel = (stage?: string) => {
    switch (stage) {
      case 'approved': return 'Approved';
      case 'in_review': return 'In Review';
      case 'rejected': return 'Rejected';
      case 'pending': return 'Pending Review';
      default: return 'Unknown';
    }
  };

  const getProcessingStatusColor = (status?: string) => {
    switch (status) {
      case 'completed': return 'text-green-700 bg-green-50';
      case 'processing': return 'text-blue-700 bg-blue-50';
      case 'failed': return 'text-red-700 bg-red-50';
      case 'pending': return 'text-orange-700 bg-orange-50';
      default: return 'text-gray-700 bg-gray-50';
    }
  };

  const getRoleBadge = (role?: 'uploader' | 'reviewer' | 'both') => {
    switch (role) {
      case 'uploader':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
            <Upload size={12} className="mr-1" />
            Uploader
          </span>
        );
      case 'reviewer':
        return (
          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <UserCheck size={12} className="mr-1" />
            Reviewer
          </span>
        );
      case 'both':
        return (
          <div className="flex gap-1">
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
              <Upload size={10} className="mr-0.5" />
              Uploader
            </span>
            <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              <UserCheck size={10} className="mr-0.5" />
              Reviewer
            </span>
          </div>
        );
      default:
        return null;
    }
  };

  // Inject consistent table styles for content rendered with `prose` classes
  useEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-hil-table-styles', 'true');
    style.textContent = `
      .prose table {
        width: 100%;
        border-collapse: collapse;
        border: 2px solid rgb(11,12,12);
        table-layout: fixed;
        word-wrap: break-word;
        border-radius: 0.5rem;
        overflow: hidden;
        box-shadow: 0 1px 2px rgba(0,0,0,0.04);
        margin-bottom: 1.5rem;
      }
      .prose thead th, .prose thead td {
        background-color: #eff6ff;
        border: 1px solid rgb(11,12,12);
        padding: 12px 16px;
        text-align: left;
        font-weight: 600;
        color: #0f172a;
        font-size: 0.875rem;
      }
      .prose tbody td, .prose tbody th {
        border: 1px solid rgb(11,12,12);
        padding: 12px 16px;
        color: #1f2937;
        font-size: 0.875rem;
      }
      .prose tbody tr:nth-child(odd) td { background-color: #ffffff; }
      .prose tbody tr:nth-child(even) td { background-color: #f9fafb; }
      .prose caption { caption-side: top; font-weight: 600; margin-bottom: 0.5rem; color: #1e293b; }
    `;

    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  if (!currentUserId) {
    return (
      <div className="flex min-h-screen bg-[#FAFBFC] items-center justify-center">
          <div className="w-10 h-10 border-4 border-[#3B66F5]/20 border-t-[#3B66F5] rounded-full animate-spin"></div>
      </div>
    );
  }

  const totalPages = Math.ceil(filteredModules.length / itemsPerPage);
  const paginatedModules = filteredModules.slice(
    (currentPage - 1) * itemsPerPage,
    currentPage * itemsPerPage
  );

  return (
    <div className="min-h-screen bg-[#FAFBFC]">
      <main className="p-8">
        <div className="max-w-[2000px] mx-auto">
          {/* Header Card */}
          <div className="bg-white rounded-xl shadow-sm p-8 border border-slate-200 mb-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-2">Content Pipeline Review</h1>
            <p className="text-slate-600">Review and manage AI-generated content you uploaded or are assigned to review.</p>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-1 md:grid-cols-6 gap-6 mb-8">
            <Card className="p-6 bg-white border-slate-100 shadow-sm">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Pending Review</p>
              <p className="text-4xl font-bold text-[#1E293B]">{stats.pending}</p>
            </Card>
            
            <Card className="p-6 bg-white border-slate-100 shadow-sm">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">In Review</p>
              <p className="text-4xl font-bold text-blue-600">{stats.inReview}</p>
            </Card>
            
            <Card className="p-6 bg-white border-slate-100 shadow-sm">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Approved</p>
              <p className="text-4xl font-bold text-green-600">{stats.approved}</p>
            </Card>
            
            <Card className="p-6 bg-white border-slate-100 shadow-sm">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Rejected</p>
              <p className="text-4xl font-bold text-red-600">{stats.rejected}</p>
            </Card>

            <Card className="p-6 bg-white border-slate-100 shadow-sm">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">As Uploader</p>
              <p className="text-4xl font-bold text-purple-600">{stats.asUploader}</p>
            </Card>

            <Card className="p-6 bg-white border-slate-100 shadow-sm">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">As Reviewer</p>
              <p className="text-4xl font-bold text-blue-600">{stats.asReviewer}</p>
            </Card>
          </div>

          {/* Filters */}
          <div className="flex flex-col md:flex-row gap-4 mb-6">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
              <Input
                type="text"
                placeholder="Search modules..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-11 border-slate-200 focus:border-[#3B66F5] focus:ring-[#3B66F5]"
              />
            </div>
            
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <select
                value={reviewFilter}
                onChange={(e) => setReviewFilter(e.target.value)}
                className="pl-10 pr-8 h-11 border border-slate-200 rounded-lg bg-white text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#3B66F5] focus:border-[#3B66F5] appearance-none cursor-pointer"
              >
                <option value="All">Status: All</option>
                <option value="Pending">Pending Review</option>
                <option value="In Review">In Review</option>
                <option value="Approved">Approved</option>
                <option value="Rejected">Rejected</option>
              </select>
            </div>

            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="pl-10 pr-8 h-11 border border-slate-200 rounded-lg bg-white text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#3B66F5] focus:border-[#3B66F5] appearance-none cursor-pointer"
              >
                <option value="All">Role: All</option>
                <option value="Uploader">Uploader</option>
                <option value="Reviewer">Reviewer</option>
              </select>
            </div>
            
            <div className="relative">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="pl-4 pr-8 h-11 border border-slate-200 rounded-lg bg-white text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-[#3B66F5] focus:border-[#3B66F5] appearance-none cursor-pointer"
              >
                <option value="newest">Sort by: Newest</option>
                <option value="oldest">Sort by: Oldest</option>
                <option value="name-asc">Sort by: Name (A-Z)</option>
                <option value="name-desc">Sort by: Name (Z-A)</option>
              </select>
            </div>

            <div className="flex items-center gap-2 text-sm text-slate-500 ml-auto">
              <Clock size={16} />
              <span>Last updated: Just now</span>
            </div>
          </div>

          {/* Responsive Content Layout */}
          <Card className="bg-white border-slate-100 shadow-sm overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center p-12">
                <div className="w-10 h-10 border-4 border-[#3B66F5]/20 border-t-[#3B66F5] rounded-full animate-spin"></div>
              </div>
            ) : (
              <>
                {/* Desktop Table View */}
                <div className="overflow-x-auto hidden md:block">
                  <table className="w-full">
                    <thead className="bg-slate-50 border-b border-slate-100">
                      <tr>
                        <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Module</th>
                        <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Uploaded By</th>
                        <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Reviewer</th>
                        <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Processing Status</th>
                        <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Review Stage</th>
                        <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Created</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredModules.length === 0 ? (
                        <tr>
                          <td colSpan={6} className="px-6 py-12 text-center">
                            <AlertCircle className="mx-auto mb-3 text-slate-300" size={48} />
                            <p className="text-slate-500 font-medium mb-1">No modules found</p>
                            <p className="text-sm text-slate-400">Modules you uploaded or are assigned to review will appear here</p>
                          </td>
                        </tr>
                      ) : (
                        paginatedModules.map((module) => (
                          <tr
                            key={module.module_id}
                            className="hover:bg-slate-50 transition-colors cursor-pointer"
                            onClick={() => router.push(`/admin/dashboard/human-in-the-loop/edit/${module.module_id}`)}
                          >
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-3">
                                <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center shrink-0">
                                  <FileText size={20} className="text-slate-500" />
                                </div>
                                <div>
                                  <p className="font-semibold text-[#1E293B]">{module.title}</p>
                                  <p className="text-sm text-slate-500">{module.description || 'No description'}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center">
                                  <Upload size={14} className="text-purple-600" />
                                </div>
                                <span className="text-sm font-medium text-slate-700">{module.uploader_name}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
                                  <UserCheck size={14} className="text-blue-600" />
                                </div>
                                <span className="text-sm font-medium text-slate-700">{module.reviewer_name}</span>
                              </div>
                            </td>
                            <td className="px-6 py-4">
                              <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${getProcessingStatusColor(module.processing_status)}`}>
                                {module.processing_status || 'Unknown'}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${getReviewStageColor(module.review_stage)}`}>
                                {getReviewStageLabel(module.review_stage)}
                              </span>
                            </td>
                            <td className="px-6 py-4">
                              <span className="text-sm text-slate-700">
                                {new Date(module.created_at).toLocaleDateString()}
                              </span>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Mobile Card View */}
                <div className="grid grid-cols-1 gap-4 p-4 md:hidden">
                  {filteredModules.length === 0 ? (
                     <div className="px-6 py-12 text-center">
                        <AlertCircle className="mx-auto mb-3 text-slate-300" size={48} />
                        <p className="text-slate-500 font-medium mb-1">No modules found</p>
                        <p className="text-sm text-slate-400">Modules you uploaded or are assigned to review will appear here</p>
                      </div>
                  ) : (
                    paginatedModules.map((module) => (
                      <div
                        key={module.module_id}
                        className="bg-white rounded-lg border border-slate-200 p-4 space-y-4"
                        onClick={() => router.push(`/admin/dashboard/human-in-the-loop/edit/${module.module_id}`)}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-slate-100 rounded-lg flex items-center justify-center shrink-0">
                            <FileText size={20} className="text-slate-500" />
                          </div>
                          <div>
                            <p className="font-semibold text-[#1E293B]">{module.title}</p>
                            <p className="text-sm text-slate-500">{module.description || 'No description'}</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div>
                            <p className="text-xs text-slate-400 font-semibold uppercase mb-1">Review Stage</p>
                            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${getReviewStageColor(module.review_stage)}`}>
                              {getReviewStageLabel(module.review_stage)}
                            </span>
                          </div>
                          <div>
                            <p className="text-xs text-slate-400 font-semibold uppercase mb-1">Processing</p>
                            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${getProcessingStatusColor(module.processing_status)}`}>
                              {module.processing_status || 'Unknown'}
                            </span>
                          </div>
                          <div>
                            <p className="text-xs text-slate-400 font-semibold uppercase mb-1">Uploader</p>
                            <p className="font-medium text-slate-700">{module.uploader_name}</p>
                          </div>
                          <div>
                            <p className="text-xs text-slate-400 font-semibold uppercase mb-1">Reviewer</p>
                            <p className="font-medium text-slate-700">{module.reviewer_name}</p>
                          </div>
                        </div>
                        
                        <div className="text-xs text-slate-400 pt-2 border-t border-slate-100">
                          Created: {new Date(module.created_at).toLocaleDateString()}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <CustomPagination
                  className="border-t border-slate-100"
                  currentPage={currentPage}
                  totalPages={totalPages}
                  itemsPerPage={itemsPerPage}
                  setItemsPerPage={setItemsPerPage}
                  setCurrentPage={setCurrentPage}
                />
              </>
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}
