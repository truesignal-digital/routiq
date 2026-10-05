import { describe, expect, it } from "vitest";
import { ROLES, type ModuleCode, type Role } from "@routiq/contracts";
import { canRecordActivities, canRecordReadings } from "../activities/permissions.js";
import { canAssignCustodian, canCommissionAsset, canTransferAsset } from "../assets/permissions.js";
import { canManageDocuments } from "../documents/permissions.js";
import {
  canApproveEntries,
  canAttachEvidence,
  canReadFinance,
  canRecordFinance,
  canRecordRevenue,
  canReverseEntry,
} from "../finance/permissions.js";
import {
  canApproveWorkOrders,
  canManageWorkOrders,
  canReleaseAssets,
  canReportIssues,
} from "../maintenance/permissions.js";
import {
  actionAvailability,
  actionDef,
  actionPermitted,
  groupedActions,
  headerActions,
  permittedActions,
  quickActions,
  VEHICLE_ACTIONS,
  type VehicleFacts,
} from "./actions.js";
import { VEHICLE_ACTION_KEYS, type VehicleActionKey } from "./model.js";
import {
  ALL_MODULES,
  ME_ID,
  OTHER_ID,
  actor,
  asset,
  attention,
  grounded,
  groundingWorkOrder,
  viewer,
} from "./test/fixtures.js";

type Helper = (role: Role, modules: readonly ModuleCode[]) => boolean;

/** Each action's gate, as the existing permission helpers state it. */
const HELPERS: Record<VehicleActionKey, Helper> = {
  "log-fuel": canRecordFinance,
  "record-expense": canRecordFinance,
  "record-revenue": canRecordRevenue,
  // Every role may attach, but only the ledger readers see entries on the vehicle.
  "attach-evidence": (role, modules) => canAttachEvidence(role, modules) && canReadFinance(role, modules),
  "record-reading": canRecordReadings,
  "add-note": () => true,
  "report-issue": canReportIssues,
  "create-work-order": canManageWorkOrders,
  "complete-work-order": canManageWorkOrders,
  "cancel-work-order": canManageWorkOrders,
  "approve-work-order": canApproveWorkOrders,
  "approve-completion": canApproveWorkOrders,
  release: canReleaseAssets,
  "start-trip": canRecordActivities,
  "change-custodian": canAssignCustodian,
  "transfer-branch": canTransferAsset,
  commission: canCommissionAsset,
  "add-document": canManageDocuments,
  "renew-document": canManageDocuments,
  "review-entry": canApproveEntries,
  "reverse-entry": (role, modules) => modules.includes("FINANCE") && canReverseEntry(role, "POSTED"),
};

describe("the action catalogue", () => {
  it("describes every action key once", () => {
    expect(VEHICLE_ACTIONS.map((action) => action.key).sort()).toEqual([...VEHICLE_ACTION_KEYS].sort());
  });

  it.each(ROLES)("gates each action for %s exactly as the permission helpers do", (role) => {
    for (const key of VEHICLE_ACTION_KEYS) {
      expect(actionPermitted(actionDef(key), viewer(role)), key).toBe(HELPERS[key](role, ALL_MODULES));
    }
  });

  it("drops an action with its module", () => {
    const withoutMaintenance = viewer("ADMIN", ALL_MODULES.filter((m) => m !== "MAINTENANCE"));
    const keys = permittedActions(withoutMaintenance).map((action) => action.key);
    expect(keys).not.toContain("report-issue");
    expect(keys).not.toContain("release");
    expect(keys).toContain("add-note");
  });

  it("gives the counter money capture and notes, nothing else", () => {
    expect(permittedActions(viewer("CASHIER")).map((action) => action.key)).toEqual([
      "log-fuel",
      "record-expense",
      "add-note",
      "record-revenue",
    ]);
  });

  it("puts each role's own buttons in the header", () => {
    expect(headerActions(viewer("DIRECTOR"))).toEqual(["record-expense"]);
    expect(headerActions(viewer("ADMIN"))).toEqual(["record-expense"]);
    expect(headerActions(viewer("FINANCE"))).toEqual(["record-expense"]);
    expect(headerActions(viewer("CASHIER"))).toEqual(["record-expense"]);
    expect(headerActions(viewer("TECHNICIAN"))).toEqual(["report-issue"]);
    expect(headerActions(viewer("DRIVER"))).toEqual(["log-fuel", "report-issue"]);
  });

  it("gives work-order decisions to the managers and money decisions to Finance", () => {
    const keys = (role: Role) => permittedActions(viewer(role)).map((action) => action.key);
    for (const role of ["DIRECTOR", "ADMIN"] as const) {
      expect(keys(role)).toEqual(expect.arrayContaining(["approve-work-order", "approve-completion"]));
    }
    expect(keys("FINANCE")).not.toContain("approve-work-order");
    expect(keys("FINANCE")).not.toContain("approve-completion");
    for (const role of ["DIRECTOR", "FINANCE"] as const) {
      expect(keys(role)).toEqual(expect.arrayContaining(["review-entry", "reverse-entry"]));
    }
    expect(keys("ADMIN")).not.toContain("review-entry");
    expect(keys("ADMIN")).not.toContain("reverse-entry");
    expect(keys("DRIVER")).not.toContain("record-revenue");
    expect(keys("DRIVER")).not.toContain("renew-document");
    expect(keys("FINANCE")).toContain("renew-document");
  });

  it("lists the role's own area first in the sheet", () => {
    expect(groupedActions(viewer("FINANCE"))[0]?.group).toBe("money");
    expect(groupedActions(viewer("TECHNICIAN"))[0]?.group).toBe("maintenance");
    expect(groupedActions(viewer("ADMIN"))[0]?.group).toBe("capture");
  });
});

