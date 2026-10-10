import { describe, expect, it } from "vitest";
import en from "./locales/en.json";
import fr from "./locales/fr.json";
import passengerEn from "./presets/passenger-transport.en.json";
import passengerFr from "./presets/passenger-transport.fr.json";
import truckingEn from "./presets/trucking.en.json";
import truckingFr from "./presets/trucking.fr.json";

/**
 * #659: money has three words on every screen, Revenue / Recettes, Expenses /
 * Dépenses and Profit / Bénéfice (Loss / Perte below zero). The words they
 * replaced must not come back (CONTEXT.md, Profit; dashboards.html#words).
 */
const RETIRED_MONEY_WORDS = {
  en: /\bcontributions?\b|\bmargins?\b|\bmoney (in|out)\b/i,
  fr: /\bcontributions?\b|\bmarges?\b|\bentrées\b|\bsorties\b|\b(entrées?|sorties?) d['’]argent\b/i,
} as const;

function strings(node: unknown, path: string[] = []): Array<[string, string]> {
  if (typeof node === "string") return [[path.join("."), node]];
  if (node === null || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([key, value]) => strings(value, [...path, key]));
}

describe("money words", () => {
  for (const [locale, catalogs] of [
    ["en", [en, truckingEn, passengerEn]],
    ["fr", [fr, truckingFr, passengerFr]],
  ] as const) {
    it(`${locale} says revenue, expenses and profit, never the retired words`, () => {
      const offending = catalogs
        .flatMap((catalog) => strings(catalog))
        .filter(([, value]) => RETIRED_MONEY_WORDS[locale].test(value));
      expect(offending).toEqual([]);
    });
  }

  it("titles the Money Overview tiles with the same words in both languages", () => {
    expect(fr.finance.overview.tiles).toMatchObject({ expenses: "Dépenses", revenue: "Recettes" });
    expect(en.finance.overview.tiles).toMatchObject({ expenses: "Expenses", revenue: "Revenue" });
  });

  it("names a balance Profit or Loss", () => {
    expect([en.common.profit, en.common.loss]).toEqual(["Profit", "Loss"]);
    expect([fr.common.profit, fr.common.loss]).toEqual(["Bénéfice", "Perte"]);
  });
});
