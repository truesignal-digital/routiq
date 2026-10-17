import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";
import { openVehicle } from "./admin-checks-truck.js";

export const journey: Journey = {
  id: "admin-reviews-truck-record",
  actor: { role: "admin", person: "The Administrateur (chef d'agence) at the office" },
  arrangeAs: "admin",
  goal: "check what happened to a truck lately and what is on file about it",
  trigger: "Before calling the insurer or answering Direction about VH003",
  frequency: "A few times a month",
  device: { viewport: { width: 1440, height: 900 }, throttle: "none" },
  doneWhen: "VH003's Details show its plate and assigned driver as GET /v1/assets/:id has them, after its History",
  firstGlance: {
    purpose: "Everything that happened to VH003, newest first",
    state: "Grounded for a brake problem, a repair in progress, money and readings recorded",
    nextAction: "Open the event to look at, or read Details",
  },
  budgets: {
    taps: 1,
    seconds: 5,
    // A timeline is a list of events; each row is short, the page is not.
    wordsPerScreen: 360,
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
 * Run: pnpm verify drive journey:admin-reviews-truck-record --role admin --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, apiGet, log } = ctx;
  assertStartedAs(ctx, journey);
  await ctx.quiet();
  const id = await openVehicle(ctx, "VH003", "/history");
  const run = journeyRunner(ctx, journey);
  await run.screen("history", "VH003's History");

  const sections = page.getByRole("navigation", { name: t("Sections du véhicule", "Vehicle sections") });
  await run.tap(sections.getByRole("tab", { name: new RegExp(`^${t("Détails", "Details")}`) }));
  await page.waitForURL((url) => url.pathname.endsWith("/details"));
  await run.screen("details", "VH003's Details");

  const asset = await apiGet(`/v1/assets/${id}`);
  const body = asset.body as { registrationNumber?: string | null; custodian?: { displayName?: string } | null };
  const main = page.locator("main");
  if (asset.status !== 200) throw new Error(`GET /v1/assets/${id} → ${asset.status}`);
  if (body.registrationNumber) await main.getByText(body.registrationNumber).first().waitFor();
  if (body.custodian?.displayName) await main.getByText(body.custodian.displayName, { exact: false }).first().waitFor();
  log(`api cross-check: plate ${body.registrationNumber ?? "none"}, assigned driver ${body.custodian?.displayName ?? "none"}`);
  run.finish();
};

export default drive;
