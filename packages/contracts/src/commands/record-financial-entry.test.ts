import { describe, expect, it } from "vitest";
import {
  recordExpenseCommand,
  recordRevenueCommand,
} from "./record-financial-entry.js";

const valid = {
  name: "record-expense",
  version: 1,
  envelope: {
    commandId: "0d1f7a3c-0b6e-4a5f-9d2c-7e8b1a2c3d4e",
    idempotencyKey: "device1-expense-0001",
    origin: "OFFLINE_SYNC",
    sourceArtifactIds: [],
  },
  payload: {
    entryId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    branchCode: "DLA",
    categoryCode: "FUEL",
    economicDate: "2026-07-24",
    counterpartyName: "Station Akwa",
    description: "Diesel",
    amountMinor: 75_000,
    paymentMethod: "CASH",
    postings: [
      {
        assetId: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
        amountMinor: 75_000,
        assetAttribution: "DIRECT",
      },
    ],
  },
} as const;

describe("record-expense contract", () => {
  it("accepts a valid XAF expense with one or more posting lines", () => {
    const parsed = recordExpenseCommand.parse(valid);

    expect(parsed.payload.currency).toBe("XAF");
    expect(parsed.payload.estimateStatus).toBe("ACTUAL");
    expect(parsed.payload.postings).toHaveLength(1);
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    "rejects invalid client amount %s",
    (amountMinor) => {
      const command = {
        ...valid,
        payload: { ...valid.payload, amountMinor },
      };

      expect(recordExpenseCommand.safeParse(command).success).toBe(false);
    },
  );

  it("carries an optional activityId so a mid-trip cost lands on the job as well as the truck", () => {
    const activityId = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
    const command = {
      ...valid,
      payload: {
        ...valid.payload,
        postings: [{ ...valid.payload.postings[0], activityId }],
      },
    };

    const parsed = recordExpenseCommand.parse(command);
    expect(parsed.payload.postings[0]?.activityId).toBe(activityId);
    // Absent is the shape the finance screen still sends; it must stay legal.
    expect(recordExpenseCommand.parse(valid).payload.postings[0]?.activityId).toBeUndefined();
  });

  it("rejects an activityId that is not a uuid", () => {
    const command = {
      ...valid,
      payload: {
        ...valid.payload,
        postings: [{ ...valid.payload.postings[0], activityId: "ACT-2026-0007" }],
      },
    };

    expect(recordExpenseCommand.safeParse(command).success).toBe(false);
  });

  it("rejects an empty postings array", () => {
    const command = {
      ...valid,
      payload: { ...valid.payload, postings: [] },
    };

    expect(recordExpenseCommand.safeParse(command).success).toBe(false);
  });
});

describe("record-revenue contract", () => {
  it("accepts a valid revenue command", () => {
    const command = {
      ...valid,
      name: "record-revenue",
    } as const;

    expect(recordRevenueCommand.parse(command).name).toBe("record-revenue");
  });
});
