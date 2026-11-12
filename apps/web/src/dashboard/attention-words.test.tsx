// @vitest-environment jsdom
import type { TodoRow } from "@routiq/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { i18n } from "../i18n/index.js";
import { todoItem } from "./attention-words.js";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

const plain = (text: string) => text.replace(/\s/g, " ");

describe("To do words", () => {
  it("says a fuel outlier in one sentence with its figures, and opens the vehicle (#668)", () => {
    const row: TodoRow = {
      code: "FUEL_PER_KM_HIGH",
      severity: "WARNING",
      link: { kind: "asset", id: "a7", number: null },
      asset: { id: "a7", assetCode: "VH007" },
      branchId: null,
      since: "2026-10-01T00:00:00.000Z",
      params: { amountMinor: 360, currency: "XAF", medianMinor: 290, percentAbove: 24 },
    };
    const item = todoItem(row, i18n.t.bind(i18n), "en");
    expect(item.title).toBe("VH007 spends 24% more on fuel per km than the fleet");
    expect(plain(String(item.detail))).toMatch(/^360 FCFA per km · fleet median 290 FCFA$/);
    expect(item.action).toEqual({ label: "Open the vehicle", to: "/assets/a7" });
  });

  it("never starts the open-month sentence with a lower-case French month", async () => {
    const row: TodoRow = {
      code: "PERIOD_OPEN",
      severity: "INFO",
      link: { kind: "posting_period", id: "p10", number: "2026-10" },
      asset: null,
      branchId: null,
      since: "2026-11-01T00:00:00.000Z",
      params: { periodCode: "2026-10", submittedCount: 0, evidenceMissingCount: 1, olderOpenCount: 0, days: 11 },
    };
    await i18n.changeLanguage("fr-CM");
    expect(todoItem(row, i18n.t.bind(i18n), "fr-CM").title).toBe("Mois encore ouvert : octobre 2026");
    await i18n.changeLanguage("en");
    expect(todoItem(row, i18n.t.bind(i18n), "en").title).toBe("October 2026 is still open");
  });
});
