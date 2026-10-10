import type { WorkOrderDetail } from "@routiq/contracts";
import { describe, expect, it } from "vitest";
import {
  defaultCostChoice,
  newCostLine,
  recordedCost,
  toCompletionCost,
} from "./close-cost.js";

type Line = NonNullable<WorkOrderDetail["costLines"]>[number];

const line = (entryId: string, amountMinor: number, entryStatus: Line["entryStatus"] = "POSTED"): Line => ({
  postingId: `${entryId}-p`,
  entryId,
  entryNumber: "DLA-2026-00001",
  description: null,
  amountMinor,
  currency: "XAF",
  economicDate: "2026-09-30",
  entryStatus,
});

describe("recordedCost", () => {
  it("sums posted and pending lines and counts the ones that stand", () => {
    expect(
      recordedCost({
        costLines: [line("a", 250_000), line("b", 60_000)],
        pendingCostLines: [{ ...line("c", 40_000), entryStatus: "SUBMITTED" }],
      }),
    ).toEqual({ totalMinor: 350_000, count: 3 });
  });

  it("nets a reversal pair out of both the total and the count", () => {
    expect(
      recordedCost({
        costLines: [line("a", 90_000, "REVERSED"), line("r", -90_000), line("b", 20_000)],
        pendingCostLines: [],
      }),
    ).toEqual({ totalMinor: 20_000, count: 1 });
  });
});

describe("defaultCostChoice", () => {
  it("opens on 'nothing more' when cost is in the books", () => {
    expect(defaultCostChoice({ totalMinor: 310_000, count: 2 }, true)).toBe("NOTHING_MORE");
  });

  it("opens on an empty amount otherwise, and on no choice without the right to record cost", () => {
    expect(defaultCostChoice({ totalMinor: 0, count: 0 }, true)).toBe("AMOUNT");
    expect(defaultCostChoice({ totalMinor: 0, count: 0 }, false)).toBeNull();
  });
});

describe("toCompletionCost", () => {
  const date = "2026-09-30";

  it("is incomplete with no choice or an empty amount", () => {
    expect(toCompletionCost(null, [], date)).toBeNull();
    expect(toCompletionCost("AMOUNT", [newCostLine()], date)).toBeNull();
    expect(toCompletionCost("AMOUNT", [{ ...newCostLine(), amountInput: "0" }], date)).toBeNull();
  });

  it("turns amounts into lines, with the photos on the envelope too", () => {
    const first = { ...newCostLine(), amountInput: "50 000", artifactIds: ["p1"] };
    const second = { ...newCostLine("TYRES"), amountInput: "12000", note: "  Pneu  " };
    expect(toCompletionCost("AMOUNT", [first, second], date)).toEqual({
      costOutcome: "LINES",
      costLines: [
        {
          entryId: first.entryId,
          categoryCode: "REPAIRS",
          amountMinor: 50_000,
          economicDate: date,
          evidenceArtifactIds: ["p1"],
        },
        {
          entryId: second.entryId,
          categoryCode: "TYRES",
          amountMinor: 12_000,
          economicDate: date,
          note: "Pneu",
        },
      ],
      sourceArtifactIds: ["p1"],
    });
  });

  it("maps the alternatives to their outcome with no line", () => {
    const typed = [{ ...newCostLine(), amountInput: "50000", artifactIds: ["p1"] }];
    expect(toCompletionCost("NO_COST", typed, date)).toEqual({
      costOutcome: "NO_COST",
      costLines: [],
      sourceArtifactIds: [],
    });
    expect(toCompletionCost("INVOICE_PENDING", typed, date)?.costOutcome).toBe("INVOICE_PENDING");
    expect(toCompletionCost("NOTHING_MORE", typed, date)).toEqual({
      costOutcome: "LINES",
      costLines: [],
      sourceArtifactIds: [],
    });
  });
});
