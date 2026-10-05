import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import type { IssueListItem, WorkOrderListItem } from "@routiq/contracts";
import { ShieldAlert, TriangleAlert } from "lucide-react";
import { StatusBadge } from "@/components/status-badge.js";
import { IssueStatusBadge } from "./IssueStatusBadge.js";
import { WorkOrderStatusBadge, workOrderStatusTone } from "./WorkOrderStatusBadge.js";
import { formatDate, formatMoney } from "@/lib/format.js";
import { useIssueCategoryLabel } from "./issue-category.js";

/**
 * A work order has no number of its own — the read publishes only its id — so
 * the queue shows the head of that id. Enough to read a row out over the phone,
 * and never a fabricated sequence the server would disagree with.
 */
export function workOrderReference(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

function AssetCell({
  asset,
}: {
  asset: { assetCode: string; registrationNumber: string | null };
}) {
  return (
    <span className="flex flex-col">
      <span className="font-mono whitespace-nowrap">{asset.assetCode}</span>
      {asset.registrationNumber !== null && (
        <span className="text-xs text-muted-foreground">{asset.registrationNumber}</span>
      )}
    </span>
  );
}

export function useWorkOrderColumns(): ColumnDef<WorkOrderListItem>[] {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  return useMemo(
    () => [
      {
        id: "reference",
        header: t("maintenance.workOrders.columns.reference"),
        meta: {
          mobile: "primary",
          label: t("maintenance.workOrders.columns.reference"),
        },
        cell: ({ row }) => (
          <span className="font-mono whitespace-nowrap">
            {workOrderReference(row.original.id)}
          </span>
        ),
      },
      {
        id: "asset",
        header: t("maintenance.workOrders.columns.asset"),
        meta: { mobile: "primary", label: t("maintenance.workOrders.columns.asset") },
        cell: ({ row }) => <AssetCell asset={row.original.asset} />,
      },
      {
        id: "branch",
        header: t("maintenance.workOrders.columns.branch"),
        meta: { mobile: "secondary", label: t("maintenance.workOrders.columns.branch") },
        cell: ({ row }) => row.original.branch.name,
      },
      {
        id: "description",
        header: t("maintenance.workOrders.columns.description"),
        meta: {
          mobile: "secondary",
          label: t("maintenance.workOrders.columns.description"),
        },
        cell: ({ row }) => (
          <span className="flex items-center gap-1.5">
            {row.original.issue?.safetyCritical === true && (
              <ShieldAlert
                className="size-3.5 shrink-0 text-destructive"
                aria-label={t("maintenance.issues.safetyCritical")}
              />
            )}
            <span>{row.original.description}</span>
          </span>
        ),
      },
      {
        id: "expectedCost",
        header: t("maintenance.workOrders.columns.expectedCost"),
        meta: {
          mobile: "hidden",
          label: t("maintenance.workOrders.columns.expectedCost"),
        },
        cell: ({ row }) =>
          row.original.expectedCostMinor === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="tabular-nums whitespace-nowrap">
              {formatMoney(row.original.expectedCostMinor, {
                currency: row.original.currency,
                locale,
              })}
            </span>
          ),
      },
      {
        id: "actualCost",
        header: t("maintenance.workOrders.columns.actualCost"),
        meta: { mobile: "hidden", label: t("maintenance.workOrders.columns.actualCost") },
        cell: ({ row }) =>
          row.original.actualCostMinor === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="tabular-nums whitespace-nowrap">
              {formatMoney(row.original.actualCostMinor, {
                currency: row.original.currency,
                locale,
              })}
            </span>
          ),
      },
      {
        id: "status",
        header: t("maintenance.workOrders.columns.status"),
        meta: { mobile: "primary", label: t("maintenance.workOrders.columns.status") },
        cell: ({ row }) => (
          <WorkOrderStatusBadge status={row.original.status} />
        ),
      },
    ],
    [locale, t],
  );
}

export function useIssueColumns(): ColumnDef<IssueListItem>[] {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const categoryLabel = useIssueCategoryLabel();

  return useMemo(
    () => [
      {
        id: "asset",
        header: t("maintenance.issues.columns.asset"),
        meta: { mobile: "primary", label: t("maintenance.issues.columns.asset") },
        cell: ({ row }) => <AssetCell asset={row.original.asset} />,
      },
      {
        id: "description",
        header: t("maintenance.issues.columns.description"),
        meta: { mobile: "secondary", label: t("maintenance.issues.columns.description") },
        cell: ({ row }) => row.original.description,
      },
      {
        id: "safetyCritical",
        header: t("maintenance.issues.columns.safety"),
        meta: { mobile: "primary", label: t("maintenance.issues.columns.safety") },
        cell: ({ row }) => (
          <span className="flex flex-wrap items-center gap-1.5">
            {row.original.safetyCritical && (
              <StatusBadge tone="danger" icon={ShieldAlert}>
                {t("maintenance.issues.safetyCritical")}
              </StatusBadge>
            )}
            {/* Availability, not lifecycle: a grounded truck can still be
                IN_SERVICE, and only a release re-opens it (§3.4). */}
            {row.original.assetUnavailable && (
              <StatusBadge tone="warning" icon={TriangleAlert}>
                {t("maintenance.issues.unavailable")}
              </StatusBadge>
            )}
            {!row.original.safetyCritical && !row.original.assetUnavailable && (
              <span className="text-muted-foreground">—</span>
            )}
          </span>
        ),
      },
      {
        id: "status",
        header: t("maintenance.issues.columns.status"),
        meta: { mobile: "primary", label: t("maintenance.issues.columns.status") },
        cell: ({ row }) => {
          const closingWords =
            row.original.status === "DISMISSED"
              ? row.original.dismissReason
              : row.original.resolutionNote;
          return (
            <span className="flex flex-col items-start gap-1">
              <IssueStatusBadge issue={row.original} />
              {row.original.status !== "OPEN" && closingWords !== null && (
                <span className="text-xs text-muted-foreground">{closingWords}</span>
              )}
            </span>
          );
        },
      },
      {
        id: "category",
        header: t("maintenance.issues.columns.category"),
        meta: { mobile: "secondary", label: t("maintenance.issues.columns.category") },
        cell: ({ row }) => categoryLabel(row.original.category) ?? "—",
      },
      {
        id: "reportedAt",
        header: t("maintenance.issues.columns.reportedAt"),
        meta: { mobile: "secondary", label: t("maintenance.issues.columns.reportedAt") },
        cell: ({ row }) => (
          <span className="tabular-nums whitespace-nowrap">
            {formatDate(row.original.reportedAt, locale)}
          </span>
        ),
      },
      {
        id: "workOrders",
        header: t("maintenance.issues.columns.workOrders"),
        meta: { mobile: "hidden", label: t("maintenance.issues.columns.workOrders") },
        cell: ({ row }) =>
          row.original.workOrders.length === 0 ? (
            <span className="text-muted-foreground">
              {t("maintenance.issues.noWorkOrder")}
            </span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {row.original.workOrders.map((workOrder) => (
                <StatusBadge key={workOrder.id} tone={workOrderStatusTone(workOrder.status)}>
                  {workOrderReference(workOrder.id)}
                </StatusBadge>
              ))}
            </span>
          ),
      },
    ],
    [categoryLabel, locale, t],
  );
}
