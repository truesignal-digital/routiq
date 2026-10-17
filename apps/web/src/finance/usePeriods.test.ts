import { describe, expect, it, vi } from "vitest";
import type { PeriodRead } from "@routiq/contracts";
import { mergeImplicitCurrentPeriod, validateReopenReason } from "./model.js";
import { canManagePeriods } from "./permissions.js";

// The current month comes from the server, cut in the workspace's time zone;
// the device clock never decides it (#591).
describe("FinancePeriods - mergeImplicitCurrentPeriod", () => {
  it("adds an implicit OPEN row for the server's current month if not present", () => {
    const periods: PeriodRead[] = [
      {
        periodCode: "2026-06",
        status: "LOCKED",
        lockedAt: "2026-07-01T00:00:00Z",
        entryCount: 5,
        rowVersion: 1,
      },
    ];

    const merged = mergeImplicitCurrentPeriod(periods, "2026-11");
    expect(merged).toHaveLength(2);

    const implicitRow = merged.find((p) => p.periodCode === "2026-11");
    expect(implicitRow).toBeDefined();
    expect(implicitRow?.status).toBe("OPEN");
    expect(implicitRow?.lockedAt).toBeNull();
    expect(implicitRow?.entryCount).toBe(0);
    expect(implicitRow?.rowVersion).toBe(0);
  });

  it("ignores the device clock when it is in another month", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 31, 23, 30));
    try {
      const merged = mergeImplicitCurrentPeriod([], "2026-11");
      expect(merged.map((p) => p.periodCode)).toEqual(["2026-11"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not duplicate if the current month already exists", () => {
    const periods: PeriodRead[] = [
      {
        periodCode: "2026-11",
        status: "OPEN",
        lockedAt: null,
        entryCount: 3,
        rowVersion: 1,
      },
    ];

    const merged = mergeImplicitCurrentPeriod(periods, "2026-11");
    expect(merged).toHaveLength(1);
    expect(merged[0]?.periodCode).toBe("2026-11");
  });

  it("preserves all non-current periods", () => {
    const periods: PeriodRead[] = [
      {
        periodCode: "2026-05",
        status: "LOCKED",
        lockedAt: "2026-06-01T00:00:00Z",
        entryCount: 10,
        rowVersion: 1,
      },
      {
        periodCode: "2026-04",
        status: "LOCKED",
        lockedAt: "2026-05-01T00:00:00Z",
        entryCount: 8,
        rowVersion: 1,
      },
    ];

    const merged = mergeImplicitCurrentPeriod(periods, "2026-11");
    expect(merged.filter((p) => p.status === "LOCKED")).toHaveLength(2);
  });
});

describe("FinancePeriods - validateReopenReason", () => {
  it("rejects empty and whitespace-only strings", () => {
    expect(validateReopenReason("")).toBe(false);
    expect(validateReopenReason("   ")).toBe(false);
    expect(validateReopenReason("\t\n")).toBe(false);
  });

  it("accepts valid reasons 1-500 chars after trim", () => {
    expect(validateReopenReason("Need to post late entry")).toBe(true);
    expect(validateReopenReason("a")).toBe(true);
    expect(validateReopenReason("a".repeat(500))).toBe(true);
  });

  it("rejects reasons over 500 chars", () => {
    expect(validateReopenReason("a".repeat(501))).toBe(false);
  });

  it("trims before validating", () => {
    expect(validateReopenReason("  reason  ")).toBe(true);
    expect(validateReopenReason("  ")).toBe(false);
  });
});

describe("FinancePeriods - canManagePeriods", () => {
  it("grants access to FINANCE with FINANCE module", () => {
    expect(canManagePeriods("FINANCE", ["FINANCE"])).toBe(true);
  });

  it("grants access to DIRECTOR with FINANCE module", () => {
    expect(canManagePeriods("DIRECTOR", ["FINANCE"])).toBe(true);
  });

  it("denies access without FINANCE module", () => {
    expect(canManagePeriods("FINANCE", [])).toBe(false);
    expect(canManagePeriods("ADMIN", [])).toBe(false);
  });

  it("denies access for non-approver roles", () => {
    expect(canManagePeriods("DRIVER", ["FINANCE"])).toBe(false);
    expect(canManagePeriods("ADMIN", ["FINANCE"])).toBe(false);
    expect(canManagePeriods("TECHNICIAN", ["FINANCE"])).toBe(false);
    expect(canManagePeriods("CASHIER", ["FINANCE"])).toBe(false);
  });

  it("denies access for undefined role", () => {
    expect(canManagePeriods(undefined, ["FINANCE"])).toBe(false);
  });
});
