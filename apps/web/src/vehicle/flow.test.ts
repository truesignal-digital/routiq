import { describe, expect, it } from "vitest";
import type { Role, WorkOrderStatus } from "@routiq/contracts";
import {
  buildTodos,
  completionSignedOff,
  daysSince,
  entrySteps,
  groundingFacts,
  groundingStep,
  releaseBlocker,
  situationOf,
  tabMarkers,
  workOrderSteps,
  type EntryFacts,
} from "./flow.js";
import type { RoleStep } from "./model.js";
import {
  ENTRY_ID,
  ISSUE_ID,
  ME_ID,
  OTHER_ID,
  WORK_ORDER_ID,
  actor,
  asset,
  attention,
  grounded,
  groundingWorkOrder,
  viewer,
} from "./test/fixtures.js";

const ROLES: Role[] = ["DIRECTOR", "ADMIN", "FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"];

/** "go:key", "locked:key:reason" or "none" — one comparable token per role step. */
function token(step: RoleStep): string {
  if (step.kind === "none") return "none";
  if (step.kind === "go") return `go:${step.step.key}`;
  return `locked:${step.step.key}:${step.lock.key}`;
}

function primaryFor(
  role: Role,
  status: WorkOrderStatus,
  { grounding = true, maker = false }: { grounding?: boolean; maker?: boolean } = {},
): string {
  const makerActor = actor(maker ? ME_ID : OTHER_ID);
  const wo = groundingWorkOrder(status, {
    createdBy: makerActor,
    completedBy: status === "COMPLETION_SUBMITTED" || status === "COMPLETED" ? makerActor : null,
  });
  const vehicle = asset({ availability: grounding ? grounded([wo]) : { state: "AVAILABLE", since: null } });
  return token(workOrderSteps(wo, viewer(role), groundingFacts(vehicle)).primary);
}

describe("a work order's next step, per role", () => {
  const expected: Record<WorkOrderStatus, Record<Role, string>> = {
    SUBMITTED: {
      DIRECTOR: "go:approve-work-order",
      ADMIN: "go:approve-work-order",
      FINANCE: "none",
      CASHIER: "none",
      TECHNICIAN: "locked:complete-work-order:needsAuthorization",
      DRIVER: "none",
    },
    APPROVED: {
      DIRECTOR: "go:complete-work-order",
      ADMIN: "go:complete-work-order",
      FINANCE: "none",
      CASHIER: "none",
      TECHNICIAN: "go:complete-work-order",
      DRIVER: "none",
    },
    COMPLETION_SUBMITTED: {
      DIRECTOR: "go:approve-completion",
      ADMIN: "go:approve-completion",
      FINANCE: "none",
      CASHIER: "none",
      TECHNICIAN: "none",
      DRIVER: "none",
    },
    COMPLETED: {
      DIRECTOR: "go:release",
      ADMIN: "go:release",
      FINANCE: "none",
      CASHIER: "none",
      TECHNICIAN: "none",
      DRIVER: "none",
    },
    REJECTED: {
      DIRECTOR: "none",
      ADMIN: "none",
      FINANCE: "none",
      CASHIER: "none",
      TECHNICIAN: "none",
      DRIVER: "none",
    },
    CANCELLED: {
      DIRECTOR: "none",
      ADMIN: "none",
      FINANCE: "none",
      CASHIER: "none",
      TECHNICIAN: "none",
      DRIVER: "none",
    },
  };

  for (const status of Object.keys(expected) as WorkOrderStatus[]) {
    it.each(ROLES)(`${status} on the grounding work order: %s`, (role) => {
      expect(primaryFor(role, status)).toBe(expected[status][role]);
    });
  }

  it("locks the maker out of authorizing and the completer out of signing off", () => {
    expect(primaryFor("ADMIN", "SUBMITTED", { maker: true })).toBe(
      "locked:approve-work-order:makerCannotApprove",
    );
    expect(primaryFor("ADMIN", "COMPLETION_SUBMITTED", { maker: true })).toBe(
      "locked:approve-completion:completerCannotSignOff",
    );
  });

  it("forbids the completer to release after a safety-critical problem", () => {
    expect(primaryFor("ADMIN", "COMPLETED", { maker: true })).toBe(
      "locked:release:selfReleaseForbidden",
    );
  });

  it("offers no release on a work order that is not the grounding one", () => {
    expect(primaryFor("ADMIN", "COMPLETED", { grounding: false })).toBe("none");
    // The sign-off is still theirs; only the release is absent.
    expect(primaryFor("ADMIN", "COMPLETION_SUBMITTED", { grounding: false })).toBe("go:approve-completion");
  });

  it("lets only a human release", () => {
    const wo = groundingWorkOrder("COMPLETED");
    const facts = groundingFacts(asset({ availability: grounded([wo]) }));
    const robot = { ...viewer("ADMIN"), principalType: "AI_AGENT" as const };
    expect(token(workOrderSteps(wo, robot, facts).primary)).toBe("locked:release:humanOnly");
  });

  it("offers a cost only on approved work, and cancel to the workshop roles", () => {
    const approved = groundingWorkOrder("APPROVED");
    const keys = (role: Role) =>
      workOrderSteps(approved, viewer(role)).offered.map((offered) => offered.step.key);
    expect(keys("TECHNICIAN")).toEqual(["complete-work-order", "add-cost", "cancel-work-order"]);
    expect(keys("DRIVER")).toEqual(["add-cost"]);
    expect(keys("CASHIER")).toEqual(["add-cost"]);
    const submitted = groundingWorkOrder("SUBMITTED");
    expect(workOrderSteps(submitted, viewer("ADMIN")).offered.map((o) => o.step.key)).toContain(
      "approve-work-order",
    );
    expect(workOrderSteps(submitted, viewer("DIRECTOR")).offered.map((o) => o.step.key)).toContain(
      "reject-work-order",
    );
    expect(workOrderSteps(submitted, viewer("FINANCE")).offered).toEqual([]);
  });
});

