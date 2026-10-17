import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";
import { openVehicle } from "./admin-checks-truck.js";

export const journey: Journey = {
  id: "technician-opens-maintenance",
  actor: { role: "technician", person: "The technician (Technicien) in the workshop" },
  arrangeAs: "technician",
  goal: "find the repair waiting on them for a truck and open it to work on it",
  trigger: "Standing next to VH003 in the workshop",
  frequency: "Daily",
  device: { viewport: { width: 390, height: 844 }, throttle: "phone" },
  doneWhen: "VH003's open work order is in the record panel with Complete work offered, and GET /v1/work-orders?assetId= lists it APPROVED",
  firstGlance: {
    purpose: "This truck's repairs and reported problems",
    state: "One repair in progress on VH003, the next step is mine",
    nextAction: "Open the brake repair and complete it",
  },
  budgets: {
    taps: 2,
    seconds: 10,
    wordsPerScreen: 160,
    foldWordsPerScreen: 60,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/**
 * Read-only. On a fresh seed VH003's brake repair is in progress.
 * Run: pnpm verify drive journey:technician-opens-maintenance --role technician --viewport 390x844 --throttle phone --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, apiGet, log } = ctx;
  assertStartedAs(ctx, journey);
  await ctx.quiet();
  const id = await openVehicle(ctx, "VH003");
  const run = journeyRunner(ctx, journey);
  await run.screen("vehicle-now", "VH003's Overview on the technician's phone");

  const sections = page.getByRole("navigation", { name: t("Sections du véhicule", "Vehicle sections") });
  await run.tap(sections.getByRole("tab", { name: /^Maintenance/ }));
  await page.waitForURL((url) => url.pathname.endsWith("/maintenance"));
  await run.screen("maintenance", "VH003's Maintenance tab");

  const orders = await apiGet(`/v1/work-orders?assetId=${id}`);
  const open = (orders.body as { items?: { id: string; number: number; status: string; description: string }[] }).items?.find(
    // Authorized and not done: the repair the workshop works on.
    (wo) => wo.status === "APPROVED",
  );
  if (orders.status !== 200 || open === undefined) throw new Error(`GET /v1/work-orders?assetId=${id} → ${orders.status}, no APPROVED order`);
  await run.tap(page.getByRole("button", { name: open.description }).first());
  const panel = page.getByRole("dialog").last();
  await panel.getByRole("button", { name: t("Terminer les travaux", "Complete work"), exact: true }).first().waitFor({ timeout: 30_000 });
  await run.screen("work-order", "The repair in the record panel, Complete work offered");
  log(`api cross-check: work order ${open.number} ${open.status}`);
  run.finish();
};

export default drive;
