import type { ReactNode } from "react";
import { FinanceNav } from "./FinanceNav.js";

/**
 * The dashboard-01 toolbar row: section tabs on the left, view and action
 * controls on the right. Filters stay on their own row below — the block has
 * none, and ours are too wide to share this line.
 */
export function FinanceToolbar({ children }: { children?: ReactNode }) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <FinanceNav className="mt-0" />
      {children !== undefined && (
        <div className="ml-auto flex items-center gap-2">{children}</div>
      )}
    </div>
  );
}
