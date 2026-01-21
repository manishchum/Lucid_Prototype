
import { Scenario } from './types';

export const SCENARIOS: Scenario[] = [
  {
    id: '1',
    title: 'Customer Complaint Resolution',
    description: 'Practice handling an unhappy customer who received a damaged product and wants a full refund, but policy states exchange only.',
    initialPrompt: `Hello, I'm quite upset. I just received my order, and the product is clearly damaged! I want a full refund immediately.`,
    role: 'Unhappy Customer',
    difficulty: 'Medium',
  },
  {
    id: '2',
    title: 'Stakeholder Budget Negotiation',
    description: 'Simulate a negotiation with a key stakeholder who wants to cut the budget for your new project by 20%, but you believe it will impact quality.',
    initialPrompt: `Thanks for meeting. Regarding your project, we need to reduce the budget by 20%. How can we make that work without losing critical functionality?`,
    role: 'Finance Director',
    difficulty: 'Hard',
  },
  {
    id: '3',
    title: 'Sales Pitch for New Software',
    description: 'You are selling a new AI-powered project management software. Your client is skeptical about its necessity and integration challenges.',
    initialPrompt: `Tell me more about this new software. My team is already comfortable with our current tools, and I'm not convinced we need another subscription.`,
    role: 'Potential Client',
    difficulty: 'Easy',
  },
  {
    id: '4',
    title: 'Employee Performance Review',
    description: 'Conduct a performance review with an employee who has been underperforming but is sensitive to criticism.',
    initialPrompt: `Thanks for scheduling this review. I'm ready to hear your feedback.`,
    role: 'Underperforming Employee',
    difficulty: 'Medium',
  },
];

export const AVATAR_PLACEHOLDER_IMAGE = 'https://picsum.photos/200/200';
