import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { handRaised, initialAssets, judge, measureWebBuild, raise, tighten, type Ceilings, type Values } from "./metrics.js";

const values = (over: Partial<Values> = {}): Values => ({
  "web.initial-js-gzip": 100,
  "web.initial-css-gzip": 20,
  "web.all-js-gzip": 300,
  ...over,
});

describe("initialAssets", () => {
  it("reads the entry script, modulepreloads and stylesheets Vite writes", () => {
    const html = `<script type="module" crossorigin src="/static/index-a1.js"></script>
<link rel="modulepreload" crossorigin href="/static/vendor-b2.js">
<link rel="stylesheet" crossorigin href="/static/index-c3.css">
<link rel="icon" href="/favicon.svg">
<link rel="stylesheet" href="https://fonts.example/x.css">`;
    expect(initialAssets(html)).toEqual({ js: ["/static/index-a1.js", "/static/vendor-b2.js"], css: ["/static/index-c3.css"] });
  });
});

describe("measureWebBuild", () => {
  it("counts lazy chunks in the total but not in the first load", () => {
    const dist = mkdtempSync(path.join(tmpdir(), "dist-"));
    mkdirSync(path.join(dist, "static"));
    writeFileSync(path.join(dist, "index.html"), `<script type="module" src="/static/entry.js"></script>`);
    writeFileSync(path.join(dist, "static/entry.js"), "export const a = 1;".repeat(50));
    writeFileSync(path.join(dist, "static/lazy.js"), "export const b = 2;".repeat(500));
    const measured = measureWebBuild(dist);
    expect(measured["web.initial-js-gzip"]).toBeGreaterThan(0);
    expect(measured["web.all-js-gzip"]).toBeGreaterThan(measured["web.initial-js-gzip"]);
    expect(measured["web.initial-css-gzip"]).toBe(0);
  });

  it("asks for a build when dist is missing", () => {
    expect(() => measureWebBuild("/nonexistent/dist")).toThrow(/build first/);
  });
});

describe("judge", () => {
  const ceilings: Ceilings = { "web.initial-js-gzip": { ceiling: 100 }, "web.all-js-gzip": { ceiling: 310 } };

  it("passes at the ceiling, fails above it, asks to tighten below it, and reports unset ones", () => {
    expect(judge(values(), ceilings).map((v) => [v.id, v.status])).toEqual([
      ["web.initial-js-gzip", "ok"],
      ["web.initial-css-gzip", "unset"],
      ["web.all-js-gzip", "stale"],
    ]);
    expect(judge(values({ "web.initial-js-gzip": 101 }), ceilings)[0]?.status).toBe("over");
  });
});

describe("tighten", () => {
  it("lowers and sets ceilings but never raises one", () => {
    const next = tighten(values({ "web.initial-js-gzip": 120, "web.all-js-gzip": 290 }), { "web.initial-js-gzip": { ceiling: 100 }, "web.all-js-gzip": { ceiling: 300 } });
    expect(next).toEqual({
      "web.initial-js-gzip": { ceiling: 100 },
      "web.initial-css-gzip": { ceiling: 20 },
      "web.all-js-gzip": { ceiling: 290 },
    });
  });
});

describe("handRaised", () => {
  const base: Ceilings = { "web.initial-js-gzip": { ceiling: 100 } };

  it("flags a ceiling edited upward by hand", () => {
    expect(handRaised({ "web.initial-js-gzip": { ceiling: 120 } }, base)).toEqual(["web.initial-js-gzip"]);
  });

  it("accepts a raise that pnpm metrics raise recorded, a lowered ceiling, and a new one", () => {
    const raised = raise(values({ "web.initial-js-gzip": 120 }), base, "web.initial-js-gzip", "Charts on Home are the director's first screen", "2026-10-05");
    expect(handRaised(raised, base)).toEqual([]);
    expect(handRaised({ "web.initial-js-gzip": { ceiling: 90 } }, base)).toEqual([]);
    expect(handRaised({ "web.all-js-gzip": { ceiling: 999 } }, base)).toEqual([]);
  });
});

describe("raise", () => {
  const ceilings: Ceilings = { "web.initial-js-gzip": { ceiling: 100 } };

  it("records the reason next to the new ceiling", () => {
    const next = raise(values({ "web.initial-js-gzip": 130 }), ceilings, "web.initial-js-gzip", "Charts on Home are the director's first screen", "2026-10-05");
    expect(next["web.initial-js-gzip"]).toEqual({
      ceiling: 130,
      raises: [{ date: "2026-10-05", from: 100, to: 130, reason: "Charts on Home are the director's first screen" }],
    });
  });

  it("refuses without a real reason or without growth", () => {
    expect(() => raise(values({ "web.initial-js-gzip": 130 }), ceilings, "web.initial-js-gzip", "needed", "2026-10-05")).toThrow(/reason/);
    expect(() => raise(values(), ceilings, "web.initial-js-gzip", "a long enough reason here", "2026-10-05")).toThrow(/nothing to raise/);
  });
});
