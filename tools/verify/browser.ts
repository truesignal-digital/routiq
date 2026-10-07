import { existsSync, mkdirSync, renameSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type BrowserContext, type Locator, type Page } from "playwright-core";
import { resolveAccount, type DemoAccount } from "./accounts.js";
import { startCast, type Cast } from "./cast.js";
import type { DriveOptions, Lang } from "./args.js";
import { run } from "./proc.js";
import { SHIFT_PROBE } from "./shifts.js";
import { REPO_ROOT } from "./slot.js";
import { newRunDir, requireState, type SlotState } from "./stack.js";

export interface ShotOptions {
  /** One English sentence for the reel: what this frame proves. Defaults to the label. */
  caption?: string;
  /** Outlines this element and dims the rest, so a reviewer sees what changed. */
  highlight?: Locator;
}

/** One `shot()`: the full-page evidence file plus a viewport-sized frame for the contact sheet. */
export interface Frame {
  label: string;
  caption: string;
  /** Paths relative to the run directory. */
  file: string;
  frame: string;
  url: string;
  /** Seconds into the cast when the shot was taken; only with --reel. The reel's beats. */
  t?: number;
  /** The highlighted element in viewport pixels; the reel's camera eases into it. */
  box?: Box;
}

/** Counts a reel or a before/after comparison can put side by side. */
export interface RunMetrics {
  apiRequests: number;
  consoleErrors: number;
  failedRequests: number;
  /** Declared HTTP refusals, excluded from error metrics; absent in older runs. */
  expectedRefusals?: number;
  /** Layout shifts without recent input since the last full page load. */
  layoutShifts: number;
  cumulativeLayoutShift: number;
  domNodes: number;
}

export interface ExpectedRefusal {
  /** Integer HTTP status in the 400–499 range. */
  status: number;
  /** Pattern matched against the full response URL. */
  url: RegExp;
}

/** What a drive script receives. Scripts live in tools/verify/flows/ or anywhere else. */
export interface DriveContext {
  /** Declare before the action: expectRefusal({ status: 409, url: /\/v1\/commands\/register-asset$/ }).
   * Applies to subsequent responses in this drive. Counts refusals separately in the reel;
   * only matching browser resource console errors are excluded. Raw evidence stays intact.
   */
  expectRefusal: (refusal: ExpectedRefusal) => void;
  page: Page;
  account: DemoAccount;
  lang: Lang;
  state: SlotState;
  evidenceDir: string;
  /** In-app navigation without a full load: pushState + popstate. */
  nav: (route: string) => Promise<void>;
  /** Full-page screenshot named NN-<label>.png plus a reel frame; returns the full-page path. */
  shot: (label: string, options?: ShotOptions) => Promise<string>;
  /** Waits until no /v1 request has been in flight for 400 ms. */
  quiet: () => Promise<void>;
  /** Picks the French or English string for the current language. */
  t: (fr: string, en: string) => string;
  log: (line: string) => void;
  /** Read-only API call as the same account; returns status and parsed JSON. */
  apiGet: (route: string) => Promise<{ status: number; body: unknown }>;
}

export type DriveScript = (ctx: DriveContext) => Promise<void>;

const FLOW_DIR = path.join(REPO_ROOT, "tools/verify/flows");

/** `flow:<name>` → tools/verify/flows/<name>.ts; a path → that file (relative to where pnpm was run); otherwise a route. */
export function classifyTarget(target: string, initCwd: string): { kind: "route"; route: string } | { kind: "script"; file: string } {
  if (target.startsWith("flow:")) return { kind: "script", file: path.join(FLOW_DIR, `${target.slice(5)}.ts`) };
  if (/\.(ts|mts|js|mjs)$/.test(target)) {
    const fromCwd = path.resolve(initCwd, target);
    return { kind: "script", file: existsSync(fromCwd) ? fromCwd : path.resolve(REPO_ROOT, target) };
  }
  if (!target.startsWith("/")) throw new Error(`"${target}" is neither a route (/...), a flow (flow:<name>) nor a script file`);
  return { kind: "route", route: target };
}

