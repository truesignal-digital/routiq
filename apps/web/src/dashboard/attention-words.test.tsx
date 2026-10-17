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
  it("names a grounded vehicle's next step as its verb: plan, follow or release the repair", () => {
    const grounded = (params: TodoRow["params"]): TodoRow => ({
      code: "VEHICLE_GROUNDED",
      severity: "CRITICAL",
      link: { kind: "asset", id: "a3", number: null },
      asset: { id: "a3", assetCode: "VH003" },
      branchId: null,
      since: "2026-10-14T00:00:00.000Z",
      params,
    });
    const t = i18n.t.bind(i18n);
    expect(todoItem(grounded({ days: 3 }), t, "en")).toMatchObject({
      title: "VH003 grounded",
      detail: "3 days · no work order",
      action: { label: "Plan the repair", to: "/assets/a3" },
    });
    expect(todoItem(grounded({ days: 3, workOrderPlanned: true }), t, "en").action.label).toBe("See the repair");
    expect(todoItem(grounded({ days: 3, readyForRelease: true }), t, "en")).toMatchObject({
      detail: "3 days · repaired",
      action: { label: "Release", to: "/assets/a3" },
    });
  });

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
    expect(item.title).toBe("VH007 fuel per km 24% above the fleet");
    expect(plain(String(item.detail))).toMatch(/^360 FCFA per km · fleet median 290 FCFA$/);
    expect(item.action).toEqual({ label: "Open the vehicle", to: "/assets/a7" });
  });
});
