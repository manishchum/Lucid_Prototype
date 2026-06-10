// import React, { useState } from 'react';
// import { 
//   ChevronDown, 
//   ChevronUp, 
//   Search, 
//   Award, 
//   BookOpen, 
//   CheckCircle2, 
//   XCircle, 
//   Clock, 
//   RotateCcw,
//   Sparkles,
//   SearchCode,
//   FileCheck2,
//   ListTodo
// } from 'lucide-react';
// import { motion, AnimatePresence } from 'motion/react';

// export interface ReportQuestion {
//   question: string;
//   submittedAnswer: string;
//   correctAnswer: string;
//   isCorrect: boolean;
//   points: number;
// }

// export interface ReportItem {
//   id: string;
//   title: string;
//   category: 'assessment' | 'roleplay' | 'tasks';
//   score: number;
//   totalQuestions: number;
//   dateCompleted: string;
//   status: 'Completed' | 'In Progress' | 'Not Started';
//   questionsList?: ReportQuestion[];
// }

// export const INITIAL_REPORTS: ReportItem[] = [
//   {
//     id: 'rep-1',
//     title: 'Grinding Science and Equipment Selection',
//     category: 'assessment',
//     score: 4,
//     totalQuestions: 13,
//     dateCompleted: '2026-05-28',
//     status: 'Completed',
//     questionsList: [
//       { question: 'What particle size distribution is optimal for traditional espresso extraction?', submittedAnswer: 'Coarse', correctAnswer: 'Fine with balanced fines distribution', isCorrect: false, points: 0 },
//       { question: 'Select the primary burr type which mitigates heat retention during high-velocity retail cycles.', submittedAnswer: 'Ceramic Flat Burrs', correctAnswer: 'Ceramic Flat Burrs', isCorrect: true, points: 1 },
//       { question: 'State the consequence of excessive static electricity during coffee grinding.', submittedAnswer: 'Chaff separation & grounds spraying', correctAnswer: 'Chaff separation & grounds spraying', isCorrect: true, points: 1 },
//       { question: 'Under-extraction is chemically indicated by which tasting notes?', submittedAnswer: 'Sour and metallic notes', correctAnswer: 'Sour and bitter notes', isCorrect: false, points: 0 },
//       { question: 'Define the optimal burr RPM to prevent premature thermal degasification.', submittedAnswer: 'Under 1400 RPM', correctAnswer: 'Under 1400 RPM', isCorrect: true, points: 1 },
//       { question: 'Which burr metal treatment offers the highest hardness and corrosion resistance?', submittedAnswer: 'Stainless Steel', correctAnswer: 'Titanium Aluminum Nitride (TiAlN)', isCorrect: false, points: 0 },
//       { question: 'How does water spray (RDT) affect grinding retention?', submittedAnswer: 'Reduces static friction charge', correctAnswer: 'Reduces static friction charge', isCorrect: true, points: 1 },
//       { question: 'What physical element changes when burr spacing is reduced?', submittedAnswer: 'Flow rate increases', correctAnswer: 'Average particle diameter decreases', isCorrect: false, points: 0 },
//       { question: 'Which grinding configuration suffers from the most retention by volume?', submittedAnswer: 'Commercial flat burrs with horizontal chute', correctAnswer: 'Commercial flat burrs with horizontal chute', isCorrect: false, points: 0 }
//     ]
//   },
//   {
//     id: 'rep-2',
//     title: 'Performance Metrics, Ablation Studies, and Experimental Results',
//     category: 'assessment',
//     score: 5,
//     totalQuestions: 10,
//     dateCompleted: '2026-05-27',
//     status: 'Completed',
//     questionsList: [
//       { question: 'In machine learning, what is the primary purpose of an ablation study?', submittedAnswer: 'Removing components to evaluate contribution', correctAnswer: 'Removing components to evaluate contribution', isCorrect: true, points: 1 },
//       { question: 'Which of the following describes the FID metric for network evaluations?', submittedAnswer: 'Frechet Inception Distance', correctAnswer: 'Frechet Inception Distance', isCorrect: true, points: 1 },
//       { question: 'What is indicated by a higher structural similarity index (SSIM)?', submittedAnswer: 'Lower pixel level distortion', correctAnswer: 'Greater luminance and structural alignment', isCorrect: false, points: 0 },
//       { question: 'Which model parameter was ablated to achieve 15% faster reasoning?', submittedAnswer: 'Attention Head count pruned', correctAnswer: 'Attention Head count pruned', isCorrect: true, points: 1 },
//       { question: 'How is baseline accuracy established during calibration testing?', submittedAnswer: 'Simulated parameters', correctAnswer: 'Empirical measurement under standard variables', isCorrect: false, points: 0 },
//       { question: 'What is the main drawback of optimizing solely for PSNR metrics?', submittedAnswer: 'Perceptual quality may not align with visual appeal', correctAnswer: 'Perceptual quality may not align with visual appeal', isCorrect: true, points: 1 },
//       { question: 'How do learning rate schedulers influence final model optimization stability?', submittedAnswer: 'Prevents weight drift on saddle points', correctAnswer: 'Prevents weight drift on saddle points', isCorrect: true, points: 1 }
//     ]
//   },
//   {
//     id: 'rep-3',
//     title: 'Module Assessment',
//     category: 'assessment',
//     score: 0,
//     totalQuestions: 12,
//     dateCompleted: 'N/A',
//     status: 'In Progress',
//     questionsList: [
//       { question: 'Describe the main component of organizational workflow tracking.', submittedAnswer: 'No submission registered yet.', correctAnswer: 'KPI parameters alignment matrix', isCorrect: false, points: 0 }
//     ]
//   },
//   {
//     id: 'rep-4',
//     title: 'Module Assessment',
//     category: 'assessment',
//     score: 0,
//     totalQuestions: 11,
//     dateCompleted: 'N/A',
//     status: 'Not Started'
//   },
//   {
//     id: 'rep-5',
//     title: 'Module Assessment',
//     category: 'assessment',
//     score: 4,
//     totalQuestions: 12,
//     dateCompleted: '2026-05-25',
//     status: 'Completed',
//     questionsList: [
//       { question: 'Question A statement', submittedAnswer: 'Incorrect answer example', correctAnswer: 'A correct statement', isCorrect: false, points: 0 },
//       { question: 'Question B statement', submittedAnswer: 'Right choice', correctAnswer: 'Right choice', isCorrect: true, points: 1 },
//       { question: 'Question C statement', submittedAnswer: 'Right choice', correctAnswer: 'Right choice', isCorrect: true, points: 1 },
//       { question: 'Question D statement', submittedAnswer: 'Right choice', correctAnswer: 'Right choice', isCorrect: true, points: 1 },
//       { question: 'Question E statement', submittedAnswer: 'Right choice', correctAnswer: 'Right choice', isCorrect: true, points: 1 }
//     ]
//   },
//   {
//     id: 'rep-6',
//     title: 'The Technical Stack and Development Environment',
//     category: 'assessment',
//     score: 5,
//     totalQuestions: 12,
//     dateCompleted: '2026-05-24',
//     status: 'Completed',
//     questionsList: [
//       { question: 'What is the absolute maximum port traffic routed under default sandbox settings?', submittedAnswer: 'Port 3000 only', correctAnswer: 'Port 3000 only', isCorrect: true, points: 1 },
//       { question: 'Which bundle build tool compiles standalone server engines into self-contained CommonJS units?', submittedAnswer: 'esbuild', correctAnswer: 'esbuild', isCorrect: true, points: 1 },
//       { question: 'True/False: Hot Module Replacement (HMR) is disabled by default under production configuration.', submittedAnswer: 'True', correctAnswer: 'True', isCorrect: true, points: 1 },
//       { question: 'What file controls framework metadata, permissions, and major capabilities?', submittedAnswer: 'package.json', correctAnswer: 'metadata.json', isCorrect: false, points: 0 },
//       { question: 'Which package handles background tsx server operations in Dev Mode?', submittedAnswer: 'tsx runner', correctAnswer: 'tsx', isCorrect: true, points: 1 },
//       { question: 'What is the designated environmental variable representing AI authentication keys client-side?', submittedAnswer: 'GEMINI_API_KEY', correctAnswer: 'VITE_ parameters keys', isCorrect: false, points: 0 },
//       { question: 'How are client styled variables imported in global css?', submittedAnswer: '@import "tailwindcss"', correctAnswer: '@import "tailwindcss"', isCorrect: true, points: 1 }
//     ]
//   },
//   {
//     id: 'rep-7',
//     title: 'Related Work and the Evolution of Colorization Methods',
//     category: 'assessment',
//     score: 10,
//     totalQuestions: 12,
//     dateCompleted: '2026-05-23',
//     status: 'Completed',
//     questionsList: [
//       { question: 'Which network architecture introduced deep convolutional priors for automatic colourizing?', submittedAnswer: 'U-Net', correctAnswer: 'U-Net', isCorrect: true, points: 1 },
//       { question: 'What color space is most commonly selected to isolate luminance from color channels?', submittedAnswer: 'CIE L*a*b*', correctAnswer: 'CIE L*a*b*', isCorrect: true, points: 1 },
//       { question: 'How do adversarial losses influence edge bleeding on colourized outputs?', submittedAnswer: 'Provides realistic texture variance', correctAnswer: 'Provides realistic texture variance', isCorrect: true, points: 1 },
//       { question: 'Define the function of content loss compared to pixel-wise MSE.', submittedAnswer: 'Measures high-level perceptual characteristics', correctAnswer: 'Measures high-level perceptual characteristics', isCorrect: true, points: 1 }
//     ]
//   },
//   {
//     id: 'rep-8',
//     title: 'Module Assessment',
//     category: 'assessment',
//     score: 11,
//     totalQuestions: 12,
//     dateCompleted: '2026-05-22',
//     status: 'Completed'
//   },
//   {
//     id: 'rep-9',
//     title: 'Bira 91 Standards and "Always Remember" Principles',
//     category: 'assessment',
//     score: 12,
//     totalQuestions: 12,
//     dateCompleted: '2026-05-21',
//     status: 'Completed',
//     questionsList: [
//       { question: 'What is primary pillar #1 in Bira 91 Operations?', submittedAnswer: 'Consistently exceptional quality control', correctAnswer: 'Consistently exceptional quality control', isCorrect: true, points: 1 },
//       { question: 'Define the fundamental objective of the "Always Remember" guidelines.', submittedAnswer: 'Delivering stellar standards for product and customer success', correctAnswer: 'Delivering stellar standards for product and customer success', isCorrect: true, points: 1 }
//     ]
//   },

