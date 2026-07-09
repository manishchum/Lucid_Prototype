export type Language = {
  code: string;
  name: string;
};

export const ALL_LANGUAGES: Language[] = [
  { code: 'en', name: 'English' },
  { code: 'hi', name: 'Hindi' },
  { code: 'de', name: 'German' },
  { code: 'ru', name: 'Russian' },
  { code: 'fr', name: 'French' },
  { code: 'it', name: 'Italian' },
  { code: 'es', name: 'Spanish' },
  { code: 'pl', name: 'Polish' },
  { code: 'uk', name: 'Ukrainian' },
  { code: 'ro', name: 'Romanian' },
  { code: 'nl', name: 'Dutch' },
  { code: 'bn', name: 'Bengali' },
  { code: 'ta', name: 'Tamil' },
  { code: 'te', name: 'Telugu' },
  { code: 'mr', name: 'Marathi' },
  { code: 'kn', name: 'Kannada' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'gu', name: 'Gujarati' },
  { code: 'ur', name: 'Urdu' },
  { code: 'or', name: 'Odia' },
];

const NAME_TO_CODE: Record<string, string> = {
  english: 'en',
  hindi: 'hi',
  german: 'de',
  russian: 'ru',
  french: 'fr',
  italian: 'it',
  spanish: 'es',
  polish: 'pl',
  ukrainian: 'uk',
  ukraine: 'uk',
  romanian: 'ro',
  dutch: 'nl',
  bengali: 'bn',
  tamil: 'ta',
  telugu: 'te',
  marathi: 'mr',
  kannada: 'kn',
  punjabi: 'pa',
  gujarati: 'gu',
  urdu: 'ur',
  odia: 'or',
};

export function getCompanyEnabledLanguages(activeCompany: any): Language[] {
  if (!activeCompany) return ALL_LANGUAGES;

  // Priority: check explicit language properties first
  let candidates =
    activeCompany.enabled_languages ||
    activeCompany.translation_languages ||
    activeCompany.enabledLanguages ||
    activeCompany.enabledLanguageCodes ||
    activeCompany.languages ||
    [];

  // If no explicit language field, extract from subscription_addons
  if (!Array.isArray(candidates) || candidates.length === 0) {
    candidates = Array.isArray(activeCompany.subscription_addons)
      ? activeCompany.subscription_addons
      : [];
  }

  if (!Array.isArray(candidates) || candidates.length === 0) return ALL_LANGUAGES;

  const validLangCodes = new Set(ALL_LANGUAGES.map((l) => l.code));
  const normalized = new Set<string>();
  
  for (const raw of candidates) {
    if (!raw) continue;
    const s = String(raw).trim().toLowerCase();
    
    // Check if it's a valid language code
    if (validLangCodes.has(s)) {
      normalized.add(s);
      continue;
    }
    
    // Check if it's a language name
    if (NAME_TO_CODE[s]) {
      normalized.add(NAME_TO_CODE[s]);
      continue;
    }
    
    // Skip addon keys and other non-language values
  }

  const filtered = ALL_LANGUAGES.filter((l) => normalized.has(l.code));
  return filtered.length > 0 ? filtered : ALL_LANGUAGES;
}

export function groupLanguages(langs: Language[]) {
  const INDIAN_CODES = new Set(['hi', 'bn', 'ta', 'te', 'mr', 'kn', 'pa', 'gu', 'ur', 'or']);
  const indian: Language[] = [];
  const international: Language[] = [];

  for (const l of langs) {
    if (INDIAN_CODES.has(l.code)) indian.push(l);
    else international.push(l);
  }

  return { indian, international };
}