interface Recorder {
  expectedRefusals: number;
  expectedConsoleErrors: number;
  expectRefusal: DriveContext["expectRefusal"];
  consoleErrors: string[];
  failedRequests: string[];
  /** Requests the app cancelled itself (route change, query abort); counted, not reported as failures. */
  aborted: number;
  apiRequests: number;
  inflight: number;
  lastActivity: number;
}

/** The message and the first app frame; React component stacks run to dozens of lines. */
function firstLines(text: string): string {
  const lines = text.split("\n");
  const frame = lines.slice(1).find((line) => line.includes("/src/"));
  return [lines[0], frame?.trim()].filter(Boolean).join("\n    ");
}

function record(page: Page): Recorder {
  const expected: ExpectedRefusal[] = [];
  const matches = (status: number, url: string) => expected.some((refusal) => {
    refusal.url.lastIndex = 0;
    return refusal.status === status && refusal.url.test(url);
  });
  const expectRefusal: DriveContext["expectRefusal"] = ({ status, url }) => {
    if (!Number.isInteger(status) || status < 400 || status >= 500) throw new Error("expected refusal status must be an integer from 400 to 499");
    expected.push({ status, url: new RegExp(url.source, url.flags) });
  };
  const rec: Recorder = { expectedRefusals: 0, expectedConsoleErrors: 0, expectRefusal, consoleErrors: [], failedRequests: [], aborted: 0, apiRequests: 0, inflight: 0, lastActivity: Date.now() };
  const isApi = (url: string) => new URL(url).pathname.startsWith("/v1/");
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    rec.consoleErrors.push(`[console.error] ${firstLines(msg.text())} (${page.url()})`);
    const resourceStatus = /^Failed to load resource: the server responded with a status of (\d{3})\b/.exec(msg.text());
    if (resourceStatus !== null && matches(Number(resourceStatus[1]), msg.location().url)) rec.expectedConsoleErrors += 1;
  });
  page.on("pageerror", (error) => rec.consoleErrors.push(`[pageerror] ${firstLines(error.stack ?? error.message)} (${page.url()})`));
  page.on("request", (req) => {
    if (isApi(req.url())) {
      rec.apiRequests += 1;
      rec.inflight += 1;
      rec.lastActivity = Date.now();
    }
  });
  const settle = (url: string) => {
    if (isApi(url)) {
      rec.inflight = Math.max(0, rec.inflight - 1);
      rec.lastActivity = Date.now();
    }
  };
  page.on("requestfinished", (req) => settle(req.url()));
  page.on("requestfailed", (req) => {
    settle(req.url());
    const reason = req.failure()?.errorText ?? "";
    if (reason === "net::ERR_ABORTED") rec.aborted += 1;
    else rec.failedRequests.push(`FAILED ${req.method()} ${req.url()} ${reason}`);
  });
  page.on("response", (res) => {
    if (res.status() >= 400) {
      rec.failedRequests.push(`${res.status()} ${res.request().method()} ${res.url()}`);
      if (matches(res.status(), res.url())) rec.expectedRefusals += 1;
    }
  });
  return rec;
}

async function waitQuiet(page: Page, rec: Recorder): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (rec.inflight === 0 && Date.now() - rec.lastActivity > 400) break;
    await page.waitForTimeout(100);
  }
  await page.waitForTimeout(150);
}

async function readPageMetrics(page: Page): Promise<{ layoutShifts: number; cumulativeLayoutShift: number; domNodes: number }> {
  return page.evaluate(() => {
    const shifts = ((window as unknown as { __routiqShifts?: Array<{ value: number }> }).__routiqShifts ?? []).map((shift) => shift.value);
    const cls = shifts.reduce((sum, value) => sum + value, 0);
    return { layoutShifts: shifts.length, cumulativeLayoutShift: Math.round(cls * 10_000) / 10_000, domNodes: document.getElementsByTagName("*").length };
  });
}

