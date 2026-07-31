import type { HistoryEntityType, HistoryItem } from "@routiq/contracts";
import { History } from "lucide-react";
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
import { useHistory } from "@/history/useHistory.js";
import { formatDateTime, formatRelativeTime } from "@/lib/format.js";
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
                <HistoryRow key={item.eventId} item={item} locale={locale} />
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

function HistoryRow({ item, locale }: { item: HistoryItem; locale: string }) {
  const { t } = useTranslation();

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
    </li>
  );
}
