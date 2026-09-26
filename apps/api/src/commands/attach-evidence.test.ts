import { randomUUID } from "node:crypto";
import {
  financialEntryDetail,
  financialEntryListResponse,
  periodsResponse,
  type FinancialEntryDetail,
} from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditEvents, branches, sourceArtifacts } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedAsset, seedWorkspace } from "../test/seed.js";

describe("attach-evidence.v1", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let workspaceId: string;
  let otherWorkspaceId: string;
  let admin: Actor;
  let driver: Actor;
  let colleague: Actor;
  let mechanic: Actor;
  let viewer: Actor;
  let dlaOnly: Actor;
  let otherAdmin: Actor;
  let assetId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    await ctx.db.insert(branches).values({ workspaceId, code: "YDE", name: "Yaoundé" });

    admin = await seedActor(ctx.db, { workspaceId, role: "ADMIN" });
    driver = await seedActor(ctx.db, { workspaceId, role: "FIELD_SUBMITTER", displayName: "Sali" });
    colleague = await seedActor(ctx.db, {
      workspaceId,
      role: "FIELD_SUBMITTER",
      displayName: "Awa",
    });
    mechanic = await seedActor(ctx.db, { workspaceId, role: "MAINTENANCE" });
    viewer = await seedActor(ctx.db, { workspaceId, role: "EXECUTIVE_VIEWER" });
    dlaOnly = await seedActor(ctx.db, {
      workspaceId,
      role: "FIELD_SUBMITTER",
      branchIds: [seeded.branch.id],
    });
    assetId = await seedAsset(ctx.app, admin.token, { assetCode: "EV-01" });

    const other = await seedWorkspace(ctx.db);
    otherWorkspaceId = other.workspace.id;
    otherAdmin = await seedActor(ctx.db, { workspaceId: otherWorkspaceId, role: "ADMIN" });
  });

  afterAll(async () => {
    await ctx.close();
  });

  async function artifact(owner: { workspaceId: string; principalId: string } = {
    workspaceId,
    principalId: driver.principalId,
  }): Promise<string> {
    const id = randomUUID();
    await ctx.db.insert(sourceArtifacts).values({
      id,
      workspaceId: owner.workspaceId,
      storageKey: `ws/${owner.workspaceId}/finalized-artifacts/${id}/${id.replaceAll("-", "")}`,
      sha256: id.replaceAll("-", ""),
      mimeType: "image/jpeg",
      sizeBytes: 2048n,
      originalFileName: "recu.jpg",
      uploadedByPrincipalId: owner.principalId,
    });
    return id;
  }

  async function expense(
    actor: Actor,
    opts: {
      amountMinor?: number;
      branchCode?: string;
      economicDate?: string;
      sourceArtifactIds?: string[];
      workOrderId?: string;
    } = {},
  ) {
    const entryId = randomUUID();
    const amountMinor = opts.amountMinor ?? 50_000;
    const result = await api.ok(
      actor.token,
      "record-expense",
      {
        entryId,
        branchCode: opts.branchCode ?? "DLA",
        categoryCode: opts.workOrderId ? "REPAIRS" : "FUEL",
        economicDate: opts.economicDate ?? "2026-08-12",
        amountMinor,
        paymentMethod: "CASH",
        postings: [
          {
            assetId,
            amountMinor,
            ...(opts.workOrderId ? { workOrderId: opts.workOrderId } : {}),
          },
        ],
      },
      opts.sourceArtifactIds ? { sourceArtifactIds: opts.sourceArtifactIds } : {},
    );
    return { entryId, rowVersion: result.rowVersion, status: result.recordStatus };
  }

  function attach(actor: Actor, entryId: string, artifactIds: string[], envelope: Record<string, unknown> = {}) {
    return api.send(
      actor.token,
      "attach-evidence",
      { entryId, artifactIds },
      { sourceArtifactIds: artifactIds, ...envelope },
    );
  }

  async function detail(entryId: string): Promise<FinancialEntryDetail> {
    const response = await api.get(admin.token, `/v1/finance/entries/${entryId}`);
    expect(response.status).toBe(200);
    return financialEntryDetail.parse(response.body);
  }

  async function missingIds(): Promise<string[]> {
    const response = await api.get(
      admin.token,
      `/v1/finance/entries?assetId=${assetId}&evidence=MISSING&limit=100`,
    );
    expect(response.status).toBe(200);
    return financialEntryListResponse.parse(response.body).entries.map((entry) => entry.id);
  }

  it("links a receipt to someone else's entry without touching the entry", async () => {
    const { entryId } = await expense(driver);
    const before = await detail(entryId);
    expect(before.evidence).toEqual({ state: "NOT_SUPPLIED", artifactCount: 0 });
    expect(await missingIds()).toContain(entryId);

    const file = await artifact();
    const reply = await attach(colleague, entryId, [file]);
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      recordId: entryId,
      rowVersion: before.rowVersion,
      recordStatus: "POSTED",
    });

    const after = await detail(entryId);
    expect(after).toMatchObject({
      status: before.status,
      amountMinor: before.amountMinor,
      rowVersion: before.rowVersion,
      evidence: { state: "SUPPLIED", artifactCount: 1 },
    });
    expect(after.evidenceFiles).toEqual([
      {
        artifactId: file,
        mimeType: "image/jpeg",
        sizeBytes: 2048,
        originalFileName: "recu.jpg",
        sha256: file.replaceAll("-", ""),
        attachedAt: expect.any(String),
        attachedBy: { principalId: colleague.principalId, displayName: "Awa", scope: "WORKSPACE" },
        via: "ATTACHED",
      },
    ]);
    expect(await missingIds()).not.toContain(entryId);

    const [event] = await ctx.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.commandId, reply.body.commandId!)));
    expect(event).toMatchObject({
      eventType: "financial_entry.evidence_attached",
      entityType: "financial_entry",
      entityId: entryId,
      afterState: { artifactIds: [file] },
      changedFields: ["artifactIds"],
    });
  });

  it("counts files recorded with the entry and attached later, each once", async () => {
    const recorded = await artifact();
    const { entryId } = await expense(driver, { sourceArtifactIds: [recorded] });
    const later = await artifact();
    expect((await attach(driver, entryId, [later])).status).toBe(200);
    // Attaching the recorded file again adds nothing to the count.
    expect((await attach(driver, entryId, [recorded])).status).toBe(200);

    const body = await detail(entryId);
    expect(body.evidence).toEqual({ state: "SUPPLIED", artifactCount: 2 });
    expect(body.evidenceFiles.map((file) => [file.artifactId, file.via])).toEqual([
      [recorded, "RECORDED"],
      [later, "ATTACHED"],
    ]);
  });

  it("works in a locked period — a file changes no posting", async () => {
    const { entryId } = await expense(admin, { economicDate: "2026-05-10" });
    const periods = periodsResponse.parse((await api.get(admin.token, "/v1/finance/periods")).body);
    const may = periods.periods.find((period) => period.periodCode === "2026-05");
    await api.ok(
      admin.token,
      "lock-period",
      { periodCode: "2026-05" },
      { expectedVersion: may!.rowVersion },
    );
    expect((await attach(driver, entryId, [await artifact()])).status).toBe(200);
  });

  it("replays an exact retry and refuses the key with other files", async () => {
    const { entryId } = await expense(driver);
    const file = await artifact();
    const envelope = { commandId: randomUUID(), idempotencyKey: `attach-${randomUUID()}` };
    expect((await attach(driver, entryId, [file], envelope)).status).toBe(200);
    const retry = await attach(driver, entryId, [file], envelope);
    expect(retry.status).toBe(200);
    expect(retry.body.idempotentReplay).toBe(true);

    const reused = await attach(driver, entryId, [await artifact()], envelope);
    expect(reused.status).toBe(409);
    expect(reused.body.error?.code).toBe("IDEMPOTENCY_KEY_REUSED");
  });

  it("refuses an empty list, or files the envelope does not carry", async () => {
    const { entryId } = await expense(driver);
    const empty = await attach(driver, entryId, []);
    expect(empty.status).toBe(400);
    expect(empty.body.error?.code).toBe("VALIDATION_FAILED");

    const [a, b] = [await artifact(), await artifact()];
    const mismatch = await api.send(
      driver.token,
      "attach-evidence",
      { entryId, artifactIds: [a] },
      { sourceArtifactIds: [b] },
    );
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error).toEqual({
      code: "VALIDATION_FAILED",
      metadata: { issues: [{ code: "custom", path: ["artifactIds"] }] },
    });
    expect((await detail(entryId)).evidence.artifactCount).toBe(0);
  });

  it("refuses another workspace's file", async () => {
    const { entryId } = await expense(driver);
    const foreign = await artifact({ workspaceId: otherWorkspaceId, principalId: otherAdmin.principalId });
    const reply = await attach(driver, entryId, [foreign]);
    expect(reply.status).toBe(422);
    expect(reply.body.error).toMatchObject({
      code: "REFERENCE_NOT_FOUND",
      metadata: { referenceType: "sourceArtifact", missing: [foreign] },
    });
  });

  it("answers REFERENCE_NOT_FOUND for an entry that does not exist", async () => {
    const reply = await attach(driver, randomUUID(), [await artifact()]);
    expect(reply.status).toBe(422);
    expect(reply.body.error).toMatchObject({
      code: "REFERENCE_NOT_FOUND",
      metadata: { referenceType: "financialEntry" },
    });
  });

  it("refuses an entry outside the caller's branches", async () => {
    const { entryId } = await expense(admin, { branchCode: "YDE" });
    const reply = await attach(dlaOnly, entryId, [await artifact()]);
    expect(reply.status).toBe(403);
    expect(reply.body.error?.code).toBe("ROLE_FORBIDDEN");
  });

  it("refuses a rejected entry and a reversal", async () => {
    const submitted = await expense(driver, { amountMinor: 400_000 });
    expect(submitted.status).toBe("SUBMITTED");
    await api.ok(
      admin.token,
      "reject-entry",
      { entryId: submitted.entryId, reason: "Pas de justificatif" },
      { expectedVersion: submitted.rowVersion },
    );
    const rejected = await attach(driver, submitted.entryId, [await artifact()]);
    expect(rejected.status).toBe(409);
    expect(rejected.body.error).toMatchObject({
      code: "INVALID_STATE_TRANSITION",
      metadata: { reason: "not_attachable", status: "REJECTED" },
    });

    const posted = await expense(admin);
    const reversalEntryId = randomUUID();
    await api.ok(
      admin.token,
      "reverse-entry",
      { reversalEntryId, originalEntryId: posted.entryId, reason: "Doublon" },
      { expectedVersion: posted.rowVersion },
    );
    const reversal = await attach(driver, reversalEntryId, [await artifact()]);
    expect(reversal.status).toBe(409);
    expect(reversal.body.error?.metadata).toMatchObject({ reason: "not_attachable" });
    // The reversal row is never "missing" paperwork.
    expect(await missingIds()).not.toContain(reversalEntryId);
  });

  it("refuses the executive viewer", async () => {
    const { entryId } = await expense(driver);
    const reply = await attach(viewer, entryId, [await artifact()]);
    expect(reply.status).toBe(403);
    expect(reply.body.error?.code).toBe("ROLE_FORBIDDEN");
  });

  it("lets the workshop attach only to work-order costs", async () => {
    const fuel = await expense(driver);
    const refused = await attach(mechanic, fuel.entryId, [await artifact()]);
    expect(refused.status).toBe(403);
    expect(refused.body.error).toMatchObject({
      code: "ROLE_FORBIDDEN",
      metadata: { reason: "WORK_ORDER_REQUIRED" },
    });

    const workOrderId = randomUUID();
    await api.ok(mechanic.token, "create-work-order", {
      workOrderId,
      assetId,
      description: "Vidange",
      expectedCostMinor: 0,
    });
    const repair = await expense(mechanic, { workOrderId });
    expect((await attach(mechanic, repair.entryId, [await artifact()])).status).toBe(200);
  });
});
