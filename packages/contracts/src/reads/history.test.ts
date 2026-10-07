import { describe, expect, it } from "vitest";
import { MODULE_CODES } from "../modules.js";
import {
  HISTORY_ENTITY_MODULE,
  HISTORY_ENTITY_TYPES,
  HISTORY_MONEY_STATE_KEYS,
  HISTORY_STATE_KEYS,
  historyItem,
  historyListQuery,
  historyListResponse,
} from "./history.js";
import {
  HISTORY_CODE_SETS,
  HISTORY_FIELD_SHAPES,
  historyEventDiff,
} from "./history-fields.js";

const item = {
  eventId: "8c9a1f5e-2b74-4d16-93a0-1e7c5d8b4f30",
  eventType: "activity.reopened",
  occurredAt: "2026-07-30T09:15:00.000Z",
  actor: {
    principalId: "1d2e3f40-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    displayName: "Awa Nkeng",
    scope: "WORKSPACE",
  },
  command: {
    id: "5b6c7d8e-9f01-4a2b-8c3d-4e5f6a7b8c9d",
    name: "reopen-activity",
    version: "1",
    origin: "HUMAN_UI",
    clientOccurredAt: null,
  },
  changedFields: ["status", "completeness"],
  note: "Feuille de route corrigée par le bureau",
};

describe("history item contract", () => {
  it("accepts a tenant-actor event", () => {
    expect(historyItem.parse(item)).toEqual(item);
  });

  it("accepts a PLATFORM event with no principal behind it", () => {
    const platformItem = {
      ...item,
      eventType: "workspace.provisioned",
      actor: { principalId: null, displayName: null, scope: "PLATFORM" },
      changedFields: [],
      note: null,
    };
    expect(historyItem.parse(platformItem)).toEqual(platformItem);
  });

  it("keeps eventType open so a new command's events still render", () => {
    expect(
      historyItem.safeParse({ ...item, eventType: "work-order.opened" }).success,
    ).toBe(true);
  });

  it("rejects an actor scope outside the two the schema masks on", () => {
    expect(
      historyItem.safeParse({
        ...item,
        actor: { ...item.actor, scope: "BRANCH" },
      }).success,
    ).toBe(false);
  });

  it("wraps rows under `items` per ADR-0003", () => {
    expect(historyListResponse.parse({ items: [item], nextCursor: null })).toEqual(
      { items: [item], nextCursor: null },
    );
  });
});

describe("history query contract", () => {
  it("defaults the page size and leaves the cursor unset", () => {
    expect(historyListQuery.parse({})).toEqual({ limit: 50 });
  });

  it("refuses a client-chosen sort — the timeline order is fixed", () => {
    expect(historyListQuery.safeParse({ sort: "occurredAt:asc" }).success).toBe(
      false,
    );
  });

  it("bounds the page size", () => {
    expect(historyListQuery.safeParse({ limit: "500" }).success).toBe(false);
  });
});

describe("entity type to module map", () => {
  it("covers every known entity type with a registered module", () => {
    for (const entityType of HISTORY_ENTITY_TYPES) {
      expect(MODULE_CODES).toContain(HISTORY_ENTITY_MODULE[entityType]);
    }
  });

  it("puts the maintenance rows behind the module whose commands write them", () => {
    expect(HISTORY_ENTITY_MODULE.work_order).toBe("MAINTENANCE");
    expect(HISTORY_ENTITY_MODULE.operational_issue).toBe("MAINTENANCE");
    // The grounding hangs off an asset but is opened and closed by maintenance
    // commands, so ASSETS is not what entitles you to read it.
    expect(HISTORY_ENTITY_MODULE.asset_availability_interval).toBe("MAINTENANCE");
  });
});

describe("state key allowlist", () => {
  it("answers for every entity type, so no snapshot falls through unlisted", () => {
    for (const entityType of HISTORY_ENTITY_TYPES) {
      expect(HISTORY_STATE_KEYS[entityType], entityType).toBeDefined();
    }
  });

  it("names no bookkeeping column — they are noise in a diff, not history", () => {
    const plumbing = new Set([
      "id",
      "workspaceId",
      "rowVersion",
      "outgoingRowVersion",
      "createdByCommandId",
      "updatedByCommandId",
      "lockedByCommandId",
    ]);
    for (const entityType of HISTORY_ENTITY_TYPES) {
      for (const key of HISTORY_STATE_KEYS[entityType]) {
        expect(plumbing.has(key), `${entityType}.${key}`).toBe(false);
      }
    }
  });

  it("keeps the provisioning event's principal snapshots out of reach", () => {
    // `workspace.provisioned` writes `admin` and `users`, both carrying login
    // usernames, and CORE entitles every member to this timeline.
    expect(HISTORY_STATE_KEYS.workspace).not.toContain("admin");
    expect(HISTORY_STATE_KEYS.workspace).not.toContain("users");
  });

  it("lists no key twice, so the diff cannot repeat a field", () => {
    for (const entityType of HISTORY_ENTITY_TYPES) {
      const keys = HISTORY_STATE_KEYS[entityType];
      expect(new Set(keys).size, entityType).toBe(keys.length);
    }
  });

  it("names what the maintenance commands actually snapshot", () => {
    // Every key the phase-2b handlers put in a work-order snapshot: creation,
    // both approvals, completion, cancellation and the release.
    for (const key of [
      "status",
      "description",
      "assetId",
      "issueId",
      "expectedCostMinor",
      "actualCostMinor",
      "currency",
      "summary",
      "resolveLinkedIssue",
      "completedAt",
      "rejectReason",
      "rejectedAt",
      "completionRejectReason",
      "cancelReason",
      "cancelledAt",
      "approvalNote",
      "releasedAt",
      "releaseNote",
      "overrideReason",
    ]) {
      expect(HISTORY_STATE_KEYS.work_order, key).toContain(key);
    }
    expect([...HISTORY_STATE_KEYS.operational_issue]).toEqual([
      "status",
      "assetId",
      "description",
      "safetyCritical",
      "category",
      "reportedAt",
      "resolvedAt",
      "resolutionNote",
      "resolvedByWorkOrderId",
      "dismissedAt",
      "dismissReason",
    ]);
    // The release is `closedAt` moving off null; without it the timeline could
    // not say the truck came back into service.
    expect(HISTORY_STATE_KEYS.asset_availability_interval).toContain("closedAt");
  });

  it("treats the work order's declared costs as money, not as plain numbers", () => {
    expect(HISTORY_MONEY_STATE_KEYS).toContain("expectedCostMinor");
    expect(HISTORY_MONEY_STATE_KEYS).toContain("actualCostMinor");
  });

  it("marks as money only keys some entity type can actually show", () => {
    const allowed = new Set(
      HISTORY_ENTITY_TYPES.flatMap((entityType) => [
        ...HISTORY_STATE_KEYS[entityType],
      ]),
    );
    for (const key of HISTORY_MONEY_STATE_KEYS) {
      expect(allowed.has(key), key).toBe(true);
    }
  });
});

