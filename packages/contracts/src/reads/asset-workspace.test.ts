import { describe, expect, it } from "vitest";
import {
  assetAttentionItem,
  assetFinanceQuery,
  assetReadingsQuery,
  vehicleHistoryItem,
  vehicleHistoryQuery,
} from "./asset-workspace.js";

const item = {
  code: "DOCUMENT_EXPIRED",
  severity: "CRITICAL",
  subject: {
    entityType: "document",
    id: "3f6b2a7c-9d41-4a52-8b0e-2c1d5e6f7a8b",
    number: "POL-42",
    rowVersion: null,
  },
  since: "2026-08-31T00:00:00.000Z",
  partOfGrounding: false,
  makerPrincipalIds: [],
  params: { expiresAt: "2026-08-31", daysLeft: -1 },
};

describe("asset workspace read contracts", () => {
  it("keeps attention params to the allowlist", () => {
    const parsed = assetAttentionItem.parse({
      ...item,
      params: { ...item.params, pinHash: "secret", afterState: { a: 1 } },
    });
    expect(parsed.params).toEqual({ expiresAt: "2026-08-31", daysLeft: -1 });
  });

  it("bounds an attention description", () => {
    expect(
      assetAttentionItem.safeParse({ ...item, params: { description: "x".repeat(141) } }).success,
    ).toBe(false);
  });

  it("accepts only calendar months for the finance period", () => {
    expect(assetFinanceQuery.safeParse({ periodCode: "2026-07" }).success).toBe(true);
    expect(assetFinanceQuery.safeParse({ periodCode: "2026-7" }).success).toBe(false);
    expect(assetFinanceQuery.safeParse({ periodCode: "2026-00" }).success).toBe(false);
    expect(assetFinanceQuery.parse({})).toEqual({});
  });

  it("filters readings by meter type only", () => {
    expect(assetReadingsQuery.parse({ readingType: "HOURS" })).toMatchObject({ readingType: "HOURS" });
    expect(assetReadingsQuery.safeParse({ readingType: "LITRES" }).success).toBe(false);
  });

  it("reads one history kind or several as a list", () => {
    expect(vehicleHistoryQuery.parse({ kind: "MONEY" }).kind).toEqual(["MONEY"]);
    expect(vehicleHistoryQuery.parse({ kind: ["MONEY", "NOTES"] }).kind).toEqual(["MONEY", "NOTES"]);
    expect(vehicleHistoryQuery.parse({}).kind).toBeUndefined();
    expect(vehicleHistoryQuery.safeParse({ kind: [] }).success).toBe(false);
  });

  it("keeps history params to flat values", () => {
    const history = {
      eventId: "3f6b2a7c-9d41-4a52-8b0e-2c1d5e6f7a8b",
      eventType: "note.added",
      kind: "NOTES",
      occurredAt: "2026-08-31T10:00:00.000Z",
      actor: { principalId: null, displayName: null, scope: "PLATFORM" },
      origin: "HUMAN_UI",
      subject: { entityType: "note", id: "0b8a4c1e-6f2d-4e3a-9c5b-7d1e2f3a4b5c", number: null },
      amountMinor: null,
      currency: null,
      params: { body: "Garé au dépôt" },
      note: null,
    };
    expect(vehicleHistoryItem.parse(history)).toEqual(history);
    expect(
      vehicleHistoryItem.safeParse({ ...history, params: { state: { pinHash: "x" } } }).success,
    ).toBe(false);
  });
});
