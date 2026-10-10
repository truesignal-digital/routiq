import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Clock } from "lucide-react";
import {
  VEHICLE_HISTORY_KINDS,
  type ModuleCode,
  type VehicleHistoryItem,
  type VehicleHistoryKind,
} from "@routiq/contracts";
import { FilterChips } from "@/components/filter-chips";
import { RecordText } from "@/components/record-number";
import { historyNote, Timeline, type TimelineEvent } from "@/components/timeline.js";
import { EmptyState, ErrorState, LoadingState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatMoney, type MoneySign } from "@/lib/format.js";
import { cn } from "@/lib/utils";
import { contributes } from "@/modules/manifest.js";
import { useVehicle, type VehicleGates } from "../context.js";
import { describeEvent, type EventTone } from "../historyEvents.js";
import { LinkButton, Sep, TabHeader } from "../parts.js";
import { useAssetHistory } from "../useVehicle.js";

const HISTORY_PAGE = 30;

export const EVENT_TONE_CLASS: Record<EventTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  critical: "bg-destructive/10 text-destructive",
  warning: "bg-warning/15 text-warning-foreground",
  success: "bg-success/15 text-success-foreground",
};

/** Kinds core still gates itself; a module's own kinds come and go with its manifest. */
const KIND_GATE: Partial<Record<VehicleHistoryKind, keyof VehicleGates>> = {
  MONEY: "entries",
  TRIPS: "trips",
  DOCUMENTS: "documents",
  READINGS: "trips",
};

/** The kinds this viewer can ask for: a hidden section's events are never offered. */
export function historyKinds(gates: VehicleGates, enabledModules: readonly ModuleCode[]): VehicleHistoryKind[] {
  return VEHICLE_HISTORY_KINDS.filter((kind) => {
    if (!contributes("historyKinds", kind, enabledModules)) return false;
    const gate = KIND_GATE[kind];
    return gate === undefined || gates[gate];
  });
}

/**
 * Everything recorded on the vehicle, newest first, by day. A read of the
 * audit trail: corrections show as their own events beside the original.
 */
export function HistoryTab() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { kind?: VehicleHistoryKind };
  const { asset, gates, viewer } = useVehicle();
  const kinds = historyKinds(gates, viewer.enabledModules);
  const kind = search.kind !== undefined && kinds.includes(search.kind) ? search.kind : undefined;
  const query = useAssetHistory(asset.id, kind, HISTORY_PAGE);
  const timelineEvent = useTimelineEvent();

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <section className="space-y-5">
      <TabHeader title={t("vehicle.history.title")} description={t("vehicle.history.description")} />
      <FilterChips
        label={t("vehicle.history.filterLabel")}
        options={[
          { key: "ALL", label: t("vehicle.history.filters.ALL") },
          ...kinds.map((candidate) => ({ key: candidate, label: t(`vehicle.history.filters.${candidate}`) })),
        ]}
        value={kind ?? "ALL"}
        onChange={(next) =>
          void navigate({
            to: ".",
            search: (previous: Record<string, unknown>) => ({
              ...previous,
              kind: next === "ALL" ? undefined : next,
            }),
            replace: true,
          })
        }
      />
      {query.isPending ? (
        <LoadingState label={t("vehicle.history.loading")} />
      ) : query.isError ? (
        <ErrorState
          message={t("vehicle.history.loadFailed")}
          retryLabel={t("vehicle.panel.retry")}
          onRetry={() => void query.refetch()}
        />
      ) : items.length === 0 ? (
        <EmptyState icon={<Clock className="size-6" aria-hidden />} message={t("vehicle.history.empty")} />
      ) : (
        <>
          <Card className="gap-0 px-4 py-4">
            <Timeline groupByDay events={items.map((item) => timelineEvent(item))} />
          </Card>
          {query.hasNextPage && (
            <Button
              variant="outline"
              className="desktop:h-9"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              {query.isFetchingNextPage ? t("history.loadingMore") : t("vehicle.history.loadMore")}
            </Button>
          )}
        </>
      )}
    </section>
  );
}

/** An entry's events sit in the ledger; any other amount is a record's own. */
function historySign(item: VehicleHistoryItem): MoneySign {
  const direction = item.params["direction"];
  return direction === "REVENUE" || direction === "EXPENSE"
    ? { context: "ledger", direction }
    : { context: "record" };
}

/** One vehicle event on the shared timeline: its kind's icon, amount and record link. */
function useTimelineEvent(): (item: VehicleHistoryItem) => TimelineEvent {
  const { t, i18n } = useTranslation();
  const { gates, panel } = useVehicle();
  const locale = i18n.language;

  return (item) => {
    const view = describeEvent(item, t, locale, gates);
    const Icon = view.icon;
    const record = view.record;
    return {
      id: item.eventId,
      occurredAt: item.occurredAt,
      actor: item.actor,
      act: <RecordText text={view.title} numbers={[view.titleNumber]} />,
      note: historyNote(item, t),
      marker: (
        <span className={cn("grid size-7 place-items-center rounded-md", EVENT_TONE_CLASS[view.tone])}>
          <Icon className="size-3.5" />
        </span>
      ),
      aside:
        item.amountMinor !== null && gates.entries ? (
          <span className={cn("shrink-0 text-sm tabular-nums", item.amountMinor < 0 && "text-muted-foreground")}>
            {formatMoney(item.amountMinor, {
              currency: item.currency ?? "XAF",
              locale,
              sign: historySign(item),
            })}
          </span>
        ) : undefined,
      detail:
        view.detail === null ? undefined : (
          <p className="mt-0.5 text-sm whitespace-pre-line text-muted-foreground">{view.detail}</p>
        ),
      meta:
        record === null ? undefined : (
          <>
            <Sep />
            <LinkButton onClick={() => panel.openRecord(record)}>{t("vehicle.history.open")}</LinkButton>
          </>
        ),
    };
  };
}