describe("the step beside the status sentence", () => {
  /** The headline on a grounding whose work order is in `status`; a completer other than the viewer. */
  const headline = (role: Role, status: WorkOrderStatus | "none") => {
    const workOrders = status === "none" ? [] : [groundingWorkOrder(status)];
    return token(groundingStep(asset({ availability: grounded(workOrders) }), viewer(role)).step);
  };

  const expected: Record<WorkOrderStatus | "none", Record<Role, string>> = {
    none: {
      DIRECTOR: "locked:release:needsWorkOrder",
      ADMIN: "locked:release:needsWorkOrder",
      FINANCE: "none",
      CASHIER: "none",
      TECHNICIAN: "go:create-work-order",
      DRIVER: "none",
    },
    SUBMITTED: {
      DIRECTOR: "locked:release:needsAll",
      ADMIN: "locked:release:needsAll",
      FINANCE: "none",
      CASHIER: "none",
      TECHNICIAN: "locked:complete-work-order:needsAuthorization",
      DRIVER: "none",
    },
    APPROVED: {
      DIRECTOR: "locked:release:needsCompletion",
      ADMIN: "locked:release:needsCompletion",
      FINANCE: "none",
      CASHIER: "none",
      TECHNICIAN: "go:complete-work-order",
      DRIVER: "none",
    },
    COMPLETION_SUBMITTED: {
      DIRECTOR: "locked:release:needsSignOff",
      ADMIN: "locked:release:needsSignOff",
      FINANCE: "none",
      CASHIER: "none",
      TECHNICIAN: "none",
      DRIVER: "none",
    },
    COMPLETED: {
      DIRECTOR: "go:release",
      ADMIN: "go:release",
      FINANCE: "none",
      CASHIER: "none",
      TECHNICIAN: "none",
      DRIVER: "none",
    },
    REJECTED: {
      DIRECTOR: "locked:release:needsWorkOrder",
      ADMIN: "locked:release:needsWorkOrder",
      FINANCE: "none",
      CASHIER: "none",
      TECHNICIAN: "go:create-work-order",
      DRIVER: "none",
    },
    CANCELLED: {
      DIRECTOR: "locked:release:needsWorkOrder",
      ADMIN: "locked:release:needsWorkOrder",
      FINANCE: "none",
      CASHIER: "none",
      TECHNICIAN: "go:create-work-order",
      DRIVER: "none",
    },
  };

  for (const status of Object.keys(expected) as Array<WorkOrderStatus | "none">) {
    it.each(ROLES)(`headline with the grounding work order ${status}: %s`, (role) => {
      expect(headline(role, status)).toBe(expected[status][role]);
    });
  }

  it("keeps Complete work for the managers on the work order itself", () => {
    const wo = groundingWorkOrder("APPROVED");
    const facts = groundingFacts(asset({ availability: grounded([wo]) }));
    for (const role of ["DIRECTOR", "ADMIN"] as const) {
      const steps = workOrderSteps(wo, viewer(role), facts);
      expect(token(steps.primary)).toBe("go:complete-work-order");
      expect(steps.offered.map((offered) => offered.step.key)).toContain("complete-work-order");
    }
  });

  it("points the manager's locked release at the work order, or at the problem without one", () => {
    const withOrder = asset({ availability: grounded([groundingWorkOrder("APPROVED")]) });
    expect(groundingStep(withOrder, viewer("ADMIN")).record).toEqual({ kind: "work_order", id: WORK_ORDER_ID });
    const without = asset({ availability: grounded([]) });
    expect(groundingStep(without, viewer("ADMIN")).record).toEqual({ kind: "issue", id: ISSUE_ID });
  });

  it("plans the repair when the grounding has no work order", () => {
    const vehicle = asset({ availability: grounded([]) });
    expect(token(groundingStep(vehicle, viewer("TECHNICIAN")).step)).toBe("go:create-work-order");
    expect(groundingStep(vehicle, viewer("TECHNICIAN")).record).toEqual({ kind: "issue", id: vehicle.availability.state === "GROUNDED" ? vehicle.availability.issue.id : "" });
    expect(token(groundingStep(vehicle, viewer("FINANCE")).step)).toBe("none");
  });

  it("releases on the override path once the problem was closed without a repair", () => {
    const vehicle = asset({ availability: grounded([], { status: "RESOLVED", closedBy: actor(OTHER_ID) }) });
    expect(token(groundingStep(vehicle, viewer("ADMIN")).step)).toBe("go:release");
    const own = asset({ availability: grounded([], { status: "RESOLVED", closedBy: actor(ME_ID) }) });
    expect(token(groundingStep(own, viewer("ADMIN")).step)).toBe("locked:release:selfReleaseForbidden");
  });

  it("offers the money roles nothing beside the grounding", () => {
    const vehicle = asset({ availability: grounded([groundingWorkOrder("COMPLETED")]) });
    expect(token(groundingStep(vehicle, viewer("FINANCE")).step)).toBe("none");
    expect(token(groundingStep(vehicle, viewer("CASHIER")).step)).toBe("none");
  });

  it("names what a release still needs", () => {
    expect(releaseBlocker(undefined)?.key).toBe("notGrounded");
    const at = (status: WorkOrderStatus) =>
      releaseBlocker(groundingFacts(asset({ availability: grounded([groundingWorkOrder(status)]) })))?.key;
    expect(at("SUBMITTED")).toBe("needsAll");
    expect(at("APPROVED")).toBe("needsCompletion");
    expect(at("COMPLETION_SUBMITTED")).toBe("needsSignOff");
    expect(at("COMPLETED")).toBeUndefined();
    expect(releaseBlocker(groundingFacts(asset({ availability: grounded([]) })))?.key).toBe("needsWorkOrder");
  });
});

