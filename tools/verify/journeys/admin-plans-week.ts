import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "admin-plans-week",
  actor: { role: "admin", person: "The Administrateur (chef d'agence), at the desk" },
  arrangeAs: "admin",
  goal: "see what is planned for next week and open a planned trip to check its truck and driver",
  trigger: "Planning the coming week, at the office",
  frequency: "Weekly",
  device: { viewport: { width: 1440, height: 900 }, throttle: "none" },
  doneWhen: "A planned trip's page shows its number, and GET /v1/activities/:id answers 200 with status PLANNED",
  firstGlance: {
    purpose: "The trips planned and not started",
    state: "Two trips are planned for next week",
    nextAction: "Open a planned trip",
  },
  budgets: {
    taps: 2,
    seconds: 5,
    // A planning list is rows; a row is a few words.
    wordsPerScreen: 250,
    foldWordsPerScreen: 140,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/**
 * Read-only once arranged. Scheduling is off on the seed, so arrange first,
 * on slot N (the vendor CLI, then two plan-trip commands, real commands only):
 *   pg=$((24000+10*N)); key=$(jq -r .commandPayloadHmacKey .verify/slots/N/state.json)
 *   DATABASE_URL=postgresql://routiq_app:routiq_app@127.0.0.1:$pg/routiq_dev AUTH_DATABASE_URL=postgresql://routiq:routiq@127.0.0.1:$pg/routiq_dev \
 *     COMMAND_PAYLOAD_HMAC_KEY=$key pnpm --filter @routiq/api entitlement --workspace transports-ngwa --enable-module SCHEDULING
 *   pnpm verify api POST /v1/commands/plan-trip --role admin --slot N --json @plan.json   (twice, next Monday and Tuesday)
 * `pnpm verify up --reseed` puts the seed back.
 * Run: pnpm verify drive journey:admin-plans-week --role admin --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, nav, quiet, apiGet, log } = ctx;
  assertStartedAs(ctx, journey);
  const list = await apiGet("/v1/activities?status=PLANNED");
  const trip = (list.body as { items?: Array<{ id: string; activityNumber: string }> }).items?.[0];
  if (list.status !== 200 || trip === undefined) throw new Error(`GET /v1/activities?status=PLANNED → ${list.status}, nothing planned: arrange first (file header)`);
  await nav("/activities");
  await page.getByRole("heading", { level: 1, name: t("Trajets", "Trips") }).waitFor({ timeout: 30_000 });
  await quiet();
  const run = journeyRunner(ctx, journey);

  await run.tap(page.locator("[data-slot='module-page-tabs']").getByRole("tab", { name: t("Planification", "Planning") }));
  await page.getByRole("button", { name: trip.activityNumber, exact: true }).first().waitFor({ timeout: 30_000 });
  await run.screen("planning", "The trips planned and not started");

  await run.tap(page.getByRole("button", { name: trip.activityNumber, exact: true }).first());
  await page.getByRole("heading", { level: 1, name: trip.activityNumber }).waitFor({ timeout: 30_000 });
  await run.screen("planned-trip", `The planned trip ${trip.activityNumber}`);

  const detail = await apiGet(`/v1/activities/${trip.id}`);
  const status = (detail.body as { status?: string }).status;
  if (detail.status !== 200 || status !== "PLANNED") throw new Error(`GET /v1/activities/${trip.id} → ${detail.status} ${status ?? ""}`);
  log(`api cross-check: ${trip.activityNumber} ${status}`);
  run.finish();
};

export default drive;