//   // Role Play tab records
//   {
//     id: 'rep-rp-1',
//     title: 'Simulated Admin Negotiation Sandbox',
//     category: 'roleplay',
//     score: 8,
//     totalQuestions: 10,
//     dateCompleted: '2026-05-29',
//     status: 'Completed',
//     questionsList: [
//       { question: 'Identify the ideal workflow setup representing a multi-branch team coordination scenario.', submittedAnswer: 'Multi-Task Bundle with individual targeting', correctAnswer: 'Multi-Task Bundle with individual targeting', isCorrect: true, points: 1 },
//       { question: 'How do you handle a student failing to submit required validation checklists?', submittedAnswer: 'Deploy interactive reminders from the console', correctAnswer: 'Deploy interactive reminders from the console', isCorrect: true, points: 1 }
//     ]
//   },
//   {
//     id: 'rep-rp-2',
//     title: 'F&B Calibration Sandbox - Temperature & Pressure Sync',
//     category: 'roleplay',
//     score: 9,
//     totalQuestions: 10,
//     dateCompleted: '2026-05-28',
//     status: 'Completed',
//     questionsList: [
//       { question: 'What is the optimal water pressure for steam calibration?', submittedAnswer: '9 Bar', correctAnswer: '9 Bar', isCorrect: true, points: 1 },
//       { question: 'What is the targeted milk frothing temperature?', submittedAnswer: '65°C', correctAnswer: '65°C', isCorrect: true, points: 1 }
//     ]
//   },
//   {
//     id: 'rep-rp-3',
//     title: 'UX Team Collaboration Playbook Execution',
//     category: 'roleplay',
//     score: 6,
//     totalQuestions: 8,
//     dateCompleted: '2026-05-26',
//     status: 'Completed',
//     questionsList: [
//       { question: 'Define the optimal spacing scale grid system in the visual blueprint.', submittedAnswer: '8px baseline Grid', correctAnswer: '8px baseline Grid', isCorrect: true, points: 1 }
//     ]
//   },
//   {
//     id: 'rep-tsk-1',
//     title: 'Daily Espresso Setup and Verification Log',
//     category: 'tasks',
//     score: 5,
//     totalQuestions: 5,
//     dateCompleted: '2026-05-29',
//     status: 'Completed',
//     questionsList: [
//       { question: 'Checklist item: Grinder hopper filled and clean?', submittedAnswer: 'Standard Response Delivered', correctAnswer: 'Standard Response Delivered', isCorrect: true, points: 1 },
//       { question: 'Checklist item: Portafilter basket dried?', submittedAnswer: 'Standard Response Delivered', correctAnswer: 'Standard Response Delivered', isCorrect: true, points: 1 },
//       { question: 'Checklist item: First double-shot weight checked?', submittedAnswer: 'Standard Response Delivered', correctAnswer: 'Standard Response Delivered', isCorrect: true, points: 1 },
//       { question: 'Checklist item: Brew temperature calibrated to 93°C?', submittedAnswer: 'Standard Response Delivered', correctAnswer: 'Standard Response Delivered', isCorrect: true, points: 1 },
//       { question: 'Checklist item: Steam pressure sits actively at 1.3 Bar?', submittedAnswer: 'Standard Response Delivered', correctAnswer: 'Standard Response Delivered', isCorrect: true, points: 1 }
//     ]
//   },
//   {
//     id: 'rep-tsk-2',
//     title: 'Bi-Weekly Maintenance & Sanitization Checklist',
//     category: 'tasks',
//     score: 4,
//     totalQuestions: 4,
//     dateCompleted: '2026-05-27',
//     status: 'Completed',
//     questionsList: [
//       { question: 'Backflush brew groups with detergent?', submittedAnswer: 'Verified Image Uploaded', correctAnswer: 'Verified Image Uploaded', isCorrect: true, points: 1 },
//       { question: 'Soak steam wands in milk-solvent solution?', submittedAnswer: 'Verified Image Uploaded', correctAnswer: 'Verified Image Uploaded', isCorrect: true, points: 1 },
//       { question: 'Scrub group gaskets and shower screens?', submittedAnswer: 'Standard Response Delivered', correctAnswer: 'Standard Response Delivered', isCorrect: true, points: 1 },
//       { question: 'Regenerate water softener system salt matrix?', submittedAnswer: 'Standard Response Delivered', correctAnswer: 'Standard Response Delivered', isCorrect: true, points: 1 }
//     ]
//   },
//   {
//     id: 'rep-tsk-3',
//     title: 'Front-of-House Merchandising & POS Alignment Verification',
//     category: 'tasks',
//     score: 2,
//     totalQuestions: 3,
//     dateCompleted: '2026-05-26',
//     status: 'Completed',
//     questionsList: [
//       { question: 'Retail shelf stocking matches visual planogram template?', submittedAnswer: 'Verified Image Uploaded', correctAnswer: 'Verified Image Uploaded', isCorrect: true, points: 1 },
//       { question: 'Chilled display temp recorded between 2°C and 4°C?', submittedAnswer: 'Standard Response Delivered', correctAnswer: 'Standard Response Delivered', isCorrect: true, points: 1 },
//       { question: 'POS terminal sync verified and paper roll loaded?', submittedAnswer: 'None provided', correctAnswer: 'Standard Response Delivered', isCorrect: false, points: 0 }
//     ]
//   }
// ];

