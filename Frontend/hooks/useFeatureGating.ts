import { useTenant } from '@/contexts/tenant-context';

export type Tier = 'tier_1' | 'tier_2' | 'tier_3';
export type Addon =
  | 'lucid_studio'
  | 'lucid_studio_textual'
  | 'lucid_studio_podcast'
  | 'lucid_studio_video'
  | 'lucid_studio_mindmap'
  | 'lucid_studio_infographic'
  | 'chat_in_studio'
  | 'lucid_studio_flashcard'
  | 'lucid_studio_flashcards'
  | 'task_management'
  | 'kpi'
  | 'reports'
  | 'sprintverse'
  | 'role_play';

interface FeatureConfig {
  requiredTier?: Tier;
  requiredAddons?: Addon[];
  requiresAnyAddon?: boolean; // If true, requires at least one of the addons
}

/**
 * Hook to check if a feature is available based on current subscription
 * 
 * Tier Breakdown:
 * Tier 1: Lucid Studio, Expert in the Loop
 * Tier 2: Tier 1 + Chat option in Lucid Studio
 * Tier 3: Tier 2 + Task Management
 * 
 * Add-ons (optional for any tier):
 * - lucid_studio: Lucid Studio
 * - chat_in_studio: Lucid Studio chat
 * - task_management: Task Management
 * - kpi: KPI Intelligence & Management
 * - role_play: Role Play scenarios
 */
export function useFeatureGating() {
  const { activeCompany } = useTenant();

  const normalizeAddonKey = (value: string): Addon => {
    const normalized = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');

    if (normalized === 'lucid_studio_flashcard' || normalized === 'lucid_studio_flashcards') {
      return 'lucid_studio_flashcards';
    }

    return normalized as Addon;
  };

  const deriveFrontendTier = (addons: Addon[]): Tier | null => {
    const current = new Set(addons);
    if (current.has('task_management')) return 'tier_3';
    if (current.has('chat_in_studio')) return 'tier_2';
    if (
      current.has('lucid_studio') ||
      current.has('lucid_studio_textual') ||
      current.has('lucid_studio_podcast') ||
      current.has('lucid_studio_video') ||
      current.has('lucid_studio_mindmap') ||
      current.has('lucid_studio_infographic') ||
      current.has('lucid_studio_flashcard') ||
      current.has('lucid_studio_flashcards')
    ) return 'tier_1';
    return null;
  };

  const getAvailableTier = (): Tier | null => {
    const addons = getAvailableAddons();
    return deriveFrontendTier(addons);
  };

  const getAvailableAddons = (): Addon[] => {
    const addons = activeCompany?.subscription_addons || [];
    const allowedAddons = new Set<Addon>([
      'lucid_studio',
      'lucid_studio_textual',
      'lucid_studio_podcast',
      'lucid_studio_video',
      'lucid_studio_mindmap',
      'lucid_studio_infographic',
      'lucid_studio_flashcard',
      'lucid_studio_flashcards',
      'chat_in_studio',
      'task_management',
      'kpi',
      'role_play',
      'sprintverse',
      'reports',
    ]);

    const normalizedAddons = addons
      .map((addon) => normalizeAddonKey(String(addon)))
      .filter((addon): addon is Addon => allowedAddons.has(addon));

    const effectiveAddons = new Set<Addon>(normalizedAddons);
    const hasLucidChild = ([
      'lucid_studio_textual',
      'lucid_studio_podcast',
      'lucid_studio_video',
      'lucid_studio_mindmap',
      'lucid_studio_infographic',
      'lucid_studio_flashcard',
      'lucid_studio_flashcards',
    ] as Addon[]).some((addon) => effectiveAddons.has(addon));

    if (hasLucidChild) {
      effectiveAddons.add('lucid_studio');
    }

    return Array.from(effectiveAddons);
  };

  /**
   * Check if feature is available
   * If requiredTier is specified, checks if current tier is >= specified tier
   * If requiredAddons is specified, checks if all addons are available
   */
  const isFeatureAvailable = (config: FeatureConfig): boolean => {
    const currentTier = getAvailableTier();
    const currentAddons = getAvailableAddons();

    // Check tier requirement
    if (config.requiredTier) {
      if (!currentTier) {
        return false;
      }
      const tierOrder: Tier[] = ['tier_1', 'tier_2', 'tier_3'];
      const currentTierIndex = tierOrder.indexOf(currentTier);
      const requiredTierIndex = tierOrder.indexOf(config.requiredTier);

      if (currentTierIndex < requiredTierIndex) {
        return false;
      }
    }

    // Check addon requirements
    if (config.requiredAddons && config.requiredAddons.length > 0) {
      if (config.requiresAnyAddon) {
        // Requires at least one of the specified addons
        return config.requiredAddons.some(addon => currentAddons.includes(addon));
      } else {
        // Requires all specified addons
        return config.requiredAddons.every(addon => currentAddons.includes(addon));
      }
    }

    return true;
  };

  /**
   * Check specific features by name
   */
  const hasFeature = (featureName: string): boolean => {
    const features: Record<string, FeatureConfig> = {
      'lucidStudio': { requiredAddons: ['lucid_studio'] },
      'lucidStudioTextual': { requiredAddons: ['lucid_studio_textual'] },
      'lucidStudioPodcast': { requiredAddons: ['lucid_studio_podcast'] },
      'lucidStudioVideo': { requiredAddons: ['lucid_studio_video'] },
      'lucidStudioMindmap': { requiredAddons: ['lucid_studio_mindmap'] },
      'lucidStudioInfographic': { requiredAddons: ['lucid_studio_infographic'] },
      'lucidStudioFlashcards': {
        requiredAddons: ['lucid_studio_flashcard', 'lucid_studio_flashcards'],
        requiresAnyAddon: true,
      },
      'chatInStudio': { requiredAddons: ['chat_in_studio'] },
      'taskManagement': { requiredAddons: ['task_management'] },
      'kpi': { requiredAddons: ['kpi'] },
      'rolePlay': { requiredAddons: ['role_play'] },
      'reports': { requireAddons: ['reports']},
      'sprintverse' : {requireAddons: ['sprintverse']},
    };

    const config = features[featureName];
    if (!config) {
      console.warn(`Unknown feature: ${featureName}`);
      return false;
    }

    return isFeatureAvailable(config);
  };

  return {
    getAvailableTier,
    getAvailableAddons,
    isFeatureAvailable,
    hasFeature,
  };
}
