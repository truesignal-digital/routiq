import { i18n } from "../i18n/index.js";

export type MoneyDirection = "REVENUE" | "EXPENSE";

/**
 * Where an amount is read decides its sign, so the same entry never reads "+"
 * on one screen and "−" on another:
 * - `ledger`: revenue and expenses side by side (lists, trip and vehicle money,
 *   history). Revenue reads "+", expense "−", from the direction; a reversal's
 *   negative amount flips it.
 * - `net`: a balance already signed as revenue − expenses. "+" or "−", bare at zero.
 * - `record`: one record's own amount (its page, the approvals row). Unsigned;
 *   the screen says the direction in words.
 * With no sign asked for, only a negative amount is signed: a total of one
 * kind can go below zero once a reversal posts into a later period.
 */
export type MoneySign =
  | { context: "ledger"; direction: MoneyDirection }
  | { context: "net" }
  | { context: "record" };

type FormatMoneyOptions = {
  currency?: string | null;
  sign?: MoneySign;
  locale?: string | null;
};

type LocalizedLabels = {
  labelFr?: string | null;
  labelEn?: string | null;
};

const MINUS = "\u2212";

function normalizeMoneySpacing(value: string): string {
  return value.replace(/\u202f/g, " ");
}

export function formatMoney(
  minor: number | null | undefined,
  options: FormatMoneyOptions | null = {},
): string {
  if (minor == null || options == null) return "";

  const { currency = "XAF", sign, locale = i18n.resolvedLanguage } = options;
  if (currency == null) return "";

  const value =
    sign?.context === "ledger" ? (sign.direction === "REVENUE" ? minor : -minor) : minor;
  const formatted = new Intl.NumberFormat(locale ?? undefined, {
    style: "currency",
    currency,
    // XAF has exponent 0; every currency here is shown in whole units.
    maximumFractionDigits: 0,
    signDisplay: sign === undefined ? "negative" : sign.context === "record" ? "never" : "exceptZero",
  }).format(value);

  // One minus sign in every language: Intl gives a hyphen in English.
  return normalizeMoneySpacing(formatted).replace("-", MINUS);
}

const plainSpaces = (value: string) => value.replace(/[\u00a0\u202f]/g, " ");

/**
 * A whole amount laid out the way `formatMoney` shows it, taken apart: the
 * grouped figure and the currency symbol, and which comes first. An amount
 * input uses it to look exactly like the figure it edits.
 */
export function moneyAmountParts(
  minor: number | null,
  options: { currency?: string; locale?: string | undefined } = {},
): { amount: string; symbol: string; symbolFirst: boolean } {
  const currency = options.currency ?? "XAF";
  const parts = new Intl.NumberFormat(options.locale ?? i18n.resolvedLanguage, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).formatToParts(minor ?? 0);
  const symbolAt = parts.findIndex((part) => part.type === "currency");
  const integerAt = parts.findIndex((part) => part.type === "integer");
  return {
    amount:
      minor === null
        ? ""
        : plainSpaces(
            parts
              .filter((part) => part.type === "integer" || part.type === "group")
              .map((part) => part.value)
              .join(""),
          ),
    symbol: parts[symbolAt]?.value ?? currency,
    symbolFirst: symbolAt !== -1 && symbolAt < integerAt,
  };
}

export type WholeAmount =
  | { kind: "empty" }
  | { kind: "invalid" }
  | { kind: "amount"; minor: number };

/**
 * A typed amount in whole units (XAF has exponent 0), in the reader's
 * grouping: "45,000,000" in English, "45 000 000" in French, where
 * "45.000.000" is also how people write it. A decimal part is invalid, never
 * rounded away.
 */
export function parseWholeAmount(text: string, locale?: string): WholeAmount {
  const trimmed = plainSpaces(text).trim();
  if (trimmed === "") return { kind: "empty" };
  const resolved = locale ?? i18n.resolvedLanguage;
  const group = plainSpaces(
    new Intl.NumberFormat(resolved).formatToParts(1_000_000).find((part) => part.type === "group")?.value ?? ",",
  );
  let digits = trimmed.replace(/ /g, "");
  if (group.trim() !== "") {
    if (digits.includes(group)) {
      // "4,5" in English is not 45: a separator only counts between groups of three.
      const groups = digits.split(group);
      if (!/^\d{1,3}$/.test(groups[0] ?? "") || groups.slice(1).some((g) => !/^\d{3}$/.test(g))) {
        return { kind: "invalid" };
      }
      digits = groups.join("");
    }
  } else if (/^\d{1,3}(\.\d{3})+$/.test(digits)) digits = digits.replace(/\./g, "");
  if (!/^\d+$/.test(digits)) return { kind: "invalid" };
  const minor = Number(digits);
  return Number.isSafeInteger(minor) ? { kind: "amount", minor } : { kind: "invalid" };
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Calendar dates retain their day; timestamps use the viewer's time zone. */
export function formatDate(iso: string | null | undefined, locale?: string): string {
  if (iso == null) return "";

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(locale ?? i18n.resolvedLanguage, {
    dateStyle: "short",
    // ISO date-only strings parse at UTC midnight, but are not instants to shift.
    ...(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? { timeZone: "UTC" } : {}),
  }).format(date);
}

/** "31 juillet 2026" — the heading a day's worth of history sits under. */
export function formatDayLong(
  value: string | Date | null | undefined,
  locale?: string,
): string {
  const date = toDate(value);
  if (date === null) return "";

  return new Intl.DateTimeFormat(locale ?? i18n.resolvedLanguage, {
    dateStyle: "long",
  }).format(date);
}

/**
 * "2026-07-31" read off the viewer's own clock. Grouping a timeline by day has
 * to follow the reader's calendar, not UTC — an event logged at 23:30 in Douala
 * belongs to that evening and not to the next morning.
 */
export function localDayKey(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (date === null) return "";

  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function formatDateTime(iso: string | null | undefined, locale?: string): string {
  if (iso == null) return "";

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(locale ?? i18n.resolvedLanguage, {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

const RELATIVE_UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 31_536_000_000],
  ["month", 2_592_000_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

/** "il y a 2 heures" — the coarsest unit that still says something. */
export function formatRelativeTime(
  iso: string | null | undefined,
  locale?: string,
): string {
  if (iso == null) return "";

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const elapsed = date.getTime() - Date.now();
  const formatter = new Intl.RelativeTimeFormat(locale ?? i18n.resolvedLanguage, {
    numeric: "auto",
  });
  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(elapsed) >= ms) return formatter.format(Math.round(elapsed / ms), unit);
  }
  return formatter.format(0, "second");
}

export function localizedLabel(
  labels: LocalizedLabels | null | undefined,
  language: string | null | undefined = i18n.resolvedLanguage,
): string {
  if (labels == null) return "";

  const fallback = labels.labelFr ?? "";
  // Fall back to labelFr when labelEn is empty or missing
  if (language?.startsWith("en")) {
    return labels.labelEn ? labels.labelEn : fallback;
  }
  return fallback;
}

export function formatPaymentMethod(
  method: "CASH" | "MOMO" | "OM" | "BANK" | "OTHER",
  i18nT?: (key: string) => string,
): string {
  if (!i18nT) {
    // Fallback if useTranslation not available
    return method;
  }
  return i18nT(`finance.record.paymentMethods.${method.toLowerCase()}`);
}