// interface TaskReportsProps {
//   reportsList?: ReportItem[];
//   onAddSimulatedReport?: (report: ReportItem) => void;
// }

// export default function TaskReports({ reportsList = INITIAL_REPORTS, onAddSimulatedReport }: TaskReportsProps) {
//   const [activeSubTab, setActiveSubTab] = useState<'assessment' | 'roleplay' | 'tasks'>('assessment');
//   const [searchQuery, setSearchQuery] = useState('');
//   const [expandedCardId, setExpandedCardId] = useState<string | null>(null);
//   const [scoreFilter, setScoreFilter] = useState<'all' | 'high' | 'mid' | 'low'>('all');

//   // Filter logic
//   const filteredReports = reportsList.filter(report => {
//     // Subcategory toggle
//     if (report.category !== activeSubTab) return false;

//     // Search filter
//     if (searchQuery.trim() !== '') {
//       const query = searchQuery.toLowerCase();
//       const matchesTitle = report.title.toLowerCase().includes(query);
//       if (!matchesTitle) return false;
//     }

//     // Score categorization
//     if (scoreFilter !== 'all') {
//       const percentage = (report.score / report.totalQuestions) * 100;
//       if (scoreFilter === 'high' && percentage < 80) return false;
//       if (scoreFilter === 'mid' && (percentage >= 80 || percentage < 50)) return false;
//       if (scoreFilter === 'low' && percentage >= 50) return false;
//     }