/**
 * What the pilot users run on: a low-end Android phone over slow 4G. The same
 * profile Lighthouse uses for mobile, so lab numbers are comparable with it.
 */
export const PHONE_PROFILE = { cpuSlowdown: 4, latencyMs: 150, downloadKbps: 1600, uploadKbps: 750 } as const;

async function throttleLikeAPhone(page: Page): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: PHONE_PROFILE.cpuSlowdown });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: PHONE_PROFILE.latencyMs,
    downloadThroughput: (PHONE_PROFILE.downloadKbps * 1000) / 8,
    uploadThroughput: (PHONE_PROFILE.uploadKbps * 1000) / 8,
  });
}

const HIGHLIGHT_ID = "routiq-verify-highlight";

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The viewport region a reel zooms into: the element plus a margin, at least
 * 640 px wide and no flatter than 16:10, so a row or a button keeps the context
 * around it. Clamped to the viewport.
 */
export function focusClip(box: Box, viewport: { width: number; height: number }): Box {
  const margin = 40;
  const width = Math.min(viewport.width, Math.max(box.width + margin * 2, 640));
  const height = Math.min(viewport.height, Math.max(box.height + margin * 2, width * 0.625));
  const centre = (start: number, size: number, span: number, limit: number) => Math.round(Math.min(Math.max(start + size / 2 - span / 2, 0), limit - span));
  return {
    x: centre(box.x, box.width, width, viewport.width),
    y: centre(box.y, box.height, height, viewport.height),
    width: Math.round(width),
    height: Math.round(height),
  };
}

/** Draws an outline over the element (page coordinates, so full-page shots line up) and dims the rest. Returns its viewport box. */
async function showHighlight(page: Page, target: Locator): Promise<Box> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (box === null) throw new Error("highlight target is not visible");
  await page.evaluate(
    ({ id, x, y, width, height }) => {
      const pad = 6;
      const el = document.createElement("div");
      el.id = id;
      Object.assign(el.style, {
        position: "absolute",
        left: `${x + window.scrollX - pad}px`,
        top: `${y + window.scrollY - pad}px`,
        width: `${width + pad * 2}px`,
        height: `${height + pad * 2}px`,
        border: "3px solid #2563eb",
        borderRadius: "8px",
        pointerEvents: "none",
        zIndex: "2147483647",
      });
      document.documentElement.appendChild(el);
    },
    { id: HIGHLIGHT_ID, ...box },
  );
  return box;
}

async function clearHighlight(page: Page): Promise<void> {
  await page.evaluate((id) => document.getElementById(id)?.remove(), HIGHLIGHT_ID);
}