describe("the status sentence", () => {
  const now = new Date("2026-09-25T10:00:00");

  it("puts lifecycle before availability", () => {
    expect(situationOf(asset({ lifecycleStatus: "SOLD" }), [], now)).toEqual({ kind: "disposed", status: "SOLD" });
    expect(situationOf(asset({ lifecycleStatus: "REGISTERED" }), [], now).kind).toBe("registered");
  });

  it("never reads a disabled maintenance module as available", () => {
    expect(situationOf(asset({ availability: { state: "NOT_ASSESSED" } }), [], now).kind).toBe("notAssessed");
  });

  it("names the last trip when the vehicle is available", () => {
    const situation = situationOf(
      asset({
        recentActivities: [
          {
            id: "00000000-0000-4000-8000-000000000070",
            activityNumber: "DLA-2026-00003",
            activityType: { code: "HAUL", labelFr: "Transport", labelEn: "Haulage" },
            status: "CLOSED",
            completeness: "COMPLETE",
            customerName: null,
            startedAt: "2026-09-20T06:00:00.000Z",
            endedAt: "2026-09-21T18:00:00.000Z",
          },
        ],
      }),
      [],
      now,
    );
    expect(situation).toEqual({
      kind: "available",
      commissionedAt: "2024-03-10T08:00:00.000Z",
      lastTripAt: "2026-09-21T18:00:00.000Z",
    });
  });

  it.each([
    [[], "noWorkOrder"],
    [[groundingWorkOrder("REJECTED")], "repairRefused"],
    [[groundingWorkOrder("SUBMITTED")], "awaitingAuthorization"],
    [[groundingWorkOrder("APPROVED")], "inProgress"],
    [[groundingWorkOrder("COMPLETION_SUBMITTED")], "awaitingSignOff"],
    [[groundingWorkOrder("COMPLETED")], "awaitingRelease"],
  ] as const)("grounded with %j reads %s", (workOrders, phase) => {
    const situation = situationOf(asset({ availability: grounded([...workOrders]) }), [], now);
    expect(situation.kind === "grounded" && situation.phase).toBe(phase);
  });

  it("says signed off only when the completion went through a sign-off", () => {
    const vehicle = asset({ availability: grounded([groundingWorkOrder("COMPLETED")]) });
    const phase = (signedOff: boolean) => {
      const situation = situationOf(vehicle, [], now, signedOff);
      return situation.kind === "grounded" && situation.phase;
    };
    expect(phase(false)).toBe("awaitingRelease");
    expect(phase(true)).toBe("awaitingReleaseSignedOff");
  });

  it("reads the sign-off off the work order's timeline, the last settling event deciding", () => {
    const events = (...kinds: string[]) => kinds.map((kind) => ({ kind }));
    expect(completionSignedOff(undefined)).toBe(false);
    expect(completionSignedOff(events("work_order.created", "work_order.approved", "work_order.completed"))).toBe(false);
    expect(
      completionSignedOff(
        events("work_order.approved", "work_order.completion_submitted", "work_order.completion_approved"),
      ),
    ).toBe(true);
    // Sent back once, then completed inside the auto band: no sign-off stands.
    expect(
      completionSignedOff(
        events("work_order.completion_submitted", "work_order.completion_rejected", "work_order.completed"),
      ),
    ).toBe(false);
    expect(completionSignedOff(events("work_order.closure_submitted", "work_order.closure_approved"))).toBe(true);
  });

  it("says a completion was sent back, from the attention read", () => {
    const vehicle = asset({ availability: grounded([groundingWorkOrder("APPROVED")]) });
    const sentBack = attention("WORK_ORDER_IN_PROGRESS", {
      params: { completionRejectReason: "Air valve still leaking" },
    });
    const situation = situationOf(vehicle, [sentBack], now);
    expect(situation.kind === "grounded" && situation.phase).toBe("completionSentBack");
  });

  it("closes the problem without a repair as the override case", () => {
    const vehicle = asset({ availability: grounded([], { status: "DISMISSED" }) });
    const situation = situationOf(vehicle, [], now);
    expect(situation.kind === "grounded" && situation.phase).toBe("issueClosedAwaitingRelease");
  });

  it("counts whole calendar days", () => {
    expect(daysSince("2026-09-25T01:00:00", now)).toBe(0);
    expect(daysSince("2026-09-24T23:30:00", now)).toBe(1);
    expect(daysSince("2026-09-22T08:00:00", now)).toBe(3);
  });
});

