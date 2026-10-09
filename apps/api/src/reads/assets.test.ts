import { randomUUID } from "node:crypto";
import {
  assetListResponse,
  assetSummary,
  type AssetLifecycleStatus,
} from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import { assets, branches } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { setModule } from "../test/vendor.js";
import { seedAsset, seedMember, seedWorkspace } from "../test/seed.js";

describe("GET /v1/assets", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let adminToken: string;
  let branchToken: string;
  let workspaceAId: string;
  let doualaId: string;
  let yaoundeId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    const workspaceA = await seedWorkspace(ctx.db);
    workspaceAId = workspaceA.workspace.id;
    doualaId = workspaceA.branch.id;

    const [yaounde] = await ctx.db
      .insert(branches)
      .values({
        workspaceId: workspaceA.workspace.id,
        code: "YDE",
        name: "Yaoundé",
      })
      .returning();
    if (!yaounde) throw new Error("branch insert returned no row");
    yaoundeId = yaounde.id;

    const adminA = await seedMember(ctx.db, {
      workspaceId: workspaceA.workspace.id,
      role: "ADMIN",
      allBranches: true,
    });
    adminToken = (
      await createSession(ctx.db, {
        principalId: adminA.principal.id,
        workspaceId: workspaceA.workspace.id,
      })
    ).token;

    const branchMember = await seedMember(ctx.db, {
      workspaceId: workspaceA.workspace.id,
      role: "ADMIN",
      branchIds: [doualaId],
    });
    branchToken = (
      await createSession(ctx.db, {
        principalId: branchMember.principal.id,
        workspaceId: workspaceA.workspace.id,
      })
    ).token;

    // asset_code ascending is the list order, so the codes double as the
    // expected sequence throughout this suite.
    await registerAsset(adminToken, {
      assetCode: "AST-001",
      assetClassCode: "TRUCK",
      branchCode: "DLA",
      manufacturer: "Mercedes",
      model: "Actros",
      registrationNumber: "LT 123 AB",
    });
    const inServiceTruck = await registerAsset(adminToken, {
      assetCode: "AST-002",
      assetClassCode: "TRUCK",
      branchCode: "DLA",
      manufacturer: "Mercedes",
      model: "Atego",
    });
    const maintenanceBus = await registerAsset(adminToken, {
      assetCode: "AST-003",
      assetClassCode: "BUS",
      branchCode: "DLA",
      manufacturer: "Toyota",
      model: "Coaster",
      registrationNumber: "CE 456 CD",
    });
    const inServiceBus = await registerAsset(adminToken, {
      assetCode: "AST-004",
      assetClassCode: "BUS",
      branchCode: "YDE",
      manufacturer: "Toyota",
      model: "Hiace",
    });
    const writtenOffVan = await registerAsset(adminToken, {
      assetCode: "AST-005",
      assetClassCode: "VAN",
      branchCode: "YDE",
      manufacturer: "Ford",
      model: "Transit",
      registrationNumber: "SW 789 EF",
    });
    const retiredTruck = await registerAsset(adminToken, {
      assetCode: "AST-006",
      assetClassCode: "TRUCK",
      branchCode: "YDE",
      manufacturer: "Scania",
      model: "R450",
    });

    await commissionAsset(adminToken, inServiceTruck);
    await commissionAsset(adminToken, inServiceBus);
    // UNDER_MAINTENANCE, RETIRED and WRITTEN_OFF have no command yet; the read
    // still has to filter on them, so the fixture sets them directly.
    await setLifecycleStatus(maintenanceBus, "UNDER_MAINTENANCE");
    await setLifecycleStatus(writtenOffVan, "WRITTEN_OFF");
    await setLifecycleStatus(retiredTruck, "RETIRED");

    // Sorts ahead of every workspace-A code: a tenant leak would surface first.
    const workspaceB = await seedWorkspace(ctx.db);
    const adminB = await seedMember(ctx.db, {
      workspaceId: workspaceB.workspace.id,
      role: "ADMIN",
      allBranches: true,
    });
    const adminBToken = (
      await createSession(ctx.db, {
        principalId: adminB.principal.id,
        workspaceId: workspaceB.workspace.id,
      })
    ).token;
    await registerAsset(adminBToken, {
      assetCode: "AST-000",
      assetClassCode: "TRUCK",
      branchCode: "DLA",
      manufacturer: "Mercedes",
      model: "Actros",
    });
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function registerAsset(
    token: string,
    payload: {
      assetCode: string;
      assetClassCode: string;
      branchCode: string;
      manufacturer?: string;
      model?: string;
      registrationNumber?: string;
    },
  ): Promise<string> {
    const assetId = randomUUID();
    const response = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/register-asset",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `read-test-${randomUUID()}`,
          origin: "HUMAN_UI",
        },
        payload: { assetId, templateCode: "TRUCKING", ...payload },
      },
    });
    if (response.statusCode !== 200) {
      throw new Error(`register-asset failed: ${response.statusCode} ${response.body}`);
    }
    return assetId;
  }

  async function commissionAsset(token: string, assetId: string) {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/v1/commands/commission-asset",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        version: 1,
        envelope: {
          commandId: randomUUID(),
          idempotencyKey: `read-test-${randomUUID()}`,
          origin: "HUMAN_UI",
          expectedVersion: 1,
        },
        payload: { assetId },
      },
    });
    if (response.statusCode !== 200) {
      throw new Error(`commission-asset failed: ${response.statusCode} ${response.body}`);
    }
  }

  async function setLifecycleStatus(
    assetId: string,
    lifecycleStatus: AssetLifecycleStatus,
  ) {
    await ctx.db
      .update(assets)
      .set({ lifecycleStatus })
      .where(and(eq(assets.workspaceId, workspaceAId), eq(assets.id, assetId)));
  }

  async function list(token: string, query: string = "") {
    const response = await ctx.app.inject({
      method: "GET",
      url: query === "" ? "/v1/assets" : `/v1/assets?${query}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    return assetListResponse.parse(response.json());
  }

  async function codes(token: string, query: string = "") {
    return (await list(token, query)).items.map((item) => item.assetCode);
  }

  async function rejects(token: string, query: string) {
    const response = await ctx.app.inject({
      method: "GET",
      url: `/v1/assets?${query}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: { code: "VALIDATION_FAILED" } });
  }

  it("requires authentication", async () => {
    const response = await ctx.app.inject({ method: "GET", url: "/v1/assets" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: { code: "AUTH_REQUIRED" } });
  });

  it("returns the list envelope in asset-code order, scoped to the workspace", async () => {
    const page = await list(adminToken);

    expect(page.items.map((item) => item.assetCode)).toEqual([
      "AST-001",
      "AST-002",
      "AST-003",
      "AST-004",
      "AST-005",
      "AST-006",
    ]);
    expect(page.nextCursor).toBeNull();
    expect(page.items[0]).toEqual({
      id: expect.any(String),
      assetCode: "AST-001",
      registrationNumber: "LT 123 AB",
      manufacturer: "Mercedes",
      model: "Actros",
      lifecycleStatus: "REGISTERED",
      rowVersion: expect.any(Number),
      category: { code: "TRUCK", labelFr: "Camion", labelEn: "Truck" },
      branch: { code: "DLA", name: "Douala" },
    });
  });

  describe("filters", () => {
    it("narrows to a single lifecycle status", async () => {
      expect(await codes(adminToken, "status=IN_SERVICE")).toEqual([
        "AST-002",
        "AST-004",
      ]);
    });

    it("accepts several lifecycle statuses (the ATTENTION group)", async () => {
      expect(
        await codes(
          adminToken,
          "status=UNDER_MAINTENANCE&status=RETIRED&status=WRITTEN_OFF",
        ),
      ).toEqual(["AST-003", "AST-005", "AST-006"]);
    });

    it("narrows to an asset class", async () => {
      expect(await codes(adminToken, "category=BUS")).toEqual([
        "AST-003",
        "AST-004",
      ]);
    });

    it("narrows to a branch", async () => {
      expect(await codes(adminToken, `branchId=${yaoundeId}`)).toEqual([
        "AST-004",
        "AST-005",
        "AST-006",
      ]);
    });

    it("composes filters", async () => {
      expect(
        await codes(adminToken, `category=TRUCK&branchId=${doualaId}&status=REGISTERED`),
      ).toEqual(["AST-001"]);
    });

    it("rejects an unknown lifecycle status", async () => {
      await rejects(adminToken, "status=NOT_A_STATUS");
    });

    it("rejects a malformed branchId", async () => {
      await rejects(adminToken, "branchId=not-a-uuid");
    });

    it("ignores unknown query keys rather than failing the request", async () => {
      expect(await codes(adminToken, "somethingElse=1")).toHaveLength(6);
    });
  });

  describe("search", () => {
    it("matches the asset code case-insensitively", async () => {
      expect(await codes(adminToken, "search=ast-00")).toHaveLength(6);
      expect(await codes(adminToken, "search=AST-003")).toEqual(["AST-003"]);
    });

    it("matches the manufacturer in either case", async () => {
      expect(await codes(adminToken, "search=mercedes")).toEqual([
        "AST-001",
        "AST-002",
      ]);
      expect(await codes(adminToken, "search=MERCEDES")).toEqual([
        "AST-001",
        "AST-002",
      ]);
    });

    it("matches the model", async () => {
      expect(await codes(adminToken, "search=coaster")).toEqual(["AST-003"]);
    });

    it("matches the registration number", async () => {
      expect(await codes(adminToken, "search=lt 123")).toEqual(["AST-001"]);
    });

    it("matches the bilingual asset-class label", async () => {
      expect(await codes(adminToken, "search=camion")).toEqual([
        "AST-001",
        "AST-002",
        "AST-006",
      ]);
      expect(await codes(adminToken, "search=fourgonnette")).toEqual(["AST-005"]);
    });

    it("treats LIKE wildcards as literal characters", async () => {
      expect(await codes(adminToken, "search=%25")).toEqual([]);
      expect(await codes(adminToken, "search=_")).toEqual([]);
    });

    it("composes with a filter", async () => {
      expect(await codes(adminToken, "search=toyota&status=IN_SERVICE")).toEqual([
        "AST-004",
      ]);
    });
  });

  describe("branch scope", () => {
    it("shows a scoped member only their own branches", async () => {
      expect(await codes(branchToken)).toEqual(["AST-001", "AST-002", "AST-003"]);
    });

    it("cannot be widened by a branchId outside the scope", async () => {
      expect(await codes(branchToken, `branchId=${yaoundeId}`)).toEqual([]);
    });
  });

  describe("pagination", () => {
    async function walk(token: string, filters: string = "") {
      const pages: string[][] = [];
      let cursor: string | null = null;
      do {
        const query = new URLSearchParams(filters);
        query.set("limit", "2");
        if (cursor !== null) query.set("cursor", cursor);
        const page = await list(token, query.toString());
        pages.push(page.items.map((item) => item.assetCode));
        cursor = page.nextCursor;
        if (pages.length > 10) throw new Error("cursor walk did not terminate");
      } while (cursor !== null);
      return pages;
    }

    it("walks every row exactly once with no gaps or duplicates", async () => {
      const pages = await walk(adminToken);

      expect(pages).toEqual([
        ["AST-001", "AST-002"],
        ["AST-003", "AST-004"],
        ["AST-005", "AST-006"],
      ]);
      const all = pages.flat();
      expect(all).toEqual([...new Set(all)]);
    });

    it("carries the filter across pages", async () => {
      const pages = await walk(adminToken, "category=TRUCK");

      expect(pages).toEqual([["AST-001", "AST-002"], ["AST-006"]]);
    });

    it("encodes the sort, the key and the row id in the cursor", async () => {
      const page = await list(adminToken, "limit=2");
      expect(page.nextCursor).not.toBeNull();

      const decoded: unknown = JSON.parse(
        Buffer.from(page.nextCursor!, "base64url").toString("utf8"),
      );
      expect(decoded).toEqual({
        field: "assetCode",
        direction: "asc",
        value: "AST-002",
        id: page.items[1]!.id,
      });
    });

    it("stops with a null cursor on the last page", async () => {
      const page = await list(adminToken, "limit=100");
      expect(page.nextCursor).toBeNull();
    });

    it("rejects a tampered cursor instead of silently restarting", async () => {
      await rejects(adminToken, "cursor=not-base64url-json");
      await rejects(
        adminToken,
        `cursor=${Buffer.from(JSON.stringify({ key: "AST-001", id: "nope" })).toString("base64url")}`,
      );
    });

    it("rejects a limit above the server maximum", async () => {
      await rejects(adminToken, "limit=101");
    });

    it("rejects a non-positive limit", async () => {
      await rejects(adminToken, "limit=0");
    });
  });

  describe("sorting", () => {
    it("defaults to asset code ascending when sort is omitted", async () => {
      expect(await codes(adminToken)).toEqual([
        "AST-001",
        "AST-002",
        "AST-003",
        "AST-004",
        "AST-005",
        "AST-006",
      ]);
    });

    it("reverses on assetCode:desc", async () => {
      expect(await codes(adminToken, "sort=assetCode%3Adesc")).toEqual([
        "AST-006",
        "AST-005",
        "AST-004",
        "AST-003",
        "AST-002",
        "AST-001",
      ]);
    });

    it("walks a descending sort across pages without gaps or duplicates", async () => {
      const walked: string[] = [];
      let cursor: string | null = null;
      do {
        const query = new URLSearchParams({ sort: "assetCode:desc", limit: "2" });
        if (cursor !== null) query.set("cursor", cursor);
        const page = await list(adminToken, query.toString());
        walked.push(...page.items.map((item) => item.assetCode));
        cursor = page.nextCursor;
        if (walked.length > 12) throw new Error("cursor walk did not terminate");
      } while (cursor !== null);

      expect(walked).toEqual([
        "AST-006",
        "AST-005",
        "AST-004",
        "AST-003",
        "AST-002",
        "AST-001",
      ]);
    });

    it("rejects a field the resource does not declare as sortable", async () => {
      await rejects(adminToken, "sort=registrationNumber%3Aasc");
      await rejects(adminToken, "sort=assetCode%3Asideways");
    });

    /**
     * The boundary and the ordering have to agree: replaying an ascending
     * cursor under a descending sort would silently skip and repeat rows, so
     * the cursor carries its sort and the mismatch is refused outright.
     */
    it("rejects a cursor minted under a different sort", async () => {
      const ascending = await list(adminToken, "limit=2");
      expect(ascending.nextCursor).not.toBeNull();

      await rejects(
        adminToken,
        `sort=assetCode%3Adesc&cursor=${encodeURIComponent(ascending.nextCursor!)}`,
      );

      // The same cursor under the sort that minted it still pages.
      const next = await list(
        adminToken,
        `limit=2&cursor=${encodeURIComponent(ascending.nextCursor!)}`,
      );
      expect(next.items.map((item) => item.assetCode)).toEqual([
        "AST-003",
        "AST-004",
      ]);
    });
  });

  describe("GET /v1/assets/summary", () => {
    async function summary(token: string, query: string = "") {
      const response = await ctx.app.inject({
        method: "GET",
        url: query === "" ? "/v1/assets/summary" : `/v1/assets/summary?${query}`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
      return assetSummary.parse(response.json());
    }

    it("requires authentication", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/assets/summary",
      });
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual({ error: { code: "AUTH_REQUIRED" } });
    });

    it("counts the workspace fleet by lifecycle bucket", async () => {
      // Workspace B's AST-000 sorts first of all seeded codes; if it were
      // counted, total would be 7.
      expect(await summary(adminToken)).toEqual({
        total: 6,
        inService: 2,
        attention: 3,
      });
    });

    /**
     * The point of the read: counting the rows a client has loaded answers a
     * different question than counting the fleet.
     */
    it("counts every row, not the page the client happens to hold", async () => {
      const firstPage = await list(adminToken, "limit=2");
      expect(firstPage.items).toHaveLength(2);
      expect(firstPage.nextCursor).not.toBeNull();

      const walked: string[] = [];
      let cursor: string | null = firstPage.nextCursor;
      walked.push(...firstPage.items.map((item) => item.assetCode));
      while (cursor !== null) {
        const page = await list(
          adminToken,
          `limit=2&cursor=${encodeURIComponent(cursor)}`,
        );
        walked.push(...page.items.map((item) => item.assetCode));
        cursor = page.nextCursor;
        if (walked.length > 12) throw new Error("cursor walk did not terminate");
      }

      const counts = await summary(adminToken);
      expect(counts.total).toBe(walked.length);
      expect(counts.total).toBeGreaterThan(firstPage.items.length);
    });

    it("agrees with the list filters it mirrors", async () => {
      const counts = await summary(adminToken);
      expect(await codes(adminToken, "status=IN_SERVICE")).toHaveLength(
        counts.inService,
      );
      expect(await codes(adminToken, "attention=true")).toHaveLength(
        counts.attention,
      );
    });

    it("counts only the branches a scoped member may see", async () => {
      expect(await summary(branchToken)).toEqual({
        total: 3,
        inService: 1,
        attention: 1,
      });
    });

    it("cannot be widened by a branchId outside the scope", async () => {
      expect(await summary(branchToken, `branchId=${yaoundeId}`)).toEqual({
        total: 0,
        inService: 0,
        attention: 0,
      });
    });

    it("narrows by the same branch, category and search filters as the list", async () => {
      expect(await summary(adminToken, `branchId=${yaoundeId}`)).toEqual({
        total: 3,
        inService: 1,
        attention: 2,
      });
      expect(await summary(adminToken, "category=BUS")).toEqual({
        total: 2,
        inService: 1,
        attention: 1,
      });
      expect(await summary(adminToken, "search=mercedes")).toEqual({
        total: 2,
        inService: 1,
        attention: 0,
      });
    });

    it("ignores a status filter rather than counting inside one bucket", async () => {
      expect(await summary(adminToken, "status=IN_SERVICE")).toEqual({
        total: 6,
        inService: 2,
        attention: 3,
      });
    });

    it("rejects a malformed branchId", async () => {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/assets/summary?branchId=not-a-uuid",
        headers: { authorization: `Bearer ${adminToken}` },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: { code: "VALIDATION_FAILED" } });
    });
  });
});

