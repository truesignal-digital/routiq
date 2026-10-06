import { describe, expect, it } from "vitest";
import { judgeField, parseWindow, routeTimings, table, type FieldCeiling } from "./observe.js";

describe("parseWindow", () => {
  it("turns short spans into Postgres intervals", () => {
    expect(parseWindow("7d")).toBe("7 days");
    expect(parseWindow("24h")).toBe("24 hours");
    expect(() => parseWindow("a week")).toThrow(/7d, 24h or 30m/);
  });
});

describe("routeTimings", () => {
  it("groups request.completed lines by method and route template and skips everything else", () => {
    const line = (route: string, durationMs: number, statusCode = 200) =>
      JSON.stringify({ level: 30, event: "request.completed", method: "GET", route, url: `${route}?x=1`, statusCode, durationMs });
    const log = [
      "(node:1) FastifyDeprecation: something",
      line("/v1/finance/entries/:id", 10),
      line("/v1/finance/entries/:id", 30),
      line("/v1/finance/entries/:id", 500, 503),
      line("/v1/me", 2),
      '{"level":30,"event":"storage.bucket_ready"}',
      "{not json",
    ].join("\n");
    const rows = routeTimings(log);
    expect(rows[0]).toEqual({ route: "GET /v1/finance/entries/:id", n: 3, p50Ms: 30, p95Ms: 500, maxMs: 500, errors5xx: 1 });
    expect(rows[1]).toMatchObject({ route: "GET /v1/me", n: 1 });
  });
});

describe("table", () => {
  it("aligns columns, shows missing values as a dash and cuts long text", () => {
    const out = table([{ name: "command:approve-entry", p75Ms: 812, note: null }, { name: "x", p75Ms: 9, note: "y".repeat(80) }], undefined, 20);
    const lines = out.trimEnd().split("\n");
    expect(lines[0]).toMatch(/^ {2}name {2,}p75Ms {2}note$/);
    expect(lines[1]).toContain("–");
    expect(lines[2]).toContain("…");
  });

  it("says so when there is nothing", () => {
    expect(table([])).toBe("  (none)\n");
  });
});

describe("judgeField", () => {
  const ceiling: FieldCeiling = { kind: "journey", name: "command:approve-entry", p75: 1000, minSamples: 200 };

  it("does not enforce a release without enough samples", () => {
    expect(judgeField(ceiling, { n: 12, p75: 5000, release: "abc" })).toMatchObject({ status: "thin", n: 12 });
    expect(judgeField(ceiling, undefined)).toMatchObject({ status: "thin", n: 0 });
  });

  it("fails above the ceiling and calls 10% under it slack", () => {
    expect(judgeField(ceiling, { n: 300, p75: 1001, release: "abc" }).status).toBe("over");
    expect(judgeField(ceiling, { n: 300, p75: 950, release: "abc" }).status).toBe("ok");
    expect(judgeField(ceiling, { n: 300, p75: 850, release: "abc" }).status).toBe("slack");
  });
});
