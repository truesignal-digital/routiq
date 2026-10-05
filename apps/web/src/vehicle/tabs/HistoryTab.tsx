import { useNavigate, useSearch } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Clock } from "lucide-react";
import type { VehicleHistoryItem, VehicleHistoryKind } from "@routiq/contracts";
import { EmptyState, ErrorState, LoadingState } from "@/components/page";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatDayLong, formatMoney, localDayKey } from "@/lib/format.js";
import { cn } from "@/lib/utils";
import { useVehicle, type VehicleGates } from "../context.js";
import { describeEvent, type EventTone } from "../historyEvents.js";
import { FilterChips, LinkButton, Sep, TabHeader } from "../parts.js";
import { useAssetHistory } from "../useVehicle.js";

const HISTORY_PAGE = 30;

export const EVENT_TONE_CLASS: Record<EventTone, string> = {
  neutral: "bg-muted text-muted-foreground",
  critical: "bg-destructive/10 text-destructive",
  warning: "bg-warning/15 text-warning-foreground",
  success: "bg-success/15 text-success-foreground",
};

/** The kinds this viewer can ask for: a hidden section's events are never offered. */
function historyKinds(gates: VehicleGates): VehicleHistoryKind[] {
  const kinds: VehicleHistoryKind[] = [];
  if (gates.maintenance) kinds.push("MAINTENANCE");
  if (gates.entries) kinds.push("MONEY");
  if (gates.trips) kinds.push("TRIPS");
  if (gates.documents) kinds.push("DOCUMENTS");
  if (gates.trips) kinds.push("READINGS");
  kinds.push("ASSIGNMENTS", "LIFECYCLE", "NOTES");
  return kinds;
}

/**
 * Everything recorded on the vehicle, newest first, by day. A read of the
 * audit trail: corrections show as their own events beside the original.
 */
export function HistoryTab() {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { kind?: VehicleHistoryKind };
  const { asset, gates } = useVehicle();
  const kinds = historyKinds(gates);
  const kind = search.kind !== undefined && kinds.includes(search.kind) ? search.kind : undefined;
  const query = useAssetHistory(asset.id, kind, HISTORY_PAGE);
  const locale = i18n.language;

  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  const groups: Array<{ key: string; items: VehicleHistoryItem[] }> = [];
  for (const item of items) {
    const key = localDayKey(item.occurredAt);
    const last = groups[groups.length - 1];
    if (last !== undefined && last.key === key) last.items.push(item);
    else groups.push({ key, items: [item] });
  }
  const today = localDayKey(new Date());
  const yesterday = localDayKey(new Date(Date.now() - 86_400_000));

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
      ) : groups.length === 0 ? (
        <EmptyState icon={<Clock className="size-6" aria-hidden />} message={t("vehicle.history.empty")} />
      ) : (
        <>
          {groups.map((group) => (
            <div key={group.key}>
              <h3 className="mb-2 flex items-baseline gap-2 text-xs font-medium text-muted-foreground">
                <span className="text-foreground">{formatDayLong(`${group.key}T12:00:00`, locale)}</span>
                {group.key === today && <span>{t("history.today")}</span>}
                {group.key === yesterday && <span>{t("history.yesterday")}</span>}
              </h3>
              <Card className="gap-0 py-0">
                <ol className="divide-y">
                  {group.items.map((item) => (
                    <EventRow key={item.eventId} item={item} />
                  ))}
                </ol>
              </Card>
            </div>
          ))}
          {query.hasNextPage && (
            <Button
              variant="outline"
              className="h-9"
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

function EventRow({ item }: { item: VehicleHistoryItem }) {
  const { t, i18n } = useTranslation();
  const { gates, panel } = useVehicle();
  const locale = i18n.language;
  const view = describeEvent(item, t, locale, gates);
  const Icon = view.icon;
  const actor =
    item.actor.scope === "PLATFORM"
      ? t("history.actor.platform")
      : (item.actor.displayName ?? t("history.actor.unknown"));

  return (
    <li className="flex gap-3 px-4 py-3">
      <span className={cn("mt-0.5 grid size-7 shrink-0 place-items-center rounded-md", EVENT_TONE_CLASS[view.tone])}>
        <Icon className="size-3.5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <p className="font-medium leading-snug">{view.title}</p>
          {item.amountMinor !== null && gates.entries && (
            <span className={cn("shrink-0 text-sm tabular-nums", item.amountMinor < 0 && "text-muted-foreground")}>
              {formatMoney(item.amountMinor, {
                currency: item.currency ?? "XAF",
                locale,
                ...(item.amountMinor < 0 || item.params["direction"] === "REVENUE"
                  ? { signDisplay: "exceptZero" as const }
                  : {}),
              })}
            </span>
          )}
        </div>
        {view.detail !== null && <p className="mt-0.5 text-sm whitespace-pre-line text-muted-foreground">{view.detail}</p>}
        {item.note !== null && <p className="mt-0.5 text-sm text-muted-foreground">{item.note}</p>}
        <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-muted-foreground">
          <span>{actor}</span>
          <Sep />
          <time dateTime={item.occurredAt}>
            {new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(item.occurredAt))}
          </time>
          {view.record !== null && (
            <>
              <Sep />
              <LinkButton onClick={() => view.record !== null && panel.openRecord(view.record)}>
                {t("vehicle.history.open")}
              </LinkButton>
            </>
          )}
        </p>
      </div>
    </li>
  );
}
