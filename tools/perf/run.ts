import { readFileSync } from "node:fs";
import pg from "pg";
import { chromium, type Page } from "playwright-core";
import { DEMO_WORKSPACE, resolveAccount } from "../verify/accounts.js";
import { PHONE_PROFILE } from "../verify/browser.js";
import { named, pageNow, readShifts, SHIFT_PROBE } from "../verify/shifts.js";
import { tapMySettings, tapText, tapTo } from "../verify/tap.js";
import { slotPorts } from "../verify/slot.js";
import type { SlotState } from "../verify/stack.js";
import { median, type Measured, type Run } from "./perf.js";

/**
 * The screens a run opens after sign-in, in order, each by a tap: its sidebar
 * row, or a link on the screen or on Home (#494). `:asset` is the first vehicle
 * in the list, tapped from /assets; My settings opens from the name menu.
 */
export const SCREENS = ["/assets", "/assets/:asset", "/activities", "/finance/entries", "/finance/approvals", "/maintenance", "/my-settings"] as const;

/** Screens whose link redirects: the tap lands on another path (#314). */
const LANDS_ON: Partial<Record<(typeof SCREENS)[number], string>> = { "/finance/approvals": "/finance/entries" };

/** How long a run stays on Home after sign-in before opening the next screen. */
export const HOME_DWELL_MS = 3_000;

export const PROFILE = `phone: CPU ${PHONE_PROFILE.cpuSlowdown}x, ${PHONE_PROFILE.latencyMs} ms RTT, ${PHONE_PROFILE.downloadKbps} kbps down, 390x844, fr, ${HOME_DWELL_MS / 1000} s on Home`;

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
export const template = (route: string) => route.replace(UUID, ":id");

interface OneRun {
  /** metric → value for this run */
  values: Record<string, number>;
}

/**
 * Nothing in flight for a second (API calls and code chunks alike), and at
 * least a second since the call: a screen whose code is still downloading, or
 * that makes no requests, still gets time to render and report.
 */
async function settle(page: Page, inflight: () => number, lastActivity: () => number): Promise<void> {
  const since = Date.now();
  const deadline = since + 45_000;
  while (Date.now() < deadline) {
    if (inflight() === 0 && Date.now() - Math.max(lastActivity(), since) > 1_000) return;
    await page.waitForTimeout(100);
  }
}

/** A run on a saturated machine can hang in the browser; past this it counts as a run that produced nothing. */
const RUN_TIMEOUT_MS = 180_000;

