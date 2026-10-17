import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "admin-finds-expiring",
  actor: { role: "admin", person: "The Administrateur (chef d'agence)" },
  arrangeAs: "admin",
  goal: "find which truck papers have expired or expire soon, and start renewing the first",
  trigger: "A driver is stopped at a checkpoint, or the weekly papers check",
  frequency: "Weekly",
  device: { viewport: { width: 390, height: 844 }, throttle: "phone" },
  doneWhen: "Documents lists every paper GET /v1/todo and GET /v1/coming-up?days=30 name, expired first",
  firstGlance: {
    purpose: "Truck papers that have expired or expire soon",
    state: "Some papers expired, others are due within 30 days",
    nextAction: "Open the first expired paper's truck to renew it",
  },
  budgets: {
    taps: 1,
    seconds: 10,
    wordsPerScreen: 160,
    foldWordsPerScreen: 90,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/**
 * Read-only. Trucks opens on Overview; the Administrateur taps Documents.
 * Run: pnpm verify drive journey:admin-finds-expiring --role admin --viewport 390x844 --throttle phone --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, nav, quiet, apiGet, log } = ctx;
  assertStartedAs(ctx, journey);
  await nav("/assets");
  await page.locator("[data-slot=trucks-overview]").waitFor({ timeout: 60_000 });
  await quiet();
  const run = journeyRunner(ctx, journey);
  await run.tap(page.locator('[data-slot=module-page-tabs] a[href="/assets/documents"]'));
  await page.waitForURL((url) => url.pathname === "/assets/documents", { timeout: 30_000 });
  await page.locator("[data-slot=fleet-documents]").waitFor({ timeout: 30_000 });
  await run.screen("fleet-documents", "The fleet's papers on the Administrateur's phone");

  const [todo, coming] = await Promise.all([apiGet("/v1/todo"), apiGet("/v1/coming-up?days=30")]);
  type Row = { code: string };
  const expired = ((todo.body as { rows?: Row[] }).rows ?? []).filter((r) => r.code === "DOCUMENT_EXPIRED").length;
  const due = ((coming.body as { rows?: Row[] }).rows ?? []).filter((r) => r.code === "DOCUMENT_DUE").length;
  log(`api cross-check: ${expired} expired, ${due} due in 30 days`);
  if (todo.status !== 200 || coming.status !== 200) throw new Error(`todo ${todo.status}, coming-up ${coming.status}`);
  run.finish();
};

export default drive;
