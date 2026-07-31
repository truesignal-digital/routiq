import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import type { ActivityListItem } from "@routiq/contracts";
import { StatusBadge } from "@/components/status-badge.js";
import { formatDate, localizedLabel } from "@/lib/format.js";

export type ActivityColumnId =
  | "activityNumber"
  | "status"
  | "activityType"
  | "startedAt"
  | "endedAt"
  | "primaryAssetCode"
  | "customerName"
  | "legCount"
  | "crewCount";

/**
 * One definition per column, shared by every screen that lists jobs.
 *
 * `enableSorting` marks exactly the fields `/v1/activities` declares as
 * sortable; a header control over anything else could only reorder the loaded
 * page and would misrepresent everything past the cursor (ADR-0003).
 */
function buildColumns(
  t: (key: string) => string,
  locale: string,
  /** ICU pluralisation needs the real t; the rest of the table only needs keys. */
  completenessCount: (count: number) => string,
): Record<ActivityColumnId, ColumnDef<ActivityListItem>> {
  return {
    activityNumber: {
      accessorKey: "activityNumber",
      header: t("activities.columns.activityNumber"),
      enableSorting: true,
      meta: { mobile: "primary", label: t("activities.columns.activityNumber") },
      cell: ({ row }) => (
        <span className="font-mono whitespace-nowrap">{row.original.activityNumber}</span>
      ),
    },
    status: {
      accessorKey: "status",
      header: t("activities.columns.status"),
      meta: { mobile: "primary", label: t("activities.columns.status") },
      cell: ({ row }) => {
        const { status, completeness, completenessCodes } = row.original;
        return (
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={status === "OPEN" ? "info" : "neutral"}>
              {t(`activities.status.${status}`)}
            </StatusBadge>
            {completeness === "COMPLETE_WITH_EXCEPTIONS" && (
              // Never a bare count: the exceptions are the reason to look.
              <StatusBadge tone="warning">
                {completenessCount(completenessCodes.length)}
              </StatusBadge>
            )}
          </div>
        );
      },
    },
    activityType: {
      id: "activityType",
      header: t("activities.columns.activityType"),
      meta: { mobile: "secondary", label: t("activities.columns.activityType") },
      cell: ({ row }) => localizedLabel(row.original.activityType, locale),
    },
    startedAt: {
      accessorKey: "startedAt",
      header: t("activities.columns.startedAt"),
      enableSorting: true,
      meta: { mobile: "secondary", label: t("activities.columns.startedAt") },
      cell: ({ row }) =>
        row.original.startedAt === null ? "—" : formatDate(row.original.startedAt, locale),
    },
    endedAt: {
      accessorKey: "endedAt",
      header: t("activities.columns.endedAt"),
      enableSorting: false,
      meta: { mobile: "hidden", label: t("activities.columns.endedAt") },
      cell: ({ row }) =>
        row.original.endedAt === null ? "—" : formatDate(row.original.endedAt, locale),
    },
    primaryAssetCode: {
      accessorKey: "primaryAssetCode",
      header: t("activities.columns.primaryAsset"),
      meta: { mobile: "secondary", label: t("activities.columns.primaryAsset") },
      cell: ({ row }) => (
        <span className="font-mono whitespace-nowrap">
          {row.original.primaryAssetCode ?? "—"}
        </span>
      ),
    },
    customerName: {
      accessorKey: "customerName",
      header: t("activities.columns.customer"),
      meta: { mobile: "hidden", label: t("activities.columns.customer") },
      cell: ({ row }) => row.original.customerName ?? "—",
    },
    legCount: {
      accessorKey: "legCount",
      header: t("activities.columns.legs"),
      meta: { mobile: "hidden", label: t("activities.columns.legs") },
      cell: ({ row }) => (
        <span className="tabular-nums">{row.original.legCount}</span>
      ),
    },
    crewCount: {
      accessorKey: "crewCount",
      header: t("activities.columns.crewCount"),
      enableSorting: false,
      meta: { mobile: "hidden", label: t("activities.columns.crewCount") },
      cell: ({ row }) => (
        <span className="tabular-nums">{row.original.crewCount}</span>
      ),
    },
  };
}

export function useActivityColumns(
  ids: readonly ActivityColumnId[],
): ColumnDef<ActivityListItem>[] {
  const { t, i18n } = useTranslation();
  return useMemo(() => {
    const columns = buildColumns(t, i18n.language, (count) =>
      t("activities.completeness.short", { count }),
    );
    return ids.map((id) => columns[id]);
  }, [t, i18n.language, ids]);
}
