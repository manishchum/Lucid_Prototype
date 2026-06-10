// /**
//  * @license
//  * SPDX-License-Identifier: Apache-2.0
//  */

// import React, { useState, useMemo } from 'react';
// import { 
//   Layers, 
//   Briefcase, 
//   Settings, 
//   FileCheck, 
//   Image as ImageIcon, 
//   Type as TextIcon, 
//   ListTodo as QuizIcon, 
//   Mic as MicIcon,
//   Video as VideoIcon, 
//   Plus, 
//   Trash2, 
//   Check, 
//   Calendar, 
//   Users, 
//   Layers3, 
//   UserCheck, 
//   ChevronRight, 
//   ChevronLeft,
//   Search,
//   Sparkles,
//   Award
// } from 'lucide-react';
// import { motion, AnimatePresence } from 'motion/react';
// import { 
//   AssignmentLevel, 
//   SubmissionFormat, 
//   TaskDraft, 
//   AssignedTask, 
//   Sprint, 
//   TeamMember,
//   QuizQuestion,
//   WizardStep
// } from '../types';
// import { INITIAL_SPRINTS, TEAM_MEMBERS, CORPORATE_LEVELS } from '../mockData';

// interface TaskCreatorWizardProps {
//   onTaskCreated: (newTask: AssignedTask) => void;
//   onCancel: () => void;
// }

// export default function TaskCreatorWizard({ onTaskCreated, onCancel }: TaskCreatorWizardProps) {
//   // Wizard flow step
//   const [activeStep, setActiveStep] = useState<WizardStep>('level');

//   // Draft Data State
//   const [level, setLevel] = useState<AssignmentLevel>('sprint');
//   const [taskMode, setTaskMode] = useState<'single' | 'multiple'>('single');
//   const [dueDate, setDueDate] = useState<string>(() => {
//     // Default 7 days from now
//     const date = new Date();
//     date.setDate(date.getDate() + 7);
//     return date.toISOString().split('T')[0];
//   });
//   const [recurrence, setRecurrence] = useState<'none' | 'every_2_days' | 'weekly' | 'monthly'>('none');

//   // Array of tasks to assign (supports multiple tasks together)
//   const [tasks, setTasks] = useState<TaskDraft[]>([
//     {
//       id: 'task-1',
//       title: '',
//       description: '',
//       submissionFormat: 'text',
//       questions: []
//     }
//   ]);

//   // Target Sprints list (when level === 'sprint')
//   const [selectedSprintIds, setSelectedSprintIds] = useState<string[]>([]);

//   // Target Non-Sprint Levels (when level !== 'sprint')
//   const [selectedOrgs, setSelectedOrgs] = useState<string[]>([]);
//   const [selectedFunctions, setSelectedFunctions] = useState<string[]>([]);
//   const [selectedSubFunctions, setSelectedSubFunctions] = useState<string[]>([]);
//   const [selectedIndividualIds, setSelectedIndividualIds] = useState<string[]>([]);

//   // Filter query in Audience selector
//   const [individualSearchQuery, setIndividualSearchQuery] = useState('');

//   // -------------------------
//   // Helper State management
//   // -------------------------

//   // Add empty task draft (Multiple Task support)
//   const addNewTaskDraft = () => {
//     const newId = `task-${Date.now()}`;
//     setTasks(prev => [
//       ...prev,
//       {
//         id: newId,
//         title: '',
//         description: '',
//         submissionFormat: 'text',
//         questions: []
//       }
//     ]);
//   };

//   // Remove task draft
//   const removeTaskDraft = (id: string) => {
//     if (tasks.length <= 1) return; // Must have at least 1
//     setTasks(prev => prev.filter(t => t.id !== id));
//   };

//   // Update specific fields of a task draft
//   const updateTaskField = (id: string, field: keyof TaskDraft, value: any) => {
//     setTasks(prev => prev.map(t => {
//       if (t.id === id) {
//         return { ...t, [field]: value };
//       }
//       return t;
//     }));
//   };

//   // Add Question to Quiz Editor
//   const addQuizQuestionHandler = (taskId: string) => {
//     const task = tasks.find(t => t.id === taskId);
//     if (!task) return;

//     const newQuestion: QuizQuestion = {
//       id: `q-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
//       question: '',
//       options: ['', '', '']
//     };

//     updateTaskField(taskId, 'questions', [...task.questions, newQuestion]);
//   };

//   // Update Quiz Question Option text
//   const updateQuestionOption = (taskId: string, questionId: string, optionIndex: number, text: string) => {
//     setTasks(prev => prev.map(t => {
//       if (t.id === taskId) {
//         const updatedQuestions = t.questions.map(q => {
//           if (q.id === questionId) {
//             const newOptions = [...q.options];
//             newOptions[optionIndex] = text;
//             return { ...q, options: newOptions };
//           }
//           return q;
//         });
//         return { ...t, questions: updatedQuestions };
//       }
//       return t;
//     }));
//   };

//   // Add more Option fields to specific quiz question
//   const addQuestionOptionField = (taskId: string, questionId: string) => {
//     setTasks(prev => prev.map(t => {
//       if (t.id === taskId) {
//         const updatedQuestions = t.questions.map(q => {
//           if (q.id === questionId) {
//             return { ...q, options: [...q.options, ''] };
//           }
//           return q;
//         });
//         return { ...t, questions: updatedQuestions };
//       }
//       return t;
//     }));
//   };

//   // Remove Option field
//   const removeQuestionOptionField = (taskId: string, questionId: string, indexToRemove: number) => {
//     setTasks(prev => prev.map(t => {
//       if (t.id === taskId) {
//         const updatedQuestions = t.questions.map(q => {
//           if (q.id === questionId) {
//             const newOptions = q.options.filter((_, idx) => idx !== indexToRemove);
//             return { ...q, options: newOptions };
//           }
//           return q;
//         });
//         return { ...t, questions: updatedQuestions };
//       }
//       return t;
//     }));
//   };

//   // Update Quiz Question text
//   const updateQuestionText = (taskId: string, questionId: string, text: string) => {
//     setTasks(prev => prev.map(t => {
//       if (t.id === taskId) {
//         const updatedQuestions = t.questions.map(q => {
//           if (q.id === questionId) {
//             return { ...q, question: text };
//           }
//           return q;
//         });
//         return { ...t, questions: updatedQuestions };
//       }
//       return t;
//     }));
//   };

//   // Delete entire Quiz Question
//   const deleteQuizQuestion = (taskId: string, questionId: string) => {
//     setTasks(prev => prev.map(t => {
//       if (t.id === taskId) {
//         return {
//           ...t,
//           questions: t.questions.filter(q => q.id !== questionId)
//         };
//       }
//       return t;
//     }));
//   };

//   // -------------------------
//   // Filtering algorithms for Non-Sprint Levels
//   // -------------------------

//   // Computed: Filtered functional levels based on user choices
//   const availableSubFunctions = useMemo(() => {
//     if (selectedFunctions.length === 0) return [];
//     let items: string[] = [];
//     selectedFunctions.forEach(func => {
//       const subs = CORPORATE_LEVELS.subFunctions[func as keyof typeof CORPORATE_LEVELS.subFunctions] || [];
//       items = [...items, ...subs];
//     });
//     return items;
//   }, [selectedFunctions]);

//   // Computed: Dynamic filter of Team members matching ORGs, Functions, and Sub-functions
//   const filteredTeamMembers = useMemo(() => {
//     return TEAM_MEMBERS.filter(member => {
//       // Filter by Org
//       if (selectedOrgs.length > 0 && !selectedOrgs.includes(member.org)) {
//         return false;
//       }
//       // Filter by function
//       if (selectedFunctions.length > 0 && !selectedFunctions.includes(member.function)) {
//         return false;
//       }
//       // Filter by subFunction
//       if (selectedSubFunctions.length > 0 && !selectedSubFunctions.includes(member.subFunction)) {
//         return false;
//       }
//       // Filter by search text
//       if (individualSearchQuery.trim() !== '') {
//         const searchVal = individualSearchQuery.toLowerCase();
//         return (
//           member.name.toLowerCase().includes(searchVal) ||
//           member.email.toLowerCase().includes(searchVal)
//         );
//       }
//       return true;
//     });
//   }, [selectedOrgs, selectedFunctions, selectedSubFunctions, individualSearchQuery]);

