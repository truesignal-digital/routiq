import { describe, expect, it } from "vitest";
import type { PeriodRead } from "@routiq/contracts";
import {
  currentPeriodCode,
  mergeImplicitCurrentPeriod,
  validateReopenReason,
} from "./model.js";
import { canManagePeriods } from "./permissions.js";

describe("FinancePeriods - currentPeriodCode", () => {
  it("returns YYYY-MM format from today", () => {
    const code = currentPeriodCode();
    expect(code).toMatch(/^\d{4}-\d{2}$/);
    const today = new Date();
    const expected = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
    expect(code).toBe(expected);
  });
});

describe("FinancePeriods - mergeImplicitCurrentPeriod", () => {
  it("adds implicit OPEN row for current month if not present", () => {
    const today = new Date();
    const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

    const periods: PeriodRead[] = [
      {
        periodCode: "2026-06",
        status: "LOCKED",
        lockedAt: "2026-07-01T00:00:00Z",
        entryCount: 5,
        rowVersion: 1,
      },
    ];

    const merged = mergeImplicitCurrentPeriod(periods);
    expect(merged).toHaveLength(2);

    const implicitRow = merged.find((p) => p.periodCode === currentMonth);
    expect(implicitRow).toBeDefined();
    expect(implicitRow?.status).toBe("OPEN");
    expect(implicitRow?.lockedAt).toBeNull();
    expect(implicitRow?.entryCount).toBe(0);
    expect(implicitRow?.rowVersion).toBe(0);
  });

  it("does not duplicate if current month already exists", () => {
    const today = new Date();
    const currentMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;

    const periods: PeriodRead[] = [
      {
        periodCode: currentMonth,
        status: "OPEN",
        lockedAt: null,
        entryCount: 3,
        rowVersion: 1,
      },
    ];

    const merged = mergeImplicitCurrentPeriod(periods);
    expect(merged).toHaveLength(1);
    const first = merged[0];
    expect(first).toBeDefined();
    expect(first!.periodCode).toBe(currentMonth);
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

    const merged = mergeImplicitCurrentPeriod(periods);
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
  it("grants access to FINANCE_APPROVER with FINANCE module", () => {
    expect(canManagePeriods("FINANCE_APPROVER", ["FINANCE"])).toBe(true);
  });

  it("grants access to ADMIN with FINANCE module", () => {
    expect(canManagePeriods("ADMIN", ["FINANCE"])).toBe(true);
  });

  it("denies access without FINANCE module", () => {
    expect(canManagePeriods("FINANCE_APPROVER", [])).toBe(false);
    expect(canManagePeriods("ADMIN", [])).toBe(false);
  });

  it("denies access for non-approver roles", () => {
    expect(canManagePeriods("FIELD_SUBMITTER", ["FINANCE"])).toBe(false);
    expect(canManagePeriods("OPS_MANAGER", ["FINANCE"])).toBe(false);
    expect(canManagePeriods("MAINTENANCE", ["FINANCE"])).toBe(false);
    expect(canManagePeriods("EXECUTIVE_VIEWER", ["FINANCE"])).toBe(false);
  });

  it("denies access for undefined role", () => {
    expect(canManagePeriods(undefined, ["FINANCE"])).toBe(false);
  });
});
