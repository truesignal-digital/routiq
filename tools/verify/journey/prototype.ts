import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import type { Viewport } from "../args.js";
import { REPO_ROOT } from "../slot.js";
import { writeJourneyEvidence, type Check, type Journey, type JourneyRun } from "./journey.js";
import { measureScreen, type ScreenMetrics } from "./measure.js";

/**
 * Measures throwaway prototypes with the same code as the app. A prototype
 * marks its journey path: the element to tap next carries data-step="1",
 * "2", …; the shown view names itself with data-screen. No slot, no login.
 */
export async function measurePrototypes(targets: readonly string[], options: { journey: string | undefined; viewport: Viewport | undefined }): Promise<boolean> {
  const journey = options.journey === undefined ? undefined : await loadJourney(options.journey);
  const viewport = options.viewport ?? journey?.device.viewport ?? { width: 390, height: 844 };
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, "Z").replaceAll(":", "-");
  const outDir = path.join(REPO_ROOT, ".verify", `${stamp}-measure`);
  mkdirSync(outDir, { recursive: true });
  process.stdout.write(`evidence: ${outDir}\n`);

  const browser = await chromium.launch();
  const rows: { target: string; run: JourneyRun; checks: Check[] | undefined }[] = [];
  try {
    for (const target of targets) {
      const url = toUrl(target);
      const dir = path.join(outDir, slug(target));
      mkdirSync(dir, { recursive: true });
      const context = await browser.newContext({ viewport, colorScheme: "light", locale: "fr-FR", timezoneId: "Africa/Douala" });
      const page = await context.newPage();
      await page.goto(url);
      await page.waitForLoadState("networkidle");
      const screens: ScreenMetrics[] = [];
      let taps = 0;
      const capture = async () => {
        await page.waitForTimeout(250);
        const label = (await page.locator("[data-screen]:visible").last().getAttribute("data-screen").catch(() => null)) ?? `screen-${screens.length + 1}`;
        screens.push(await measureScreen(page, label, { surface: "prototype" }));
        await page.screenshot({ path: path.join(dir, `${String(screens.length).padStart(2, "0")}-${label}.png`), fullPage: true });
      };
      await capture();
      for (let step = 1; step < 20; step += 1) {
        const next = page.locator(`[data-step="${step}"]:visible`).first();
        if ((await next.count()) === 0) break;
        await next.click();
        taps += 1;
        await capture();
      }
      const lang = new URL(url).searchParams.get("lang") ?? (await page.evaluate(() => document.documentElement.lang));
      const run: JourneyRun = { journey: journey?.id ?? "none", surface: target, conditions: { viewport, throttle: "none", lang }, screens, taps, seconds: null };
      const checks = journey ? writeJourneyEvidence(dir, journey, run) : undefined;
      rows.push({ target, run, checks });
      await context.close();
    }
  } finally {
    await browser.close();
  }

  const lines = [
    "| Target | Taps | Max words | Max above fold | Max prose | Longest block | Max primary | Small targets | axe | Verdict |",
    "|---|---|---|---|---|---|---|---|---|---|",
    ...rows.map(({ target, run, checks }) => {
      const max = (read: (s: ScreenMetrics) => number) => Math.max(0, ...run.screens.map(read));
      const over = checks?.filter((c) => !c.pass).map((c) => c.budget) ?? [];
      const verdict = checks === undefined ? "" : over.length === 0 ? "PASS" : `over: ${over.join(", ")}`;
      return `| ${target} | ${run.taps} | ${max((s) => s.words)} | ${max((s) => s.foldWords)} | ${max((s) => s.proseWords)} | ${max((s) => s.longestBlock)} | ${max((s) => s.primaryActions)} | ${max((s) => s.smallTargets)} | ${max((s) => s.axe.serious + s.axe.critical)} | ${verdict} |`;
    }),
  ];
  const table = `${lines.join("\n")}\n`;
  writeFileSync(path.join(outDir, "compare.md"), `# Prototype measure${journey ? ` against ${journey.id}` : ""}\n\nSeconds are not measured on prototypes.\n\n${table}`);
  process.stdout.write(table);
  return rows.every(({ checks }) => checks === undefined || checks.every((c) => c.pass));
}

export async function loadJourney(id: string): Promise<Journey> {
  const file = path.join(REPO_ROOT, "tools/verify/journeys", `${id}.ts`);
  if (!existsSync(file)) throw new Error(`no journey ${id} (looked for ${file})`);
  const mod = (await import(pathToFileURL(file).href)) as { journey?: Journey };
  if (mod.journey === undefined) throw new Error(`${file} exports no journey`);
  return mod.journey;
}

function toUrl(target: string): string {
  if (/^https?:\/\//.test(target)) return target;
  const [file = "", query] = target.split("?");
  const initCwd = process.env["INIT_CWD"] ?? process.cwd();
  const resolved = existsSync(path.resolve(initCwd, file)) ? path.resolve(initCwd, file) : path.resolve(REPO_ROOT, file);
  if (!existsSync(resolved)) throw new Error(`no such file: ${file}`);
  return `${pathToFileURL(resolved).href}${query === undefined ? "" : `?${query}`}`;
}

function slug(target: string): string {
  return target.replace(/^.*\//, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "target";
}
