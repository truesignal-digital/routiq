import { describe, expect, it } from "vitest";
import { ROLES, type Role } from "@routiq/contracts";
import {
  canAddWorkOrderCost,
  canApproveEntries,
  canEditPendingEntry,
  canManagePeriods,
  canRecordAgain,
  canRecordFinance,
  canRecordRevenue,
  canReopenPeriod,
  canReverseEntry,
  recordAgainStep,
} from "./permissions.js";

const FINANCE_ON = ["CORE", "FINANCE"] as const;

describe("finance decisions, per role (ADR-0009)", () => {
  const decides = (role: Role) => ({
    approve: canApproveEntries(role, FINANCE_ON),
    reverse: canReverseEntry(role, { status: "POSTED", reversesEntryId: null }),
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
    expect(canReverseEntry("FINANCE", { status: "SUBMITTED", reversesEntryId: null })).toBe(false);
  });

  it("offers reverse on a posted original, never on a reversal or a reversed entry (#130)", () => {
    const original = { status: "POSTED", reversesEntryId: null } as const;
    expect(canReverseEntry("FINANCE", original)).toBe(true);
    expect(canReverseEntry("FINANCE", { status: "REVERSED", reversesEntryId: null })).toBe(false);
    expect(
      canReverseEntry("FINANCE", {
        status: "POSTED",
        reversesEntryId: "00000000-0000-4000-8000-000000000010",
      }),
    ).toBe(false);
    expect(canReverseEntry("FINANCE", undefined)).toBe(false);
  });
});

describe("a cost on a work order (#410, #414)", () => {
  it("is the workshop's and the managers', never Finance's, the Cashier's or the driver's", () => {
    expect(ROLES.filter((role) => canAddWorkOrderCost(role, FINANCE_ON))).toEqual([
      "DIRECTOR",
      "ADMIN",
      "TECHNICIAN",
    ]);
  });

  it("is nobody's with the books switched off", () => {
    expect(ROLES.filter((role) => canAddWorkOrderCost(role, ["CORE", "MAINTENANCE"]))).toEqual([]);
  });

  it("leaves Finance's, the Cashier's and the driver's own expenses alone", () => {
    for (const role of ["FINANCE", "CASHIER", "DRIVER"] as const) {
      expect(canRecordFinance(role, FINANCE_ON)).toBe(true);
    }
  });
});

describe("Record again after a wrong-details cancellation (#559)", () => {
  const onWorkOrder = { links: { workOrderId: "wo-1", workOrderAssetId: "asset-1" } };
  const ownExpense = { links: { workOrderId: null, workOrderAssetId: null } };
  const handlers = () => {
    const calls: string[] = [];
    return {
      calls,
      recordAgain: () => calls.push("record-again"),
      openWorkOrder: (assetId: string, workOrderId: string) => calls.push(`open ${assetId} ${workOrderId}`),
    };
  };
  const viewer = (role: Role) => ({ role, enabledModules: FINANCE_ON });

  it("is offered on a work-order cost only to the roles that book one", () => {
    // The two roles that cancel entries: Direction books work-order costs, Finance does not.
    expect(ROLES.filter((role) => canRecordAgain(role, FINANCE_ON, onWorkOrder))).toEqual(["DIRECTOR", "ADMIN"]);
    expect(canRecordAgain("FINANCE", FINANCE_ON, ownExpense)).toBe(true);
  });

  it("hands Finance the way to the work order instead", () => {
    const h = handlers();
    const step = recordAgainStep(viewer("FINANCE"), onWorkOrder, h);
    expect(step.onRecordAgain).toBeUndefined();
    step.onOpenWorkOrder?.();
    expect(h.calls).toEqual(["open asset-1 wo-1"]);
  });

  it("keeps Record again for Direction, and for Finance on an entry with no work order", () => {
    for (const [role, entry] of [["DIRECTOR", onWorkOrder], ["FINANCE", ownExpense]] as const) {
      const h = handlers();
      const step = recordAgainStep(viewer(role), entry, h);
      expect(step.onOpenWorkOrder).toBeUndefined();
      step.onRecordAgain?.();
      expect(h.calls).toEqual(["record-again"]);
    }
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
    const entry = (
      status: string,
      principalId: string | null = AUTHOR,
      direction: "EXPENSE" | "REVENUE" = "EXPENSE",
    ) => ({
      status,
      direction,
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

    // #572: a driver records expenses only, so their pending revenue entry
    // offers no edit; the roles that record revenue keep it.
    it("not on a revenue entry for a role that does not record revenue", () => {
      expect(canEditPendingEntry(entry("SUBMITTED", AUTHOR, "REVENUE"), viewer(AUTHOR))).toBe(false);
      expect(canEditPendingEntry(entry("SUBMITTED", AUTHOR, "REVENUE"), viewer(AUTHOR, "TECHNICIAN"))).toBe(false);
      for (const role of ["DIRECTOR", "ADMIN", "FINANCE", "CASHIER"] as const) {
        expect(canEditPendingEntry(entry("SUBMITTED", AUTHOR, "REVENUE"), viewer(AUTHOR, role))).toBe(true);
      }
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
