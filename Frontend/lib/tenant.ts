/**
 * Multi-tenant helper to detect whether the current request/session
 * belongs to the EY corporate tenant (ey.workfloww.ai) or the primary
 * Lucid tenant (lucid.workfloww.ai).
 */

export function isEYTenant(
  hostname?: string | null,
  searchParams?: URLSearchParams | null
): boolean {
  // 1. Explicit environment variable check (if configured in Vercel for the ey.workfloww.ai deployment)
  const envTenant = (process.env.NEXT_PUBLIC_TENANT || process.env.NEXT_PUBLIC_BRAND || "").toLowerCase()
  if (envTenant === "ey") {
    return true
  }

  // 2. Query param override (?tenant=ey or ?brand=ey) - allows testing / deep linking on any domain
  if (searchParams) {
    const param = (searchParams.get("tenant") || searchParams.get("brand") || "").toLowerCase()
    if (param === "ey") return true
    if (param === "lucid") return false
  }

  // 3. Hostname check (handles ey.workfloww.ai, ey.localhost, ey-*.vercel.app, etc.)
  const host = (
    hostname ||
    (typeof window !== "undefined" ? window.location.hostname : "")
  ).toLowerCase()

  if (
    host.includes("ey.workfloww.ai") ||
    host.startsWith("ey.") ||
    host.startsWith("ey-")
  ) {
    return true
  }

  return false
}
