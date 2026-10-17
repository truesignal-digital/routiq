import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "driver-opens-trip",
  actor: { role: "driver", person: "A driver (chauffeur) on the road" },
  arrangeAs: "driver",
  goal: "see their trips and open the one on the road",
  trigger: "Before setting off or at a stop, phone in hand",
  frequency: "Several times a day",
  device: { viewport: { width: 390, height: 844 }, throttle: "phone" },
  doneWhen: "The open trip's page shows its number, and GET /v1/activities/:id answers 200 with status OPEN",
  firstGlance: {
    purpose: "My trips",
    state: "One trip is on the road (VH003); one closed trip is missing data",
    nextAction: "Open the trip on the road",
  },
  budgets: {
    taps: 3,
    seconds: 10,
    // A driver reads a short list on a phone: a few rows and their state.
    wordsPerScreen: 150,
    foldWordsPerScreen: 60,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/**
 * Read-only. The driver taps Trips on the bottom bar, then the Trips tab, then
 * their open trip. On the seed, Sali's open trip is DLA-2026-00003 on VH003.
 * Run: pnpm verify drive journey:driver-opens-trip --role driver --viewport 390x844 --throttle phone --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, quiet, apiGet, log } = ctx;
  assertStartedAs(ctx, journey);
  const list = await apiGet("/v1/activities?status=OPEN");
  const trip = (list.body as { items?: Array<{ id: string; activityNumber: string }> }).items?.[0];
  if (list.status !== 200 || trip === undefined) throw new Error(`GET /v1/activities?status=OPEN → ${list.status}, no open trip`);
  await quiet();
  const run = journeyRunner(ctx, journey);

  await run.tap(page.getByRole("navigation", { name: t("Raccourcis", "Shortcuts") }).getByRole("link", { name: t("Trajets", "Trips") }));
  await page.getByRole("heading", { level: 1, name: t("Trajets", "Trips") }).waitFor({ timeout: 30_000 });
  await run.screen("trips-overview", "Trips opens on its Overview for the driver");

  await run.tap(page.locator("[data-slot='module-page-tabs']").getByRole("tab", { name: t("Trajets", "Trips") }));
  await page.getByRole("button", { name: trip.activityNumber, exact: true }).first().waitFor({ timeout: 30_000 });
  await run.screen("trips-list", "The driver's own trips");

  await run.tap(page.getByRole("button", { name: trip.activityNumber, exact: true }).first());
  await page.getByRole("heading", { level: 1, name: trip.activityNumber }).waitFor({ timeout: 30_000 });
  await run.screen("trip", `The trip on the road, ${trip.activityNumber}`);

  const detail = await apiGet(`/v1/activities/${trip.id}`);
  const status = (detail.body as { status?: string }).status;
  if (detail.status !== 200 || status !== "OPEN") throw new Error(`GET /v1/activities/${trip.id} → ${detail.status} ${status ?? ""}`);
  log(`api cross-check: ${trip.activityNumber} ${status}`);
  run.finish();
};

export default drive;
