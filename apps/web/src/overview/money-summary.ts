import type { FinanceOverviewResponse, MoneySummary } from "@routiq/contracts";
import type { useTranslation } from "react-i18next";
import { formatMoney, formatPercent, localizedLabel } from "@/lib/format.js";

type Translate = ReturnType<typeof useTranslation>["t"];

/** "October": the month alone, as a sentence names it. */
export function monthName(isoDate: string, language: string | undefined): string {
  return new Intl.DateTimeFormat(language, { month: "long", timeZone: "UTC" }).format(
    new Date(`${isoDate.slice(0, 10)}T00:00:00Z`),
  );
}

export interface MoneySummaryText {
  sentence: string;
  details: string[];
  badge: { template: MoneySummary["template"]; label: string };
  /** Named as a change only when the sentence is about profit; an expenses sentence already says it. */
  expensesUp: { window: "soFar" | "lastMonth"; comparisonMonth: string } | undefined;
}


/**
 * The money summary in words (#667): the server picked the template and its
 * numbers; each template is one whole ICU sentence in fr-CM and en. Profit
 * moves in money ("100 000 XAF worse"); expenses move in percent, or in money
 * when the change rounds to no percent (dashboards.html, comparison rules).
 */
export function moneySummaryText(
  overview: Pick<FinanceOverviewResponse, "summary" | "currency">,
  t: Translate,
  language: string | undefined,
): MoneySummaryText {
  const { summary, currency } = overview;
  const money = (minor: number) => formatMoney(minor, { currency, ...(language === undefined ? {} : { locale: language }) });
  const month = monthName(summary.period.from, language);
  const comparisonMonth = monthName(summary.comparison.from, language);
  const window: "soFar" | "lastMonth" = summary.window === "LAST_MONTH" ? "lastMonth" : "soFar";
  const change = Math.abs(summary.currentMinor - summary.comparisonMinor);
  const values = {
    window,
    month,
    comparisonMonth,
    amount: money(Math.abs(summary.currentMinor)),
    result: summary.currentMinor < 0 ? "loss" : "profit",
    revenue: money(summary.revenueMinor ?? 0),
    change:
      summary.measure === "EXPENSES" && summary.changePercent !== null && summary.changePercent > 0
        ? formatPercent(summary.changePercent, language)
        : money(change),
  };

  const sentence =
    summary.template !== "NOT_ENOUGH_DATA"
      ? t(`overview.summary.money.${summary.measure === "PROFIT" ? "profit" : "expenses"}.${summary.template}`, values)
      : summary.shortOf === "CLOSED_TRIPS"
        ? t("overview.summary.money.notEnoughTrips", {
            window,
            month,
            closed: summary.trips?.closed ?? 0,
            total: (summary.trips?.closed ?? 0) + (summary.trips?.open ?? 0),
          })
        : t("overview.summary.money.notEnoughEntries", { window, month });

  const details: string[] = [];
  const { reason } = summary;
  if (reason !== null) {
    const direction = reason.changeMinor > 0 ? "up" : "down";
    const amount = money(Math.abs(reason.changeMinor));
    details.push(
      reason.category === null
        ? t("overview.summary.money.reasonRevenue", { direction, amount })
        : t("overview.summary.money.reasonCategory", {
            direction,
            amount,
            category: localizedLabel(reason.category, language),
          }),
    );
  }

  return {
    sentence,
    details,
    expensesUp: summary.measure === "PROFIT" ? { window, comparisonMonth } : undefined,
    badge: {
      label: t(`overview.summary.money.badge.${summary.template}`, { comparisonMonth }),
      template: summary.template,
    },
  };
}