//   // Handle Multi-Select helpers
//   const toggleSelection = (item: string, list: string[], setter: React.Dispatch<React.SetStateAction<string[]>>) => {
//     if (list.includes(item)) {
//       setter(prev => prev.filter(x => x !== item));
//     } else {
//       setter(prev => [...prev, item]);
//     }
//   };

//   const handleSelectAllTeam = () => {
//     const visibleIds = filteredTeamMembers.map(m => m.id);
//     const allSelected = visibleIds.every(id => selectedIndividualIds.includes(id));
//     if (allSelected) {
//       // Deselect all visible
//       setSelectedIndividualIds(prev => prev.filter(id => !visibleIds.includes(id)));
//     } else {
//       // Select all visible (union)
//       setSelectedIndividualIds(prev => Array.from(new Set([...prev, ...visibleIds])));
//     }
//   };

//   const handleSelectPresets = (preset: 'all-hq' | 'all-engineering' | 'clear') => {
//     if (preset === 'all-hq') {
//       setSelectedOrgs(['Workfloww HQ']);
//       setSelectedFunctions([]);
//       setSelectedSubFunctions([]);
//       const ids = TEAM_MEMBERS.filter(m => m.org === 'Workfloww HQ').map(m => m.id);
//       setSelectedIndividualIds(ids);
//     } else if (preset === 'all-engineering') {
//       setSelectedOrgs([]);
//       setSelectedFunctions(['Engineering']);
//       setSelectedSubFunctions(['Frontend Engine', 'Backend Engine']);
//       const ids = TEAM_MEMBERS.filter(m => m.function === 'Engineering').map(m => m.id);
//       setSelectedIndividualIds(ids);
//     } else if (preset === 'clear') {
//       setSelectedOrgs([]);
//       setSelectedFunctions([]);
//       setSelectedSubFunctions([]);
//       setSelectedIndividualIds([]);
//     }
//   };

//   // Validation function
//   const isStepValid = (step: WizardStep): boolean => {
//     if (step === 'level') return true;
    
//     if (step === 'details') {
//       // Every task must have a title & description
//       return tasks.every(item => item.title.trim() !== '' && item.description.trim() !== '');
//     }

//     if (step === 'audience') {
//       if (level === 'sprint') {
//         return selectedSprintIds.length > 0;
//       } else {
//         // Individual level: check if at least one parameter is set
//         return (
//           selectedOrgs.length > 0 ||
//           selectedFunctions.length > 0 ||
//           selectedSubFunctions.length > 0 ||
//           selectedIndividualIds.length > 0
//         );
//       }
//     }

//     if (step === 'schedule') {
//       return dueDate.trim() !== '';
//     }

//     return true;
//   };

//   // Submit flow
//   const handleLaunchFlow = () => {
//     if (!isStepValid('level') || !isStepValid('details') || !isStepValid('audience') || !isStepValid('schedule')) {
//       alert('Please complete all configurations in the horizontal pipeline steps first.');
//       return;
//     }

//     // Map targets names
//     const targetSprintsNames = level === 'sprint' 
//       ? INITIAL_SPRINTS.filter(s => selectedSprintIds.includes(s.id)).map(s => s.title)
//       : [];

//     let totalUsers = 0;
//     if (level === 'sprint') {
//       totalUsers = selectedSprintIds.length * 15; // approximate size
//     } else {
//       totalUsers = selectedIndividualIds.length > 0 ? selectedIndividualIds.length : filteredTeamMembers.length;
//     }

//     const completedTask: AssignedTask = {
//       id: `task-assigned-${Date.now()}`,
//       level,
//       mode: taskMode,
//       tasks: tasks.map(t => ({
//         id: t.id,
//         title: t.title,
//         description: t.description,
//         submissionFormat: t.submissionFormat,
//         questions: t.questions
//       })),
//       targetSprints: targetSprintsNames,
//       targetOrgs: selectedOrgs,
//       targetFunctions: selectedFunctions,
//       targetSubFunctions: selectedSubFunctions,
//       targetIndividuals: TEAM_MEMBERS.filter(m => selectedIndividualIds.includes(m.id)).map(m => m.name),
//       dueDate,
//       createdAt: new Date().toISOString().split('T')[0],
//       status: 'Active',
//       completionCount: 0,
//       totalTargetUsersCount: totalUsers > 0 ? totalUsers : 1,
//       recurrence
//     };

//     onTaskCreated(completedTask);
//   };

//   const stepsList: { id: WizardStep; label: string; desc: string }[] = [
//     { id: 'level', label: '1. Target Scope', desc: 'Select organization assignment level' },
//     { id: 'details', label: '2. Task Specifications', desc: 'Define objectives and formats' },
//     { id: 'audience', label: '3. Recipient Filters', desc: 'Specify users or team units' },
//     { id: 'schedule', label: '4. Timeline Assignment', desc: 'Set deadline and deploy' }
//   ];

//   return (
//     <div className="flex flex-col xl:flex-row gap-6 w-full max-w-7xl mx-auto min-h-[580px]">
      
//       {/* LEFT PORTION: The horizontal form container */}
//       <div className="flex-1 bg-white rounded-2xl border border-[#E2E8F0] shadow-sm flex flex-col overflow-hidden">
        
//         {/* Banner with color matching photo */}
//         <div className="bg-[#2F63FF] px-6 py-5 text-white flex items-center justify-between">
//           <div>
//             <span className="font-mono text-[10px] tracking-widest uppercase opacity-80 block mb-0.5">👑 ADMINISTRATOR WORKSPACE</span>
//             <h2 className="font-display font-medium text-lg tracking-tight">Task Flow Configuration Console</h2>
//           </div>
//           <div className="bg-white/10 px-3 py-1 rounded-full text-xs font-mono font-medium flex items-center space-x-1.5 backdrop-blur-md">
//             <Sparkles size={13} />
//             <span>Designer Mode</span>
//           </div>
//         </div>

//         {/* Horizontal Navigation Stepper */}
//         <div className="border-b border-[#F1F5F9] bg-[#FAFBFD] px-6 py-3 overflow-x-auto">
//           <div className="flex items-center min-w-[640px] justify-between relative">
//             {stepsList.map((step, index) => {
//               const isActive = activeStep === step.id;
//               const isPast = stepsList.findIndex(s => s.id === activeStep) > index;
              
//               return (
//                 <div key={step.id} className="flex items-center flex-1 last:flex-initial">
//                   <button
//                     onClick={() => {
//                       // Allow traveling to previous step or valid next steps
//                       setActiveStep(step.id);
//                     }}
//                     className="flex items-center space-x-3 text-left focus:outline-none cursor-pointer group py-1.5"
//                   >
//                     <div className={`w-8 h-8 rounded-full flex items-center justify-center font-display text-xs font-semibold border transition-all ${
//                       isActive 
//                         ? 'bg-[#2F63FF] text-white border-[#2F63FF] shadow-sm ring-4 ring-indigo-50'
//                         : isPast 
//                           ? 'bg-[#E1F9F0] text-[#10B981] border-[#10B981]'
//                           : 'bg-white text-[#64748B] border-[#E2E8F0]'
//                     }`}>
//                       {isPast ? <Check size={14} className="stroke-[3]" /> : index + 1}
//                     </div>
//                     <div>
//                       <p className={`text-xs font-semibold whitespace-nowrap leading-none transition-colors ${
//                         isActive ? 'text-[#2F63FF]' : 'text-[#334155]'
//                       }`}>
//                         {step.label}
//                       </p>
//                       <span className="text-[10px] text-gray-500 whitespace-nowrap block mt-0.5 font-sans">
//                         {step.desc}
//                       </span>
//                     </div>
//                   </button>
//                   {index < stepsList.length - 1 && (
//                     <div className="mx-4 flex-1 h-[2px] bg-[#E2E8F0] relative">
//                       <div className={`absolute top-0 left-0 h-full bg-[#2F63FF] transition-all duration-300 ${
//                         isPast ? 'w-full' : 'w-0'
//                       }`} />
//                     </div>
//                   )}
//                 </div>
//               );
//             })}
//           </div>
//         </div>