/**
 * Grounding is availability, not lifecycle status: a truck still IN_SERVICE
 * with an open availability interval needs someone now, so the Attention
 * bucket counts it while MAINTENANCE is on.
 */
describe("GET /v1/assets/summary counts grounded vehicles", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let workspaceId: string;
  let admin: Actor;
  let manager: Actor;
  let mechanic: Actor;
  let doualaOnly: Actor;
  let groundedId: string;
  let workOrderId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    const [yaounde] = await ctx.db
      .insert(branches)
      .values({ workspaceId, code: "YDE", name: "Yaoundé" })
      .returning();
    if (!yaounde) throw new Error("branch insert returned no row");

    admin = await seedActor(ctx.db, { workspaceId, role: "DIRECTOR" });
    manager = await seedActor(ctx.db, { workspaceId, role: "ADMIN" });
    mechanic = await seedActor(ctx.db, { workspaceId, role: "TECHNICIAN" });
    doualaOnly = await seedActor(ctx.db, {
      workspaceId,
      role: "ADMIN",
      branchIds: [seeded.branch.id],
    });

    const commission = async (assetId: string) =>
      api.ok(admin.token, "commission-asset", { assetId }, { expectedVersion: 1 });
    const ground = async (assetId: string) => {
      const issueId = randomUUID();
      await api.ok(admin.token, "report-issue", {
        issueId,
        assetId,
        description: "Freins",
        safetyCritical: true,
      });
      return issueId;
    };

    // In service and available: never attention.
    await commission(await seedAsset(ctx.app, admin.token, { assetCode: "VH001" }));

    // In service and grounded in Douala.
    groundedId = await seedAsset(ctx.app, admin.token, { assetCode: "VH002" });
    await commission(groundedId);
    const issueId = await ground(groundedId);
    workOrderId = randomUUID();
    const created = await api.ok(mechanic.token, "create-work-order", {
      workOrderId,
      assetId: groundedId,
      issueId,
      description: "Remplacer les plaquettes",
      expectedCostMinor: 0,
    });
    await api.ok(
      mechanic.token,
      "complete-work-order",
      { workOrderId, summary: "Plaquettes remplacées" },
      { expectedVersion: created.rowVersion },
    );

    // Grounded AND under maintenance: one vehicle, counted once.
    const both = await seedAsset(ctx.app, admin.token, { assetCode: "VH003" });
    await commission(both);
    await ground(both);
    await ctx.db
      .update(assets)
      .set({ lifecycleStatus: "UNDER_MAINTENANCE" })
      .where(and(eq(assets.workspaceId, workspaceId), eq(assets.id, both)));

    // Grounded in Yaoundé, outside the Douala-only member's scope.
    const yaoundeTruck = await seedAsset(ctx.app, admin.token, {
      assetCode: "VH004",
      branchCode: "YDE",
    });
    await commission(yaoundeTruck);
    await ground(yaoundeTruck);
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function summary(token: string) {
    const response = await api.get(token, "/v1/assets/summary");
    expect(response.status).toBe(200);
    return assetSummary.parse(response.body);
  }

  async function attentionCodes(token: string) {
    const response = await api.get(token, "/v1/assets?attention=true");
    expect(response.status).toBe(200);
    return assetListResponse.parse(response.body).items.map((item) => item.assetCode);
  }

  /** The tile is a number that filters the list: both read one predicate. */
  async function expectTileMatchesFilter(token: string, codes: string[]) {
    expect(await attentionCodes(token)).toEqual(codes);
    expect((await summary(token)).attention).toBe(codes.length);
  }

  it("counts an IN_SERVICE vehicle with an open availability interval, once", async () => {
    expect(await summary(admin.token)).toEqual({ total: 4, inService: 3, attention: 3 });
    await expectTileMatchesFilter(admin.token, ["VH002", "VH003", "VH004"]);
  });

  it("rejects an attention filter other than true", async () => {
    const response = await api.get(admin.token, "/v1/assets?attention=false");
    expect(response.status).toBe(400);
  });

  it("never counts a grounded vehicle outside the caller's branch scope", async () => {
    expect(await summary(doualaOnly.token)).toEqual({ total: 3, inService: 2, attention: 2 });
    await expectTileMatchesFilter(doualaOnly.token, ["VH002", "VH003"]);
  });

  it("counts lifecycle statuses only while MAINTENANCE is off", async () => {
    await setModule(ctx.db, workspaceId, "MAINTENANCE", false);
    try {
      expect(await summary(admin.token)).toEqual({ total: 4, inService: 3, attention: 1 });
      await expectTileMatchesFilter(admin.token, ["VH003"]);
    } finally {
      await setModule(ctx.db, workspaceId, "MAINTENANCE", true);
    }
  });

  it("stops counting a vehicle once it is released to service", async () => {
    await api.ok(manager.token, "release-asset-to-service", {
      assetId: groundedId,
      workOrderId,
    });
    expect(await summary(admin.token)).toEqual({ total: 4, inService: 3, attention: 2 });
    await expectTileMatchesFilter(admin.token, ["VH003", "VH004"]);
  });
});
