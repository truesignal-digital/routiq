import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { ColumnDef } from "@tanstack/react-table";
import type { AssetListItem } from "@routiq/contracts";
import { StatusBadge } from "@/components/status-badge.js";
import { localizedLabel } from "@/lib/format.js";
import { ASSET_STATUS_TONES, assetDisplayName } from "./display.js";

export type AssetColumnId =
  | "asset"
  | "status"
  | "category"
  | "branch"
  | "registrationNumber";

/**
 * One definition per column, shared by every screen that lists assets.
 *
 * `enableSorting` marks exactly the fields `/v1/assets` declares sortable; a
 * header control over anything else could only reorder the loaded page and
 * would misrepresent everything past the cursor (ADR-0003).
 */
function buildColumns(
  t: (key: string) => string,
  locale: string,
): Record<AssetColumnId, ColumnDef<AssetListItem>> {
  return {
    // Sorting keys on `assetCode`, so the column carries that id even though it
    // shows the code and the name together.
    asset: {
      accessorKey: "assetCode",
      id: "assetCode",
      header: t("assets.columns.asset"),
      enableSorting: true,
      meta: { mobile: "primary", label: t("assets.columns.asset") },
      cell: ({ row }) => {
        const name = assetDisplayName(row.original);
        return (
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{name}</span>
            <span className="truncate font-mono text-xs text-muted-foreground uppercase">
              {row.original.assetCode}
            </span>
          </span>
        );
      },
    },
    status: {
      accessorKey: "lifecycleStatus",
      id: "status",
      header: t("assets.columns.status"),
      meta: { mobile: "primary", label: t("assets.columns.status") },
      cell: ({ row }) => (
        <StatusBadge tone={ASSET_STATUS_TONES[row.original.lifecycleStatus]}>
          {t(`assets.status.${row.original.lifecycleStatus}`)}
        </StatusBadge>
      ),
    },
    category: {
      id: "category",
      header: t("assets.columns.category"),
      meta: { mobile: "secondary", label: t("assets.columns.category") },
      cell: ({ row }) => localizedLabel(row.original.category, locale),
    },
    branch: {
      id: "branch",
      header: t("assets.columns.branch"),
      meta: { mobile: "secondary", label: t("assets.columns.branch") },
      cell: ({ row }) => row.original.branch.name,
    },
    registrationNumber: {
      accessorKey: "registrationNumber",
      header: t("assets.columns.registration"),
      meta: { mobile: "hidden", label: t("assets.columns.registration") },
      cell: ({ row }) => (
        <span className="font-mono whitespace-nowrap">
          {row.original.registrationNumber ?? "—"}
        </span>
      ),
    },
  };
}

export function useAssetColumns(
  ids: readonly AssetColumnId[],
): ColumnDef<AssetListItem>[] {
  const { t, i18n } = useTranslation();
  return useMemo(() => {
    const columns = buildColumns(t, i18n.language);
    return ids.map((id) => columns[id]);
  }, [t, i18n.language, ids]);
}
