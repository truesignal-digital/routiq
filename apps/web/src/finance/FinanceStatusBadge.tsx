import type { FinancialEntryListItem } from "@routiq/contracts";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";

type FinanceEntryStatus = FinancialEntryListItem["status"];
type FinanceStatusBadgeVariant =
  | "default"
  | "secondary"
  | "destructive"
  | "outline";

const STATUS_VARIANTS: Record<FinanceEntryStatus, FinanceStatusBadgeVariant> = {
  SUBMITTED: "secondary",
  POSTED: "default",
  REJECTED: "destructive",
  REVERSED: "outline",
};

export function FinanceStatusBadge({
  status,
  children,
}: {
  status: FinanceEntryStatus;
  children: ReactNode;
}) {
  return (
    <Badge variant={STATUS_VARIANTS[status]} className="uppercase">
      {children}
    </Badge>
  );
}
