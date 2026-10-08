import { describe, expect, it } from "vitest";
import { isQueueable } from "./queueability.js";
import { updatePendingEntryCommand, updatePendingEntryPayload } from "./update-pending-entry.js";

const payload = {
  entryId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
  categoryCode: "FUEL",
  economicDate: "2026-07-24",
  amountMinor: 54_000,
  paymentMethod: "CASH",
  postings: [
    {
      assetId: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
      amountMinor: 54_000,
    },
  ],
} as const;

describe("update-pending-entry contract", () => {
  it("accepts the recording form's fields and fills the same defaults", () => {
    const parsed = updatePendingEntryPayload.parse(payload);

    expect(parsed.currency).toBe("XAF");
    expect(parsed.estimateStatus).toBe("ACTUAL");
    expect(parsed.postings[0]?.assetAttribution).toBe("DIRECT");
  });

  it("parses as a named, versioned command with an expected version", () => {
    const parsed = updatePendingEntryCommand.parse({
      name: "update-pending-entry",
      version: 1,
      envelope: {
        commandId: "0d1f7a3c-0b6e-4a5f-9d2c-7e8b1a2c3d4e",
        idempotencyKey: "device1-edit-0001",
        origin: "HUMAN_UI",
        expectedVersion: 1,
      },
      payload,
    });

    expect(parsed.envelope.expectedVersion).toBe(1);
  });

  it("refuses a branch: the entry stays where it was recorded", () => {
    expect(updatePendingEntryPayload.safeParse({ ...payload, branchCode: "YDE" }).success).toBe(false);
  });

  it("refuses a direction: an expense does not become a revenue", () => {
    expect(updatePendingEntryPayload.safeParse({ ...payload, direction: "REVENUE" }).success).toBe(false);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])("refuses amount %s", (amountMinor) => {
    expect(updatePendingEntryPayload.safeParse({ ...payload, amountMinor }).success).toBe(false);
  });

  it("needs at least one posting line", () => {
    expect(updatePendingEntryPayload.safeParse({ ...payload, postings: [] }).success).toBe(false);
  });

  it("is never queued offline: it edits a record an approver may decide at any moment", () => {
    expect(isQueueable("update-pending-entry")).toBe(false);
  });
});