async function measureOnce(state: SlotState, db: pg.Client, asset: Vehicle): Promise<OneRun> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<OneRun>((resolve) => {
    timer = setTimeout(() => resolve({ values: {} }), RUN_TIMEOUT_MS);
  });
  try {
    return await Promise.race([measureOnceUnbounded(state, db, asset), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function measureOnceUnbounded(state: SlotState, db: pg.Client, asset: Vehicle): Promise<OneRun> {
  const account = resolveAccount("director");
  const browser = await chromium.launch();
  const values: Record<string, number> = {};
  const started = new Date();
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "fr-FR", timezoneId: "Africa/Douala", colorScheme: "light" });
    await context.addInitScript(SHIFT_PROBE);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: PHONE_PROFILE.cpuSlowdown });
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: PHONE_PROFILE.latencyMs,
      downloadThroughput: (PHONE_PROFILE.downloadKbps * 1000) / 8,
      uploadThroughput: (PHONE_PROFILE.uploadKbps * 1000) / 8,
    });

    let inflight = 0;
    let lastActivity = Date.now();
    let apiRequests = 0;
    let scriptBytes = 0;
    const isApi = (url: string) => new URL(url).pathname.startsWith("/v1/") && !url.includes("/v1/telemetry");
    // Telemetry beacons are the measurement itself, not the screen's work.
    const counts = (url: string) => !url.includes("/v1/telemetry");
    page.on("request", (req) => {
      if (!counts(req.url())) return;
      inflight += 1;
      lastActivity = Date.now();
      if (isApi(req.url())) apiRequests += 1;
    });
    const done = (url: string) => {
      if (!counts(url)) return;
      inflight = Math.max(0, inflight - 1);
      lastActivity = Date.now();
    };
    page.on("requestfinished", (req) => {
      done(req.url());
      if (req.resourceType() === "script") void req.sizes().then((s) => (scriptBytes += s.responseBodySize)).catch(() => undefined);
    });
    page.on("requestfailed", (req) => done(req.url()));

    await page.goto(`${state.urls.web}/login`, { waitUntil: "commit" });
    await page.getByLabel(/^(Code PIN|PIN code)$/).waitFor({ timeout: 90_000 });
    await page.waitForLoadState("load");
    values["login.js_bytes"] = scriptBytes;

    await page.getByLabel(/^(Espace de travail|Workspace)$/).fill(DEMO_WORKSPACE);
    await page.getByLabel(/^(Nom d'utilisateur|Username)$/).fill(account.username);
    await page.getByLabel(/^(Code PIN|PIN code)$/).fill(account.pin);
    const beforeHome = apiRequests;
    await page.getByRole("button", { name: /^(Se connecter|Sign in)$/ }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 60_000 });
    await settle(page, () => inflight, () => lastActivity);
    values["/.requests"] = apiRequests - beforeHome;
    // Moves in the shell or on Home once drawn, from the sign-in tap on.
    values["/.shifts"] = named(await readShifts(page)).length;
    // A user reads Home for a few seconds before moving on; whatever the app does in that time counts.
    await page.waitForTimeout(HOME_DWELL_MS);

    for (const screen of SCREENS) {
      const key = template(screen.replace(":asset", "00000000-0000-0000-0000-000000000000"));
      const before = apiRequests;
      const start = await pageNow(page);
      if (screen === "/assets/:asset") await tapText(page, asset.code);
      else if (screen === "/my-settings") await tapMySettings(page);
      else await tapTo(page, screen, LANDS_ON[screen]);
      await settle(page, () => inflight, () => lastActivity);
      values[`${key}.requests`] = apiRequests - before;
      values[`${key}.shifts`] = named(await readShifts(page, start)).length;
    }

    // A refresh on Home: the shell and Home are drawn again from nothing.
    await tapTo(page, "/");
    await settle(page, () => inflight, () => lastActivity);
    await page.reload({ waitUntil: "commit" });
    await settle(page, () => inflight, () => lastActivity);
    values["reload.shifts"] = named(await readShifts(page)).length;

    // Close the tab like a user so the app sends its last telemetry batch (vitals, journeys).
    await page.close({ runBeforeUnload: true });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    await context.close();
  } finally {
    await browser.close();
  }

  const events = (
    await db.query<{ kind: string; name: string; value: number }>(
      `select kind, name, value from telemetry.events where received_at >= $1 and kind in ('journey', 'vital') order by occurred_at`,
      [started],
    )
  ).rows;
  for (const event of events) {
    if (event.kind === "vital" && event.name === "LCP" && values["login.lcp_ms"] === undefined) values["login.lcp_ms"] = event.value;
    if (event.kind !== "journey") continue;
    // The sign-in load, not the reload at the end of the run.
    if (event.name === "app:usable") values["login.usable_ms"] ??= event.value;
    else if (event.name.startsWith("route:")) {
      const key = `${event.name.slice("route:".length)}.ready_ms`;
      // The first visit to a screen in a run is the one measured.
      if (values[key] === undefined) values[key] = event.value;
    }
  }
  return { values };
}

/** Server time per request over the run, pooled across routes, from the slot API's request log. */
function apiP95(logFile: string, since: number): number | undefined {
  const durations: number[] = [];
  for (const line of readFileSync(logFile, "utf8").split("\n")) {
    if (!line.startsWith("{") || !line.includes('"request.completed"')) continue;
    try {
      const entry = JSON.parse(line) as { time?: number; durationMs?: number; route?: string };
      if ((entry.time ?? 0) >= since && typeof entry.durationMs === "number" && entry.route !== "/v1/telemetry") durations.push(entry.durationMs);
    } catch {
      // not a log line
    }
  }
  if (durations.length === 0) return undefined;
  const sorted = durations.sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
}

