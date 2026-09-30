import { describe, expect, it } from "vitest";
import { canEditPendingEntry, canRecordFinance } from "./permissions.js";

describe("finance permissions", () => {
  it("allows writes only to roles accepted by record-expense and record-revenue", () => {
    for (const role of [
      "ADMIN",
      "OPS_MANAGER",
      "FINANCE_APPROVER",
      "FIELD_SUBMITTER",
    ] as const) {
      expect(canRecordFinance(role, ["CORE", "FINANCE"])).toBe(true);
    }

    for (const role of [
      "MAINTENANCE",
      "EXECUTIVE_VIEWER",
    ] as const) {
      expect(canRecordFinance(role, ["CORE", "FINANCE"])).toBe(false);
    }
  });

  it("does not expose finance when the module is disabled", () => {
    expect(canRecordFinance("ADMIN", ["CORE", "DOCUMENTS"])).toBe(false);
    expect(canRecordFinance("FIELD_SUBMITTER", ["CORE", "ASSETS"])).toBe(
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
    const viewer = (principalId: string, role: "FIELD_SUBMITTER" | "ADMIN" | "EXECUTIVE_VIEWER" = "FIELD_SUBMITTER") => ({
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

    it("not to a role that records nothing, nor with finance off", () => {
      expect(canEditPendingEntry(entry("SUBMITTED"), viewer(AUTHOR, "EXECUTIVE_VIEWER"))).toBe(false);
      expect(
        canEditPendingEntry(entry("SUBMITTED"), { ...viewer(AUTHOR), enabledModules: ["CORE"] as const }),
      ).toBe(false);
    });
  });
});
