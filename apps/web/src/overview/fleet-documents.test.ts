import { describe, expect, it } from "vitest";
import type { ComingUpResponse, TodoResponse } from "@routiq/contracts";
import { fleetDocumentLink, fleetDocumentRows, fleetDocumentsTruncated } from "./fleet-documents.js";

const scope = { ambientBranch: "IGNORED" as const, branchIds: "ALL" as const };

const todo = (rows: TodoResponse["rows"], totalCount = rows.length): TodoResponse => ({
  businessDate: "2026-10-10",
  scope,
  rows,
  totalCount,
});

const comingUp = (rows: ComingUpResponse["rows"], totalCount = rows.length): ComingUpResponse => ({
  businessDate: "2026-10-10",
  windowDays: 30,
  scope,
  rows,
  totalCount,
  notCounted: ["SERVICE_DUE_BY_KM"],
});

const expired = (id: string, expiresAt: string, daysLeft: number): TodoResponse["rows"][number] => ({
  code: "DOCUMENT_EXPIRED",
  severity: "CRITICAL",
  link: { kind: "document", id, number: null },
  asset: { id: `asset-${id}`, assetCode: `VH-${id}` },
  branchId: null,
  since: `${expiresAt}T00:00:00.000Z`,
  params: { expiresAt, daysLeft, documentTypeLabelFr: "Assurance", documentTypeLabelEn: "Insurance" },
});

const due = (id: string, dueDate: string, daysLeft: number): ComingUpResponse["rows"][number] => ({
  code: "DOCUMENT_DUE",
  link: { kind: "document", id, number: null },
  asset: { id: `asset-${id}`, assetCode: `VH-${id}` },
  branchId: null,
  dueDate,
  params: { daysLeft, documentTypeLabelFr: "Visite technique", documentTypeLabelEn: "Roadworthiness" },
});

describe("fleetDocumentRows (#665)", () => {
  it("lists the expired papers first, most overdue first, then those falling due, soonest first", () => {
    const rows = fleetDocumentRows(
      todo([expired("b", "2026-10-01", -9), expired("a", "2026-09-20", -20)]),
      comingUp([due("d", "2026-11-01", 22), due("c", "2026-10-15", 5)]),
    );
    expect(rows.map((row) => [row.state, row.asset?.assetCode])).toEqual([
      ["EXPIRED", "VH-a"],
      ["EXPIRED", "VH-b"],
      ["DUE_30", "VH-c"],
      ["DUE_30", "VH-d"],
    ]);
  });

  it("leaves out every other attention row: grounding, money and planned trips are not papers", () => {
    const rows = fleetDocumentRows(
      todo([
        {
          code: "VEHICLE_GROUNDED",
          severity: "CRITICAL",
          link: { kind: "asset", id: "x", number: null },
          asset: { id: "x", assetCode: "VH-x" },
          branchId: null,
          since: "2026-10-01T00:00:00.000Z",
          params: {},
        },
      ]),
      comingUp([
        {
          code: "TRIPS_PLANNED",
          link: { kind: "planning", id: null, number: null },
          asset: null,
          branchId: null,
          dueDate: "2026-10-12",
          params: { plannedCount: 2 },
        },
      ]),
    );
    expect(rows).toEqual([]);
  });

  it("opens the paper in its truck's Documents section", () => {
    const [row] = fleetDocumentRows(undefined, comingUp([due("c", "2026-10-15", 5)]));
    expect(row && fleetDocumentLink(row)).toEqual({
      to: "/assets/asset-c/documents",
      search: { panel: "document:c" },
    });
  });

  it("says when a read stopped at its row limit", () => {
    expect(fleetDocumentsTruncated(todo([]), comingUp([due("c", "2026-10-15", 5)]))).toBe(false);
    expect(fleetDocumentsTruncated(todo([], 51), comingUp([]))).toBe(true);
  });
});