//         {/* Workspace Active Step */}
//         <div className="p-6 flex-1 bg-white relative overflow-y-auto max-h-[600px]">
//           <AnimatePresence mode="wait">
//             <motion.div
//               key={activeStep}
//               initial={{ opacity: 0, x: 20 }}
//               animate={{ opacity: 1, x: 0 }}
//               exit={{ opacity: 0, x: -20 }}
//               transition={{ duration: 0.18 }}
//               className="space-y-6"
//             >
              
//               {/* STEP 1: LEVEL and MODE */}
//               {activeStep === 'level' && (
//                 <div className="space-y-6">
//                   <div>
//                     <h3 className="text-sm font-semibold text-[#0F172A] mb-1 font-display">Target Workflow Assignment Level</h3>
//                     <p className="text-xs text-gray-500 font-sans">Determine if this workflow applies at the general sprint map hierarchy or targets precise organizational individual/department focus groups.</p>
//                   </div>

//                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
//                     {/* Sprint card */}
//                     <button
//                       onClick={() => setLevel('sprint')}
//                       className={`p-5 rounded-2xl text-left border cursor-pointer transition-all flex items-start space-x-4 ${
//                         level === 'sprint'
//                           ? 'border-[#2F63FF] bg-[#EEF2FF] shadow-sm shadow-blue-50'
//                           : 'border-[#E2E8F0] hover:border-gray-300 hover:bg-slate-50'
//                       }`}
//                     >
//                       <div className={`p-3 rounded-xl ${level === 'sprint' ? 'bg-[#2F63FF] text-white' : 'bg-gray-100 text-gray-600'}`}>
//                         <Layers size={22} />
//                       </div>
//                       <div className="flex-1">
//                         <span className="text-xs font-semibold text-[#0F172A] font-sans block">Curricular Sprint Level 🏫</span>
//                         <p className="text-[11px] text-gray-500 mt-1 font-sans">Deploy this process to all members associated with general classroom sprint map metrics automatically.</p>
//                         {level === 'sprint' && (
//                           <span className="inline-flex items-center text-[10px] text-[#2F63FF] bg-white border border-[#2F63FF]/30 px-2 py-0.5 rounded-full font-sans mt-3 font-semibold">
//                             <Check size={10} className="mr-1 inline stroke-[3]" /> Selected
//                           </span>
//                         )}
//                       </div>
//                     </button>
 
//                     {/* Organization matrices card */}
//                     <button
//                       onClick={() => setLevel('individual')}
//                       className={`p-5 rounded-2xl text-left border cursor-pointer transition-all flex items-start space-x-4 ${
//                         level !== 'sprint'
//                           ? 'border-[#2F63FF] bg-[#EEF2FF] shadow-sm shadow-blue-50'
//                           : 'border-[#E2E8F0] hover:border-gray-300 hover:bg-slate-50'
//                       }`}
//                     >
//                       <div className={`p-3 rounded-xl ${level !== 'sprint' ? 'bg-[#2F63FF] text-white' : 'bg-gray-100 text-gray-600'}`}>
//                         <Briefcase size={22} />
//                       </div>
//                       <div className="flex-1">
//                         <span className="text-xs font-semibold text-[#0F172A] font-sans block">Granular Organizational Targeting 👥</span>
//                         <p className="text-[11px] text-gray-500 mt-1 font-sans">Apply advanced business filters to target specified individual employees, focus functions, branches or sub-divisions.</p>
//                         {level !== 'sprint' && (
//                           <span className="inline-flex items-center text-[10px] text-[#2F63FF] bg-white border border-[#2F63FF]/30 px-2 py-0.5 rounded-full font-sans mt-3 font-semibold">
//                             <Check size={10} className="mr-1 inline stroke-[3]" /> Selected
//                           </span>
//                         )}
//                       </div>
//                     </button>
//                   </div>

//                   <div className="border-t border-[#F1F5F9] pt-5">
//                     <h3 className="text-sm font-semibold text-[#0F172A] mb-1 font-display">Work Module Structure</h3>
//                     <p className="text-xs text-gray-500 font-sans mb-4">Determine if you would like to deploy a single primary action or a bundle containing multiple custom checklist actions.</p>

//                     <div className="grid grid-cols-2 gap-3 p-1 bg-[#F1F5F9] rounded-xl self-start max-w-md">
//                       <button
//                         onClick={() => {
//                           setTaskMode('single');
//                           if (tasks.length > 1) {
//                             setTasks([tasks[0]]);
//                           }
//                         }}
//                         className={`py-3 text-xs font-medium rounded-lg transition-all cursor-pointer flex items-center justify-center space-x-2 ${
//                           taskMode === 'single'
//                             ? 'bg-white text-[#2F63FF] shadow-sm'
//                             : 'text-[#64748B] hover:text-[#0F172A]'
//                         }`}
//                       >
//                         <FileCheck size={15} />
//                         <span>Single Task Module</span>
//                       </button>
//                       <button
//                         onClick={() => {
//                           setTaskMode('multiple');
//                         }}
//                         className={`py-3 text-xs font-medium rounded-lg transition-all cursor-pointer flex items-center justify-center space-x-2 ${
//                           taskMode === 'multiple'
//                             ? 'bg-white text-[#2F63FF] shadow-sm'
//                             : 'text-[#64748B] hover:text-[#0F172A]'
//                         }`}
//                       >
//                         <Settings size={15} />
//                         <span>Multi-Task Bundle</span>
//                       </button>
//                     </div>
//                   </div>
//                 </div>
//               )}

//               {/* STEP 2: DETAILS */}
//               {activeStep === 'details' && (
//                 <div className="space-y-6">
//                   <div className="flex items-center justify-between">
//                     <div>
//                       <h3 className="text-sm font-semibold text-[#0F172A] font-display font-bold">Configure Task Specifications 📝</h3>
//                       <p className="text-xs text-gray-500 mt-0.5 font-sans">Name the task, define professional operational instructions, and specify fulfillment validation requirements.</p>
//                     </div>
//                     {taskMode === 'multiple' && (
//                       <button
//                         type="button"
//                         onClick={addNewTaskDraft}
//                         className="inline-flex items-center space-x-1 px-3 py-1.5 h-8 bg-[#EEF2FF] text-[#2F63FF] hover:bg-[#E0E7FF] transition-all text-xs font-semibold rounded-lg cursor-pointer"
//                       >
//                         <Plus size={14} />
//                         <span>Add Checklist Item</span>
//                       </button>
//                     )}
//                   </div>

//                   <div className="space-y-6">
//                     {tasks.map((taskItem, idx) => (
//                       <div 
//                         key={taskItem.id} 
//                         className="p-5 border border-[#E2E8F0] rounded-2xl bg-[#FBFDFE] relative focus-within:ring-2 focus-within:ring-[#2F63FF]/20 focus-within:border-[#2F63FF] transition-all"
//                       >
//                         {taskMode === 'multiple' && (
//                           <div className="absolute top-4 right-4 flex items-center space-x-2">
//                             <span className="text-[10px] font-sans text-[#2F63FF] bg-[#EEF2FF] px-2 py-0.5 rounded-full font-semibold">
//                               Task Block #{idx + 1}
//                             </span>
//                             {tasks.length > 1 && (
//                               <button
//                                 type="button"
//                                 onClick={() => removeTaskDraft(taskItem.id)}
//                                 className="text-gray-400 hover:text-red-500 p-1.5 transition-colors cursor-pointer"
//                                 title="Remove this task"
//                               >
//                                 <Trash2 size={13} />
//                               </button>
//                             )}
//                           </div>
//                         )}