const kindOf = (name: string) => (name.endsWith("_bytes") ? "bytes" : name.endsWith(".requests") || name.endsWith(".shifts") ? "count" : "time");

interface Vehicle {
  id: string;
  code: string;
}

interface Target {
  state: SlotState;
  db: pg.Client;
  asset: Vehicle;
}

async function open(state: SlotState): Promise<Target> {
  if (state.web !== "built") throw new Error(`slot ${state.slot} serves the dev server; perf needs a built app: pnpm verify down --slot ${state.slot} && pnpm verify up --slot ${state.slot} --built`);
  const db = new pg.Client({ connectionString: `postgres://routiq:routiq@127.0.0.1:${slotPorts(state.slot).postgres}/routiq_dev` });
  await db.connect();
  const row = (await db.query<{ id: string; code: string }>(`select id, asset_code as code from assets order by asset_code limit 1`)).rows[0];
  if (row === undefined) {
    await db.end();
    throw new Error(`slot ${state.slot} has no vehicles; reseed it`);
  }
  return { state, db, asset: row };
}

function summarise(target: Target, all: OneRun[], runs: number, since: number): Run {
  const names = [...new Set(all.flatMap((one) => Object.keys(one.values)))];
  const metrics: Measured = {};
  const incomplete: string[] = [];
  for (const name of names) {
    const samples = all.flatMap((one) => (one.values[name] === undefined ? [] : [one.values[name] as number]));
    if (samples.length < runs) incomplete.push(`${name} (${samples.length} of ${runs} runs)`);
    metrics[name] = { value: median(samples), samples, kind: kindOf(name) };
  }
  const p95 = apiP95(target.state.logs.api, since);
  if (p95 !== undefined) metrics["api.p95_ms"] = { value: p95, samples: [p95], kind: "time" };
  return { at: new Date().toISOString(), commit: target.state.commit, profile: PROFILE, runs, metrics, ...(incomplete.length > 0 ? { incomplete } : {}) };
}

export async function measure(state: SlotState, runs: number, log: (line: string) => void): Promise<Run> {
  const target = await open(state);
  try {
    // One unrecorded run first: a freshly started API compiles and fills its caches on the first requests.
    await measureOnce(state, target.db, target.asset);
    log("warm-up run done");
    const since = Date.now();
    const all: OneRun[] = [];
    for (let i = 1; i <= runs; i += 1) {
      const one = await measureOnce(state, target.db, target.asset);
      all.push(one);
      log(`run ${i}/${runs}: login ${Math.round(one.values["login.usable_ms"] ?? Number.NaN)} ms, home ${Math.round(one.values["/.ready_ms"] ?? Number.NaN)} ms`);
    }
    return summarise(target, all, runs, since);
  } finally {
    await target.db.end();
  }
}

/**
 * Before and after on two built slots, runs alternating, so whatever else the
 * machine is doing lands on both alike. The fair way to show a change's effect
 * on a busy machine, where absolute numbers drift by hundreds of milliseconds.
 */
export async function compare(before: SlotState, after: SlotState, runs: number, log: (line: string) => void): Promise<{ before: Run; after: Run }> {
  const a = await open(before);
  const b = await open(after);
  try {
    await measureOnce(before, a.db, a.asset);
    await measureOnce(after, b.db, b.asset);
    log("warm-up runs done");
    const since = Date.now();
    const runsA: OneRun[] = [];
    const runsB: OneRun[] = [];
    for (let i = 1; i <= runs; i += 1) {
      const order = i % 2 === 1 ? ([a, runsA, b, runsB] as const) : ([b, runsB, a, runsA] as const);
      order[1].push(await measureOnce(order[0].state, order[0].db, order[0].asset));
      order[3].push(await measureOnce(order[2].state, order[2].db, order[2].asset));
      log(`pair ${i}/${runs}: login ${Math.round(runsA.at(-1)?.values["login.usable_ms"] ?? Number.NaN)} → ${Math.round(runsB.at(-1)?.values["login.usable_ms"] ?? Number.NaN)} ms`);
    }
    return { before: summarise(a, runsA, runs, since), after: summarise(b, runsB, runs, since) };
  } finally {
    await a.db.end();
    await b.db.end();
  }
}
