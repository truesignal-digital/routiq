import { afterAll, describe, expect, it } from "vitest";
import { SUMMARY_TEMPLATES, type MoneySummary } from "@routiq/contracts";
import { i18n } from "@/i18n/index.js";
import { moneySummaryText } from "./money-summary.js";

const base: MoneySummary = {
  template: "BEHIND",
  measure: "PROFIT",
  window: "MONTH_SO_FAR",
  period: { from: "2026-10-01", to: "2026-10-09" },
  comparison: { from: "2026-09-01", to: "2026-09-09" },
  currentMinor: 1_870_000,
  comparisonMinor: 1_970_000,
  revenueMinor: 9_560_000,
  changePercent: 5,
  reason: { kind: "CATEGORY", category: { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel" }, changeMinor: 420_000 },
  shortOf: null,
  trips: { closed: 27, open: 5 },
};

const words = (summary: Partial<MoneySummary>, language: string) =>
  moneySummaryText({ currency: "XAF", summary: { ...base, ...summary } }, i18n.getFixedT(language), language);

const spaces = (text: string) => text.replace(/\s/g, " ");

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

describe("moneySummaryText (#667)", () => {
  it("renders every template as whole sentences in both languages, for both measures and both windows", () => {
    for (const language of ["en", "fr-CM"]) {
      for (const template of SUMMARY_TEMPLATES) {
        for (const measure of ["PROFIT", "EXPENSES"] as const) {
          for (const window of ["MONTH_SO_FAR", "LAST_MONTH"] as const) {
            for (const shortOf of ["ENTRIES", "CLOSED_TRIPS"] as const) {
              const text = words({ template, measure, window, shortOf }, language);
              const all = [text.sentence, ...text.details, text.badge.label].join(" ");
              expect(all, `${language} ${template} ${measure} ${window}`).not.toMatch(/[{}]|overview\./);
              expect(text.sentence.trim().endsWith("."), text.sentence).toBe(true);
            }
          }
        }
      }
    }
  });

  it("says how profit moved in money, and names the biggest change", () => {
    const text = words({}, "en");
    expect(spaces(text.sentence)).toBe(
      "So far in October: a profit of FCFA 1,870,000 on FCFA 9,560,000 revenue, FCFA 100,000 worse than September at the same day.",
    );
    expect(spaces(text.details.join(" "))).toBe("Spending on Fuel rose by FCFA 420,000.");
    expect(text.badge).toEqual({ template: "BEHIND", label: "Behind September" });
    expect(text.expensesUp).toEqual({ window: "soFar", comparisonMonth: "September" });
  });

  it("calls a loss a loss, and talks about last month from the 1st", () => {
    const text = words(
      {
        template: "AHEAD",
        window: "LAST_MONTH",
        period: { from: "2026-09-01", to: "2026-09-30" },
        comparison: { from: "2026-08-01", to: "2026-08-31" },
        currentMinor: -420_000,
        comparisonMinor: -900_000,
        reason: { kind: "REVENUE", category: null, changeMinor: 480_000 },
      },
      "en",
    );
    expect(spaces(text.sentence)).toBe(
      "In September: a loss of FCFA 420,000 on FCFA 9,560,000 revenue, FCFA 480,000 better than August.",
    );
    expect(spaces(text.details.join(" "))).toBe("Revenue rose by FCFA 480,000.");
  });

  it("moves expenses in percent, and in money when the change rounds to none", () => {
    const expenses = { measure: "EXPENSES" as const, revenueMinor: null, currentMinor: 7_690_000, comparisonMinor: 6_930_000, changePercent: 11 };
    expect(spaces(words(expenses, "en").sentence)).toBe(
      "So far in October: FCFA 7,690,000 of expenses, 11% more than September at the same day.",
    );
    expect(spaces(words({ ...expenses, comparisonMinor: 7_680_000, changePercent: 0, template: "FLAT" }, "en").sentence)).toBe(
      "So far in October: FCFA 7,690,000 of expenses, about the same as September at the same day.",
    );
    expect(words(expenses, "en").expensesUp).toBeUndefined();
  });

  it("gives no profit while fewer than half the month's trips are closed", () => {
    const text = words({ template: "NOT_ENOUGH_DATA", shortOf: "CLOSED_TRIPS", reason: null, trips: { closed: 3, open: 9 } }, "en");
    expect(text.sentence).toBe("So far in October, only 3 of 12 activities are closed, so it is too early to give a profit.");
    expect(words({ template: "NOT_ENOUGH_DATA", shortOf: "ENTRIES", reason: null }, "fr-CM").sentence).toBe(
      "Rien n’a encore été comptabilisé en octobre : pas de résultat à donner.",
    );
  });

  it("says it in French by default", () => {
    expect(spaces(words({}, "fr-CM").sentence)).toBe(
      "À ce jour en octobre : un bénéfice de 1 870 000 FCFA pour 9 560 000 FCFA de recettes, soit 100 000 FCFA de moins bien qu’en septembre à la même date.",
    );
  });
});
