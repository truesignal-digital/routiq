import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "admin-clears-today",
  actor: { role: "admin", person: "The Administrateur (chef d'agence)" },
  arrangeAs: "admin",
  goal: "see what needs them today and start on the first thing",
  trigger: "Picking up the phone between other jobs",
  frequency: "Several times a day",
  device: { viewport: { width: 390, height: 844 }, throttle: "phone" },
  doneWhen: "The first To do row's action opens the record it names (VH003's page)",
  firstGlance: {
    purpose: "What needs me today",
    state: "VH003 is repaired and waits to be released; a document expired; receipts are missing",
    nextAction: "Release VH003",
  },
  budgets: {
    taps: 1,
    seconds: 10,
    wordsPerScreen: 320,
    foldWordsPerScreen: 50,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/**
 * Read-only. On a fresh seed VH003's repair is still in progress, so the first
 * row asks for that; after release-to-service's arrange step it offers Release.
 * Run: pnpm verify drive journey:admin-clears-today --role admin --viewport 390x844 --throttle phone --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, quiet } = ctx;
  assertStartedAs(ctx, journey);
  await quiet();
  const run = journeyRunner(ctx, journey);
  await run.screen("dashboard", "The Dashboard on the Administrateur's phone");

  const first = page.locator("[data-slot=to-do-row]").first();
  await first.waitFor({ timeout: 30_000 });
  const before = page.url();
  const dashboardTitle = await page.getByRole("heading", { level: 1 }).first().textContent();
  await run.tap(first.getByRole("link").last());
  await page.waitForURL((url) => url.href !== before, { timeout: 30_000 });
  // Done when the record's own title replaces the Dashboard's, not when any heading exists.
  await page.waitForFunction((title) => {
    const h1 = document.querySelector("main h1");
    return h1 !== null && h1.textContent !== title;
  }, dashboardTitle, { timeout: 60_000 });
  // The record page is the vehicle section's journey; this one ends when it opens.
  ctx.log(`first row opened ${new URL(page.url()).pathname}`);
  run.finish();
};

export default drive;
