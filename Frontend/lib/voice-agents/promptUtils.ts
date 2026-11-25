import { StructuredPromptSections } from '@/types/voice-agents';

export const SECTION_METADATA = [
  {
    key: 'agentIdentity' as const,
    title: '1. Agent Identity',
    description: 'Name, persona, who the agent represents, and basic persona traits.',
  },
  {
    key: 'roleAndObjective' as const,
    title: '2. Role and Objective',
    description: 'The core mission, goals, and what the agent must achieve in the call.',
  },
  {
    key: 'personalityAndTone' as const,
    title: '3. Personality and Tone',
    description: 'Tone of voice (e.g., empathetic, assertive, professional, coaching).',
  },
  {
    key: 'conversationFlow' as const,
    title: '4. Conversation Flow',
    description: 'Phase-by-phase dialogue structure from greeting to core inquiry.',
  },
  {
    key: 'contextAndBackground' as const,
    title: '5. Context and Background',
    description: 'Domain specifics, company context, user details, and scenario setup.',
  },
  {
    key: 'behaviouralRules' as const,
    title: '6. Behavioural Rules',
    description: 'Constraints, compliance guidelines, what never to say, and guardrails.',
  },
  {
    key: 'objectionHandling' as const,
    title: '7. Objection Handling',
    description: 'How to handle pushback, evasive answers, skepticism, or silence.',
  },
  {
    key: 'fallbackBehaviour' as const,
    title: '8. Fallback Behaviour',
    description: 'Recovery strategies when speech is unclear, off-topic, or interrupted.',
  },
  {
    key: 'conversationEnding' as const,
    title: '9. Conversation Ending',
    description: 'Wrap-up triggers, closing remarks, and next steps handover.',
  },
];

export function compileStructuredToRaw(sections: StructuredPromptSections): string {
  const parts: string[] = [];

  SECTION_METADATA.forEach((meta) => {
    const content = sections[meta.key];
    if (content && content.trim().length > 0) {
      parts.push(`=== ${meta.title.toUpperCase()} ===\n${content.trim()}`);
    }
  });

  return parts.join('\n\n');
}

export function parseRawToStructured(raw: string, existing: StructuredPromptSections): StructuredPromptSections {
  const result: StructuredPromptSections = { ...existing };
  
  // Try to parse headers like === 1. AGENT IDENTITY === or [1. Agent Identity]
  const regex = /===\s*(?:\d+\.\s*)?([A-Za-z\s]+)\s*===\n([\s\S]*?)(?=(?:===\s*(?:\d+\.\s*)?[A-Za-z\s]+\s*===)|$)/g;
  let match;
  let foundAny = false;

  while ((match = regex.exec(raw)) !== null) {
    foundAny = true;
    const header = match[1].trim().toLowerCase();
    const content = match[2].trim();

    if (header.includes('identity')) result.agentIdentity = content;
    else if (header.includes('role') || header.includes('objective')) result.roleAndObjective = content;
    else if (header.includes('personality') || header.includes('tone')) result.personalityAndTone = content;
    else if (header.includes('flow')) result.conversationFlow = content;
    else if (header.includes('context') || header.includes('background')) result.contextAndBackground = content;
    else if (header.includes('behaviour') || header.includes('behavior') || header.includes('rule')) result.behaviouralRules = content;
    else if (header.includes('objection')) result.objectionHandling = content;
    else if (header.includes('fallback')) result.fallbackBehaviour = content;
    else if (header.includes('ending') || header.includes('closing')) result.conversationEnding = content;
  }

  // If no delimiter headers found, place raw prompt into roleAndObjective
  if (!foundAny && raw.trim()) {
    result.roleAndObjective = raw.trim();
  }

  return result;
}

export function extractPlaceholders(text: string): string[] {
  const matches = text.match(/\{\{([a-zA-Z0-9_]+)\}\}/g);
  if (!matches) return [];
  const unique = Array.from(new Set(matches.map((m) => m.replace(/[{}]/g, ''))));
  return unique;
}

export const STANDARD_VARIABLES = [
  { name: 'user_name', desc: 'Full name of the person taking the call or assessment' },
  { name: 'company_name', desc: 'Current assigned company or client brand' },
  { name: 'agent_name', desc: 'Voice persona name displayed to caller' },
  { name: 'assessment_id', desc: 'Unique session identifier for auditing' },
  { name: 'passing_score', desc: 'Minimum score threshold percentage (e.g. 70)' },
  { name: 'target_skill', desc: 'Primary core competency being evaluated' },
  { name: 'call_scenario', desc: 'Contextual simulation scenario description' },
];
