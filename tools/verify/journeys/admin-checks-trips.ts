import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "admin-checks-trips",
  actor: { role: "admin", person: "The Administrateur (chef d'agence), on the move" },
  arrangeAs: "admin",
  goal: "see how the trips stand and open a closed trip that is missing data, to see what it lacks",
  trigger: "Between jobs, checking the week's trips",
  frequency: "Daily",
  device: { viewport: { width: 390, height: 844 }, throttle: "phone" },
  doneWhen:
    "The trip missing data shows what it lacks at rest (its missing-data badges), and GET /v1/activities/:id answers COMPLETE_WITH_EXCEPTIONS",
  firstGlance: {
    purpose: "How the trips stand and what is left to close",
    state: "A trip is on the road; closed trips are missing fuel or km",
    nextAction: "Open the trips missing data",
  },
  budgets: {
    taps: 3,
    seconds: 10,
    // An Overview is figures; sentences are not.
    wordsPerScreen: 250,
    foldWordsPerScreen: 60,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/**
 * Read-only. Trips (sidebar) → the Overview's "missing data" tile → the trip
 * missing data. On the seed that is DLA-2026-00002 (VH001), closed with gaps.
 * Run: pnpm verify drive journey:admin-checks-trips --role admin --viewport 390x844 --throttle phone --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, nav, quiet, apiGet, log } = ctx;
  assertStartedAs(ctx, journey);
  const list = await apiGet("/v1/activities?completeness=COMPLETE_WITH_EXCEPTIONS");
  const trip = (list.body as { items?: Array<{ id: string; activityNumber: string }> }).items?.[0];
  if (list.status !== 200 || trip === undefined) throw new Error(`GET /v1/activities?completeness=COMPLETE_WITH_EXCEPTIONS → ${list.status}, none`);
  // The sidebar tap is the shell's; the journey starts on the Trips page.
  await nav("/activities");
  await page.getByRole("heading", { level: 1, name: t("Trajets", "Trips") }).waitFor({ timeout: 30_000 });
  await quiet();
  const run = journeyRunner(ctx, journey);
  await run.screen("trips-overview", "The Trips Overview on the Administrateur's phone");

  // The missing-data tile: it opens every closed trip with gaps, whatever they lack.
  const missing = page.locator("main a[href*='completeness=COMPLETE_WITH_EXCEPTIONS']").first();
  await run.tap(missing);
  await page.waitForURL((url) => url.pathname === "/activities/list", { timeout: 30_000 });
  await page.getByRole("button", { name: trip.activityNumber, exact: true }).first().waitFor({ timeout: 30_000 });
  await run.screen("trips-missing-data", "The closed trips missing data");

  await run.tap(page.getByRole("button", { name: trip.activityNumber, exact: true }).first());
  await page.getByRole("heading", { level: 1, name: trip.activityNumber }).waitFor({ timeout: 30_000 });
  await run.screen("trip-missing-data", `${trip.activityNumber} says what it is missing`);

  const detail = await apiGet(`/v1/activities/${trip.id}`);
  const body = detail.body as { completeness?: string; completenessCodes?: string[] };
  if (detail.status !== 200 || body.completeness !== "COMPLETE_WITH_EXCEPTIONS") {
    throw new Error(`GET /v1/activities/${trip.id} → ${detail.status} ${body.completeness ?? ""}`);
  }
  // Trust at rest: each missing fact is named on the page, not behind a tap.
  const codes = body.completenessCodes ?? [];
  const block = page.locator("main [data-slot=status-block]");
  if (!(await block.isVisible())) throw new Error("the trip shows no status block for its missing data");
  const badges = await block.locator("li, [data-slot=trip-missing-fact]").count();
  if (badges < codes.length) throw new Error(`the status block names ${badges} missing facts, the read ${codes.length}`);
  log(`api cross-check: ${trip.activityNumber} ${body.completeness} ${codes.join(",")}`);
  run.finish();
};

export default drive;