describe("to-dos from the attention read", () => {
  const vehicle = asset({ availability: grounded([groundingWorkOrder("APPROVED")]) });

  it("leaves the grounding to the status sentence", () => {
    const items = [
      attention("WORK_ORDER_IN_PROGRESS", { partOfGrounding: true }),
      attention("DOCUMENT_EXPIRED"),
    ];
    expect(buildTodos(items, vehicle, viewer("ADMIN")).map((todo) => todo.item.code)).toEqual([
      "DOCUMENT_EXPIRED",
    ]);
  });

  it("gives each item its step, or who it waits on", () => {
    const items = [
      attention("ENTRY_AWAITING_REVIEW", { makerPrincipalIds: [ME_ID] }),
      attention("ENTRY_EVIDENCE_MISSING", { params: { recordedBy: actor(ME_ID, "Sali") } }),
      attention("ISSUE_UNPLANNED"),
    ];
    const approver = buildTodos(items, vehicle, viewer("FINANCE"));
    expect(approver.map((todo) => token(todo.step))).toEqual([
      "locked:review-entry:youRecordedIt",
      "go:attach-evidence",
      "none",
    ]);
    expect(approver.map((todo) => todo.who)).toEqual(["finance", "recorder", "workshop"]);
    expect(approver[0]?.record).toEqual({ kind: "entry", id: ENTRY_ID });
  });

  it("counts only the viewer's own steps on the tab, and flags maintenance work", () => {
    const items = [attention("ISSUE_UNPLANNED"), attention("DOCUMENT_EXPIRING")];
    expect(tabMarkers(items, vehicle, viewer("TECHNICIAN"))).toEqual({ todoCount: 1, maintenanceNeedsYou: true });
    // Renewing a document is Finance's and the managers', no longer the driver's.
    expect(tabMarkers(items, vehicle, viewer("FINANCE"))).toEqual({ todoCount: 1, maintenanceNeedsYou: false });
    expect(tabMarkers(items, vehicle, viewer("DRIVER"))).toEqual({ todoCount: 0, maintenanceNeedsYou: false });
    expect(tabMarkers(items, vehicle, viewer("CASHIER"))).toEqual({ todoCount: 0, maintenanceNeedsYou: false });
  });
});

