import { writeFileSync } from "node:fs";
import path from "node:path";
import type { Locator } from "playwright-core";
import type { Viewport } from "../args.js";
import type { DriveContext } from "../browser.js";
import { resolveAccount } from "../accounts.js";
import { measureScreen, type ScreenMetrics } from "./measure.js";

/**
 * One user, one goal, one device. The spec is the intent the screens are
 * built from and the bar they are measured against.
 */
export interface Journey {
  id: string;
  /** `role` is a verify account (see accounts.ts); `person` says who that is in the company. */
  actor: { role: string; person: string };
  /**
   * The account the drive starts as (`--role`), to arrange preconditions
   * before the actor signs in. Often not the actor: the maker may not be the checker.
   */
  arrangeAs: string;
  goal: string;
  trigger: string;
  frequency: string;
  device: { viewport: Viewport; throttle: "phone" | "none" };
  /** The observable end state, including the read that proves it. */
  doneWhen: string;
  /** What a stranger should say after one look at the first screen. The first-glance judge checks these. */
  firstGlance: { purpose: string; state: string; nextAction: string };
  budgets: Budgets;
}

/** Ceilings. Per-screen budgets hold on every measured screen. */
export interface Budgets {
  taps: number;
  /** Seconds from the first measured screen to done, on the journey's device. */
  seconds: number;
  wordsPerScreen: number;
  /** Words above the fold on each screen. */
  foldWordsPerScreen: number;
  proseWordsPerScreen: number;
  longestBlock: number;
  primaryActionsPerScreen: number;
  smallTargetsPerScreen: number;
  /** axe-core serious + critical violations per screen. */
  axePerScreen: number;
}

export interface JourneyRun {
  journey: string;
  surface: string;
  /** What the numbers were taken on; a report without them can't be compared. */
  conditions: { viewport: Viewport; throttle: "phone" | "none"; lang: string };
  screens: ScreenMetrics[];
  taps: number;
  /** null where time means nothing (throwaway prototypes). */
  seconds: number | null;
}

export interface Check {
  budget: keyof Budgets;
  limit: number;
  actual: number;
  /** The screen that set `actual`, for per-screen budgets. */
  screen?: string;
  pass: boolean;
}

const PER_SCREEN: { budget: keyof Budgets; read: (s: ScreenMetrics) => number }[] = [
  { budget: "wordsPerScreen", read: (s) => s.words },
  { budget: "foldWordsPerScreen", read: (s) => s.foldWords },
  { budget: "proseWordsPerScreen", read: (s) => s.proseWords },
  { budget: "longestBlock", read: (s) => s.longestBlock },
  { budget: "primaryActionsPerScreen", read: (s) => s.primaryActions },
  { budget: "smallTargetsPerScreen", read: (s) => s.smallTargets },
  { budget: "axePerScreen", read: (s) => s.axe.serious + s.axe.critical },
];

export function checkBudgets(run: JourneyRun, budgets: Budgets): Check[] {
  const checks: Check[] = [{ budget: "taps", limit: budgets.taps, actual: run.taps, pass: run.taps <= budgets.taps }];
  if (run.seconds !== null) checks.push({ budget: "seconds", limit: budgets.seconds, actual: run.seconds, pass: run.seconds <= budgets.seconds });
  for (const { budget, read } of PER_SCREEN) {
    const worst = run.screens.reduce<ScreenMetrics | undefined>((w, s) => (w === undefined || read(s) > read(w) ? s : w), undefined);
    const actual = worst === undefined ? 0 : read(worst);
    checks.push({ budget, limit: budgets[budget], actual, ...(worst ? { screen: worst.label } : {}), pass: actual <= budgets[budget] });
  }
  return checks;
}

