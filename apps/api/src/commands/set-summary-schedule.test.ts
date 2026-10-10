import { randomUUID } from "node:crypto";
import type { CompanySettingsResponse, OverviewNotice, Role } from "@routiq/contracts";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSession } from "../auth/local.js";
import { auditEvents, companySettings } from "../db/schema.js";
import { currentBusinessDate } from "../reads/business-date.js";
import { summarySchedule } from "../reads/overview-notice.js";
import { createTestApp } from "../test/fixture.js";
import { seedMember, seedWorkspace } from "../test/seed.js";

/**
 * #669: Direction picks when the summary notice shows (Company settings ›
 * Dashboard summary) through set-summary-schedule, audited, and every
 * Overview read follows it.
 */
describe("set-summary-schedule (#669)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;
  let workspaceId: string;
  const tokens = {} as Record<Role, string>;
  const today = () => currentBusinessDate(new Date(), "Africa/Douala");

  beforeAll(async () => {
    ctx = await createTestApp();
    workspaceId = (await seedWorkspace(ctx.db)).workspace.id;
    for (const role of ["DIRECTOR", "ADMIN", "FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"] as const) {
      const member = await seedMember(ctx.db, { workspaceId, role, allBranches: true });
      tokens[role] = (await createSession(ctx.db, { workspaceId, principalId: member.principal.id })).token;
    }
  });

  afterAll(async () => {
    await ctx.close();
  });

  const get = (token: string, url: string) =>
    ctx.app.inject({ method: "GET", url, headers: { authorization: `Bearer ${token}` } });

  async function settings(): Promise<CompanySettingsResponse> {
    const response = await get(tokens.DIRECTOR, "/v1/company-settings");
    expect(response.statusCode).toBe(200);
    return response.json() as CompanySettingsResponse;
  }

  function post(token: string, schedule: string, envelope: Record<string, unknown>) {
    return ctx.app.inject({
      method: "POST",
      url: "/v1/commands/set-summary-schedule",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        version: 1,
        envelope: { commandId: randomUUID(), idempotencyKey: `idem-${randomUUID()}`, origin: "HUMAN_UI", ...envelope },
        payload: { schedule },
      },
    });
  }

  async function setSchedule(schedule: string) {
    const { version } = await settings();
    const response = await post(tokens.DIRECTOR, schedule, { expectedVersion: version });
    expect(response.statusCode).toBe(200);
    return response.json() as { commandId: string };
  }

  async function notice(token: string, url: string): Promise<OverviewNotice> {
    const response = await get(token, url);
    expect(response.statusCode, url).toBe(200);
    return (response.json() as { notice: OverviewNotice }).notice;
  }

  const audit = (commandId: string) =>
    ctx.db
      .select()
      .from(auditEvents)
      .where(and(eq(auditEvents.workspaceId, workspaceId), eq(auditEvents.commandId, commandId)));

  it("starts every company on Mondays and the 1st, with no row and version 0", async () => {
    expect(await settings()).toEqual({ summarySchedule: "MONDAY_AND_MONTH_START", version: 0 });
    const trucks = await notice(tokens.DIRECTOR, "/v1/assets/overview");
    expect(trucks).toMatchObject({ schedule: "MONDAY_AND_MONTH_START", ...summarySchedule(today()) });
  });

  it("is read and changed by Direction alone", async () => {
    for (const role of ["ADMIN", "FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"] as const) {
      expect((await get(tokens[role], "/v1/company-settings")).statusCode, role).toBe(403);
      const refused = await post(tokens[role], "NEVER", { expectedVersion: 0 });
      expect(refused.statusCode, role).toBe(403);
      expect(refused.json()).toMatchObject({ error: { code: "ROLE_FORBIDDEN" } });
    }
    expect((await settings()).summarySchedule).toBe("MONDAY_AND_MONTH_START");
  });

  it("refuses a change without the version it was made against, or against a stale one", async () => {
    const missing = await post(tokens.DIRECTOR, "MONDAY", {});
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toMatchObject({ error: { code: "EXPECTED_VERSION_REQUIRED" } });
    const stale = await post(tokens.DIRECTOR, "MONDAY", { expectedVersion: 3 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json()).toMatchObject({ error: { code: "VERSION_CONFLICT" } });
    const unknown = await post(tokens.DIRECTOR, "DAILY", { expectedVersion: 0 });
    expect(unknown.statusCode).toBe(400);
  });

  it("writes the first change, audited, and every Overview follows it for every role", async () => {
    const { commandId } = await setSchedule("MONDAY");
    expect(await settings()).toEqual({ summarySchedule: "MONDAY", version: 1 });

    const [row] = await ctx.db.select().from(companySettings).where(eq(companySettings.workspaceId, workspaceId));
    expect(row).toMatchObject({ summarySchedule: "MONDAY", createdByCommandId: commandId, updatedByCommandId: commandId });
    expect(await audit(commandId)).toEqual([
      expect.objectContaining({
        eventType: "company-settings.summary-schedule-changed",
        entityType: "company_settings",
        entityId: workspaceId,
        beforeState: { summarySchedule: "MONDAY_AND_MONTH_START" },
        afterState: { summarySchedule: "MONDAY" },
        changedFields: ["summarySchedule"],
      }),
    ]);

    const expected = { schedule: "MONDAY", ...summarySchedule(today(), "MONDAY") };
    expect(await notice(tokens.DIRECTOR, "/v1/assets/overview")).toMatchObject(expected);
    expect(await notice(tokens.ADMIN, "/v1/activities/summary")).toMatchObject(expected);
    expect(await notice(tokens.DRIVER, "/v1/assets/overview")).toMatchObject(expected);
    expect(await notice(tokens.FINANCE, "/v1/finance/overview")).toMatchObject(expected);
  });

  it("turns the schedule off with NEVER, and names no scheduled day", async () => {
    const { commandId } = await setSchedule("NEVER");
    expect(await settings()).toEqual({ summarySchedule: "NEVER", version: 2 });
    expect(await audit(commandId)).toEqual([
      expect.objectContaining({ beforeState: { summarySchedule: "MONDAY" }, afterState: { summarySchedule: "NEVER" } }),
    ]);
    expect(await notice(tokens.TECHNICIAN, "/v1/maintenance/summary")).toMatchObject({
      schedule: "NEVER",
      scheduledOn: null,
      scheduledToday: null,
    });
  });

  it("writes nothing but the no-change event when the schedule is already in force", async () => {
    const { commandId } = await setSchedule("NEVER");
    expect(await settings()).toEqual({ summarySchedule: "NEVER", version: 2 });
    expect(await audit(commandId)).toEqual([expect.objectContaining({ eventType: "command.no_change" })]);
  });

  it("goes back to the default by choosing it", async () => {
    await setSchedule("MONDAY_AND_MONTH_START");
    expect(await settings()).toEqual({ summarySchedule: "MONDAY_AND_MONTH_START", version: 3 });
    expect(await notice(tokens.CASHIER, "/v1/finance/overview")).toMatchObject({
      schedule: "MONDAY_AND_MONTH_START",
      ...summarySchedule(today()),
    });
  });
});
