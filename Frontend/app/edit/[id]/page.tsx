// 'use client'

// import React, { useState, useEffect } from 'react';
// import { useParams, useRouter } from 'next/navigation';
// import { supabase } from '@/lib/supabase';
// import { ArrowLeft, Eye, GitCompare, Edit3, Sparkles, ShieldAlert, Lock, RotateCcw, XCircle, AlertTriangle, CheckCircle } from 'lucide-react';
// import { Card } from '@/components/ui/card';
// import { Button } from '@/components/ui/button';
// import { Textarea } from '@/components/ui/textarea';

// interface TrainingModule {
//   training_module_id: string;
//   title: string;
//   description: string;
//   content: any;
//   created_at: string;
// }

// interface SourceChunk {
//   id: string;
//   pageNumber: number;
//   text: string;
//   relevanceScore: number;
// }

// export default function EditModulePage() {
//   const params = useParams();
//   const router = useRouter();
//   const moduleId = params.id as string;

//   const [module, setModule] = useState<TrainingModule | null>(null);
//   const [loading, setLoading] = useState(true);
//   const [activeView, setActiveView] = useState<'final' | 'diff' | 'edit'>('final');
//   const [isEditing, setIsEditing] = useState(false);
//   const [editedContent, setEditedContent] = useState('');
//   const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

//   // Mock data for demonstration
//   const [sourceChunks] = useState<SourceChunk[]>([
//     { id: 's1', pageNumber: 3, text: 'Sales representatives must follow regional discount approval policies for any reduction > 5%.', relevanceScore: 95 },
//     { id: 's2', pageNumber: 7, text: 'Compliance Guidelines: CRM logging is mandatory.', relevanceScore: 88 },
//     { id: 's3', pageNumber: 12, text: 'Objection Handling: Focus on value, not price.', relevanceScore: 72 }
//   ]);

//   const mockGeneratedContent = `# Sales Onboarding Plan - Q4

// ## 1. Introduction
// Welcome to the Acme Corp sales team. This document outlines the mandatory onboarding steps.

// ## 2. Pricing & Discounts
// Sales representatives are authorized to offer discounts up to at discretion up to 15% at their own discretion to close deals before end of quarter.

// ## 3. Compliance
// All interactions must be logged in the CRM within 24 hours.`;

//   useEffect(() => {
//     fetchModule();
//   }, [moduleId]);

//   const fetchModule = async () => {
//     try {
//       setLoading(true);
//       const { data, error } = await supabase
//         .from('training_modules')
//         .select('*')
//         .eq('training_module_id', moduleId)
//         .single();

