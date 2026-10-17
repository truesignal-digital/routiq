import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "technician-opens-work",
  actor: { role: "technician", person: "The technician (Hervé) in the workshop" },
  arrangeAs: "technician",
  goal: "see the open work and start on the first work order",
  trigger: "Arriving at the workshop, or between two jobs",
  frequency: "Several times a day",
  device: { viewport: { width: 390, height: 844 }, throttle: "phone" },
  doneWhen: "The first open work order's panel is open and GET /v1/work-orders/:id answers 200 with an open status",
  firstGlance: {
    purpose: "The workshop: what is broken and what is being repaired",
    state: "VH003 is grounded for a safety problem; one work order is open",
    nextAction: "Open the open work orders and start VH003's brake repair",
  },
  budgets: {
    taps: 2,
    seconds: 10,
    // A phone screen of tiles and a short list; sentences are not part of it.
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
 * The technician's Home is the Maintenance Overview. Tap the open work
 * orders, then the first one. Read-only.
 * Run: pnpm verify drive journey:technician-opens-work --role technician --viewport 390x844 --throttle phone --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, quiet, apiGet, log } = ctx;
  assertStartedAs(ctx, journey);
  await page.goto(new URL("/maintenance", page.url()).toString());
  await page.locator("[data-slot='maintenance-overview'] [data-slot='metric-strip'][data-state='ready']").waitFor({ timeout: 60_000 });
  await quiet();
  const run = journeyRunner(ctx, journey);
  await run.screen("overview", "The Maintenance Overview on the technician's phone");

  await run.tap(page.locator("[data-slot='metric-strip']").getByRole("link", { name: new RegExp(t("Ordres de travail ouverts", "Work orders open")) }));
  await page.waitForURL((url) => url.pathname === "/maintenance/work-orders");
  const first = page.locator("[data-slot='data-table-row']").first();
  await first.waitFor({ timeout: 30_000 });
  await quiet();
  await run.screen("work-orders", "The work orders still open");

  const title = (await first.locator("[data-slot='data-table-row-title']").textContent())?.trim() ?? "";
  await run.tap(first.locator("[data-slot='data-table-row-title']").getByRole("button").first());
  const panel = page.locator("[role=dialog]:not([aria-modal=false])").last();
  await panel.getByRole("heading", { name: title }).first().waitFor({ timeout: 30_000 });
  await quiet();
  await run.screen("work-order", "The first open work order, ready to work on");

  const number = Number(/(\d+)$/.exec(title)?.[1] ?? Number.NaN);
  const list = await apiGet("/v1/work-orders?open=true&limit=50");
  const item = (list.body as { items?: { id: string; number: number }[] }).items?.find((row) => row.number === number);
  if (item === undefined) throw new Error(`${title} is not in GET /v1/work-orders?open=true`);
  const detail = await apiGet(`/v1/work-orders/${item.id}`);
  const status = (detail.body as { status?: string }).status ?? "?";
  if (detail.status !== 200 || !["SUBMITTED", "APPROVED", "COMPLETION_SUBMITTED"].includes(status)) {
    throw new Error(`GET /v1/work-orders/${item.id} → ${detail.status} ${status}`);
  }
  log(`api cross-check: ${title} ${status}`);
  run.finish();
};

export default drive;
