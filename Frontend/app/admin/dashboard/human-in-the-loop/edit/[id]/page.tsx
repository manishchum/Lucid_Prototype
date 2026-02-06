'use client'

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/auth-context';
import { ArrowLeft, Eye, GitCompare, Edit3, Sparkles, ShieldAlert, Lock, RotateCcw, XCircle, AlertTriangle, CheckCircle, FileText, Upload, UserCheck, Clock, History } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import EmployeeNavigation from '@/components/employee-navigation';

interface TrainingModule {
  module_id: string;
  title: string;
  description: string;
  review_stage: string;
  created_at: string;
  reviewer_id: string;
  uploaded_by: string;
}

interface ProcessedModule {
  processed_module_id: string;
  original_module_id: string;
  title: string;
  content: string;
  section_type: string;
  order_index: number;
  created_at: string;
}

interface ContentHistory {
  content_generation_history_id: string;
  processed_module_id: string;
  original_module_id: string;
  content: string;
  status: string;
  created_at: string;
}

export default function EditModulePage() {
  const params = useParams();
  const router = useRouter();
  const { user } = useAuth();
  const moduleId = params.id as string;

  const [module, setModule] = useState<TrainingModule | null>(null);
  const [subModules, setSubModules] = useState<ProcessedModule[]>([]);
  const [selectedSubModule, setSelectedSubModule] = useState<ProcessedModule | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeView, setActiveView] = useState<'edit' | 'diff' | 'final'>('edit');
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<'uploader' | 'reviewer' | 'both' | null>(null);

  // Version control state
  const [pendingHistoryMap, setPendingHistoryMap] = useState<Record<string, ContentHistory>>({});
  const [hasPendingReview, setHasPendingReview] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const contentEditableRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (user?.email) {
      getCurrentUser();
    }
  }, [user]);

  useEffect(() => {
    if (currentUserId) {
      fetchModuleAndSubModules();
    }
  }, [moduleId, currentUserId]);

  useEffect(() => {
    if (selectedSubModule) {
      // If there's a pending review version for this sub-module, show that for reviewer
      const pending = pendingHistoryMap[selectedSubModule.processed_module_id];
      if (pending && (userRole === 'reviewer' || userRole === 'both')) {
        setEditedContent(pending.content);
      } else {
        setEditedContent(selectedSubModule.content);
      }
    }
  }, [selectedSubModule, pendingHistoryMap, userRole]);

  const getCurrentUser = async () => {
    try {
      if (!user?.email) return;
      const { data: userData, error } = await supabase
        .from('users')
        .select('user_id')
        .eq('email', user.email)
        .single();
      if (error) throw error;
      if (userData) setCurrentUserId(userData.user_id);
    } catch (error) {
      console.error('Error fetching current user:', error);
    }
  };

  const fetchModuleAndSubModules = async () => {
    try {
      setLoading(true);

      const { data: moduleData, error: moduleError } = await supabase
        .from('training_modules')
        .select('*')
        .eq('module_id', moduleId)
        .single();

      if (moduleError) throw moduleError;

      if (moduleData) {
        setModule(moduleData);

        const isUploader = moduleData.uploaded_by === currentUserId;
        const isReviewer = moduleData.reviewer_id === currentUserId;

        let role: 'uploader' | 'reviewer' | 'both' | null = null;
        if (isUploader && isReviewer) role = 'both';
        else if (isReviewer) role = 'reviewer';
        else if (isUploader) role = 'uploader';
        setUserRole(role);

        const { data: subModulesData, error: subModulesError } = await supabase
          .from('processed_modules')
          .select('*')
          .eq('original_module_id', moduleId)
          .order('order_index', { ascending: true });

        if (subModulesError) throw subModulesError;

        if (subModulesData && subModulesData.length > 0) {
          setSubModules(subModulesData);
          setSelectedSubModule(subModulesData[0]);
          setEditedContent(subModulesData[0].content);
        }

        // Fetch pending/in_review history for all sub-modules of this module
        await fetchPendingHistory();
      }
    } catch (error) {
      console.error('Error fetching module:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchPendingHistory = async () => {
    try {
      // Get the latest in_review entry per processed_module_id for this module
      const { data: historyData, error: historyError } = await supabase
        .from('content_generation_history')
        .select('*')
        .eq('original_module_id', moduleId)
        .eq('status', 'in_review')
        .order('created_at', { ascending: false });

      if (historyError) throw historyError;

      if (historyData && historyData.length > 0) {
        // Build a map: processed_module_id -> latest in_review history entry
        const map: Record<string, ContentHistory> = {};
        for (const entry of historyData) {
          // Only keep the latest one per processed_module_id
          if (!map[entry.processed_module_id]) {
            map[entry.processed_module_id] = entry;
          }
        }
        setPendingHistoryMap(map);
        setHasPendingReview(true);
      } else {
        setPendingHistoryMap({});
        setHasPendingReview(false);
      }
    } catch (error) {
      console.error('Error fetching pending history:', error);
    }
  };

  const handleContentEditableChange = () => {
    if (!hasUnsavedChanges) {
      setHasUnsavedChanges(true);
    }
  };

  const handleSubModuleClick = (subModule: ProcessedModule) => {
    if (hasUnsavedChanges) {
      if (!confirm('You have unsaved changes. Do you want to discard them?')) {
        return;
      }
    }
    setSelectedSubModule(subModule);
    setHasUnsavedChanges(false);
    setActiveView('edit');
  };

  // ADMIN: Save edits locally (no DB write yet, just prepare for request approval)
  const handleSaveChanges = () => {
    if (!selectedSubModule || !contentEditableRef.current) return;
    const newContent = contentEditableRef.current.innerHTML;
    setEditedContent(newContent);
    setHasUnsavedChanges(false);
    alert('Changes saved locally. Click "Request Approval" to submit for review.');
  };

  // ADMIN: Request Approval - store new content in content_generation_history with status in_review
  const handleRequestApproval = async () => {
    if (!selectedSubModule || !contentEditableRef.current) return;

    const newContent = contentEditableRef.current.innerHTML;

    // Check if content actually changed from live
    if (newContent === selectedSubModule.content) {
      alert('No changes detected from the live content.');
      return;
    }

    if (!confirm('Submit your changes for reviewer approval?')) return;

    setSubmitting(true);
    try {
      // Insert new history entry with status in_review
      const { error: insertError } = await supabase
        .from('content_generation_history')
        .insert({
          processed_module_id: selectedSubModule.processed_module_id,
          original_module_id: moduleId,
          content: newContent,
          status: 'in_review'
        });

      if (insertError) throw insertError;

      // Update the training module review_stage to in_review
      const { error: updateError } = await supabase
        .from('training_modules')
        .update({ review_stage: 'in_review' })
        .eq('module_id', moduleId);

      if (updateError) throw updateError;

      setHasUnsavedChanges(false);
      alert('Changes submitted for review! The reviewer will be notified.');

      // Refresh data
      await fetchPendingHistory();
      // Refresh module to get updated review_stage
      const { data: updatedModule } = await supabase
        .from('training_modules')
        .select('*')
        .eq('module_id', moduleId)
        .single();
      if (updatedModule) setModule(updatedModule);
    } catch (error) {
      console.error('Error requesting approval:', error);
      alert('Failed to submit for review');
    } finally {
      setSubmitting(false);
    }
  };

  // REVIEWER: Save reviewer edits to history (overwrite the in_review entry)
  const handleReviewerSave = async () => {
    if (!selectedSubModule || !contentEditableRef.current) return;

    const newContent = contentEditableRef.current.innerHTML;
    const existingPending = pendingHistoryMap[selectedSubModule.processed_module_id];

    setSubmitting(true);
    try {
      if (existingPending) {
        // Update existing in_review entry with reviewer's edits
        const { error } = await supabase
          .from('content_generation_history')
          .update({ content: newContent })
          .eq('content_generation_history_id', existingPending.content_generation_history_id);
        if (error) throw error;
      } else {
        // Create new in_review entry with reviewer's edits
        const { error } = await supabase
          .from('content_generation_history')
          .insert({
            processed_module_id: selectedSubModule.processed_module_id,
            original_module_id: moduleId,
            content: newContent,
            status: 'in_review'
          });
        if (error) throw error;
      }

      setHasUnsavedChanges(false);
      alert('Your edits have been saved.');
      await fetchPendingHistory();
    } catch (error) {
      console.error('Error saving reviewer edits:', error);
      alert('Failed to save edits');
    } finally {
      setSubmitting(false);
    }
  };

  // REVIEWER: Final Approval - push all in_review content to processed_modules (live)
  const handleFinalApproval = async () => {
    if (!confirm('Approve all changes and push to live? This will update the content visible to employees.')) return;

    setSubmitting(true);
    try {
      // Get all in_review history entries for this module
      const { data: pendingEntries, error: fetchError } = await supabase
        .from('content_generation_history')
        .select('*')
        .eq('original_module_id', moduleId)
        .eq('status', 'in_review')
        .order('created_at', { ascending: false });

      if (fetchError) throw fetchError;

      if (!pendingEntries || pendingEntries.length === 0) {
        alert('No pending changes to approve.');
        setSubmitting(false);
        return;
      }

      // Get latest entry per processed_module_id
      const latestPerModule: Record<string, ContentHistory> = {};
      for (const entry of pendingEntries) {
        if (!latestPerModule[entry.processed_module_id]) {
          latestPerModule[entry.processed_module_id] = entry;
        }
      }

      // Push each approved content to processed_modules
      for (const [processedModuleId, historyEntry] of Object.entries(latestPerModule)) {
        const { error: updateError } = await supabase
          .from('processed_modules')
          .update({ content: historyEntry.content })
          .eq('processed_module_id', processedModuleId);

        if (updateError) {
          console.error(`Failed to update processed_module ${processedModuleId}:`, updateError);
          continue;
        }
      }

      // Mark all in_review entries for this module as approved
      const { error: statusError } = await supabase
        .from('content_generation_history')
        .update({ status: 'approved' })
        .eq('original_module_id', moduleId)
        .eq('status', 'in_review');

      if (statusError) throw statusError;

      // Update training module review_stage to approved
      const { error: moduleUpdateError } = await supabase
        .from('training_modules')
        .update({ review_stage: 'approved' })
        .eq('module_id', moduleId);

      if (moduleUpdateError) throw moduleUpdateError;

      alert('All changes approved and pushed to live!');
      router.push('/admin/dashboard/human-in-the-loop');
    } catch (error) {
      console.error('Error approving changes:', error);
      alert('Failed to approve changes');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!confirm('Reject all pending changes? This will discard the submitted edits.')) return;

    setSubmitting(true);
    try {
      // Mark all in_review entries as rejected
      const { error: statusError } = await supabase
        .from('content_generation_history')
        .update({ status: 'rejected' })
        .eq('original_module_id', moduleId)
        .eq('status', 'in_review');

      if (statusError) throw statusError;

      // Update training module review_stage to rejected
      const { error: moduleUpdateError } = await supabase
        .from('training_modules')
        .update({ review_stage: 'rejected' })
        .eq('module_id', moduleId);

      if (moduleUpdateError) throw moduleUpdateError;

      alert('Changes rejected.');
      router.push('/admin/dashboard/human-in-the-loop');
    } catch (error) {
      console.error('Error rejecting:', error);
      alert('Failed to reject');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegenerate = () => {
    alert('Regenerating content...');
  };

  const handleRequestChanges = async () => {
    try {
      const { error } = await supabase
        .from('training_modules')
        .update({ review_stage: 'in_review' })
        .eq('module_id', moduleId);
      if (error) throw error;
      alert('Module moved to In Review status');
    } catch (error) {
      console.error('Error updating module:', error);
      alert('Failed to update module status');
    }
  };

  const getReviewStageColor = (stage?: string) => {
    switch (stage) {
      case 'approved': return 'bg-green-50 text-green-600';
      case 'in_review': return 'bg-blue-50 text-blue-600';
      case 'rejected': return 'bg-red-50 text-red-600';
      case 'pending': return 'bg-gray-100 text-gray-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const getReviewStageLabel = (stage?: string) => {
    switch (stage) {
      case 'approved': return 'Approved';
      case 'in_review': return 'In Review';
      case 'rejected': return 'Rejected';
      case 'pending': return 'Awaiting Review';
      default: return 'Unknown';
    }
  };

  const getRoleBadge = () => {
    switch (userRole) {
      case 'uploader':
        return (
          <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
            <Upload size={14} className="mr-1.5" />
            You are the Uploader
          </span>
        );
      case 'reviewer':
        return (
          <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
            <UserCheck size={14} className="mr-1.5" />
            You are the Reviewer
          </span>
        );
      case 'both':
        return (
          <div className="flex gap-2">
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200">
              <Upload size={12} className="mr-1" />
              Uploader
            </span>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
              <UserCheck size={12} className="mr-1" />
              Reviewer
            </span>
          </div>
        );
      default:
        return null;
    }
  };

  const ContentRenderer = ({ htmlContent }: { htmlContent: string }) => {
    return (
      <div
        className="prose prose-sm max-w-none
          prose-headings:font-bold prose-headings:text-[#1E293B]
          prose-h1:text-3xl prose-h1:mb-6 prose-h1:mt-8
          prose-h2:text-2xl prose-h2:mb-4 prose-h2:mt-6 prose-h2:pb-2 prose-h2:border-b prose-h2:border-slate-200
          prose-h3:text-xl prose-h3:mb-3 prose-h3:mt-4
          prose-h4:text-lg prose-h4:mb-2 prose-h4:mt-3
          prose-p:text-slate-700 prose-p:leading-relaxed prose-p:mb-4
          prose-strong:text-slate-900 prose-strong:font-semibold
          prose-ul:list-disc prose-ul:ml-6 prose-ul:mb-4
          prose-ol:list-decimal prose-ol:ml-6 prose-ol:mb-4
          prose-li:text-slate-700 prose-li:mb-2
          prose-blockquote:border-l-4 prose-blockquote:border-blue-500 prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:bg-blue-50 prose-blockquote:py-2 prose-blockquote:my-4
          prose-table:w-full prose-table:border-collapse prose-table:my-6
          prose-thead:bg-slate-100
          prose-th:border prose-th:border-slate-300 prose-th:px-4 prose-th:py-3 prose-th:text-left prose-th:font-semibold prose-th:text-slate-900
          prose-td:border prose-td:border-slate-200 prose-td:px-4 prose-td:py-3 prose-td:text-slate-700
          prose-img:rounded-lg prose-img:shadow-md prose-img:my-6"
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />
    );
  };

  const EditableContent = ({ htmlContent }: { htmlContent: string }) => {
    useEffect(() => {
      if (contentEditableRef.current) {
        contentEditableRef.current.innerHTML = htmlContent;
      }
    }, [selectedSubModule?.processed_module_id, userRole, hasPendingReview]);

    return (
      <div
        ref={contentEditableRef}
        contentEditable={true}
        onInput={handleContentEditableChange}
        onBlur={handleContentEditableChange}
        suppressContentEditableWarning={true}
        className="prose prose-sm max-w-none min-h-[500px] p-6 border-2 border-blue-200 rounded-lg focus:outline-none focus:border-blue-400 bg-white
          prose-headings:font-bold prose-headings:text-[#1E293B]
          prose-h1:text-3xl prose-h1:mb-6 prose-h1:mt-8
          prose-h2:text-2xl prose-h2:mb-4 prose-h2:mt-6 prose-h2:pb-2 prose-h2:border-b prose-h2:border-slate-200
          prose-h3:text-xl prose-h3:mb-3 prose-h3:mt-4
          prose-h4:text-lg prose-h4:mb-2 prose-h4:mt-3
          prose-p:text-slate-700 prose-p:leading-relaxed prose-p:mb-4
          prose-strong:text-slate-900 prose-strong:font-semibold
          prose-ul:list-disc prose-ul:ml-6 prose-ul:mb-4
          prose-ol:list-decimal prose-ol:ml-6 prose-ol:mb-4
          prose-li:text-slate-700 prose-li:mb-2
          prose-blockquote:border-l-4 prose-blockquote:border-blue-500 prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:bg-blue-50 prose-blockquote:py-2 prose-blockquote:my-4
          prose-table:w-full prose-table:border-collapse prose-table:my-6
          prose-thead:bg-slate-100
          prose-th:border prose-th:border-slate-300 prose-th:px-4 prose-th:py-3 prose-th:text-left prose-th:font-semibold prose-th:text-slate-900
          prose-td:border prose-td:border-slate-200 prose-td:px-4 prose-td:py-3 prose-td:text-slate-700
          prose-img:rounded-lg prose-img:shadow-md prose-img:my-6"
      >
      </div>
    );
  };

  // Custom styles for callout boxes etc.
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      .callout { padding: 1rem; margin: 1.5rem 0; border-radius: 0.5rem; border-left: 4px solid; }
      .callout.tip { background-color: #f0f9ff; border-color: #3b82f6; }
      .callout.warning { background-color: #fef3c7; border-color: #f59e0b; }
      .callout.definition { background-color: #f3f4f6; border-color: #6b7280; }
      .callout h4 { margin-top: 0; margin-bottom: 0.5rem; font-weight: 600; }
      .key-takeaway { background-color: #ecfdf5; border-left: 4px solid #10b981; padding: 1rem; margin: 1.5rem 0; border-radius: 0.375rem; }
      .key-takeaway strong { color: #047857; }
      .learning-objectives { background-color: #f9fafb; padding: 1.5rem; border-radius: 0.5rem; margin-bottom: 2rem; }
      .learning-objectives h2 { color: #1e293b; margin-top: 0; }
      .learning-objectives ol { margin-bottom: 0; }
      .module-section { margin-bottom: 3rem; }
      .activity { background-color: #fef3c7; padding: 1.5rem; border-radius: 0.5rem; border-left: 4px solid #f59e0b; margin: 2rem 0; }
      .activity h3 { color: #92400e; margin-top: 0; }
      .module-summary { background-color: #dbeafe; padding: 1.5rem; border-radius: 0.5rem; margin-top: 3rem; }
      .module-summary h2 { color: #1e40af; margin-top: 0; }
      table caption { caption-side: top; font-weight: 600; margin-bottom: 0.5rem; color: #1e293b; }
      .diff-added { background-color: #dcfce7; }
      .diff-removed { background-color: #fee2e2; text-decoration: line-through; }
    `;
    document.head.appendChild(style);
    return () => { document.head.removeChild(style); };
  }, []);

  const isReviewer = userRole === 'reviewer' || userRole === 'both';
  const isUploader = userRole === 'uploader';

  // Get the pending content for the currently selected sub-module
  const currentPending = selectedSubModule ? pendingHistoryMap[selectedSubModule.processed_module_id] : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-10 h-10 border-4 border-[#3B66F5]/20 border-t-[#3B66F5] rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFBFC]">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="px-8 py-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-4">
              <button
                onClick={() => router.push('/admin/dashboard/human-in-the-loop')}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <ArrowLeft size={20} />
              </button>
              <div>
                <h1 className="text-xl font-bold text-[#1E293B]">{module?.title || 'Module Review'}</h1>
                <div className="flex items-center gap-4 mt-1 text-sm text-slate-500">
                  <span>Sub-Modules: <span className="font-medium">{subModules.length}</span></span>
                  <span>•</span>
                  <span>ID: <span className="font-medium">{moduleId.slice(0, 8)}</span></span>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {getRoleBadge()}
              <span className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold ${getReviewStageColor(module?.review_stage)}`}>
                {getReviewStageLabel(module?.review_stage)}
              </span>
            </div>
          </div>

          {/* Role-specific banners */}
          {isUploader && !hasPendingReview && (
            <div className="bg-purple-50 border border-purple-200 text-purple-800 px-4 py-3 rounded-lg flex items-center gap-3">
              <Upload size={18} />
              <span className="font-medium">You uploaded this module. Edit content and click "Request Approval" to submit changes for review.</span>
            </div>
          )}

          {isUploader && hasPendingReview && (
            <div className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-lg flex items-center gap-3">
              <Clock size={18} />
              <span className="font-medium">Your changes are pending review. The reviewer has been notified. You can view the submitted changes in the "Compare Changes" tab.</span>
            </div>
          )}

          {isReviewer && userRole === 'reviewer' && hasPendingReview && (
            <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg flex items-center gap-3">
              <AlertTriangle size={18} />
              <span className="font-medium">⚡ Review requested! The admin has submitted changes for your approval. Review the changes in "Compare Changes" tab, make edits if needed, then approve or reject.</span>
            </div>
          )}

          {isReviewer && userRole === 'reviewer' && !hasPendingReview && (
            <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg flex items-center gap-3">
              <UserCheck size={18} />
              <span className="font-medium">You are assigned to review this module. No pending changes to review at this time.</span>
            </div>
          )}

          {userRole === 'both' && hasPendingReview && (
            <div className="bg-indigo-50 border border-indigo-200 text-indigo-800 px-4 py-3 rounded-lg flex items-center gap-3">
              <AlertTriangle size={18} />
              <span className="font-medium">Changes are pending review. You have full authority to edit and approve.</span>
            </div>
          )}

          {userRole === 'both' && !hasPendingReview && (
            <div className="bg-indigo-50 border border-indigo-200 text-indigo-800 px-4 py-3 rounded-lg flex items-center gap-3">
              <Sparkles size={18} />
              <span className="font-medium">You uploaded and are reviewing this module. Edit content and submit or approve directly.</span>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="grid grid-cols-12 gap-6 p-8 pb-28">
        {/* Left Panel - Sub-Modules List */}
        <div className="col-span-3 flex flex-col">
          <Card className="flex-1 bg-white border-slate-200 overflow-hidden flex flex-col">
            <div className="p-4 border-b border-slate-200">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-5 h-5 bg-blue-100 rounded flex items-center justify-center">
                  <FileText size={14} className="text-blue-600" />
                </div>
                <h3 className="font-semibold text-[#1E293B]">Sub-Modules</h3>
              </div>
              <p className="text-xs text-slate-500">Total: {subModules.length} modules</p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {subModules.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <FileText size={32} className="mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No sub-modules found</p>
                </div>
              ) : (
                subModules.map((subModule, index) => {
                  const hasPending = !!pendingHistoryMap[subModule.processed_module_id];
                  return (
                    <div
                      key={subModule.processed_module_id}
                      onClick={() => handleSubModuleClick(subModule)}
                      className={`p-3 rounded-lg border transition-all cursor-pointer ${
                        selectedSubModule?.processed_module_id === subModule.processed_module_id
                          ? 'bg-blue-50 border-blue-300 shadow-sm'
                          : 'bg-slate-50 border-slate-200 hover:border-blue-200 hover:bg-slate-100'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-1">
                        <span className="text-xs font-semibold text-blue-600">#{index + 1}</span>
                        <div className="flex gap-1">
                          {hasPending && (
                            <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                              Pending
                            </span>
                          )}
                          {subModule.section_type && (
                            <span className="text-xs text-slate-500 bg-white px-2 py-0.5 rounded">
                              {subModule.section_type}
                            </span>
                          )}
                        </div>
                      </div>
                      <p className="text-sm font-medium text-slate-700 leading-tight line-clamp-2">
                        {subModule.title}
                      </p>
                      <p className="text-xs text-slate-500 mt-1">
                        {subModule.content.length} characters
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </Card>
        </div>

        {/* Center Panel - Content View/Edit/Diff */}
        <div className="col-span-9 flex flex-col">
          <Card className="flex-1 bg-white border-slate-200 overflow-hidden flex flex-col">
            {/* Tabs */}
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
              <div className="flex gap-2">
                <button
                  onClick={() => { setActiveView('edit'); setIsEditing(true); }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeView === 'edit' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Edit3 size={16} />
                  Edit Content
                </button>

                <button
                  onClick={() => setActiveView('diff')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeView === 'diff' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <GitCompare size={16} />
                  Compare Changes
                  {currentPending && (
                    <span className="ml-1 w-2 h-2 bg-amber-500 rounded-full"></span>
                  )}
                </button>

                <button
                  onClick={() => setActiveView('final')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeView === 'final' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Eye size={16} />
                  Live Preview
                </button>
              </div>

              <div className="flex items-center gap-2">
                {hasUnsavedChanges && (
                  <span className="text-xs text-orange-600 font-medium">● Unsaved changes</span>
                )}
                {/* Admin save + request approval buttons */}
                {isUploader && hasUnsavedChanges && (
                  <Button size="sm" variant="outline" onClick={handleSaveChanges} className="border-slate-300">
                    Save Draft
                  </Button>
                )}
                {/* Reviewer save edits button */}
                {isReviewer && hasUnsavedChanges && activeView === 'edit' && (
                  <Button size="sm" onClick={handleReviewerSave} disabled={submitting} className="bg-blue-600 hover:bg-blue-700">
                    {submitting ? 'Saving...' : 'Save Edits'}
                  </Button>
                )}
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-6">
              {!selectedSubModule ? (
                <div className="flex items-center justify-center h-full text-slate-400">
                  <div className="text-center">
                    <FileText size={48} className="mx-auto mb-3 opacity-50" />
                    <p>Select a sub-module to view content</p>
                  </div>
                </div>
              ) : (
                <>
                  {/* ========== EDIT TAB ========== */}
                  {activeView === 'edit' && (
                    <div>
                      <div className="mb-4 pb-3 border-b border-slate-200">
                        <label className="text-sm font-semibold text-slate-700 block mb-1">
                          Editing: {selectedSubModule.title}
                        </label>
                        {isUploader && (
                          <p className="text-xs text-slate-500">
                            Make your changes below. Click "Save Draft" to hold changes, then "Request Approval" to submit for review.
                          </p>
                        )}
                        {isReviewer && (
                          <p className="text-xs text-slate-500">
                            You can make edits to the content. Click "Save Edits" to update, then "Final Approval" to push live.
                          </p>
                        )}
                      </div>
                      <EditableContent htmlContent={editedContent} />
                      <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <p className="text-xs text-blue-800">
                          <strong>💡 Editing Tips:</strong> Click anywhere to start editing. Use Ctrl+B for bold, Ctrl+I for italic. Your HTML structure will be preserved.
                        </p>
                      </div>
                    </div>
                  )}

                  {/* ========== DIFF / COMPARE TAB ========== */}
                  {activeView === 'diff' && (
                    <div>
                      <div className="mb-6 pb-4 border-b border-slate-200">
                        <h2 className="text-lg font-bold text-[#1E293B] mb-1">Compare Changes: {selectedSubModule.title}</h2>
                        <p className="text-xs text-slate-500">
                          Side-by-side comparison of the current live content and the proposed changes.
                        </p>
                      </div>

                      {currentPending ? (
                        <div className="grid grid-cols-2 gap-6">
                          {/* Left: Current Live */}
                          <div>
                            <div className="flex items-center gap-2 mb-3">
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
                                <Eye size={12} className="mr-1" />
                                Current Live Content
                              </span>
                            </div>
                            <div className="border border-slate-200 rounded-lg p-4 bg-slate-50 max-h-[600px] overflow-y-auto">
                              <ContentRenderer htmlContent={selectedSubModule.content} />
                            </div>
                          </div>

                          {/* Right: Proposed Changes */}
                          <div>
                            <div className="flex items-center gap-2 mb-3">
                              <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 border border-amber-200">
                                <Edit3 size={12} className="mr-1" />
                                Proposed Changes (In Review)
                              </span>
                              <span className="text-xs text-slate-400">
                                {new Date(currentPending.created_at).toLocaleString()}
                              </span>
                            </div>
                            <div className="border-2 border-amber-300 rounded-lg p-4 bg-amber-50/30 max-h-[600px] overflow-y-auto">
                              <ContentRenderer htmlContent={currentPending.content} />
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                          <GitCompare size={48} className="mb-4 opacity-50" />
                          <p className="font-medium text-slate-600 mb-1">No pending changes to compare</p>
                          <p className="text-sm">
                            {isUploader
                              ? 'Edit the content and click "Request Approval" to create a review request.'
                              : 'No review requests have been submitted for this sub-module yet.'
                            }
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ========== LIVE PREVIEW TAB ========== */}
                  {activeView === 'final' && (
                    <div>
                      <div className="mb-6 pb-4 border-b border-slate-200">
                        <div className="flex items-center gap-3 mb-2">
                          <h2 className="text-2xl font-bold text-[#1E293B]">{selectedSubModule.title}</h2>
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-green-50 text-green-700 border border-green-200">
                            Live
                          </span>
                        </div>
                        {selectedSubModule.section_type && (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                            {selectedSubModule.section_type}
                          </span>
                        )}
                        <p className="text-xs text-slate-500 mt-2">
                          This is the content currently visible to employees.
                        </p>
                      </div>
                      <ContentRenderer htmlContent={selectedSubModule.content} />
                    </div>
                  )}
                </>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* Footer Actions */}
      <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-8 py-4 z-50">
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            onClick={handleRegenerate}
            className="text-slate-600 border-slate-300"
          >
            <RotateCcw size={16} className="mr-2" />
            Regenerate
          </Button>

          <div className="flex items-center gap-3">
            {/* ADMIN: Request Approval button */}
            {isUploader && (
              <Button
                onClick={handleRequestApproval}
                disabled={submitting || hasPendingReview}
                className="bg-purple-600 hover:bg-purple-700 text-white disabled:bg-purple-300"
              >
                <Upload size={16} className="mr-2" />
                {submitting ? 'Submitting...' : hasPendingReview ? 'Approval Pending' : 'Request Approval'}
              </Button>
            )}

            {/* REVIEWER: Reject button */}
            {isReviewer && hasPendingReview && (
              <Button
                variant="outline"
                onClick={handleReject}
                disabled={submitting}
                className="text-red-600 border-red-200 hover:bg-red-50"
              >
                <XCircle size={16} className="mr-2" />
                Reject Changes
              </Button>
            )}

            {/* REVIEWER: Final Approval button */}
            {isReviewer && hasPendingReview && (
              <Button
                onClick={handleFinalApproval}
                disabled={submitting}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                <CheckCircle size={16} className="mr-2" />
                {submitting ? 'Approving...' : 'Final Approval'}
              </Button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