//     return true;
//   });

//   const toggleExpandCard = (id: string) => {
//     if (expandedCardId === id) {
//       setExpandedCardId(null);
//     } else {
//       setExpandedCardId(id);
//     }
//   };

//   // Quick stats calculations
//   const categoryReports = reportsList.filter(r => r.category === activeSubTab);
//   const completedCount = categoryReports.filter(r => r.status === 'Completed').length;
//   const inProgressCount = categoryReports.filter(r => r.status === 'In Progress').length;
  
//   // Calculate running average score
//   const completedCategoryReports = categoryReports.filter(r => r.status === 'Completed' && r.totalQuestions > 0);
//   const averagePercentage = completedCategoryReports.length > 0
//     ? Math.round(completedCategoryReports.reduce((acc, curr) => acc + (curr.score / curr.totalQuestions), 0) / completedCategoryReports.length * 100)
//     : 0;

//   // Simulate a random new report score generation
//   const handleSimulateNewTestResult = () => {
//     if (!onAddSimulatedReport) return;

//     const titles = [
//       'Industrial Boiler Setup & Safety Diagnostics',
//       'Quality Assurance & Packaging Verification Protocol',
//       'Core Database Migration Sandbox',
//       'Asset Management Audit Workflow',
//       'Client Relationship Management Onboarding Sprint'
//     ];

