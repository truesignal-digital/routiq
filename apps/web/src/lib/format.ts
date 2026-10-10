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
  /** Accepted for symmetry with the other formatters; money reads the same in every language. */
  locale?: string | null;
};

type LocalizedLabels = {
  labelFr?: string | null;
  labelEn?: string | null;
};

const MINUS = "\u2212";
/** Between digit groups and before the unit: an amount never wraps (#695). */
const NBSP = "\u00a0";

/**
 * The unit written after an amount: "FCFA" for XAF, as people write it in
 * Cameroon, in both languages (#712). Another currency keeps its own symbol.
 */
export function currencyUnit(currency: string | null | undefined = "XAF"): string {
  if (currency == null || currency === "XAF") return "FCFA";
  return (
    new Intl.NumberFormat("en-GB", { style: "currency", currency, currencyDisplay: "narrowSymbol" })
      .formatToParts(0)
      .find((part) => part.type === "currency")?.value ?? currency
  );
}

/** Whole units grouped by three with non-breaking spaces: "450 000". */
function groupDigits(whole: number): string {
  return String(Math.round(Math.abs(whole))).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/**
 * "450 000 FCFA", "−86 000 FCFA", "+86 000 FCFA": one way in fr-CM and en
 * (#712). Digits grouped by three, the unit after, all joined by non-breaking
 * spaces. XAF has exponent 0, so the minor units are the amount; every
 * currency here is shown in whole units.
 */
export function formatMoney(
  minor: number | null | undefined,
  options: FormatMoneyOptions | null = {},
): string {
  if (minor == null || options == null) return "";

  const { currency = "XAF", sign } = options;
  if (currency == null) return "";

  const value =
    sign?.context === "ledger" ? (sign.direction === "REVENUE" ? minor : -minor) : minor;
  const whole = Math.round(value);
  const prefix =
    sign?.context === "record" || whole === 0
      ? ""
      : whole < 0
        ? MINUS
        : sign === undefined
          ? ""
          : "+";
  return `${prefix}${groupDigits(whole)}${NBSP}${currencyUnit(currency)}`;
}

/**
 * `formatMoney` split for a tile: the signed figure ("−2 850 000", grouped by
 * non-breaking spaces) and the unit shown small after it.
 */
export function moneyFigure(
  minor: number,
  options: { currency?: string } = {},
): { figure: string; unit: string } {
  const whole = Math.round(minor);
  return { figure: `${whole < 0 ? MINUS : ""}${groupDigits(whole)}`, unit: currencyUnit(options.currency ?? "XAF") };
}

export type ProfitOrLoss = {
  kind: "profit" | "loss";
  /** "Profit" / "Loss": the word, for a tile or row label. */
  label: string;
  /** The amount without a sign; the word carries it. */
  amount: string;
  /** "Loss 86 000 FCFA": word and amount together, for a sentence. */
  text: string;
};

/**
 * Revenue minus expenses in words: a balance below zero is a Loss, never a
 * negative Profit (CONTEXT.md, Profit). Zero reads as a profit of zero.
 */
export function profitOrLoss(
  minor: number,
  options: { currency?: string; locale?: string } = {},
): ProfitOrLoss {
  const kind = minor < 0 ? "loss" : "profit";
  const { currency = "XAF", locale } = options;
  const amount = formatMoney(Math.abs(minor), {
    currency,
    sign: { context: "record" },
    ...(locale === undefined ? {} : { locale }),
  });
  const t = (key: string, values?: Record<string, string>) =>
    i18n.t(key, { ...values, ...(locale === undefined ? {} : { lng: locale }) });
  return {
    kind,
    label: t(`common.${kind}`),
    amount,
    text: t(`common.${kind}Amount`, { amount }),
  };
}

const plainSpaces = (value: string) => value.replace(/[\u00a0\u202f]/g, " ");

/**
 * A whole amount laid out the way `formatMoney` shows it, taken apart: the
 * grouped figure (plain spaces, for an input) and the unit, and which comes
 * first. An amount input uses it to look exactly like the figure it edits.
 */
export function moneyAmountParts(
  minor: number | null,
  options: { currency?: string; locale?: string | undefined } = {},
): { amount: string; symbol: string; symbolFirst: boolean } {
  return {
    amount: minor === null ? "" : plainSpaces(groupDigits(minor)),
    symbol: currencyUnit(options.currency ?? "XAF"),
    symbolFirst: false,
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

/**
 * A typed XAF amount in minor units (exponent 0), read with the grouping of
 * the language the money input formatted it in. Null when empty or invalid.
 */
export function parseMoneyXaf(input: string, locale?: string): number | null {
  const amount = parseWholeAmount(input, locale);
  return amount.kind === "amount" ? amount.minor : null;
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The calendar each app language writes dates in: day first, 24-hour clock.
 * English is British English here ("29 July 2026"), never the US order (#712).
 */
export function dateLocale(language?: string | null): string {
  const resolved = language ?? i18n.resolvedLanguage ?? "fr-CM";
  if (resolved.startsWith("en")) return "en-GB";
  if (resolved.startsWith("fr")) return "fr-FR";
  return resolved;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** A calendar date keeps its day (read in UTC); a timestamp reads on the viewer's clock. */
function dateAndZone(value: string | Date | null | undefined): { date: Date; zone: { timeZone?: "UTC" } } | null {
  const date = toDate(value);
  if (date === null) return null;
  return { date, zone: typeof value === "string" && DATE_ONLY.test(value) ? { timeZone: "UTC" } : {} };
}

export type MonthStyle = "long" | "short";

/**
 * "29 July 2026" / "29 juillet 2026"; with `month: "short"`, "29 Jul 2026" /
 * "29 juil. 2026" for a dense table. Never a two-digit year.
 */
export function formatDate(
  value: string | Date | null | undefined,
  locale?: string,
  month: MonthStyle = "long",
): string {
  const parsed = dateAndZone(value);
  if (parsed === null) return "";
  return new Intl.DateTimeFormat(dateLocale(locale), {
    day: "numeric",
    month,
    year: "numeric",
    ...parsed.zone,
  }).format(parsed.date);
}

/** "07:00": the time of day on a 24-hour clock, in both languages. */
export function formatTime(value: string | Date | null | undefined, locale?: string): string {
  const date = toDate(value);
  if (date === null) return "";
  return new Intl.DateTimeFormat(dateLocale(locale), { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
}

/** "29 July 2026, 07:00"; with `month: "short"`, "29 Jul 2026, 07:00". */
export function formatDateTime(
  value: string | Date | null | undefined,
  locale?: string,
  month: MonthStyle = "long",
): string {
  const date = toDate(value);
  if (date === null) return "";
  return `${formatDate(date, locale, month)}, ${formatTime(date, locale)}`;
}

/**
 * A day without its year, for a chart label or a sentence about this week:
 * "5 Oct", "5 October", "Monday 5 October" (`weekday`).
 */
export function formatDayMonth(
  value: string | Date | null | undefined,
  locale?: string,
  options: { month?: MonthStyle; weekday?: boolean } = {},
): string {
  const parsed = dateAndZone(value);
  if (parsed === null) return "";
  return new Intl.DateTimeFormat(dateLocale(locale), {
    ...(options.weekday === true ? { weekday: "long" as const } : {}),
    day: "numeric",
    month: options.month ?? "long",
    ...parsed.zone,
  }).format(parsed.date);
}

/**
 * Two calendar dates as one span: "1–10 October" (`days`), or whole months
 * "July – September 2026" (`months`).
 */
export function formatDateRange(
  from: string,
  to: string,
  locale?: string,
  options: { unit: "days" | "months"; month?: MonthStyle } = { unit: "days" },
): string {
  const start = toDate(`${from.slice(0, 10)}T00:00:00Z`);
  const end = toDate(`${to.slice(0, 10)}T00:00:00Z`);
  if (start === null || end === null) return "";
  const month = options.month ?? "long";
  return new Intl.DateTimeFormat(
    dateLocale(locale),
    options.unit === "days"
      ? { day: "numeric", month, timeZone: "UTC" }
      : { month, year: "numeric", timeZone: "UTC" },
  ).formatRange(start, end);
}

/** "Wednesday 29 July 2026": a calendar day read out in full, for a screen reader. */
export function formatDateFull(value: string | Date | null | undefined, locale?: string): string {
  const parsed = dateAndZone(value);
  if (parsed === null) return "";
  return new Intl.DateTimeFormat(dateLocale(locale), {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    ...parsed.zone,
  }).format(parsed.date);
}

/** "W", "Wed", "Wednesday": a weekday on its own, for a calendar's column headings. */
export function formatWeekday(value: Date, locale?: string, style: "narrow" | "short" | "long" = "long"): string {
  return new Intl.DateTimeFormat(dateLocale(locale), { weekday: style }).format(value);
}

/** "29/07/2026": the numeric day/month/year a date input shows and reads, in both languages. */
export function formatDateInput(iso: string | null | undefined): string {
  const match = iso == null ? null : /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match === null ? "" : `${match[3]}/${match[2]}/${match[1]}`;
}

/** A whole percent as the reader's language writes it: "11%", "11 %". */
export function formatPercent(percent: number, locale?: string): string {
  return plainSpaces(
    new Intl.NumberFormat(locale ?? i18n.resolvedLanguage, { style: "percent", maximumFractionDigits: 0 }).format(
      percent / 100,
    ),
  );
}

/** A whole count grouped as the reader's language writes it: "4,800", "4 800". */
export function formatCount(value: number, locale?: string): string {
  return plainSpaces(new Intl.NumberFormat(locale ?? i18n.resolvedLanguage, { maximumFractionDigits: 0 }).format(value));
}

/** A chart axis figure, short: "2M", "2 M", "450K". The exact amount is in the hover and the table. */
export function formatCompact(value: number, locale?: string): string {
  return plainSpaces(
    new Intl.NumberFormat(locale ?? i18n.resolvedLanguage, { notation: "compact", maximumFractionDigits: 1 }).format(value),
  );
}

/**
 * A month in words: "septembre 2026" for the period "2026-09" or any date in
 * it; `month: "short"` gives "sept. 2026"; `year: false` the month alone.
 */
export function formatMonth(
  value: string | null | undefined,
  locale?: string,
  options: { month?: MonthStyle; year?: boolean } = {},
): string {
  if (value == null) return "";
  const period = /^(\d{4}-\d{2})(?:-\d{2})?$/.exec(value)?.[1];
  if (period === undefined) {
    // A timestamp: its month on the viewer's clock.
    const date = toDate(value);
    if (date === null) return value;
    return new Intl.DateTimeFormat(dateLocale(locale), {
      month: options.month ?? "long",
      ...(options.year === false ? {} : { year: "numeric" as const }),
    }).format(date);
  }
  return new Intl.DateTimeFormat(dateLocale(locale), {
    month: options.month ?? "long",
    ...(options.year === false ? {} : { year: "numeric" as const }),
    timeZone: "UTC",
  }).format(new Date(`${period}-15T00:00:00Z`));
}

/** "31 juillet 2026": the heading a day's worth of history sits under. */
export function formatDayLong(value: string | Date | null | undefined, locale?: string): string {
  return formatDate(value, locale);
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

/**
 * The words for a value nobody recorded: "Non renseigné" / "Not recorded".
 * Reports never invent a missing value, and a bare dash reads as a zero or a
 * glitch, so every table, panel and timeline says it with this one key (#306).
 * In JSX, `components/not-recorded.tsx` adds the muted look and an inline Add.
 */
export function notRecorded(locale?: string): string {
  return locale === undefined ? i18n.t("common.notRecorded") : i18n.t("common.notRecorded", { lng: locale });
}
