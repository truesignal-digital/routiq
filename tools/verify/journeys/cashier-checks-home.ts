import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "cashier-checks-home",
  actor: { role: "cashier", person: "The cashier (caissière) of one branch" },
  arrangeAs: "cashier",
  goal: "see what was recorded lately and open the latest entry",
  trigger: "Between two customers, or when a driver brings receipts",
  frequency: "Several times a day",
  device: { viewport: { width: 390, height: 844 }, throttle: "phone" },
  doneWhen: "The first recent entry opens its own page, and GET /v1/finance/entries answers 200",
  firstGlance: {
    purpose: "My branch's recent money entries and trucks",
    state: "Recent entries, some waiting for approval",
    nextAction: "Open the latest entry (or record one)",
  },
  budgets: {
    taps: 1,
    seconds: 10,
    wordsPerScreen: 200,
    foldWordsPerScreen: 80,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/**
 * Read-only. Ends when the entry's page opens; that page is Money's journey.
 * Run: pnpm verify drive journey:cashier-checks-home --role cashier --viewport 390x844 --throttle phone --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, apiGet, log } = ctx;
  assertStartedAs(ctx, journey);
  // --lang en switches on My settings, so the drive may start there.
  if (new URL(page.url()).pathname !== "/") await ctx.nav("/");
  await ctx.quiet();
  const run = journeyRunner(ctx, journey);
  await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 60_000 });
  // On a phone the table is list rows; the entry number is the row's one button.
  const firstEntry = page.locator("main [data-slot=data-table-row]").first().getByRole("button").first();
  await firstEntry.waitFor({ timeout: 30_000 });
  await run.screen("home", "The cashier's Home on a phone");

  const before = page.url();
  await run.tap(firstEntry);
  await page.waitForURL((url) => url.href !== before, { timeout: 30_000 });
  log(`first entry opened ${new URL(page.url()).pathname}`);

  const entries = await apiGet("/v1/finance/entries");
  if (entries.status !== 200) throw new Error(`GET /v1/finance/entries → ${entries.status}`);
  log("api cross-check: /v1/finance/entries 200");
  run.finish();
};

export default drive;
