import { randomUUID } from "node:crypto";
import type { ToggleableModuleCode } from "@routiq/contracts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";
import { setModule } from "../test/vendor.js";

/**
 * A module that is off leaves no trace in the reads of the modules that stay
 * on (#328, #118): its own reads answer MODULE_DISABLED (read-gates.test.ts),
 * and the vehicle, its attention list and timeline, Home's figures and the
 * navigation counts drop what it owns. Turned back on, every read answers
 * exactly what it did before: off hides, it deletes nothing.
 */
describe("reads with one module off", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let workspaceId: string;
  let director: Actor;
  let truck: string;
  const original = new Map<string, unknown>();

  type AssetDetail = {
    finance?: unknown;
    availability: { state: string };
    lastReading: unknown;
    recentActivities: unknown[];
  };
  type Attention = { items: Array<{ code: string }> };
  type History = { items: Array<{ kind: string; amountMinor: number | null }> };
  type Dashboard = { openPeriod: unknown; pendingApprovals: unknown; series: unknown };
  type NavCounts = { moneyWaiting: number | null; maintenanceNew: number | null };

  const reads = () => [
    `/v1/assets/${truck}`,
    `/v1/assets/${truck}/attention`,
    `/v1/assets/${truck}/history?limit=100`,
    "/v1/assets",
    "/v1/assets/summary",
    "/v1/dashboard",
    "/v1/nav-counts",
  ];

  async function read<T>(url: string): Promise<T> {
    const reply = await api.get(director.token, url);
    expect(reply.status, `${url} ${JSON.stringify(reply.body)}`).toBe(200);
    return reply.body as T;
  }

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    director = await seedActor(ctx.db, { workspaceId, role: "DIRECTOR" });
    const driver = await seedActor(ctx.db, { workspaceId, role: "DRIVER" });
    truck = await seedAsset(ctx.app, director.token);

    // One fact per module on the same truck.
    await api.ok(director.token, "record-expense", {
      entryId: randomUUID(),
      branchCode: "DLA",
      categoryCode: "FUEL",
      economicDate: "2026-08-05",
      amountMinor: 25_000,
      paymentMethod: "CASH",
      postings: [{ assetId: truck, amountMinor: 25_000 }],
    });
    await api.ok(driver.token, "report-issue", {
      issueId: randomUUID(),
      assetId: truck,
      description: "Freins qui sifflent",
      safetyCritical: true,
    });
    await api.ok(director.token, "add-or-renew-document", {
      documentId: randomUUID(),
      assetId: truck,
      documentTypeCode: "INSURANCE",
      documentNumber: "POL-2026-001",
      expiresAt: "2026-01-31",
    });
    await api.ok(director.token, "create-activity", {
      activityId: randomUUID(),
      branchCode: "DLA",
      activityTypeCode: "HAULAGE_JOB",
      templateCode: "TRUCKING",
      primarySegmentId: randomUUID(),
      primaryAssetId: truck,
      startedAt: "2026-08-01T05:00:00Z",
    });
    await api.ok(driver.token, "record-meter-reading", {
      readingId: randomUUID(),
      assetId: truck,
      readingType: "ODOMETER",
      value: 120_000,
      observedAt: "2026-08-02T07:00:00Z",
    });

    for (const url of reads()) original.set(url, await read(url));
  });

  afterAll(async () => {
    await ctx?.close();
  });

  const codes = async () => (await read<Attention>(`/v1/assets/${truck}/attention`)).items.map((item) => item.code);
  const kinds = async () =>
    (await read<History>(`/v1/assets/${truck}/history?limit=100`)).items.map((item) => item.kind);

  it("shows every module's facts while all are on", async () => {
    const detail = original.get(`/v1/assets/${truck}`) as AssetDetail;
    expect(detail.finance).toBeDefined();
    expect(detail.availability.state).toBe("GROUNDED");
    expect(detail.lastReading).not.toBeNull();
    expect(detail.recentActivities).toHaveLength(1);
    expect(await codes()).toEqual(
      expect.arrayContaining(["ISSUE_UNPLANNED", "DOCUMENT_EXPIRED", "ENTRY_EVIDENCE_MISSING"]),
    );
    expect(new Set(await kinds())).toEqual(new Set(["LIFECYCLE", "MONEY", "MAINTENANCE", "DOCUMENTS", "READINGS", "TRIPS"]));
    expect((original.get("/v1/nav-counts") as NavCounts).maintenanceNew).toBe(1);
  });

  const OFF: Array<[ToggleableModuleCode, () => Promise<void>]> = [
    [
      "FINANCE",
      async () => {
        const detail = await read<AssetDetail>(`/v1/assets/${truck}`);
        expect(detail.finance).toBeUndefined();
        expect((await codes()).filter((code) => code.startsWith("ENTRY_"))).toEqual([]);
        const history = await read<History>(`/v1/assets/${truck}/history?limit=100`);
        expect(history.items.filter((item) => item.kind === "MONEY" || item.amountMinor !== null)).toEqual([]);
        expect(await read<Dashboard>("/v1/dashboard")).toMatchObject({
          openPeriod: null,
          pendingApprovals: null,
          series: null,
        });
        expect((await read<NavCounts>("/v1/nav-counts")).moneyWaiting).toBeNull();
      },
    ],
    [
      "MAINTENANCE",
      async () => {
        expect((await read<AssetDetail>(`/v1/assets/${truck}`)).availability).toEqual({ state: "NOT_ASSESSED" });
        expect((await codes()).filter((code) => /^(ISSUE|WORK_ORDER)_/.test(code))).toEqual([]);
        expect(await kinds()).not.toContain("MAINTENANCE");
        expect((await read<NavCounts>("/v1/nav-counts")).maintenanceNew).toBeNull();
      },
    ],
    [
      "DOCUMENTS",
      async () => {
        expect((await codes()).filter((code) => code.startsWith("DOCUMENT_"))).toEqual([]);
        expect(await kinds()).not.toContain("DOCUMENTS");
      },
    ],
    [
      "ACTIVITIES",
      async () => {
        const detail = await read<AssetDetail>(`/v1/assets/${truck}`);
        expect(detail.lastReading).toBeNull();
        expect(detail.recentActivities).toEqual([]);
        expect(await kinds()).not.toContain("READINGS");
        expect(await kinds()).not.toContain("TRIPS");
      },
    ],
  ];

  it.each(OFF)("leaves no trace of %s while it is off, and gives everything back after", async (code, check) => {
    await setModule(ctx.db, workspaceId, code, false);
    try {
      await check();
    } finally {
      await setModule(ctx.db, workspaceId, code, true);
    }
    for (const url of reads()) {
      expect(await read(url), url).toEqual(original.get(url));
    }
  });
});