/** "approvals-queue" → "Approvals queue". */
export function captionFromLabel(label: string): string {
  const words = label.replace(/^\//, "").replace(/[-_/]+/g, " ").trim();
  return words === "" ? "Home" : words.charAt(0).toUpperCase() + words.slice(1);
}

async function loginThroughUi(page: Page, state: SlotState, account: DemoAccount, rec: Recorder): Promise<void> {
  await page.goto(`${state.urls.web}/login`);
  await page.getByLabel(/^(Espace de travail|Workspace)$/).fill(account.workspace);
  await page.getByLabel(/^(Nom d'utilisateur|Username)$/).fill(account.username);
  await page.getByLabel(/^(Code PIN|PIN code)$/).fill(account.pin);
  await page.getByRole("button", { name: /^(Se connecter|Sign in)$/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
  await waitQuiet(page, rec);
}

/**
 * The app's sidebar navigation, opened first when it is collapsed (phone widths
 * hide it behind the menu button). Flows reach sidebar links through this so
 * they pass at every viewport.
 */
export async function openSidebar(page: Page): Promise<Locator> {
  // While the member loads, the shell is a placeholder frame (#495) whose menu
  // is replaced, open or not, when the real shell draws.
  await page.locator("[data-slot='sidebar-inset'][aria-busy='true']").waitFor({ state: "detached", timeout: 30_000 });
  const nav = page.getByRole("navigation", { name: "Navigation" });
  if (await nav.isVisible().catch(() => false)) return nav;
  await page.getByRole("button", { name: /Afficher ou masquer le menu|Show or hide the menu/ }).first().click();
  await nav.waitFor({ state: "visible", timeout: 10_000 });
  return nav;
}

/** Opens the name menu at the foot of the sidebar (#316): My settings, Sign out. */
export async function openNameMenu(page: Page): Promise<Locator> {
  await openSidebar(page);
  await page.locator('[data-sidebar="footer"] [data-sidebar="menu-button"]').first().click();
  const menu = page.getByRole("menu");
  await menu.waitFor({ state: "visible", timeout: 10_000 });
  return menu;
}

/** Signs out through the name menu, the one place the app offers it. */
export async function signOutThroughNameMenu(page: Page): Promise<void> {
  await (await openNameMenu(page)).getByRole("menuitem", { name: /^(Se déconnecter|Sign out)$/ }).click();
  await page.waitForURL((url) => url.pathname === "/login");
}

/** Switches to English through name menu → My settings, the way a user does; the choice then persists per device (#127). */
async function switchToEnglish(page: Page, rec: Recorder): Promise<void> {
  await (await openNameMenu(page)).getByRole("menuitem", { name: /^(Mes réglages|My settings)$/ }).click();
  await waitQuiet(page, rec);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("heading", { name: "Language" }).waitFor({ timeout: 10_000 });
}

export async function drive(slot: number, targets: readonly string[], options: DriveOptions, command: "drive" | "login"): Promise<boolean> {
  const state = requireState(slot);
  const head = run("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT }).stdout.trim();
  const dirty = run("git", ["status", "--porcelain"], { cwd: REPO_ROOT }).stdout.trim() !== "";
  const commit = `${head}${dirty ? "-dirty" : ""}`;
  const account = resolveAccount(options.role);
  const evidenceDir = newRunDir(command, slot);
  const initCwd = process.env["INIT_CWD"] ?? process.cwd();
  const plan = targets.map((target) => classifyTarget(target, initCwd));
  for (const item of plan) {
    if (item.kind === "script" && !existsSync(item.file)) throw new Error(`script not found: ${item.file}`);
  }

  const say = (line: string) => process.stdout.write(`${line}\n`);
  const steps: Array<{ step: string; ok: boolean; detail: string }> = [];
  const frames: Frame[] = [];
  let shotIndex = 0;
  let cast: Cast | undefined;
  let openPage: Page | undefined;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let ok = true;
  say(`driving slot ${slot} (${state.urls.web}) as ${account.username} (${account.role}), lang ${options.lang}${options.throttle === "phone" ? ", throttled like a phone" : ""}`);
  say(`evidence: ${evidenceDir}`);

  try {
    browser = await chromium.launch({ headless: !options.headed });
    context = await browser.newContext({
      viewport: options.viewport,
      locale: options.lang === "en" ? "en-US" : "fr-FR",
      timezoneId: "Africa/Douala",
      colorScheme: "light",
      ...(options.video ? { recordVideo: { dir: evidenceDir, size: options.viewport } } : {}),
    });
    await context.addInitScript(SHIFT_PROBE);
    const page = await context.newPage();
    openPage = page;
    const rec = record(page);
    const shot = async (label: string, shotOptions: ShotOptions = {}) => {
      shotIndex += 1;
      const name = `${String(shotIndex).padStart(2, "0")}-${label.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "shot"}.png`;
      const file = path.join(evidenceDir, name);
      const frame = path.join(evidenceDir, "frames", name);
      mkdirSync(path.dirname(frame), { recursive: true });
      if (shotOptions.highlight !== undefined) await shotOptions.highlight.scrollIntoViewIfNeeded();
      const t = cast?.now();
      const resume = cast?.pause();
      let box: Box | undefined;
      try {
        if (shotOptions.highlight !== undefined) box = await showHighlight(page, shotOptions.highlight);
        await page.screenshot({ path: file, fullPage: true });
        if (box !== undefined) await clearHighlight(page);
        await page.screenshot({ path: frame });
      } finally {
        if (shotOptions.highlight !== undefined) await clearHighlight(page);
        resume?.();
      }
      frames.push({
        label,
        caption: shotOptions.caption ?? captionFromLabel(label),
        file: name,
        frame: path.join("frames", name),
        url: page.url(),
        ...(t === undefined ? {} : { t }),
        ...(box === undefined ? {} : { box }),
      });
      say(`  screenshot ${file}`);
      return file;
    };
    const nav = async (route: string) => {
      // A fresh router key, as a link click gives: TanStack Router reports a render
      // (and the app times a route:<template> journey) only when the key changes.
      await page.evaluate((to) => {
        const previous = (window.history.state ?? {}) as { __TSR_index?: number };
        const key = Math.random().toString(36).slice(2, 10);
        window.history.pushState({ key, __TSR_key: key, __TSR_index: (previous.__TSR_index ?? 0) + 1 }, "", to);
        window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
      }, route);
      await page.waitForURL((url) => `${url.pathname}${url.search}`.startsWith(route.split("#")[0] ?? route), { timeout: 10_000 });
      await waitQuiet(page, rec);
    };
    const apiGet = async (route: string) => {
      const token = await page.evaluate(() => {
        const raw = window.localStorage.getItem("routiq.sessions.v1");
        if (raw === null) return null;
        const parsed = JSON.parse(raw) as { activeKey?: string; sessions?: Record<string, { token?: string }> };
        return parsed.activeKey === undefined ? null : (parsed.sessions?.[parsed.activeKey]?.token ?? null);
      });
      const res = await fetch(`${state.urls.api}${route}`, { headers: token === null ? {} : { authorization: `Bearer ${token}` } });
      const text = await res.text();
      let body: unknown = text;
      try {
        body = JSON.parse(text);
      } catch {
        // keep text
      }
      return { status: res.status, body };
    };

    const runStep = async (label: string, fn: () => Promise<void>) => {
      try {
        await fn();
        steps.push({ step: label, ok: true, detail: page.url() });
        say(`PASS  ${label} → ${page.url()}`);
      } catch (error) {
        ok = false;
        const detail = error instanceof Error ? error.message.split("\n")[0] ?? error.message : String(error);
        steps.push({ step: label, ok: false, detail });
        say(`FAIL  ${label}: ${detail}`);
        await shot(`failed-${label}`, { caption: `Failed here: ${detail}` }).catch(() => undefined);
        throw error;
      }
    };

    try {
      await runStep(`log in as ${account.username}`, () => loginThroughUi(page, state, account, rec));
      if (options.lang === "en") await runStep("switch language to English (My settings → English)", () => switchToEnglish(page, rec));
      // After sign-in: on the Vite dev server a cold load is hundreds of unbundled
      // modules, which slow 4G turns into minutes that a built app never pays.
      if (options.throttle === "phone") await runStep("throttle like a phone (CPU 4x, slow 4G)", () => throttleLikeAPhone(page));
      if (options.reel) cast = await startCast(page, path.join(evidenceDir, "cast"), options.viewport);
      if (command === "login") {
        await runStep("open home", () => nav("/"));
        await shot(`home-${account.username}-${options.lang}`);
      }
      for (const item of plan) {
        if (item.kind === "route") {
          await runStep(`open ${item.route}`, async () => {
            await nav(item.route);
            await shot(item.route === "/" ? "home" : item.route);
          });
        } else {
          await runStep(`script ${path.relative(REPO_ROOT, item.file)}`, async () => {
            const mod = (await import(pathToFileURL(item.file).href)) as { default?: DriveScript };
            const script = mod.default;
            if (typeof script !== "function") throw new Error(`${item.file} has no default export function`);
            await script({
              page,
              account,
              lang: options.lang,
              state,
              evidenceDir,
              nav,
              shot,
              quiet: () => waitQuiet(page, rec),
              t: (fr, en) => (options.lang === "en" ? en : fr),
              log: (line) => {
                steps.push({ step: line, ok: true, detail: page.url() });
                say(`  ${line}`);
              },
              apiGet,
              expectRefusal: rec.expectRefusal,
            });
          });
        }
      }
    } catch {
      // the failing step is already recorded
    }

    if (cast !== undefined) {
      writeFileSync(path.join(evidenceDir, "cast", "index.json"), `${JSON.stringify(await cast.stop())}\n`);
      cast = undefined;
    }
    const pageMetrics = await readPageMetrics(page).catch(() => ({ layoutShifts: 0, cumulativeLayoutShift: 0, domNodes: 0 }));
    const metrics: RunMetrics = {
      apiRequests: rec.apiRequests,
      consoleErrors: rec.consoleErrors.length - rec.expectedConsoleErrors,
      failedRequests: rec.failedRequests.length - rec.expectedRefusals,
      expectedRefusals: rec.expectedRefusals,
      ...pageMetrics,
    };

    const consoleFile = path.join(evidenceDir, "console-errors.txt");
    const requestsFile = path.join(evidenceDir, "failed-requests.txt");
    writeFileSync(consoleFile, rec.consoleErrors.join("\n") + (rec.consoleErrors.length ? "\n" : ""));
    writeFileSync(requestsFile, rec.failedRequests.join("\n") + (rec.failedRequests.length ? "\n" : ""));
    writeFileSync(
      path.join(evidenceDir, "summary.json"),
      `${JSON.stringify({ slot, commit, account: account.username, role: account.role, lang: options.lang, viewport: options.viewport, targets, ok, steps, frames, metrics, finalUrl: page.url(), consoleErrors: rec.consoleErrors.length, failedRequests: rec.failedRequests.length, abortedRequests: rec.aborted }, null, 2)}\n`,
    );
    say(`console errors: ${rec.consoleErrors.length} → ${consoleFile}`);
    say(`failed requests (status >= 400 or network): ${rec.failedRequests.length} → ${requestsFile}`);
    if (rec.aborted > 0) say(`requests the app cancelled itself (ERR_ABORTED, not failures): ${rec.aborted}`);
    say(`api requests: ${metrics.apiRequests}, layout shifts: ${metrics.layoutShifts} (CLS ${metrics.cumulativeLayoutShift}), DOM nodes: ${metrics.domNodes}`);
    if (options.strict && rec.consoleErrors.length > 0) {
      ok = false;
      say("FAIL  --strict: console errors present");
    }
  } finally {
    // Close the tab the way a user does, so the app's pagehide handler sends
    // its last telemetry batch, and give that keepalive request time to land.
    await openPage?.close({ runBeforeUnload: true }).catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 600));
    await context?.close();
    await browser?.close();
  }

  if (options.video) {
    const webm = readdirSync(evidenceDir).find((file) => file.endsWith(".webm") && file !== "drive.webm");
    if (webm !== undefined) {
      renameSync(path.join(evidenceDir, webm), path.join(evidenceDir, "drive.webm"));
      say(`video: ${path.join(evidenceDir, "drive.webm")}`);
    }
  }
  if (options.reel && frames.length > 0) {
    const { buildReel } = await import("./reel.js");
    const reel = await buildReel(evidenceDir, undefined, { title: undefined });
    say(`reel: ${reel.mp4} (${reel.seconds} s)`);
  }
  say(ok ? `drive: ok. Evidence: ${evidenceDir}` : `drive: FAILED. Evidence: ${evidenceDir}`);
  return ok;
}
