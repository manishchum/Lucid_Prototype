import { useTenant } from '@/contexts/tenant-context';

export type Tier = 'tier_1' | 'tier_2' | 'tier_3';
export type Addon =
  | 'lucid_studio'
  | 'chat_in_studio'
  | 'task_management'
  | 'kpi'
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

  const normalizeAddonKey = (value: string): Addon => value.trim().toLowerCase().replace(/[-\s]+/g, '_') as Addon;

  const deriveFrontendTier = (addons: Addon[]): Tier | null => {
    const current = new Set(addons);
    if (current.has('task_management')) return 'tier_3';
    if (current.has('chat_in_studio')) return 'tier_2';
    if (current.has('lucid_studio')) return 'tier_1';
    return null;
  };

  const getAvailableTier = (): Tier | null => {
    const addons = getAvailableAddons();
    return deriveFrontendTier(addons);
  };

  const getAvailableAddons = (): Addon[] => {
    const addons = activeCompany?.subscription_addons || [];
    const normalizedAddons = addons.filter((addon): addon is Addon =>
        [
          'lucid_studio',
          'chat_in_studio',
          'task_management',
          'kpi',
          'role_play',
      ].includes(String(addon).trim().toLowerCase().replace(/[-\s]+/g, '_'))
    ).map((addon) => normalizeAddonKey(String(addon)));

    return Array.from(new Set(normalizedAddons));
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
      'chatInStudio': { requiredAddons: ['chat_in_studio'] },
      'taskManagement': { requiredAddons: ['task_management'] },
      'kpi': { requiredAddons: ['kpi'] },
      'rolePlay': { requiredAddons: ['role_play'] },
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
