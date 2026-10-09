import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { DataTableColumn } from "@/components/data-table.js";
import type { ActivityListItem } from "@routiq/contracts";
import { TripStatusBadge } from "@/activities/TripStatusBadge.js";
import { formatDate, localizedLabel } from "@/lib/format.js";
import { NotRecorded } from "@/components/not-recorded.js";

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
): Record<ActivityColumnId, DataTableColumn<ActivityListItem>> {
  return {
    activityNumber: {
      accessorKey: "activityNumber",
      header: t("activities.columns.activityNumber"),
      enableSorting: true,
      meta: { phone: "title", label: t("activities.columns.activityNumber") },
      cell: ({ row }) => (
        <span className="whitespace-nowrap tabular-nums">{row.original.activityNumber}</span>
      ),
    },
    status: {
      accessorKey: "status",
      header: t("activities.columns.status"),
      meta: { phone: "status", label: t("activities.columns.status") },
      cell: ({ row }) => <TripStatusBadge trip={row.original} />,
    },
    activityType: {
      id: "activityType",
      header: t("activities.columns.activityType"),
      meta: { phone: "meta", label: t("activities.columns.activityType") },
      cell: ({ row }) => (
        <span className="whitespace-normal">{localizedLabel(row.original.activityType, locale)}</span>
      ),
    },
    startedAt: {
      accessorKey: "startedAt",
      header: t("activities.columns.startedAt"),
      enableSorting: true,
      meta: { phone: "meta", label: t("activities.columns.startedAt") },
      cell: ({ row }) =>
        row.original.startedAt === null ? <NotRecorded /> : formatDate(row.original.startedAt, locale),
    },
    endedAt: {
      accessorKey: "endedAt",
      header: t("activities.columns.endedAt"),
      enableSorting: false,
      meta: { phone: "hidden", label: t("activities.columns.endedAt") },
      cell: ({ row }) =>
        row.original.endedAt === null ? <NotRecorded /> : formatDate(row.original.endedAt, locale),
    },
    primaryAssetCode: {
      accessorKey: "primaryAssetCode",
      header: t("activities.columns.primaryAsset"),
      meta: { phone: "meta", label: t("activities.columns.primaryAsset") },
      cell: ({ row }) => (
        <span className="whitespace-nowrap tabular-nums">
          {row.original.primaryAssetCode ?? <NotRecorded />}
        </span>
      ),
    },
    customerName: {
      accessorKey: "customerName",
      header: t("activities.columns.customer"),
      meta: { phone: "hidden", label: t("activities.columns.customer") },
      cell: ({ row }) => (
        <span className="whitespace-normal">{row.original.customerName ?? <NotRecorded />}</span>
      ),
    },
    legCount: {
      accessorKey: "legCount",
      header: t("activities.columns.legs"),
      meta: { phone: "hidden", label: t("activities.columns.legs") },
      cell: ({ row }) => (
        <span className="tabular-nums">{row.original.legCount}</span>
      ),
    },
    crewCount: {
      accessorKey: "crewCount",
      header: t("activities.columns.crewCount"),
      enableSorting: false,
      meta: { phone: "hidden", label: t("activities.columns.crewCount") },
      cell: ({ row }) => (
        <span className="tabular-nums">{row.original.crewCount}</span>
      ),
    },
  };
}

export function useActivityColumns(
  ids: readonly ActivityColumnId[],
): DataTableColumn<ActivityListItem>[] {
  const { t, i18n } = useTranslation();
  return useMemo(() => {
    const columns = buildColumns(t, i18n.language);
    return ids.map((id) => columns[id]);
  }, [t, i18n.language, ids]);
}
