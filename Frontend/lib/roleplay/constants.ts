import { Scenario } from './types';

export const SCENARIOS = [
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
    difficulty: 'Medium',
    tone: 'Neutral',
    aiPersonality: `You are a veteran ZSM who believes "visibility drives volume." You are initially skeptical of a "new joiner" questioning your budget. You are professional, assertive, and balanced, but under heavy pressure to deliver "Star Category" volume. You should push the learner by saying, "The competitor is buying space, we can't afford to be invisible." Only concede if the learner uses specific Dabur terms like Project Samriddhi, RGM, or ROI benchmarks.`,
    aiObjectives: `Test the learner's ability to use the RGM Framework to discuss margin accretion. If the learner mentions ROI, ask: "Why 5:1? Can't we settle for 3:1 just for the launch phase?" Push back on Planogram Compliance by saying it's too hard to track. Wait for the learner to mention digital audits or third-party agency (Channelplay) verification.`,
    learnerBrief: `📍 Scenario: Negotiating ROI for Modern Trade (MT) Activations

🎯 Your Role: Customer Marketing Manager (New Joiner)

📋 The Problem: The ZSM wants an additional 5% trade discount (on top of the standard launch budget) and a premium "Island Display" to hit aggressive volume targets.

💡 Your Task: Under Project Samriddhi guidelines, you must ensure every rupee spent is optimized.

✅ What You Need to Do:
• Validate the Pack Price Architecture (PPA)—does this serum's premium pricing justify the extra cost?
• Enforce the 5:1 ROI ratio (Incremental Sales must be 5x the cost)
• Propose a "Performance-based" deal where the budget is only released if the retailer hits 95% Planogram Compliance

⚠️ Success Criteria:
• Negotiate a "Performance-based" investment linked to Share of Shelf targets
• Use Project Samriddhi logic to reject the 5% extra discount while offering non-monetary marketing support (e.g., better PoSM)
• Effectively apply RGM framework and cite ROI benchmarks`,
    maxDuration: 15,
    minTurns: 6,
    endConditions: `The session ends when:
• The learner successfully negotiates a "Performance-based" investment (e.g., agreeing to the display only if Share of Shelf targets are met)
• The learner effectively uses Project Samriddhi logic to reject the 5% extra discount while offering a non-monetary marketing support alternative (e.g., better PoSM)
• The learner fails to mention ROI or RGM after 10 turns, leading to a "budget deadlock"`,
    evaluationParams: [
      {
        name: 'Communication Skills',
        description: 'Clarity in explaining trade marketing principles without being abrasive to a senior ZSM',
        weight: 25
      },
      {
        name: 'Problem Solving',
        description: 'Ability to find a middle ground (Performance-based spend) that satisfies both sales volume and marketing ROI',
        weight: 25
      },
      {
        name: 'Professionalism',
        description: 'Maintaining a "Business Partner" mindset rather than just being a "Gatekeeper" for Finance',
        weight: 25
      },
      {
        name: 'Strategic Alignment',
        description: 'Correct application of Dabur-specific frameworks. Did the learner cite Project Samriddhi? Did they calculate or mention the 5:1 ROI? Did they link spend to Planogram/VM Compliance?',
        weight: 25
      }
    ],
    passingScore: 70
  },
  
{
  title: "Dermatologist Interaction – MELAOV-PRO Cream for Hyperpigmentation",
    description: "You are a Medical Sales Representative visiting a Dermatologist to discuss MELAOV-PRO Cream, a depigmenting and skin-brightening formulation. Your goal is to present the product, explain its benefits, and address clinical questions about hyperpigmentation, melasma, and related conditions in a professional, ethical, and scientific manner.",
    userRole: "Dermatology Product Sales Executive",
    difficulty: 'Easy',
    role: "Senior Consultant Dermatologist",
    initialPrompt: "Good afternoon. I see many patients with melasma and pigmentation issues. Please explain how your product works and what makes it different.",
    tone: "Neutral",
    learnerBrief: "In this roleplay, you are a Medical Sales Representative visiting a Dermatologist to discuss MELAOV-PRO Cream, a depigmenting and skin-brightening formulation. Your objective is to professionally present the product, explain its ingredients, mechanism of action, clinical benefits, and patient suitability, and handle questions related to hyperpigmentation, melasma, dark spots, and uneven skin tone. You must communicate ethically, scientifically, and confidently, as expected in a real dermatology practice setting.",
    instructionsForLearner: [
    "Greet the doctor politely",
    "Introduce yourself and your organization",
    "Ask permission to discuss the product briefly",
    "Introduce MELAOV-PRO Cream",
    "Explain its primary indications: Dark spots, Melasma (dermal & mixed), Uneven skin tone, Hyperpigmentation",
    "Highlight key ingredients and their roles",
    "Explain how Tranexamic Acid Peptide (Tranexell-V-10) works on melanogenesis",
    "Discuss additional actives like: Alpha Arbutin, Mulberry Extract, Natural Vitamin E, L-Arginine",
    "Respond to concerns on: Safety, Long-term usage, Comparison with other depigmenting agents, Patient compliance",
    "Summarize benefits",
    "Ask for clinical feedback",
    "Thank the doctor for their time"
  ]
  }

] as unknown as Scenario[];

export const AVATAR_PLACEHOLDER_IMAGE = 'https://picsum.photos/200/200';
