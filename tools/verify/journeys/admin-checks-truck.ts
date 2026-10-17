import type { DriveContext, DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "admin-checks-truck",
  actor: { role: "admin", person: "The Administrateur (chef d'agence), between other jobs" },
  arrangeAs: "admin",
  goal: "see whether a grounded truck can drive, what holds it, and who acts next",
  trigger: "A driver calls about VH003, or its To do row on the Dashboard",
  frequency: "Several times a week",
  device: { viewport: { width: 390, height: 844 }, throttle: "phone" },
  doneWhen: "The work order holding VH003 is open in the record panel and GET /v1/assets/:id says GROUNDED",
  firstGlance: {
    purpose: "One truck's state: can it drive, and what needs me on it",
    state: "VH003 is grounded; the workshop is repairing the brakes; nothing waits on me yet",
    nextAction: "Open the repair (the work order) to follow it",
  },
  budgets: {
    taps: 1,
    seconds: 10,
    // A phone screen read in a hallway: the state, the blocker, the next step.
    wordsPerScreen: 160,
    foldWordsPerScreen: 60,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/** VH003's page by its id, as a To do row or the Trucks list opens it. */
export async function openVehicle(ctx: DriveContext, code: string, tab = ""): Promise<string> {
  const { page, apiGet } = ctx;
  const list = await apiGet(`/v1/assets?search=${code}`);
  const id = (list.body as { items?: { id: string; assetCode: string }[] }).items?.find((a) => a.assetCode === code)?.id;
  if (id === undefined) throw new Error(`no ${code} in GET /v1/assets?search=${code} (${list.status})`);
  await page.goto(new URL(`/assets/${id}${tab}`, page.url()).toString());
  await page.getByRole("heading", { level: 1, name: code }).waitFor({ timeout: 90_000 });
  return id;
}

/**
 * Read-only. On a fresh seed VH003 is grounded with its brake repair in progress.
 * Run: pnpm verify drive journey:admin-checks-truck --role admin --viewport 390x844 --throttle phone --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, apiGet, log } = ctx;
  assertStartedAs(ctx, journey);
  await ctx.quiet();
  const id = await openVehicle(ctx, "VH003");
  const run = journeyRunner(ctx, journey);
  await run.screen("vehicle-now", "VH003's Overview on the Administrateur's phone");

  // The status block names the work order that holds the truck.
  const status = page.locator("[role=status]").filter({ hasText: /^(Grounded|Immobilisé)/ }).first();
  const link = status.getByRole("button", { name: /^(OT|WO)-\d+/ }).first();
  const number = ((await link.textContent()) ?? "").trim();
  await run.tap(link);
  await page.getByRole("dialog").last().getByText(number).first().waitFor({ timeout: 30_000 });
  await run.screen("work-order", "The repair that holds VH003, in the record panel");

  const asset = await apiGet(`/v1/assets/${id}`);
  const state = (asset.body as { availability?: { state?: string } }).availability?.state;
  if (asset.status !== 200 || state !== "GROUNDED") throw new Error(`GET /v1/assets/${id} → ${asset.status} ${state ?? "?"}`);
  log(`api cross-check: VH003 availability ${state}`);
  run.finish();
};

export default drive;
