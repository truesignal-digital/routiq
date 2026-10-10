import type { ReactNode } from "react";
import type { OverviewNotice } from "@routiq/contracts";
import { CalendarDays, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMeContext } from "@/auth/me.js";
import { Button } from "@/components/ui/button";
import { formatPercent } from "@/lib/format.js";
import { summaryStorageKey, useSummaryNotice } from "./summary-notice.js";

type Translate = ReturnType<typeof useTranslation>["t"];

export interface ExpensesUpWords {
  window: "soFar" | "lastMonth";
  comparisonMonth: string;
}

export interface OverviewSummaryProps {
  /** Which Overview: each keeps its own close. */
  page: string;
  /** From the page's read; undefined while it loads. */
  notice: OverviewNotice | undefined;
  /** The summary's one sentence, whole; undefined while it loads. */
  sentence: string | undefined;
  /** More whole sentences: the reason for the change, a pace. */
  details?: readonly string[] | undefined;
  /** A verdict beside the sentence, as its domain badge renders it. */
  badge?: ReactNode;
  /** What the figures count and leave out; stays under the tiles when the summary is closed. */
  counted: ReactNode;
  /**
   * The money pages name "expenses up" as a change, against the summary's own
   * comparison; the other Overviews never see it.
   */
  expensesUp?: ExpensesUpWords | undefined;
  /** The tiles: the summary sits above them, the counted line below them when it is closed. */
  children: ReactNode;
}

function formatDay(iso: string, language: string | undefined, weekday: boolean): string {
  return new Intl.DateTimeFormat(language, {
    ...(weekday ? { weekday: "long" as const } : {}),
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${iso.slice(0, 10)}T00:00:00Z`));
}

/** One sentence per kind of big change, each whole (no stitched phrases). */
export function noticeChangeSentences(
  notice: OverviewNotice,
  t: Translate,
  language: string | undefined,
  expensesUp: ExpensesUpWords | undefined,
): string[] {
  const sentences: string[] = [];
  const grounded = notice.changes.flatMap((change) => (change.kind === "VEHICLE_GROUNDED" ? [change] : []));
  const [first] = grounded;
  if (first !== undefined) {
    sentences.push(
      grounded.length === 1
        ? t("overview.summary.change.groundedOne", { code: first.assetCode, date: formatDay(first.since, language, false) })
        : t("overview.summary.change.groundedMany", {
            count: grounded.length,
            codes: new Intl.ListFormat(language, { type: "conjunction" }).format(grounded.map((change) => change.assetCode)),
          }),
    );
  }
  const up = notice.changes.find((change) => change.kind === "EXPENSES_UP");
  if (up !== undefined && expensesUp !== undefined) {
    sentences.push(t("overview.summary.change.expensesUp", { ...expensesUp, percent: formatPercent(up.percent, language) }));
  }
  return sentences;
}

/**
 * The summary notice on every Overview (#667, dashboards.html#rule): one
 * sentence on the schedule (Mondays, the 1st) and when something big changes,
 * closable by each person until the next one. Closed or not due, the tiles
 * come first and the counted line sits under them with "Show summary", so the
 * warning about missing data never disappears.
 */
export function OverviewSummary({
  page,
  notice,
  sentence,
  details = [],
  badge,
  counted,
  expensesUp,
  children,
}: OverviewSummaryProps) {
  const { t, i18n } = useTranslation();
  const me = useMeContext();
  const storageKey = me === undefined ? undefined : summaryStorageKey(me.workspaceId, me.principalId, page);
  const state = useSummaryNotice(notice, storageKey);
  const language = i18n.resolvedLanguage;
  const ready = notice !== undefined && sentence !== undefined;

  if (!ready || !state.open) {
    return (
      <>
        {children}
        {(counted !== null && counted !== undefined) || ready ? (
          <div
            data-slot="overview-counted"
            data-summary="closed"
            className="-mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
          >
            {counted}
            {ready && (
              <Button
                variant="link"
                size="desktop-sm"
                className="px-0 text-xs font-semibold text-foreground"
                onClick={state.show}
              >
                {t("overview.summary.show")}
              </Button>
            )}
          </div>
        ) : null}
      </>
    );
  }

  const lines = [
    ...details,
    ...noticeChangeSentences(notice, t, language, expensesUp),
  ];
  return (
    <>
      <section
        data-slot="overview-summary"
        data-reason={state.reason ?? "ASKED"}
        aria-label={t("overview.summary.label")}
        className="relative flex flex-col gap-2 rounded-xl border bg-card p-4 pr-14 text-card-foreground"
      >
        <p data-slot="overview-summary-when" className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          <CalendarDays aria-hidden="true" className="size-3.5" />
          {t("overview.summary.when", {
            reason: state.reason ?? "ASKED",
            date: formatDay(notice.today, language, true),
          })}
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <p data-slot="overview-summary-sentence" className="max-w-3xl font-heading text-base leading-snug font-semibold sm:text-lg">
            {sentence}
          </p>
          {badge}
        </div>
        {lines.length > 0 && (
          <p data-slot="overview-summary-details" className="text-sm text-muted-foreground">
            {lines.join(" ")}
          </p>
        )}
        {counted !== null && counted !== undefined && (
          <div
            data-slot="overview-counted"
            data-summary="open"
            className="mt-1 border-t border-dashed pt-2 text-xs text-muted-foreground"
          >
            {counted}
          </div>
        )}
        <Button
          variant="ghost"
          size="desktop-icon-sm"
          className="absolute top-2 right-2 text-muted-foreground"
          aria-label={t("overview.summary.closeLabel")}
          onClick={state.close}
        >
          <X aria-hidden="true" />
        </Button>
      </section>
      {children}
    </>
  );
}
