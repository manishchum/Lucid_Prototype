// /**
//  * @license
//  * SPDX-License-Identifier: Apache-2.0
//  */

// export type SubmissionFormat = 'image' | 'text' | 'multiple_choice' | 'audio' | 'video';

// export interface QuizQuestion {
//   id: string;
//   question: string;
//   options: string[];
// }

// export interface TaskDraft {
//   id: string;
//   title: string;
//   description: string;
//   submissionFormat: SubmissionFormat;
//   questions: QuizQuestion[];
// }

// export type AssignmentLevel = 'sprint' | 'org' | 'function' | 'sub_function' | 'individual';

// export interface Sprint {
//   id: string;
//   title: string;
//   code: string;
//   status: 'In Progress' | 'Not Started' | 'Completed';
//   completionRate: number;
//   totalQuizzes: number;
//   completedQuizzes: number;
// }

// export interface TeamMember {
//   id: string;
//   name: string;
//   email: string;
//   avatar: string;
//   org: string;
//   function: string;
//   subFunction: string;
// }

// export interface AssignedTask {
//   id: string;
//   level: AssignmentLevel;
//   mode: 'single' | 'multiple';
//   tasks: {
//     id: string;
//     title: string;
//     description: string;
//     submissionFormat: SubmissionFormat;
//     questions: QuizQuestion[];
//   }[];
//   // Target Audience Meta
//   targetSprints: string[]; // if level === 'sprint'
//   targetOrgs: string[];
//   targetFunctions: string[];
//   targetSubFunctions: string[];
//   targetIndividuals: string[]; // individual member IDs
//   dueDate: string;
//   createdAt: string;
//   status: 'Active' | 'Draft' | 'Completed';
//   completionCount: number;
//   totalTargetUsersCount: number;
//   recurrence?: 'none' | 'every_2_days' | 'weekly' | 'monthly';
// }

// export type WizardStep = 'level' | 'details' | 'audience' | 'schedule';
