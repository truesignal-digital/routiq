import { describe, expect, it } from "vitest";
import { ROLES, type Role } from "@routiq/contracts";
import {
  canApproveEntries,
  canEditPendingEntry,
  canManagePeriods,
  canRecordFinance,
  canRecordRevenue,
  canReopenPeriod,
  canReverseEntry,
} from "./permissions.js";

const FINANCE_ON = ["CORE", "FINANCE"] as const;

describe("finance decisions, per role (ADR-0009)", () => {
  const decides = (role: Role) => ({
    approve: canApproveEntries(role, FINANCE_ON),
    reverse: canReverseEntry(role, "POSTED"),
    lock: canManagePeriods(role, FINANCE_ON),
    reopen: canReopenPeriod(role, FINANCE_ON),
    expense: canRecordFinance(role, FINANCE_ON),
    revenue: canRecordRevenue(role, FINANCE_ON),
  });
  const expected: Record<Role, ReturnType<typeof decides>> = {
    DIRECTOR: { approve: true, reverse: true, lock: true, reopen: true, expense: true, revenue: true },
    ADMIN: { approve: false, reverse: false, lock: false, reopen: false, expense: true, revenue: true },
    FINANCE: { approve: true, reverse: true, lock: true, reopen: false, expense: true, revenue: true },
    CASHIER: { approve: false, reverse: false, lock: false, reopen: false, expense: true, revenue: true },
    TECHNICIAN: { approve: false, reverse: false, lock: false, reopen: false, expense: false, revenue: false },
    DRIVER: { approve: false, reverse: false, lock: false, reopen: false, expense: true, revenue: false },
  };

  it.each(ROLES)("%s", (role) => {
    expect(decides(role)).toEqual(expected[role]);
  });

  it("offers reverse on posted entries only", () => {
    expect(canReverseEntry("FINANCE", "SUBMITTED")).toBe(false);
  });
});

describe("finance permissions", () => {
  it("allows writes only to roles accepted by record-expense and record-revenue", () => {
    for (const role of ["DIRECTOR", "ADMIN", "FINANCE", "CASHIER", "DRIVER"] as const) {
      expect(canRecordFinance(role, ["CORE", "FINANCE"])).toBe(true);
    }

    for (const role of ["TECHNICIAN"] as const) {
      expect(canRecordFinance(role, ["CORE", "FINANCE"])).toBe(false);
    }
  });

  it("does not expose finance when the module is disabled", () => {
    expect(canRecordFinance("ADMIN", ["CORE", "DOCUMENTS"])).toBe(false);
    expect(canRecordFinance("DRIVER", ["CORE", "ASSETS"])).toBe(
      false,
    );
  });

  it("returns false when role is undefined", () => {
    expect(canRecordFinance(undefined, ["CORE", "FINANCE"])).toBe(false);
  });

  describe("canEditPendingEntry", () => {
    const AUTHOR = "00000000-0000-4000-8000-00000000a001";
    const OTHER = "00000000-0000-4000-8000-00000000a002";
    const entry = (status: string, principalId: string | null = AUTHOR) => ({
      status,
      recordedBy: { principalId },
    });
    const viewer = (principalId: string, role: Role | undefined = "DRIVER") => ({
      principalId,
      role,
      enabledModules: ["CORE", "FINANCE"] as const,
    });

    it("offers the edit to the author while the entry waits", () => {
      expect(canEditPendingEntry(entry("SUBMITTED"), viewer(AUTHOR))).toBe(true);
    });

    it("never to anyone else, an admin included", () => {
      expect(canEditPendingEntry(entry("SUBMITTED"), viewer(OTHER))).toBe(false);
      expect(canEditPendingEntry(entry("SUBMITTED"), viewer(OTHER, "ADMIN"))).toBe(false);
      expect(canEditPendingEntry(entry("SUBMITTED", null), viewer(AUTHOR))).toBe(false);
    });

    it("never once the entry is decided", () => {
      for (const status of ["POSTED", "REJECTED", "REVERSED"]) {
        expect(canEditPendingEntry(entry(status), viewer(AUTHOR))).toBe(false);
      }
    });

    it("not without a membership, nor with finance off", () => {
      expect(canEditPendingEntry(entry("SUBMITTED"), { ...viewer(AUTHOR), role: undefined })).toBe(false);
      expect(
        canEditPendingEntry(entry("SUBMITTED"), { ...viewer(AUTHOR), enabledModules: ["CORE"] as const }),
      ).toBe(false);
    });
  });
});
