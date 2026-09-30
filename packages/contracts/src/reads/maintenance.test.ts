import { describe, expect, it } from "vitest";
import {
  WORK_ORDER_EVENT_KINDS,
  issueListItem,
  issueListResponse,
  workOrderDetail,
  workOrderListItem,
  workOrderListQuery,
  workOrderListResponse,
} from "./maintenance.js";

const asset = {
  id: "9c1f2b3a-4d5e-4f60-8a71-2b3c4d5e6f70",
  assetCode: "TRK-001",
  registrationNumber: "LT-4412-AB",
};

const branch = {
  id: "1a2b3c4d-5e6f-4071-8293-a4b5c6d7e8f9",
  code: "DLA",
  name: "Douala",
};

const listItem = {
  id: "5f4e3d2c-1b0a-4998-8776-655443322110",
  status: "APPROVED",
  description: "Remplacement de la pompe à eau",
  asset,
  branch,
  expectedCostMinor: 60_000,
  actualCostMinor: null,
  declaredCostMinor: null,
  costOutcome: null,
  currency: "XAF",
  issue: {
    id: "aabbccdd-1122-4334-8556-677889900aab",
    safetyCritical: true,
  },
  createdAt: "2026-08-12T09:00:00.000Z",
  completedAt: null,
  cancelledAt: null,
  rejectedAt: null,
  rowVersion: 1,
  createdBy: {
    principalId: "0b8a4c1e-6f2d-4e3a-9c5b-7d1e2f3a4b5c",
    displayName: "Hervé",
    scope: "WORKSPACE",
  },
  completedBy: null,
};

describe("work order list contract", () => {
  it("accepts an approved order whose costs are not yet declared", () => {
    expect(workOrderListItem.parse(listItem)).toEqual(listItem);
  });

  it("accepts a preventive order with no linked signalement", () => {
    const preventive = { ...listItem, issue: null };
    expect(workOrderListItem.parse(preventive)).toEqual(preventive);
  });

  it("rejects a status outside the workflow", () => {
    expect(
      workOrderListItem.safeParse({ ...listItem, status: "DONE" }).success,
    ).toBe(false);
  });

  it("rejects the pre-#28 status names — no OPEN, PENDING_CLOSE or CLOSED on the wire", () => {
    for (const legacy of ["OPEN", "PENDING_CLOSE", "CLOSED", "DRAFT", "IN_PROGRESS"]) {
      expect(
        workOrderListItem.safeParse({ ...listItem, status: legacy }).success,
        legacy,
      ).toBe(false);
    }
  });

  it("rejects a currency that is not a 3-letter code", () => {
    expect(
      workOrderListItem.safeParse({ ...listItem, currency: "XAFF" }).success,
    ).toBe(false);
  });

  it("keeps money in whole minor units — XAF has no cents to lose", () => {
    expect(
      workOrderListItem.safeParse({ ...listItem, actualCostMinor: 1250.5 })
        .success,
    ).toBe(false);
  });

  it("carries a v1 close's typed amount apart from the derived actual cost", () => {
    const legacy = {
      ...listItem,
      status: "COMPLETED",
      actualCostMinor: 0,
      declaredCostMinor: 50_000,
      completedAt: "2026-09-30T10:00:00.000Z",
    };
    expect(workOrderListItem.parse(legacy)).toEqual(legacy);
  });

  it("names the close's cost outcome from the closed set", () => {
    expect(
      workOrderListItem.safeParse({ ...listItem, costOutcome: "INVOICE_PENDING" }).success,
    ).toBe(true);
    expect(workOrderListItem.safeParse({ ...listItem, costOutcome: "LATER" }).success).toBe(
      false,
    );
  });

  it("wraps rows under `items` with a keyset cursor", () => {
    expect(
      workOrderListResponse.parse({ items: [listItem], nextCursor: null }),
    ).toEqual({ items: [listItem], nextCursor: null });
  });
});

describe("work order list query contract", () => {
  it("defaults the page size and leaves the filters unset", () => {
    const parsed = workOrderListQuery.parse({});
    expect(parsed.limit).toBe(50);
    expect(parsed.status).toBeUndefined();
    expect(parsed.branchId).toBeUndefined();
    expect(parsed.assetId).toBeUndefined();
  });

  it("accepts a status chip and a branch lens together", () => {
    expect(
      workOrderListQuery.parse({
        status: "COMPLETION_SUBMITTED",
        branchId: branch.id,
      }),
    ).toMatchObject({ status: "COMPLETION_SUBMITTED", branchId: branch.id });
  });

  it("refuses a sort — the queue's order is not a client choice", () => {
    expect(workOrderListQuery.safeParse({ sort: "createdAt:asc" }).success).toBe(
      false,
    );
  });

  it("rejects an unparseable status", () => {
    expect(workOrderListQuery.safeParse({ status: "ANNULE" }).success).toBe(false);
  });
});

