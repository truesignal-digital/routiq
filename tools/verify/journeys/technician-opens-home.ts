import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "technician-opens-home",
  actor: { role: "technician", person: "The workshop technician" },
  arrangeAs: "technician",
  goal: "see which trucks are in the workshop and what to work on next",
  trigger: "Arriving at the workshop, phone in hand",
  frequency: "Daily",
  device: { viewport: { width: 390, height: 844 }, throttle: "phone" },
  doneWhen: "Home lands on the Maintenance Overview (roleLanding) and GET /v1/maintenance/summary answers 200",
  firstGlance: {
    purpose: "The workshop: what is grounded and what to repair",
    state: "VH003 is grounded with its brake repair in progress",
    nextAction: "Open VH003's repair",
  },
  budgets: {
    taps: 0,
    seconds: 5,
    wordsPerScreen: 200,
    foldWordsPerScreen: 80,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/**
 * Read-only. The technician never sees Home's tiles: `/` sends them to the
 * Maintenance Overview (shell/landing.ts), so this measures where they land.
 * Run: pnpm verify drive journey:technician-opens-home --role technician --viewport 390x844 --throttle phone --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, apiGet, log } = ctx;
  assertStartedAs(ctx, journey);
  await page.waitForURL((url) => url.pathname === "/maintenance", { timeout: 30_000 });
  await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 60_000 });
  const run = journeyRunner(ctx, journey);
  await run.screen("home", "Where the technician lands: the Maintenance Overview");

  const summary = await apiGet("/v1/maintenance/summary");
  if (summary.status !== 200) throw new Error(`GET /v1/maintenance/summary → ${summary.status}`);
  log(`landed on ${new URL(page.url()).pathname}; api cross-check: /v1/maintenance/summary 200`);
  run.finish();
};

export default drive;
