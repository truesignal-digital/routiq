import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { drive } from "./browser.js";

const harness = vi.hoisted(() => ({ dir: "", commit: "slot-start", url: "http://localhost/", dirty: false }));
vi.mock("./stack.js", () => ({
  requireState: () => ({ commit: harness.commit, urls: { web: "http://localhost", api: "http://localhost" } }),
  newRunDir: () => harness.dir,
}));
vi.mock("./proc.js", () => ({
  run: (_command: string, args: string[]) => ({ stdout: args[0] === "rev-parse" ? "drive-head\n" : harness.dirty ? " M tools/verify/browser.ts\n" : "" }),
}));
vi.mock("playwright-core", () => {
  const locator = { fill: async () => {}, click: async () => {} };
  const page = {
    on: () => {}, url: () => harness.url, goto: async () => {},
    getByLabel: () => locator, getByRole: () => locator,
    waitForURL: async () => {}, waitForTimeout: async () => {},
    screenshot: async () => {}, close: async () => {},
    evaluate: async () => ({ layoutShifts: 0, cumulativeLayoutShift: 0, domNodes: 10 }),
  };
  return { chromium: { launch: async () => ({
    newContext: async () => ({ addInitScript: async () => {}, newPage: async () => page, close: async () => {} }),
    close: async () => {},
  }) } };
});

const options = { role: "admin", lang: "fr", video: false, reel: false, throttle: "none", strict: false, headed: false, viewport: { width: 1440, height: 900 } } as const;
const summary = () => JSON.parse(readFileSync(path.join(harness.dir, "summary.json"), "utf8")) as {
  ok: boolean; commit: string; dirty?: boolean; steps: Array<{ step: string; ok: boolean; detail: string }>;
};

beforeEach(() => {
  harness.dir = mkdtempSync(path.join(tmpdir(), "verify-browser-"));
  let clock = 0;
  vi.spyOn(Date, "now").mockImplementation(() => (clock += 500));
});

describe("drive script loading", () => {
  it.each([
    ["syntax", "export default (", /Unexpected|Parse|parse|end of input/],
    ["export", "export const other = 1;", /has no default export function/],
  ])("records a failed step for a %s error", async (name, source, message) => {
    const file = path.join(harness.dir, `${name}.mjs`);
    writeFileSync(file, source);
    expect(await drive(1, [file], options, "drive")).toBe(false);
    expect(summary()).toMatchObject({ ok: false, steps: [
      { ok: true }, { step: expect.stringContaining(name), ok: false, detail: expect.stringMatching(message) },
    ] });
  });
});


describe("drive provenance", () => {
  it.each([false, true])("records HEAD at drive time, dirty=%s", async (dirty) => {
    harness.dirty = dirty;
    expect(await drive(1, [], options, "drive")).toBe(true);
    expect(summary().commit).toBe(dirty ? "drive-head-dirty" : "drive-head");
  });
});