export function renderReport(journey: Journey, run: JourneyRun, checks: Check[]): string {
  const verdict = checks.every((c) => c.pass) ? "PASS" : "FAIL";
  const lines = [
    `# Journey ${journey.id}: ${verdict}`,
    "",
    `${journey.actor.person} (${journey.actor.role}) wants to ${journey.goal}. Surface: ${run.surface}. ` +
      `Measured at ${run.conditions.viewport.width}x${run.conditions.viewport.height}, throttle ${run.conditions.throttle}, ${run.conditions.lang}.`,
    "",
    "| Budget | Limit | Actual | Worst screen | |",
    "|---|---|---|---|---|",
    ...checks.map((c) => `| ${c.budget} | ${c.limit} | ${c.actual} | ${c.screen ?? ""} | ${c.pass ? "pass" : "**over**"} |`),
    "",
    "## Screens",
    "",
    "| Screen | Words | Above the fold | Prose words | Longest block | Primary actions | Small targets | axe serious+critical |",
    "|---|---|---|---|---|---|---|---|",
    ...run.screens.map((s) => `| ${s.label} | ${s.words} | ${s.foldWords} | ${s.proseWords} | ${s.longestBlock} | ${s.primaryActions} | ${s.smallTargets} | ${s.axe.serious + s.axe.critical} |`),
  ];
  const offenders = run.screens.flatMap((s) => s.proseBlocks.map((b) => `- ${s.label} (${b.words} words): ${b.text.slice(0, 200)}`));
  if (offenders.length > 0) lines.push("", "## Prose the user has to read (five longest blocks per screen)", "", ...offenders);
  const extra = run.screens.flatMap((s) => [
    ...(s.primaryActions > 1 ? [`- ${s.label}: ${s.primaryActions} filled buttons: ${s.primaryLabels.join(" · ")}`] : []),
    ...(s.smallTargets > 0 ? [`- ${s.label}: small targets: ${s.smallTargetLabels.join(" · ")}`] : []),
    ...(s.axe.ids.length > 0 ? [`- ${s.label}: axe ${s.axe.ids.join(", ")}`] : []),
  ]);
  if (extra.length > 0) lines.push("", "## Other findings", "", ...extra);
  return `${lines.join("\n")}\n`;
}

export function writeJourneyEvidence(dir: string, journey: Journey, run: JourneyRun): Check[] {
  const checks = checkBudgets(run, journey.budgets);
  writeFileSync(path.join(dir, "journey.json"), `${JSON.stringify({ journey, run, checks }, null, 2)}\n`);
  writeFileSync(path.join(dir, "journey.md"), renderReport(journey, run, checks));
  return checks;
}

/** Call first in a journey's drive: a wrong --role fails here with the command to use, not deep in the arrange step. */
export function assertStartedAs(ctx: DriveContext, journey: Journey): void {
  const expected = resolveAccount(journey.arrangeAs);
  if (ctx.account.username !== expected.username) {
    const { width, height } = journey.device.viewport;
    throw new Error(
      `journey ${journey.id} starts as ${journey.arrangeAs} (${expected.username}), not ${ctx.account.username}: ` +
        `pnpm verify drive journey:${journey.id} --role ${journey.arrangeAs} --viewport ${width}x${height}${journey.device.throttle === "phone" ? " --throttle phone" : ""}`,
    );
  }
}

/**
 * Wraps a drive: `tap` clicks and counts, `screen` settles, measures and
 * shoots, `finish` writes journey.json + journey.md and throws when a budget
 * is over, so the drive exits 1.
 */
export function journeyRunner(ctx: DriveContext, journey: Journey) {
  const screens: ScreenMetrics[] = [];
  let taps = 0;
  let tappedAt: number | undefined;
  let active = 0;
  const size = ctx.page.viewportSize();
  const { viewport, throttle } = journey.device;
  // The gate only means something on the journey's device.
  if (size?.width !== viewport.width || size.height !== viewport.height || ctx.throttle !== throttle) {
    throw new Error(
      `journey ${journey.id} runs on ${viewport.width}x${viewport.height}, throttle ${throttle}; this drive is ${size?.width}x${size?.height}, throttle ${ctx.throttle}. ` +
        `Use --viewport ${viewport.width}x${viewport.height}${throttle === "phone" ? " --throttle phone" : ""}`,
    );
  }
  return {
    async tap(target: Locator) {
      taps += 1;
      tappedAt = Date.now();
      await target.click();
    },
    /** Settles, measures and shoots. Only tap → settled counts toward seconds, not the measuring. */
    async screen(label: string, caption: string) {
      await ctx.quiet();
      if (tappedAt !== undefined) active += Date.now() - tappedAt;
      tappedAt = undefined;
      await ctx.page.waitForTimeout(600);
      screens.push(await measureScreen(ctx.page, label, { surface: "app" }));
      await ctx.shot(label, { caption });
    },
    finish() {
      // A journey that ends on a tap (it opens the next section's page) counts that wait too.
      if (tappedAt !== undefined) active += Date.now() - tappedAt;
      tappedAt = undefined;
      const run: JourneyRun = {
        journey: journey.id,
        surface: "app",
        conditions: { viewport, throttle, lang: ctx.lang },
        screens,
        taps,
        seconds: Math.round((active / 1000) * 10) / 10,
      };
      const checks = writeJourneyEvidence(ctx.evidenceDir, journey, run);
      for (const c of checks) ctx.log(`${c.pass ? "pass" : "OVER"} ${c.budget}: ${c.actual} / ${c.limit}${c.screen ? ` (${c.screen})` : ""}`);
      ctx.log(`journey report: ${path.join(ctx.evidenceDir, "journey.md")}`);
      const over = checks.filter((c) => !c.pass);
      if (over.length > 0) throw new Error(`journey ${journey.id} over budget (the bar, not a crash; see journey.md): ${over.map((c) => c.budget).join(", ")}`);
    },
  };
}