//     const randomTitle = titles[Math.floor(Math.random() * titles.length)];
//     const totalQ = Math.floor(Math.random() * 6) + 8; // 8 to 13
//     const obtainedScore = Math.floor(Math.random() * (totalQ + 1));
//     const percentage = Math.round((obtainedScore / totalQ) * 100);

//     const generatedReport: ReportItem = {
//       id: `sim-rep-${Date.now()}`,
//       title: randomTitle,
//       category: activeSubTab,
//       score: obtainedScore,
//       totalQuestions: totalQ,
//       dateCompleted: new Date().toISOString().split('T')[0],
//       status: 'Completed',
//       questionsList: [
//         {
//           question: 'Define the prime verification standard expected under high-pressure system cycles.',
//           submittedAnswer: obtainedScore > totalQ / 2 ? 'Active mechanical gauge check & photo registers' : 'Manual validation entries',
//           correctAnswer: 'Active mechanical gauge check & photo registers',
//           isCorrect: obtainedScore > totalQ / 2,
//           points: obtainedScore > totalQ / 2 ? 1 : 0
//         },
//         {
//           question: 'Which visual representation validates total user task fulfillment status across dashboards?',
//           submittedAnswer: 'Task Progress bar chart & Completion mark indicators',
//           correctAnswer: 'Task Progress bar chart & Completion mark indicators',
//           isCorrect: true,
//           points: 1
//         }
//       ]
//     };

//     onAddSimulatedReport(generatedReport);
//   };

//   return (
//     <div className="space-y-6 max-w-7xl mx-auto font-sans" id="task-reports-container">
      
//       {/* Dynamic Header Block mirroring exact styling */}
//       <div className="bg-white px-8 py-7 rounded-3xl border border-[#E2E8F0] shadow-sm flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
//         <div>
//           <h2 className="text-xl font-display font-medium text-[#0F172A] tracking-tight">Sprint Performance Reports</h2>
//           <p className="text-xs text-gray-500 mt-1 font-sans">
//             Comprehensive analysis of your scores and performance metrics
//           </p>
//         </div>

//         {/* Action Button to generate / trigger new simulation result */}
//         <button
//           onClick={handleSimulateNewTestResult}
//           className="bg-white border border-gray-200 hover:bg-[#EEF2FF] text-[#2F63FF] hover:border-[#2F63FF]/30 text-xs font-semibold px-4 py-2.5 rounded-xl cursor-pointer transition-all flex items-center space-x-1.5 shadow-sm"
//         >
//           <Sparkles size={14} />
//           <span>Simulate Completed Task</span>
//         </button>
//       </div>

//       {/* Sub-tab Options matching image triggers exactly */}
//       <div className="flex space-x-3 bg-transparent pb-1">
//         <button
//           onClick={() => {
//             setActiveSubTab('assessment');
//             setExpandedCardId(null);
//           }}
//           className={`px-5 py-3 rounded-xl text-xs font-semibold tracking-wide transition-all duration-200 flex items-center space-x-2 cursor-pointer shadow-sm ${
//             activeSubTab === 'assessment'
//               ? 'bg-[#2F63FF] text-white shadow-md shadow-indigo-100'
//               : 'bg-white text-gray-600 hover:bg-slate-50 border border-gray-200/60'
//           }`}
//           id="tab-assessments"
//         >
//           <span>📚</span>
//           <span>Assessments</span>
//         </button>

//         <button
//           onClick={() => {
//             setActiveSubTab('roleplay');
//             setExpandedCardId(null);
//           }}
//           className={`px-5 py-3 rounded-xl text-xs font-semibold tracking-wide transition-all duration-200 flex items-center space-x-2 cursor-pointer shadow-sm ${
//             activeSubTab === 'roleplay'
//               ? 'bg-[#2F63FF] text-white shadow-md shadow-indigo-100'
//               : 'bg-white text-gray-600 hover:bg-slate-50 border border-gray-200/60'
//           }`}
//           id="tab-role-play"
//         >
//           <span>🎭</span>
//           <span>Role-Play Sessions</span>
//         </button>

//         <button
//           onClick={() => {
//             setActiveSubTab('tasks');
//             setExpandedCardId(null);
//           }}
//           className={`px-5 py-3 rounded-xl text-xs font-semibold tracking-wide transition-all duration-200 flex items-center space-x-2 cursor-pointer shadow-sm ${
//             activeSubTab === 'tasks'
//               ? 'bg-[#2F63FF] text-white shadow-md shadow-indigo-100'
//               : 'bg-white text-gray-600 hover:bg-slate-50 border border-gray-200/60'
//           }`}
//           id="tab-task-reports"
//         >
//           <span>📋</span>
//           <span>Task Reports</span>
//         </button>
//       </div>

