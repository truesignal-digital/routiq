import type { FinanceSummaryResponse } from "@routiq/contracts";
import type { TFunction } from "i18next";

/** Past this many, the lead counts the unlocked months instead of naming each. */
const NAMED_UNLOCKED_MAX = 3;

/**
 * "octobre" / "October", with the year only outside the workspace's current
 * year: `currentMonth` is the server's month, never the device's (#639).
 */
export function moneyMonthName(
  code: string,
  { locale, currentMonth, capitalize = false }: { locale: string | undefined; currentMonth: string; capitalize?: boolean },
): string {
  const name = new Intl.DateTimeFormat(locale, {
    month: "long",
    ...(code.slice(0, 4) === currentMonth.slice(0, 4) ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(new Date(`${code}-01T00:00:00Z`));
  return capitalize ? capitalizeFirst(name, locale) : name;
}

function capitalizeFirst(text: string, locale: string | undefined): string {
  return text.charAt(0).toLocaleUpperCase(locale) + text.slice(1);
}

/**
 * The Money page's lead (#526): what the page holds, which earlier months are
 * not locked yet (or the last one locked), and the month the tiles count,
 * which is the workspace's current month. A driver's page holds only their
 * own expenses (#619).
 */
export function moneyLead(
  t: TFunction,
  summary: Pick<FinanceSummaryResponse, "month" | "unlockedPeriodCodes" | "lastLockedPeriodCode">,
  { ownOnly, locale }: { ownOnly: boolean; locale: string | undefined },
): string {
  const scope = ownOnly ? "finance.money.lead.own" : "finance.money.lead";
  const name = (code: string, capitalize = false) =>
    moneyMonthName(code, { locale, currentMonth: summary.month, capitalize });
  const month = name(summary.month);
  const unlocked = summary.unlockedPeriodCodes;
  const [oldest] = unlocked;

  if (oldest !== undefined && unlocked.length > NAMED_UNLOCKED_MAX) {
    return t(`${scope}.unlockedMany`, { count: unlocked.length, oldest: name(oldest), month });
  }
  if (oldest !== undefined) {
    const months = new Intl.ListFormat(locale, { type: "conjunction" }).format(unlocked.map((code) => name(code)));
    return t(`${scope}.unlocked`, { count: unlocked.length, months: capitalizeFirst(months, locale), month });
  }
  if (summary.lastLockedPeriodCode !== null) {
    return t(`${scope}.locked`, { locked: name(summary.lastLockedPeriodCode, true), month });
  }
  return t(`${scope}.none`, { month });
}