//       if (error) throw error;
//       if (data) {
//         setModule(data);
//         setEditedContent(mockGeneratedContent);
//       }
//     } catch (error) {
//       console.error('Error fetching module:', error);
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleContentChange = (value: string) => {
//     setEditedContent(value);
//     setHasUnsavedChanges(true);
//   };

//   const handleRegenerate = () => {
//     // Logic to regenerate content
//     alert('Regenerating content...');
//   };

//   const handleReject = () => {
//     if (confirm('Are you sure you want to reject this content?')) {
//       router.push('/admin/dashboard/human-in-the-loop');
//     }
//   };

//   const handleRequestChanges = () => {
//     alert('Request changes submitted');
//   };

//   const handleFinalApproval = () => {
//     if (confirm('Approve this content for final use?')) {
//       alert('Content approved!');
//       router.push('/admin/dashboard/human-in-the-loop');
//     }
//   };

//   if (loading) {
//     return (
//       <div className="flex items-center justify-center min-h-screen">
//         <div className="w-10 h-10 border-4 border-[#3B66F5]/20 border-t-[#3B66F5] rounded-full animate-spin"></div>
//       </div>
//     );
//   }

//   return (
//     <div className="min-h-screen bg-[#FAFBFC]">
//       {/* Header */}
//       <header className="bg-white border-b border-slate-200 sticky top-0 z-50">
//         <div className="px-8 py-4">
//           <div className="flex items-center justify-between mb-4">
//             <div className="flex items-center gap-4">
//               <button
//                 onClick={() => router.push('/admin/dashboard/human-in-the-loop')}
//                 className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
//               >
//                 <ArrowLeft size={20} />
//               </button>
//               <div>
//                 <h1 className="text-xl font-bold text-[#1E293B]">{module?.title || 'Sales_Onboarding_Plan.pdf'}</h1>
//                 <div className="flex items-center gap-4 mt-1 text-sm text-slate-500">
//                   <span>Tenant: <span className="font-medium">Acme Corp</span></span>
//                   <span>•</span>
//                   <span>Stage: <span className="font-medium text-blue-600">Plan Review</span></span>
//                   <span>•</span>
//                   <span>ID: 1</span>
//                 </div>
//               </div>
//             </div>
            
//             <div className="flex items-center gap-3">
//               <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-red-50 text-red-600">
//                 <ShieldAlert size={14} className="mr-1.5" />
//                 High
//               </span>
//               <span className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-700">
//                 Awaiting Review
//               </span>
//               <Button variant="outline" className="text-orange-600 border-orange-200 hover:bg-orange-50">
//                 <Lock size={16} className="mr-2" />
//                 Hard Stop Active
//               </Button>
//             </div>
//           </div>

//           {/* Critical Alert Banner */}
//           <div className="bg-red-600 text-white px-4 py-3 rounded-lg flex items-center gap-3">
//             <AlertTriangle size={20} />
//             <span className="font-semibold">CRITICAL: High risk content detected. Mandatory legal review required before approval.</span>
//           </div>
//         </div>
//       </header>

//       {/* Main Content - Three Column Layout */}
//       <div className="grid grid-cols-12 gap-6 p-8 h-[calc(100vh-200px)]">
//         {/* Left Panel - Source Grounding */}
//         <div className="col-span-3 flex flex-col">
//           <Card className="flex-1 bg-white border-slate-200 overflow-hidden flex flex-col">
//             <div className="p-4 border-b border-slate-200">
//               <div className="flex items-center gap-2 mb-2">
//                 <div className="w-5 h-5 bg-blue-100 rounded flex items-center justify-center">
//                   <span className="text-blue-600 text-xs">📄</span>
//                 </div>
//                 <h3 className="font-semibold text-[#1E293B]">Source Grounding</h3>
//               </div>
//               <p className="text-xs text-slate-500">Based on {sourceChunks.length} retrieved chunks</p>
//             </div>

//             <div className="flex-1 overflow-y-auto p-4 space-y-3">
//               {sourceChunks.map((chunk) => (
//                 <div key={chunk.id} className="p-3 bg-slate-50 rounded-lg border border-slate-200 hover:border-blue-300 transition-colors cursor-pointer">
//                   <div className="flex items-center justify-between mb-2">
//                     <span className="text-xs font-semibold text-blue-600">Page {chunk.pageNumber}</span>
//                     <span className="text-xs text-slate-500">ID: {chunk.id}</span>
//                   </div>
//                   <p className="text-sm text-slate-700 leading-relaxed mb-2">&quot;{chunk.text}&quot;</p>
//                   <div className="flex items-center gap-2">
//                     <div className="flex-1 bg-slate-200 rounded-full h-1.5">
//                       <div
//                         className="bg-green-500 h-1.5 rounded-full"
//                         style={{ width: `${chunk.relevanceScore}%` }}
//                       />
//                     </div>
//                     <span className="text-xs font-medium text-green-600">Relevance Score: {chunk.relevanceScore}%</span>
//                   </div>
//                 </div>
//               ))}
//             </div>
//           </Card>
//         </div>

//         {/* Center Panel - Content View/Edit */}
//         <div className="col-span-6 flex flex-col">
//           <Card className="flex-1 bg-white border-slate-200 overflow-hidden flex flex-col">
//             {/* Tabs */}
//             <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
//               <div className="flex gap-2">
//                 <button
//                   onClick={() => setActiveView('final')}
//                   className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
//                     activeView === 'final' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'
//                   }`}
//                 >
//                   <Eye size={16} />
//                   Final Output
//                 </button>
//                 <button
//                   onClick={() => setActiveView('diff')}
//                   className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
//                     activeView === 'diff' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'
//                   }`}
//                 >
//                   <GitCompare size={16} />
//                   Diff View
//                 </button>
//                 <button
//                   onClick={() => { setActiveView('edit'); setIsEditing(true); }}
//                   className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
//                     activeView === 'edit' ? 'bg-blue-50 text-blue-600' : 'text-slate-600 hover:bg-slate-50'
//                   }`}
//                 >
//                   <Edit3 size={16} />
//                   Rich Edit
//                 </button>
//               </div>
              
//               {activeView === 'edit' && (
//                 <span className="text-sm text-slate-500 italic">
//                   {isEditing ? 'Unlocked for editing' : 'Locked'}
//                 </span>
//               )}
//             </div>

//             {/* Content Area */}
//             <div className="flex-1 overflow-y-auto p-6">
//               {activeView === 'final' && (
//                 <div className="prose prose-sm max-w-none">
//                   <div className="whitespace-pre-wrap font-mono text-sm text-slate-800 leading-relaxed">
//                     {editedContent}
//                   </div>
//                 </div>
//               )}

//               {activeView === 'diff' && (
//                 <div className="space-y-4">
//                   <div className="p-4 bg-red-50 border-l-4 border-red-400 rounded">
//                     <p className="text-sm font-mono">
//                       <span className="line-through text-red-700">at discretion</span> up to 15%
//                     </p>
//                   </div>
//                   <div className="p-4 bg-green-50 border-l-4 border-green-400 rounded">
//                     <p className="text-sm font-mono text-green-700">
//                       up to 15%
//                     </p>
//                   </div>
//                 </div>
//               )}

//               {activeView === 'edit' && (
//                 <Textarea
//                   value={editedContent}
//                   onChange={(e) => handleContentChange(e.target.value)}
//                   className="w-full min-h-[500px] font-mono text-sm border-slate-200 focus:border-blue-400 focus:ring-blue-400"
//                   placeholder="Edit content here..."
//                 />
//               )}
//             </div>
//           </Card>
//         </div>

//         {/* Right Panel - Explainability */}
//         <div className="col-span-3 flex flex-col">
//           <Card className="flex-1 bg-white border-slate-200 overflow-hidden flex flex-col">
//             <div className="p-4 border-b border-slate-200">
//               <div className="flex items-center gap-2 mb-2">
//                 <Sparkles size={18} className="text-purple-600" />
//                 <h3 className="font-semibold text-[#1E293B]">Explainability</h3>
//               </div>
//               <p className="text-xs text-slate-500">Generation logic & stats</p>
//             </div>

//             <div className="flex-1 overflow-y-auto p-4 space-y-6">
//               {/* Why section */}
//               <div>
//                 <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
//                   <Sparkles size={14} />
//                   WHY DID AI GENERATE THIS?
//                 </h4>
//                 <ul className="space-y-2 text-sm text-slate-700">
//                   <li className="flex gap-2">
//                     <span className="text-blue-600 shrink-0">•</span>
//                     <span>The source document mentioned &quot;discount flexibility&quot; in the legacy section, but &quot;regional policies&quot; in the new policy section.</span>
//                   </li>
//                   <li className="flex gap-2">
//                     <span className="text-blue-600 shrink-0">•</span>
//                     <span>Compliance rules were inferred from prior training data on financial regulations.</span>
//                   </li>
//                   <li className="flex gap-2">
//                     <span className="text-blue-600 shrink-0">•</span>
//                     <span>Structure follows the standard enterprise onboarding template v2.</span>
//                   </li>
//                 </ul>
//               </div>

//               {/* Model Telemetry */}
//               <div>
//                 <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
//                   <Sparkles size={14} />
//                   MODEL TELEMETRY
//                 </h4>
//                 <div className="space-y-3">
//                   <div className="grid grid-cols-2 gap-3">
//                     <div>
//                       <p className="text-xs text-slate-500 mb-1">Model</p>
//                       <p className="text-sm font-semibold text-slate-800">GPT-4.1</p>
//                     </div>
//                     <div>
//                       <p className="text-xs text-slate-500 mb-1">Prompt</p>
//                       <p className="text-sm font-semibold text-slate-800">v3.2</p>
//                     </div>
//                     <div>
//                       <p className="text-xs text-slate-500 mb-1">Temperature</p>
//                       <p className="text-sm font-semibold text-slate-800">0.4</p>
//                     </div>
//                     <div>
//                       <p className="text-xs text-slate-500 mb-1">RAG Confidence</p>
//                       <p className="text-sm font-semibold text-green-600">87%</p>
//                     </div>
//                   </div>

//                   <div className="bg-slate-900 rounded-lg p-3 text-xs font-mono text-green-400">
//                     <div>TOKEN_IN: 4500</div>
//                     <div>TOKEN_OUT: 1200</div>
//                     <div className="text-slate-500">ID: gen_00kc35xshq</div>
//                   </div>
//                 </div>
//               </div>
//             </div>
//           </Card>
//         </div>
//       </div>

//       {/* Footer Actions */}
//       <footer className="fixed bottom-0 left-0 right-0 bg-white border-t border-slate-200 px-8 py-4">
//         <div className="flex items-center justify-between">
//           <Button
//             variant="outline"
//             onClick={handleRegenerate}
//             className="text-slate-600 border-slate-300"
//           >
//             <RotateCcw size={16} className="mr-2" />
//             Regenerate
//           </Button>

//           <div className="flex items-center gap-3">
//             {hasUnsavedChanges && (
//               <span className="text-sm text-orange-600 mr-2">No unsaved changes</span>
//             )}
            
//             <Button
//               variant="outline"
//               onClick={handleReject}
//               className="text-red-600 border-red-200 hover:bg-red-50"
//             >
//               <XCircle size={16} className="mr-2" />
//               Reject
//             </Button>
            
//             <Button
//               variant="outline"
//               onClick={handleRequestChanges}
//               className="text-orange-600 border-orange-200 hover:bg-orange-50"
//             >
//               <Edit3 size={16} className="mr-2" />
//               Request Changes
//             </Button>
            
//             <Button
//               onClick={handleFinalApproval}
//               className="bg-blue-600 hover:bg-blue-700 text-white"
//             >
//               <CheckCircle size={16} className="mr-2" />
//               Final Approval
//             </Button>
//           </div>
//         </div>
//       </footer>
//     </div>
//   );
// }
