import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  financialEntryDetail,
  financialEntryListItem,
  financialEntryListResponse,
  pendingApprovalItem,
  pendingApprovalsResponse,
  periodRead,
  periodsResponse,
} from "@routiq/contracts";
import { createSession } from "../auth/local.js";
import type { Db } from "../db/client.js";
import { branches } from "../db/schema.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";
import { serializeMinor } from "./serialize-minor.js";

describe("finance reads", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let db: Db;
  let workspaceId: string;
  let branchId: string;
  let allBranchesToken: string;
  let scopedToken: string;
  let assetId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    db = ctx.db;

    const seeded = await seedWorkspace(db);
    workspaceId = seeded.workspace.id;
    branchId = seeded.branch.id;

    const admin = await seedMember(db, {
      workspaceId,
      role: "ADMIN",
      allBranches: true,
    });
    allBranchesToken = (
      await createSession(db, { principalId: admin.principal.id, workspaceId })
    ).token;

    const scoped = await seedMember(db, {
      workspaceId,
      role: "FINANCE_APPROVER",
      allBranches: false,
      branchIds: [branchId],
    });
    scopedToken = (
      await createSession(db, { principalId: scoped.principal.id, workspaceId })
    ).token;

    assetId = randomUUID();
    await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/register-asset",
      headers: { authorization: `Bearer ${allBranchesToken}` },
      payload: {
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `asset-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload: {
          assetId,
          assetCode: "FIN-TRUCK-001",
          assetClassCode: "TRUCK",
          templateCode: "TRUCKING",
          branchCode: "DLA",
        },
      },
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  describe("contract schemas", () => {
    it("parses financialEntryListItem", () => {
      const item = {
        id: randomUUID(),
        entryNumber: "DLA-2026-00001",
        direction: "EXPENSE" as const,
        status: "POSTED" as const,
        category: { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel" },
        amountMinor: 50000,
        currency: "XAF",
        economicDate: "2026-07-25",
        postingPeriodCode: "2026-07",
        isLatePosting: false,
        branchId: randomUUID(),
        counterpartyName: null,
        paymentMethod: "CASH" as const,
        estimateStatus: "ACTUAL" as const,
        postedAt: new Date().toISOString(),
        rowVersion: 1,
      };
      const parsed = financialEntryListItem.parse(item);
      expect(parsed).toEqual(item);
    });

    it("parses financialEntryListResponse", () => {
      const response = {
        entries: [
          {
            id: randomUUID(),
            entryNumber: "DLA-2026-00001",
            direction: "EXPENSE" as const,
            status: "POSTED" as const,
            category: { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel" },
            amountMinor: 50000,
            currency: "XAF",
            economicDate: "2026-07-25",
            postingPeriodCode: "2026-07",
            isLatePosting: false,
            branchId: randomUUID(),
            counterpartyName: null,
            paymentMethod: "CASH" as const,
            estimateStatus: "ACTUAL" as const,
            postedAt: new Date().toISOString(),
            rowVersion: 1,
          },
        ],
        nextCursor: null,
      };
      const parsed = financialEntryListResponse.parse(response);
      expect(parsed.entries).toHaveLength(1);
      expect(parsed.nextCursor).toBeNull();
    });

    it("parses financialEntryDetail with postings", () => {
      const detail = {
        id: randomUUID(),
        entryNumber: "DLA-2026-00001",
        direction: "EXPENSE" as const,
        status: "POSTED" as const,
        category: { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel" },
        amountMinor: 50000,
        currency: "XAF",
        economicDate: "2026-07-25",
        postingPeriodCode: "2026-07",
        isLatePosting: false,
        branchId: randomUUID(),
        counterpartyName: null,
        paymentMethod: "CASH" as const,
        estimateStatus: "ACTUAL" as const,
        postedAt: new Date().toISOString(),
        rowVersion: 1,
        description: null,
        paymentReference: null,
        sourceReference: null,
        rejectedReason: null,
        reversesEntryId: null,
        reversedByEntryId: null,
        postings: [
          {
            lineNo: 1,
            amountMinor: 50000,
            assetId: randomUUID(),
            assetCode: "FIN-TRUCK-001",
            assetAttribution: "DIRECT" as const,
            category: { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel" },
          },
        ],
      };
      const parsed = financialEntryDetail.parse(detail);
      expect(parsed.postings).toHaveLength(1);
      expect(parsed.postings[0]!.lineNo).toBe(1);
    });

    it("parses pendingApprovalItem", () => {
      const item = {
        id: randomUUID(),
        entryNumber: "DLA-2026-00002",
        direction: "EXPENSE" as const,
        status: "SUBMITTED" as const,
        category: { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel" },
        amountMinor: 100000,
        currency: "XAF",
        economicDate: "2026-07-26",
        postingPeriodCode: null,
        isLatePosting: false,
        branchId: randomUUID(),
        counterpartyName: null,
        paymentMethod: "CASH" as const,
        estimateStatus: "ACTUAL" as const,
        postedAt: null,
        rowVersion: 1,
        submittedByPrincipalId: randomUUID(),
        submittedAt: new Date().toISOString(),
      };
      const parsed = pendingApprovalItem.parse(item);
      expect(parsed).toEqual(item);
    });

    it("parses periodRead", () => {
      const period = {
        periodCode: "2026-07",
        status: "OPEN" as const,
        lockedAt: null,
        entryCount: 5,
        rowVersion: 1,
      };
      const parsed = periodRead.parse(period);
      expect(parsed).toEqual(period);
    });
  });

  describe("serializeMinor", () => {
    it("converts small bigints to safe numbers", () => {
      expect(serializeMinor(75000n)).toBe(75000);
      expect(serializeMinor(-50000n)).toBe(-50000);
    });

    it("throws on overflow", () => {
      const overflow = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
      expect(() => serializeMinor(overflow)).toThrow();
    });
  });

  describe("GET /v1/finance/entries", () => {
    it("returns empty list initially", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/finance/entries",
        headers: { authorization: `Bearer ${allBranchesToken}` },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ entries: [], nextCursor: null });
    });

    it("creates and lists a posted expense", async () => {
      const entryId = randomUUID();
      const recordResponse = await ctx.app.inject({
        method: "POST",
        url: "/v1/commands/record-expense",
        headers: { authorization: `Bearer ${allBranchesToken}` },
        payload: {
          version: 1,
          envelope: {
            commandId: randomUUID(),
            idempotencyKey: `expense-${randomUUID()}`,
            origin: "HUMAN_UI",
          },
          payload: {
            entryId,
            branchCode: "DLA",
            categoryCode: "FUEL",
            economicDate: "2026-07-25",
            amountMinor: 50000,
            paymentMethod: "CASH",
            postings: [{ assetId, amountMinor: 50000 }],
          },
        },
      });
      expect(recordResponse.statusCode).toBe(200);

      const listResponse = await ctx.app.inject({
        method: "GET",
        url: "/v1/finance/entries",
        headers: { authorization: `Bearer ${allBranchesToken}` },
      });
      expect(listResponse.statusCode).toBe(200);
      const body = listResponse.json() as Record<string, unknown>;
      expect(Array.isArray(body.entries)).toBe(true);
      expect((body.entries as unknown[]).length).toBeGreaterThan(0);
      const ourEntry = (body.entries as Record<string, unknown>[]).find((e) => e.id === entryId);
      expect(ourEntry).toBeDefined();
      expect(ourEntry).toMatchObject({
        id: entryId,
        direction: "EXPENSE",
        status: "POSTED",
        amountMinor: 50000,
        currency: "XAF",
      });
    });

    it("filters by status", async () => {
      const postedOnlyResponse = await ctx.app.inject({
        method: "GET",
        url: "/v1/finance/entries?status=POSTED",
        headers: { authorization: `Bearer ${allBranchesToken}` },
      });
      expect(postedOnlyResponse.statusCode).toBe(200);
      const postedBody = postedOnlyResponse.json() as Record<string, unknown>;
      const postedEntries = postedBody.entries as Record<string, unknown>[];
      expect(postedEntries.every((e) => e.status === "POSTED")).toBe(true);
    });

    it("filters by scope: scoped member sees only their branches", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/finance/entries",
        headers: { authorization: `Bearer ${scopedToken}` },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as Record<string, unknown>;
      const entries = body.entries as Record<string, unknown>[];
      if (entries.length > 0) {
        expect(entries.every((e) => e.branchId === branchId)).toBe(true);
      }
    });

    it("rejects invalid status filter", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/finance/entries?status=INVALID",
        headers: { authorization: `Bearer ${allBranchesToken}` },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: { code: "VALIDATION_FAILED" } });
    });
  });

  describe("GET /v1/finance/entries/:entryId", () => {
    it("returns entry detail with postings", async () => {
      const entryId = randomUUID();
      await ctx.app.inject({
        method: "POST",
        url: "/v1/commands/record-expense",
        headers: { authorization: `Bearer ${allBranchesToken}` },
        payload: {
          version: 1,
          envelope: {
            commandId: randomUUID(),
            idempotencyKey: `expense-${randomUUID()}`,
            origin: "HUMAN_UI",
          },
          payload: {
            entryId,
            branchCode: "DLA",
            categoryCode: "FUEL",
            economicDate: "2026-07-27",
            amountMinor: 75000,
            paymentMethod: "CASH",
            postings: [{ assetId, amountMinor: 75000 }],
          },
        },
      });

      const response = await ctx.app.inject({
        method: "GET",
        url: `/v1/finance/entries/${entryId}`,
        headers: { authorization: `Bearer ${allBranchesToken}` },
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as Record<string, unknown>;
      expect(body.id).toBe(entryId);
      expect(body.status).toBe("POSTED");
      expect(Array.isArray(body.postings)).toBe(true);
      expect((body.postings as unknown[]).length).toBe(1);
      const posting = (body.postings as Record<string, unknown>[])[0]!;
      expect(posting).toMatchObject({
        lineNo: 1,
        amountMinor: 75000,
        assetId,
        assetCode: "FIN-TRUCK-001",
        assetAttribution: "DIRECT",
      });
      expect(body.reversesEntryId).toBeNull();
      expect(body.reversedByEntryId).toBeNull();
    });

    it("returns 404 for missing entry", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: `/v1/finance/entries/${randomUUID()}`,
        headers: { authorization: `Bearer ${allBranchesToken}` },
      });
      expect(response.statusCode).toBe(404);
      expect(response.json()).toEqual({ error: { code: "REFERENCE_NOT_FOUND" } });
    });

    it("rejects malformed entry id", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/finance/entries/not-a-uuid",
        headers: { authorization: `Bearer ${allBranchesToken}` },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: { code: "VALIDATION_FAILED" } });
    });
  });

  describe("GET /v1/finance/entries pagination", () => {
    /** Page size is fixed at 50 by the route. */
    const PAGE_SIZE = 50;
    /** Exactly one full page of POSTED entries, so the posted → null-postedAt
     * transition lands precisely on the page 1/2 boundary. */
    const POSTED_COUNT = 50;
    /** More than a page of SUBMITTED entries, so a second boundary is crossed
     * with a null-postedAt cursor. */
    const SUBMITTED_COUNT = 52;

    let pagedToken: string;
    const postedIds: string[] = [];
    const submittedIds: string[] = [];

    beforeAll(async () => {
      // Own workspace: the list read is workspace-scoped, so the 102 entries
      // here cannot perturb the other groups (or be perturbed by them).
      const seeded = await seedWorkspace(db);
      const submitter = await seedMember(db, {
        workspaceId: seeded.workspace.id,
        role: "FIELD_SUBMITTER",
        allBranches: true,
      });
      pagedToken = (
        await createSession(db, {
          principalId: submitter.principal.id,
          workspaceId: seeded.workspace.id,
        })
      ).token;

      // Below the 100_000 threshold a FIELD_SUBMITTER auto-approves → POSTED
      // with a postedAt. Above it the entry stays SUBMITTED with postedAt null.
      for (let index = 0; index < POSTED_COUNT; index += 1) {
        const { entryId, recordStatus } = await recordExpense(pagedToken, {
          amountMinor: 1_000 + index,
        });
        expect(recordStatus).toBe("POSTED");
        postedIds.push(entryId);
      }
      for (let index = 0; index < SUBMITTED_COUNT; index += 1) {
        const { entryId, recordStatus } = await recordExpense(pagedToken, {
          amountMinor: 200_000 + index,
        });
        expect(recordStatus).toBe("SUBMITTED");
        submittedIds.push(entryId);
      }
    });

    it("walks every page without duplicates or gaps", async () => {
      const pages = await walkEntries(pagedToken);
      const seen = pages.flat();

      expect(pages.map((page) => page.length)).toEqual([
        PAGE_SIZE,
        PAGE_SIZE,
        POSTED_COUNT + SUBMITTED_COUNT - 2 * PAGE_SIZE,
      ]);

      const seenIds = seen.map((entry) => entry.id);
      expect(new Set(seenIds).size).toBe(seenIds.length);
      expect(new Set(seenIds)).toEqual(new Set([...postedIds, ...submittedIds]));
    });

    it("keeps postedAt desc nulls last, id asc across page boundaries", async () => {
      const seen = (await walkEntries(pagedToken)).flat();

      for (let index = 1; index < seen.length; index += 1) {
        const previous = seen[index - 1]!;
        const current = seen[index]!;
        if (previous.postedAt === null) {
          // Nulls are last: nothing non-null may follow one.
          expect(current.postedAt).toBeNull();
          expect(current.id > previous.id).toBe(true);
        } else if (current.postedAt === null) {
          continue; // the single posted → null transition
        } else if (current.postedAt === previous.postedAt) {
          expect(current.id > previous.id).toBe(true);
        } else {
          expect(Date.parse(current.postedAt)).toBeLessThan(
            Date.parse(previous.postedAt),
          );
        }
      }
    });

    it("crosses the posted → null-postedAt boundary exactly once", async () => {
      const pages = await walkEntries(pagedToken);
      const [firstPage, secondPage, thirdPage] = pages;

      // Page 1 is the posted block, page 2 opens the null tail: the transition
      // is the page boundary, which is where a keyset cursor is most fragile.
      expect(firstPage!.every((entry) => entry.postedAt !== null)).toBe(true);
      expect(firstPage!.map((entry) => entry.id).sort()).toEqual(
        [...postedIds].sort(),
      );
      expect(secondPage!.every((entry) => entry.postedAt === null)).toBe(true);
      expect(thirdPage!.every((entry) => entry.postedAt === null)).toBe(true);
      expect(
        [...secondPage!, ...thirdPage!].map((entry) => entry.id).sort(),
      ).toEqual([...submittedIds].sort());
    });

    it("hands back a non-null cursor at the posted boundary and a null one inside the tail", async () => {
      const first = await fetchEntriesPage(pagedToken, null);
      expect(first.nextCursor).not.toBeNull();
      const firstCursor = decodeTestCursor(first.nextCursor!);
      expect(firstCursor.postedAt).not.toBeNull();
      expect(firstCursor.id).toBe(first.entries[PAGE_SIZE - 1]!.id);

      const second = await fetchEntriesPage(pagedToken, first.nextCursor);
      expect(second.nextCursor).not.toBeNull();
      const secondCursor = decodeTestCursor(second.nextCursor!);
      expect(secondCursor.postedAt).toBeNull();
      expect(secondCursor.id).toBe(second.entries[PAGE_SIZE - 1]!.id);

      const third = await fetchEntriesPage(pagedToken, second.nextCursor);
      expect(third.nextCursor).toBeNull();
    });
  });

  describe("GET /v1/finance/entries/:entryId reversal chain", () => {
    it("links the original and its mirror in both directions", async () => {
      const { entryId: originalEntryId, rowVersion } = await recordExpense(
        allBranchesToken,
        { amountMinor: 45_000, economicDate: "2026-07-28", assetId },
      );

      const reversalEntryId = randomUUID();
      const reversal = await ctx.app.inject({
        method: "POST",
        url: "/v1/commands/reverse-entry",
        headers: { authorization: `Bearer ${allBranchesToken}` },
        payload: {
          version: 1,
          envelope: {
            commandId: randomUUID(),
            idempotencyKey: `reverse-${randomUUID()}`,
            origin: "HUMAN_UI",
            expectedVersion: rowVersion,
          },
          payload: {
            reversalEntryId,
            originalEntryId,
            reason: "duplicate capture",
          },
        },
      });
      expect(reversal.statusCode).toBe(200);
      expect(reversal.json()).toMatchObject({
        recordId: reversalEntryId,
        recordStatus: "POSTED",
      });

      const original = await fetchEntryDetail(allBranchesToken, originalEntryId);
      expect(original.status).toBe("REVERSED");
      expect(original.amountMinor).toBe(45_000);
      expect(original.reversesEntryId).toBeNull();
      expect(original.reversedByEntryId).toBe(reversalEntryId);

      const mirror = await fetchEntryDetail(allBranchesToken, reversalEntryId);
      expect(mirror.status).toBe("POSTED");
      expect(mirror.amountMinor).toBe(-45_000);
      expect(mirror.reversesEntryId).toBe(originalEntryId);
      expect(mirror.reversedByEntryId).toBeNull();
      expect(mirror.entryNumber).not.toBe(original.entryNumber);
      expect(mirror.postings).toEqual([
        {
          lineNo: 1,
          amountMinor: -45_000,
          assetId,
          assetCode: "FIN-TRUCK-001",
          assetAttribution: "DIRECT",
          category: original.postings[0]!.category,
        },
      ]);
    });
  });

  describe("GET /v1/finance/approvals", () => {
    let submitterPrincipalId: string;
    let submitterToken: string;
    let approverAllToken: string;
    let approverScopedToken: string;
    let dlaBranchId: string;
    let ydeBranchId: string;
    const inScopeIds: string[] = [];
    let outOfScopeId: string;

    beforeAll(async () => {
      const seeded = await seedWorkspace(db);
      const approvalsWorkspaceId = seeded.workspace.id;
      dlaBranchId = seeded.branch.id;

      const [otherBranch] = await db
        .insert(branches)
        .values({
          workspaceId: approvalsWorkspaceId,
          code: "YDE",
          name: "Yaoundé",
        })
        .returning();
      if (!otherBranch) throw new Error("branch insert returned no row");
      ydeBranchId = otherBranch.id;

      const submitter = await seedMember(db, {
        workspaceId: approvalsWorkspaceId,
        role: "FIELD_SUBMITTER",
        allBranches: true,
      });
      submitterPrincipalId = submitter.principal.id;
      submitterToken = (
        await createSession(db, {
          principalId: submitterPrincipalId,
          workspaceId: approvalsWorkspaceId,
        })
      ).token;

      const approverAll = await seedMember(db, {
        workspaceId: approvalsWorkspaceId,
        role: "FINANCE_APPROVER",
        allBranches: true,
      });
      approverAllToken = (
        await createSession(db, {
          principalId: approverAll.principal.id,
          workspaceId: approvalsWorkspaceId,
        })
      ).token;

      const approverScoped = await seedMember(db, {
        workspaceId: approvalsWorkspaceId,
        role: "FINANCE_APPROVER",
        allBranches: false,
        branchIds: [dlaBranchId],
      });
      approverScopedToken = (
        await createSession(db, {
          principalId: approverScoped.principal.id,
          workspaceId: approvalsWorkspaceId,
        })
      ).token;

      // Above the 100_000 threshold a FIELD_SUBMITTER cannot auto-approve, so
      // these land SUBMITTED. Spaced so createdAt ordering is unambiguous.
      const first = await recordExpense(submitterToken, {
        amountMinor: 150_000,
        branchCode: "DLA",
      });
      await tick();
      const second = await recordExpense(submitterToken, {
        amountMinor: 200_000,
        branchCode: "YDE",
      });
      await tick();
      const third = await recordExpense(submitterToken, {
        amountMinor: 250_000,
        branchCode: "DLA",
      });
      for (const created of [first, second, third]) {
        expect(created.recordStatus).toBe("SUBMITTED");
      }
      inScopeIds.push(first.entryId, third.entryId);
      outOfScopeId = second.entryId;
    });

    it("returns submitted entries oldest first with their submitter", async () => {
      const body = await fetchApprovals(approverAllToken);

      expect(body.total).toBe(3);
      expect(body.entries).toHaveLength(3);
      expect(body.entries.every((entry) => entry.status === "SUBMITTED")).toBe(
        true,
      );
      expect(
        body.entries.every(
          (entry) => entry.submittedByPrincipalId === submitterPrincipalId,
        ),
      ).toBe(true);
      expect(body.entries.map((entry) => entry.id)).toEqual([
        inScopeIds[0],
        outOfScopeId,
        inScopeIds[1],
      ]);
      const submittedAt = body.entries.map((entry) =>
        Date.parse(entry.submittedAt),
      );
      expect(submittedAt[0]!).toBeLessThan(submittedAt[1]!);
      expect(submittedAt[1]!).toBeLessThan(submittedAt[2]!);
    });

    it("scopes entries and total to a branch-scoped approver", async () => {
      const body = await fetchApprovals(approverScopedToken);

      expect(body.total).toBe(2);
      expect(body.entries.map((entry) => entry.id)).toEqual(inScopeIds);
      expect(body.entries.every((entry) => entry.branchId === dlaBranchId)).toBe(
        true,
      );
      expect(body.entries.some((entry) => entry.branchId === ydeBranchId)).toBe(
        false,
      );
    });

    it("does not hide the caller's own submissions (maker guard is client-side)", async () => {
      const body = await fetchApprovals(submitterToken);

      expect(body.total).toBe(3);
      expect(body.entries.map((entry) => entry.id).sort()).toEqual(
        [...inScopeIds, outOfScopeId].sort(),
      );
    });
  });

  describe("GET /v1/finance/periods", () => {
    let periodsAdminToken: string;
    let periodsSubmitterToken: string;

    beforeAll(async () => {
      const seeded = await seedWorkspace(db);
      const periodsWorkspaceId = seeded.workspace.id;

      const admin = await seedMember(db, {
        workspaceId: periodsWorkspaceId,
        role: "ADMIN",
        allBranches: true,
      });
      periodsAdminToken = (
        await createSession(db, {
          principalId: admin.principal.id,
          workspaceId: periodsWorkspaceId,
        })
      ).token;

      const submitter = await seedMember(db, {
        workspaceId: periodsWorkspaceId,
        role: "FIELD_SUBMITTER",
        allBranches: true,
      });
      periodsSubmitterToken = (
        await createSession(db, {
          principalId: submitter.principal.id,
          workspaceId: periodsWorkspaceId,
        })
      ).token;

      // Two POSTED into 2026-05, one POSTED into 2026-06, plus one SUBMITTED
      // dated in 2026-05 — the latter has no posting period and must not count.
      for (const economicDate of ["2026-05-15", "2026-05-20", "2026-06-10"]) {
        const created = await recordExpense(periodsAdminToken, {
          amountMinor: 30_000,
          economicDate,
        });
        expect(created.recordStatus).toBe("POSTED");
      }
      const submitted = await recordExpense(periodsSubmitterToken, {
        amountMinor: 500_000,
        economicDate: "2026-05-25",
      });
      expect(submitted.recordStatus).toBe("SUBMITTED");
    });

    it("lists auto-created periods with their POSTED entry counts", async () => {
      const body = await fetchPeriods(periodsAdminToken);

      expect(body.periods.map((period) => period.periodCode)).toEqual([
        "2026-06",
        "2026-05",
      ]);
      expect(body.periods.find((period) => period.periodCode === "2026-05")).toEqual(
        {
          periodCode: "2026-05",
          status: "OPEN",
          lockedAt: null,
          entryCount: 2,
          rowVersion: 1,
        },
      );
      expect(
        body.periods.find((period) => period.periodCode === "2026-06")?.entryCount,
      ).toBe(1);
    });

    it("reflects a lock-period.v1 lock", async () => {
      const before = await fetchPeriods(periodsAdminToken);
      const target = before.periods.find(
        (period) => period.periodCode === "2026-05",
      );
      if (!target) throw new Error("2026-05 period missing");

      const locked = await ctx.app.inject({
        method: "POST",
        url: "/v1/commands/lock-period",
        headers: { authorization: `Bearer ${periodsAdminToken}` },
        payload: {
          version: 1,
          envelope: {
            commandId: randomUUID(),
            idempotencyKey: `lock-${randomUUID()}`,
            origin: "HUMAN_UI",
            expectedVersion: target.rowVersion,
          },
          payload: { periodCode: "2026-05" },
        },
      });
      expect(locked.statusCode).toBe(200);
      expect(locked.json()).toMatchObject({
        recordStatus: "LOCKED",
        warnings: ["PERIOD_HAS_SUBMITTED_ENTRIES"],
      });

      const after = await fetchPeriods(periodsAdminToken);
      const lockedPeriod = after.periods.find(
        (period) => period.periodCode === "2026-05",
      );
      expect(lockedPeriod?.status).toBe("LOCKED");
      expect(lockedPeriod?.lockedAt).not.toBeNull();
      expect(Number.isNaN(Date.parse(lockedPeriod?.lockedAt ?? ""))).toBe(false);
      expect(lockedPeriod?.rowVersion).toBe(target.rowVersion + 1);
      expect(lockedPeriod?.entryCount).toBe(2);
    });
  });

  async function recordExpense(
    token: string,
    opts: {
      amountMinor: number;
      economicDate?: string;
      branchCode?: string;
      assetId?: string;
    },
  ) {
    const entryId = randomUUID();
    const response = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/record-expense",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `expense-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload: {
          entryId,
          branchCode: opts.branchCode ?? "DLA",
          categoryCode: "FUEL",
          economicDate: opts.economicDate ?? "2026-07-25",
          amountMinor: opts.amountMinor,
          paymentMethod: "CASH",
          postings: [
            opts.assetId === undefined
              ? { amountMinor: opts.amountMinor }
              : { assetId: opts.assetId, amountMinor: opts.amountMinor },
          ],
        },
      },
    });
    if (response.statusCode !== 200) {
      throw new Error(
        `record-expense failed: ${response.statusCode} ${response.body}`,
      );
    }
    const body = response.json() as { recordStatus: string; rowVersion: number };
    return { entryId, recordStatus: body.recordStatus, rowVersion: body.rowVersion };
  }

  async function fetchEntriesPage(token: string, cursor: string | null) {
    const response = await ctx.app.inject({
      method: "GET",
      url:
        cursor === null
          ? "/v1/finance/entries"
          : `/v1/finance/entries?cursor=${encodeURIComponent(cursor)}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    return financialEntryListResponse.parse(response.json());
  }

  /** Follows nextCursor to exhaustion, returning one array per page. */
  async function walkEntries(token: string) {
    const pages: (typeof financialEntryListResponse._output)["entries"][] = [];
    let cursor: string | null = null;
    do {
      const page = await fetchEntriesPage(token, cursor);
      pages.push(page.entries);
      cursor = page.nextCursor;
      if (pages.length > 10) throw new Error("cursor walk did not terminate");
    } while (cursor !== null);
    return pages;
  }

  function decodeTestCursor(cursor: string): {
    postedAt: string | null;
    id: string;
  } {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  }

  async function fetchEntryDetail(token: string, entryId: string) {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/v1/finance/entries/${entryId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    return financialEntryDetail.parse(response.json());
  }

  async function fetchApprovals(token: string) {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/v1/finance/approvals",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    return pendingApprovalsResponse.parse(response.json());
  }

  async function fetchPeriods(token: string) {
    const response = await ctx.app.inject({
      method: "GET",
      url: "/v1/finance/periods",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    return periodsResponse.parse(response.json());
  }
});

/** Guarantees the next createdAt lands on a later millisecond. */
function tick() {
  return new Promise((resolve) => setTimeout(resolve, 2));
}
