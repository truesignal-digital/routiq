import { describe, expect, it } from "vitest";
import {
  cancelWorkOrderCommand,
  completeWorkOrderCommand,
  createWorkOrderCommand,
  rejectWorkOrderCommand,
  releaseAssetToServiceCommand,
} from "./work-orders.js";

const envelope = {
  commandId: "0d1f7a3c-0b6e-4a5f-9d2c-7e8b1a2c3d4e",
  idempotencyKey: "8d7c6b5a-4f3e-42d1-9c8b-7a6f5e4d3c2b",
  origin: "HUMAN_UI",
  sourceArtifactIds: [],
} as const;

const validCreate = {
  name: "create-work-order",
  version: 1,
  envelope,
  payload: {
    workOrderId: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
    assetId: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
    issueId: "3c4d5e6f-7a8b-4c9d-8e1f-2a3b4c5d6e7f",
    description: "Replace front brake pads and inspect discs.",
    expectedCostMinor: 85_000,
  },
} as const;

describe("create-work-order contract", () => {
  it("accepts a valid command and defaults the currency", () => {
    const parsed = createWorkOrderCommand.parse(validCreate);
    expect(parsed.payload.currency).toBe("XAF");
    expect(parsed.payload.expectedCostMinor).toBe(85_000);
  });

  it("accepts a zero expected cost — in-house labor is legal", () => {
    const command = {
      ...validCreate,
      payload: { ...validCreate.payload, expectedCostMinor: 0 },
    };

    expect(createWorkOrderCommand.safeParse(command).success).toBe(true);
  });

  it("accepts preventive work with no linked issue", () => {
    const { issueId: _dropped, ...payload } = validCreate.payload;

    expect(createWorkOrderCommand.safeParse({ ...validCreate, payload }).success).toBe(true);
  });

  it("rejects a negative expected cost", () => {
    const command = {
      ...validCreate,
      payload: { ...validCreate.payload, expectedCostMinor: -1 },
    };

    expect(createWorkOrderCommand.safeParse(command).success).toBe(false);
  });

  it("rejects a fractional expected cost — XAF has exponent 0", () => {
    const command = {
      ...validCreate,
      payload: { ...validCreate.payload, expectedCostMinor: 85_000.5 },
    };

    expect(createWorkOrderCommand.safeParse(command).success).toBe(false);
  });

  it("rejects a missing description", () => {
    const { description: _dropped, ...payload } = validCreate.payload;

    expect(createWorkOrderCommand.safeParse({ ...validCreate, payload }).success).toBe(false);
  });

  it("rejects a non-XAF currency at the pilot", () => {
    const command = {
      ...validCreate,
      payload: { ...validCreate.payload, currency: "EUR" },
    };

    expect(createWorkOrderCommand.safeParse(command).success).toBe(false);
  });
});

describe("complete-work-order contract", () => {
  const validComplete = {
    name: "complete-work-order",
    version: 1,
    envelope,
    payload: {
      workOrderId: validCreate.payload.workOrderId,
      completedAt: "2026-08-21T16:00:00+01:00",
      notes: "Pads replaced; discs within tolerance.",
      resolveLinkedIssue: true,
    },
  } as const;

  it("accepts a valid completion", () => {
    expect(completeWorkOrderCommand.parse(validComplete).payload.resolveLinkedIssue).toBe(
      true,
    );
  });

  it("defaults resolveLinkedIssue to false — unchecking records 'problem persists'", () => {
    const { resolveLinkedIssue: _dropped, ...payload } = validComplete.payload;
    const parsed = completeWorkOrderCommand.parse({ ...validComplete, payload });
    expect(parsed.payload.resolveLinkedIssue).toBe(false);
  });
});

describe("work-order decision contracts", () => {
  it("reject-work-order requires a reason", () => {
    const command = {
      name: "reject-work-order",
      version: 1,
      envelope,
      payload: { workOrderId: validCreate.payload.workOrderId },
    };

    expect(rejectWorkOrderCommand.safeParse(command).success).toBe(false);
  });

  it("cancel-work-order requires a reason", () => {
    const command = {
      name: "cancel-work-order",
      version: 1,
      envelope,
      payload: { workOrderId: validCreate.payload.workOrderId },
    };

    expect(cancelWorkOrderCommand.safeParse(command).success).toBe(false);
  });
});

describe("release-asset-to-service contract", () => {
  it("accepts a valid release", () => {
    const command = {
      name: "release-asset-to-service",
      version: 1,
      envelope,
      payload: {
        assetId: validCreate.payload.assetId,
        note: "Road-tested after brake job.",
        releasedAt: "2026-08-22T08:00:00+01:00",
      },
    };

    expect(releaseAssetToServiceCommand.safeParse(command).success).toBe(true);
  });

  it("rejects a missing assetId", () => {
    const command = {
      name: "release-asset-to-service",
      version: 1,
      envelope,
      payload: { note: "Road-tested." },
    };

    expect(releaseAssetToServiceCommand.safeParse(command).success).toBe(false);
  });
});