//                         <div className="space-y-4">
//                           {/* Title input */}
//                           <div className="space-y-1">
//                             <label className="text-xs font-bold text-[#334155] block">
//                               Task / Module Name <span className="text-red-500">*</span>
//                             </label>
//                             <input
//                               type="text"
//                               value={taskItem.title}
//                               onChange={(e) => updateTaskField(taskItem.id, 'title', e.target.value)}
//                               placeholder="e.g., Standard Operating Procedures Review / Code Quality Assurance Audit"
//                               className="w-full text-xs text-[#0F172A] border border-[#E2E8F0] bg-white rounded-xl py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-[#2F63FF] focus:bg-white placeholder-gray-400"
//                               id={`title-${taskItem.id}`}
//                             />
//                           </div>

//                           {/* Description field */}
//                           <div className="space-y-1">
//                             <label className="text-xs font-bold text-[#334155] block">
//                               Fulfillment Instructions <span className="text-red-500">*</span>
//                             </label>
//                             <textarea
//                               rows={3}
//                               value={taskItem.description}
//                               onChange={(e) => updateTaskField(taskItem.id, 'description', e.target.value)}
//                               placeholder="Define standard instructions, constraints, and clear objective metrics to guide users toward successful completion."
//                               className="w-full text-xs text-[#0F172A] border border-[#E2E8F0] bg-white rounded-xl py-2 px-3 focus:outline-none focus:ring-2 focus:ring-[#2F63FF] focus:bg-white placeholder-gray-400 font-sans"
//                             />
//                           </div>

//                           {/* Submission Format Selection */}
//                           <div className="space-y-2">
//                             <label className="text-xs font-bold text-[#334155] block">
//                               Submission Format Verification Requirement
//                             </label>
//                             <p className="text-[11px] text-gray-500">Pick the validation format that recipients must register to submit their task flow completion:</p>
                            
//                             <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
//                               {/* Submit Image */}
//                               <button
//                                 type="button"
//                                 onClick={() => updateTaskField(taskItem.id, 'submissionFormat', 'image')}
//                                 className={`p-3 rounded-xl border text-left flex flex-col sm:flex-row items-center justify-center sm:justify-start space-y-1 sm:space-y-0 sm:space-x-1 cursor-pointer transition-colors ${
//                                   taskItem.submissionFormat === 'image'
//                                     ? 'border-[#2F63FF] bg-[#2F63FF]/5 text-[#2F63FF]'
//                                     : 'border-[#E2E8F0] hover:bg-slate-50 text-gray-600'
//                                 }`}
//                               >
//                                 <ImageIcon size={14} className="shrink-0" />
//                                 <span className="text-[10px] font-semibold font-sans truncate text-center sm:text-left">Image</span>
//                               </button>

//                               {/* Submit Text */}
//                               <button
//                                 type="button"
//                                 onClick={() => updateTaskField(taskItem.id, 'submissionFormat', 'text')}
//                                 className={`p-3 rounded-xl border text-left flex flex-col sm:flex-row items-center justify-center sm:justify-start space-y-1 sm:space-y-0 sm:space-x-1 cursor-pointer transition-colors ${
//                                   taskItem.submissionFormat === 'text'
//                                     ? 'border-[#2F63FF] bg-[#2F63FF]/5 text-[#2F63FF]'
//                                     : 'border-[#E2E8F0] hover:bg-slate-50 text-gray-600'
//                                 }`}
//                               >
//                                 <TextIcon size={14} className="shrink-0" />
//                                 <span className="text-[10px] font-semibold font-sans truncate text-center sm:text-left">Text Entry</span>
//                               </button>

//                               {/* Submit Quiz Form */}
//                               <button
//                                 type="button"
//                                 onClick={() => updateTaskField(taskItem.id, 'submissionFormat', 'multiple_choice')}
//                                 className={`p-3 rounded-xl border text-left flex flex-col sm:flex-row items-center justify-center sm:justify-start space-y-1 sm:space-y-0 sm:space-x-1 cursor-pointer transition-colors ${
//                                   taskItem.submissionFormat === 'multiple_choice'
//                                     ? 'border-[#2F63FF] bg-[#2F63FF]/5 text-[#2F63FF]'
//                                     : 'border-[#E2E8F0] hover:bg-slate-50 text-gray-600'
//                                 }`}
//                               >
//                                 <QuizIcon size={14} className="shrink-0" />
//                                 <span className="text-[10px] font-semibold font-sans truncate text-center sm:text-left">Evaluation</span>
//                               </button>

//                               {/* Submit Audio */}
//                               <button
//                                 type="button"
//                                 onClick={() => updateTaskField(taskItem.id, 'submissionFormat', 'audio')}
//                                 className={`p-3 rounded-xl border text-left flex flex-col sm:flex-row items-center justify-center sm:justify-start space-y-1 sm:space-y-0 sm:space-x-1 cursor-pointer transition-colors ${
//                                   taskItem.submissionFormat === 'audio'
//                                     ? 'border-[#2F63FF] bg-[#2F63FF]/5 text-[#2F63FF]'
//                                     : 'border-[#E2E8F0] hover:bg-slate-50 text-gray-600'
//                                 }`}
//                               >
//                                 <MicIcon size={14} className="shrink-0" />
//                                 <span className="text-[10px] font-semibold font-sans truncate text-center sm:text-left">Audio</span>
//                               </button>

//                               {/* Submit Video */}
//                               <button
//                                 type="button"
//                                 onClick={() => updateTaskField(taskItem.id, 'submissionFormat', 'video')}
//                                 className={`p-3 rounded-xl border text-left flex flex-col sm:flex-row items-center justify-center sm:justify-start space-y-1 sm:space-y-0 sm:space-x-1 cursor-pointer transition-colors ${
//                                   taskItem.submissionFormat === 'video'
//                                     ? 'border-[#2F63FF] bg-[#2F63FF]/5 text-[#2F63FF]'
//                                     : 'border-[#E2E8F0] hover:bg-slate-50 text-gray-600'
//                                 }`}
//                               >
//                                 <VideoIcon size={14} className="shrink-0" />
//                                 <span className="text-[10px] font-semibold font-sans truncate text-center sm:text-left">Video</span>
//                               </button>
//                             </div>
//                           </div>

//                           {/* MULTIPLE CHOICE FORM BUILDER */}
//                           {taskItem.submissionFormat === 'multiple_choice' && (
//                             <div className="bg-slate-50 rounded-xl p-4 border border-[#E2E8F0] space-y-4">
//                               <div className="flex items-center justify-between">
//                                 <span className="text-xs font-bold text-[#0F172A] flex items-center space-x-2">
//                                   <QuizIcon size={14} className="text-[#2F63FF]" />
//                                   <span>Questions Generator ({taskItem.questions.length})</span>
//                                 </span>
//                                 <button
//                                   type="button"
//                                   onClick={() => addQuizQuestionHandler(taskItem.id)}
//                                   className="text-[11px] font-semibold text-[#2F63FF] hover:underline flex items-center space-x-1 cursor-pointer"
//                                 >
//                                   <Plus size={12} />
//                                   <span>Add Question</span>
//                                 </button>
//                               </div>

//                               {taskItem.questions.length === 0 ? (
//                                 <div className="text-center py-6 border border-dashed border-[#CBD5E1] rounded-lg bg-white">
//                                   <QuizIcon className="mx-auto text-gray-300 mb-2" size={24} />
//                                   <p className="text-xs text-gray-500">Configure multi-choice questions for verification</p>
//                                   <button
//                                     type="button"
//                                     onClick={() => addQuizQuestionHandler(taskItem.id)}
//                                     className="text-xs font-semibold text-[#2F63FF] mt-2 inline-flex items-center space-x-1"
//                                   >
//                                     <Plus size={12} /> <span>Create first question</span>
//                                   </button>
//                                 </div>
//                               ) : (
//                                 <div className="space-y-4">
//                                   {taskItem.questions.map((quizQ, qIdx) => (
//                                     <div key={quizQ.id} className="p-3 bg-white border border-[#E2E8F0] rounded-lg space-y-3 relative">
//                                       <button
//                                         type="button"
//                                         onClick={() => deleteQuizQuestion(taskItem.id, quizQ.id)}
//                                         className="absolute top-2.5 right-2.5 text-gray-400 hover:text-red-500 p-1 cursor-pointer"
//                                       >
//                                         <Trash2 size={12} />
//                                       </button>

