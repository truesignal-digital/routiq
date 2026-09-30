import { describe, expect, it } from "vitest";
import {
  COMPLETE_WORK_ORDER_MAX_COST_LINES,
  completeWorkOrderCommand,
  completeWorkOrderV1Command,
} from "./complete-work-order.js";

const envelope = {
  commandId: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  idempotencyKey: "complete-work-order-001",
  origin: "HUMAN_UI" as const,
  sourceArtifactIds: [],
};

const workOrderId = "550e8400-e29b-41d4-a716-446655440000";
const entryId = "6b1f7a52-0d7e-4c9c-9a53-0c1c2f6a1a01";
const otherEntryId = "6b1f7a52-0d7e-4c9c-9a53-0c1c2f6a1a02";
const photoId = "8d2c1c1e-8a47-4d8e-bb0b-4a6d8f1c2e03";

const line = {
  entryId,
  categoryCode: "REPAIRS",
  amountMinor: 50_000,
  economicDate: "2026-09-30",
};

function v2(payload: Record<string, unknown>) {
  return completeWorkOrderCommand.safeParse({
    name: "complete-work-order",
    version: 2,
    envelope,
    payload: { workOrderId, currency: "XAF", ...payload },
  });
}

describe("completeWorkOrderCommand (v2)", () => {
  it("carries one cost line with the close", () => {
    const parsed = v2({ costOutcome: "LINES", costLines: [line] });
    expect(parsed.success).toBe(true);
    const payload = parsed.data!.payload;
    expect(payload.costLines).toHaveLength(1);
    // XAF has exponent 0: 50 000 francs are 50 000 minor units.
    expect(payload.costLines[0]!.amountMinor).toBe(50_000);
    // The close form does not ask how it was paid.
    expect(payload.costLines[0]!.paymentMethod).toBe("CASH");
  });

  it("requires a cost outcome: closing with no choice is not possible", () => {
    expect(v2({}).success).toBe(false);
    expect(v2({ costOutcome: "MAYBE" }).success).toBe(false);
  });

  it("accepts LINES with no new line, for costs already recorded", () => {
    const parsed = v2({ costOutcome: "LINES" });
    expect(parsed.success).toBe(true);
    expect(parsed.data!.payload.costLines).toEqual([]);
  });

  it.each(["NO_COST", "INVOICE_PENDING"] as const)(
    "accepts %s with no line and refuses it with one",
    (costOutcome) => {
      expect(v2({ costOutcome }).success).toBe(true);
      expect(v2({ costOutcome, costLines: [line] }).success).toBe(false);
    },
  );

  it("drops the typed actual cost: v2 derives it from the books", () => {
    expect(v2({ costOutcome: "NO_COST", actualCostMinor: 50_000 }).success).toBe(false);
  });

  it.each([0, -100, 12.5])("refuses a line amount of %s", (amountMinor) => {
    expect(v2({ costOutcome: "LINES", costLines: [{ ...line, amountMinor }] }).success).toBe(
      false,
    );
  });

  it("refuses a line without a date or category", () => {
    const { economicDate: _date, ...noDate } = line;
    const { categoryCode: _category, ...noCategory } = line;
    expect(v2({ costOutcome: "LINES", costLines: [noDate] }).success).toBe(false);
    expect(v2({ costOutcome: "LINES", costLines: [noCategory] }).success).toBe(false);
  });

  it("carries a receipt photo and a note on a line", () => {
    const parsed = v2({
      costOutcome: "LINES",
      costLines: [{ ...line, evidenceArtifactIds: [photoId], note: "Plaquettes avant" }],
    });
    expect(parsed.data!.payload.costLines[0]).toMatchObject({
      evidenceArtifactIds: [photoId],
      note: "Plaquettes avant",
    });
  });

  it("refuses the same entry id twice", () => {
    expect(v2({ costOutcome: "LINES", costLines: [line, line] }).success).toBe(false);
  });

  it("refuses one photo claimed by two lines", () => {
    expect(
      v2({
        costOutcome: "LINES",
        costLines: [
          { ...line, evidenceArtifactIds: [photoId] },
          { ...line, entryId: otherEntryId, evidenceArtifactIds: [photoId] },
        ],
      }).success,
    ).toBe(false);
  });

  it("caps the lines a close may carry", () => {
    const lines = Array.from({ length: COMPLETE_WORK_ORDER_MAX_COST_LINES + 1 }, (_, index) => ({
      ...line,
      entryId: `6b1f7a52-0d7e-4c9c-9a53-0c1c2f6a1b${String(index).padStart(2, "0")}`,
    }));
    expect(v2({ costOutcome: "LINES", costLines: lines }).success).toBe(false);
  });

  it("leaves resolveLinkedIssue unset so the server can default it from the issue link", () => {
    expect(v2({ costOutcome: "NO_COST" }).data!.payload.resolveLinkedIssue).toBeUndefined();
  });

  it("is version 2", () => {
    expect(
      completeWorkOrderCommand.safeParse({
        name: "complete-work-order",
        version: 1,
        envelope,
        payload: { workOrderId, costOutcome: "NO_COST" },
      }).success,
    ).toBe(false);
  });
});

describe("completeWorkOrderV1Command (compatibility)", () => {
  const valid = {
    name: "complete-work-order",
    version: 1,
    envelope,
    payload: { workOrderId, currency: "XAF" },
  };

  it("accepts a valid v1 command", () => {
    expect(completeWorkOrderV1Command.parse(valid).payload.workOrderId).toBe(workOrderId);
  });

  it("rejects missing workOrderId", () => {
    expect(
      completeWorkOrderV1Command.safeParse({
        ...valid,
        payload: { ...valid.payload, workOrderId: undefined },
      }).success,
    ).toBe(false);
  });

  it("still accepts a typed actualCostMinor", () => {
    expect(
      completeWorkOrderV1Command.parse({
        ...valid,
        payload: { ...valid.payload, actualCostMinor: 45000 },
      }).payload.actualCostMinor,
    ).toBe(45000);
  });

  it("rejects negative actualCostMinor", () => {
    expect(
      completeWorkOrderV1Command.safeParse({
        ...valid,
        payload: { ...valid.payload, actualCostMinor: -100 },
      }).success,
    ).toBe(false);
  });

  it("accepts optional summary", () => {
    expect(
      completeWorkOrderV1Command.parse({
        ...valid,
        payload: { ...valid.payload, summary: "Tire replaced successfully" },
      }).payload.summary,
    ).toBe("Tire replaced successfully");
  });

  it("carries an explicit resolveLinkedIssue=false — work done, problem persists", () => {
    expect(
      completeWorkOrderV1Command.parse({
        ...valid,
        payload: { ...valid.payload, resolveLinkedIssue: false },
      }).payload.resolveLinkedIssue,
    ).toBe(false);
  });

  it("rejects a non-boolean resolveLinkedIssue", () => {
    expect(
      completeWorkOrderV1Command.safeParse({
        ...valid,
        payload: { ...valid.payload, resolveLinkedIssue: "yes" },
      }).success,
    ).toBe(false);
  });
});
