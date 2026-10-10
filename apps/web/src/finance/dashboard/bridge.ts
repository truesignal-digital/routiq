import type { FinanceOverviewResponse } from "@routiq/contracts";

/**
 * One bar of "What changed the profit" (dashboards.html, ProfitBridge). The
 * first and last are the two windows' profits; every bar between is what one
 * change did to profit: revenue up raises it, an expense up lowers it.
 */
export type BridgeStep =
  | { key: "start" | "end"; kind: "total"; value: number; from: 0; to: number }
  | {
      key: string;
      kind: "change";
      /** What moved: revenue, one expense category, the folded rest, or company costs. */
      what: "revenue" | "category" | "otherCategories" | "noCategory" | "companyCosts";
      /** The category's code and labels when `what` is "category"; the folded count for "otherCategories". */
      category?: { code: string; labelFr: string; labelEn: string };
      foldedCount?: number;
      /** Signed effect on profit, in minor units. */
      value: number;
      from: number;
      to: number;
    };

/** Expense categories shown as their own bar; the rest fold into one, so the chart stays readable. */
export const BRIDGE_CATEGORY_BARS = 5;

/**
 * From the comparison window's profit to this window's, in steps that add up
 * exactly: revenue change, then each expense category's change on vehicles
 * (largest first), then company costs. Undefined when the viewer reads no
 * profit (the cashier's view).
 */
export function profitBridge(
  overview: FinanceOverviewResponse,
  categoryBars = BRIDGE_CATEGORY_BARS,
): BridgeStep[] | undefined {
  const start = overview.comparison.profitMinor;
  const end = overview.period.profitMinor;
  if (start === null || end === null) return undefined;

  type Change = Extract<BridgeStep, { kind: "change" }>;
  const changes: Omit<Change, "from" | "to">[] = [];
  changes.push({
    key: "revenue",
    kind: "change",
    what: "revenue",
    value: overview.period.revenueMinor - overview.comparison.revenueMinor,
  });

  // A category's vehicle part: its expenses minus the part recorded on no vehicle.
  const vehiclePart = (window: { expenseMinor: number; companyCostMinor: number }) =>
    window.expenseMinor - window.companyCostMinor;
  const byCategory = overview.expensesByCategory
    .map((category) => ({
      category: { code: category.code, labelFr: category.labelFr, labelEn: category.labelEn },
      value: -(vehiclePart(category.period) - vehiclePart(category.comparison)),
    }))
    .filter((row) => row.value !== 0)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value) || a.category.code.localeCompare(b.category.code));
  const shown = byCategory.length > categoryBars ? byCategory.slice(0, categoryBars - 1) : byCategory;
  for (const row of shown) {
    changes.push({ key: `category:${row.category.code}`, kind: "change", what: "category", ...row });
  }
  const folded = byCategory.slice(shown.length);
  if (folded.length > 0) {
    changes.push({
      key: "otherCategories",
      kind: "change",
      what: "otherCategories",
      foldedCount: folded.length,
      value: folded.reduce((sum, row) => sum + row.value, 0),
    });
  }

  // Expenses the categories don't account for, if any: kept as their own bar
  // so the steps still add up instead of the gap being spread or hidden.
  const categoryExpenseChange = overview.expensesByCategory.reduce(
    (sum, category) => sum + category.period.expenseMinor - category.comparison.expenseMinor,
    0,
  );
  const expenseChange = overview.period.expenseMinor - overview.comparison.expenseMinor;
  if (expenseChange !== categoryExpenseChange) {
    changes.push({ key: "noCategory", kind: "change", what: "noCategory", value: -(expenseChange - categoryExpenseChange) });
  }

  const companyCosts = (pick: "period" | "comparison") =>
    overview.expensesByCategory.reduce((sum, category) => sum + category[pick].companyCostMinor, 0);
  changes.push({
    key: "companyCosts",
    kind: "change",
    what: "companyCosts",
    value: -(companyCosts("period") - companyCosts("comparison")),
  });

  const steps: BridgeStep[] = [{ key: "start", kind: "total", value: start, from: 0, to: start }];
  let running = start;
  for (const change of changes) {
    steps.push({ ...change, from: running, to: running + change.value });
    running += change.value;
  }
  steps.push({ key: "end", kind: "total", value: end, from: 0, to: end });
  return steps;
}

/** The steps' running total lands on the period's profit: the bridge's promise, checked. */
export function bridgeAddsUp(steps: readonly BridgeStep[]): boolean {
  const start = steps[0];
  const end = steps[steps.length - 1];
  if (start === undefined || end === undefined) return false;
  const changed = steps.reduce((sum, step) => (step.kind === "change" ? sum + step.value : sum), 0);
  return start.value + changed === end.value;
}
