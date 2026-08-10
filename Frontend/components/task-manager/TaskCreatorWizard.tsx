/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo } from 'react';
import { 
  Layers, 
  Briefcase, 
  Settings, 
  FileCheck, 
  Image as ImageIcon, 
  Type as TextIcon, 
  ListTodo as QuizIcon, 
  Mic as MicIcon,
  Video as VideoIcon, 
  Plus, 
  Trash2, 
  Check, 
  Calendar, 
  Users, 
  Layers3, 
  UserCheck, 
  ChevronRight, 
  ChevronLeft,
  ChevronDown,
  Search,
  Sparkles,
  Award
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  AssignmentLevel, 
  SubmissionFormat, 
  TaskDraft, 
  AssignedTask, 
  Sprint, 
  TeamMember,
  QuizQuestion,
} from '@/types/task';
import { useTenant } from '@/contexts/tenant-context';

export type CorporateLevels = {
  orgs: string[];
  functions: string[];
  subFunctions: Record<string, string[]>;
};

const isImageAvatar = (value: string) => /^https?:\/\//.test(value) || value.startsWith('data:') || value.startsWith('/');

interface TaskCreatorWizardProps {
  onTaskCreated: (newTask: AssignedTask) => void;
  onCancel: () => void;
  sprints?: Sprint[];
  teamMembers?: TeamMember[];
  corporateLevels?: CorporateLevels;
  onBackendCreate?: (payload: object) => Promise<any>;
  initialTask?: AssignedTask | null;
}

