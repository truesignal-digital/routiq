import { describe, expect, it } from "vitest";
import { bridgeAddsUp, profitBridge } from "./bridge.js";
import { testOverview } from "./test-overview.js";

describe("profitBridge", () => {
  it("walks from last month's profit to this month's in steps that sum exactly", () => {
    const steps = profitBridge(testOverview());
    expect(steps).toBeDefined();
    if (steps === undefined) return;
    // dashboards.html: 1 970 000 + 660 000 − 420 000 − 360 000 − 40 000 + 100 000 − 40 000 = 1 870 000.
    expect(steps.map((step) => [step.key, step.value])).toEqual([
      ["start", 1_970_000],
      ["revenue", 660_000],
      ["category:FUEL", -420_000],
      ["category:REPAIRS", -360_000],
      ["category:OTHER", 100_000],
      ["category:TOLLS", -40_000],
      ["companyCosts", -40_000],
      ["end", 1_870_000],
    ]);
    expect(bridgeAddsUp(steps)).toBe(true);
    const last = steps[steps.length - 2];
    expect(last?.to).toBe(1_870_000);
  });

  it("keeps company costs out of the category bars and in their own step", () => {
    const steps = profitBridge(testOverview()) ?? [];
    expect(steps.some((step) => step.key === "category:OFFICE")).toBe(false);
    expect(steps.find((step) => step.key === "companyCosts")?.value).toBe(-40_000);
  });

  it("folds the smallest categories into one bar past the limit, still adding up", () => {
    const steps = profitBridge(testOverview(), 3) ?? [];
    expect(steps.map((step) => step.key)).toEqual([
      "start",
      "revenue",
      "category:FUEL",
      "category:REPAIRS",
      "otherCategories",
      "companyCosts",
      "end",
    ]);
    const folded = steps.find((step) => step.key === "otherCategories");
    expect(folded?.kind === "change" && folded.foldedCount).toBe(2);
    expect(folded?.value).toBe(60_000);
    expect(bridgeAddsUp(steps)).toBe(true);
  });

  it("shows expenses no category accounts for as their own step instead of hiding the gap", () => {
    const base = testOverview();
    const overview = testOverview({
      period: { ...base.period, expenseMinor: base.period.expenseMinor + 50_000, profitMinor: 1_820_000 },
    });
    const steps = profitBridge(overview) ?? [];
    expect(steps.find((step) => step.key === "noCategory")?.value).toBe(-50_000);
    expect(bridgeAddsUp(steps)).toBe(true);
  });

  it("draws nothing for a viewer the read withholds profit from", () => {
    const base = testOverview();
    expect(
      profitBridge(
        testOverview({
          view: "REVENUE_AND_EXPENSES",
          period: { ...base.period, profitMinor: null },
          comparison: { ...base.comparison, profitMinor: null },
        }),
      ),
    ).toBeUndefined();
  });
});
