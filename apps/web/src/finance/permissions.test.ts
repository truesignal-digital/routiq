import { describe, expect, it } from "vitest";
import { canRecordFinance } from "./permissions.js";

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
});
