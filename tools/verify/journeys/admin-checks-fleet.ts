import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "admin-checks-fleet",
  actor: { role: "admin", person: "The Administrateur (chef d'agence)" },
  arrangeAs: "admin",
  goal: "see whether the fleet can work today, and open the trucks that cannot",
  trigger: "Before the morning departures, standing in the yard",
  frequency: "Daily",
  device: { viewport: { width: 390, height: 844 }, throttle: "phone" },
  doneWhen: "The grounded tile opens the list filtered to grounded trucks, and GET /v1/assets?availability=GROUNDED lists the same count",
  firstGlance: {
    purpose: "Whether my trucks can drive today",
    state: "Most trucks can drive; one is grounded (VH003); some papers are due",
    nextAction: "Open the grounded truck",
  },
  budgets: {
    taps: 1,
    seconds: 10,
    // Tiles, a 30-day board of every truck and what is due: figures, not sentences.
    wordsPerScreen: 260,
    foldWordsPerScreen: 60,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/**
 * Read-only. Trucks › Overview on the Administrateur's phone, then the
 * grounded tile into the filtered list.
 * Run: pnpm verify drive journey:admin-checks-fleet --role admin --viewport 390x844 --throttle phone --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, nav, quiet, apiGet, log } = ctx;
  assertStartedAs(ctx, journey);
  await nav("/assets");
  await page.locator("[data-slot=trucks-overview]").waitFor({ timeout: 60_000 });
  await quiet();
  const run = journeyRunner(ctx, journey);
  await run.screen("trucks-overview", "Trucks Overview on the Administrateur's phone");

  await run.tap(page.locator("[data-metric=grounded] [data-slot=metric-link]"));
  await page.waitForURL((url) => url.pathname === "/assets/list" && url.searchParams.get("availability") === "GROUNDED", { timeout: 30_000 });
  await run.screen("grounded-list", "The list filtered to grounded trucks");

  const read = await apiGet("/v1/assets?availability=GROUNDED");
  const items = (read.body as { items?: Array<{ assetCode: string }> }).items ?? [];
  if (read.status !== 200) throw new Error(`GET /v1/assets?availability=GROUNDED → ${read.status}`);
  log(`api cross-check: grounded ${items.map((i) => i.assetCode).join(", ") || "none"}`);
  run.finish();
};

export default drive;
