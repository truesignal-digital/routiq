import { Truck } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import type { FinanceOverviewResponse, OverviewVehicleRow } from "@routiq/contracts";
import { useTranslation } from "react-i18next";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { EmptyState } from "@/components/page";
import { NotRecorded } from "@/components/not-recorded.js";
import { formatCount, formatMoney, profitOrLoss } from "@/lib/format.js";
import { cn } from "@/lib/utils.js";
import { companyLines, type DashboardMode } from "./money-view.js";

const PRIMARY = { columnId: "vehicle" } as const;

/**
 * One row per vehicle: trips, km, revenue, expenses and its profit, losses
 * first as the read orders them (dashboards.html, TruckProfitTable). An
 * internal fleet sees what each vehicle cost, the costliest first. The vehicle
 * opens its Money tab.
 */
export function VehicleProfitTable({
  overview,
  rows,
  mode,
  limit,
}: {
  overview: FinanceOverviewResponse;
  rows: readonly OverviewVehicleRow[];
  mode: DashboardMode;
  /** The Overview's card shows the first rows; the tab shows every one. */
  limit?: number;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const columns = useVehicleColumns(overview, mode);
  const shown = limit === undefined ? [...rows] : rows.slice(0, limit);
  return (
    <DataTable
      columns={columns}
      data={shown}
      getRowId={(row) => row.assetId}
      primaryColumn={PRIMARY}
      onRowClick={(row) => void navigate({ to: `/assets/${row.assetId}/money` })}
      showRowCount={false}
      {...(limit === undefined ? { pagination: { defaultPageSize: 25 } } : {})}
      emptyState={<EmptyState icon={<Truck className="size-7" aria-hidden />} message={t("dashboard.vehicles.empty")} />}
    />
  );
}

function useVehicleColumns(overview: FinanceOverviewResponse, mode: DashboardMode): DataTableColumn<OverviewVehicleRow>[] {
  const { t } = useTranslation();
  const currency = overview.currency;
  const money = (minor: number) => formatMoney(minor, { currency });
  const branchName = new Map((overview.branches ?? []).map((branch) => [branch.branchId, branch.name]));
  const tripsKnown = overview.vehicles?.some((row) => row.tripsClosed !== null) ?? false;
  const label = (key: string) => t(`dashboard.vehicles.columns.${key}`);

  const columns: DataTableColumn<OverviewVehicleRow>[] = [
    {
      id: "vehicle",
      header: label("vehicle"),
      meta: { phone: "title", label: label("vehicle"), phoneText: (row) => row.assetCode },
      cell: ({ row }) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate tabular-nums">{row.original.assetCode}</span>
          {row.original.registrationNumber !== null && (
            <span className="truncate text-xs text-muted-foreground tabular-nums">{row.original.registrationNumber}</span>
          )}
        </span>
      ),
    },
    {
      id: "branch",
      header: label("branch"),
      meta: { phone: "meta", label: label("branch"), phoneText: (row) => branchName.get(row.branchId) ?? null },
      cell: ({ row }) => branchName.get(row.original.branchId) ?? <NotRecorded />,
    },
  ];
  if (tripsKnown) {
    columns.push(
      {
        id: "trips",
        header: () => <span className="block text-right">{label("trips")}</span>,
        meta: {
          phone: "meta",
          label: label("trips"),
          phoneText: (row) => t("dashboard.vehicles.tripsCount", { count: row.tripsClosed ?? 0 }),
        },
        cell: ({ row }) => <span className="block text-right tabular-nums">{row.original.tripsClosed ?? 0}</span>,
      },
      {
        id: "km",
        header: () => <span className="block text-right">{label("km")}</span>,
        meta: {
          phone: "hidden",
          label: label("km"),
        },
        cell: ({ row }) => <KmCell row={row.original} />,
      },
    );
  }
  if (mode === "profit") {
    columns.push({
      id: "revenue",
      header: () => <span className="block text-right">{label("revenue")}</span>,
      meta: { phone: "hidden", label: label("revenue") },
      cell: ({ row }) => <span className="block text-right tabular-nums">{money(row.original.revenueMinor)}</span>,
    });
  }
  columns.push({
    id: "expenses",
    header: () => <span className="block text-right">{label("expenses")}</span>,
    meta: mode === "profit" ? { phone: "hidden", label: label("expenses") } : { phone: "value", label: label("expenses"), phoneText: (row) => money(row.expenseMinor) },
    cell: ({ row }) => <span className="block text-right tabular-nums">{money(row.original.expenseMinor)}</span>,
  });
  if (mode === "profit") {
    columns.push({
      id: "profit",
      header: () => <span className="block text-right">{label("profit")}</span>,
      meta: {
        phone: "value",
        label: label("profit"),
        phoneText: (row) => profitOrLoss(row.profitMinor, { currency }).text,
      },
      cell: ({ row }) => {
        const result = profitOrLoss(row.original.profitMinor, { currency });
        return (
          <span
            data-slot="vehicle-profit"
            data-kind={result.kind}
            className="block text-right font-semibold tabular-nums"
          >
            {result.kind === "loss" ? result.text : result.amount}
          </span>
        );
      },
    });
  }
  return columns;
}

