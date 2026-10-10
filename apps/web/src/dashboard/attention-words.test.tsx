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
    expect(plain(String(item.detail))).toMatch(/^FCFA 360 per km · fleet median FCFA 290$/);
    expect(item.action).toEqual({ label: "Open the vehicle", to: "/assets/a7" });
  });
});
