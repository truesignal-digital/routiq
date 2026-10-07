import { ledgerEntryStatuses, type ActivityDetail, type MoneyReadScope } from "@routiq/contracts";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CancellationDetails, foldedAmountClass, foldTripEntries } from "@/finance/EntryCancellation.js";
import { EntryStatusBadge } from "@/finance/EntryStatusBadge.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { formatMoney, localizedLabel } from "@/lib/format.js";
import { cn } from "@/lib/utils.js";

type Entry = NonNullable<ActivityDetail["financialEntries"]>[number];

/** Direction carries the sign: the read stores magnitudes, the reader needs a balance. */
function signedMinor(entry: Entry): number {
  return entry.direction === "REVENUE" ? entry.amountMinor : -entry.amountMinor;
}

const IN_THE_BOOKS: ReadonlySet<Entry["status"]> = new Set(ledgerEntryStatuses);

/**
 * §3.4: only posted lines are money in the books. A net that quietly folded in
 * lines still awaiting an approver would be a number nobody could reconcile,
 * so pending amounts are totalled separately and never merged in. A reversed
 * entry stays in the books beside its negative reversal, so the pair nets to
 * zero only when both count (#60).
 */
export function postedNetMinor(entries: readonly Entry[]): number {
  return entries.reduce(
    (total, entry) => (IN_THE_BOOKS.has(entry.status) ? total + signedMinor(entry) : total),
    0,
  );
}

export function pendingNetMinor(entries: readonly Entry[]): number {
  return entries.reduce(
    (total, entry) => (entry.status === "SUBMITTED" ? total + signedMinor(entry) : total),
    0,
  );
}

export function netToneClass(minor: number): string {
  if (minor < 0) return "text-destructive";
  if (minor > 0) return "text-success-foreground";
  return "";
}

export interface ActivityMoneyProps {
  entries: readonly Entry[];
  /**
   * Whether `entries` is the trip's whole money. False outside the ledger
   * (#264): no net is summed over a part.
   */
  totals: boolean;
  /** Which slice of the trip's entries the server sent, to say so (#408). */
  scope: MoneyReadScope | undefined;
}

export function ActivityMoney({ entries, totals, scope }: ActivityMoneyProps) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;

  if (entries.length === 0) return null;

  const postedNet = postedNetMinor(entries);
  const pendingNet = pendingNetMinor(entries);
  const hasPending = entries.some((entry) => entry.status === "SUBMITTED");
  // One line per event (#427); the sums above stay on every signed row.
  const lines = foldTripEntries(entries);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("activities.detail.money")}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-1">
          {lines.map((entry) => (
            <li key={entry.entryId}>
              <Link
                to="/finance/entries/$entryId"
                params={{ entryId: entry.entryId }}
                className="flex min-h-11 flex-wrap items-center justify-between gap-2 rounded-lg px-2 py-2 text-sm transition hover:bg-foreground/[0.04]"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <span className="font-mono">{entry.entryNumber}</span>
                  <span className="text-muted-foreground">
                    {localizedLabel(
                      { labelFr: entry.categoryLabelFr, labelEn: entry.categoryLabelEn },
                      locale,
                    )}
                  </span>
                  {/* A line still awaiting approval is the one thing a reader
                      must not mistake for money already in the books. */}
                  <EntryStatusBadge status={entry.status} />
                </span>
                <span className={cn("tabular-nums", foldedAmountClass(entry))}>
                  {formatMoney(entry.amountMinor, {
                    locale,
                    sign: { context: "ledger", direction: entry.direction },
                  })}
                </span>
              </Link>
              {entry.cancelledBy !== null && (
                <CancellationDetails cancellation={entry.cancelledBy} className="px-2" />
              )}
            </li>
          ))}
        </ul>

        {(scope === "OWN_ENTRIES" || scope === "BRANCH_ENTRIES") && (
          <p className="mt-3 text-muted-foreground text-xs">
            {t(
              scope === "OWN_ENTRIES"
                ? "activities.detail.moneySummary.ownOnly"
                : "activities.detail.moneySummary.branchOnly",
            )}
          </p>
        )}

        {totals && (
        <>
        <Separator className="my-4" />

        <dl className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <dt className="text-sm font-medium">
              <span>{t("activities.detail.moneySummary.net")}</span>
              <span className="ml-2 text-muted-foreground text-xs uppercase tracking-wide">
                {t("activities.detail.moneySummary.postedOnly")}
              </span>
            </dt>
            <dd
              className={cn(
                "text-lg font-semibold tabular-nums tracking-[-0.02em]",
                netToneClass(postedNet),
              )}
            >
              {formatMoney(postedNet, { locale, sign: { context: "net" } })}
            </dd>
          </div>

          {hasPending && (
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <dt className="text-sm text-muted-foreground">
                {t("activities.detail.moneySummary.pending")}
              </dt>
              <dd className="text-sm tabular-nums text-muted-foreground">
                {formatMoney(pendingNet, { locale, sign: { context: "net" } })}
              </dd>
            </div>
          )}
        </dl>

        {hasPending && (
          <p className="mt-2 text-muted-foreground text-xs">
            {t("activities.detail.moneySummary.pendingHint")}
          </p>
        )}
        </>
        )}
      </CardContent>
    </Card>
  );
}
