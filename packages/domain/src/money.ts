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

export function formatXAF(minor: MoneyMinor, locale: string = "fr-CM"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "XAF",
    maximumFractionDigits: 0,
  }).format(minor);
}