//                                       <div className="space-y-1.5 pr-6">
//                                         <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest block font-mono">
//                                           Question {qIdx + 1}
//                                         </label>
//                                         <input
//                                           type="text"
//                                           value={quizQ.question}
//                                           onChange={(e) => updateQuestionText(taskItem.id, quizQ.id, e.target.value)}
//                                           placeholder="Enter the quiz question..."
//                                           className="w-full text-xs text-[#0F172A] border-b border-[#F1F5F9] focus:border-[#2F63FF] py-1.5 focus:outline-none placeholder-gray-400"
//                                         />
//                                       </div>

//                                       <div className="space-y-2">
//                                         <label className="text-[10px] font-bold text-gray-500 block">Available Selection Options:</label>
//                                         <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
//                                           {quizQ.options.map((opt, optIdx) => (
//                                             <div key={optIdx} className="flex items-center space-x-1.5">
//                                               <span className="text-[10px] font-mono font-semibold bg-[#EEF2FF] text-[#2F63FF] rounded w-5 h-5 flex items-center justify-center">
//                                                 {String.fromCharCode(65 + optIdx)}
//                                               </span>
//                                               <input
//                                                 type="text"
//                                                 value={opt}
//                                                 onChange={(e) => updateQuestionOption(taskItem.id, quizQ.id, optIdx, e.target.value)}
//                                                 placeholder={`Option ${optIdx + 1}`}
//                                                 className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#2F63FF]"
//                                               />
//                                               {quizQ.options.length > 2 && (
//                                                 <button
//                                                   type="button"
//                                                   onClick={() => removeQuestionOptionField(taskItem.id, quizQ.id, optIdx)}
//                                                   className="text-gray-400 hover:text-red-500"
//                                                   title="Delete Option"
//                                                 >
//                                                   &times;
//                                                 </button>
//                                               )}
//                                             </div>
//                                           ))}
//                                         </div>
//                                         {quizQ.options.length < 6 && (
//                                           <button
//                                             type="button"
//                                             onClick={() => addQuestionOptionField(taskItem.id, quizQ.id)}
//                                             className="text-[10px] font-semibold text-gray-500 hover:text-[#2F63FF] transition-all flex items-center space-x-1"
//                                           >
//                                             <Plus size={10} />
//                                             <span>Add more choices</span>
//                                           </button>
//                                         )}
//                                       </div>
//                                     </div>
//                                   ))}
//                                 </div>
//                               )}
//                             </div>
//                           )}

//                         </div>
//                       </div>
//                     ))}
//                   </div>
//                 </div>
//               )}

//               {/* STEP 3: AUDIENCE ASSIGNMENT */}
//               {activeStep === 'audience' && (
//                 <div className="space-y-6">
//                   <div>
//                     <h3 className="text-sm font-semibold text-[#0F172A] font-display font-bold">Designate Recipient Audience</h3>
//                     <p className="text-xs text-gray-500 mt-0.5 font-sans">
//                       {level === 'sprint' 
//                         ? "Select which active sprint cycles should be mapped to this workflow process." 
//                         : "Define target parameters below to assign direct business divisions, departments, or custom individual employees."}
//                     </p>
//                   </div>

//                   {level === 'sprint' ? (
//                     /* SPRINT LEVEL CONFIG */
//                     <div className="space-y-3">
//                       <label className="text-xs font-bold text-[#334155] block">Classroom Groups / Sprints</label>
//                       <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
//                         {INITIAL_SPRINTS.map((sprint) => {
//                           const isSelected = selectedSprintIds.includes(sprint.id);
//                           return (
//                             <button
//                               key={sprint.id}
//                               onClick={() => toggleSelection(sprint.id, selectedSprintIds, setSelectedSprintIds)}
//                               className={`p-4 rounded-xl border text-left cursor-pointer transition-all flex items-center justify-between ${
//                                 isSelected
//                                   ? 'border-[#2F63FF] bg-[#2F63FF]/5 shadow-sm shadow-indigo-50/50'
//                                   : 'border-[#E2E8F0] hover:bg-slate-50'
//                               }`}
//                             >
//                               <div className="flex items-center space-x-3">
//                                 <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
//                                   isSelected ? 'bg-[#2F63FF] text-white' : 'bg-gray-100 text-[#475569]'
//                                 }`}>
//                                   <Layers3 size={15} />
//                                 </div>
//                                 <div>
//                                   <p className="text-xs font-semibold text-[#0F172A]">{sprint.title}</p>
//                                   <span className="text-[10px] font-mono text-gray-500">{sprint.code} • {sprint.status}</span>
//                                 </div>
//                               </div>
//                               <div className={`w-5 h-5 rounded-md border flex items-center justify-center ${
//                                 isSelected ? 'bg-[#2F63FF] border-[#2F63FF] text-white' : 'border-gray-300'
//                               }`}>
//                                 {isSelected && <Check size={12} className="stroke-[3]" />}
//                               </div>
//                             </button>
//                           );
//                         })}
//                       </div>
//                     </div>
//                   ) : (
//                     /* COMPREHENSIVE SEGMENTATION ROUTER (Non-Sprint) */
//                     <div className="space-y-4">
                      
//                       {/* Presets and filters bar */}
//                       <div className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-[#E2E8F0]">
//                         <span className="text-[11px] font-bold text-gray-500 uppercase tracking-widest font-mono">Audience Selection Shortcuts:</span>
//                         <div className="flex items-center space-x-2">
//                           <button
//                             type="button"
//                             onClick={() => handleSelectPresets('all-hq')}
//                             className="bg-white hover:bg-[#EEF2FF] border border-gray-200 text-gray-700 text-[10px] font-semibold px-2 py-1 rounded transition-colors cursor-pointer"
//                           >
//                             HQ Office Team
//                           </button>
//                           <button
//                             type="button"
//                             onClick={() => handleSelectPresets('all-engineering')}
//                             className="bg-white hover:bg-[#EEF2FF] border border-gray-100 text-gray-700 text-[10px] font-semibold px-2 py-1 rounded transition-colors cursor-pointer"
//                           >
//                             All Builders Team
//                           </button>
//                           <button
//                             type="button"
//                             onClick={() => handleSelectPresets('clear')}
//                             className="bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 text-[10px] font-semibold px-2 py-1 rounded transition-colors cursor-pointer"
//                           >
//                             Reset Selection 🧹
//                           </button>
//                         </div>
//                       </div>

//                       {/* Segmentation Panels */}
//                       <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        
//                         {/* 1. Organizations Matrix */}
//                         <div className="p-3 border border-gray-200 rounded-xl bg-white space-y-2">
//                           <span className="text-xs font-bold text-[#334155] block">🏠 Target Branch</span>
//                           <div className="space-y-1">
//                             {CORPORATE_LEVELS.orgs.map((org) => {
//                               const selected = selectedOrgs.includes(org);
//                               return (
//                                 <button
//                                   key={org}
//                                   onClick={() => toggleSelection(org, selectedOrgs, setSelectedOrgs)}
//                                   className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs leading-none cursor-pointer transition-colors ${
//                                     selected ? 'bg-[#EEF2FF] text-[#2F63FF] font-medium' : 'hover:bg-slate-50 text-gray-600'
//                                   }`}
//                                 >
//                                   <span>{org}</span>
//                                   {selected && <Check size={12} className="text-[#2F63FF]" />}
//                                 </button>
//                               );
//                             })}
//                           </div>
//                         </div>

