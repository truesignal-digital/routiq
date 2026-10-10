import type { FinanceOverviewResponse, OverviewVehicleRow } from "@routiq/contracts";

/**
 * Profit, or costs only. A company that records no revenue (an internal
 * fleet) gets no profit anywhere: profit would only restate its expenses as a
 * loss (CONTEXT.md, Profit). Judged on the 12 months and both windows, so a
 * quiet month does not flip a transporter into the costs view.
 */
export type DashboardMode = "profit" | "costs";

export function dashboardMode(overview: FinanceOverviewResponse | undefined): DashboardMode {
  if (overview === undefined || overview.view !== "PROFIT") return overview === undefined ? "profit" : "costs";
  const earned =
    overview.period.revenueMinor !== 0 ||
    overview.comparison.revenueMinor !== 0 ||
    overview.series.some((month) => month.revenueMinor !== 0);
  return earned ? "profit" : "costs";
}

/**
 * The vehicle rows to show: with a branch chosen, only that branch's
 * vehicles. The read lists every vehicle with money in the period, and an
 * entry recorded in one branch can name another branch's vehicle.
 */
export function vehicleRows(
  overview: FinanceOverviewResponse,
  branchId: string | undefined,
): OverviewVehicleRow[] {
  const rows = overview.vehicles ?? [];
  return branchId === undefined ? rows : rows.filter((row) => row.branchId === branchId);
}

/** "All vehicles − company costs = company profit", from the server's own parts, so the lines add up. */
export interface CompanyLines {
  shownVehicleCount: number;
  /** The rows on screen. */
  shownVehicleProfitMinor: number;
  shownVehicleExpenseMinor: number;
  /** Vehicles left off by the branch filter whose money is in this branch's entries; zero otherwise. */
  otherVehicleProfitMinor: number;
  otherVehicleExpenseMinor: number;
  revenueWithoutVehicleMinor: number;
  companyCostsMinor: number;
  companyProfitMinor: number;
  /** Every expense of the period: vehicles plus company costs. */
  expenseMinor: number;
}

export function companyLines(
  overview: FinanceOverviewResponse,
  rows: readonly OverviewVehicleRow[],
): CompanyLines | undefined {
  const company = overview.companyProfit?.period;
  if (company === undefined) return undefined;
  const shownVehicleProfitMinor = rows.reduce((sum, row) => sum + row.profitMinor, 0);
  const shownVehicleExpenseMinor = rows.reduce((sum, row) => sum + row.expenseMinor, 0);
  const vehicleExpenseMinor = overview.period.expenseMinor - company.companyCostsMinor;
  return {
    shownVehicleCount: rows.length,
    shownVehicleProfitMinor,
    shownVehicleExpenseMinor,
    otherVehicleProfitMinor: company.vehicleProfitMinor - shownVehicleProfitMinor,
    otherVehicleExpenseMinor: vehicleExpenseMinor - shownVehicleExpenseMinor,
    revenueWithoutVehicleMinor: company.revenueWithoutVehicleMinor,
    companyCostsMinor: company.companyCostsMinor,
    companyProfitMinor: company.companyProfitMinor,
    expenseMinor: overview.period.expenseMinor,
  };
}

/** The phone's "Vehicles at a loss": the three biggest losses, worst first. */
export function vehiclesAtALoss(rows: readonly OverviewVehicleRow[], limit = 3): OverviewVehicleRow[] {
  return rows
    .filter((row) => row.profitMinor < 0)
    .sort((a, b) => a.profitMinor - b.profitMinor)
    .slice(0, limit);
}
