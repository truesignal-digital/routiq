import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import * as Sentry from "@sentry/node";
import { initSentry, reportUnexpectedFailure, isSentryEnabled, _resetSentryForTests } from "./sentry.js";
import { createTestApp } from "../test/fixture.js";
import { seedWorkspace, seedMember } from "../test/seed.js";
import { createSession } from "../auth/local.js";
import { approvalRules } from "../db/schema.js";
import { registerCommand } from "../commands/dispatcher.js";
import { z } from "zod";
import type { Db } from "../db/client.js";

describe("Sentry Observability", () => {
  const recordedEvents: any[] = [];

  function testTransportFactory() {
    return {
      send: async (envelope: any) => {
        try {
          let isFirst = true;
          for (const item of envelope) {
            // Skip the envelope header (first item)
            if (isFirst) {
              isFirst = false;
              continue;
            }

            // Item should be an array containing [header, payload] or an object with numeric keys
            if (Array.isArray(item)) {
              // Item is an array of [header, payload] tuples
              for (const subitem of item) {
                const header = subitem?.[0] || subitem?.["0"];
                const payload = subitem?.[1] || subitem?.["1"];
                if (header?.type === "event" && payload) {
                  recordedEvents.push(payload);
                }
              }
            }
          }
        } catch (err) {
          // Silently catch errors
        }
        return {};
      },
      flush: async () => {
        return true;
      },
    };
  }

  beforeEach(() => {
    recordedEvents.length = 0;
  });

  describe("Disabled state (no DSN)", () => {
    beforeEach(() => {
      delete process.env["SENTRY_DSN"];
      _resetSentryForTests();
    });

    afterEach(() => {
      _resetSentryForTests();
    });

    it("initSentry with no DSN returns false", () => {
      expect(initSentry({})).toBe(false);
      expect(isSentryEnabled()).toBe(false);
    });

    it("reportUnexpectedFailure is a silent no-op when disabled", () => {
      initSentry({});
      reportUnexpectedFailure(new Error("test"), {
        commandId: "c1",
        workspaceId: "w1",
        commandType: "test",
        origin: "HUMAN_UI",
      });
      expect(recordedEvents).toHaveLength(0);
    });
  });

  describe("Enabled state with test transport", () => {
    beforeEach(() => {
      _resetSentryForTests();
    });

    afterEach(() => {
      _resetSentryForTests();
    });

    it("initSentry with DSN and transport returns true", () => {
      expect(
        initSentry({
          dsn: "https://public@example.invalid/1",
          transport: testTransportFactory,
        })
      ).toBe(true);
      expect(isSentryEnabled()).toBe(true);
    });

    it("reportUnexpectedFailure captures with tags only", async () => {
      initSentry({
        dsn: "https://public@example.invalid/1",
        transport: testTransportFactory,
      });

      reportUnexpectedFailure(new Error("boom"), {
        commandId: "c1",
        workspaceId: "w1",
        commandType: "register-asset",
        origin: "HUMAN_UI",
      });

      await Sentry.flush(2000);

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0];
      expect(event.tags).toEqual({
        commandId: "c1",
        workspaceId: "w1",
        commandType: "register-asset",
        origin: "HUMAN_UI",
      });

      const eventStr = JSON.stringify(event);
      // Payload data must not be leaked; error message is OK
      expect(eventStr).not.toContain("assetCode");
      expect(eventStr).not.toContain("pin");
    });
  });

  describe("Integration with dispatcher", () => {
    let ctx: Awaited<ReturnType<typeof createTestApp>>;
    let db: Db;
    let workspace: { id: string };
    let token: string;

    beforeEach(async () => {
      _resetSentryForTests();
      ctx = await createTestApp();
      db = ctx.db;

      const seeded = await seedWorkspace(db);
      workspace = seeded.workspace;

      const member = await seedMember(db, {
        workspaceId: workspace.id,
        role: "ADMIN",
        allBranches: true,
      });

      const session = await createSession(db, {
        principalId: member.principal.id,
        workspaceId: workspace.id,
      });
      token = session.token;

      initSentry({
        dsn: "https://public@example.invalid/1",
        transport: testTransportFactory,
      });
    });

    afterEach(async () => {
      _resetSentryForTests();
      await ctx.close();
    });

    it("throwing command produces exactly one event with correct tags and no payload", async () => {
      registerCommand({
        name: "sentry-explode",
        version: 1,
        module: "CORE",
        allowedRoles: ["ADMIN"],
        payloadSchema: z.object({}),
        execute: async () => {
          throw new Error("intentional failure");
        },
      });

      await db.insert(approvalRules).values({
        workspaceId: workspace.id,
        commandType: "sentry-explode",
        requiredRole: "ADMIN",
      });

      const commandId = randomUUID();
      const response = await ctx.app.inject({
        method: "POST",
        url: "/v1/commands",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          name: "sentry-explode",
          version: 1,
          envelope: {
            commandId,
            idempotencyKey: `idem-${randomUUID()}`,
            origin: "HUMAN_UI",
          },
          payload: {},
        },
      });

      expect(response.statusCode).toBe(500);
      const errorBody = JSON.parse(response.body);
      expect(errorBody.error.code).toBe("COMMAND_FAILED");

      await Sentry.flush(2000);

      expect(recordedEvents).toHaveLength(1);
      const event = recordedEvents[0];
      expect(event.tags.commandId).toBe(commandId);
      expect(event.tags.workspaceId).toBe(workspace.id);
      expect(event.tags.commandType).toBe("sentry-explode");
      expect(event.tags.origin).toBe("HUMAN_UI");

      const eventStr = JSON.stringify(event);
      // Ensure no payload data leaks, but error message is captured
      expect(eventStr).not.toContain("assetCode");
      expect(eventStr).not.toContain("pin");
    });

    it("expected rejections produce no events", async () => {
      recordedEvents.length = 0;

      // 400: invalid payload
      let response = await ctx.app.inject({
        method: "POST",
        url: "/v1/commands",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId: randomUUID(),
            idempotencyKey: `idem-${randomUUID()}`,
            origin: "HUMAN_UI",
          },
          payload: {
            // Missing required assetCode
            assetClassCode: "TRUCK",
          },
        },
      });
      expect(response.statusCode).toBe(400);

      await Sentry.flush(2000);
      expect(recordedEvents).toHaveLength(0);

      recordedEvents.length = 0;

      // 403: insufficient role
      const member = await seedMember(db, {
        workspaceId: workspace.id,
        role: "EXECUTIVE_VIEWER",
        allBranches: true,
      });
      const limitedSession = await createSession(db, {
        principalId: member.principal.id,
        workspaceId: workspace.id,
      });
      const limitedToken = limitedSession.token;

      response = await ctx.app.inject({
        method: "POST",
        url: "/v1/commands",
        headers: { authorization: `Bearer ${limitedToken}` },
        payload: {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId: randomUUID(),
            idempotencyKey: `idem-${randomUUID()}`,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId: randomUUID(),
            assetCode: "TRUCK-TEST",
            assetClassCode: "TRUCK",
            templateCode: "TRUCKING",
            branchCode: "DLA",
          },
        },
      });
      expect(response.statusCode).toBe(403);

      await Sentry.flush(2000);
      expect(recordedEvents).toHaveLength(0);

      recordedEvents.length = 0;

      // Register once for 409 test
      const idempotencyKey = `idem-${randomUUID()}`;
      response = await ctx.app.inject({
        method: "POST",
        url: "/v1/commands",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId: randomUUID(),
            idempotencyKey,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId: randomUUID(),
            assetCode: "TRUCK-DUP",
            assetClassCode: "TRUCK",
            templateCode: "TRUCKING",
            branchCode: "DLA",
          },
        },
      });
      expect(response.statusCode).toBe(200);

      recordedEvents.length = 0;

      // 409: duplicate idempotency key
      response = await ctx.app.inject({
        method: "POST",
        url: "/v1/commands",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          name: "register-asset",
          version: 1,
          envelope: {
            commandId: randomUUID(),
            idempotencyKey,
            origin: "HUMAN_UI",
          },
          payload: {
            assetId: randomUUID(),
            assetCode: "TRUCK-DUP-2",
            assetClassCode: "TRUCK",
            templateCode: "TRUCKING",
            branchCode: "DLA",
          },
        },
      });
      expect(response.statusCode).toBe(409);

      await Sentry.flush(2000);
      expect(recordedEvents).toHaveLength(0);
    });
  });

  afterAll(() => {
    _resetSentryForTests();
  });
});