export default function TaskCreatorWizard({
  onTaskCreated,
  onCancel,
  sprints = [],
  teamMembers = [],
  corporateLevels = CORPORATE_LEVELS_DEFAULT,
  onBackendCreate,
  initialTask
}: TaskCreatorWizardProps) {
  const { hasFeature } = useTenant();

  // Wizard flow step
  const [activeStep, setActiveStep] = useState<WizardStep>('level');

  // Draft Data State
  const [associateWithSprint, setAssociateWithSprint] = useState<boolean>(
    initialTask ? initialTask.level === 'sprint' : true
  );
  const [taskMode, setTaskMode] = useState<'single' | 'multiple'>(
    initialTask ? (initialTask.tasks.length > 1 ? 'multiple' : 'single') : 'single'
  );
  const [dueDate, setDueDate] = useState<string>(() => {
    if (initialTask && initialTask.dueDate) {
      return initialTask.dueDate;
    }
    // Default 7 days from now
    const date = new Date();
    date.setDate(date.getDate() + 7);
    return date.toISOString().split('T')[0];
  });
  const [dueTime, setDueTime] = useState<string>('23:59');
  const [strictDeadline, setStrictDeadline] = useState<boolean>(true);

  const [recurrence, setRecurrence] = useState<'none' | 'every_2_days' | 'weekly' | 'monthly'>(
    initialTask ? (initialTask.recurrence as any) || 'none' : 'none'
  );

  // Array of tasks to assign (supports multiple tasks together)
  const [tasks, setTasks] = useState<TaskDraft[]>(() => {
    if (initialTask && initialTask.tasks && initialTask.tasks.length > 0) {
      return initialTask.tasks.map(t => ({
        id: t.id || `task-${Date.now()}-${Math.random()}`,
        title: t.title,
        description: t.description || '',
        expectedAnswer: t.expectedAnswer || '',
        submissionFormat: t.submissionFormat,
        questions: t.questions || []
      }));
    }
    return [
      {
        id: 'task-1',
        title: '',
        description: '',
        expectedAnswer: '',
        submissionFormat: 'text',
        questions: []
      }
    ];
  });

  // Target Sprints list (when level === 'sprint')
  const [selectedSprintIds, setSelectedSprintIds] = useState<string[]>(
    initialTask ? initialTask.targetSprints || [] : []
  );

  // Target Non-Sprint Levels (when level !== 'sprint')
  const [selectedOrgs, setSelectedOrgs] = useState<string[]>(
    initialTask ? initialTask.targetOrgs || [] : []
  );
  const [selectedFunctions, setSelectedFunctions] = useState<string[]>(
    initialTask ? initialTask.targetFunctions || [] : []
  );
  const [selectedSubFunctions, setSelectedSubFunctions] = useState<string[]>(
    initialTask ? initialTask.targetSubFunctions || [] : []
  );
  const [selectedIndividualIds, setSelectedIndividualIds] = useState<string[]>(
    initialTask ? initialTask.targetIndividuals || [] : []
  );

  // Filter query in Audience selector
  const [individualSearchQuery, setIndividualSearchQuery] = useState('');
  
  // Audience dropdowns state
  const [audienceDropdownOpen, setAudienceDropdownOpen] = useState<'branch' | 'dept' | 'unit' | null>(null);

  // Bundle metadata (for multi-task)
  const [bundleTitle, setBundleTitle] = useState(initialTask ? initialTask.title || '' : '');
  const [bundleDescription, setBundleDescription] = useState(initialTask ? initialTask.description || '' : '');

  // -------------------------
  // Helper State management
  // -------------------------
  const [formErrors, setFormErrors] = useState<string[]>([]);

  // Add empty task draft (Multiple Task support)
  const addNewTaskDraft = () => {
    const newId = `task-${Date.now()}`;
    setTasks(prev => [
      ...prev,
      {
        id: newId,
        title: '',
        description: '',
        expectedAnswer: '',
        submissionFormat: 'text',
        questions: []
      }
    ]);
    };

  // Remove task draft
  const removeTaskDraft = (id: string) => {
    if (tasks.length <= 1) return; // Must have at least 1
    setTasks(prev => prev.filter(t => t.id !== id));
  };

  // Update specific fields of a task draft
  const updateTaskField = (id: string, field: keyof TaskDraft, value: any) => {
    setTasks(prev => prev.map(t => {
      if (t.id === id) {
        return { ...t, [field]: value };
      }
      return t;
    }));
  };

  // Add Question to Quiz Editor
  const addQuizQuestionHandler = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return;

    const newQuestion: QuizQuestion = {
  id: `q-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
  question: '',
  type: 'single',
  options: ['', '', ''],
  correctAnswer: '',
  correctAnswers: [],
  writtenAnswer: ''
};

    updateTaskField(taskId, 'questions', [...task.questions, newQuestion]);
  };

  // Update Quiz Question Option text
  const updateQuestionOption = (taskId: string, questionId: string, optionIndex: number, text: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        const updatedQuestions = t.questions.map(q => {
          if (q.id === questionId) {
            const newOptions = [...q.options];
            newOptions[optionIndex] = text;
            return { ...q, options: newOptions };
          }
          return q;
        });
        return { ...t, questions: updatedQuestions };
      }
      return t;
    }));
  };

  // Add more Option fields to specific quiz question
  const addQuestionOptionField = (taskId: string, questionId: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        const updatedQuestions = t.questions.map(q => {
          if (q.id === questionId) {
            return { ...q, options: [...q.options, ''] };
          }
          return q;
        });
        return { ...t, questions: updatedQuestions };
      }
      return t;
    }));
  };

  // Remove Option field
  const removeQuestionOptionField = (taskId: string, questionId: string, indexToRemove: number) => {
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        const updatedQuestions = t.questions.map(q => {
          if (q.id === questionId) {
            const newOptions = q.options.filter((_, idx) => idx !== indexToRemove);
            return { ...q, options: newOptions };
          }
          return q;
        });
        return { ...t, questions: updatedQuestions };
      }
      return t;
    }));
  };

  // Update Quiz Question text
  const updateQuestionText = (taskId: string, questionId: string, text: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        const updatedQuestions = t.questions.map(q => {
          if (q.id === questionId) {
            return { ...q, question: text };
          }
          return q;
        });
        return { ...t, questions: updatedQuestions };
      }
      return t;
    }));
  };
  const updateQuestionType = (
  taskId: string,
  questionId: string,
  type: 'single' | 'multiple' | 'written'
) => {
  setTasks(prev =>
    prev.map(task =>
      task.id === taskId
        ? {
            ...task,
            questions: task.questions.map(q =>
              q.id === questionId
                ? {
                    ...q,
                    type,
                    correctAnswer: '',
                    correctAnswers:
                      type === 'multiple'
                        ? []
                        : []
                  }
                : q
            )
          }
        : task
    )
  );
};
const updateCorrectAnswer = (
  taskId: string,
  questionId: string,
  answer: string
) => {
  setTasks(prev =>
    prev.map(task => ({
      ...task,
      questions: task.questions.map(q =>
        q.id === questionId
          ? {
              ...q,
              correctAnswer: answer
            }
          : q
      )
    }))
  );
};


const toggleCorrectAnswer = (
  taskId: string,
  questionId: string,
  answer: string
) => {
  setTasks(prev =>
    prev.map(task =>
      task.id === taskId
        ? {
            ...task,
            questions: task.questions.map(q =>
              q.id === questionId
                ? {
                    ...q,
                    correctAnswers:
                      q.correctAnswers?.includes(answer)
                        ? q.correctAnswers.filter(
                            item => item !== answer
                          )
                        : [
                            ...(q.correctAnswers || []),
                            answer
                          ]
                  }
                : q
            )
          }
        : task
    )
  );
};

  // Delete entire Quiz Question
  const deleteQuizQuestion = (taskId: string, questionId: string) => {
    setTasks(prev => prev.map(t => {
      if (t.id === taskId) {
        return {
          ...t,
          questions: t.questions.filter(q => q.id !== questionId)
        };
      }
      return t;
    }));
  };

  // -------------------------
  // Filtering algorithms for Non-Sprint Levels
  // -------------------------

  // Computed: Filtered functional levels based on user choices
  const availableSubFunctions = useMemo(() => {
    if (selectedFunctions.length === 0) return [];
    let items: string[] = [];
    selectedFunctions.forEach(func => {
      const subs = corporateLevels.subFunctions[func] || [];
      items = [...items, ...subs];
    });
    return items;
  }, [selectedFunctions, corporateLevels]);

  // Computed: Dynamic filter of Team members matching ORGs, Functions, and Sub-functions
  const filteredTeamMembers = useMemo(() => {
    return teamMembers.filter(member => {
      // Filter by Org
      if (selectedOrgs.length > 0 && !selectedOrgs.includes(member.org)) {
        return false;
      }
      // Filter by function
      if (selectedFunctions.length > 0 && !selectedFunctions.includes(member.function)) {
        return false;
      }
      // Filter by subFunction
      if (selectedSubFunctions.length > 0 && !selectedSubFunctions.includes(member.subFunction)) {
        return false;
      }
      // Filter by search text
      if (individualSearchQuery.trim() !== '') {
        const searchVal = individualSearchQuery.toLowerCase();
        return (
          member.name.toLowerCase().includes(searchVal) ||
          member.email.toLowerCase().includes(searchVal)
        );
      }
      return true;
    });
  }, [selectedOrgs, selectedFunctions, selectedSubFunctions, individualSearchQuery, teamMembers]);

  // Handle Multi-Select helpers
  const toggleSelection = (item: string, list: string[], setter: React.Dispatch<React.SetStateAction<string[]>>) => {
    if (list.includes(item)) {
      setter(prev => prev.filter(x => x !== item));
    } else {
      setter(prev => [...prev, item]);
    }
  };

  const handleSelectPresets = (preset: string) => {
    if (preset === 'clear') {
      setSelectedOrgs([]);
      setSelectedFunctions([]);
      setSelectedSubFunctions([]);
      setSelectedIndividualIds([]);
    }
  };
  const toggleSubmissionFormat = (
    taskId: string,
    format: SubmissionFormat
  ) => {
    setTasks(prev =>
      prev.map(task => {
        if (task.id !== taskId) return task;

        const current = Array.isArray(task.submissionFormat)
          ? task.submissionFormat
          : [task.submissionFormat];

        const updated = current.includes(format)
          ? current.filter(item => item !== format)
          : [...current, format];

        return {
          ...task,
          submissionFormat: updated.length === 1 ? (updated[0] as SubmissionFormat) : (updated as SubmissionFormat[])
        };
      })
    );
  };
// };

  const handleSelectAllTeam = () => {
    const visibleIds = filteredTeamMembers.map(m => m.id);
    const allSelected = visibleIds.every(id => selectedIndividualIds.includes(id));
    if (allSelected) {
      // Deselect all visible
      setSelectedIndividualIds(prev => prev.filter(id => !visibleIds.includes(id)));
    } else {
      // Select all visible (union)
      setSelectedIndividualIds(prev => Array.from(new Set([...prev, ...visibleIds])));
    }
  };

  // const handleSelectPresets = (preset: 'all-hq' | 'all-engineering' | 'clear') => {
  //   if (preset === 'all-hq') {
  //     setSelectedOrgs(['Workfloww HQ']);
  //     setSelectedFunctions([]);
  //     setSelectedSubFunctions([]);
  //     const ids = teamMembers.filter(m => m.org === 'Workfloww HQ').map(m => m.id);
  //     setSelectedIndividualIds(ids);
  //   } else if (preset === 'all-engineering') {
  //     setSelectedOrgs([]);
  //     setSelectedFunctions(['Engineering']);
  //     setSelectedSubFunctions(['Frontend Engine', 'Backend Engine']);
  //     const ids = teamMembers.filter(m => m.function === 'Engineering').map(m => m.id);
  //     setSelectedIndividualIds(ids);
  //   } else if (preset === 'clear') {
  //     setSelectedOrgs([]);
  //     setSelectedFunctions([]);
  //     setSelectedSubFunctions([]);
  //     setSelectedIndividualIds([]);
  //   }
  // };

  // Validation function
  const validateStep = (step: WizardStep): string[] => {
    const errors: string[] = [];
    if (step === 'level') {
      if (associateWithSprint && selectedSprintIds.length === 0) {
        errors.push("You selected to associate with Sprints, but did not select any sprint cycles.");
      }
    }
    
    if (step === 'details') {
      if (taskMode === 'multiple') {
        if (!bundleTitle.trim()) errors.push("Task Name is required.");
        if (!bundleDescription.trim()) errors.push("Task Description is required.");
        tasks.forEach((t, i) => {
          if (t.title.trim().length < 5) errors.push(`Task Block #${i + 1}: Sub Task Name must be at least 5 characters.`);
          if (!t.expectedAnswer?.trim()) errors.push(`Task Block #${i + 1}: AI Analyzing Parameters are required.`);
          
          const hasQuiz = Array.isArray(t.submissionFormat) ? t.submissionFormat.includes('multiple_choice') : t.submissionFormat === 'multiple_choice';
          if (hasQuiz) {
            if (!t.questions || t.questions.length === 0) {
              errors.push(`Task Block #${i + 1}: At least one evaluation question is required.`);
            } else {
              t.questions.forEach((q, qIdx) => {
                if (!q.question.trim()) errors.push(`Task Block #${i + 1}, Question #${qIdx + 1}: Question text is required.`);
                const uniqueOptions = new Set(q.options.map(opt => opt.trim()));
                if (uniqueOptions.size !== q.options.length) {
                  errors.push(`Task Block #${i + 1}, Question #${qIdx + 1}: Options cannot be identical.`);
                }
              });
            }
          }
        });
      } else {
        const t = tasks[0];
        if (t.title.trim().length < 5) errors.push("Task Name must be at least 5 characters.");
        if (!t.description.trim()) errors.push("Task Description is required.");
        if (!t.expectedAnswer?.trim()) errors.push("AI Analyzing Parameters are required.");

        const hasQuiz = Array.isArray(t.submissionFormat) ? t.submissionFormat.includes('multiple_choice') : t.submissionFormat === 'multiple_choice';
        if (hasQuiz) {
          if (!t.questions || t.questions.length === 0) {
            errors.push("At least one evaluation question is required.");
          } else {
            t.questions.forEach((q, qIdx) => {
              if (!q.question.trim()) errors.push(`Question #${qIdx + 1}: Question text is required.`);
              const uniqueOptions = new Set(q.options.map(opt => opt.trim()));
              if (uniqueOptions.size !== q.options.length) {
                errors.push(`Question #${qIdx + 1}: Options cannot be identical.`);
              }
            });
          }
        }
      }
    }

    if (step === 'audience') {
      const hasAudience = (
        selectedOrgs.length > 0 ||
        selectedFunctions.length > 0 ||
        selectedSubFunctions.length > 0 ||
        selectedIndividualIds.length > 0
      );
      if (!hasAudience) {
        errors.push("Please select at least one target audience (users, orgs, functions, or sub-functions).");
      }
    }

    if (step === 'schedule') {
      if (!dueDate.trim()) errors.push("Due Date is required.");
    }

    return errors;
  };
  
  const isStepValid = (step: WizardStep): boolean => validateStep(step).length === 0;

  // Submit flow
  const handleLaunchFlow = async () => {
    const allErrors: string[] = [];
    const stepsToCheck: WizardStep[] = ['level', 'details', 'audience', 'schedule'];
    for (const step of stepsToCheck) {
      allErrors.push(...validateStep(step));
    }

    if (allErrors.length > 0) {
      alert("Please fix the following issues before launching:\n\n- " + allErrors.join("\n- "));
      return;
    }

    // Map targets names
    const targetSprintsNames = associateWithSprint 
      ? sprints.filter(s => selectedSprintIds.includes(s.id)).map(s => s.title)
      : [];

    const totalUsers = selectedIndividualIds.length > 0 ? selectedIndividualIds.length : filteredTeamMembers.length;

    const completedTask: AssignedTask = {
      id: `task-assigned-${Date.now()}`,
      level: 'individual',
      mode: taskMode,
      tasks: tasks.map(t => ({
        id: t.id,
        title: t.title,
        description: t.description,
        submissionFormat: t.submissionFormat as any,
        questions: t.questions
      })),
      targetSprints: targetSprintsNames,
      targetOrgs: selectedOrgs,
      targetFunctions: selectedFunctions,
      targetSubFunctions: selectedSubFunctions,
      targetIndividuals: teamMembers.filter(m => selectedIndividualIds.includes(m.id)).map(m => m.name),
      dueDate,
      createdAt: new Date().toISOString().split('T')[0],
      status: 'Active',
      completionCount: 0,
      totalTargetUsersCount: totalUsers > 0 ? totalUsers : 1,
      recurrence
    };

    if (onBackendCreate) {
      try {
        const normalizeFormat = (val: any) => (Array.isArray(val) ? val : String(val || 'text'));

        if (taskMode === 'multiple') {
          const payloadBase = {
            title: bundleTitle.trim() || `Task Bundle (${tasks.length} tasks)`,
            description: bundleDescription.trim() || 'Multiple task bundle',
            submission_format: 'bundle',
            bundle_tasks: tasks.map(t => ({
              title: t.title.trim(),
              description: t.description.trim(),
              expected_answer: t.expectedAnswer?.trim() || null,
              submission_format: normalizeFormat(t.submissionFormat),
              questions: (t.submissionFormat === 'multiple_choice' || (Array.isArray(t.submissionFormat) && t.submissionFormat.includes('multiple_choice')))
                ? t.questions.map(q => ({
                    ...q,
                    question: q.question.trim(),
                    options: q.options.map(option => option.trim()).filter(Boolean)
                  }))
                : []
            })),
            level: 'individual',
            target_user_ids: selectedIndividualIds,
            due_date: dueDate,
            recurrence
          };

          if (associateWithSprint && selectedSprintIds.length > 0) {
            for (const sprintId of selectedSprintIds) {
              await onBackendCreate({
                ...payloadBase,
                target_module_id: sprintId
              });
            }
          } else {
            await onBackendCreate(payloadBase);
          }
        } else {
          // single task
          const primaryTask = tasks[0];
          const payloadBase = {
            title: primaryTask.title.trim(),
            description: primaryTask.description.trim(),
            expected_answer: primaryTask.expectedAnswer?.trim() || null,
            submission_format: normalizeFormat(primaryTask.submissionFormat),
            questions: (primaryTask.submissionFormat === 'multiple_choice' || (Array.isArray(primaryTask.submissionFormat) && primaryTask.submissionFormat.includes('multiple_choice')))
              ? primaryTask.questions.map(q => ({
                  ...q,
                  question: q.question.trim(),
                  options: q.options.map(option => option.trim()).filter(Boolean)
                }))
              : [],
            level: 'individual',
            target_user_ids: selectedIndividualIds,
            due_date: dueDate,
            recurrence
          };

          if (associateWithSprint && selectedSprintIds.length > 0) {
            for (const sprintId of selectedSprintIds) {
              await onBackendCreate({
                ...payloadBase,
                target_module_id: sprintId
              });
            }
          } else {
            await onBackendCreate(payloadBase);
          }
        }
      } catch (error: any) {
        alert(error?.message || 'Task could not be created. Please review the task details and try again.');
        return;
      }
    }

    onTaskCreated(completedTask);
  };

  const stepsList: { id: WizardStep; label: string; desc: string }[] = [
    { id: 'level', label: '1. Target Scope', desc: 'Select organization assignment level' },
    { id: 'details', label: '2. Task Specifications', desc: 'Define objectives and formats' },
    { id: 'audience', label: '3. Recipient Filters', desc: 'Specify users or team units' },
    { id: 'schedule', label: '4. Timeline Assignment', desc: 'Set deadline and deploy' }
  ];

  return (
    <div className="flex flex-col xl:flex-row gap-6 w-full max-w-7xl mx-auto min-h-[580px]">
      
      {/* LEFT PORTION: The horizontal form container */}
      <div className="flex-1 bg-white rounded-2xl border border-[#E2E8F0] shadow-sm flex flex-col overflow-hidden">
        
        {/* Banner with color matching photo */}
        <div className="bg-gradient-to-r from-[#2F63FF] via-indigo-600 to-purple-600 px-6 py-5 text-white flex items-center justify-between">
          <div>
            <h2 className="font-display font-medium text-lg tracking-tight flex items-center space-x-2 shadow-sm">
              <span>Task Flow Configuration Console</span>
            </h2>
          </div>
          {/* <div className="bg-white/10 px-3 py-1 rounded-full text-xs font-mono font-medium flex items-center space-x-1.5 backdrop-blur-md">
          </div> */}
        </div>

        {/* Main Content Area with Vertical Sidebar */}
        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          
          {/* Vertical Navigation Stepper */}
          <div className="w-full md:w-72 border-b md:border-b-0 md:border-r border-[#F1F5F9] bg-[#FAFBFD] p-6 flex flex-col shrink-0 overflow-y-auto">
            <div className="flex flex-col space-y-6 relative">
              {stepsList.map((step, index) => {
                const isActive = activeStep === step.id;
                const isPast = stepsList.findIndex(s => s.id === activeStep) > index;
                
                return (
                  <div key={step.id} className="relative group">
                    <button
                      onClick={() => {
                        const currentIndex = stepsList.findIndex(s => s.id === activeStep);
                        if (index > currentIndex) {
                          for (let i = currentIndex; i < index; i++) {
                            const errors = validateStep(stepsList[i].id);
                            if (errors.length > 0) {
                              if (i === currentIndex) {
                                alert("Please fix the following issues before proceeding:\n\n- " + errors.join("\n- "));
                              } else {
                                alert(`Please complete the "${stepsList[i].label}" step before proceeding.`);
                                setActiveStep(stepsList[i].id);
                              }
                              return;
                            }
                          }
                        }
                        setActiveStep(step.id);
                      }}
                      className="flex items-start space-x-4 text-left focus:outline-none cursor-pointer w-full relative z-10"
                    >
                      <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center font-display text-xs font-semibold border transition-all duration-300 shadow-sm ${
                        isActive 
                          ? 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white border-transparent shadow-[0_0_15px_rgba(47,99,255,0.4)] ring-4 ring-indigo-50/50 scale-110'
                          : isPast 
                            ? 'bg-[#E1F9F0] text-[#10B981] border-[#10B981]'
                            : 'bg-white text-[#64748B] border-[#E2E8F0] group-hover:border-blue-300'
                      }`}>
                        {isPast ? <Check size={14} className="stroke-[3]" /> : index + 1}
                      </div>
                      <div className="pt-1.5 pb-2">
                        <p className={`text-sm font-semibold leading-none transition-colors ${
                          isActive ? 'text-[#2F63FF]' : 'text-[#334155]'
                        }`}>
                          {step.label}
                        </p>
                        <span className="text-[11px] text-gray-500 block mt-1 font-sans pr-2">
                          {step.desc}
                        </span>
                      </div>
                    </button>
                    {index < stepsList.length - 1 && (
                      <div className="absolute top-8 left-4 w-[2px] h-[calc(100%+8px)] bg-[#E2E8F0] -z-10 ml-[-1px]">
                        <div className={`w-full bg-[#2F63FF] transition-all duration-300 ${
                          isPast ? 'h-full' : 'h-0'
                        }`} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
  
          {/* Workspace Active Step */}
          <div className="p-6 md:p-8 flex-1 bg-white relative overflow-y-auto max-h-[600px] min-h-[500px]">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeStep}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.18 }}
              className="space-y-6"
            >
              
              {/* STEP 1: LEVEL and MODE */}
              {activeStep === 'level' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-sm font-semibold text-[#0F172A] mb-1 font-display">Sprint Association</h3>
                    <p className="text-xs text-gray-500 font-sans">Choose if this task should be associated with specific sprint cycles for tracking and reporting.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-xl">
                    <button
                      type="button"
                      onClick={() => setAssociateWithSprint(true)}
                      className={`p-5 rounded-2xl text-left border cursor-pointer transition-all duration-300 flex items-start space-x-4 relative overflow-hidden group hover:-translate-y-1 ${
                        associateWithSprint
                          ? 'border-indigo-400 shadow-lg shadow-indigo-500/15 bg-gradient-to-br from-indigo-50/80 to-blue-50/40'
                          : 'border-gray-200 hover:border-indigo-300 hover:shadow-md hover:bg-slate-50'
                      }`}
                    >
                      <div className={`p-3 rounded-xl transition-all duration-300 ${associateWithSprint ? 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md scale-105' : 'bg-gray-100 text-gray-500 group-hover:text-indigo-500 group-hover:bg-indigo-50 group-hover:scale-105'}`}>
                        <Layers size={20} />
                      </div>
                      <div className="flex-1 relative z-10 pt-0.5">
                        <span className={`text-[13px] font-bold font-sans block transition-colors duration-300 ${associateWithSprint ? 'text-indigo-900' : 'text-gray-700'}`}>Yes, associate with Sprints</span>
                        <p className="text-[11px] text-gray-500 mt-1.5 font-sans leading-relaxed">Link this task flow to one or more active training sprint cycles.</p>
                      </div>
                      {associateWithSprint && (
                        <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-blue-400 opacity-[0.15] rounded-full blur-2xl"></div>
                      )}
                    </button>
 
                    <button
                      type="button"
                      onClick={() => {
                        setAssociateWithSprint(false);
                        setSelectedSprintIds([]);
                      }}
                      className={`p-5 rounded-2xl text-left border cursor-pointer transition-all duration-300 flex items-start space-x-4 relative overflow-hidden group hover:-translate-y-1 ${
                        !associateWithSprint
                          ? 'border-indigo-400 shadow-lg shadow-indigo-500/15 bg-gradient-to-br from-indigo-50/80 to-blue-50/40'
                          : 'border-gray-200 hover:border-indigo-300 hover:shadow-md hover:bg-slate-50'
                      }`}
                    >
                      <div className={`p-3 rounded-xl transition-all duration-300 ${!associateWithSprint ? 'bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-md scale-105' : 'bg-gray-100 text-gray-500 group-hover:text-indigo-500 group-hover:bg-indigo-50 group-hover:scale-105'}`}>
                        <Users size={20} />
                      </div>
                      <div className="flex-1 relative z-10 pt-0.5">
                        <span className={`text-[13px] font-bold font-sans block transition-colors duration-300 ${!associateWithSprint ? 'text-indigo-900' : 'text-gray-700'}`}>No sprint association</span>
                        <p className="text-[11px] text-gray-500 mt-1.5 font-sans leading-relaxed">Create a general task flow independent of specific sprint schedules.</p>
                      </div>
                      {!associateWithSprint && (
                        <div className="absolute top-0 right-0 -mt-4 -mr-4 w-24 h-24 bg-blue-400 opacity-[0.15] rounded-full blur-2xl"></div>
                      )}
                    </button>
                  </div>

                  {associateWithSprint && (
                    <div className="space-y-3 pt-2">
                      <label className="text-xs font-bold text-[#334155] block">Select Sprints to Link (Multi-Select)</label>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-60 overflow-y-auto p-1 border border-gray-100 rounded-xl bg-slate-50/20">
                        {sprints.map((sprint) => {
                          const isSelected = selectedSprintIds.includes(sprint.id);
                          return (
                            <button
                              type="button"
                              key={sprint.id}
                              onClick={() => toggleSelection(sprint.id, selectedSprintIds, setSelectedSprintIds)}
                              className={`p-4 rounded-xl border text-left cursor-pointer transition-all flex items-center justify-between bg-white ${
                                isSelected
                                  ? 'border-[#2F63FF] bg-[#2F63FF]/5 shadow-sm shadow-indigo-50/50'
                                  : 'border-[#E2E8F0] hover:bg-slate-50'
                              }`}
                            >
                              <div className="flex items-center space-x-3">
                                <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                                  isSelected ? 'bg-[#2F63FF] text-white' : 'bg-gray-100 text-[#475569]'
                                }`}>
                                  <Layers3 size={15} />
                                </div>
                                <div>
                                  <p className="text-xs font-semibold text-[#0F172A]">{sprint.title}</p>
                                  <span className="text-[10px] font-mono text-gray-500">{sprint.code} • {sprint.status}</span>
                                </div>
                              </div>
                              <div className={`w-5 h-5 rounded-md border flex items-center justify-center ${
                                isSelected ? 'bg-[#2F63FF] border-[#2F63FF] text-white' : 'border-gray-300'
                              }`}>
                                {isSelected && <Check size={12} className="stroke-[3]" />}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="border-t border-[#F1F5F9] pt-5">
                    <h3 className="text-sm font-semibold text-[#0F172A] mb-1 font-display">Work Module Structure</h3>
                    <p className="text-xs text-gray-500 font-sans mb-4">Determine if you would like to deploy a single primary action or a bundle containing multiple custom checklist actions.</p>

                    <div className="relative flex p-1 bg-gray-100/80 backdrop-blur-md rounded-xl self-start max-w-[420px] border border-gray-200/50 shadow-inner overflow-hidden">
                      <div 
                        className="absolute top-1 bottom-1 w-[calc(50%-4px)] bg-white rounded-lg shadow-[0_1px_4px_rgba(0,0,0,0.08)] transition-transform duration-300 ease-out border border-gray-200/60"
                        style={{ transform: taskMode === 'multiple' ? 'translateX(100%)' : 'translateX(0)' }}
                      ></div>
                      
                      <button
                        onClick={() => {
                          setTaskMode('single');
                          if (tasks.length > 1) {
                            setTasks([tasks[0]]);
                          }
                        }}
                        className={`relative z-10 flex-1 py-3 px-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center justify-center space-x-2 ${
                          taskMode === 'single'
                            ? 'text-indigo-700'
                            : 'text-[#64748B] hover:text-[#0F172A]'
                        }`}
                      >
                        <FileCheck size={16} />
                        <span>Single Task Module</span>
                      </button>
                      <button
                        onClick={() => {
                          setTaskMode('multiple');
                        }}
                        className={`relative z-10 flex-1 py-3 px-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer flex items-center justify-center space-x-2 ${
                          taskMode === 'multiple'
                            ? 'text-indigo-700'
                            : 'text-[#64748B] hover:text-[#0F172A]'
                        }`}
                      >
                        <Settings size={16} />
                        <span>Multi-Task Bundle</span>
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* STEP 2: DETAILS */}
              {activeStep === 'details' && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-semibold text-[#0F172A] font-display font-bold">Configure Task Specifications </h3>
                      <p className="text-xs text-gray-500 mt-0.5 font-sans">Provide the name, instructions, and format for the task.</p>
                    </div>
                    {taskMode === 'multiple' && (
                      <button
                        type="button"
                        onClick={addNewTaskDraft}
                        className="inline-flex items-center space-x-1 px-3 py-1.5 h-8 bg-[#EEF2FF] text-[#2F63FF] hover:bg-[#E0E7FF] transition-all text-xs font-semibold rounded-lg cursor-pointer"
                      >
                        <Plus size={14} />
                        <span>Add Checklist Item</span>
                      </button>
                    )}
                  </div>

                  <div className="space-y-6">
                    {taskMode === 'multiple' && (
                      <div className="p-5 border border-[#E2E8F0] rounded-2xl bg-[#F8FAFC] space-y-4">
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-[#334155] block">
                            Task Name <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            value={bundleTitle}
                            onChange={(e) => setBundleTitle(e.target.value)}
                            placeholder="e.g., Weekly Onboarding Checks"
                            className="w-full text-xs text-[#0F172A] border border-[#E2E8F0] bg-white rounded-xl py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-[#2F63FF] focus:bg-white placeholder-gray-400"
                          />
                        </div>
                        <div className="space-y-1">
                          <label className="text-xs font-bold text-[#334155] block">
                            Task Description <span className="text-red-500">*</span>
                          </label>
                          <textarea
                            rows={3}
                            value={bundleDescription}
                            onChange={(e) => setBundleDescription(e.target.value)}
                            placeholder="Describe the overall instructions for this task."
                            className="w-full text-xs text-[#0F172A] border border-[#E2E8F0] bg-white rounded-xl py-2 px-3 focus:outline-none focus:ring-2 focus:ring-[#2F63FF] focus:bg-white placeholder-gray-400 font-sans"
                          />
                        </div>
                      </div>
                    )}

                    {tasks.map((taskItem, idx) => (
                      <div 
                        key={taskItem.id} 
                        className="p-5 border border-[#E2E8F0] rounded-2xl bg-[#FBFDFE] relative focus-within:ring-2 focus-within:ring-[#2F63FF]/20 focus-within:border-[#2F63FF] transition-all"
                      >
                        {taskMode === 'multiple' && (
                          <div className="absolute top-4 right-4 flex items-center space-x-2">
                            <span className="text-[10px] font-sans text-[#2F63FF] bg-[#EEF2FF] px-2 py-0.5 rounded-full font-semibold">
                              Sub Task #{idx + 1}
                            </span>
                            {tasks.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeTaskDraft(taskItem.id)}
                                className="text-gray-400 hover:text-red-500 p-1.5 transition-colors cursor-pointer"
                                title="Remove this task"
                              >
                                <Trash2 size={13} />
                              </button>
                            )}
                          </div>
                        )}

                        <div className="space-y-4">
                          {/* Title input */}
                          <div className="space-y-1">
                            <label className="text-xs font-bold text-[#334155] block">
                              {taskMode === 'multiple' ? 'Sub Task Name' : 'Task Name'} <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="text"
                              value={taskItem.title}
                              onChange={(e) => updateTaskField(taskItem.id, 'title', e.target.value)}
                              placeholder="e.g., Standard Operating Procedures Review / Code Quality Assurance Audit"
                              className="w-full text-xs text-[#0F172A] border border-[#E2E8F0] bg-white rounded-xl py-2.5 px-3 focus:outline-none focus:ring-2 focus:ring-[#2F63FF] focus:bg-white placeholder-gray-400"
                              id={`title-${taskItem.id}`}
                            />
                          </div>

                          {/* Description field */}
                          {taskMode === 'single' && (
                            <div className="space-y-1">
                              <label className="text-xs font-bold text-[#334155] block">
                                Task Description <span className="text-red-500">*</span>
                              </label>
                              <textarea
                                rows={3}
                                value={taskItem.description}
                                onChange={(e) => updateTaskField(taskItem.id, 'description', e.target.value)}
                                placeholder="Describe the instructions for this task."
                                className="w-full text-xs text-[#0F172A] border border-[#E2E8F0] bg-white rounded-xl py-2 px-3 focus:outline-none focus:ring-2 focus:ring-[#2F63FF] focus:bg-white placeholder-gray-400 font-sans"
                              />
                            </div>
                          )}

                          {/* AI Evaluation Parameters */}
                          <div className="space-y-1 bg-indigo-50/50 p-3 rounded-xl border border-indigo-100">
                            <label className="text-[11px] font-bold text-indigo-900 block flex items-center justify-between">
                              <span>Analyzing Parameters <span className="text-red-500">*</span></span>
                              
                            </label>
                            
                            <textarea
                              rows={2}
                              value={taskItem.expectedAnswer || ''}
                              onChange={(e) => updateTaskField(taskItem.id, 'expectedAnswer', e.target.value)}
                              placeholder="e.g., The photo must clearly show the equipment serial number and no blurry edges."
                              className="w-full text-xs text-[#0F172A] border border-indigo-200 bg-white rounded-lg py-2 px-3 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:bg-white placeholder-gray-400 font-sans"
                            />
                          </div>

                          {/* Submission Format Selection */}
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-[#334155] block">
                              Submission Format
                            </label>
                            
                            
                            <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
                              {/* Submit Image */}
                              {hasFeature('taskManagementImage') && (
                              <button
                                type="button"
                                onClick={() => toggleSubmissionFormat(taskItem.id, 'image')}
                                className={`p-3 rounded-xl border text-left flex flex-col sm:flex-row items-center justify-center sm:justify-start space-y-1 sm:space-y-0 sm:space-x-1 cursor-pointer transition-colors ${
                                  (Array.isArray(taskItem.submissionFormat) ? taskItem.submissionFormat.includes('image') : taskItem.submissionFormat === 'image')
                                    ? 'border-[#2F63FF] bg-[#2F63FF]/5 text-[#2F63FF]'
                                    : 'border-[#E2E8F0] hover:bg-slate-50 text-gray-600'
                                }`}
                              >
                                <ImageIcon size={14} className="shrink-0" />
                                <span className="text-[10px] font-semibold font-sans truncate text-center sm:text-left">Image</span>
                              </button>
                              )}

                              {/* Submit Text */}
                              {hasFeature('taskManagementTextual') && (
                              <button
                                type="button"
                                onClick={() => toggleSubmissionFormat(taskItem.id, 'text')}
                                className={`p-3 rounded-xl border text-left flex flex-col sm:flex-row items-center justify-center sm:justify-start space-y-1 sm:space-y-0 sm:space-x-1 cursor-pointer transition-colors ${
                                  (Array.isArray(taskItem.submissionFormat) ? taskItem.submissionFormat.includes('text') : taskItem.submissionFormat === 'text')
                                    ? 'border-[#2F63FF] bg-[#2F63FF]/5 text-[#2F63FF]'
                                    : 'border-[#E2E8F0] hover:bg-slate-50 text-gray-600'
                                }`}
                              >
                                <TextIcon size={14} className="shrink-0" />
                                <span className="text-[10px] font-semibold font-sans truncate text-center sm:text-left">Text Entry</span>
                              </button>
                              )}

                              {/* Submit Quiz Form */}
                              {hasFeature('taskManagementEvaluation') && (
                              <button
                                type="button"
                                onClick={() => toggleSubmissionFormat(taskItem.id, 'multiple_choice')}
                                className={`p-3 rounded-xl border text-left flex flex-col sm:flex-row items-center justify-center sm:justify-start space-y-1 sm:space-y-0 sm:space-x-1 cursor-pointer transition-colors ${
                                  (Array.isArray(taskItem.submissionFormat) ? taskItem.submissionFormat.includes('multiple_choice') : taskItem.submissionFormat === 'multiple_choice')
                                    ? 'border-[#2F63FF] bg-[#2F63FF]/5 text-[#2F63FF]'
                                    : 'border-[#E2E8F0] hover:bg-slate-50 text-gray-600'
                                }`}
                              >
                                <QuizIcon size={14} className="shrink-0" />
                                <span className="text-[10px] font-semibold font-sans truncate text-center sm:text-left">Evaluation</span>
                              </button>
                              )}

                              {/* Submit Audio */}
                              {hasFeature('taskManagementAudio') && (
                              <button
                                type="button"
                                onClick={() => toggleSubmissionFormat(taskItem.id, 'audio')}
                                className={`p-3 rounded-xl border text-left flex flex-col sm:flex-row items-center justify-center sm:justify-start space-y-1 sm:space-y-0 sm:space-x-1 cursor-pointer transition-colors ${
                                  (Array.isArray(taskItem.submissionFormat) ? taskItem.submissionFormat.includes('audio') : taskItem.submissionFormat === 'audio')
                                    ? 'border-[#2F63FF] bg-[#2F63FF]/5 text-[#2F63FF]'
                                    : 'border-[#E2E8F0] hover:bg-slate-50 text-gray-600'
                                }`}
                              >
                                <MicIcon size={14} className="shrink-0" />
                                <span className="text-[10px] font-semibold font-sans truncate text-center sm:text-left">Audio</span>
                              </button>
                              )}

                              {/* Submit Video */}
                              {hasFeature('taskManagementVideo') && (
                              <button
                                type="button"
                                onClick={() => toggleSubmissionFormat(taskItem.id, 'video')}
                                className={`p-3 rounded-xl border text-left flex flex-col sm:flex-row items-center justify-center sm:justify-start space-y-1 sm:space-y-0 sm:space-x-1 cursor-pointer transition-colors ${
                                  (Array.isArray(taskItem.submissionFormat) ? taskItem.submissionFormat.includes('video') : taskItem.submissionFormat === 'video')
                                    ? 'border-[#2F63FF] bg-[#2F63FF]/5 text-[#2F63FF]'
                                    : 'border-[#E2E8F0] hover:bg-slate-50 text-gray-600'
                                }`}
                              >
                                <VideoIcon size={14} className="shrink-0" />
                                <span className="text-[10px] font-semibold font-sans truncate text-center sm:text-left">Video</span>
                              </button>
                              )}
                            </div>
                          </div>

                          {/* MULTIPLE CHOICE FORM BUILDER */}
                          {(Array.isArray(taskItem.submissionFormat) ? taskItem.submissionFormat.includes('multiple_choice') : taskItem.submissionFormat === 'multiple_choice') && (
                            <div className="bg-slate-50 rounded-xl p-4 border border-[#E2E8F0] space-y-4">
                              <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-[#0F172A] flex items-center space-x-2">
                                  <QuizIcon size={14} className="text-[#2F63FF]" />
                                  <span>Questions Generator ({taskItem.questions.length})</span>
                                </span>
                                <button
                                  type="button"
                                  onClick={() => addQuizQuestionHandler(taskItem.id)}
                                  className="text-[11px] font-semibold text-[#2F63FF] hover:underline flex items-center space-x-1 cursor-pointer"
                                >
                                  <Plus size={12} />
                                  <span>Add Question</span>
                                </button>
                              </div>

                              {taskItem.questions.length === 0 ? (
                                <div className="text-center py-6 border border-dashed border-[#CBD5E1] rounded-lg bg-white">
                                  <QuizIcon className="mx-auto text-gray-300 mb-2" size={24} />
                                  <p className="text-xs text-gray-500">Configure multi-choice questions for verification</p>
                                  <button
                                    type="button"
                                    onClick={() => addQuizQuestionHandler(taskItem.id)}
                                    className="text-xs font-semibold text-[#2F63FF] mt-2 inline-flex items-center space-x-1"
                                  >
                                    <Plus size={12} /> <span>Create first question</span>
                                  </button>
                                  {formErrors.find(e => e.includes(taskMode === 'multiple' ? `Task Block #${idx + 1}: At least one evaluation question` : `At least one evaluation question`)) && (
                                    <p className="text-red-500 text-[10px] mt-2 font-semibold">
                                      {formErrors.find(e => e.includes(taskMode === 'multiple' ? `Task Block #${idx + 1}: At least one evaluation question` : `At least one evaluation question`))?.split(': ')[1] || 'At least one evaluation question is required.'}
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <div className="space-y-4">
                                  {taskItem.questions.map((quizQ, qIdx) => (
                                    <div key={quizQ.id} className="p-3 bg-white border border-[#E2E8F0] rounded-lg space-y-3 relative">
                                      <button
                                        type="button"
                                        onClick={() => deleteQuizQuestion(taskItem.id, quizQ.id)}
                                        className="absolute top-2.5 right-2.5 text-gray-400 hover:text-red-500 p-1 cursor-pointer"
                                      >
                                        <Trash2 size={12} />
                                      </button>

                                      <div className="space-y-1.5 pr-6">
                                        <label className="text-[11px] font-semibold text-gray-500 uppercase tracking-widest block font-mono">
                                          Question {qIdx + 1}
                                        </label>
                                        <input
                                          type="text"
                                          value={quizQ.question}
                                          onChange={(e) => updateQuestionText(taskItem.id, quizQ.id, e.target.value)}
                                          placeholder="Enter the quiz question..."
                                          className="w-full text-xs text-[#0F172A] border-b border-[#F1F5F9] focus:border-[#2F63FF] py-1.5 focus:outline-none placeholder-gray-400"
                                        />
                                        {formErrors.find(e => e.includes(taskMode === 'multiple' ? `Task Block #${idx + 1}, Question #${qIdx + 1}: Question text` : `Question #${qIdx + 1}: Question text`)) && (
                                          <p className="text-red-500 text-[10px] mt-1 font-semibold">
                                            {formErrors.find(e => e.includes(taskMode === 'multiple' ? `Task Block #${idx + 1}, Question #${qIdx + 1}: Question text` : `Question #${qIdx + 1}: Question text`))?.split(': ')[1] || 'Question text is required.'}
                                          </p>
                                        )}
                                        <select
value={quizQ.type}
onChange={(e)=>
 updateQuestionType(
  taskItem.id,
  quizQ.id,
  e.target.value as any
 )
}
className="border rounded-lg text-xs p-2"
>
<option value="single">
 Single Answer
</option>

<option value="multiple">
 Multiple Answer
</option>
</select>
                                      </div>

                                      <div className="space-y-2">
                                        <label className="text-[10px] font-bold text-gray-500 block">Available Selection Options:</label>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                         {quizQ.options.map((opt, optIdx) => (
  <div 
    key={optIdx}
    className="flex items-center space-x-1.5"
  >

    {/* Correct answer selector */}
    {quizQ.type !== 'written' && (
      <input
  type={quizQ.type === 'multiple' ? "checkbox" : "radio"}
  name={
    quizQ.type === "single"
      ? quizQ.id
      : undefined
  }

  checked={
    quizQ.type === 'multiple'
      ? quizQ.correctAnswers?.includes(opt)
      : quizQ.correctAnswer === opt
  }

  onChange={() => {
    if (quizQ.type === 'multiple') {
      toggleCorrectAnswer(
        taskItem.id,
        quizQ.id,
        opt
      );
    } else {
      updateCorrectAnswer(
        taskItem.id,
        quizQ.id,
        opt
      );
    }
  }}
/>
    )}


    <span className="text-[10px] font-mono font-semibold bg-[#EEF2FF] text-[#2F63FF] rounded w-5 h-5 flex items-center justify-center">
      {String.fromCharCode(65 + optIdx)}
    </span>


    <input
      type="text"

      value={opt}

      onChange={(e) =>
        updateQuestionOption(
          taskItem.id,
          quizQ.id,
          optIdx,
          e.target.value
        )
      }

      placeholder={`Option ${optIdx + 1}`}

      className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#2F63FF]"
    />


    {quizQ.options.length > 2 && (

      <button
        type="button"

        onClick={() =>
          removeQuestionOptionField(
            taskItem.id,
            quizQ.id,
            optIdx
          )
        }

        className="text-gray-400 hover:text-red-500"
        title="Delete Option"
      >

        &times;

      </button>

    )}

  </div>
))}
                                        </div>
                                        {formErrors.find(e => e.includes(taskMode === 'multiple' ? `Task Block #${idx + 1}, Question #${qIdx + 1}: Options cannot be identical` : `Question #${qIdx + 1}: Options cannot be identical`)) && (
                                          <p className="text-red-500 text-[10px] mt-1 font-semibold">
                                            {formErrors.find(e => e.includes(taskMode === 'multiple' ? `Task Block #${idx + 1}, Question #${qIdx + 1}: Options cannot be identical` : `Question #${qIdx + 1}: Options cannot be identical`))?.split(': ')[1] || 'Options cannot be identical.'}
                                          </p>
                                        )}
                                        {quizQ.options.length < 6 && (
                                          <button
                                            type="button"
                                            onClick={() => addQuestionOptionField(taskItem.id, quizQ.id)}
                                            className="text-[10px] font-semibold text-gray-500 hover:text-[#2F63FF] transition-all flex items-center space-x-1"
                                          >
                                            <Plus size={10} />
                                            <span>Add more choices</span>
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}

                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* STEP 3: AUDIENCE ASSIGNMENT */}
              {activeStep === 'audience' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-sm font-semibold text-[#0F172A] font-display font-bold">Designate Recipient Audience</h3>
                    <p className="text-xs text-gray-500 mt-0.5 font-sans">
                      Define target parameters below to assign direct business divisions, departments, or custom individual employees.
                    </p>
                  </div>
                    <div className="space-y-4">
                      
                      {/* Presets and filters bar */}
                      
                        {/* <span className="text-[11px] font-bold text-gray-500 uppercase tracking-widest font-mono">Audience Selection Shortcuts:</span> */}
                        
                          {/* <button
                            type="button"
                            onClick={() => handleSelectPresets('all-hq')}
                            className="bg-white hover:bg-[#EEF2FF] border border-gray-200 text-gray-700 text-[10px] font-semibold px-2 py-1 rounded transition-colors cursor-pointer"
                          >
                            HQ Office Team
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSelectPresets('all-engineering')}
                            className="bg-white hover:bg-[#EEF2FF] border border-gray-100 text-gray-700 text-[10px] font-semibold px-2 py-1 rounded transition-colors cursor-pointer"
                          >
                            All Builders Team
                          </button> */}
                        

                      {/* Segmentation Panels */}
                      <div className="flex flex-col md:flex-row gap-4">
                        
                        {/* 1. Functions Node */}
                        <div className="relative flex-1">
                          <button
                            type="button"
                            onClick={() => setAudienceDropdownOpen(prev => prev === 'dept' ? null : 'dept')}
                            className="w-full flex items-center justify-between p-3 border border-gray-200 rounded-xl bg-white hover:bg-slate-50 transition-colors"
                          >
                            <div className="flex flex-col text-left">
                              <span className="text-xs font-bold text-[#334155]">Function</span>
                              <span className="text-[10px] text-gray-500 mt-0.5">
                                {selectedFunctions.length > 0 ? `${selectedFunctions.length} Selected` : 'Select Functions'}
                              </span>
                            </div>
                            <ChevronDown size={14} className={`text-gray-400 transition-transform ${audienceDropdownOpen === 'dept' ? 'rotate-180' : ''}`} />
                          </button>
                          
                          {audienceDropdownOpen === 'dept' && (
                            <div className="absolute z-20 top-full left-0 mt-2 w-full bg-white border border-gray-200 shadow-xl rounded-xl p-2 max-h-60 overflow-y-auto">
                              <div className="space-y-1">
                                {Array.from(new Set(corporateLevels.functions)).sort((a, b) => a.localeCompare(b)).map((func) => {
                                  const selected = selectedFunctions.includes(func);
                                  return (
                                    <button
                                      key={func}
                                      onClick={() => toggleSelection(func, selectedFunctions, setSelectedFunctions)}
                                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs leading-none cursor-pointer transition-colors ${
                                        selected ? 'bg-[#EEF2FF] text-[#2F63FF] font-medium' : 'hover:bg-slate-50 text-gray-600'
                                      }`}
                                    >
                                      <span>{func}</span>
                                      {selected && <Check size={12} className="text-[#2F63FF]" />}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>

                        {/* 2. Sub-Functions Node */}
                        <div className="relative flex-1">
                          <button
                            type="button"
                            onClick={() => setAudienceDropdownOpen(prev => prev === 'unit' ? null : 'unit')}
                            className="w-full flex items-center justify-between p-3 border border-gray-200 rounded-xl bg-white hover:bg-slate-50 transition-colors"
                          >
                            <div className="flex flex-col text-left">
                              <span className="text-xs font-bold text-[#334155]">Sub Function</span>
                              <span className="text-[10px] text-gray-500 mt-0.5">
                                {selectedSubFunctions.length > 0 ? `${selectedSubFunctions.length} Selected` : 'Select Sub Functions'}
                              </span>
                            </div>
                            <ChevronDown size={14} className={`text-gray-400 transition-transform ${audienceDropdownOpen === 'unit' ? 'rotate-180' : ''}`} />
                          </button>
                          
                          {audienceDropdownOpen === 'unit' && (
                            <div className="absolute z-20 top-full left-0 mt-2 w-full bg-white border border-gray-200 shadow-xl rounded-xl p-2 max-h-60 overflow-y-auto">
                              {selectedFunctions.length === 0 ? (
                                <div className="p-4 text-center border border-dashed border-gray-100 rounded-lg">
                                  <p className="text-[10px] text-gray-400">Pick a Function first to see focus teams!</p>
                                </div>
                              ) : (
                                <div className="space-y-1">
                                  {Array.from(new Set(availableSubFunctions)).sort((a, b) => a.localeCompare(b)).map((subF) => {
                                    const selected = selectedSubFunctions.includes(subF);
                                    return (
                                      <button
                                        key={subF}
                                        onClick={() => toggleSelection(subF, selectedSubFunctions, setSelectedSubFunctions)}
                                        className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs leading-none cursor-pointer transition-colors ${
                                          selected ? 'bg-[#EEF2FF] text-[#2F63FF] font-medium' : 'hover:bg-slate-50 text-gray-600'
                                        }`}
                                      >
                                        <span>{subF}</span>
                                        {selected && <Check size={12} className="text-[#2F63FF]" />}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 4. Filtered Individuals Selection */}
                      <div className="border border-gray-200 rounded-xl p-4 bg-slate-50/50 space-y-3 mt-4">
                        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between space-y-3 lg:space-y-0 gap-4">
                          <div className="flex-1 min-w-0">
                            <span className="text-xs font-bold text-[#334155] block truncate">Select Targeted Personnel ({selectedIndividualIds.length} Selected)</span>
                            <p className="text-[10px] text-gray-500 truncate">Displays matching staff based on your selections above.</p>
                          </div>
                          
                          <div className="flex items-center space-x-2 shrink-0">
                            {/* Search */}
                            <div className="relative">
                              <Search className="absolute left-2.5 top-2 text-gray-400" size={13} />
                              <input
                                type="text"
                                value={individualSearchQuery}
                                onChange={(e) => setIndividualSearchQuery(e.target.value)}
                                placeholder="Search personnel..."
                                className="bg-white border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-[#2F63FF] w-40 sm:w-48"
                              />
                            </div>
                            
                            <button
                              type="button"
                              onClick={handleSelectAllTeam}
                              className="text-xs font-semibold text-[#2F63FF] border border-gray-200 hover:bg-slate-50 bg-white px-3 py-1.5 rounded-lg cursor-pointer whitespace-nowrap shadow-sm"
                            >
                              Select All ({filteredTeamMembers.length})
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSelectPresets('clear')}
                              className="bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap shadow-sm"
                            >
                              Reset
                            </button>
                          </div>
                        </div>

                        {filteredTeamMembers.length === 0 ? (
                          <div className="p-8 text-center bg-white border border-dashed border-gray-200 rounded-lg">
                            <p className="text-xs text-gray-400">No personnel match the current criteria.</p>
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-[180px] overflow-y-auto">
                            {filteredTeamMembers.map((member) => {
                              const isChecked = selectedIndividualIds.includes(member.id);
                              return (
                                <button
                                  key={member.id}
                                  onClick={() => toggleSelection(member.id, selectedIndividualIds, setSelectedIndividualIds)}
                                  className={`p-2.5 rounded-xl border text-left cursor-pointer transition-all flex items-center justify-between ${
                                    isChecked
                                      ? 'border-[#2F63FF] bg-white shadow-sm ring-2 ring-indigo-50/50'
                                      : 'border-gray-200 hover:border-gray-300 bg-white'
                                  }`}
                                >
                                  <div className="flex items-center space-x-2.5 min-w-0">
                                    {isImageAvatar(member.avatar) ? (
                                      <img 
                                        src={member.avatar} 
                                        alt={member.name} 
                                        referrerPolicy="no-referrer"
                                        className="w-8 h-8 rounded-full bg-slate-100 object-cover" 
                                      />
                                    ) : (
                                      <span className="w-8 h-8 rounded-full bg-slate-100 text-[#2F63FF] flex items-center justify-center text-xs font-bold">
                                        {member.avatar || member.name.slice(0, 1).toUpperCase()}
                                      </span>
                                    )}
                                    <div className="min-w-0">
                                      <p className="text-xs font-semibold text-[#0F172A] truncate leading-none">{member.name}</p>
                                      <span className="text-[9px] text-[#2F63FF] font-mono block mt-1 uppercase tracking-tight">{member.function} • {member.subFunction}</span>
                                    </div>
                                  </div>
                                  <div className={`w-4.5 h-4.5 rounded-full border flex items-center justify-center ${
                                    isChecked ? 'bg-[#2F63FF] border-[#2F63FF] text-white' : 'border-gray-300'
                                  }`}>
                                    {isChecked && <Check size={10} className="stroke-[3]" />}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                    </div>


                </div>
              )}

              {/* STEP 4: DUE DATE AND SCHEDULE */}
              {activeStep === 'schedule' && (
                <div className="space-y-6">
                  <div>
                    <h3 className="text-sm font-semibold text-[#0F172A] font-display font-bold">Schedule Delivery & Due Date</h3>
                    <p className="text-xs text-gray-500 mt-0.5 font-sans">Establish target completion deadlines and verify configurations on the pipeline summary panel.</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-0 md:gap-6 relative p-6 md:p-8 border border-indigo-100 rounded-3xl bg-gradient-to-br from-white via-indigo-50/40 to-blue-50/40 shadow-xl shadow-indigo-900/5 overflow-hidden">
                    {/* Decorative Glowing Orbs */}
                    <div className="absolute top-0 right-0 -mt-12 -mr-12 w-48 h-48 bg-blue-400/20 rounded-full blur-3xl pointer-events-none"></div>
                    <div className="absolute bottom-0 left-0 -mb-12 -ml-12 w-48 h-48 bg-purple-400/15 rounded-full blur-3xl pointer-events-none"></div>

                    {/* Date Picker Component (Left Column) */}
                    <div className="space-y-6 relative z-10 pb-6 md:pb-0 md:pr-6 md:border-r border-indigo-200/40">
                      <div className="space-y-4">
                        <span className="text-sm font-bold text-indigo-950 flex items-center space-x-1.5">
                          <span>Completion Deadline</span>
                        </span>
                        <div className="flex space-x-3">
                          <input
                            type="date"
                            value={dueDate}
                            onChange={(e) => setDueDate(e.target.value)}
                            className="flex-1 text-sm font-medium text-[#0F172A] border border-indigo-200/60 rounded-xl py-3 px-4 bg-white/80 backdrop-blur-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#2F63FF] focus:border-transparent transition-all"
                          />
                          <input
                            type="time"
                            value={dueTime}
                            onChange={(e) => setDueTime(e.target.value)}
                            className="w-32 text-sm font-medium text-[#0F172A] border border-indigo-200/60 rounded-xl py-3 px-4 bg-white/80 backdrop-blur-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-[#2F63FF] focus:border-transparent transition-all"
                          />
                        </div>

                        {/* Strict Deadline Toggle */}
                        <label className="flex items-start space-x-3 p-3 bg-white/60 border border-indigo-100/60 rounded-xl cursor-pointer hover:bg-white transition-all shadow-sm">
                          <div className="relative flex items-center mt-0.5">
                            <input 
                              type="checkbox" 
                              checked={strictDeadline}
                              onChange={(e) => setStrictDeadline(e.target.checked)}
                              className="sr-only peer" 
                            />
                            <div className="w-8 h-4.5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-3.5 after:w-3.5 after:transition-all peer-checked:bg-[#2F63FF]"></div>
                          </div>
                          <div>
                            <span className="text-xs font-bold text-indigo-900 block">Strict Deadline Enforcement</span>
                            <span className="text-[10px] text-gray-500 block leading-tight mt-0.5">Automatically reject late submissions after deadline</span>
                          </div>
                        </label>

                        {/* Relative shortcuts */}
                        <div className="grid grid-cols-2 gap-3 pt-1">
                          <button
                            type="button"
                            onClick={() => {
                              const d = new Date();
                              d.setDate(d.getDate() + 1);
                              setDueDate(d.toISOString().split('T')[0]);
                            }}
                            className="bg-white/60 hover:bg-white text-indigo-700 border border-indigo-100/60 shadow-sm hover:shadow p-3 text-center text-xs font-bold rounded-xl transition-all cursor-pointer hover:-translate-y-0.5"
                          >
                            Due Tomorrow
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const d = new Date();
                              d.setDate(d.getDate() + 7);
                              setDueDate(d.toISOString().split('T')[0]);
                            }}
                            className="bg-white/60 hover:bg-white text-indigo-700 border border-indigo-100/60 shadow-sm hover:shadow p-3 text-center text-xs font-bold rounded-xl transition-all cursor-pointer hover:-translate-y-0.5"
                          >
                            7-Day Deadline
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              const d = new Date();
                              d.setDate(d.getDate() + 14);
                              setDueDate(d.toISOString().split('T')[0]);
                            }}
                            className="bg-white/60 hover:bg-white text-indigo-700 border border-indigo-100/60 shadow-sm hover:shadow p-3 text-center text-xs font-bold rounded-xl transition-all cursor-pointer hover:-translate-y-0.5"
                          >
                            14-Day Deadline
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              // End of Sprint Mock
                              setDueDate('2026-06-30');
                            }}
                            className="bg-white/60 hover:bg-white text-indigo-700 border border-indigo-100/60 shadow-sm hover:shadow p-3 text-center text-xs font-bold rounded-xl transition-all cursor-pointer hover:-translate-y-0.5"
                          >
                            End of Month
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Recurrence Options (Right Column) */}
                    <div className="space-y-4 relative z-10 pt-6 md:pt-0 md:pl-2 border-t border-indigo-200/40 md:border-t-0">
                      <div>
                        <span className="text-sm font-bold text-indigo-950 flex items-center space-x-1.5">
                          <span>Fulfillment Recurrence Schedule</span>
                        </span>
                        <p className="text-[11px] text-gray-500 mt-1 leading-relaxed font-sans pr-4">
                          Automate workflow checklist repetition. Setting a schedule creates recurring checkpoints.
                        </p>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-3">
                        {[
                          { id: 'none', label: 'One-time Task', desc: 'No recurrence pattern' },
                          { id: 'every_2_days', label: 'Every 2 Days', desc: 'Interval recurrence' },
                          { id: 'weekly', label: 'Weekly Repeat', desc: 'Runs every 7 days' },
                          { id: 'monthly', label: 'Monthly Repeat', desc: 'Runs every calendar month' }
                        ].map((item) => {
                          const isSelectedRec = recurrence === item.id;
                          return (
                            <button
                              key={item.id}
                              type="button"
                              onClick={() => setRecurrence(item.id as any)}
                              className={`p-3.5 rounded-xl border text-left cursor-pointer transition-all duration-300 flex flex-col justify-between ${
                                isSelectedRec
                                  ? 'border-transparent bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-indigo-500/30 scale-[1.02]'
                                  : 'border-indigo-100/60 bg-white/60 hover:bg-white shadow-sm hover:shadow text-gray-700 hover:-translate-y-0.5'
                              }`}
                            >
                              <span className={`text-xs font-bold leading-tight ${isSelectedRec ? 'text-white' : 'text-indigo-900'}`}>{item.label}</span>
                              <span className={`text-[10px] block mt-1.5 ${isSelectedRec ? 'text-indigo-100' : 'text-gray-500'}`}>
                                {item.desc}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Submission validation state message */}
                  {!isStepValid('details') && (
                    <div className="p-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs rounded-xl font-medium">
                      ⚠️ Note: Some tasks in Step 2 are incomplete! Please go back and write titles + instructions before sending.
                    </div>
                  )}

                  <div className="border-t border-[#F1F5F9] pt-5 flex justify-end space-x-3">
                    <button
                      type="button"
                      onClick={onCancel}
                      className="px-5 py-2.5 border border-[#E2E8F0] hover:bg-slate-50 transition-colors text-xs font-semibold rounded-xl text-gray-700 cursor-pointer"
                    >
                      Save Draft
                    </button>
                    <button
                      type="button"
                      onClick={handleLaunchFlow}
                      disabled={!isStepValid('details') || !isStepValid('audience')}
                      className={`px-6 py-2.5 text-xs text-white font-semibold rounded-xl cursor-pointer transition-all flex items-center space-x-2 ${
                        isStepValid('details') || isStepValid('audience') // Fallback to keep playground playful and accessible
                          ? 'bg-[#2F63FF] hover:bg-blue-700 shadow-md shadow-blue-200'
                          : 'bg-gray-300 pointer-events-none opacity-60'
                      }`}
                    >
                      
                      <span>Deploy Workflow</span>
                    </button>
                  </div>
                </div>
              )}

            </motion.div>
          </AnimatePresence>
        </div>
        </div>

        {/* Footer controls */}
        <div className="bg-[#FAFBFD] border-t border-[#F1F5F9] px-6 py-4 flex items-center justify-between">
          <div>
            <button
              onClick={onCancel}
              className="text-xs font-semibold text-gray-400 hover:text-[#2F63FF] transition-colors cursor-pointer"
            >
              Discard Draft
            </button>
          </div>
          <div className="flex items-center space-x-3">
            {activeStep !== 'level' && (
              <button
                type="button"
                onClick={() => {
                  const idx = stepsList.findIndex(s => s.id === activeStep);
                  if (idx > 0) setActiveStep(stepsList[idx - 1].id);
                }}
                className="px-4 py-2 border border-[#E2E8F0] hover:bg-slate-50 transition-colors text-xs font-semibold rounded-xl text-gray-700 cursor-pointer flex items-center space-x-1"
              >
                <ChevronLeft size={14} />
                <span>Previous Step</span>
              </button>
            )}

            {activeStep !== 'schedule' ? (
              <button
                type="button"
                onClick={() => {
                  const errors = validateStep(activeStep);
                  if (errors.length > 0) {
                    setFormErrors(errors);
                    return;
                  }
                  setFormErrors([]);
                  const idx = stepsList.findIndex(s => s.id === activeStep);
                  if (idx < stepsList.length - 1) setActiveStep(stepsList[idx + 1].id);
                }}
                className="px-5 py-2 text-xs font-semibold rounded-xl transition-all flex items-center space-x-1 cursor-pointer bg-[#2F63FF] text-white hover:bg-blue-700 shadow-sm"
              >
                <span>Next Step</span>
                <ChevronRight size={14} />
              </button>
            ) : null}
          </div>
        </div>

      </div>

      {/* RIGHT PORTION: Dynamic visual tablet preview device */}
      {/* <div className="w-full xl:w-80 bg-slate-50 rounded-2xl border border-[#E2E8F0] p-4 flex flex-col justify-between max-h-[700px] shadow-inner font-sans">
        <div>
          <div className="flex items-center justify-between border-b border-gray-200 pb-3 mb-4">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider font-mono">📱 MOBILE PREVIEW</span>
            <div className="flex space-x-1">
              <span className="w-2 h-2 rounded-full bg-red-400"></span>
              <span className="w-2 h-2 rounded-full bg-yellow-400"></span>
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            </div>
          </div>

          <p className="text-[10px] text-gray-500 mb-4 text-center italic">
            Visual render of the assignee mobile interface:
          </p>

          <div className="space-y-4">
            {tasks.map((taskItem, tIdx) => (
              <div 
                key={taskItem.id} 
                className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm relative overflow-hidden"
              > */}
                {/* Decorative status accent */}
                {/* <div className="absolute top-0 left-0 w-1 h-full bg-[#2F63FF]"></div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-sans font-bold text-[#2F63FF] bg-[#EEF2FF] px-1.5 py-0.5 rounded">
                      TASK #{tIdx + 1}
                    </span>
                    <span className="text-[9px] text-[#10B981] font-medium block">Active 🟩</span>
                  </div>

                  <h4 className="text-xs font-bold text-[#0F172A] leading-tight truncate">
                    {taskItem.title.trim() === '' ? 'Unconfigured Task' : taskItem.title}
                  </h4>

                  <p className="text-[10px] text-[#475569] leading-relaxed line-clamp-3">
                    {taskItem.description.trim() === '' ? 'Fulfillment guidelines will render here.' : taskItem.description}
                  </p> */}

                  {/* Submission box render representation */}
                  {/* <div className="border-t border-dashed border-gray-100 pt-3 mt-3">
                    <span className="text-[9px] font-bold text-gray-400 uppercase tracking-widest block mb-2">Required Validation Action:</span>
                    
                    {(Array.isArray(taskItem.submissionFormat) ? taskItem.submissionFormat.includes('image') : taskItem.submissionFormat === 'image') && (
                      <div className="border border-dashed border-gray-200 rounded-lg p-3 text-center bg-slate-50 cursor-not-allowed mb-2">
                        <span className="w-6 h-6 rounded-full bg-white border border-gray-100 flex items-center justify-center mx-auto mb-1.5 shadow-sm text-gray-400">
                          <ImageIcon size={12} />
                        </span>
                        <span className="text-[9px] font-medium text-gray-500 block">Upload image validation</span>
                        <span className="text-[8px] text-gray-400 block mt-0.5">Supports PNG, JPG, or HEIC formats</span>
                      </div>
                    )}

                    {(Array.isArray(taskItem.submissionFormat) ? taskItem.submissionFormat.includes('text') : taskItem.submissionFormat === 'text') && (
                      <div className="border border-gray-200 rounded-lg p-2.5 bg-slate-50 relative cursor-not-allowed mb-2">
                        <div className="space-y-1">
                          <div className="h-1 bg-gray-200 rounded w-full"></div>
                          <div className="h-1 bg-gray-200 rounded w-5/6"></div>
                        </div>
                        <span className="text-[8px] text-gray-400 block text-right mt-2 font-sans">Type description / explanation...</span>
                      </div>
                    )}

                    {(Array.isArray(taskItem.submissionFormat) ? taskItem.submissionFormat.includes('multiple_choice') : taskItem.submissionFormat === 'multiple_choice') && (
                      <div className="bg-slate-50 rounded-lg p-2.5 border border-gray-100 space-y-2 mb-2">
                        {taskItem.questions.length === 0 ? (
                          <div className="text-center py-2 text-[10px] text-gray-400 font-sans">
                            Configure evaluation items in step 2.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {taskItem.questions.slice(0, 1).map((q, idx) => (
                              <div key={idx} className="space-y-1.5">
                                <p className="text-[9px] font-bold text-gray-700 leading-tight">
                                  {q.question.trim() === '' ? 'Unconfigured Evaluation Question?' : q.question}
                                </p>
                                <div className="space-y-1">
                                  {q.options.slice(0, 3).map((opt, oIdx) => (
                                    <div key={oIdx} className="flex items-center space-x-1.5 bg-white border border-gray-200 rounded p-1 text-[8px] font-medium text-gray-600">
                                      <span className="w-3 h-3 rounded-full bg-gray-100 flex items-center justify-center font-bold text-[7px]">
                                        {String.fromCharCode(65 + oIdx)}
                                      </span>
                                      <span className="truncate">{opt.trim() === '' ? `Option Selector ${oIdx + 1}` : opt}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ))}
                            {taskItem.questions.length > 1 && (
                              <p className="text-[8px] text-center text-[#2F63FF] font-medium block">
                                + {taskItem.questions.length - 1} additional items
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {(Array.isArray(taskItem.submissionFormat) ? taskItem.submissionFormat.includes('audio') : taskItem.submissionFormat === 'audio') && (
                      <div className="border border-dashed border-gray-200 rounded-lg p-3 text-center bg-slate-50 cursor-not-allowed mb-2">
                        <span className="w-6 h-6 rounded-full bg-white border border-gray-100 flex items-center justify-center mx-auto mb-1.5 shadow-sm text-gray-400">
                          <MicIcon size={12} />
                        </span>
                        <span className="text-[9px] font-medium text-gray-500 block">Record audio validation</span>
                        <span className="text-[8px] text-gray-400 block mt-0.5">Supports live recording & verification</span>
                      </div>
                    )}


                  </div>

                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-gray-200 pt-4 mt-4 space-y-2.5">
          <div className="flex items-center justify-between text-xs font-semibold">
            <span className="text-gray-500">Must finish by:</span>
            <span className="text-gray-800 font-mono text-[11px] font-bold bg-[#E1F9F0] text-[#10B981] px-2 py-0.5 rounded">
              {dueDate}
            </span>
          </div>
          <div className="flex items-center space-x-2 text-[9px] text-[#64748B] leading-tight">
            <Users size={12} className="text-[#2F63FF] shrink-0" />
            <span>Assigned to: <b>{selectedIndividualIds.length} users</b></span>
            {associateWithSprint && selectedSprintIds.length > 0 && (
              <span className="text-gray-400">({selectedSprintIds.length} Sprints)</span>
            )}
          </div>
        </div>

      </div> */}

    </div>
  );
}

// export const CORPORATE_LEVELS_DEFAULT: CorporateLevels = {
//   orgs: ['Workfloww HQ', 'Workfloww Global'],
//   functions: ['Engineering', 'Operations', 'Product Management', 'Sales & Growth', 'Design'],
//   subFunctions: {
//     'Engineering': ['Frontend Engine', 'Backend Engine', 'System Ops'],
//     'Operations': ['Beverage Calibration', 'Inventory Management'],
//     'Product Management': ['UX Strategy', 'Feature Pipeline'],
//     'Sales & Growth': ['Corporate Outreach', 'Lead Gen'],
//     'Design': ['Visual Systems', 'Interactive Design']
//   }
// };
