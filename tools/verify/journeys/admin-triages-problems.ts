import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "admin-triages-problems",
  actor: { role: "admin", person: "The Administrateur (chef d'agence) on the move" },
  arrangeAs: "admin",
  goal: "see the new problems, the safety ones first, and decide what to do with each",
  trigger: "A driver reported a fault; the sidebar shows new problems",
  frequency: "Daily",
  device: { viewport: { width: 390, height: 844 }, throttle: "phone" },
  doneWhen: "The Problems tab lists the open problems, as many as GET /v1/issues?status=OPEN returns",
  firstGlance: {
    purpose: "The workshop: problems reported and repairs under way",
    state: "Two problems are open on VH003, one safety-critical; VH003 is grounded",
    nextAction: "Open the new problems and triage the safety one",
  },
  budgets: {
    taps: 1,
    seconds: 8,
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
 * Read-only.
 * Run: pnpm verify drive journey:admin-triages-problems --role admin --viewport 390x844 --throttle phone --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, quiet, apiGet, log } = ctx;
  assertStartedAs(ctx, journey);
  await page.goto(new URL("/maintenance", page.url()).toString());
  await page.locator("[data-slot='maintenance-overview'] [data-slot='metric-strip'][data-state='ready']").waitFor({ timeout: 60_000 });
  await quiet();
  const run = journeyRunner(ctx, journey);
  await run.screen("overview", "The Maintenance Overview on the Administrateur's phone");

  await run.tap(page.locator("[data-slot='metric-strip']").getByRole("link", { name: new RegExp(t("Nouveaux problèmes", "New problems")) }));
  await page.waitForURL((url) => url.pathname === "/maintenance/problems");
  await page.locator("[data-slot='data-table-row']").first().waitFor({ timeout: 30_000 });
  await quiet();
  await run.screen("problems", "The open problems, ready to triage");

  const open = await apiGet("/v1/issues?status=OPEN&limit=50");
  const expected = (open.body as { items?: unknown[] }).items?.length ?? -1;
  const shown = await page.locator("[data-slot='data-table-row']").count();
  if (open.status !== 200 || shown !== expected) throw new Error(`Problems shows ${shown} rows, GET /v1/issues?status=OPEN → ${open.status} with ${expected}`);
  log(`api cross-check: ${shown} open problems`);
  run.finish();
};

export default drive;
