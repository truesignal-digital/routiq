import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { commands, workspaceModules, workspaceTemplates } from "../src/db/schema.js";
import { createTestApp } from "../src/test/fixture.js";
import { seedWorkspace } from "../src/test/seed.js";

/** The vendor CLI as an operator runs it: a child process against a real Postgres. */
const run = promisify(execFile);
const apiRoot = fileURLToPath(new URL("..", import.meta.url));
const tsx = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));

function cliEnv(): NodeJS.ProcessEnv {
  const ownerUrl = inject("databaseUrl");
  const runtimeUrl = new URL(ownerUrl);
  runtimeUrl.username = "routiq_app";
  runtimeUrl.password = "routiq_app";
  return { ...process.env, DATABASE_URL: runtimeUrl.toString(), AUTH_DATABASE_URL: ownerUrl };
}

function entitlement(...args: string[]) {
  return run(tsx, ["scripts/entitlement.ts", ...args], { cwd: apiRoot, env: cliEnv(), timeout: 60_000 });
}

describe("entitlement CLI", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("turns a module off and a preset on for the named workspace through platform receipts", async () => {
    const { workspace } = await seedWorkspace(ctx.db);

    const off = await entitlement("--workspace", workspace.slug, "--disable-module", "FINANCE");
    expect(off.stdout).toContain(`Module FINANCE disabled for ${workspace.slug}`);
    const preset = await entitlement("--workspace", workspace.slug, "--disable-preset", "PASSENGER_TRANSPORT");
    expect(preset.stdout).toContain(`Preset PASSENGER_TRANSPORT disabled for ${workspace.slug}`);

    const [module] = await ctx.db
      .select()
      .from(workspaceModules)
      .where(and(eq(workspaceModules.workspaceId, workspace.id), eq(workspaceModules.moduleCode, "FINANCE")));
    expect(module?.enabled).toBe(false);
    const presets = await ctx.db
      .select({ code: workspaceTemplates.presetCode, enabled: workspaceTemplates.enabled })
      .from(workspaceTemplates)
      .where(eq(workspaceTemplates.workspaceId, workspace.id));
    expect(presets).toContainEqual({ code: "PASSENGER_TRANSPORT", enabled: false });

    const receipts = await ctx.db
      .select({ type: commands.commandType, scope: commands.scope, version: commands.commandVersion })
      .from(commands)
      .where(eq(commands.workspaceId, workspace.id));
    expect(receipts).toEqual(
      expect.arrayContaining([
        { type: "disable-module", scope: "PLATFORM", version: "2" },
        { type: "set-template-preset", scope: "PLATFORM", version: "2" },
      ]),
    );
  }, 120_000);

  it("refuses an unknown code or a missing action with exit code 1", async () => {
    await expect(entitlement("--workspace", "anything", "--disable-module", "CORE")).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Unknown module CORE"),
    });
    await expect(entitlement("--workspace", "anything")).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("Usage:"),
    });
  }, 120_000);
});
