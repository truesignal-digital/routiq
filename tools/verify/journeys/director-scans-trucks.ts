import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "director-scans-trucks",
  actor: { role: "director", person: "Direction: the owner or managing director" },
  arrangeAs: "director",
  goal: "scan every truck, its state and branch, and spot the ones that need attention",
  trigger: "At the desk, before a call with a branch or a client",
  frequency: "Weekly",
  device: { viewport: { width: 1440, height: 900 }, throttle: "none" },
  doneWhen: "The Trucks tab lists every truck GET /v1/assets returns",
  firstGlance: {
    purpose: "The list of my trucks",
    state: "Every truck with its status, class, branch and plate; some need attention",
    nextAction: "Open a truck, or filter by status",
  },
  budgets: {
    taps: 1,
    seconds: 5,
    // A list is its rows; the chrome around them should be a few words.
    wordsPerScreen: 260,
    foldWordsPerScreen: 220,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/**
 * Read-only. Trucks opens on Overview; Direction taps the list tab.
 * Run: pnpm verify drive journey:director-scans-trucks --role director --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, nav, quiet, apiGet, log } = ctx;
  assertStartedAs(ctx, journey);
  await nav("/assets");
  await page.locator("[data-slot=trucks-overview]").waitFor({ timeout: 60_000 });
  await quiet();
  const run = journeyRunner(ctx, journey);
  // The list tab carries the preset's word for the vehicles (Camions, Véhicules…), so match its address.
  await run.tap(page.locator('[data-slot=module-page-tabs] a[href="/assets/list"]'));
  await page.waitForURL((url) => url.pathname === "/assets/list", { timeout: 30_000 });
  await page.locator("table tbody tr").first().waitFor({ timeout: 30_000 });
  await run.screen("trucks-list", "The trucks list as Direction sees it on a desk");

  const read = await apiGet("/v1/assets?limit=100");
  const items = (read.body as { items?: Array<{ assetCode: string }> }).items ?? [];
  const rows = await page.locator("table tbody tr").count();
  log(`api cross-check: GET /v1/assets → ${read.status}, ${items.length} trucks; ${rows} rows on screen`);
  if (read.status !== 200 || rows < Math.min(items.length, 25)) throw new Error(`list shows ${rows} rows, read has ${items.length}`);
  run.finish();
};

export default drive;
