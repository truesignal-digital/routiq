import { useMemo } from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeContext } from "@/auth/me.js";
import { canReadFleetDocuments } from "@/assets/trucksTabs.js";
import { DataTable, type DataTableColumn } from "@/components/data-table";
import { FilterChips } from "@/components/filter-chips";
import { EmptyState, ErrorState, LoadingState } from "@/components/page";
import { PermissionDenied } from "@/components/permission-denied.js";
import { StatusBadge } from "@/components/status-badge.js";
import { formatDate, localizedLabel } from "@/lib/format.js";
import {
  FLEET_DOCUMENT_FILTERS,
  FLEET_DOCUMENT_WINDOW_DAYS,
  fleetDocumentLink,
  fleetDocumentRows,
  fleetDocumentsTruncated,
  type FleetDocumentFilter,
  type FleetDocumentRow,
} from "@/overview/fleet-documents.js";
import { useComingUp, useTodo } from "@/overview/useFleetAttention.js";

type Chip = FleetDocumentFilter | "ALL";

/**
 * Trucks › Documents (#665): the fleet's papers that need someone, expired
 * first and then those due in the next 30 days, from the same reads the
 * Overview counts (`/v1/todo`, `/v1/coming-up`), so its tile and this list
 * agree. A paper is renewed on its truck, where the row leads.
 */
export function FleetDocumentsTab() {
  const { t } = useTranslation();
  const me = useMeContext();
  if (me !== undefined && !canReadFleetDocuments(me.role, me.enabledModules)) {
    return (
      <PermissionDenied
        title={t("assets.page.tabs.documents")}
        icon={<FileText className="size-7" aria-hidden />}
        code="ROLE_FORBIDDEN"
      />
    );
  }
  return <FleetDocuments />;
}

function FleetDocuments() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ from: "/app/assets/documents" });
  const chip: Chip = search.expiry ?? "ALL";
  const comingUpQuery = useComingUp(FLEET_DOCUMENT_WINDOW_DAYS);
  const todoQuery = useTodo();
  const language = i18n.resolvedLanguage;

  const rows = useMemo(
    () =>
      fleetDocumentRows(todoQuery.data, comingUpQuery.data).filter((row) => chip === "ALL" || row.state === chip),
    [todoQuery.data, comingUpQuery.data, chip],
  );

  const columns = useMemo<DataTableColumn<FleetDocumentRow>[]>(
    () => [
      {
        id: "asset",
        header: t("assets.documents.columns.asset"),
        meta: { phone: "title", label: t("assets.documents.columns.asset") },
        cell: ({ row }) => <span className="tabular-nums whitespace-nowrap">{row.original.asset?.assetCode}</span>,
      },
      {
        id: "type",
        header: t("assets.documents.columns.type"),
        meta: { phone: "meta", label: t("assets.documents.columns.type") },
        cell: ({ row }) =>
          localizedLabel({ labelFr: row.original.typeLabelFr, labelEn: row.original.typeLabelEn }, language),
      },
      {
        id: "expiresAt",
        header: t("assets.documents.columns.expiresAt"),
        meta: { phone: "value", label: t("assets.documents.columns.expiresAt") },
        cell: ({ row }) => <span className="tabular-nums">{formatDate(row.original.expiresAt, language, "short")}</span>,
      },
      {
        id: "state",
        header: t("assets.documents.columns.state"),
        meta: { phone: "status", label: t("assets.documents.columns.state") },
        cell: ({ row }) =>
          row.original.state === "EXPIRED" ? (
            <StatusBadge tone="danger">
              {t("assets.documents.expiredDays", { days: Math.abs(row.original.daysLeft ?? 0) })}
            </StatusBadge>
          ) : (
            <StatusBadge tone="warning">{t("assets.documents.dueDays", { days: row.original.daysLeft ?? 0 })}</StatusBadge>
          ),
      },
    ],
    [t, language],
  );

  const isPending = comingUpQuery.isPending || todoQuery.isPending;
  const isError = comingUpQuery.isError || todoQuery.isError;

  return (
    <div data-slot="fleet-documents" className="flex flex-col gap-4">
      <FilterChips
        layout="wrap"
        label={t("assets.documents.filterLabel")}
        value={chip}
        onChange={(next) =>
          void navigate({
            to: "/assets/documents",
            replace: true,
            search: next === "ALL" ? {} : { expiry: next },
          })
        }
        options={(["ALL", ...FLEET_DOCUMENT_FILTERS] as const).map((key) => ({
          key,
          label: t(`assets.documents.filters.${key}`, { days: FLEET_DOCUMENT_WINDOW_DAYS }),
        }))}
      />
      {fleetDocumentsTruncated(todoQuery.data, comingUpQuery.data) && (
        <p className="text-xs text-muted-foreground">{t("assets.overview.due.truncated")}</p>
      )}
      {isError ? (
        <ErrorState
          message={t("assets.documents.loadFailed")}
          retryLabel={t("assets.retry")}
          onRetry={() => {
            void comingUpQuery.refetch();
            void todoQuery.refetch();
          }}
        />
      ) : (
        <DataTable
          columns={columns}
          data={rows}
          getRowId={(row) => row.key}
          primaryColumn={{ columnId: "asset" }}
          onRowClick={(row) => {
            const link = fleetDocumentLink(row);
            if (link !== undefined) void navigate({ to: link.to, ...(link.search === undefined ? {} : { search: link.search }) });
          }}
          emptyState={
            isPending ? (
              <LoadingState label={t("assets.documents.loading")} />
            ) : (
              <EmptyState
                icon={<FileText className="size-7" aria-hidden />}
                message={t(chip === "EXPIRED" ? "assets.documents.emptyExpired" : "assets.documents.empty", {
                  days: FLEET_DOCUMENT_WINDOW_DAYS,
                })}
              />
            )
          }
        />
      )}
    </div>
  );
}
