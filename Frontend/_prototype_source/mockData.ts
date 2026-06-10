// /**
//  * @license
//  * SPDX-License-Identifier: Apache-2.0
//  */

// import { Sprint, TeamMember, AssignedTask } from './types';

// export const INITIAL_SPRINTS: Sprint[] = [
//   {
//     id: 'sprint-1',
//     title: 'Brewing Tools Fundamentals',
//     code: 'BREW_101',
//     status: 'In Progress',
//     completionRate: 20,
//     totalQuizzes: 10,
//     completedQuizzes: 2
//   },
//   {
//     id: 'sprint-2',
//     title: 'Detailing_Orientation_Sprint',
//     code: 'DETAIL_ORIENT',
//     status: 'Not Started',
//     completionRate: 0,
//     totalQuizzes: 8,
//     completedQuizzes: 0
//   },
//   {
//     id: 'sprint-3',
//     title: 'Grayscale image colourization',
//     code: 'GRAY_COLORIZE',
//     status: 'Completed',
//     completionRate: 100,
//     totalQuizzes: 7,
//     completedQuizzes: 7
//   },
//   {
//     id: 'sprint-4',
//     title: 'Core System Diagnostics Hub',
//     code: 'DIAG_CORE',
//     status: 'In Progress',
//     completionRate: 65,
//     totalQuizzes: 12,
//     completedQuizzes: 8
//   }
// ];

// export const TEAM_MEMBERS: TeamMember[] = [
//   {
//     id: 'm-1',
//     name: 'Amit Patel',
//     email: 'amit.patel@workfloww.ai',
//     avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80',
//     org: 'Workfloww HQ',
//     function: 'Engineering',
//     subFunction: 'Frontend Engine'
//   },
//   {
//     id: 'm-2',
//     name: 'David Kim',
//     email: 'david.kim@workfloww.ai',
//     avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&q=80',
//     org: 'Workfloww HQ',
//     function: 'Engineering',
//     subFunction: 'Backend Engine'
//   },
//   {
//     id: 'm-3',
//     name: 'Sarah Connor',
//     email: 'sarah.c@workfloww.ai',
//     avatar: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&q=80',
//     org: 'Workfloww Global',
//     function: 'Operations',
//     subFunction: 'Beverage Calibration'
//   },
//   {
//     id: 'm-4',
//     name: 'Priya Nair',
//     email: 'priya.nair@workfloww.ai',
//     avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=150&q=80',
//     org: 'Workfloww HQ',
//     function: 'Product Management',
//     subFunction: 'UX Strategy'
//   },
//   {
//     id: 'm-5',
//     name: 'Michael Scott',
//     email: 'michael.g@workfloww.ai',
//     avatar: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=150&q=80',
//     org: 'Workfloww Global',
//     function: 'Sales & Growth',
//     subFunction: 'Corporate Outreach'
//   },
//   {
//     id: 'm-6',
//     name: 'Jessica Zhao',
//     email: 'jessica.zhao@workfloww.ai',
//     avatar: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=150&q=80',
//     org: 'Workfloww HQ',
//     function: 'Design',
//     subFunction: 'Visual Systems'
//   }
// ];

// export const CORPORATE_LEVELS = {
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

// export const INITIAL_ASSIGNED_TASKS: AssignedTask[] = [
//   {
//     id: 'task-assigned-1',
//     level: 'sprint',
//     mode: 'single',
//     tasks: [
//       {
//         id: 'child-1-1',
//         title: 'Safety Equipment Visual Checklist',
//         description: 'Take a clear photograph of your workplace safety goggles, sanitizing solution, and clean storage box before starting your brewing shift.',
//         submissionFormat: 'image',
//         questions: []
//       }
//     ],
//     targetSprints: ['Brewing Tools Fundamentals'],
//     targetOrgs: [],
//     targetFunctions: [],
//     targetSubFunctions: [],
//     targetIndividuals: [],
//     dueDate: '2026-06-05',
//     createdAt: '2026-05-28',
//     status: 'Active',
//     completionCount: 3,
//     totalTargetUsersCount: 15,
//     recurrence: 'weekly'
//   },
//   {
//     id: 'task-assigned-2',
//     level: 'individual',
//     mode: 'multiple',
//     tasks: [
//       {
//         id: 'child-2-1',
//         title: 'Evaluate Design System Gaps',
//         description: 'Provide an evaluation on alignment of modern bento grid structures across our KPI console dashboards.',
//         submissionFormat: 'text',
//         questions: []
//       },
//       {
//         id: 'child-2-2',
//         title: 'Bento Contrast Standard Quiz',
//         description: 'Select the optimal core color settings representing the highest accessible display fidelity.',
//         submissionFormat: 'multiple_choice',
//         questions: [
//           {
//             id: 'q1',
//             question: 'What is the minimum recommended AA contrast ratio for high-emphasis text inputs?',
//             options: ['3.0:1', '4.5:1', '7.0:1', '1.5:1']
//           }
//         ]
//       }
//     ],
//     targetSprints: [],
//     targetOrgs: ['Workfloww HQ'],
//     targetFunctions: ['Design'],
//     targetSubFunctions: ['Visual Systems'],
//     targetIndividuals: ['Jessica Zhao'],
//     dueDate: '2026-06-01',
//     createdAt: '2026-05-28',
//     status: 'Active',
//     completionCount: 0,
//     totalTargetUsersCount: 1,
//     recurrence: 'every_2_days'
//   }
// ];
