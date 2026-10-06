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
import {
  branches,
  categories,
  commands,
  financialEntries,
  financialPostings,
  principals,
} from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { plantWorkOrderRevenue, seedAsset, seedMember, seedWorkspace } from "../test/seed.js";
import { and, eq } from "drizzle-orm";
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
      role: "DIRECTOR",
      allBranches: true,
    });
    allBranchesToken = (
      await createSession(db, { principalId: admin.principal.id, workspaceId })
    ).token;

    const scoped = await seedMember(db, {
      workspaceId,
      role: "FINANCE",
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
    /** The #44 and #87 fields every entry row carries. */
    const vehicleFields = {
      reversesEntryId: null,
      recordedBy: { principalId: randomUUID(), displayName: "Sali", scope: "WORKSPACE" as const },
      evidence: { state: "NOT_SUPPLIED" as const, artifactCount: 0 },
      assetShareMinor: null,
      assetLinks: null,
      links: { activityId: null, activityNumber: null, workOrderId: null, workOrderAssetId: null },
    };

    it("parses financialEntryListItem", () => {
      const item = {
        id: randomUUID(),
        entryNumber: "DLA-2026-00001",
        direction: "EXPENSE" as const,
        status: "POSTED" as const,
        category: { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel", layer: "DIRECT" as const },
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
        ...vehicleFields,
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
            category: { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel", layer: "DIRECT" as const },
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
            ...vehicleFields,
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
        category: { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel", layer: "DIRECT" as const },
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
        ...vehicleFields,
        description: null,
        paymentReference: null,
        sourceReference: null,
        rejectedReason: null,
        reversedByEntryId: null,
        cancellation: null,
        evidenceFiles: [],
        postings: [
          {
            lineNo: 1,
            amountMinor: 50000,
            assetId: randomUUID(),
            assetCode: "FIN-TRUCK-001",
            assetAttribution: "DIRECT" as const,
            activityId: null,
            workOrderId: null,
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
        category: { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel", layer: "DIRECT" as const },
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
        ...vehicleFields,
        submittedByPrincipalId: randomUUID(),
        submittedAt: new Date().toISOString(),
        directionDecides: false,
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
    it("returns entry detail with asset-less posting", async () => {
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
            amountMinor: 50000,
            paymentMethod: "CASH",
            postings: [{ amountMinor: 50000 }],
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
        amountMinor: 50000,
        assetId: null,
        assetCode: null,
        assetAttribution: "DIRECT",
      });
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
        role: "DRIVER",
        allBranches: true,
      });
      pagedToken = (
        await createSession(db, {
          principalId: submitter.principal.id,
          workspaceId: seeded.workspace.id,
        })
      ).token;

      // Below the 100_000 threshold a DRIVER auto-approves → POSTED
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
      expect(firstCursor).toMatchObject({ field: "postedAt", direction: "desc" });
      expect(firstCursor.value).not.toBeNull();
      expect(firstCursor.id).toBe(first.entries[PAGE_SIZE - 1]!.id);

      const second = await fetchEntriesPage(pagedToken, first.nextCursor);
      expect(second.nextCursor).not.toBeNull();
      const secondCursor = decodeTestCursor(second.nextCursor!);
      expect(secondCursor.value).toBeNull();
      expect(secondCursor.id).toBe(second.entries[PAGE_SIZE - 1]!.id);

      const third = await fetchEntriesPage(pagedToken, second.nextCursor);
      expect(third.nextCursor).toBeNull();
    });
  });

  describe("GET /v1/finance/entries?assetId", () => {
    let assetToken: string;
    let trackedAssetId: string;
    let otherAssetId: string;
    const trackedEntryIds: string[] = [];
    const otherEntryIds: string[] = [];

    beforeAll(async () => {
      // Own workspace: the asset filter must not have to compete with the
      // entries the other groups post against their own assets.
      const seeded = await seedWorkspace(db);
      const admin = await seedMember(db, {
        workspaceId: seeded.workspace.id,
        role: "ADMIN",
        allBranches: true,
      });
      assetToken = (
        await createSession(db, {
          principalId: admin.principal.id,
          workspaceId: seeded.workspace.id,
        })
      ).token;

      trackedAssetId = await registerAsset(assetToken, "ASSET-FILTER-001");
      otherAssetId = await registerAsset(assetToken, "ASSET-FILTER-002");

      // Five on the tracked asset, then two decoys the filter must exclude:
      // one on a sibling asset, one with no asset at all.
      for (let index = 0; index < 5; index += 1) {
        const created = await recordExpense(assetToken, {
          amountMinor: 10_000 + index,
          assetId: trackedAssetId,
        });
        expect(created.recordStatus).toBe("POSTED");
        trackedEntryIds.push(created.entryId);
      }
      otherEntryIds.push(
        (
          await recordExpense(assetToken, {
            amountMinor: 20_000,
            assetId: otherAssetId,
          })
        ).entryId,
        (await recordExpense(assetToken, { amountMinor: 20_001 })).entryId,
      );
    });

    it("returns only entries posted against that asset", async () => {
      const body = await fetchEntriesPage(assetToken, null, {
        assetId: trackedAssetId,
      });

      expect(body.entries.map((entry) => entry.id).sort()).toEqual(
        [...trackedEntryIds].sort(),
      );
      expect(
        body.entries.some((entry) => otherEntryIds.includes(entry.id)),
      ).toBe(false);
      expect(body.nextCursor).toBeNull();
    });

    it("composes with cursor pagination", async () => {
      const pages: string[][] = [];
      let cursor: string | null = null;
      do {
        const page = await fetchEntriesPage(assetToken, cursor, {
          assetId: trackedAssetId,
          limit: "2",
        });
        pages.push(page.entries.map((entry) => entry.id));
        cursor = page.nextCursor;
        if (pages.length > 5) throw new Error("cursor walk did not terminate");
      } while (cursor !== null);

      expect(pages.map((page) => page.length)).toEqual([2, 2, 1]);
      const seenIds = pages.flat();
      expect(new Set(seenIds).size).toBe(seenIds.length);
      expect(new Set(seenIds)).toEqual(new Set(trackedEntryIds));
    });

    it("returns an empty page for an asset in another workspace", async () => {
      const body = await fetchEntriesPage(assetToken, null, { assetId });

      expect(body.entries).toEqual([]);
      expect(body.nextCursor).toBeNull();
    });

    it("rejects a malformed asset id", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/finance/entries?assetId=not-a-uuid",
        headers: { authorization: `Bearer ${assetToken}` },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: { code: "VALIDATION_FAILED" } });
    });
  });

  describe("GET /v1/finance/entries?sort", () => {
    let sortToken: string;
    /** Ids in creation order, which is also entryNumber and postedAt order. */
    const created: string[] = [];
    /** Amounts and dates are deliberately shuffled against creation order, so
     * a page walk that silently fell back to the default order would fail. */
    const fixture = [
      { amountMinor: 5_000, economicDate: "2026-03-02" },
      { amountMinor: 1_000, economicDate: "2026-03-06" },
      { amountMinor: 6_000, economicDate: "2026-03-01" },
      { amountMinor: 2_000, economicDate: "2026-03-05" },
      { amountMinor: 4_000, economicDate: "2026-03-03" },
      { amountMinor: 3_000, economicDate: "2026-03-04" },
    ];

    beforeAll(async () => {
      // Own workspace: six rows exactly, so a limit=2 walk is three full pages.
      const seeded = await seedWorkspace(db);
      const submitter = await seedMember(db, {
        workspaceId: seeded.workspace.id,
        role: "DRIVER",
        allBranches: true,
      });
      sortToken = (
        await createSession(db, {
          principalId: submitter.principal.id,
          workspaceId: seeded.workspace.id,
        })
      ).token;

      for (const row of fixture) {
        // Below the auto-approval threshold, so every row posts and postedAt
        // is a total order rather than a null tail.
        const entry = await recordExpense(sortToken, row);
        expect(entry.recordStatus).toBe("POSTED");
        created.push(entry.entryId);
        await tick();
      }
    });

    /** The order the server must produce, derived independently of the API. */
    function expectedAscending(field: string): string[] {
      const indexed = fixture.map((row, index) => ({ ...row, index }));
      const by = (compare: (a: typeof indexed[number], b: typeof indexed[number]) => number) =>
        [...indexed].sort(compare).map((row) => created[row.index]!);

      switch (field) {
        case "amount":
          return by((a, b) => a.amountMinor - b.amountMinor);
        case "economicDate":
          return by((a, b) => a.economicDate.localeCompare(b.economicDate));
        default:
          // entryNumber is assigned sequentially and postedAt advances with it.
          return [...created];
      }
    }

    async function walkSorted(sort: string) {
      const pages: string[][] = [];
      let cursor: string | null = null;
      do {
        const page = await fetchEntriesPage(sortToken, cursor, {
          sort,
          limit: "2",
        });
        pages.push(page.entries.map((entry) => entry.id));
        cursor = page.nextCursor;
        if (pages.length > 6) throw new Error("cursor walk did not terminate");
      } while (cursor !== null);
      return pages;
    }

    async function entriesResponse(params: Record<string, string>) {
      return ctx.app.inject({
        method: "GET",
        url: `/v1/finance/entries?${new URLSearchParams(params).toString()}`,
        headers: { authorization: `Bearer ${sortToken}` },
      });
    }

    const sortFields = ["economicDate", "postedAt", "amount", "entryNumber"];

    it.each(sortFields)(
      "walks %s ascending across three pages with no gaps or duplicates",
      async (field) => {
        const pages = await walkSorted(`${field}:asc`);

        expect(pages.map((page) => page.length)).toEqual([2, 2, 2]);
        const seen = pages.flat();
        expect(seen).toEqual(expectedAscending(field));
        expect(new Set(seen).size).toBe(seen.length);
      },
    );

    it.each(sortFields)(
      "walks %s descending across three pages with no gaps or duplicates",
      async (field) => {
        const pages = await walkSorted(`${field}:desc`);

        expect(pages.map((page) => page.length)).toEqual([2, 2, 2]);
        const seen = pages.flat();
        expect(seen).toEqual([...expectedAscending(field)].reverse());
        expect(new Set(seen).size).toBe(seen.length);
      },
    );

    it("rejects a cursor minted under a different sort field", async () => {
      const first = await fetchEntriesPage(sortToken, null, {
        sort: "amount:asc",
        limit: "2",
      });
      expect(first.nextCursor).not.toBeNull();

      const response = await entriesResponse({
        sort: "economicDate:asc",
        limit: "2",
        cursor: first.nextCursor!,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: { code: "VALIDATION_FAILED" } });
    });

    it("rejects a cursor minted under the opposite direction", async () => {
      const first = await fetchEntriesPage(sortToken, null, {
        sort: "amount:asc",
        limit: "2",
      });

      const response = await entriesResponse({
        sort: "amount:desc",
        limit: "2",
        cursor: first.nextCursor!,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: { code: "VALIDATION_FAILED" } });
    });

    it("rejects a sort over an undeclared field", async () => {
      const response = await entriesResponse({ sort: "counterpartyName:asc" });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: { code: "VALIDATION_FAILED" } });
    });

    it("names the active sort in the cursor it hands back", async () => {
      const first = await fetchEntriesPage(sortToken, null, {
        sort: "amount:desc",
        limit: "2",
      });

      expect(decodeTestCursor(first.nextCursor!)).toEqual({
        field: "amount",
        direction: "desc",
        value: "5000",
        id: first.entries[1]!.id,
      });
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
          activityId: null,
          workOrderId: null,
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
        role: "DRIVER",
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
        role: "FINANCE",
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
        role: "FINANCE",
        allBranches: false,
        branchIds: [dlaBranchId],
      });
      approverScopedToken = (
        await createSession(db, {
          principalId: approverScoped.principal.id,
          workspaceId: approvalsWorkspaceId,
        })
      ).token;

      // Above the 100_000 threshold a DRIVER cannot auto-approve, so
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

    it("narrows entries and total to a client-chosen branch", async () => {
      const body = await fetchApprovals(approverAllToken, {
        branchId: dlaBranchId,
      });

      // The queue defaults to every branch in scope; this filter is the
      // approver's own visible narrowing, and `total` follows it exactly so the
      // dashboard card and the queue cannot disagree.
      expect(body.total).toBe(2);
      expect(body.entries.map((entry) => entry.id)).toEqual(inScopeIds);
      expect(body.entries.every((entry) => entry.branchId === dlaBranchId)).toBe(
        true,
      );
    });

    it("cannot widen a scoped approver past their membership", async () => {
      const body = await fetchApprovals(approverScopedToken, {
        branchId: ydeBranchId,
      });

      // The client filter intersects `auth.branchScope`; it never replaces it.
      expect(body.total).toBe(0);
      expect(body.entries).toEqual([]);
    });

    it("reports the pending work its branch filter is hiding", async () => {
      const body = await fetchApprovals(approverAllToken, {
        branchId: dlaBranchId,
      });

      // The queue narrowed to DLA, so YDE's submission is off screen. Counting
      // it is what keeps the narrowing from hiding work nobody decides.
      expect(body.total).toBe(2);
      expect(body.outsideBranchCount).toBe(1);
    });

    it("reports no overflow when the queue spans every branch in scope", async () => {
      const body = await fetchApprovals(approverAllToken);

      expect(body.outsideBranchCount).toBe(0);
    });

    it("counts the overflow inside the caller's scope only", async () => {
      const body = await fetchApprovals(approverScopedToken, {
        branchId: dlaBranchId,
      });

      // YDE is outside this approver's membership: it is not work they could
      // widen to, so it is not work the queue offers to show them.
      expect(body.total).toBe(2);
      expect(body.outsideBranchCount).toBe(0);
    });

    it("refuses the queue to the driver who submitted to it (#264)", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/finance/approvals",
        headers: { authorization: `Bearer ${submitterToken}` },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: { code: "ROLE_FORBIDDEN" } });
    });
  });

  describe("GET /v1/finance/approvals pagination and sorting", () => {
    let queueToken: string;
    /** Ids oldest first — submittedAt order, and entryNumber order with it. */
    const queued: string[] = [];
    /** Above the auto-approval threshold so every row stays SUBMITTED; the
     * amounts are shuffled against submission order on purpose. */
    const amounts = [150_000, 500_000, 300_000, 600_000, 200_000, 400_000];

    beforeAll(async () => {
      const seeded = await seedWorkspace(db);
      const session = async (role: "DRIVER" | "FINANCE") => {
        const member = await seedMember(db, {
          workspaceId: seeded.workspace.id,
          role,
          allBranches: true,
        });
        return (
          await createSession(db, {
            principalId: member.principal.id,
            workspaceId: seeded.workspace.id,
          })
        ).token;
      };
      // The driver submits inside its band; the books read the queue.
      const submitterToken = await session("DRIVER");
      queueToken = await session("FINANCE");

      for (const amountMinor of amounts) {
        const entry = await recordExpense(submitterToken, { amountMinor });
        expect(entry.recordStatus).toBe("SUBMITTED");
        queued.push(entry.entryId);
        await tick();
      }
    });

    function expectedAscending(field: string): string[] {
      if (field !== "amount") return [...queued];
      return amounts
        .map((amountMinor, index) => ({ amountMinor, index }))
        .sort((a, b) => a.amountMinor - b.amountMinor)
        .map((row) => queued[row.index]!);
    }

    async function walkSorted(sort: string) {
      const pages: string[][] = [];
      let cursor: string | null = null;
      do {
        const page = await fetchApprovals(queueToken, {
          sort,
          limit: "2",
          ...(cursor === null ? {} : { cursor }),
        });
        // The queue count is the queue, never the page in hand.
        expect(page.total).toBe(amounts.length);
        pages.push(page.entries.map((entry) => entry.id));
        cursor = page.nextCursor;
        if (pages.length > 6) throw new Error("cursor walk did not terminate");
      } while (cursor !== null);
      return pages;
    }

    async function approvalsResponse(params: Record<string, string>) {
      return ctx.app.inject({
        method: "GET",
        url: `/v1/finance/approvals?${new URLSearchParams(params).toString()}`,
        headers: { authorization: `Bearer ${queueToken}` },
      });
    }

    const sortFields = ["submittedAt", "amount", "entryNumber"];

    it("answers a paramless call with the whole queue, oldest first", async () => {
      const body = await fetchApprovals(queueToken);

      expect(body.entries.map((entry) => entry.id)).toEqual(queued);
      expect(body.total).toBe(amounts.length);
      expect(body.nextCursor).toBeNull();
    });

    it.each(sortFields)(
      "walks %s ascending across three pages with no gaps or duplicates",
      async (field) => {
        const pages = await walkSorted(`${field}:asc`);

        expect(pages.map((page) => page.length)).toEqual([2, 2, 2]);
        const seen = pages.flat();
        expect(seen).toEqual(expectedAscending(field));
        expect(new Set(seen).size).toBe(seen.length);
      },
    );

    it.each(sortFields)(
      "walks %s descending across three pages with no gaps or duplicates",
      async (field) => {
        const pages = await walkSorted(`${field}:desc`);

        expect(pages.map((page) => page.length)).toEqual([2, 2, 2]);
        const seen = pages.flat();
        expect(seen).toEqual([...expectedAscending(field)].reverse());
        expect(new Set(seen).size).toBe(seen.length);
      },
    );

    it("reports the same total on every page of a walk", async () => {
      const first = await fetchApprovals(queueToken, { limit: "2" });
      const second = await fetchApprovals(queueToken, {
        limit: "2",
        cursor: first.nextCursor!,
      });

      expect(first.entries).toHaveLength(2);
      expect(first.total).toBe(amounts.length);
      expect(second.total).toBe(first.total);
    });

    it("rejects a cursor minted under a different sort", async () => {
      const first = await fetchApprovals(queueToken, {
        sort: "amount:asc",
        limit: "2",
      });

      const response = await approvalsResponse({
        sort: "submittedAt:asc",
        limit: "2",
        cursor: first.nextCursor!,
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: { code: "VALIDATION_FAILED" } });
    });

    it("rejects a tampered cursor and an undeclared sort field", async () => {
      const tampered = await approvalsResponse({ cursor: "not-a-cursor" });
      expect(tampered.statusCode).toBe(400);
      expect(tampered.json()).toEqual({ error: { code: "VALIDATION_FAILED" } });

      const unsortable = await approvalsResponse({ sort: "branchId:asc" });
      expect(unsortable.statusCode).toBe(400);
      expect(unsortable.json()).toEqual({ error: { code: "VALIDATION_FAILED" } });
    });

    it("rejects a limit above the ceiling this queue publishes", async () => {
      const response = await approvalsResponse({ limit: "101" });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: { code: "VALIDATION_FAILED" } });
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
        role: "DIRECTOR",
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
        role: "DRIVER",
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

  async function registerAsset(token: string, assetCode: string) {
    const registeredAssetId = randomUUID();
    const response = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/register-asset",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `asset-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload: {
          assetId: registeredAssetId,
          assetCode,
          assetClassCode: "TRUCK",
          templateCode: "TRUCKING",
          branchCode: "DLA",
        },
      },
    });
    if (response.statusCode !== 200) {
      throw new Error(
        `register-asset failed: ${response.statusCode} ${response.body}`,
      );
    }
    return registeredAssetId;
  }

  async function fetchEntriesPage(
    token: string,
    cursor: string | null,
    filters: Record<string, string> = {},
  ) {
    const query = new URLSearchParams(filters);
    if (cursor !== null) {
      query.set("cursor", cursor);
    }
    const search = query.toString();
    const response = await ctx.app.inject({
      method: "GET",
      url: search === ""
        ? "/v1/finance/entries"
        : `/v1/finance/entries?${search}`,
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
    field: string;
    direction: "asc" | "desc";
    value: string | number | null;
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

  async function fetchApprovals(
    token: string,
    params: Record<string, string> = {},
  ) {
    const search = new URLSearchParams(params).toString();
    const response = await ctx.app.inject({
      method: "GET",
      url: search === ""
        ? "/v1/finance/approvals"
        : `/v1/finance/approvals?${search}`,
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

/**
 * The entry fields the vehicle workspace reads (#44): who recorded it, its
 * evidence, its category's layer, and — under an asset filter — the vehicle's
 * share and links. Plus the two new filters.
 */
describe("finance entry fields for the vehicle workspace", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let workspaceId: string;
  let branchId: string;
  let admin: Actor;
  let driver: Actor;
  let truckA: string;
  let truckB: string;
  let splitEntryId: string;
  let jobNumber: string;
  let jobId: string;
  let workOrderId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    branchId = seeded.branch.id;
    admin = await seedActor(ctx.db, { workspaceId, role: "ADMIN", displayName: "Émilienne" });
    driver = await seedActor(ctx.db, { workspaceId, role: "DRIVER", displayName: "Sali" });
    truckA = await seedAsset(ctx.app, admin.token, { assetCode: "SPLIT-A" });
    truckB = await seedAsset(ctx.app, admin.token, { assetCode: "SPLIT-B" });

    jobId = randomUUID();
    await api.ok(admin.token, "create-activity", {
      activityId: jobId,
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      templateCode: "TRUCKING",
      primarySegmentId: randomUUID(),
      primaryAssetId: truckA,
      startedAt: "2026-08-01T06:00:00Z",
    });
    jobNumber = ((await api.get(admin.token, `/v1/activities/${jobId}`)).body as {
      activityNumber: string;
    }).activityNumber;
    workOrderId = randomUUID();
    await api.ok(admin.token, "create-work-order", {
      workOrderId,
      assetId: truckA,
      description: "Plaquettes",
      expectedCostMinor: 0,
    });

    // 100 000 split 60 000 / 40 000 across two trucks, the A line carrying
    // both a job and a work order.
    splitEntryId = randomUUID();
    await api.ok(admin.token, "record-expense", {
      entryId: splitEntryId,
      branchCode: "DLA",
      categoryCode: "REPAIRS",
      economicDate: "2026-08-20",
      amountMinor: 100_000,
      paymentMethod: "CASH",
      postings: [
        { assetId: truckA, activityId: jobId, workOrderId, amountMinor: 60_000 },
        { assetId: truckB, amountMinor: 40_000 },
      ],
    });
    await api.ok(driver.token, "record-expense", {
      entryId: randomUUID(),
      branchCode: "DLA",
      categoryCode: "TOLLS",
      economicDate: "2026-07-31",
      amountMinor: 2_000,
      paymentMethod: "CASH",
      postings: [{ assetId: truckA, amountMinor: 2_000 }],
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function entries(query: string, token = admin.token) {
    const response = await api.get(token, `/v1/finance/entries${query}`);
    expect(response.status).toBe(200);
    return financialEntryListResponse.parse(response.body).entries;
  }

  it("gives the vehicle's share and links under an asset filter", async () => {
    const onA = await entries(`?assetId=${truckA}`);
    expect(onA.find((entry) => entry.id === splitEntryId)).toMatchObject({
      amountMinor: 100_000,
      assetShareMinor: 60_000,
      assetLinks: { activityId: jobId, activityNumber: jobNumber, workOrderId },
      category: { code: "REPAIRS", layer: "MAINTENANCE" },
      recordedBy: { principalId: admin.principalId, displayName: "Émilienne", scope: "WORKSPACE" },
      evidence: { state: "NOT_SUPPLIED", artifactCount: 0 },
      reversesEntryId: null,
    });
    const onB = await entries(`?assetId=${truckB}`);
    expect(onB.find((entry) => entry.id === splitEntryId)).toMatchObject({
      assetShareMinor: 40_000,
      assetLinks: { activityId: null, activityNumber: null, workOrderId: null },
    });
  });

  it("leaves share and links null without an asset filter", async () => {
    const all = await entries("");
    expect(all.find((entry) => entry.id === splitEntryId)).toMatchObject({
      assetShareMinor: null,
      assetLinks: null,
    });
  });

  it("names the trip and work order of every entry without a filter (#87)", async () => {
    const all = await entries("");
    expect(all.find((entry) => entry.id === splitEntryId)?.links).toEqual({
      activityId: jobId,
      activityNumber: jobNumber,
      workOrderId,
      workOrderAssetId: truckA,
    });
    const tolls = all.find((entry) => entry.category.code === "TOLLS");
    expect(tolls?.links).toEqual({
      activityId: null,
      activityNumber: null,
      workOrderId: null,
      workOrderAssetId: null,
    });
    // The same answer under a filter on the other truck: the entry belongs to
    // the work order even where this vehicle's own line does not.
    const onB = await entries(`?assetId=${truckB}`);
    expect(onB.find((entry) => entry.id === splitEntryId)?.links).toMatchObject({ workOrderId });
  });

  it("names the trip and work order on the entry detail (#87)", async () => {
    const response = await api.get(admin.token, `/v1/finance/entries/${splitEntryId}`);
    expect(response.status).toBe(200);
    expect(financialEntryDetail.parse(response.body).links).toEqual({
      activityId: jobId,
      activityNumber: jobNumber,
      workOrderId,
      workOrderAssetId: truckA,
    });
  });

  it("filters by the month of the economic date", async () => {
    const august = await entries(`?assetId=${truckA}&economicMonth=2026-08`);
    expect(august.map((entry) => entry.category.code)).toEqual(["REPAIRS"]);
    const july = await entries(`?assetId=${truckA}&economicMonth=2026-07`);
    expect(july.map((entry) => entry.category.code)).toEqual(["TOLLS"]);
    const refused = await api.get(admin.token, "/v1/finance/entries?economicMonth=2026-13");
    expect(refused.status).toBe(400);
  });

  it("filters evidence=MISSING, leaving out what needs no receipt", async () => {
    const missing = await entries(`?assetId=${truckA}&evidence=MISSING`);
    // Tolls are NO_RECEIPT_EXPECTED; the repair has no file.
    expect(missing.map((entry) => entry.id)).toEqual([splitEntryId]);
  });

  it("masks a PLATFORM recorder exactly as the history read does", async () => {
    const [operator] = await ctx.db
      .insert(principals)
      .values({ principalType: "VENDOR_OPERATOR", displayName: "ROUTIQ support" })
      .returning();
    const commandId = randomUUID();
    await ctx.db.insert(commands).values({
      id: commandId,
      workspaceId,
      scope: "PLATFORM",
      commandType: "import-ledger",
      origin: "API",
      status: "EXECUTED",
      initiatedByPrincipalId: operator!.id,
      idempotencyKey: `platform-${randomUUID()}`,
      payload: {},
    });
    const [fuel] = await ctx.db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.workspaceId, workspaceId), eq(categories.code, "FUEL")));
    const entryId = randomUUID();
    // One transaction: the balance trigger checks the entry against its postings at commit.
    await ctx.db.transaction(async (tx) => {
      await tx.insert(financialEntries).values({
        id: entryId,
        workspaceId,
        entryNumber: `PLAT-${entryId.slice(0, 8)}`,
        direction: "EXPENSE",
        categoryId: fuel!.id,
        economicDate: "2026-08-02",
        branchId,
        amountMinor: 5_000n,
        paymentMethod: "CASH",
        status: "SUBMITTED",
        createdByCommandId: commandId,
      });
      await tx.insert(financialPostings).values({
        workspaceId,
        financialEntryId: entryId,
        lineNo: 1,
        economicDate: "2026-08-02",
        direction: "EXPENSE",
        categoryId: fuel!.id,
        branchId,
        assetId: truckB,
        amountMinor: 5_000n,
        createdByCommandId: commandId,
      });
    });

    const listed = (await entries(`?assetId=${truckB}`)).find((entry) => entry.id === entryId);
    expect(listed?.recordedBy).toEqual({ principalId: null, displayName: null, scope: "PLATFORM" });
    const detail = financialEntryDetail.parse(
      (await api.get(admin.token, `/v1/finance/entries/${entryId}`)).body,
    );
    expect(detail.recordedBy).toEqual({ principalId: null, displayName: null, scope: "PLATFORM" });
  });

  it("serves the same fields on the approvals queue", async () => {
    const pendingId = randomUUID();
    await api.ok(driver.token, "record-expense", {
      entryId: pendingId,
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-08-21",
      amountMinor: 350_000,
      paymentMethod: "MOMO",
      paymentReference: "MP260821.1234",
      postings: [{ assetId: truckA, amountMinor: 350_000 }],
    });
    const response = await api.get(admin.token, "/v1/finance/approvals");
    expect(response.status).toBe(200);
    const queue = pendingApprovalsResponse.parse(response.body);
    expect(queue.entries.find((entry) => entry.id === pendingId)).toMatchObject({
      recordedBy: { principalId: driver.principalId, displayName: "Sali", scope: "WORKSPACE" },
      evidence: { state: "PAYMENT_REFERENCE", artifactCount: 0 },
      category: { code: "FUEL", layer: "DIRECT" },
      assetShareMinor: null,
      assetLinks: null,
      submittedByPrincipalId: driver.principalId,
    });
  });

  it("links revenue that names a work order to no work order (#444)", async () => {
    const template = randomUUID();
    await api.ok(admin.token, "record-revenue", {
      entryId: template,
      branchCode: "DLA",
      categoryCode: "FREIGHT_REVENUE",
      economicDate: "2026-08-22",
      amountMinor: 30_000,
      paymentMethod: "CASH",
      postings: [{ assetId: truckA, amountMinor: 30_000 }],
    });
    const revenue = await plantWorkOrderRevenue(ctx.db, { revenueEntryId: template, workOrderId });
    const noWorkOrder = { workOrderId: null, workOrderAssetId: null };

    const onA = (await entries(`?assetId=${truckA}`)).find((entry) => entry.id === revenue);
    expect({ assetLinks: onA?.assetLinks, links: onA?.links }).toMatchObject({
      assetLinks: { workOrderId: null },
      links: noWorkOrder,
    });
    const detail = await api.get(admin.token, `/v1/finance/entries/${revenue}`);
    expect(detail.status).toBe(200);
    expect(financialEntryDetail.parse(detail.body).links).toMatchObject(noWorkOrder);
  });
});