//                         {/* 2. Functions Node */}
//                         <div className="p-3 border border-gray-200 rounded-xl bg-white space-y-2">
//                           <span className="text-xs font-bold text-[#334155] block">🏢 Target Department</span>
//                           <div className="space-y-1">
//                             {CORPORATE_LEVELS.functions.map((func) => {
//                               const selected = selectedFunctions.includes(func);
//                               return (
//                                 <button
//                                   key={func}
//                                   onClick={() => toggleSelection(func, selectedFunctions, setSelectedFunctions)}
//                                   className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs leading-none cursor-pointer transition-colors ${
//                                     selected ? 'bg-[#EEF2FF] text-[#2F63FF] font-medium' : 'hover:bg-slate-50 text-gray-600'
//                                   }`}
//                                 >
//                                   <span>{func}</span>
//                                   {selected && <Check size={12} className="text-[#2F63FF]" />}
//                                 </button>
//                               );
//                             })}
//                           </div>
//                         </div>

//                         {/* 3. Sub-Functions Node */}
//                         <div className="p-3 border border-gray-200 rounded-xl bg-white space-y-2">
//                           <span className="text-xs font-bold text-[#334155] block">🛠️ Target Unit / Focus Group</span>
//                           {selectedFunctions.length === 0 ? (
//                             <div className="p-4 text-center border border-dashed border-gray-100 rounded-lg">
//                               <p className="text-[10px] text-gray-400">Pick a Department first to see focus teams!</p>
//                             </div>
//                           ) : (
//                             <div className="space-y-1">
//                               {availableSubFunctions.map((subF) => {
//                                 const selected = selectedSubFunctions.includes(subF);
//                                         return (
//                                   <button
//                                     key={subF}
//                                     onClick={() => toggleSelection(subF, selectedSubFunctions, setSelectedSubFunctions)}
//                                     className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs leading-none cursor-pointer transition-colors ${
//                                       selected ? 'bg-[#EEF2FF] text-[#2F63FF] font-medium' : 'hover:bg-slate-50 text-gray-600'
//                                     }`}
//                                   >
//                                     <span>{subF}</span>
//                                     {selected && <Check size={12} className="text-[#2F63FF]" />}
//                                   </button>
//                                 );
//                               })}
//                             </div>
//                           )}
//                         </div>

//                       </div>

//                       {/* 4. Filtered Individuals Selection */}
//                       <div className="border border-gray-200 rounded-xl p-4 bg-slate-50/50 space-y-3">
//                         <div className="sm:flex sm:items-center sm:justify-between space-y-2 sm:space-y-0">
//                           <div>
//                             <span className="text-xs font-bold text-[#334155] block">Select Targeted Personnel ({selectedIndividualIds.length} Selected)</span>
//                             <p className="text-[10px] text-gray-500">Displays direct staff matching the branch and department matrices chosen above.</p>
//                           </div>
                          
//                           <div className="flex items-center space-x-2">
//                             {/* Search */}
//                             <div className="relative">
//                               <Search className="absolute left-2.5 top-2 text-gray-400" size={13} />
//                               <input
//                                 type="text"
//                                 value={individualSearchQuery}
//                                 onChange={(e) => setIndividualSearchQuery(e.target.value)}
//                                 placeholder="Search personnel..."
//                                 className="bg-white border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#2F63FF] w-48"
//                               />
//                             </div>
                            
//                             <button
//                               type="button"
//                               onClick={handleSelectAllTeam}
//                               className="text-xs font-semibold text-[#2F63FF] border border-gray-200 hover:bg-white bg-white px-3 py-1.5 rounded-lg cursor-pointer max-sm:w-full text-center"
//                             >
//                               Select All Listed ({filteredTeamMembers.length})
//                             </button>
//                           </div>
//                         </div>

//                         {filteredTeamMembers.length === 0 ? (
//                           <div className="p-8 text-center bg-white border border-dashed border-gray-200 rounded-lg">
//                             <p className="text-xs text-gray-400">No personnel match the current criteria.</p>
//                           </div>
//                         ) : (
//                           <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-[180px] overflow-y-auto">
//                             {filteredTeamMembers.map((member) => {
//                               const isChecked = selectedIndividualIds.includes(member.id);
//                               return (
//                                 <button
//                                   key={member.id}
//                                   onClick={() => toggleSelection(member.id, selectedIndividualIds, setSelectedIndividualIds)}
//                                   className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all flex items-center justify-between ${
//                                     isChecked
//                                       ? 'border-[#2F63FF] bg-white shadow-sm ring-2 ring-indigo-50/50'
//                                       : 'border-gray-200 hover:border-gray-300 bg-white'
//                                   }`}
//                                 >
//                                   <div className="flex items-center space-x-2.5 min-w-0">
//                                     <img 
//                                       src={member.avatar} 
//                                       alt={member.name} 
//                                       referrerPolicy="no-referrer"
//                                       className="w-8 h-8 rounded-full bg-slate-100 object-cover" 
//                                     />
//                                     <div className="min-w-0">
//                                       <p className="text-xs font-semibold text-[#0F172A] truncate leading-none">{member.name}</p>
//                                       <span className="text-[9px] text-[#2F63FF] font-mono block mt-1 uppercase tracking-tight">{member.function} • {member.subFunction}</span>
//                                     </div>
//                                   </div>
//                                   <div className={`w-4.5 h-4.5 rounded-full border flex items-center justify-center ${
//                                     isChecked ? 'bg-[#2F63FF] border-[#2F63FF] text-white' : 'border-gray-300'
//                                   }`}>
//                                     {isChecked && <Check size={10} className="stroke-[3]" />}
//                                   </div>
//                                 </button>
//                               );
//                             })}
//                           </div>
//                         )}
//                       </div>

//                     </div>
//                   )}

//                 </div>
//               )}

//               {/* STEP 4: DUE DATE AND SCHEDULE */}
//               {activeStep === 'schedule' && (
//                 <div className="space-y-6">
//                   <div>
//                     <h3 className="text-sm font-semibold text-[#0F172A] font-display font-bold">Schedule Delivery & Due Date</h3>
//                     <p className="text-xs text-gray-500 mt-0.5 font-sans">Establish target completion deadlines and verify configurations on the pipeline summary panel.</p>
//                   </div>

//                   <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
//                     {/* Date Picker Component */}
//                     <div className="p-5 border border-gray-200 rounded-2xl bg-white space-y-5">
//                       <div className="space-y-3">
//                         <span className="text-xs font-bold text-[#334155] flex items-center space-x-1.5">
//                           <Calendar size={15} className="text-[#2F63FF]" />
//                           <span>Completion Deadline</span>
//                         </span>
                        
//                         <input
//                           type="date"
//                           value={dueDate}
//                           onChange={(e) => setDueDate(e.target.value)}
//                           className="w-full text-xs text-[#0F172A] border border-[#E2E8F0] rounded-xl py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-[#2F63FF] focus:bg-white"
//                         />

//                         {/* Relative shortcuts */}
//                         <div className="grid grid-cols-2 gap-2">
//                           <button
//                             type="button"
//                             onClick={() => {
//                               const d = new Date();
//                               d.setDate(d.getDate() + 1);
//                               setDueDate(d.toISOString().split('T')[0]);
//                             }}
//                             className="bg-slate-50 hover:bg-[#EEF2FF] text-[#2F63FF] border border-gray-100 p-2.5 text-center text-xs font-medium rounded-lg transition-colors cursor-pointer"
//                           >
//                             Due Tomorrow
//                           </button>
//                           <button
//                             type="button"
//                             onClick={() => {
//                               const d = new Date();
//                               d.setDate(d.getDate() + 7);
//                               setDueDate(d.toISOString().split('T')[0]);
//                             }}
//                             className="bg-slate-50 hover:bg-[#EEF2FF] text-[#2F63FF] border border-gray-100 p-2.5 text-center text-xs font-medium rounded-lg transition-colors cursor-pointer"
//                           >
//                             7-Day Deadline
//                           </button>
//                           <button
//                             type="button"
//                             onClick={() => {
//                               const d = new Date();
//                               d.setDate(d.getDate() + 14);
//                               setDueDate(d.toISOString().split('T')[0]);
//                             }}
//                             className="bg-slate-50 hover:bg-[#EEF2FF] text-[#2F63FF] border border-gray-100 p-2.5 text-center text-xs font-medium rounded-lg transition-colors cursor-pointer"
//                           >
//                             14-Day Deadline
//                           </button>
//                           <button
//                             type="button"
//                             onClick={() => {
//                               // End of Sprint Mock
//                               setDueDate('2026-06-30');
//                             }}
//                             className="bg-slate-50 hover:bg-[#EEF2FF] text-[#2F63FF] border border-gray-100 p-2.5 text-center text-xs font-medium rounded-lg transition-colors cursor-pointer"
//                           >
//                             End of Month
//                           </button>
//                         </div>
//                       </div>

