'use client'

import React from "react"
import { useTenant, FEATURES, type FeatureName, type Tier, type Addon } from "@/contexts/tenant-context"

interface FeatureGateProps {
  feature?: FeatureName | string
  requiredTier?: Tier
  requiredAddons?: Addon[]
  requiresAnyAddon?: boolean
  children: React.ReactNode
  fallback?: React.ReactNode
  showMessage?: boolean
}

/**
 * FeatureGate Component
 * 
 * Conditionally renders content based on subscription tier and add-ons
 * 
 * @example
 * // Using feature constant
 * <FeatureGate feature={FEATURES.TASK_MANAGEMENT}>
 *   <TaskManager />
 * </FeatureGate>
 * 
 * @example
 * // Using custom config
 * <FeatureGate requiredTier="tier_2">
 *   <ChatFeature />
 * </FeatureGate>
 * 
 * @example
 * // Using add-ons
 * <FeatureGate requiredAddons={["kpi"]}>
 *   <KPIDashboard />
 * </FeatureGate>
 */
export function FeatureGate({
  feature,
  requiredTier,
  requiredAddons,
  requiresAnyAddon = false,
  children,
  fallback = null,
  showMessage = false,
}: FeatureGateProps) {
  const { hasFeature, isFeatureAvailable } = useTenant()

  const isAvailable = feature
    ? hasFeature(feature)
    : isFeatureAvailable({ requiredTier, requiredAddons, requiresAnyAddon })

  if (!isAvailable) {
    if (showMessage) {
      return (
        <div className="flex items-center justify-center p-6 rounded-lg border border-yellow-200 bg-yellow-50">
          <div className="text-center">
            <p className="text-sm font-medium text-yellow-800">
              This feature is not included in your current plan.
            </p>
            <p className="text-xs text-yellow-700 mt-1">
              Please contact your administrator to upgrade.
            </p>
          </div>
        </div>
      )
    }
    return fallback
  }

  return <>{children}</>
}

/**
 * Hook version for more granular control
 */
export function useFeature(feature: FeatureName | string) {
  const { hasFeature } = useTenant()
  return hasFeature(feature)
}

/**
 * Hook version with custom config
 */
export function useFeatureCheck(requiredTier?: Tier, requiredAddons?: Addon[], requiresAnyAddon?: boolean) {
  const { isFeatureAvailable } = useTenant()
  return isFeatureAvailable({ requiredTier, requiredAddons, requiresAnyAddon })
}