//       {/* Primary Analytics Overlay */}
//       <div className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-[#FAFBFD] p-5 rounded-2xl border border-[#F1F5F9]">
//         <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center space-x-3.5">
//           <div className="w-9 h-9 bg-indigo-50 text-[#2F63FF] rounded-lg flex items-center justify-center font-bold">
//             <FileCheck2 size={18} />
//           </div>
//           <div>
//             <span className="text-[10px] text-gray-400 font-bold uppercase block tracking-wider">Total Reports</span>
//             <span className="text-base font-semibold text-[#0F172A]">{categoryReports.length} modules</span>
//           </div>
//         </div>

//         <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center space-x-3.5">
//           <div className="w-9 h-9 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center font-bold">
//             <CheckCircle2 size={18} />
//           </div>
//           <div>
//             <span className="text-[10px] text-gray-400 font-bold uppercase block tracking-wider">Completed Tasks</span>
//             <span className="text-base font-semibold text-emerald-600">{completedCount} verified</span>
//           </div>
//         </div>

//         <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm flex items-center space-x-3.5">
//           <div className="w-9 h-9 bg-amber-50 text-amber-600 rounded-lg flex items-center justify-center font-bold">
//             <Clock size={18} />
//           </div>
//           <div>
//             <span className="text-[10px] text-gray-400 font-bold uppercase block tracking-wider">In Progress</span>
//             <span className="text-base font-semibold text-amber-600">{inProgressCount} active</span>
//           </div>
//         </div>

//         <div className="bg-[#EEF2FF] p-4 rounded-xl border border-blue-100 flex items-center space-x-3.5">
//           <div className="w-9 h-9 bg-blue-100 text-[#2F63FF] rounded-lg flex items-center justify-center font-bold">
//             <Award size={18} />
//           </div>
//           <div>
//             <span className="text-[10px] text-[#2F63FF] font-bold uppercase block tracking-wider">Average Performance</span>
//             <span className="text-base font-bold text-[#2F63FF]">{averagePercentage}% Accuracy</span>
//           </div>
//         </div>
//       </div>

//       {/* Category Section with filters and tools */}
//       <div className="space-y-4">
//         <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
//           <div>
//             <h3 className="text-sm font-display font-bold text-[#0F172A] tracking-tight">Your Growth Record</h3>
//             <p className="text-[11px] text-gray-500 mt-0.5">Review Your Scores & Track Growth</p>
//           </div>

//           {/* Combined Filters and Search Bar */}
//           <div className="flex items-center space-x-2 max-sm:w-full">
//             {/* Search inputs */}
//             <div className="relative">
//               <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={13} />
//               <input
//                 type="text"
//                 placeholder="Search reports..."
//                 value={searchQuery}
//                 onChange={(e) => setSearchQuery(e.target.value)}
//                 className="bg-white border border-gray-200/80 rounded-xl pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[#2F63FF] w-48 focus:border-transparent placeholder-gray-400"
//               />
//             </div>

//             {/* Score Filters dropdown selector */}
//             <select
//               value={scoreFilter}
//               onChange={(e) => setScoreFilter(e.target.value as any)}
//               className="bg-white border border-gray-200/80 rounded-xl px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#2F63FF] text-gray-600 cursor-pointer"
//             >
//               <option value="all">All Scores</option>
//               <option value="high">High (&gt;= 80%)</option>
//               <option value="mid">Mid (50% - 79%)</option>
//               <option value="low">Needs Review (&lt; 50%)</option>
//             </select>
//           </div>
//         </div>

//         {/* Grid and reporting lists mirroring screenshot */}
//         {filteredReports.length === 0 ? (
//           <div className="text-center py-16 bg-white rounded-2xl border border-[#E2E8F0] shadow-sm max-w-lg mx-auto">
//             <SearchCode className="mx-auto text-gray-300 mb-2" size={40} />
//             <h4 className="font-display font-medium text-[#0F172A] text-xs">No matching reports found</h4>
//             <p className="text-[10px] text-gray-500 mt-1 max-w-xs mx-auto">
//               Try resetting your search parameter or filter choices, or complete a task to register results.
//             </p>
//           </div>
//         ) : (
//           <div className="grid grid-cols-1 md:grid-cols-3 gap-6" id="reports-grid-cards">
//             {filteredReports.map((report) => {
//               const isExpanded = expandedCardId === report.id;
//               const hasScore = report.status === 'Completed';
//               const percent = hasScore ? Math.round((report.score / report.totalQuestions) * 100) : 0;
              