//                       {/* Recurrence Options */}
//                       <div className="border-t border-[#F1F5F9] pt-4 space-y-3">
//                         <span className="text-xs font-bold text-[#334155] flex items-center space-x-1.5">
//                           <span className="text-base">🔁</span>
//                           <span>Fulfillment Recurrence Schedule</span>
//                         </span>
//                         <p className="text-[11px] text-gray-500 leading-normal font-sans">
//                           Automate workflow checklist repetition. Setting a schedule creates recurring checkpoints.
//                         </p>
                        
//                         <div className="grid grid-cols-2 gap-2">
//                           {[
//                             { id: 'none', label: 'One-time Task', desc: 'No recurrence pattern' },
//                             { id: 'every_2_days', label: 'Every 2 Days', desc: 'Interval recurrence' },
//                             { id: 'weekly', label: 'Weekly Repeat', desc: 'Runs every 7 days' },
//                             { id: 'monthly', label: 'Monthly Repeat', desc: 'Runs every calendar month' }
//                           ].map((item) => {
//                             const isSelectedRec = recurrence === item.id;
//                             return (
//                               <button
//                                 key={item.id}
//                                 type="button"
//                                 onClick={() => setRecurrence(item.id as any)}
//                                 className={`p-2.5 rounded-xl border text-left cursor-pointer transition-colors flex flex-col justify-between ${
//                                   isSelectedRec
//                                     ? 'border-[#2F63FF] bg-[#2F63FF]/5 text-[#2F63FF]'
//                                     : 'border-[#E2E8F0] hover:bg-slate-50 text-gray-600'
//                                 }`}
//                               >
//                                 <span className="text-xs font-semibold leading-tight">{item.label}</span>
//                                 <span className={`text-[9px] block mt-1 ${isSelectedRec ? 'text-[#2F63FF]/80' : 'text-gray-400'}`}>
//                                   {item.desc}
//                                 </span>
//                               </button>
//                             );
//                           })}
//                         </div>
//                       </div>
//                     </div>

//                     {/* Summary Card */}
//                     <div className="p-5 bg-gradient-to-br from-[#0F172A] to-[#1E293B] text-white rounded-2xl space-y-4">
//                       <span className="text-[10px] uppercase font-bold tracking-widest text-[#2F63FF] block font-mono">PIPELINE VERIFICATION SUMMARY</span>
                      
//                       <div className="space-y-4 text-xs">
//                         <div className="flex justify-between border-b border-white/10 pb-2">
//                           <span className="text-gray-400">Target Type</span>
//                           <span className="font-mono text-[#E0E7FF] font-semibold uppercase">{level}</span>
//                         </div>
//                         <div className="flex justify-between border-b border-white/10 pb-2">
//                           <span className="text-gray-400">Workflow Mode</span>
//                           <span className="font-mono text-[#E0E7FF] font-semibold">
//                             {taskMode === 'single' ? 'Single task module' : `${tasks.length} grouped tasks`}
//                           </span>
//                         </div>
//                         <div className="flex justify-between border-b border-white/10 pb-2">
//                           <span className="text-gray-400">Recipient Scope</span>
//                           <span className="font-mono text-[#E0E7FF] font-semibold truncate max-w-[150px]">
//                             {level === 'sprint' 
//                               ? `${selectedSprintIds.length} Sprint cycles` 
//                               : `${selectedIndividualIds.length > 0 ? selectedIndividualIds.length : 'All filtered personnel'} users`
//                             }
//                           </span>
//                         </div>
//                         <div className="flex justify-between border-b border-white/10 pb-2">
//                           <span className="text-gray-400">Target Deadline</span>
//                           <span className="font-mono text-emerald-400 font-semibold">{dueDate}</span>
//                         </div>
//                         <div className="flex justify-between border-b border-white/10 pb-2">
//                           <span className="text-gray-400">Recurrence Frequency</span>
//                           <span className="font-mono text-amber-400 font-semibold uppercase">
//                             {recurrence === 'none' ? 'One-time only' : recurrence.replace(/_/g, ' ')}
//                           </span>
//                         </div>
//                       </div>

//                       <div className="flex items-center space-x-2 text-[10px] text-gray-400 bg-white/5 p-2.5 rounded-lg border border-white/5">
//                         <Award size={14} className="text-[#2F63FF]" />
//                         <span>Meets standard system validation metrics.</span>
//                       </div>
//                     </div>
//                   </div>

//                   {/* Submission validation state message */}
//                   {!isStepValid('details') && (
//                     <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl font-medium">
//                       ⚠️ Note: Some tasks in Step 2 are incomplete! Please go back and write titles + instructions before sending.
//                     </div>
//                   )}

//                   <div className="border-t border-[#F1F5F9] pt-5 flex justify-end space-x-3">
//                     <button
//                       type="button"
//                       onClick={onCancel}
//                       className="px-5 py-2.5 border border-[#E2E8F0] hover:bg-slate-50 transition-colors text-xs font-semibold rounded-xl text-gray-700 cursor-pointer"
//                     >
//                       Save Draft
//                     </button>
//                     <button
//                       type="button"
//                       onClick={handleLaunchFlow}
//                       disabled={!isStepValid('details') || !isStepValid('audience')}
//                       className={`px-6 py-2.5 text-xs text-white font-semibold rounded-xl cursor-pointer transition-all flex items-center space-x-2 ${
//                         isStepValid('details') || isStepValid('audience') // Fallback to keep playground playful and accessible
//                           ? 'bg-[#2F63FF] hover:bg-blue-700 shadow-md shadow-blue-200'
//                           : 'bg-gray-300 pointer-events-none opacity-60'
//                       }`}
//                     >
//                       <Sparkles size={14} />
//                       <span>Deploy Workflow</span>
//                     </button>
//                   </div>
//                 </div>
//               )}

//             </motion.div>
//           </AnimatePresence>
//         </div>

//         {/* Footer controls */}
//         <div className="bg-[#FAFBFD] border-t border-[#F1F5F9] px-6 py-4 flex items-center justify-between">
//           <div>
//             <button
//               onClick={onCancel}
//               className="text-xs font-semibold text-gray-400 hover:text-[#2F63FF] transition-colors cursor-pointer"
//             >
//               Discard Draft
//             </button>
//           </div>
//           <div className="flex items-center space-x-3">
//             {activeStep !== 'level' && (
//               <button
//                 type="button"
//                 onClick={() => {
//                   const idx = stepsList.findIndex(s => s.id === activeStep);
//                   if (idx > 0) setActiveStep(stepsList[idx - 1].id);
//                 }}
//                 className="px-4 py-2 border border-[#E2E8F0] hover:bg-slate-50 transition-colors text-xs font-semibold rounded-xl text-gray-700 cursor-pointer flex items-center space-x-1"
//               >
//                 <ChevronLeft size={14} />
//                 <span>Previous Step</span>
//               </button>
//             )}

