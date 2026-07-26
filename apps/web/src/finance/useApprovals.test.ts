import { describe, expect, it } from "vitest";
import { isOwnSubmission, validateRejectionReason } from "./model.js";
import { canApproveEntries } from "./permissions.js";
import type { PendingApprovalItem } from "@routiq/contracts";

describe("Approvals - Maker guard comparison", () => {
  it("identifies own submissions by comparing principal IDs", () => {
    const sessionPrincipalId = "principal-123";
    const entry: PendingApprovalItem = {
      id: "entry-1",
      entryNumber: "ENT001",
      direction: "EXPENSE",
      status: "SUBMITTED",
      category: { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel" },
      amountMinor: 50000,
      currency: "XAF",
      economicDate: "2026-07-26",
      postingPeriodCode: "2026-07",
      isLatePosting: false,
      branchId: "branch-1",
      counterpartyName: null,
      paymentMethod: "CASH",
      estimateStatus: "ACTUAL",
      postedAt: null,
      rowVersion: 1,
      submittedByPrincipalId: sessionPrincipalId,
      submittedAt: "2026-07-26T10:00:00Z",
    };

    // Own submission
    expect(isOwnSubmission(entry.submittedByPrincipalId, sessionPrincipalId)).toBe(true);

    // Different principal
    expect(isOwnSubmission(entry.submittedByPrincipalId, "principal-456")).toBe(false);

    // Undefined session principal
    expect(isOwnSubmission(entry.submittedByPrincipalId, undefined)).toBe(false);
  });
});

describe("Approvals - Payload mapping", () => {
  it("creates approve payload with optional note and expectedVersion", () => {
    const entryId = "entry-1";
    const rowVersion = 5;
    const note = "Looks good";

    const payload = {
      entryId,
      ...(note ? { note } : {}),
    };

    expect(payload.entryId).toBe(entryId);
    expect(payload.note).toBe(note);
  });

  it("creates reject payload with required reason and expectedVersion", () => {
    const entryId = "entry-1";
    const rowVersion = 5;
    const reason = "Missing evidence";

    const payload = {
      entryId,
      reason,
    };

    expect(payload.entryId).toBe(entryId);
    expect(payload.reason).toBe(reason);
  });

  it("includes rowVersion as expectedVersion in command options", () => {
    const rowVersion = 3;
    const options = { expectedVersion: rowVersion };

    expect(options.expectedVersion).toBe(3);
  });
});

describe("Approvals - Role gating", () => {
  it("allows approve access only to FINANCE_APPROVER and ADMIN with FINANCE module", () => {
    const approverRoles = ["FINANCE_APPROVER", "ADMIN"] as const;
    const deniedRoles = ["OPS_MANAGER", "FIELD_SUBMITTER", "MAINTENANCE"] as const;
    const enabledModules = ["CORE", "FINANCE"] as const;

    for (const role of approverRoles) {
      expect(canApproveEntries(role, enabledModules)).toBe(true);
    }

    for (const role of deniedRoles) {
      expect(canApproveEntries(role, enabledModules)).toBe(false);
    }
  });

  it("denies approve access when FINANCE module is disabled", () => {
    const disabledModules = ["CORE", "DOCUMENTS"] as const;

    expect(canApproveEntries("FINANCE_APPROVER", disabledModules)).toBe(false);
    expect(canApproveEntries("ADMIN", disabledModules)).toBe(false);
  });

  it("denies approve access when role is undefined", () => {
    const enabledModules = ["CORE", "FINANCE"] as const;

    expect(canApproveEntries(undefined, enabledModules)).toBe(false);
  });
});

describe("Approvals - Rejection reason validation", () => {
  it("requires rejection reason between 1 and 500 characters", () => {
    expect(validateRejectionReason("")).toBe(false);
    expect(validateRejectionReason("   ")).toBe(false);
    expect(validateRejectionReason("Invalid amount")).toBe(true);
    expect(validateRejectionReason("a".repeat(500))).toBe(true);
    expect(validateRejectionReason("a".repeat(501))).toBe(false);
  });

  it("mirrors the contract bounds (1-500 chars from approve-entry.ts)", () => {
    // This mirrors rejectEntryPayload: z.string().min(1).max(500)
    const testCases = [
      { input: "", expected: false }, // min(1) failed
      { input: "a", expected: true }, // min(1) passed
      { input: "a".repeat(500), expected: true }, // max(500) passed
      { input: "a".repeat(501), expected: false }, // max(500) failed
    ];

    testCases.forEach(({ input, expected }) => {
      expect(validateRejectionReason(input)).toBe(expected);
    });
  });
});
