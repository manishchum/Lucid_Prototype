"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

export default function AdminDashboardPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace("/admin/dashboard/analytics")
  }, [router])

  return null
}
