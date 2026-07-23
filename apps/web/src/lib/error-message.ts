import type { i18n as I18n } from "i18next";

/** Localize a stable error code; unknown codes render the generic fallback
 * and log the raw code so support can find it. */
export function errorMessage(i18n: I18n, code: string): string {
  const key = `errors.${code}`;
  if (i18n.exists(key)) return i18n.t(key);
  console.warn(`[errors] no translation for code ${code}`);
  return `${i18n.t("errors.generic")} (${code})`;
}