//             {activeStep !== 'schedule' ? (
//               <button
//                 type="button"
//                 onClick={() => {
//                   const idx = stepsList.findIndex(s => s.id === activeStep);
//                   if (idx < stepsList.length - 1) setActiveStep(stepsList[idx + 1].id);
//                 }}
//                 disabled={!isStepValid(activeStep)}
//                 className={`px-5 py-2 text-xs font-semibold rounded-xl transition-all flex items-center space-x-1 cursor-pointer ${
//                   isStepValid(activeStep)
//                     ? 'bg-[#2F63FF] text-white hover:bg-blue-700 shadow-sm'
//                     : 'bg-gray-200 text-gray-400 pointer-events-none'
//                 }`}
//               >
//                 <span>Next Step</span>
//                 <ChevronRight size={14} />
//               </button>
//             ) : null}
//           </div>
//         </div>

//       </div>

//       {/* RIGHT PORTION: Dynamic visual tablet preview device */}
//       <div className="w-full xl:w-80 bg-slate-50 rounded-2xl border border-[#E2E8F0] p-4 flex flex-col justify-between max-h-[700px] shadow-inner font-sans">
//         <div>
//           <div className="flex items-center justify-between border-b border-gray-200 pb-3 mb-4">
//             <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider font-mono">📱 MOBILE PREVIEW</span>
//             <div className="flex space-x-1">
//               <span className="w-2 h-2 rounded-full bg-red-400"></span>
//               <span className="w-2 h-2 rounded-full bg-yellow-400"></span>
//               <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
//             </div>
//           </div>

//           <p className="text-[10px] text-gray-500 mb-4 text-center italic">
//             Visual render of the assignee mobile interface:
//           </p>

//           <div className="space-y-4">
//             {tasks.map((taskItem, tIdx) => (
//               <div 
//                 key={taskItem.id} 
//                 className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm relative overflow-hidden"
//               >
//                 {/* Decorative status accent */}
//                 <div className="absolute top-0 left-0 w-1 h-full bg-[#2F63FF]"></div>

//                 <div className="space-y-2">
//                   <div className="flex items-center justify-between">
//                     <span className="text-[9px] font-sans font-bold text-[#2F63FF] bg-[#EEF2FF] px-1.5 py-0.5 rounded">
//                       TASK #{tIdx + 1}
//                     </span>
//                     <span className="text-[9px] text-[#10B981] font-medium block">Active 🟩</span>
//                   </div>

//                   <h4 className="text-xs font-bold text-[#0F172A] leading-tight truncate">
//                     {taskItem.title.trim() === '' ? 'Unconfigured Task' : taskItem.title}
//                   </h4>

//                   <p className="text-[10px] text-[#475569] leading-relaxed line-clamp-3">
//                     {taskItem.description.trim() === '' ? 'Fulfillment guidelines will render here.' : taskItem.description}
//                   </p>

//                   {/* Submission box render representation */}
//                   <div className="border-t border-dashed border-gray-100 pt-3 mt-3">
//                     <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest block mb-2">Required Validation Action:</span>
                    
//                     {taskItem.submissionFormat === 'image' && (
//                       <div className="border border-dashed border-gray-200 rounded-lg p-3 text-center bg-slate-50 cursor-not-allowed">
//                         <span className="w-6 h-6 rounded-full bg-white border border-gray-100 flex items-center justify-center mx-auto mb-1.5 shadow-sm text-gray-400">
//                           <ImageIcon size={12} />
//                         </span>
//                         <span className="text-[9px] font-medium text-gray-500 block">Upload image validation</span>
//                         <span className="text-[8px] text-gray-400 block mt-0.5">Supports PNG, JPG, or HEIC formats</span>
//                       </div>
//                     )}

//                     {taskItem.submissionFormat === 'text' && (
//                       <div className="border border-gray-200 rounded-lg p-2.5 bg-slate-50 relative cursor-not-allowed">
//                         <div className="space-y-1">
//                           <div className="h-1 bg-gray-200 rounded w-full"></div>
//                           <div className="h-1 bg-gray-200 rounded w-5/6"></div>
//                         </div>
//                         <span className="text-[8px] text-gray-400 block text-right mt-2 font-sans">Type description / explanation...</span>
//                       </div>
//                     )}

//                     {taskItem.submissionFormat === 'multiple_choice' && (
//                       <div className="bg-slate-50 rounded-lg p-2.5 border border-gray-100 space-y-2">
//                         {taskItem.questions.length === 0 ? (
//                           <div className="text-center py-2 text-[10px] text-gray-400 font-sans">
//                             Configure evaluation items in step 2.
//                           </div>
//                         ) : (
//                           <div className="space-y-2">
//                             {taskItem.questions.slice(0, 1).map((q, idx) => (
//                               <div key={idx} className="space-y-1.5">
//                                 <p className="text-[9px] font-bold text-gray-700 leading-tight">
//                                   {q.question.trim() === '' ? 'Unconfigured Evaluation Question?' : q.question}
//                                 </p>
//                                 <div className="space-y-1">
//                                   {q.options.slice(0, 3).map((opt, oIdx) => (
//                                     <div key={oIdx} className="flex items-center space-x-1.5 bg-white border border-gray-200 rounded p-1 text-[8px] font-medium text-gray-600">
//                                       <span className="w-3 h-3 rounded-full bg-gray-100 flex items-center justify-center font-bold text-[7px]">
//                                         {String.fromCharCode(65 + oIdx)}
//                                       </span>
//                                       <span className="truncate">{opt.trim() === '' ? `Option Selector ${oIdx + 1}` : opt}</span>
//                                     </div>
//                                   ))}
//                                 </div>
//                               </div>
//                             ))}
//                             {taskItem.questions.length > 1 && (
//                               <p className="text-[8px] text-center text-[#2F63FF] font-medium block">
//                                 + {taskItem.questions.length - 1} additional items
//                               </p>
//                             )}
//                           </div>
//                         )}
//                       </div>
//                     )}

//                     {taskItem.submissionFormat === 'audio' && (
//                       <div className="border border-dashed border-gray-200 rounded-lg p-3 text-center bg-slate-50 cursor-not-allowed">
//                         <span className="w-6 h-6 rounded-full bg-white border border-gray-100 flex items-center justify-center mx-auto mb-1.5 shadow-sm text-gray-400">
//                           <MicIcon size={12} />
//                         </span>
//                         <span className="text-[9px] font-medium text-gray-500 block">Record audio validation</span>
//                         <span className="text-[8px] text-gray-400 block mt-0.5">Supports live recording & verification</span>
//                       </div>
//                     )}

//                     {taskItem.submissionFormat === 'video' && (
//                       <div className="border border-dashed border-gray-200 rounded-lg p-3 text-center bg-slate-50 cursor-not-allowed">
//                         <span className="w-6 h-6 rounded-full bg-white border border-gray-100 flex items-center justify-center mx-auto mb-1.5 shadow-sm text-gray-400">
//                           <VideoIcon size={12} />
//                         </span>
//                         <span className="text-[9px] font-medium text-gray-500 block">Record video validation</span>
//                         <span className="text-[8px] text-gray-400 block mt-0.5">Supports live video snap & recording</span>
//                       </div>
//                     )}
//                   </div>

//                 </div>
//               </div>
//             ))}
//           </div>
//         </div>

//         <div className="border-t border-gray-200 pt-4 mt-4 space-y-2.5">
//           <div className="flex items-center justify-between text-xs font-semibold">
//             <span className="text-gray-500">Must finish by:</span>
//             <span className="text-gray-800 font-mono text-[11px] font-bold bg-[#E1F9F0] text-[#10B981] px-2 py-0.5 rounded">
//               {dueDate}
//             </span>
//           </div>
//           <div className="flex items-center space-x-2 text-[9px] text-[#64748B] leading-tight">
//             <Users size={12} className="text-[#2F63FF] shrink-0" />
//             <span>Assigned to: <b>{level === 'sprint' ? `${selectedSprintIds.length} Sprints` : `${selectedIndividualIds.length} friends`}</b></span>
//           </div>
//         </div>

//       </div>

//     </div>
//   );
// }
