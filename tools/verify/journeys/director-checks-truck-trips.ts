import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";
import { openVehicle } from "./admin-checks-truck.js";

export const journey: Journey = {
  id: "director-checks-truck-trips",
  actor: { role: "director", person: "Direction: the owner or managing director" },
  arrangeAs: "director",
  goal: "see where one truck went lately, how far, and open its latest trip",
  trigger: "VH001 costs more than the others on Profit by truck, and Direction wants to know what it ran",
  frequency: "Weekly",
  device: { viewport: { width: 1440, height: 900 }, throttle: "none" },
  doneWhen: "VH001's newest trip from GET /v1/activities?assetId=:id&sort=startedAt:desc is open in the record panel",
  firstGlance: {
    purpose: "The trips this truck ran, newest first",
    state: "Each trip's route, driver, km and status; the km recorded in total",
    nextAction: "Open the latest trip",
  },
  budgets: {
    taps: 2,
    seconds: 6,
    // A list of trips is data: routes, numbers, dates. Sentences are not.
    wordsPerScreen: 320,
    foldWordsPerScreen: 160,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/**
 * Read-only.
 * Run: pnpm verify drive journey:director-checks-truck-trips --role director --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, apiGet, log } = ctx;
  assertStartedAs(ctx, journey);
  await ctx.quiet();
  const id = await openVehicle(ctx, "VH001");
  const run = journeyRunner(ctx, journey);
  await run.screen("vehicle-now", "VH001's Overview on Direction's desk");

  const sections = page.getByRole("navigation", { name: t("Sections du véhicule", "Vehicle sections") });
  await run.tap(sections.getByRole("tab", { name: /^(Trajets|Activités|Trips|Activities)/ }));
  await page.waitForURL((url) => url.pathname.endsWith("/trips"));
  await ctx.quiet();
  await run.screen("trips", "VH001's Trips tab, newest first");

  const list = await apiGet(`/v1/activities?assetId=${id}&sort=startedAt:desc`);
  const newest = (list.body as { items?: { id: string; activityNumber: string }[] }).items?.[0];
  if (list.status !== 200 || newest === undefined) throw new Error(`GET /v1/activities?assetId=${id} → ${list.status}, no trip`);
  const row = page.locator("main li").filter({ hasText: newest.activityNumber }).first();
  await run.tap(row.getByRole("button").first());
  await page.getByRole("dialog").last().getByText(newest.activityNumber).first().waitFor({ timeout: 30_000 });
  await run.screen("trip", "VH001's latest trip in the record panel");
  log(`api cross-check: newest trip ${newest.activityNumber} open in the panel`);
  run.finish();
};

export default drive;
