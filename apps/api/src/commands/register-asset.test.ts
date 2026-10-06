import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assets } from "../db/schema.js";
import { apiClient, seedActor, type Actor } from "../test/client.js";
import { createTestApp } from "../test/fixture.js";
import { seedWorkspace } from "../test/seed.js";

/** A VIN is 17 characters; v1 let 60 in. */
const VIN = "WDB9634031L123456";
const LONG_CHASSIS = "WDB9634031L123456-REMORQUE-2009";

describe("register-asset (#122: one set of identity rules with the Details edit)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let api: ReturnType<typeof apiClient>;
  let admin: Actor;
  let otherAdmin: Actor;
  let workspaceId: string;

  beforeAll(async () => {
    ctx = await createTestApp();
    api = apiClient(ctx.app);
    const seeded = await seedWorkspace(ctx.db);
    workspaceId = seeded.workspace.id;
    admin = await seedActor(ctx.db, { workspaceId, role: "ADMIN" });
    const other = await seedWorkspace(ctx.db);
    otherAdmin = await seedActor(ctx.db, { workspaceId: other.workspace.id, role: "ADMIN" });
  });

  afterAll(async () => {
    await ctx.close();
  });

  function register(actor: Actor, version: 1 | 2, fields: Record<string, unknown>) {
    const assetId = randomUUID();
    return api
      .send(
        actor.token,
        "register-asset",
        {
          assetId,
          assetCode: `T-${randomUUID().slice(0, 8)}`,
          assetClassCode: "TRUCK",
          templateCode: "TRUCKING",
          branchCode: "DLA",
          ...fields,
        },
        {},
        version,
      )
      .then((reply) => ({ ...reply, assetId }));
  }

  async function row(id: string) {
    const [found] = await ctx.db
      .select()
      .from(assets)
      .where(and(eq(assets.workspaceId, workspaceId), eq(assets.id, id)));
    return found;
  }

  describe("v2", () => {
    it("registers a 17-character chassis number and a trimmed plate", async () => {
      const reply = await register(admin, 2, { registrationNumber: "  LT 101 AB ", chassisNumber: VIN });
      expect(reply.status).toBe(200);
      const saved = await row(reply.assetId);
      expect(saved?.registrationNumber).toBe("LT 101 AB");
      expect(saved?.chassisNumber).toBe(VIN);
    });

    it("refuses a chassis number longer than 17 characters", async () => {
      const reply = await register(admin, 2, { chassisNumber: `${VIN}7` });
      expect(reply.status).toBe(400);
      expect(reply.body.error?.code).toBe("VALIDATION_FAILED");
      expect(JSON.stringify(reply.body.error?.metadata)).toContain("chassisNumber");
      expect(await row(reply.assetId)).toBeUndefined();
    });

    it("refuses a plate longer than 40 characters, and a blank one", async () => {
      expect((await register(admin, 2, { registrationNumber: "P".repeat(41) })).status).toBe(400);
      expect((await register(admin, 2, { registrationNumber: "   " })).status).toBe(400);
    });

    it("refuses a plate another vehicle in the workspace carries, however it is spaced", async () => {
      const first = await register(admin, 2, { registrationNumber: "CE 202 AA" });
      expect(first.status).toBe(200);
      const second = await register(admin, 2, { registrationNumber: "ce-202-aa" });
      expect(second.status).toBe(409);
      expect(second.body.error?.code).toBe("DUPLICATE_REGISTRATION_NUMBER");
      expect(second.body.error?.metadata).toEqual({ assetId: first.assetId });
      expect(await row(second.assetId)).toBeUndefined();
    });

    it("lets another workspace carry the same plate", async () => {
      expect((await register(admin, 2, { registrationNumber: "OW 303 AA" })).status).toBe(200);
      expect((await register(otherAdmin, 2, { registrationNumber: "OW 303 AA" })).status).toBe(200);
    });
  });

  describe("v1, frozen as shipped", () => {
    it("still registers a long chassis number and a plate another vehicle carries", async () => {
      expect((await register(admin, 2, { registrationNumber: "CE 404 AA" })).status).toBe(200);
      const reply = await register(admin, 1, { registrationNumber: "CE 404 AA", chassisNumber: LONG_CHASSIS });
      expect(reply.status).toBe(200);
      const saved = await row(reply.assetId);
      expect(saved?.chassisNumber).toBe(LONG_CHASSIS);
      expect(saved?.registrationNumber).toBe("CE 404 AA");
    });

    it("leaves the Details edit free to change other fields of what it let in", async () => {
      expect((await register(admin, 2, { registrationNumber: "CE 505 AA" })).status).toBe(200);
      const legacy = await register(admin, 1, { registrationNumber: "CE 505 AA", chassisNumber: LONG_CHASSIS });
      expect(legacy.status).toBe(200);

      const edit = (changes: Record<string, unknown>, expectedVersion: number) =>
        api.send(admin.token, "update-asset-details", { assetId: legacy.assetId, ...changes }, { expectedVersion });

      // Neither the long chassis nor the shared plate is touched, so neither is re-checked.
      const make = await edit({ manufacturer: "Mercedes-Benz" }, 1);
      expect(make.status).toBe(200);
      // The same plate sent back, even re-spaced, is no new claim on it.
      const plate = await edit({ registrationNumber: "CE-505-AA" }, 2);
      expect(plate.status).toBe(200);
      // A new chassis number is held to the rule.
      const chassis = await edit({ chassisNumber: `${VIN}7` }, 3);
      expect(chassis.status).toBe(400);

      const saved = await row(legacy.assetId);
      expect(saved?.manufacturer).toBe("Mercedes-Benz");
      expect(saved?.registrationNumber).toBe("CE-505-AA");
      expect(saved?.chassisNumber).toBe(LONG_CHASSIS);
    });
  });
});
