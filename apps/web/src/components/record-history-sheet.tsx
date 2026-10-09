import type {
  HistoryCodeSet,
  HistoryDiffChange,
  HistoryEntityType,
  HistoryItem,
  HistoryName,
} from "@routiq/contracts";
import { ChevronDown, History } from "lucide-react";
import { useState } from "react";
import type { TFunction } from "i18next";
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
import { HISTORY_CODE_LABEL_KEY } from "@/history/code-labels.js";
import { useHistory, useHistoryEvent } from "@/history/useHistory.js";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  notRecorded,
} from "@/lib/format.js";
import { cn } from "@/lib/utils.js";
import { historyNote, Timeline, timelineAct } from "@/components/timeline.js";

/**
 * Bookkeeping columns every write touches: the row's own identity, the version
 * counter, the command-id provenance columns and the insert/update timestamps.
 * Read off the `changedFields` the write path actually sends — the
 * `appendAuditEvent` call sites under `apps/api/src/commands` — rather than
 * guessed at. They are true, they are in the audit row, and they tell an
 * operator nothing about what happened, so they stay out of the chips and an
 * event left with nothing else drops out of the default view.
 */
export const BOOKKEEPING_FIELDS = new Set([
  "id",
  "workspaceId",
  "rowVersion",
  "outgoingRowVersion",
  "createdByCommandId",
  "updatedByCommandId",
  "lockedByCommandId",
  "createdAt",
  "updatedAt",
]);

/**
 * Actions whose entire content is the field list they carry. Strip the
 * bookkeeping out of one of those and nothing is left to report, so the default
 * view drops it. Every other action — created, closed, approved, provisioned,
 * and whatever a future command invents — names a step that stands on its own
 * and always shows: the vocabulary is open, so hiding is only ever a decision
 * about codes this file already recognises.
 */
const FIELD_EDIT_ACTIONS = ["updated", "relabeled", "corrected"];

/** "activity.closed" → "closed"; "member.role-updated" → "role-updated". */
function eventAction(eventType: string): string {
  const dot = eventType.indexOf(".");
  return dot === -1 ? eventType : eventType.slice(dot + 1);
}

export function isLifecycleEvent(eventType: string): boolean {
  const action = eventAction(eventType);
  return !FIELD_EDIT_ACTIONS.some(
    (verb) =>
      action === verb ||
      action.endsWith(`-${verb}`) ||
      action.endsWith(`_${verb}`),
  );
}

/**
 * The member credential and the lockout state guarding it, read off the
 * set-member-pin call site in `apps/api/src/commands/members.ts`. That a PIN
 * was reset is news an operator should see, so the event keeps its place in the
 * timeline — but naming the columns it touched adds nothing and puts the word
 * "pinHash" in front of everyone who opens the sheet.
 */
const CREDENTIAL_FIELDS = new Set(["pinHash", "failedAttempts", "lockedUntil"]);

/**
 * Defence in depth for credential columns a later command introduces. Whole
 * name segments, never substrings: that catches "pinHash" and a future
 * "passwordHash" or "apiSecret" while leaving "shipping", "grouping" and
 * "lockedAt" alone. The field vocabulary is open by design, and a chip that
 * quietly disappears takes real information out of the timeline with it —
 * "lockedAt" is when a posting period was locked, which is core domain news.
 */
const CREDENTIAL_SEGMENTS = new Set([
  "pin",
  "password",
  "secret",
  "hash",
  "salt",
  "token",
]);

function isCredentialField(field: string): boolean {
  if (CREDENTIAL_FIELDS.has(field)) return true;
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .some((segment) => CREDENTIAL_SEGMENTS.has(segment.toLowerCase()));
}

/**
 * What decides whether a row is worth showing — bookkeeping only, deliberately
 * blind to credentials. An event that touched nothing but a PIN still moved
 * something real, so it stays visible and simply renders without chips.
 */
function dataFields(changedFields: readonly string[]): string[] {
  return changedFields.filter((field) => !BOOKKEEPING_FIELDS.has(field));
}

/** What is worth naming on the row: the data fields, minus the unspeakable. */
function chipFields(changedFields: readonly string[]): string[] {
  return dataFields(changedFields).filter((field) => !isCredentialField(field));
}

/** A row earns its place if data moved, or if its type alone is the news. */
function isDataChange(item: HistoryItem): boolean {
  return dataFields(item.changedFields).length > 0 || isLifecycleEvent(item.eventType);
}

export interface RecordHistorySheetProps {
  entityType: HistoryEntityType;
  entityId: string;
  className?: string;
}

/**
 * Who did what to this record, from the audit trail the write path already
 * keeps. One component for every record type: a bottom sheet on a phone, a side
 * drawer on a desktop, and no fetch at all until it is opened.
 *
 * It opens on the data changes only. Every write emits an event and many of
 * them move a version counter and nothing else, so the unfiltered feed buries
 * the handful of lines an operator came to read; the full trail stays one
 * button away and is never the thing you land on.
 */
