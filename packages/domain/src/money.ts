/**
 * XAF money. Exponent 0 — one franc is one minor unit.
 * Stored and computed as bigint-safe integers; formatted via Intl only at the edge.
 */
export type MoneyMinor = number;

export function assertMoneyMinor(value: number): MoneyMinor {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`money must be a safe integer of XAF minor units, got ${value}`);
  }
  return value;
}

type FormatXAFOptions = {
  locale?: string;
  signDisplay?: Intl.NumberFormatOptions["signDisplay"];
};

/**
 * Format XAF amount as a localized currency string.
 * Supports both old (minor, locale) and new (minor, options) call shapes for backward compatibility.
 *
 * @param minor The amount in XAF minor units (exponent 0 — no division by 100)
 * @param localeOrOptions Locale string (backward compat) or options object { locale?, signDisplay? }
 * @returns Formatted string like "150 000 FCFA"
 */
export function formatXAF(
  minor: MoneyMinor,
  localeOrOptions?: string | FormatXAFOptions,
): string {
  // Backward compatibility: if second arg is a string, treat it as locale
  const options: FormatXAFOptions =
    typeof localeOrOptions === "string"
      ? { locale: localeOrOptions }
      : localeOrOptions ?? {};

  const locale = options.locale ?? "fr-CM";

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "XAF",
    maximumFractionDigits: 0,
    ...(options.signDisplay ? { signDisplay: options.signDisplay } : {}),
  }).format(minor);
}