//               // Color map matching performance bands in screenshot
//               let bgPercentClass = 'bg-slate-100 text-slate-700';
//               if (hasScore) {
//                 if (percent >= 80) bgPercentClass = 'bg-emerald-50 text-emerald-600 border border-emerald-100';
//                 else if (percent >= 50) bgPercentClass = 'bg-amber-50 text-amber-600 border border-amber-100';
//                 else bgPercentClass = 'bg-red-50 text-red-500 border border-red-100';
//               }

//               return (
//                 <div 
//                   key={report.id}
//                   className={`bg-white rounded-3xl border border-[#E2E8F0] p-6 hover:shadow-md transition-all flex flex-col justify-between relative shadow-sm h-48 relative overflow-hidden`}
//                 >
//                   {/* Decorative faint background bar representing progress percentage */}
//                   <div className="absolute top-0 left-0 bg-slate-50/50 h-1.5 w-full">
//                     <div 
//                       className={`h-full ${percent >= 80 ? 'bg-emerald-400' : percent >= 50 ? 'bg-amber-400' : 'bg-red-300'}`} 
//                       style={{ width: `${percent}%` }}
//                     ></div>
//                   </div>

//                   <div className="space-y-3.5 pt-1">
//                     {/* Report Card Title */}
//                     <h4 
//                       className="text-xs font-bold text-[#0F172A] leading-snug line-clamp-2 pr-6 tracking-tight cursor-pointer font-sans select-all hover:text-[#2F63FF] transition-colors"
//                       onClick={() => toggleExpandCard(report.id)}
//                     >
//                       {report.title}
//                     </h4>

//                     {/* Score status indicators */}
//                     <div className="flex items-center space-x-2">
//                       <span className="text-gray-500 text-[11px] font-medium font-sans">
//                         Score:
//                       </span>
//                       {hasScore ? (
//                         <div className="flex items-center space-x-1.5">
//                           <span className="text-[#0F172A] font-bold text-xs font-mono">
//                             {report.score} / {report.totalQuestions}
//                           </span>
//                           <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${bgPercentClass}`}>
//                             {percent}%
//                           </span>
//                         </div>
//                       ) : (
//                         <span className={`text-[9.5px] font-semibold px-2 py-0.5 rounded-full ${
//                           report.status === 'In Progress' ? 'bg-amber-50 text-amber-600 border border-amber-200/50' : 'bg-slate-100 text-gray-500'
//                         }`}>
//                           {report.status}
//                         </span>
//                       )}
//                     </div>
//                   </div>

//                   {/* Card bottom footer with details toggler */}
//                   <div className="flex items-center justify-between pt-3 border-t border-[#F8FAFC]">
//                     <span className="text-[9px] text-gray-400 font-semibold font-mono uppercase">
//                       {report.dateCompleted === 'N/A' ? 'No history' : `Date: ${report.dateCompleted}`}
//                     </span>
                    
//                     <button
//                       onClick={() => toggleExpandCard(report.id)}
//                       className="w-7 h-7 bg-slate-50/80 border border-[#F1F5F9] rounded-lg text-slate-500 hover:text-[#2F63FF] hover:bg-indigo-50/50 flex items-center justify-center transition-colors cursor-pointer"
//                       title={isExpanded ? "Collapse Details" : "Show Questions Details"}
//                     >
//                       {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
//                     </button>
//                   </div>
//                 </div>
//               );
//             })}
//           </div>
//         )}

//         {/* Custom Expanded Drawer Panel at the bottom representing full question breakdown */}
//         <AnimatePresence>
//           {expandedCardId && (
//             <motion.div
//               initial={{ opacity: 0, y: 15 }}
//               animate={{ opacity: 1, y: 0 }}
//               exit={{ opacity: 0, y: 15 }}
//               transition={{ duration: 0.2 }}
//               className="mt-6 bg-[#FAFBFD] rounded-3xl border border-[#CBD5E1]/60 p-6 space-y-4"
//             >
//               {(() => {
//                 const activeReport = reportsList.find(r => r.id === expandedCardId);
//                 if (!activeReport) return null;
//                 const hasDetailedQuestions = activeReport.questionsList && activeReport.questionsList.length > 0;
//                 const passingIndex = (activeReport.score / activeReport.totalQuestions) * 100;

//                 return (
//                   <div className="space-y-4">
//                     <div className="flex items-center justify-between border-b border-[#E2E8F0] pb-3">
//                       <div>
//                         <span className="text-[10px] font-bold text-[#2F63FF] uppercase tracking-wider font-mono">Detailed Score Calibration</span>
//                         <h4 className="text-sm font-bold text-[#0F172A] mt-0.5 leading-tight">{activeReport.title}</h4>
//                       </div>
//                       <button
//                         onClick={() => setExpandedCardId(null)}
//                         className="text-xs font-semibold text-gray-500 hover:text-red-500 px-3 py-1 cursor-pointer"
//                       >
//                         Close Details
//                       </button>
//                     </div>

