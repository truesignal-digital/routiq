import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { DataTableColumn } from "@/components/data-table.js";
import type { AssetListItem } from "@routiq/contracts";
import { AssetStatusBadge } from "./AssetStatusBadge.js";
import { localizedLabel } from "@/lib/format.js";
import { assetDisplayName } from "./display.js";
import { NotRecorded } from "@/components/not-recorded.js";

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
): Record<AssetColumnId, DataTableColumn<AssetListItem>> {
  return {
    // Sorting keys on `assetCode`, so the column carries that id even though it
    // shows the code and the name together.
    asset: {
      accessorKey: "assetCode",
      id: "assetCode",
      header: t("assets.columns.asset"),
      enableSorting: true,
      meta: {
        phone: "title",
        label: t("assets.columns.asset"),
        // The desktop cell stacks name over code; a phone title is one line.
        phoneText: (asset) => {
          const name = assetDisplayName(asset);
          return name === asset.assetCode ? name : `${asset.assetCode} · ${name}`;
        },
      },
      cell: ({ row }) => {
        const name = assetDisplayName(row.original);
        return (
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{name}</span>
            <span className="truncate tabular-nums text-xs text-muted-foreground">
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
      meta: { phone: "status", label: t("assets.columns.status") },
      cell: ({ row }) => (
        <AssetStatusBadge status={row.original.lifecycleStatus} />
      ),
    },
    category: {
      id: "category",
      header: t("assets.columns.category"),
      meta: { phone: "meta", label: t("assets.columns.category") },
      cell: ({ row }) => localizedLabel(row.original.category, locale),
    },
    branch: {
      id: "branch",
      header: t("assets.columns.branch"),
      meta: { phone: "meta", label: t("assets.columns.branch") },
      cell: ({ row }) => row.original.branch.name,
    },
    registrationNumber: {
      accessorKey: "registrationNumber",
      header: t("assets.columns.registration"),
      meta: { phone: "hidden", label: t("assets.columns.registration") },
      cell: ({ row }) => (
        <span className="tabular-nums whitespace-nowrap">
          {row.original.registrationNumber ?? <NotRecorded />}
        </span>
      ),
    },
  };
}

export function useAssetColumns(
  ids: readonly AssetColumnId[],
): DataTableColumn<AssetListItem>[] {
  const { t, i18n } = useTranslation();
  return useMemo(() => {
    const columns = buildColumns(t, i18n.language);
    return ids.map((id) => columns[id]);
  }, [t, i18n.language, ids]);
}
