import { describe, expect, it } from "vitest";
import { ROLES } from "../roles.js";
import {
  COMING_UP_CODES,
  COMING_UP_READER_ROLES,
  comingUpQuery,
  comingUpResponse,
  comingUpWaitsOn,
  TODO_CODES,
  TODO_READER_ROLES,
  todoResponse,
  todoWaitsOn,
} from "./fleet-attention.js";

const id = "8b7f3a52-2c1e-4c55-9a0e-6f1d2b3c4d5e";
const scope = { ambientBranch: "IGNORED", branchIds: "ALL" } as const;

describe("fleet To do and Coming up", () => {
  it("gate each read on exactly the roles some row waits on", () => {
    expect([...TODO_READER_ROLES].sort()).toEqual(
      ROLES.filter((role) => TODO_CODES.some((code) => todoWaitsOn(code, role))).sort(),
    );
    expect([...COMING_UP_READER_ROLES].sort()).toEqual(
      ROLES.filter((role) => COMING_UP_CODES.some((code) => comingUpWaitsOn(code, role))).sort(),
    );
    expect(TODO_READER_ROLES).not.toContain("DRIVER");
  });

  it("send approvals to the approvers and problems to the workshop, like the navigation counts", () => {
    expect(ROLES.filter((role) => todoWaitsOn("ENTRIES_AWAITING_APPROVAL", role))).toEqual(["DIRECTOR", "FINANCE"]);
    expect(ROLES.filter((role) => todoWaitsOn("ISSUE_UNPLANNED", role))).toEqual(["DIRECTOR", "ADMIN", "TECHNICIAN"]);
    expect(ROLES.filter((role) => todoWaitsOn("PERIOD_OPEN", role))).toEqual(["DIRECTOR", "FINANCE"]);
  });

  it("say the Ambient Branch was ignored, and nothing else", () => {
    const body = { businessDate: "2026-10-10", scope, rows: [], totalCount: 0 };
    expect(todoResponse.parse(body)).toEqual(body);
    expect(todoResponse.safeParse({ ...body, scope: { ...scope, ambientBranch: "APPLIED" } }).success).toBe(false);
  });

  it("link a record by kind and id, and a list by kind alone", () => {
    const row = {
      code: "DOCUMENT_EXPIRED",
      severity: "CRITICAL",
      asset: { id, assetCode: "VH005" },
      branchId: id,
      since: "2026-10-01T00:00:00.000Z",
      params: { daysLeft: -3, expiresAt: "2026-10-07" },
    };
    const parse = (link: unknown) =>
      todoResponse.safeParse({ businessDate: "2026-10-10", scope, rows: [{ ...row, link }], totalCount: 1 }).success;
    expect(parse({ kind: "document", id, number: "VT-1" })).toBe(true);
    expect(parse({ kind: "approvals", id: null, number: null })).toBe(true);
    expect(parse({ kind: "document", id: null, number: null })).toBe(false);
    expect(parse({ kind: "approvals", id, number: null })).toBe(false);
  });

  it("carry codes, never sentences", () => {
    const body = {
      businessDate: "2026-10-10",
      scope,
      rows: [
        {
          code: "ENTRIES_AWAITING_APPROVAL",
          severity: "WARNING",
          link: { kind: "approvals", id: null, number: null },
          asset: null,
          branchId: null,
          since: "2026-10-07T08:00:00.000Z",
          params: { count: 6, amountMinor: 1_140_000, currency: "XAF", days: 3, sentence: "6 expenses wait" },
        },
      ],
      totalCount: 1,
    };
    const parsed = todoResponse.parse(body);
    expect(parsed.rows[0]?.params).not.toHaveProperty("sentence");
    expect(todoResponse.safeParse({ ...body, rows: [{ ...body.rows[0], code: "SIX_EXPENSES" }] }).success).toBe(false);
  });

  it("look 14 or 30 days ahead, 14 when unsaid", () => {
    expect(comingUpQuery.parse({})).toEqual({ days: 14 });
    expect(comingUpQuery.parse({ days: "30" })).toEqual({ days: 30 });
    expect(comingUpQuery.safeParse({ days: "7" }).success).toBe(false);
  });

  it("name what Coming up could not count", () => {
    const body = { businessDate: "2026-10-10", windowDays: 14, scope, rows: [], totalCount: 0, notCounted: ["SERVICE_DUE_BY_KM"] };
    expect(comingUpResponse.parse(body)).toEqual(body);
  });
});
