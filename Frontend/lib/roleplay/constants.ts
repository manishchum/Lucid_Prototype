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
  },
  {
    id: '6',
    title: 'Negotiating ROI for Modern Trade (MT) Activations',
    description: 'You are reviewing a high-stakes request from the Zonal Sales Manager (ZSM) for the launch of the new Vatika Hair Serum in a major Modern Trade account. The ZSM wants an additional 5% trade discount (on top of the standard launch budget) and a premium "Island Display" to hit aggressive volume targets. Under Project Samriddhi guidelines, you must ensure every rupee spent is optimized using Dabur\'s Revenue Growth Management (RGM) framework.',
    initialPrompt: `Hi, I hope you've seen my email for the Vatika Serum launch. Look, we need that extra 5% discount and the Island Display at the store entrance to stand a chance against the rivals. Can we get your sign-off today?`,
    role: 'Zonal Sales Manager (ZSM) – Modern Trade',
    userRole: 'Customer Marketing Manager (New Joiner)',
    difficulty: 'Easy',
  },
  {
    id: '7',
    title: 'The First Meet at a Coffee Shop',
    description: 'Navigate a first date scenario at a busy urban café. Maya is smart, slightly guarded, and loves travel but hates cliché small talk. She\'s distracted because she\'s waiting for a work call, adding complexity to the interaction. Build rapport while demonstrating confidence, active listening, and appropriate humor. Handle curveballs including phone distractions, direct questions about intentions, and the awkward "who pays" moment.',
    initialPrompt: `Hey! Glad you could make it. Sorry if I seem a bit scattered—I've had a chaotic morning. Anyway, I'm glad we're finally meeting in person. You look... a little different than your profile photos. Is that a good thing or a bad thing? You tell me.`,
    role: 'Maya – Smart, Slightly Guarded Date',
    userRole: 'First Date Participant',
    difficulty: 'Medium',
    tone: 'Friendly and flirty',
    learnerBrief: `📍 Setting: A busy, slightly noisy urban café

🎯 Your Goal: Build genuine connection while demonstrating social intelligence

💡 Evaluation Focus:
• Confidence vs. Arrogance: Handle teasing without getting defensive
• Active Listening: Pick up on cues (like her "chaotic morning") and show genuine interest
• Vibe Check: Use appropriate humor and "push-pull" techniques to keep conversation engaging

⚠️ Expect Curveballs:
• Phone distraction mid-conversation - re-engage without being needy
• Direct question: "What are you actually looking for? Because I'm not into games."
• The bill moment - handle payment awkwardness gracefully

💪 Success Looks Like: Balanced confidence, genuine curiosity about her, playful teasing, and smooth handling of awkward moments.`
  }
];

export const AVATAR_PLACEHOLDER_IMAGE = 'https://picsum.photos/200/200';
