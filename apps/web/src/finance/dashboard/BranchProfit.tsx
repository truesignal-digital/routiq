import { Building } from "lucide-react";
import type { FinanceOverviewResponse, OverviewBranchRow } from "@routiq/contracts";
import { useTranslation } from "react-i18next";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { EmptyState } from "@/components/page";
import { formatMoney, profitOrLoss } from "@/lib/format.js";
import { cn } from "@/lib/utils.js";
import type { DashboardMode } from "./money-view.js";

/** With a branch chosen, that branch's row alone. */
export function branchRows(overview: FinanceOverviewResponse, branchId: string | undefined): OverviewBranchRow[] {
  const rows = overview.branches ?? [];
  return branchId === undefined ? rows : rows.filter((row) => row.branchId === branchId);
}

const valueOf = (row: OverviewBranchRow, mode: DashboardMode) =>
  mode === "profit" ? row.vehicleProfitMinor : row.expenseMinor;

/**
 * Vehicle profit by branch (dashboards.html, ProfitBars): a bar per branch
 * from a centre line, blue for a profit and orange for a loss, largest first.
 * Every figure is written on its row, so the bars are their own table view;
 * hovering a row repeats it with the revenue and expenses behind it. An
 * internal fleet sees each branch's vehicle costs instead.
 */
export function BranchProfitBars({
  rows,
  currency,
  mode,
}: {
  rows: readonly OverviewBranchRow[];
  currency: string;
  mode: DashboardMode;
}) {
  const { t } = useTranslation();
  if (rows.length === 0) return <p className="py-2 text-sm text-muted-foreground">{t("dashboard.branches.empty")}</p>;
  const sorted = [...rows].sort((a, b) => valueOf(b, mode) - valueOf(a, mode));
  const values = sorted.map((row) => valueOf(row, mode));
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const span = Math.max(1, high - low);
  const zero = ((0 - low) / span) * 100;
  return (
    <ul data-slot="branch-bars" className="flex flex-col gap-3">
      {sorted.map((row) => {
        const value = valueOf(row, mode);
        const width = (Math.abs(value) / span) * 100;
        const text =
          mode === "profit" ? profitOrLoss(value, { currency }).text : formatMoney(value, { currency });
        const hover = t(mode === "profit" ? "dashboard.branches.hover" : "dashboard.branches.hoverCosts", {
          count: row.vehicleCount,
          revenue: formatMoney(row.revenueMinor, { currency }),
          expenses: formatMoney(row.expenseMinor, { currency }),
        });
        return (
          <li key={row.branchId} data-slot="branch-bar" title={hover} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{row.name}</span>
              <span className="shrink-0 font-semibold tabular-nums">{text}</span>
            </div>
            <div className="relative h-2.5" aria-hidden>
              {low < 0 && <div className="absolute -inset-y-1 w-px bg-border" style={{ left: `${zero}%` }} />}
              <div
                className={cn("absolute inset-y-0 rounded-[3px]", value < 0 ? "bg-series-2" : "bg-series-1")}
                style={{ left: `${value < 0 ? zero - width : zero}%`, width: `${Math.max(width, value === 0 ? 0 : 1)}%` }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** The Profit by branch tab: every branch with its vehicles, revenue, expenses and vehicle profit. */
export function BranchProfitTable({
  rows,
  currency,
  mode,
}: {
  rows: readonly OverviewBranchRow[];
  currency: string;
  mode: DashboardMode;
}) {
  const { t } = useTranslation();
  const money = (minor: number) => formatMoney(minor, { currency });
  const label = (key: string) => t(`dashboard.branches.columns.${key}`);
  const right = (text: string) => () => <span className="block text-right">{text}</span>;
  const columns: DataTableColumn<OverviewBranchRow>[] = [
    {
      id: "branch",
      header: label("branch"),
      meta: { phone: "title", label: label("branch"), phoneText: (row) => row.name },
      cell: ({ row }) => row.original.name,
    },
    {
      id: "vehicles",
      header: right(label("vehicles")),
      meta: {
        phone: "meta",
        label: label("vehicles"),
        phoneText: (row) => t("dashboard.branches.vehicleCount", { count: row.vehicleCount }),
      },
      cell: ({ row }) => <span className="block text-right tabular-nums">{row.original.vehicleCount}</span>,
    },
    ...(mode === "profit"
      ? [
          {
            id: "revenue",
            header: right(label("revenue")),
            meta: { phone: "hidden", label: label("revenue") },
            cell: ({ row }) => <span className="block text-right tabular-nums">{money(row.original.revenueMinor)}</span>,
          } satisfies DataTableColumn<OverviewBranchRow>,
        ]
      : []),
    {
      id: "expenses",
      header: right(label("expenses")),
      meta:
        mode === "profit"
          ? { phone: "hidden", label: label("expenses") }
          : { phone: "value", label: label("expenses"), phoneText: (row) => money(row.expenseMinor) },
      cell: ({ row }) => <span className="block text-right tabular-nums">{money(row.original.expenseMinor)}</span>,
    },
    ...(mode === "profit"
      ? [
          {
            id: "profit",
            header: right(label("profit")),
            meta: {
              phone: "value",
              label: label("profit"),
              phoneText: (row: OverviewBranchRow) => profitOrLoss(row.vehicleProfitMinor, { currency }).text,
            },
            cell: ({ row }) => {
              const result = profitOrLoss(row.original.vehicleProfitMinor, { currency });
              return (
                <span className="block text-right font-semibold tabular-nums">
                  {result.kind === "loss" ? result.text : result.amount}
                </span>
              );
            },
          } satisfies DataTableColumn<OverviewBranchRow>,
        ]
      : []),
  ];
  const sorted = [...rows].sort((a, b) => valueOf(b, mode) - valueOf(a, mode));
  return (
    <DataTable
      columns={columns}
      data={sorted}
      getRowId={(row) => row.branchId}
      showRowCount={false}
      emptyState={<EmptyState icon={<Building className="size-7" aria-hidden />} message={t("dashboard.branches.empty")} />}
    />
  );
}