describe("what the vehicle allows right now", () => {
  const facts = (overrides: Partial<VehicleFacts> = {}): VehicleFacts => ({
    asset: asset(),
    attention: [],
    ...overrides,
  });
  const state = (key: VehicleActionKey, f: VehicleFacts, role: Role = "ADMIN") => {
    const result = actionAvailability(key, f, viewer(role));
    return result.state === "locked" ? `locked:${result.lock.key}` : `enabled:${result.target?.kind ?? "-"}`;
  };

  it("locks everything but money decisions on a vehicle that left the fleet", () => {
    const sold = facts({ asset: asset({ lifecycleStatus: "SOLD" }) });
    expect(state("record-expense", sold)).toBe("locked:vehicleDisposed");
    expect(state("add-note", sold)).toBe("locked:vehicleDisposed");
    expect(state("review-entry", sold)).toBe("locked:nothingAwaitingReview");
  });

  it("commissions only a registered vehicle", () => {
    expect(state("commission", facts())).toBe("locked:alreadyInService");
    expect(state("commission", facts({ asset: asset({ lifecycleStatus: "REGISTERED" }) }))).toBe("enabled:-");
  });

  it("finds the record a decision is about, and locks the maker out", () => {
    expect(state("approve-work-order", facts(), "ADMIN")).toBe("locked:nothingAwaitingAuthorization");
    const mine = attention("WORK_ORDER_AWAITING_AUTHORIZATION", { makerPrincipalIds: [ME_ID] });
    expect(state("approve-work-order", facts({ attention: [mine] }), "FINANCE")).toBe(
      "locked:makerCannotApprove",
    );
    const theirs = attention("WORK_ORDER_AWAITING_AUTHORIZATION", { makerPrincipalIds: [OTHER_ID] });
    expect(state("approve-work-order", facts({ attention: [theirs] }), "FINANCE")).toBe(
      "enabled:work_order",
    );
    const review = attention("ENTRY_AWAITING_REVIEW", { makerPrincipalIds: [ME_ID] });
    expect(state("review-entry", facts({ attention: [review] }), "FINANCE")).toBe("locked:youRecordedIt");
  });

  it("releases only once the grounding's work order is completed", () => {
    expect(state("release", facts(), "ADMIN")).toBe("locked:notGrounded");
    const inRepair = facts({ asset: asset({ availability: grounded([groundingWorkOrder("APPROVED")]) }) });
    expect(state("release", inRepair, "ADMIN")).toBe("locked:needsCompletion");
    const done = facts({ asset: asset({ availability: grounded([groundingWorkOrder("COMPLETED")]) }) });
    expect(state("release", done, "ADMIN")).toBe("enabled:work_order");
    const ownRepair = facts({
      asset: asset({
        availability: grounded([groundingWorkOrder("COMPLETED", { completedBy: actor(ME_ID) })]),
      }),
    });
    expect(state("release", ownRepair, "ADMIN")).toBe("locked:selfReleaseForbidden");
  });

  it("plans a work order from an unplanned problem when there is one", () => {
    expect(state("create-work-order", facts(), "TECHNICIAN")).toBe("enabled:-");
    expect(state("create-work-order", facts({ attention: [attention("ISSUE_UNPLANNED")] }), "TECHNICIAN")).toBe(
      "enabled:issue",
    );
  });

  it("completes the grounding work order first", () => {
    expect(state("complete-work-order", facts(), "TECHNICIAN")).toBe("locked:noWorkOrderInProgress");
    const inRepair = facts({ asset: asset({ availability: grounded([groundingWorkOrder("APPROVED")]) }) });
    expect(state("complete-work-order", inRepair, "TECHNICIAN")).toBe("enabled:work_order");
  });

  it("renews the expired document before the expiring one", () => {
    expect(state("renew-document", facts())).toBe("locked:nothingToRenew");
    expect(state("renew-document", facts({ attention: [attention("DOCUMENT_EXPIRING"), attention("DOCUMENT_EXPIRED")] }))).toBe(
      "enabled:document",
    );
  });

  it("records revenue only when the workspace has a revenue category", () => {
    expect(state("record-revenue", facts({ revenueCategoryCount: 0 }))).toBe("locked:noRevenueCategory");
    expect(state("record-revenue", facts({ revenueCategoryCount: 2 }))).toBe("enabled:-");
  });

  it("fills the phone bar with the first three actions the role can take now", () => {
    const f = facts();
    expect(quickActions(f, viewer("DRIVER"))).toEqual(["log-fuel", "report-issue", "record-reading"]);
    // Nothing to complete yet, so the workshop's bar starts with planning.
    expect(quickActions(f, viewer("TECHNICIAN"))).toEqual(["create-work-order", "report-issue", "add-note"]);
    expect(quickActions(f, viewer("FINANCE"))).toEqual(["record-expense", "reverse-entry"]);
    expect(quickActions(f, viewer("ADMIN"))).toEqual(["record-expense", "report-issue", "start-trip"]);
    expect(quickActions(f, viewer("DIRECTOR"))).toEqual(["record-expense", "report-issue", "start-trip"]);
    expect(quickActions(f, viewer("CASHIER"))).toEqual(["record-expense", "record-revenue", "add-note"]);
  });
});
