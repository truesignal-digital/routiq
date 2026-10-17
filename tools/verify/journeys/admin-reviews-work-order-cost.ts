import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "admin-reviews-work-order-cost",
  actor: { role: "admin", person: "The Administrateur (chef d'agence) at the desk" },
  arrangeAs: "admin",
  goal: "check the work orders and what a finished repair cost",
  trigger: "End of the week, reviewing the workshop",
  frequency: "Weekly",
  device: { viewport: { width: 1440, height: 900 }, throttle: "none" },
  doneWhen: "A completed work order's panel shows its actual cost, equal to GET /v1/work-orders/:id actualCostMinor",
  firstGlance: {
    purpose: "Every work order: what it fixes, its status and its cost",
    state: "One repair is open on VH003, one is completed on VH001",
    nextAction: "Open the completed work order to see what it cost",
  },
  budgets: {
    taps: 1,
    seconds: 5,
    // A desk table: figures are fine, sentences are not.
    wordsPerScreen: 220,
    foldWordsPerScreen: 140,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/**
 * Read-only.
 * Run: pnpm verify drive journey:admin-reviews-work-order-cost --role admin --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, quiet, apiGet, log } = ctx;
  assertStartedAs(ctx, journey);
  await page.goto(new URL("/maintenance/work-orders", page.url()).toString());
  await page.locator("[data-slot='data-table'] tbody tr").first().waitFor({ timeout: 60_000 });
  await quiet();
  const run = journeyRunner(ctx, journey);
  await run.screen("work-orders", "Every work order on the Administrateur's desk");

  const list = await apiGet("/v1/work-orders?status=COMPLETED&limit=50");
  const completed = (list.body as { items?: { id: string; number: number }[] }).items?.[0];
  if (completed === undefined) throw new Error("no completed work order to review (reseed the slot)");
  // Record numbers are zero-padded on screen (OT-0002).
  const label = new RegExp(`^${t("OT", "WO")}-0*${completed.number}$`);
  await run.tap(page.locator("[data-slot='data-table'] tbody").getByRole("button", { name: label }).first());
  const panel = page.locator("[role=dialog]:not([aria-modal=false])").last();
  await panel.getByRole("heading", { name: label }).first().waitFor({ timeout: 30_000 });
  await quiet();
  await run.screen("work-order", "The completed work order and what it cost");

  const detail = await apiGet(`/v1/work-orders/${completed.id}`);
  const actual = (detail.body as { actualCostMinor?: number | null }).actualCostMinor;
  if (detail.status !== 200 || actual == null) throw new Error(`GET /v1/work-orders/${completed.id} → ${detail.status} actual ${actual}`);
  // The panel writes "85 000 FCFA" with non-breaking spaces; compare digits only.
  const digits = String(actual);
  const text = ((await panel.textContent()) ?? "").replace(/[\s\u202f\u00a0]/g, "");
  if (!text.includes(`${digits}FCFA`)) throw new Error(`the panel does not show the actual cost ${digits} FCFA`);
  log(`api cross-check: work order ${completed.number} actual ${digits}`);
  run.finish();
};

export default drive;
