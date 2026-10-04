import { existsSync, renameSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { DEMO_WORKSPACE, resolveAccount, type DemoAccount } from "./accounts.js";
import type { DriveOptions, Lang } from "./args.js";
import { REPO_ROOT } from "./slot.js";
import { newRunDir, requireState, type SlotState } from "./stack.js";

/** What a drive script receives. Scripts live in tools/verify/flows/ or anywhere else. */
export interface DriveContext {
  page: Page;
  account: DemoAccount;
  lang: Lang;
  state: SlotState;
  evidenceDir: string;
  /** In-app navigation that keeps the in-memory language (#127): pushState + popstate, never page.goto. */
  nav: (route: string) => Promise<void>;
  /** Full-page screenshot named NN-<label>.png; returns its path. */
  shot: (label: string) => Promise<string>;
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
  consoleErrors: string[];
  failedRequests: string[];
  /** Requests the app cancelled itself (route change, query abort); counted, not reported as failures. */
  aborted: number;
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
  const rec: Recorder = { consoleErrors: [], failedRequests: [], aborted: 0, inflight: 0, lastActivity: Date.now() };
  const isApi = (url: string) => new URL(url).pathname.startsWith("/v1/");
  page.on("console", (msg) => {
    if (msg.type() === "error") rec.consoleErrors.push(`[console.error] ${firstLines(msg.text())} (${page.url()})`);
  });
  page.on("pageerror", (error) => rec.consoleErrors.push(`[pageerror] ${firstLines(error.stack ?? error.message)} (${page.url()})`));
  page.on("request", (req) => {
    if (isApi(req.url())) {
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
    if (res.status() >= 400) rec.failedRequests.push(`${res.status()} ${res.request().method()} ${res.url()}`);
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

async function loginThroughUi(page: Page, state: SlotState, account: DemoAccount, rec: Recorder): Promise<void> {
  await page.goto(`${state.urls.web}/login`);
  await page.getByLabel(/^(Espace de travail|Workspace)$/).fill(DEMO_WORKSPACE);
  await page.getByLabel(/^(Nom d'utilisateur|Username)$/).fill(account.username);
  await page.getByLabel(/^(Code PIN|PIN code)$/).fill(account.pin);
  await page.getByRole("button", { name: /^(Se connecter|Sign in)$/ }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
  await waitQuiet(page, rec);
}

async function openSidebarIfCollapsed(page: Page): Promise<void> {
  const nav = page.getByRole("navigation", { name: "Navigation" });
  if (await nav.isVisible().catch(() => false)) return;
  await page.getByRole("button", { name: /Afficher ou masquer le menu|Show or hide the menu/ }).first().click();
}

/** Language is held in memory only (#127): switch through More, then never reload. */
async function switchToEnglish(page: Page, rec: Recorder): Promise<void> {
  await openSidebarIfCollapsed(page);
  await page.getByRole("navigation", { name: "Navigation" }).getByRole("link", { name: /^Plus$/ }).click();
  await waitQuiet(page, rec);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("heading", { name: "Language" }).waitFor({ timeout: 10_000 });
}

export async function drive(slot: number, targets: readonly string[], options: DriveOptions, command: "drive" | "login"): Promise<boolean> {
  const state = requireState(slot);
  const account = resolveAccount(options.role);
  const evidenceDir = newRunDir(command, slot);
  const initCwd = process.env["INIT_CWD"] ?? process.cwd();
  const plan = targets.map((target) => classifyTarget(target, initCwd));
  for (const item of plan) {
    if (item.kind === "script" && !existsSync(item.file)) throw new Error(`script not found: ${item.file}`);
  }

  const say = (line: string) => process.stdout.write(`${line}\n`);
  const steps: Array<{ step: string; ok: boolean; detail: string }> = [];
  let shotIndex = 0;
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let ok = true;
  say(`driving slot ${slot} (${state.urls.web}) as ${account.username} (${account.role}), lang ${options.lang}`);
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
    const page = await context.newPage();
    const rec = record(page);
    const shot = async (label: string) => {
      shotIndex += 1;
      const file = path.join(evidenceDir, `${String(shotIndex).padStart(2, "0")}-${label.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "shot"}.png`);
      await page.screenshot({ path: file, fullPage: true });
      say(`  screenshot ${file}`);
      return file;
    };
    const nav = async (route: string) => {
      await page.evaluate((to) => {
        window.history.pushState({}, "", to);
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
        await shot(`failed-${label}`).catch(() => undefined);
        throw error;
      }
    };

    try {
      await runStep(`log in as ${account.username}`, () => loginThroughUi(page, state, account, rec));
      if (options.lang === "en") await runStep("switch language to English (More → English)", () => switchToEnglish(page, rec));
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
          const mod = (await import(pathToFileURL(item.file).href)) as { default?: DriveScript };
          const script = mod.default;
          if (typeof script !== "function") throw new Error(`${item.file} has no default export function`);
          await runStep(`script ${path.relative(REPO_ROOT, item.file)}`, () =>
            script({
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
            }),
          );
        }
      }
    } catch {
      // the failing step is already recorded
    }

    const consoleFile = path.join(evidenceDir, "console-errors.txt");
    const requestsFile = path.join(evidenceDir, "failed-requests.txt");
    writeFileSync(consoleFile, rec.consoleErrors.join("\n") + (rec.consoleErrors.length ? "\n" : ""));
    writeFileSync(requestsFile, rec.failedRequests.join("\n") + (rec.failedRequests.length ? "\n" : ""));
    writeFileSync(
      path.join(evidenceDir, "summary.json"),
      `${JSON.stringify({ slot, commit: state.commit, account: account.username, role: account.role, lang: options.lang, targets, ok, steps, finalUrl: page.url(), consoleErrors: rec.consoleErrors.length, failedRequests: rec.failedRequests.length, abortedRequests: rec.aborted }, null, 2)}\n`,
    );
    say(`console errors: ${rec.consoleErrors.length} → ${consoleFile}`);
    say(`failed requests (status >= 400 or network): ${rec.failedRequests.length} → ${requestsFile}`);
    if (rec.aborted > 0) say(`requests the app cancelled itself (ERR_ABORTED, not failures): ${rec.aborted}`);
    if (options.strict && rec.consoleErrors.length > 0) {
      ok = false;
      say("FAIL  --strict: console errors present");
    }
  } finally {
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
  say(ok ? `drive: ok. Evidence: ${evidenceDir}` : `drive: FAILED. Evidence: ${evidenceDir}`);
  return ok;
}
