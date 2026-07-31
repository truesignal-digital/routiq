import { formatXAF } from "@routiq/domain";
import { i18n } from "../i18n/index.js";

type FormatMoneyOptions = {
  currency?: string | null;
  signDisplay?: Intl.NumberFormatOptions["signDisplay"] | null;
  locale?: string | null;
};

type LocalizedLabels = {
  labelFr?: string | null;
  labelEn?: string | null;
};

function normalizeMoneySpacing(value: string): string {
  return value.replace(/ /g, " ");
}

export function formatMoney(
  minor: number | null | undefined,
  options: FormatMoneyOptions | null = {},
): string {
  if (minor == null || options == null) return "";

  const {
    currency = "XAF",
    signDisplay,
    locale = i18n.resolvedLanguage,
  } = options;
  if (currency == null) return "";

  const formatted =
    currency === "XAF"
      ? (() => {
          const xafOpts: { locale?: string; signDisplay?: Intl.NumberFormatOptions["signDisplay"] } = {};
          if (locale) xafOpts.locale = locale;
          if (signDisplay) xafOpts.signDisplay = signDisplay;
          return formatXAF(minor, xafOpts);
        })()
      : new Intl.NumberFormat(locale ?? undefined, {
          style: "currency",
          currency,
          maximumFractionDigits: 0,
          ...(signDisplay == null ? {} : { signDisplay }),
        }).format(minor);

  return normalizeMoneySpacing(formatted);
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatDate(iso: string | null | undefined, locale?: string): string {
  if (iso == null) return "";

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(locale ?? i18n.resolvedLanguage, {
    dateStyle: "short",
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
