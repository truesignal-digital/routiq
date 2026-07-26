import { describe, expect, it } from "vitest";
import {
  lockPeriodCommand,
  reopenPeriodCommand,
} from "./lock-period.js";

const envelope = {
  commandId: "0d1f7a3c-0b6e-4a5f-9d2c-7e8b1a2c3d4e",
  idempotencyKey: "8d7c6b5a-4f3e-42d1-9c8b-7a6f5e4d3c2b",
  origin: "HUMAN_UI",
  sourceArtifactIds: [],
} as const;

const lockCommand = (periodCode: string) => ({
  name: "lock-period" as const,
  version: 1 as const,
  envelope,
  payload: { periodCode },
});

const reopenCommand = (periodCode: string) => ({
  name: "reopen-period" as const,
  version: 1 as const,
  envelope,
  payload: {
    periodCode,
    reason: "Additional entries must be posted.",
  },
});

const validPeriodCodes = ["2026-01", "2026-12"];
const invalidPeriodCodes = ["2026-13", "26-01", "2026-1", "2026"];

describe("lock-period contract", () => {
  it.each(validPeriodCodes)("accepts valid period code %s", (periodCode) => {
    expect(lockPeriodCommand.parse(lockCommand(periodCode)).payload.periodCode).toBe(
      periodCode,
    );
  });

  it.each(invalidPeriodCodes)("rejects invalid period code %s", (periodCode) => {
    expect(lockPeriodCommand.safeParse(lockCommand(periodCode)).success).toBe(
      false,
    );
  });
});

describe("reopen-period contract", () => {
  it.each(validPeriodCodes)("accepts valid period code %s", (periodCode) => {
    expect(
      reopenPeriodCommand.parse(reopenCommand(periodCode)).payload.periodCode,
    ).toBe(periodCode);
  });

  it.each(invalidPeriodCodes)("rejects invalid period code %s", (periodCode) => {
    expect(reopenPeriodCommand.safeParse(reopenCommand(periodCode)).success).toBe(
      false,
    );
  });

  it("rejects a missing reason", () => {
    const command = {
      ...reopenCommand("2026-01"),
      payload: { periodCode: "2026-01" },
    };

    expect(reopenPeriodCommand.safeParse(command).success).toBe(false);
  });

  it("rejects an empty reason", () => {
    const command = {
      ...reopenCommand("2026-01"),
      payload: { periodCode: "2026-01", reason: "" },
    };

    expect(reopenPeriodCommand.safeParse(command).success).toBe(false);
  });

  it("rejects a reason longer than 500 characters", () => {
    const command = {
      ...reopenCommand("2026-01"),
      payload: { periodCode: "2026-01", reason: "x".repeat(501) },
    };

    expect(reopenPeriodCommand.safeParse(command).success).toBe(false);
  });
});
