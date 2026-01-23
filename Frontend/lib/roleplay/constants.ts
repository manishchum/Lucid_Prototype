import { Scenario } from './types';

export const SCENARIOS: Scenario[] = [
  {
    id: '1',
    title: 'Credit Life Awareness – Family Risk',
    description: 'Customer has taken a long tenure home loan and does not understand how credit life insurance protects the family from outstanding liability.',
    initialPrompt: `I have taken a 20-year loan, but I don't see how this insurance really helps me today.`,
    role: 'Home Loan Customer – Limited Awareness',
    userRole: 'Sales Manager / Relationship Manager',
    difficulty: 'Medium',
  },
  {
    id: '2',
    title: 'Property Insurance Objection',
    description: 'Customer feels property insurance is unnecessary because the building is new and located in a safe area.',
    initialPrompt: `The building is brand new and in a good location, why should I pay extra for property insurance?`,
    role: 'Cost-Conscious Property Buyer',
    userRole: 'Sales Manager / Relationship Manager',
    difficulty: 'Medium',
  },
  {
    id: '3',
    title: 'CMS Income Mismatch Case',
    description: 'Self-employed applicant declares high monthly income but bank statements show very low average balance, creating a potential red flag.',
    initialPrompt: `My business income is around 1.2 lakh per month, but I don't keep much money in the bank.`,
    role: 'Self-Employed Applicant with Documentation Gaps',
    userRole: 'Credit Manager / Underwriter',
    difficulty: 'Hard',
  },
  {
    id: '4',
    title: 'High FOIR Affordability Discussion',
    description: 'Customer already has significant existing EMIs and still insists on a large additional loan beyond affordability norms.',
    initialPrompt: `I'm already paying some EMIs, but I still want the full loan amount you showed earlier.`,
    role: 'Over-Committed Borrower',
    userRole: 'Loan Officer / Financial Advisor',
    difficulty: 'Hard'  ,
  },
  {
    id: '5',
    title: 'Title & Legal Concern in CMS',
    description: 'During CMS discussion, property documents show incomplete title chain and the customer wants to proceed quickly without legal checks.',
    initialPrompt: `The seller said papers are fine. Do we really need all this legal verification?`,
    role: 'Impatient Property Buyer',
    userRole: 'Legal Advisor / Credit Manager',
    difficulty: 'Medium',
}
];

export const AVATAR_PLACEHOLDER_IMAGE = 'https://picsum.photos/200/200';
