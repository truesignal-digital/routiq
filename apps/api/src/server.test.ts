import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { workspaces } from "./db/schema.js";
import { createTestApp } from "./test/fixture.js";

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
});
