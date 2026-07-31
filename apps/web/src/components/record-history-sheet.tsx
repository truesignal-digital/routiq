import type {
  HistoryEntityType,
  HistoryFieldChange,
  HistoryItem,
} from "@routiq/contracts";
import { ChevronDown, History } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorState, LoadingState } from "@/components/page";
import { StatusBadge } from "@/components/status-badge.js";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { useHistory, useHistoryEvent } from "@/history/useHistory.js";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatRelativeTime,
} from "@/lib/format.js";
import { cn } from "@/lib/utils.js";

/**
 * The event vocabulary is open — new commands add codes without touching this
 * file — so the label is a lookup with the raw code as its own fallback. i18next
 * reads "." as a key separator, hence the dashes.
 */
export function historyEventLabelKey(eventType: string): string {
  return `history.event.${eventType.split(".").join("-")}`;
}

/**
 * Bookkeeping columns every write touches. They are true, they are in the audit
 * row, and they tell an operator nothing about what happened — so they stay out
 * of the chips instead of burying the fields that matter.
 */
const PLUMBING_FIELDS = new Set([
  "id",
  "workspaceId",
  "rowVersion",
  "outgoingRowVersion",
  "createdByCommandId",
  "updatedByCommandId",
  "lockedByCommandId",
]);

export interface RecordHistorySheetProps {
  entityType: HistoryEntityType;
  entityId: string;
  className?: string;
}

/**
 * Who did what to this record, from the audit trail the write path already
 * keeps. One component for every record type: a bottom sheet on a phone, a side
 * drawer on a desktop, and no fetch at all until it is opened.
 */
