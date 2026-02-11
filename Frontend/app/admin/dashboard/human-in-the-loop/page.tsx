'use client'

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/auth-context';
import { useRouter } from 'next/navigation';
import EmployeeNavigation from '@/components/employee-navigation';
import { Search, Filter, FileText, Clock, AlertCircle, Upload, UserCheck } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

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
}

const API_BASE = process.env.NEXT_PUBLIC_BACKEND_URL;

const fetchUserByEmail = async (email: string | null) => {
  if (!email) return null;
  try {
    const res = await fetch(`${API_BASE}/api/users/by-email/${encodeURIComponent(email)}`);
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
  const { user } = useAuth();
  const router = useRouter();
  const [modules, setModules] = useState<TrainingModule[]>([]);
  const [filteredModules, setFilteredModules] = useState<TrainingModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [reviewFilter, setReviewFilter] = useState('All');
  const [roleFilter, setRoleFilter] = useState('All');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [stats, setStats] = useState({
    pending: 0,
    inReview: 0,
    approved: 0,
    rejected: 0,
    asUploader: 0,
    asReviewer: 0
  });

  useEffect(() => {
    if (user?.email) {
      getCurrentUser();
    }
  }, [user]);

  useEffect(() => {
    if (currentUserId) {
      fetchModules();
    }
  }, [currentUserId]);

  useEffect(() => {
    filterModules();
  }, [searchQuery, reviewFilter, roleFilter, modules]);

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
      
      // Fetch modules where user is either uploader OR reviewer
      const { data, error } = await supabase
        .from('training_modules')
        .select('*')
        .or(`uploaded_by.eq.${currentUserId},reviewer_id.eq.${currentUserId}`)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (data) {
        // Determine user's role for each module
        const modulesWithRole = data.map(module => {
          const isUploader = module.uploaded_by === currentUserId;
          const isReviewer = module.reviewer_id === currentUserId;
          
          let userRole: 'uploader' | 'reviewer' | 'both' = 'uploader';
          if (isUploader && isReviewer) {
            userRole = 'both';
          } else if (isReviewer) {
            userRole = 'reviewer';
          }
          
          return {
            ...module,
            user_role: userRole
          };
        });

        setModules(modulesWithRole);
        calculateStats(modulesWithRole);
      }
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

    setFilteredModules(filtered);
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

  if (!currentUserId) {
    return (
      <div className="flex min-h-screen bg-[#FAFBFC]">
        <EmployeeNavigation />
        <main className="flex-1 lg:ml-[280px] p-8">
          <div className="flex items-center justify-center h-screen">
            <div className="w-10 h-10 border-4 border-[#3B66F5]/20 border-t-[#3B66F5] rounded-full animate-spin"></div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-[#FAFBFC]">
      <EmployeeNavigation />
      
      <main className="flex-1 p-8">
        <div className="max-w-[2000px] mx-auto">
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-[#1E293B] mb-2">Content Pipeline Review</h1>
            <p className="text-slate-500">Review and manage AI-generated content you uploaded or are assigned to review.</p>
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

            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Clock size={16} />
              <span>Last updated: Just now</span>
            </div>
          </div>

          {/* Content Table */}
          <Card className="bg-white border-slate-100 shadow-sm overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center p-12">
                <div className="w-10 h-10 border-4 border-[#3B66F5]/20 border-t-[#3B66F5] rounded-full animate-spin"></div>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Module</th>
                      <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Your Role</th>
                      <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Processing Status</th>
                      <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Review Stage</th>
                      <th className="text-left px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredModules.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center">
                          <AlertCircle className="mx-auto mb-3 text-slate-300" size={48} />
                          <p className="text-slate-500 font-medium mb-1">No modules found</p>
                          <p className="text-sm text-slate-400">Modules you uploaded or are assigned to review will appear here</p>
                        </td>
                      </tr>
                    ) : (
                      filteredModules.map((module) => (
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
                            {getRoleBadge(module.user_role)}
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
            )}
          </Card>
        </div>
      </main>
    </div>
  );
}
