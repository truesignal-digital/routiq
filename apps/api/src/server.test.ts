import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { workspaces } from "./db/schema.js";
import { createTestApp } from "./test/fixture.js";
import { buildServer } from "./server.js";

describe("api server (integration)", () => {
  let ctx: Awaited<ReturnType<typeof createTestApp>>;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.close();
  });

  it("responds on /health against the real database", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("has migrations applied (workspaces table queryable)", async () => {
    const rows = await ctx.db.select().from(workspaces);
    expect(Array.isArray(rows)).toBe(true);
  });

  it("runs normal application database traffic as the restricted runtime role", async () => {
    const result = await ctx.runtimeDb.execute(sql`
      select current_user as role_name, rolbypassrls
      from pg_roles
      where rolname = current_user
    `);

    expect(result.rows).toEqual([
      expect.objectContaining({
        role_name: "routiq_app",
        rolbypassrls: false,
      }),
    ]);
  });

  it("refuses to start with a privileged runtime database connection", async () => {
    const unsafeApp = buildServer({
      db: ctx.db,
      authDb: ctx.db,
      logger: false,
    });
    await expect(unsafeApp.ready()).rejects.toThrow(
      "runtime database role must be non-superuser without BYPASSRLS",
    );
    await unsafeApp.close();
  });
});
