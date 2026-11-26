import { headers } from "next/headers"
import { Suspense } from "react"
import LandingContent from "@/components/landing/LandingContent"
import { isEYTenant } from "@/lib/tenant"
import { LoadingProgress } from "@/components/LoadingProgress"

export default async function RootPage({
  searchParams,
}: {
  searchParams?: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const headerList = await headers()
  const host = headerList.get("host") || ""
  const resolvedParams = searchParams ? await searchParams : {}
  const tenantParam = typeof resolvedParams.tenant === "string" ? resolvedParams.tenant : null

  const isEY = 
    isEYTenant(host, null) || 
    tenantParam === "ey" ||
    (typeof resolvedParams.brand === "string" && resolvedParams.brand === "ey")

  return (
    <Suspense fallback={<LoadingProgress label="Loading dashboard" />}>
      <LandingContent initialIsEY={isEY} />
    </Suspense>
  )
}
