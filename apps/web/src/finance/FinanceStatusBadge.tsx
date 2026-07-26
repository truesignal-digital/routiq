import type { FinancialEntryListItem } from "@routiq/contracts"
import type { ReactNode } from "react"

import { StatusBadge } from "@/components/status-badge.js"

type FinanceEntryStatus = FinancialEntryListItem["status"]
type StatusBadgeTone = "neutral" | "success" | "warning" | "info" | "danger"

const STATUS_TONES: Record<FinanceEntryStatus, StatusBadgeTone> = {
  SUBMITTED: "info",
  POSTED: "success",
  REJECTED: "danger",
  REVERSED: "neutral",
}

export function FinanceStatusBadge({
  status,
  children,
}: {
  status: FinanceEntryStatus
  children: ReactNode
}) {
  return (
    <StatusBadge tone={STATUS_TONES[status]} className="uppercase">
      {children}
    </StatusBadge>
  )
}