describe("field display shapes", () => {
  it("gives every allowlisted key a shape and names no key the allowlist lacks", () => {
    for (const entityType of HISTORY_ENTITY_TYPES) {
      expect(Object.keys(HISTORY_FIELD_SHAPES[entityType]).sort(), entityType).toEqual(
        [...HISTORY_STATE_KEYS[entityType]].sort(),
      );
    }
  });

  it("shows money as money, and only the money keys", () => {
    const money = new Set<string>(HISTORY_MONEY_STATE_KEYS);
    for (const entityType of HISTORY_ENTITY_TYPES) {
      for (const [key, shape] of Object.entries(HISTORY_FIELD_SHAPES[entityType])) {
        expect(shape === "MONEY", `${entityType}.${key}`).toBe(money.has(key));
      }
    }
  });

  it("words the issue's fields: statuses as codes, ids as names, lines as a summary (#110, #119)", () => {
    expect(HISTORY_FIELD_SHAPES.work_order.status).toEqual({ code: "workOrderStatus" });
    expect(HISTORY_FIELD_SHAPES.work_order.costOutcome).toEqual({ code: "costOutcome" });
    expect(HISTORY_FIELD_SHAPES.financial_entry.categoryId).toEqual({ name: "category" });
    expect(HISTORY_FIELD_SHAPES.financial_entry.branchId).toEqual({ name: "branch" });
    expect(HISTORY_FIELD_SHAPES.financial_entry.postings).toBe("LINES");
  });

  it("knows every code a work order can close with", () => {
    expect([...HISTORY_CODE_SETS.costOutcome]).toEqual(["LINES", "NO_COST", "INVOICE_PENDING"]);
  });
});

describe("event diff contract", () => {
  const diff = {
    eventId: "8c9a1f5e-2b74-4d16-93a0-1e7c5d8b4f30",
    currency: "XAF",
    changes: [
      { field: "description", kind: "VALUE", before: null, after: "Vidange" },
      { field: "amountMinor", kind: "MONEY", before: null, after: 125_000 },
      { field: "status", kind: "CODE", codeSet: "workOrderStatus", before: "APPROVED", after: "COMPLETED" },
      { field: "completenessCodes", kind: "CODES", codeSet: "completenessCode", before: [], after: ["ACTIVITY_NO_LEGS"] },
      { field: "branchId", kind: "NAME", before: null, after: { fr: "Douala", en: "Douala" } },
      { field: "crew", kind: "NAMES", before: null, after: [{ fr: "Sali", en: "Sali" }] },
      { field: "artifactIds", kind: "COUNT", before: null, after: 2 },
      { field: "postings", kind: "LINES", before: null, after: { count: 2, totalMinor: 45_000 } },
    ],
  };

  it("carries the changes and nothing about who or when — the row already has that", () => {
    expect(historyEventDiff.parse(diff)).toEqual(diff);
  });

  it("refuses an object or a list where a plain value belongs", () => {
    for (const after of [{ bonLivraison: "BL-4821" }, ["a", "b"]]) {
      expect(
        historyEventDiff.safeParse({
          ...diff,
          changes: [{ field: "customValues", kind: "VALUE", before: null, after }],
        }).success,
      ).toBe(false);
    }
  });

  it("refuses a code without the set that words it", () => {
    expect(
      historyEventDiff.safeParse({
        ...diff,
        changes: [{ field: "status", kind: "CODE", before: null, after: "OPEN" }],
      }).success,
    ).toBe(false);
  });

  it("refuses a value kind it has no rendering rule for", () => {
    expect(
      historyEventDiff.safeParse({
        ...diff,
        changes: [{ field: "value", kind: "DURATION", before: 1, after: 2 }],
      }).success,
    ).toBe(false);
  });

  it("refuses a currency that is not an ISO-4217 code", () => {
    expect(historyEventDiff.safeParse({ ...diff, currency: "F CFA" }).success).toBe(
      false,
    );
  });
});
