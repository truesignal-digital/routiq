import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { drive, signedInUsername } from "./browser.js";

const harness = vi.hoisted(() => ({ dir: "", commit: "slot-start", url: "http://localhost/", dirty: false,
  /** What the page's localStorage holds under routiq.sessions.v1. */
  session: null as string | null,
  emit: (_event: string, ..._args: unknown[]): boolean => false, events: () => {},
}));
vi.mock("./stack.js", () => ({
  requireState: () => ({ commit: harness.commit, urls: { web: "http://localhost", api: "http://localhost" } }),
  newRunDir: () => harness.dir,
}));
vi.mock("./proc.js", () => ({
  run: (_command: string, args: string[]) => ({ stdout: args[0] === "rev-parse" ? "drive-head\n" : harness.dirty ? " M tools/verify/browser.ts\n" : "" }),
}));
vi.mock("playwright-core", async () => {
  const { EventEmitter } = await import("node:events");
  const events = new EventEmitter();
  harness.emit = events.emit.bind(events);
  const locator = { fill: async () => {}, click: async () => {} };
  const page = {
    on: events.on.bind(events), url: () => harness.url, goto: async () => {},
    getByLabel: () => locator, getByRole: () => locator,
    waitForURL: async () => {}, waitForTimeout: async () => {},
    screenshot: async () => {}, close: async () => {},
    evaluate: async (fn: unknown) => {
      if (String(fn).includes("routiq.sessions.v1")) return harness.session;
      harness.events();
      harness.events = () => {};
      return { layoutShifts: 0, cumulativeLayoutShift: 0, domNodes: 10 };
    },
  };
  return { chromium: { launch: async () => ({
    newContext: async () => ({ addInitScript: async () => {}, newPage: async () => { events.removeAllListeners(); return page; }, close: async () => {} }),
    close: async () => {},
  }) } };
});

const options = { role: "admin", lang: "fr", video: false, reel: false, throttle: "none", strict: false, headed: false, viewport: { width: 1440, height: 900 } } as const;
const summary = () => JSON.parse(readFileSync(path.join(harness.dir, "summary.json"), "utf8")) as {
  ok: boolean; account: string; frames: Array<{ label: string; account?: string }>; commit: string; metrics: { consoleErrors: number; failedRequests: number; expectedRefusals?: number }; steps: Array<{ step: string; ok: boolean; detail: string }>;
};

beforeEach(() => {
  harness.session = null;
  harness.events = () => {};
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


describe("expected refusals", () => {
  it("keeps intended 409s in evidence but excludes only their resource errors from reel metrics", async () => {
    const file = path.join(harness.dir, "refusal.mjs");
    writeFileSync(file, `export default async ctx => {
      ctx.expectRefusal({ status: 409, url: /\\/v1\\/commands\\/register-asset$/g });
      await ctx.page.evaluate(() => {});
    };`);
    harness.events = () => {
      const response = (status: number, url: string) => harness.emit("response", {
        status: () => status, url: () => url, request: () => ({ method: () => "POST" }),
      });
      const consoleError = (text: string, url: string) => harness.emit("console", {
        type: () => "error", text: () => text, location: () => ({ url }),
      });
      const url = "http://localhost/v1/commands/register-asset";
      for (let n = 0; n < 2; n += 1) {
        response(409, url);
        consoleError("Failed to load resource: the server responded with a status of 409 (Conflict)", url);
      }
      response(500, url);
      response(409, "http://localhost/v1/commands/other");
      consoleError("application error 409", url);
      consoleError("Failed to load resource: the server responded with a status of 500 (Server Error)", url);
      harness.emit("requestfailed", { url: () => url, method: () => "POST", failure: () => ({ errorText: "net::ERR_FAILED" }) });
    };
    expect(await drive(1, [file], options, "drive")).toBe(true);
    expect(summary().metrics).toMatchObject({ consoleErrors: 2, failedRequests: 3, expectedRefusals: 2 });
    expect(readFileSync(path.join(harness.dir, "failed-requests.txt"), "utf8")).toContain("409 POST");
    expect(readFileSync(path.join(harness.dir, "console-errors.txt"), "utf8")).toContain("status of 409");
  });
});


it("refuses declarations that would conceal server failures", async () => {
  const file = path.join(harness.dir, "invalid-refusal.mjs");
  writeFileSync(file, 'export default async ctx => { ctx.expectRefusal({ status: 500, url: /./ }); };');
  expect(await drive(1, [file], options, "drive")).toBe(false);
  expect(summary().steps.at(-1)?.detail).toContain("400 to 499");
});


describe("--strict", () => {
  it("records ok: false in summary.json when a console error fails the run (#567)", async () => {
    harness.events = () => {
      harness.emit("console", { type: () => "error", text: () => "boom", location: () => ({ url: "http://localhost/" }) });
    };
    expect(await drive(1, [], { ...options, strict: true }, "drive")).toBe(false);
    expect(summary().ok).toBe(false);
  });

  it("leaves a clean strict run ok", async () => {
    expect(await drive(1, [], { ...options, strict: true }, "drive")).toBe(true);
    expect(summary().ok).toBe(true);
  });
});


describe("signed-in account per shot (#565)", () => {
  const sessions = (username: string | undefined) => JSON.stringify({
    sessions: { "transports-ngwa:boris": { username: "boris", workspaceSlug: "transports-ngwa", token: "t", expiresAt: "2099-01-01T00:00:00Z" },
      "transports-ngwa:nadege": { username: "nadege", workspaceSlug: "transports-ngwa", token: "t", expiresAt: "2099-01-01T00:00:00Z" } },
    ...(username === undefined ? {} : { activeKey: `transports-ngwa:${username}` }),
  });

  it("records who was signed in at each shot, not only the account the drive started as", async () => {
    const file = path.join(harness.dir, "switch.mjs");
    writeFileSync(file, `export default async ctx => {
      await ctx.shot("as-admin");
      globalThis.__switch("signed-out");
      await ctx.shot("login-page");
      globalThis.__switch("nadege");
      await ctx.shot("as-finance");
    };`);
    harness.session = sessions("boris");
    (globalThis as { __switch?: (to: string) => void }).__switch = (to) => {
      harness.session = sessions(to === "signed-out" ? undefined : to);
    };
    expect(await drive(1, [file], options, "drive")).toBe(true);
    expect(summary().account).toBe("boris");
    expect(summary().frames.map(({ label, account }) => [label, account])).toEqual([
      ["as-admin", "boris"], ["login-page", ""], ["as-finance", "nadege"],
    ]);
  });
});

it("reads no account from a value it can't parse", () => {
  expect(signedInUsername("{not json")).toBeUndefined();
  expect(signedInUsername(undefined)).toBeUndefined();
  expect(signedInUsername(null)).toBe("");
});
