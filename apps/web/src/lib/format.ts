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

export function formatDate(iso: string | null | undefined, locale?: string): string {
  if (iso == null) return "";

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(locale ?? i18n.resolvedLanguage, {
    dateStyle: "short",
  }).format(date);
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