describe("work order detail contract", () => {
  const detail = {
    ...listItem,
    status: "COMPLETED",
    actualCostMinor: 58_000,
    costOutcome: "LINES",
    completedAt: "2026-08-13T16:30:00.000Z",
    summary: "Pompe remplacée, circuit purgé",
    cancelReason: null,
    rejectReason: null,
    completionRejectReason: null,
    resolveLinkedIssue: true,
    createdByCommandId: "cc11dd22-ee33-4f44-8055-667788990011",
    chronologie: [
      {
        eventId: "11112222-3333-4444-8555-666677778888",
        kind: "work_order.created",
        occurredAt: "2026-08-12T09:00:00.000Z",
        actor: {
          principalId: "22223333-4444-4555-8666-777788889999",
          displayName: "Awa Njoya",
          scope: "WORKSPACE",
        },
      },
      {
        eventId: "33334444-5555-4666-8777-888899990000",
        kind: "work_order.completed",
        occurredAt: "2026-08-13T16:30:00.000Z",
        actor: { principalId: null, displayName: null, scope: "PLATFORM" },
      },
    ],
    costLines: [
      {
        postingId: "44445555-6666-4777-8888-999900001111",
        entryId: "55556666-7777-4888-8999-000011112222",
        entryNumber: "EXP-DLA-2026-0007",
        description: "Pièces et main-d'œuvre",
        amountMinor: 58_000,
        currency: "XAF",
        economicDate: "2026-08-13",
        entryStatus: "POSTED",
      },
    ],
    pendingCostLines: [
      {
        postingId: "66667777-8888-4999-8000-111122223333",
        entryId: "77778888-9999-4000-8111-222233334444",
        entryNumber: "EXP-DLA-2026-0009",
        description: "Facture fournisseur",
        amountMinor: 12_000,
        currency: "XAF",
        economicDate: "2026-08-13",
        entryStatus: "SUBMITTED",
      },
    ],
  };

  it("accepts a completed order with its timeline and its costs", () => {
    expect(workOrderDetail.parse(detail)).toEqual(detail);
  });

  it("accepts an event kind outside the known vocabulary", () => {
    const unknownKind = {
      ...detail,
      chronologie: [
        { ...detail.chronologie[0]!, kind: "work_order.reopened" },
      ],
    };
    expect(workOrderDetail.parse(unknownKind).chronologie[0]?.kind).toBe(
      "work_order.reopened",
    );
  });

  it("names every kind the maintenance commands write", () => {
    for (const kind of [
      "work_order.created",
      "work_order.submitted",
      "work_order.approved",
      "work_order.rejected",
      "work_order.completion_submitted",
      "work_order.completed",
      "work_order.completion_approved",
      "work_order.completion_rejected",
      "work_order.cancelled",
      "work_order.asset_released",
      // Legacy vocabulary still in any trail written before #28.
      "work_order.closure_approved",
    ]) {
      expect(WORK_ORDER_EVENT_KINDS, kind).toContain(kind);
    }
    expect(new Set(WORK_ORDER_EVENT_KINDS).size).toBe(
      WORK_ORDER_EVENT_KINDS.length,
    );
  });

  it("keeps cost lines signed so a reversal subtracts", () => {
    const reversed = {
      ...detail,
      costLines: [{ ...detail.costLines[0]!, amountMinor: -58_000 }],
    };
    expect(workOrderDetail.parse(reversed).costLines[0]?.amountMinor).toBe(
      -58_000,
    );
  });

  it("keeps a pending cost out of the posted set", () => {
    expect(
      workOrderDetail.safeParse({
        ...detail,
        costLines: [{ ...detail.costLines[0]!, entryStatus: "SUBMITTED" }],
      }).success,
    ).toBe(false);
    expect(
      workOrderDetail.safeParse({
        ...detail,
        pendingCostLines: [{ ...detail.pendingCostLines[0]!, entryStatus: "POSTED" }],
      }).success,
    ).toBe(false);
  });

  it("carries no REJECTED line anywhere — a refused spend is not a cost", () => {
    expect(
      workOrderDetail.safeParse({
        ...detail,
        costLines: [{ ...detail.costLines[0]!, entryStatus: "REJECTED" }],
      }).success,
    ).toBe(false);
  });

  it("rejects a detail missing its chronologie", () => {
    const { chronologie: _chronologie, ...withoutTimeline } = detail;
    expect(workOrderDetail.safeParse(withoutTimeline).success).toBe(false);
  });
});

describe("issue list contract", () => {
  const issue = {
    id: "aabbccdd-1122-4334-8556-677889900aab",
    asset,
    branch,
    description: "Fuite de liquide de frein",
    safetyCritical: true,
    category: "BRAKES",
    reportedAt: "2026-08-12T08:15:00.000Z",
    status: "OPEN",
    resolvedAt: null,
    resolutionNote: null,
    dismissedAt: null,
    dismissReason: null,
    workOrders: [{ id: listItem.id, status: "APPROVED" }],
    assetUnavailable: true,
    rowVersion: 1,
  };

  it("accepts a grounded safety-critical signalement", () => {
    expect(issueListItem.parse(issue)).toEqual(issue);
  });

  it("accepts an uncategorised signalement with no work order yet", () => {
    const bare = {
      ...issue,
      category: null,
      workOrders: [],
      safetyCritical: false,
      assetUnavailable: false,
    };
    expect(issueListItem.parse(bare)).toEqual(bare);
  });

  it("accepts a dismissed signalement with its reason", () => {
    const dismissed = {
      ...issue,
      status: "DISMISSED",
      dismissedAt: "2026-08-12T10:00:00.000Z",
      dismissReason: "Signalé par erreur",
    };
    expect(issueListItem.parse(dismissed)).toEqual(dismissed);
  });

  it("rejects an issue status outside OPEN/RESOLVED/DISMISSED", () => {
    expect(issueListItem.safeParse({ ...issue, status: "TRIAGED" }).success).toBe(
      false,
    );
  });

  it("requires the availability flag — an absent one must not read as available", () => {
    const { assetUnavailable: _flag, ...withoutFlag } = issue;
    expect(issueListItem.safeParse(withoutFlag).success).toBe(false);
  });

  it("rejects a linked work order with an unknown status", () => {
    expect(
      issueListItem.safeParse({
        ...issue,
        workOrders: [{ id: listItem.id, status: "ARCHIVED" }],
      }).success,
    ).toBe(false);
  });

  it("wraps rows under `items` with a keyset cursor", () => {
    expect(issueListResponse.parse({ items: [issue], nextCursor: null })).toEqual(
      { items: [issue], nextCursor: null },
    );
  });
});
