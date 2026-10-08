import { useId, useState } from "react";
import type { CancelledEntryRef, EntryCancellation, FinancialEntryListItem } from "@routiq/contracts";
import { ChevronDown, Undo2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { RecordText } from "@/components/record-number";
import { StatusBadge } from "@/components/status-badge.js";
import { Button } from "@/components/ui/button";
import { EntryStatusBadge } from "@/finance/EntryStatusBadge.js";
import { formatDate, formatMonth } from "@/lib/format.js";
import { cn } from "@/lib/utils.js";

/** What a money-list line needs to say how a cancellation touches it (#427). */
export interface EventLine {
  status: FinancialEntryListItem["status"];
  cancelledBy?: EntryCancellation | null | undefined;
  cancels?: CancelledEntryRef | null | undefined;
}

/**
 * The cancellation is folded into this line: original and cancellation sit in
 * the same window, so the line counts 0 there.
 */
export function isFolded(entry: { cancelledBy?: EntryCancellation | null | undefined }): boolean {
  return entry.cancelledBy?.folded === true;
}

/** Struck through when the line counts 0; the books still hold both rows. */
export function foldedAmountClass(entry: { cancelledBy?: EntryCancellation | null | undefined }): string {
  return isFolded(entry) ? "text-muted-foreground line-through" : "";
}

/**
 * A trip's rows as one line per event: a cancellation drops out when the
 * original it cancels is a line here and names it. Sums stay on the raw rows.
 */
export function foldTripEntries<
  T extends { entryId: string; reversesEntryId: string | null; cancelledBy: EntryCancellation | null },
>(entries: readonly T[]): T[] {
  const foldedIds = new Set(
    entries.flatMap((entry) => (entry.cancelledBy?.folded ? [entry.cancelledBy.entryId] : [])),
  );
  return entries.filter((entry) => entry.reversesEntryId === null || !foldedIds.has(entry.entryId));
}

/**
 * The status of a money-list line: a folded cancellation behind a disclosure,
 * a later month's cancellation by its month, a cancellation's own line by the
 * entry it cancels. Anything else is its plain status.
 */
export function EntryEventStatus({ entry }: { entry: EventLine }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  if (entry.cancels != null) {
    const { entryNumber, postingPeriodCode } = entry.cancels;
    const text =
      postingPeriodCode === null
        ? t("finance.entries.events.cancellationOfEntry", { number: entryNumber })
        : t("finance.entries.events.cancellationOf", {
            number: entryNumber,
            month: formatMonth(postingPeriodCode, locale),
          });
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusBadge tone="neutral" icon={Undo2}>
          {t("finance.entries.events.cancellationBadge")}
        </StatusBadge>
        <span className="text-xs text-muted-foreground">
          <RecordText text={text} numbers={[entryNumber]} />
        </span>
      </span>
    );
  }

  const cancellation = entry.cancelledBy ?? null;
  if (cancellation !== null && !cancellation.folded) {
    return (
      <StatusBadge tone="neutral" icon={Undo2}>
        {t("finance.entries.events.cancelledIn", {
          month: formatMonth(cancellation.postingPeriodCode, locale),
        })}
      </StatusBadge>
    );
  }

  return (
    <span className="flex flex-col items-start gap-1">
      <EntryStatusBadge status={entry.status} />
      {cancellation !== null && <CancellationDetails cancellation={cancellation} />}
    </span>
  );
}

/** Who cancelled, when and why, folded under the original's line until asked for. */
export function CancellationDetails({
  cancellation,
  className,
}: {
  cancellation: EntryCancellation;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const locale = i18n.language;
  const date = formatDate(cancellation.postedAt, locale);
  const name = cancellation.recordedBy.displayName;
  const reason =
    cancellation.reasonCode !== null && cancellation.reasonCode !== "OTHER"
      ? t(`reasonCodes.${cancellation.reasonCode}`, { defaultValue: cancellation.reasonText ?? "" })
      : cancellation.reasonText;
  const number = cancellation.entryNumber;

  return (
    <div className={cn("text-xs", className)}>
      <Button
        type="button"
        variant="ghost"
        size="desktop-sm"
        className="-ml-2 font-normal text-muted-foreground"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={(event) => {
          // Rows that open their record on click must not open it here.
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        {t(open ? "finance.entries.events.hideCancellation" : "finance.entries.events.showCancellation")}
        <ChevronDown aria-hidden className={cn("transition-transform", open && "rotate-180")} />
      </Button>
      {open && (
        <div id={regionId} className="mt-1 space-y-0.5 border-l-2 pl-2 text-muted-foreground">
          <p className="font-medium text-foreground">
            <RecordText text={t("finance.entries.events.cancellationEntry", { number })} numbers={[number]} />
          </p>
          <p>
            {name === null
              ? t("finance.entries.events.cancelledOn", { date })
              : t("finance.entries.events.cancelledByOn", { name, date })}
          </p>
          {reason !== null && reason !== "" && <p>{t("finance.entries.events.reason", { reason })}</p>}
          <p>{t("finance.entries.events.countsZero")}</p>
        </div>
      )}
    </div>
  );
}
