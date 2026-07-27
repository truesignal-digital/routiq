import type { FinancialEntryListItem } from "@routiq/contracts"
import { CircleCheck, CircleX, LoaderCircle, Undo2, type LucideIcon } from "lucide-react"
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

/**
 * Spelled out per status rather than left to the tone defaults: a reversed
 * entry is neutral in colour but needs its own glyph, and the other three
 * should not drift if a tone's default is ever retuned.
 */
const STATUS_ICONS: Record<FinanceEntryStatus, LucideIcon> = {
  SUBMITTED: LoaderCircle,
  POSTED: CircleCheck,
  REJECTED: CircleX,
  REVERSED: Undo2,
}

export function FinanceStatusBadge({
  status,
  children,
}: {
  status: FinanceEntryStatus
  children: ReactNode
}) {
  return (
    <StatusBadge
      tone={STATUS_TONES[status]}
      icon={STATUS_ICONS[status]}
      className="uppercase"
    >
      {children}
    </StatusBadge>
  )
}