describe("an entry's steps", () => {
  const entry = (overrides: Partial<EntryFacts> = {}): EntryFacts => ({
    id: ENTRY_ID,
    status: "SUBMITTED",
    reversesEntryId: null,
    recordedBy: actor(OTHER_ID),
    evidence: { state: "NOT_SUPPLIED" },
    ...overrides,
  });
  const keys = (facts: EntryFacts, role: Role) =>
    entrySteps(facts, viewer(role)).offered.map((o) => `${o.step.key}${o.lock ? `:${o.lock.key}` : ""}`);

  it("keeps the recorder from reviewing their own entry, and lets them edit it", () => {
    expect(keys(entry({ recordedBy: actor(ME_ID) }), "FINANCE")).toEqual([
      "attach-evidence",
      "edit-entry",
      "approve-entry:youRecordedIt",
      "reject-entry:youRecordedIt",
    ]);
  });

  it("offers the edit to the author only, and only while the entry waits", () => {
    expect(keys(entry({ recordedBy: actor(ME_ID) }), "DRIVER")).toEqual([
      "attach-evidence",
      "edit-entry",
    ]);
    expect(keys(entry(), "DRIVER")).toEqual(["attach-evidence"]);
    expect(keys(entry(), "ADMIN")).not.toContain("edit-entry");
    for (const status of ["POSTED", "REJECTED", "REVERSED"] as const) {
      expect(keys(entry({ status, recordedBy: actor(ME_ID) }), "DRIVER")).not.toContain("edit-entry");
    }
  });

  it("asks no receipt of a reversal and offers reverse on posted entries only", () => {
    expect(keys(entry({ status: "POSTED", reversesEntryId: "00000000-0000-4000-8000-0000000000ef" }), "FINANCE")).toEqual([]);
    expect(keys(entry({ status: "POSTED", evidence: { state: "SUPPLIED" } }), "FINANCE")).toEqual(["reverse-entry"]);
    expect(keys(entry({ status: "POSTED", evidence: { state: "SUPPLIED" } }), "DIRECTOR")).toEqual(["reverse-entry"]);
    expect(keys(entry({ status: "POSTED" }), "DRIVER")).toEqual(["attach-evidence"]);
  });

  it("keeps approval and reversal off the Administrateur", () => {
    expect(keys(entry(), "ADMIN")).toEqual(["attach-evidence"]);
    expect(keys(entry({ status: "POSTED", evidence: { state: "SUPPLIED" } }), "ADMIN")).toEqual([]);
    expect(keys(entry(), "DIRECTOR")).toEqual(["attach-evidence", "approve-entry", "reject-entry"]);
  });
});
