'use client'

import React, { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/auth-context';
import { ArrowLeft, Eye, GitCompare, Edit3, Sparkles, ShieldAlert, Lock, RotateCcw, XCircle, AlertTriangle, CheckCircle, FileText, Upload, UserCheck } from 'lucide-react';
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

interface SourceChunk {
  id: string;
  pageNumber: number;
  text: string;
  relevanceScore: number;
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
  const [activeView, setActiveView] = useState<'final' | 'diff' | 'edit'>('final');
  const [isEditing, setIsEditing] = useState(false);
  const [editedContent, setEditedContent] = useState('');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userRole, setUserRole] = useState<'uploader' | 'reviewer' | 'both' | null>(null);

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
      setEditedContent(selectedSubModule.content);
    }
  }, [selectedSubModule]);

  const getCurrentUser = async () => {
    try {
      if (!user?.email) return;

      const { data: userData, error } = await supabase
        .from('users')
        .select('user_id')
        .eq('email', user.email)
        .single();

      if (error) throw error;
      
      if (userData) {
        setCurrentUserId(userData.user_id);
      }
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
        if (isUploader && isReviewer) {
          role = 'both';
        } else if (isReviewer) {
          role = 'reviewer';
        } else if (isUploader) {
          role = 'uploader';
        }
        
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
      }
    } catch (error) {
      console.error('Error fetching module:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleContentEditableChange = () => {
    if (contentEditableRef.current) {
      const newContent = contentEditableRef.current.innerHTML;
      setEditedContent(newContent);
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
    setEditedContent(subModule.content);
    setHasUnsavedChanges(false);
    setActiveView('final');
  };

  const handleSaveChanges = async () => {
    if (!selectedSubModule) return;

    try {
      const { error } = await supabase
        .from('processed_modules')
        .update({ content: editedContent })
        .eq('processed_module_id', selectedSubModule.processed_module_id);

      if (error) throw error;

      alert('Changes saved successfully!');
      setHasUnsavedChanges(false);
      
      const updatedSubModules = subModules.map(sm => 
        sm.processed_module_id === selectedSubModule.processed_module_id 
          ? { ...sm, content: editedContent }
          : sm
      );
      setSubModules(updatedSubModules);
      setSelectedSubModule({ ...selectedSubModule, content: editedContent });
    } catch (error) {
      console.error('Error saving changes:', error);
      alert('Failed to save changes');
    }
  };

  const handleRegenerate = () => {
    alert('Regenerating content...');
  };

  const handleReject = async () => {
    if (confirm('Are you sure you want to reject this content?')) {
      try {
        const { error } = await supabase
          .from('training_modules')
          .update({ review_stage: 'rejected' })
          .eq('module_id', moduleId);

        if (error) throw error;
        router.push('/admin/dashboard/human-in-the-loop');
      } catch (error) {
        console.error('Error rejecting module:', error);
        alert('Failed to reject module');
      }
    }
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

  const handleFinalApproval = async () => {
    if (confirm('Approve this content for final use?')) {
      try {
        const { error } = await supabase
          .from('training_modules')
          .update({ review_stage: 'approved' })
          .eq('module_id', moduleId);

        if (error) throw error;
        alert('Content approved!');
        router.push('/admin/dashboard/human-in-the-loop');
      } catch (error) {
        console.error('Error approving module:', error);
        alert('Failed to approve module');
      }
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
      if (contentEditableRef.current && !hasUnsavedChanges) {
        contentEditableRef.current.innerHTML = htmlContent;
      }
    }, [htmlContent]);

    return (
      <div
        ref={contentEditableRef}
        contentEditable={true}
        onInput={handleContentEditableChange}
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
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />
    );
  };

  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      .callout {
        padding: 1rem;
        margin: 1.5rem 0;
        border-radius: 0.5rem;
        border-left: 4px solid;
      }
      .callout.tip {
        background-color: #f0f9ff;
        border-color: #3b82f6;
      }
      .callout.warning {
        background-color: #fef3c7;
        border-color: #f59e0b;
      }
      .callout.definition {
        background-color: #f3f4f6;
        border-color: #6b7280;
      }
      .callout h4 {
        margin-top: 0;
        margin-bottom: 0.5rem;
        font-weight: 600;
      }
      .key-takeaway {
        background-color: #ecfdf5;
        border-left: 4px solid #10b981;
        padding: 1rem;
        margin: 1.5rem 0;
        border-radius: 0.375rem;
      }
      .key-takeaway strong {
        color: #047857;
      }
      .learning-objectives {
        background-color: #f9fafb;
        padding: 1.5rem;
        border-radius: 0.5rem;
        margin-bottom: 2rem;
      }
      .learning-objectives h2 {
        color: #1e293b;
        margin-top: 0;
      }
      .learning-objectives ol {
        margin-bottom: 0;
      }
      .module-section {
        margin-bottom: 3rem;
      }
      .activity {
        background-color: #fef3c7;
        padding: 1.5rem;
        border-radius: 0.5rem;
        border-left: 4px solid #f59e0b;
        margin: 2rem 0;
      }
      .activity h3 {
        color: #92400e;
        margin-top: 0;
      }
      .module-summary {
        background-color: #dbeafe;
        padding: 1.5rem;
        border-radius: 0.5rem;
        margin-top: 3rem;
      }
      .module-summary h2 {
        color: #1e40af;
        margin-top: 0;
      }
      table caption {
        caption-side: top;
        font-weight: 600;
        margin-bottom: 0.5rem;
        color: #1e293b;
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  const isReviewer = userRole === 'reviewer' || userRole === 'both';
  const isUploader = userRole === 'uploader';

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="w-10 h-10 border-4 border-[#3B66F5]/20 border-t-[#3B66F5] rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#FAFBFC]">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
        <div className="px-8 py-4">
          <div className="flex items-center justify-between mb-4">
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

          {isUploader && (
            <div className="bg-purple-50 border border-purple-200 text-purple-800 px-4 py-3 rounded-lg flex items-center gap-3">
              <Upload size={18} />
              <span className="font-medium">You uploaded this module. Only the assigned reviewer can give final approval.</span>
            </div>
          )}
          
          {isReviewer && userRole === 'reviewer' && (
            <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg flex items-center gap-3">
              <UserCheck size={18} />
              <span className="font-medium">You are assigned to review this module. You can approve or reject the content.</span>
            </div>
          )}

          {userRole === 'both' && (
            <div className="bg-indigo-50 border border-indigo-200 text-indigo-800 px-4 py-3 rounded-lg flex items-center gap-3">
              <AlertTriangle size={18} />
              <span className="font-medium">You uploaded and are reviewing this module. You have full approval authority.</span>
            </div>
          )}
        </div>
      </header>

      <div className="grid grid-cols-12 gap-6 p-8 h-[calc(100vh-200px)]">
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
                subModules.map((subModule, index) => (
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
                      {subModule.section_type && (
                        <span className="text-xs text-slate-500 bg-white px-2 py-0.5 rounded">
                          {subModule.section_type}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-slate-700 leading-tight line-clamp-2">
                      {subModule.title}
                    </p>
                    <p className="text-xs text-slate-500 mt-1">
                      {subModule.content.length} characters
                    </p>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>

        <div className="col-span-8 flex flex-col">
          <Card className="flex-1 bg-white border-slate-200 overflow-hidden flex flex-col">
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
                </button>
                
                <button
                  onClick={() => setActiveView('final')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeView === 'final' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Eye size={16} />
                  Preview
                </button>
              </div>
              
              <div className="flex items-center gap-2">
                {hasUnsavedChanges && (
                  <span className="text-xs text-orange-600 font-medium">● Unsaved changes</span>
                )}
                {hasUnsavedChanges && (
                  <Button size="sm" onClick={handleSaveChanges} className="bg-blue-600 hover:bg-blue-700">
                    Save Changes
                  </Button>
                )}
              </div>
            </div>

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
                  {activeView === 'final' && (
                    <div>
                      <div className="mb-6 pb-4 border-b border-slate-200">
                        <h2 className="text-2xl font-bold text-[#1E293B] mb-2">{selectedSubModule.title}</h2>
                        {selectedSubModule.section_type && (
                          <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700">
                            {selectedSubModule.section_type}
                          </span>
                        )}
                      </div>
                      <ContentRenderer htmlContent={editedContent} />
                    </div>
                  )}

                  {activeView === 'diff' && (
                    <div className="space-y-4">
                      <div className="p-4 bg-blue-50 border-l-4 border-blue-400 rounded">
                        <p className="text-xs font-semibold text-blue-800 mb-3">Original Content</p>
                        <div className="bg-white p-4 rounded border border-blue-200">
                          <ContentRenderer htmlContent={selectedSubModule.content} />
                        </div>
                      </div>
                      {editedContent !== selectedSubModule.content && (
                        <div className="p-4 bg-green-50 border-l-4 border-green-400 rounded">
                          <p className="text-xs font-semibold text-green-800 mb-3">Modified Content</p>
                          <div className="bg-white p-4 rounded border border-green-200">
                            <ContentRenderer htmlContent={editedContent} />
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {activeView === 'edit' && (
                    <div>
                      <div className="mb-4 pb-3 border-b border-slate-200">
                        <label className="text-sm font-semibold text-slate-700 block mb-1">
                          Editing: {selectedSubModule.title}
                        </label>
                        <p className="text-xs text-slate-500">
                          Click anywhere in the content below to start editing. Your changes will be preserved in HTML format.
                        </p>
                      </div>
                      <EditableContent htmlContent={editedContent} />
                      <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                        <p className="text-xs text-blue-800">
                          <strong>💡 Editing Tips:</strong> You can directly edit text, format using your browser's native editing features, 
                          and the HTML structure will be preserved automatically. Use Ctrl+B for bold, Ctrl+I for italic, etc.
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </Card>
        </div>
      </div>

      <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-8 py-4">
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
            <Button
              variant="outline"
              onClick={handleReject}
              className="text-red-600 border-red-200 hover:bg-red-50"
            >
              <XCircle size={16} className="mr-2" />
              Reject
            </Button>
            
            {isUploader && (
              <Button
                variant="outline"
                onClick={handleRequestChanges}
                className="text-orange-600 border-orange-200 hover:bg-orange-50"
              >
                <Edit3 size={16} className="mr-2" />
                Request Changes
              </Button>
            )}
            
            {isReviewer && (
              <Button
                onClick={handleFinalApproval}
                className="bg-blue-600 hover:bg-blue-700 text-white"
              >
                <CheckCircle size={16} className="mr-2" />
                Final Approval
              </Button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