//                     {/* Visual performance feedback */}
//                     <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
//                       <div className="bg-white p-4 rounded-xl border border-gray-150 shadow-inner flex items-center space-x-3">
//                         <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-xs font-semibold">
//                           📌
//                         </div>
//                         <div>
//                           <span className="text-[10px] text-gray-400 block font-bold uppercase">Assessment Score</span>
//                           <span className="text-sm font-semibold text-gray-800">{activeReport.score} / {activeReport.totalQuestions} points</span>
//                         </div>
//                       </div>

//                       <div className="bg-white p-4 rounded-xl border border-gray-150 shadow-inner flex items-center space-x-3">
//                         <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-xs font-semibold">
//                           ✅
//                         </div>
//                         <div>
//                           <span className="text-[10px] text-gray-400 block font-bold uppercase">Correct Responses</span>
//                           <span className="text-sm font-semibold text-[#10B981]">{activeReport.score} entries</span>
//                         </div>
//                       </div>

//                       <div className="bg-white p-4 rounded-xl border border-gray-150 shadow-inner flex items-center space-x-3">
//                         <div className="w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-xs font-semibold">
//                           ⚠️
//                         </div>
//                         <div>
//                           <span className="text-[10px] text-gray-400 block font-bold uppercase">Accuracy Calibration</span>
//                           <span className={`text-sm font-bold ${passingIndex >= 80 ? 'text-[#10B981]' : passingIndex >= 50 ? 'text-amber-500' : 'text-red-500'}`}>
//                             {activeReport.status === 'Completed' ? `${Math.round(passingIndex)}%` : 'No grading yet'}
//                           </span>
//                         </div>
//                       </div>
//                     </div>

//                     {/* Question by Question list breakdown */}
//                     <div className="space-y-3 pt-3">
//                       <h5 className="text-xs font-bold text-gray-600 block uppercase tracking-wider font-mono">Submission Item Breakdown</h5>
                      
//                       {!hasDetailedQuestions ? (
//                         <div className="text-center py-6 border border-dashed border-gray-200 rounded-xl bg-white text-gray-400 text-xs">
//                           No detailed question answers found or task is not yet completed. Expand a completed quiz or simulator dataset card above.
//                         </div>
//                       ) : (
//                         <div className="space-y-3.5 max-h-[350px] overflow-y-auto pr-2">
//                           {activeReport.questionsList?.map((q, idx) => (
//                             <div key={idx} className="bg-white p-4 rounded-2xl border border-[#E2E8F0] space-y-2 text-xs">
//                               <div className="flex items-start justify-between gap-4">
//                                 <span className="font-semibold text-gray-800 leading-tight">
//                                   {idx + 1}. {q.question}
//                                 </span>
//                                 <span className={`shrink-0 flex items-center space-x-1 font-bold text-[10px] px-2 py-0.5 rounded-full ${
//                                   q.isCorrect ? 'bg-[#E1F9F0] text-[#13734E]' : 'bg-red-50 text-red-600'
//                                 }`}>
//                                   {q.isCorrect ? (
//                                     <>
//                                       <CheckCircle2 size={11} />
//                                       <span>Correct</span>
//                                     </>
//                                   ) : (
//                                     <>
//                                       <XCircle size={11} />
//                                       <span>Incorrect</span>
//                                     </>
//                                   )}
//                                 </span>
//                               </div>

//                               <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px] pt-1 border-t border-dashed border-gray-100">
//                                 <div className="p-2 rounded bg-slate-50">
//                                   <span className="text-gray-400 text-[10px] block font-semibold">SUBMITTED ANSWER</span>
//                                   <span className={q.isCorrect ? 'text-[#13734E] font-medium' : 'text-red-600 font-medium'}>
//                                     {q.submittedAnswer}
//                                   </span>
//                                 </div>
//                                 <div className="p-2 rounded bg-indigo-50/30">
//                                   <span className="text-[10px] text-[#2F63FF]/70 block font-semibold">CORRECT KEY</span>
//                                   <span className="text-emerald-700 font-medium">
//                                     {q.correctAnswer}
//                                   </span>
//                                 </div>
//                               </div>
//                             </div>
//                           ))}
//                         </div>
//                       )}
//                     </div>
//                   </div>
//                 );
//               })()}
//             </motion.div>
//           )}
//         </AnimatePresence>

//       </div>
//     </div>
//   );
// }