function KmCell({ row }: { row: OverviewVehicleRow }) {
  const { t } = useTranslation();
  if (row.distanceKm === null) {
    // Trips closed with no km on their legs: unrecorded, not zero.
    return row.tripsClosed !== null && row.tripsClosed > 0 ? (
      <span className="block text-right">
        <NotRecorded />
      </span>
    ) : (
      <span className="block text-right tabular-nums">0</span>
    );
  }
  return (
    <span className="flex flex-col items-end">
      <span className="tabular-nums">{formatCount(row.distanceKm)}</span>
      {row.tripsWithoutKm !== null && row.tripsWithoutKm > 0 && (
        <span className="text-xs text-muted-foreground">
          {t("dashboard.vehicles.tripsWithoutKm", { count: row.tripsWithoutKm })}
        </span>
      )}
    </span>
  );
}

/**
 * Under the vehicle table: all vehicles, company costs, company profit, from
 * the server's parts so the lines add up (dashboards.html, "Company profit =
 * profit of all trucks − company costs"). An internal fleet adds its costs.
 */
export function CompanyLinesList({
  overview,
  rows,
  mode,
  branchChosen,
}: {
  overview: FinanceOverviewResponse;
  rows: readonly OverviewVehicleRow[];
  mode: DashboardMode;
  branchChosen: boolean;
}) {
  const { t } = useTranslation();
  const lines = companyLines(overview, rows);
  if (lines === undefined) return null;
  const currency = overview.currency;
  const money = (minor: number) => formatMoney(minor, { currency });
  const pl = (minor: number) => profitOrLoss(minor, { currency }).text;
  const minus = (minor: number) => formatMoney(-minor, { currency, sign: { context: "net" } });

  const items: { key: string; label: string; value: string; total?: boolean }[] =
    mode === "profit"
      ? [
          {
            key: "vehicles",
            label: t(branchChosen ? "dashboard.vehicles.lines.branchVehicles" : "dashboard.vehicles.lines.allVehicles", {
              count: lines.shownVehicleCount,
            }),
            value: pl(lines.shownVehicleProfitMinor),
          },
          ...(lines.otherVehicleProfitMinor !== 0
            ? [{ key: "other", label: t("dashboard.vehicles.lines.otherVehicles"), value: pl(lines.otherVehicleProfitMinor) }]
            : []),
          ...(lines.revenueWithoutVehicleMinor !== 0
            ? [
                {
                  key: "revenueWithoutVehicle",
                  label: t("dashboard.vehicles.lines.revenueWithoutVehicle"),
                  value: formatMoney(lines.revenueWithoutVehicleMinor, { currency, sign: { context: "net" } }),
                },
              ]
            : []),
          { key: "companyCosts", label: t("dashboard.vehicles.lines.companyCosts"), value: minus(lines.companyCostsMinor) },
          {
            key: "companyProfit",
            label: t(lines.companyProfitMinor < 0 ? "dashboard.vehicles.lines.companyLoss" : "dashboard.vehicles.lines.companyProfit"),
            value: profitOrLoss(lines.companyProfitMinor, { currency }).amount,
            total: true,
          },
        ]
      : [
          {
            key: "vehicles",
            label: t(branchChosen ? "dashboard.vehicles.lines.branchVehicleCosts" : "dashboard.vehicles.lines.allVehicleCosts", {
              count: lines.shownVehicleCount,
            }),
            value: money(lines.shownVehicleExpenseMinor),
          },
          ...(lines.otherVehicleExpenseMinor !== 0
            ? [{ key: "other", label: t("dashboard.vehicles.lines.otherVehicleCosts"), value: money(lines.otherVehicleExpenseMinor) }]
            : []),
          { key: "companyCosts", label: t("dashboard.vehicles.lines.companyCostsPlus"), value: money(lines.companyCostsMinor) },
          { key: "expenses", label: t("dashboard.vehicles.lines.allExpenses"), value: money(lines.expenseMinor), total: true },
        ];

  return (
    <dl data-slot="company-lines" className="flex flex-col rounded-lg bg-muted/50 px-3">
      {items.map((item) => (
        <div
          key={item.key}
          data-slot="company-line"
          data-line={item.key}
          className={cn(
            "flex items-baseline justify-between gap-3 border-b py-2 text-sm last:border-b-0",
            item.total === true ? "font-semibold" : "",
          )}
        >
          <dt className="min-w-0">{item.label}</dt>
          <dd className="m-0 shrink-0 font-semibold tabular-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The phone's "Vehicles at a loss": the worst three, with what they did. */
export function VehiclesAtALoss({
  rows,
  currency,
}: {
  rows: readonly OverviewVehicleRow[];
  currency: string;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  if (rows.length === 0) {
    return <p className="py-2 text-sm text-muted-foreground">{t("dashboard.vehicles.noneAtALoss")}</p>;
  }
  return (
    <ul data-slot="vehicles-at-a-loss" className="flex flex-col">
      {rows.map((row) => (
        <li key={row.assetId} className="border-b last:border-b-0">
          <button
            type="button"
            onClick={() => void navigate({ to: `/assets/${row.assetId}/money` })}
            className="flex min-h-11 w-full items-center justify-between gap-3 py-2 text-left"
          >
            <span className="flex min-w-0 flex-col">
              <span className="font-semibold tabular-nums">{row.assetCode}</span>
              <span className="text-xs text-muted-foreground">
                {row.tripsClosed === null
                  ? t("dashboard.vehicles.expensesOnly", { amount: formatMoney(row.expenseMinor, { currency }) })
                  : t("dashboard.vehicles.lossDetail", {
                      count: row.tripsClosed,
                      amount: formatMoney(row.expenseMinor, { currency }),
                    })}
              </span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums">
              {profitOrLoss(row.profitMinor, { currency }).text}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