export function RecordHistorySheet({
  entityType,
  entityId,
  className,
}: RecordHistorySheetProps) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const isMobile = useIsMobile();
  const historyQuery = useHistory(entityType, entityId, { enabled: open });

  const locale = i18n.language;
  const items = historyQuery.data?.pages.flatMap((page) => page.items) ?? [];
  const shown = showAll ? items : items.filter(isDataChange);

  return (
    <Sheet
      open={open}
      onOpenChange={(next: boolean) => {
        setOpen(next);
        // Someone who asked for the full trail asked it of that record, not of
        // the next one they open.
        if (next) setShowAll(false);
      }}
    >
      <SheetTrigger
        render={<Button variant="outline" className={className} />}
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
            <>
              <div className="flex justify-end">
                <Button
                  variant="ghost"
                  size="desktop-sm"
                  aria-pressed={showAll}
                  onClick={() => setShowAll((value) => !value)}
                  className="aria-pressed:bg-muted aria-pressed:text-foreground"
                >
                  {t("history.showAll")}
                </Button>
              </div>

              {shown.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {t("history.emptyChanges")}
                </p>
              ) : (
                <Timeline
                  groupByDay
                  events={shown.map((item) => ({
                    id: item.eventId,
                    occurredAt: item.occurredAt,
                    actor: item.actor,
                    act: timelineAct(item.eventType, t),
                    note: historyNote(item, t),
                    // Plain web is the norm and needs no label; anything else
                    // changes how much the line can be trusted, so it is stamped.
                    aside:
                      item.command.origin === "HUMAN_UI" ? undefined : (
                        <StatusBadge tone="info" icon={null}>
                          {t(`history.origin.${item.command.origin}`, {
                            defaultValue: item.command.origin,
                          })}
                        </StatusBadge>
                      ),
                    children: (
                      <HistoryRowChanges
                        item={item}
                        entityType={entityType}
                        entityId={entityId}
                        locale={locale}
                      />
                    ),
                  }))}
                />
              )}
            </>
          )}

          {historyQuery.hasNextPage === true && (
            <Button
              variant="outline"
              className="w-full"
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

/** The changed-field chips and the before/after toggle under one event. */
function HistoryRowChanges({
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
  const changedFields = chipFields(item.changedFields);

  return (
    <>
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
        className="mt-1.5 -ml-1 flex min-h-11 items-center gap-1 rounded-md px-1 text-xs text-muted-foreground hover:text-foreground"
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
    </>
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
          <dt className="text-[0.7rem] text-muted-foreground">
            {t(`history.field.${change.field}`, { defaultValue: change.field })}
          </dt>
          {/* The field changed, but its value cannot be shown: say so rather
              than hide the change or invent a before/after. */}
          {change.kind === "UNAVAILABLE" ? (
            <dd className="text-xs italic text-muted-foreground">
              {t("history.diff.unavailable")}
            </dd>
          ) : (
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
          )}
        </div>
      ))}
    </dl>
  );
}

/** ISO-8601 dates and timestamps, which is the only string shape we reinterpret. */
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * One side of a change, in words. The server has already resolved ids to
 * names and tagged every code with its set (#110, #119), so each kind has one
 * way to read: codes through the labels the rest of the app uses for them,
 * money through the money formatter (minor units, never divided), and free
 * values as they were recorded — guessing at an unknown field's meaning is how
 * a timeline starts lying.
 */
function formatChangeValue(
  change: Exclude<HistoryDiffChange, { kind: "UNAVAILABLE" }>,
  side: "before" | "after",
  currency: string,
  locale: string,
  t: TFunction,
): string {
  const none = notRecorded(locale);
  const list = (items: string[]) =>
    items.length === 0
      ? none
      : new Intl.ListFormat(locale, { type: "unit", style: "short" }).format(items);
  const name = ({ fr, en }: HistoryName) => (locale.startsWith("en") ? en : fr);
  const codeLabel = (codeSet: HistoryCodeSet, code: string) =>
    t(HISTORY_CODE_LABEL_KEY[codeSet](code));

  switch (change.kind) {
    case "MONEY": {
      const value = change[side];
      return value === null ? none : formatMoney(value, { currency, locale });
    }
    case "CODE": {
      const value = change[side];
      return value === null ? none : codeLabel(change.codeSet, value);
    }
    case "CODES": {
      const value = change[side];
      return value === null
        ? none
        : list(value.map((code) => codeLabel(change.codeSet, code)));
    }
    case "NAME": {
      const value = change[side];
      return value === null ? none : name(value);
    }
    case "NAMES": {
      const value = change[side];
      return value === null ? none : list(value.map(name));
    }
    case "COUNT": {
      const value = change[side];
      return value === null ? none : String(value);
    }
    case "LINES": {
      const value = change[side];
      if (value === null) return none;
      return value.totalMinor === null
        ? t("history.diff.linesCount", { count: value.count })
        : t("history.diff.lines", {
            count: value.count,
            total: formatMoney(value.totalMinor, { currency, locale }),
          });
    }
    case "VALUE": {
      const value = change[side];
      if (value === null || value === "") return none;
      if (typeof value === "boolean") {
        return t(value ? "history.diff.yes" : "history.diff.no");
      }
      if (typeof value === "number") return String(value);
      if (!ISO_DATE_TIME.test(value)) return value;
      return value.length === 10
        ? formatDate(value, locale)
        : formatDateTime(value, locale);
    }
  }
}
