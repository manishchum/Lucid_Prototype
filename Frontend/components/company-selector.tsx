"use client"

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useTenant } from "@/contexts/tenant-context"

type CompanySelectorProps = {
  className?: string
  compact?: boolean
  showLabel?: boolean
}

export default function CompanySelector({
  className,
  compact = false,
  showLabel = true,
}: CompanySelectorProps) {
  const {
    activeCompanyId,
    availableCompanies,
    loadingCompanies,
    isDeveloperMode,
    setActiveCompanyId,
  } = useTenant()

  if (!isDeveloperMode) return null

  return (
    <div className={className}>
      {showLabel && (
        <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-1.5">
          Viewing Company
        </p>
      )}

      <Select
        value={activeCompanyId || undefined}
        onValueChange={(value) => setActiveCompanyId(value)}
        disabled={loadingCompanies || availableCompanies.length === 0}
      >
        <SelectTrigger
          className={compact ? "h-9 text-sm bg-white" : "h-10 text-sm bg-white"}
          aria-label="Select company"
        >
          <SelectValue
            placeholder={loadingCompanies ? "Loading companies..." : "Select company"}
          />
        </SelectTrigger>
        <SelectContent>
          {availableCompanies.map((company) => (
            <SelectItem key={company.company_id} value={company.company_id}>
              {company.name || company.company_id}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
