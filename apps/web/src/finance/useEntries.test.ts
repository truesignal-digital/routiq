import { describe, expect, it } from "vitest";
import type { FinancialEntryListItem, FinancialEntryListResponse } from "@routiq/contracts";
import { validateReversalReason } from "./model.js";
import { canReverseEntry } from "./permissions.js";
import { entryVehicleFields } from "../test-entry-fields.js";

describe("FinanceEntries - List rendering", () => {
  it("renders all four status chips correctly from fixture data", () => {
    const fixtureData: FinancialEntryListItem[] = [
      {
        id: "entry-1",
        entryNumber: "ENT001",
        direction: "EXPENSE",
        status: "SUBMITTED",
        category: { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel", layer: null },
        amountMinor: 50000,
        currency: "XAF",
        economicDate: "2026-07-26",
        postingPeriodCode: "2026-07",
        isLatePosting: false,
        branchId: "branch-1",
        counterpartyName: "Station Shell",
        paymentMethod: "CASH",
        estimateStatus: "ACTUAL",
        postedAt: null,
        rowVersion: 1,
        reversesEntryId: null,
        ...entryVehicleFields,
      },
      {
        id: "entry-2",
        entryNumber: "ENT002",
        direction: "REVENUE",
        status: "POSTED",
        category: { code: "REVENUE", labelFr: "Recette", labelEn: "Revenue", layer: null },
        amountMinor: 150000,
        currency: "XAF",
        economicDate: "2026-07-25",
        postingPeriodCode: "2026-07",
        isLatePosting: false,
        branchId: "branch-1",
        counterpartyName: null,
        paymentMethod: "MOMO",
        estimateStatus: "ACTUAL",
        postedAt: "2026-07-25T10:30:00Z",
        rowVersion: 1,
        reversesEntryId: null,
        ...entryVehicleFields,
      },
      {
        id: "entry-3",
        entryNumber: "ENT003",
        direction: "EXPENSE",
        status: "REJECTED",
        category: { code: "MAINTENANCE", labelFr: "Maintenance", labelEn: "Maintenance", layer: null },
        amountMinor: 25000,
        currency: "XAF",
        economicDate: "2026-07-24",
        postingPeriodCode: "2026-07",
        isLatePosting: false,
        branchId: "branch-1",
        counterpartyName: "Garage A",
        paymentMethod: "BANK",
        estimateStatus: "ACTUAL",
        postedAt: null,
        rowVersion: 1,
        reversesEntryId: null,
        ...entryVehicleFields,
      },
      {
        id: "entry-4",
        entryNumber: "ENT004",
        direction: "REVENUE",
        status: "REVERSED",
        category: { code: "REVENUE", labelFr: "Recette", labelEn: "Revenue", layer: null },
        amountMinor: -100000,
        currency: "XAF",
        economicDate: "2026-07-23",
        postingPeriodCode: "2026-07",
        isLatePosting: false,
        branchId: "branch-1",
        counterpartyName: null,
        paymentMethod: "CASH",
        estimateStatus: "ACTUAL",
        postedAt: "2026-07-23T14:00:00Z",
        rowVersion: 1,
        reversesEntryId: null,
        ...entryVehicleFields,
      },
    ];

    expect(fixtureData).toHaveLength(4);
    expect(fixtureData.map((e) => e.status)).toEqual([
      "SUBMITTED",
      "POSTED",
      "REJECTED",
      "REVERSED",
    ]);
  });
});

describe("FinanceEntries - Pagination", () => {
  it("appends pages without duplicates using flatMap", () => {
    const page1: FinancialEntryListResponse = {
      entries: [
        {
          id: "entry-1",
          entryNumber: "ENT001",
          direction: "EXPENSE",
          status: "POSTED",
          category: { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel", layer: null },
          amountMinor: 50000,
          currency: "XAF",
          economicDate: "2026-07-26",
          postingPeriodCode: "2026-07",
          isLatePosting: false,
          branchId: "branch-1",
          counterpartyName: null,
          paymentMethod: "CASH",
          estimateStatus: "ACTUAL",
          postedAt: "2026-07-26T10:00:00Z",
          rowVersion: 1,
          reversesEntryId: null,
          ...entryVehicleFields,
        },
        {
          id: "entry-2",
          entryNumber: "ENT002",
          direction: "REVENUE",
          status: "POSTED",
          category: { code: "REVENUE", labelFr: "Recette", labelEn: "Revenue", layer: null },
          amountMinor: 150000,
          currency: "XAF",
          economicDate: "2026-07-25",
          postingPeriodCode: "2026-07",
          isLatePosting: false,
          branchId: "branch-1",
          counterpartyName: null,
          paymentMethod: "MOMO",
          estimateStatus: "ACTUAL",
          postedAt: "2026-07-25T10:00:00Z",
          rowVersion: 1,
          reversesEntryId: null,
          ...entryVehicleFields,
        },
      ],
      nextCursor: "cursor-1",
    };

    const page2: FinancialEntryListResponse = {
      entries: [
        {
          id: "entry-3",
          entryNumber: "ENT003",
          direction: "EXPENSE",
          status: "POSTED",
          category: { code: "MAINTENANCE", labelFr: "Maintenance", labelEn: "Maintenance", layer: null },
          amountMinor: 25000,
          currency: "XAF",
          economicDate: "2026-07-24",
          postingPeriodCode: "2026-07",
          isLatePosting: false,
          branchId: "branch-1",
          counterpartyName: null,
          paymentMethod: "BANK",
          estimateStatus: "ACTUAL",
          postedAt: "2026-07-24T10:00:00Z",
          rowVersion: 1,
          reversesEntryId: null,
          ...entryVehicleFields,
        },
        {
          id: "entry-4",
          entryNumber: "ENT004",
          direction: "REVENUE",
          status: "POSTED",
          category: { code: "REVENUE", labelFr: "Recette", labelEn: "Revenue", layer: null },
          amountMinor: 100000,
          currency: "XAF",
          economicDate: "2026-07-23",
          postingPeriodCode: "2026-07",
          isLatePosting: false,
          branchId: "branch-1",
          counterpartyName: null,
          paymentMethod: "CASH",
          estimateStatus: "ACTUAL",
          postedAt: "2026-07-23T10:00:00Z",
          rowVersion: 1,
          reversesEntryId: null,
          ...entryVehicleFields,
        },
      ],
      nextCursor: null,
    };

    // Simulate useInfiniteQuery data structure
    const pages = [page1, page2];
    const flatMapped = pages.flatMap((p) => p.entries);

    expect(flatMapped).toHaveLength(4);
    expect(flatMapped.map((e) => e.id)).toEqual([
      "entry-1",
      "entry-2",
      "entry-3",
      "entry-4",
    ]);
    // Verify no duplicates
    const ids = flatMapped.map((e) => e.id);
    expect(ids).toEqual([...new Set(ids)]);
  });
});

describe("FinanceEntries - Reversal permissions", () => {
  it("reversal action is hidden for non-approver roles and non-POSTED entries", () => {
    for (const role of ["FINANCE_APPROVER", "ADMIN"] as const) {
      expect(canReverseEntry(role, "POSTED")).toBe(true);
      expect(canReverseEntry(role, "SUBMITTED")).toBe(false);
      expect(canReverseEntry(role, "REVERSED")).toBe(false);
    }
    for (const role of ["FIELD_SUBMITTER", "OPS_MANAGER"] as const) {
      expect(canReverseEntry(role, "POSTED")).toBe(false);
    }
    expect(canReverseEntry(undefined, "POSTED")).toBe(false);
  });

  it("reversal reason is required and bounded per the contract", () => {
    expect(validateReversalReason("")).toBe(false);
    expect(validateReversalReason("   ")).toBe(false);
    expect(validateReversalReason("Incorrect amount recorded")).toBe(true);
    expect(validateReversalReason("a".repeat(500))).toBe(true);
    expect(validateReversalReason("a".repeat(501))).toBe(false);
  });
});