export function RecordHistorySheet({
  entityType,
  entityId,
  className,
}: RecordHistorySheetProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();
  const historyQuery = useHistory(entityType, entityId, { enabled: open });

  const locale = i18n.language;
  const items = historyQuery.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="outline" className={cn("min-h-9", className)} />}
      >
        <History className="size-4" aria-hidden />
        {t("history.action")}
      </SheetTrigger>

      <SheetContent
        side={isMobile ? "bottom" : "right"}
        className={cn("gap-0", isMobile && "max-h-[85vh]")}
      >
        <SheetHeader>
          <SheetTitle>{t("history.title")}</SheetTitle>
        </SheetHeader>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6">
          {historyQuery.isPending ? (
            <LoadingState label={t("history.loading")} rows={3} />
          ) : historyQuery.isError ? (
            <ErrorState
              message={t("history.loadFailed")}
              retryLabel={t("history.retry")}
              onRetry={() => void historyQuery.refetch()}
            />
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("history.empty")}</p>
          ) : (
            <ol className="flex flex-col">
              {items.map((item) => (
                <HistoryRow
                  key={item.eventId}
                  item={item}
                  entityType={entityType}
                  entityId={entityId}
                  locale={locale}
                />
              ))}
            </ol>
          )}

          {historyQuery.hasNextPage === true && (
            <Button
              variant="outline"
              className="min-h-11 w-full"
              disabled={historyQuery.isFetchingNextPage}
              onClick={() => void historyQuery.fetchNextPage()}
            >
              {historyQuery.isFetchingNextPage
                ? t("history.loadingMore")
                : t("history.loadMore")}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function HistoryRow({
  item,
  entityType,
  entityId,
  locale,
}: {
  item: HistoryItem;
  entityType: HistoryEntityType;
  entityId: string;
  locale: string;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  const isPlatform = item.actor.scope === "PLATFORM";
  const actorLabel = isPlatform
    ? t("history.actor.platform")
    : (item.actor.displayName ?? t("history.actor.unknown"));
  const changedFields = item.changedFields.filter(
    (field) => !PLUMBING_FIELDS.has(field),
  );

  return (
    <li className="relative border-l border-border pb-5 pl-4 last:pb-0">
      <span
        className="absolute -left-[3.5px] top-1.5 size-1.5 rounded-full bg-foreground/30"
        aria-hidden
      />

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">
          {t(historyEventLabelKey(item.eventType), { defaultValue: item.eventType })}
        </span>
        {/* Plain web is the norm and needs no label; anything else changes how
            much the line can be trusted, so it is stamped. */}
        {item.command.origin !== "HUMAN_UI" && (
          <StatusBadge tone="info" icon={null}>
            {t(`history.origin.${item.command.origin}`, {
              defaultValue: item.command.origin,
            })}
          </StatusBadge>
        )}
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
        <span
          className={cn(
            isPlatform &&
              "rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary",
          )}
        >
          {actorLabel}
        </span>
        <time dateTime={item.occurredAt} className="tabular-nums">
          {formatDateTime(item.occurredAt, locale)}
        </time>
        <span className="text-muted-foreground/70">
          {formatRelativeTime(item.occurredAt, locale)}
        </span>
      </div>

      {item.note !== null && item.note !== "" && (
        <p className="mt-1 text-xs text-muted-foreground">{item.note}</p>
      )}

      {changedFields.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1">
          {changedFields.map((field) => (
            <li
              key={field}
              className="rounded-full bg-foreground/[0.055] px-2 py-0.5 text-[0.7rem] text-muted-foreground"
            >
              {t(`history.field.${field}`, { defaultValue: field })}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        className="mt-1.5 -ml-1 flex min-h-8 items-center gap-1 rounded-md px-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ChevronDown
          className={cn("size-3.5 transition-transform", expanded && "rotate-180")}
          aria-hidden
        />
        {t(expanded ? "history.diff.hide" : "history.diff.show")}
      </button>

      {expanded && (
        <HistoryDiff
          entityType={entityType}
          entityId={entityId}
          eventId={item.eventId}
          locale={locale}
        />
      )}
    </li>
  );
}

/**
 * The before/after of one event. Mounted only once its row is expanded, so the
 * fetch is the reader's choice — the timeline itself stays one request.
 */
function HistoryDiff({
  entityType,
  entityId,
  eventId,
  locale,
}: {
  entityType: HistoryEntityType;
  entityId: string;
  eventId: string;
  locale: string;
}) {
  const { t } = useTranslation();
  const diffQuery = useHistoryEvent(entityType, entityId, eventId, {
    enabled: true,
  });

  if (diffQuery.isPending) {
    return (
      <LoadingState
        label={t("history.diff.loading")}
        rows={2}
        className="mt-1.5 gap-1.5"
        rowClassName="h-6 rounded-md"
      />
    );
  }
  if (diffQuery.isError) {
    return (
      <ErrorState
        message={t("history.diff.loadFailed")}
        retryLabel={t("history.retry")}
        onRetry={() => void diffQuery.refetch()}
        className="mt-1.5 rounded-md px-3 py-4"
      />
    );
  }

  const { changes, currency } = diffQuery.data;
  if (changes.length === 0) {
    return (
      <p className="mt-1.5 text-xs text-muted-foreground">
        {t("history.diff.empty")}
      </p>
    );
  }

  return (
    <dl className="mt-1.5 flex flex-col gap-1.5 rounded-md bg-foreground/[0.035] px-3 py-2">
      {changes.map((change) => (
        <div key={change.field} className="flex flex-col gap-0.5">
          <dt className="text-[0.7rem] uppercase tracking-wide text-muted-foreground">
            {t(`history.field.${change.field}`, { defaultValue: change.field })}
          </dt>
          <dd className="flex flex-wrap items-baseline gap-1.5 text-xs">
            <span className="text-muted-foreground">
              {formatChangeValue(change, "before", currency, locale, t)}
            </span>
            <span aria-hidden className="text-muted-foreground/60">
              →
            </span>
            <span className="font-medium">
              {formatChangeValue(change, "after", currency, locale, t)}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** ISO-8601 dates and timestamps, which is the only string shape we reinterpret. */
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * Money goes through the money formatter — minor units, never divided. Anything
 * else renders as it was recorded, because guessing at an unknown field's
 * meaning is how a timeline starts lying.
 */
function formatChangeValue(
  change: HistoryFieldChange,
  side: "before" | "after",
  currency: string,
  locale: string,
  t: (key: string) => string,
): string {
  const value = change[side];

  if (value === null || value === undefined) return t("history.diff.none");
  if (change.kind === "MONEY" && typeof value === "number") {
    return formatMoney(value, { currency, locale });
  }
  if (typeof value === "boolean") {
    return t(value ? "history.diff.yes" : "history.diff.no");
  }
  if (typeof value === "string") {
    if (value === "") return t("history.diff.none");
    if (!ISO_DATE_TIME.test(value)) return value;
    return value.length === 10
      ? formatDate(value, locale)
      : formatDateTime(value, locale);
  }
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}
