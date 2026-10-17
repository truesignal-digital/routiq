import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "director-reads-money",
  actor: { role: "director", person: "Direction: the owner or managing director" },
  arrangeAs: "director",
  goal: "see what the company spent and earned this month, what is not counted yet, and where spending moved",
  trigger: "Opening Money from the sidebar or the Dashboard's month card",
  frequency: "Weekly",
  device: { viewport: { width: 1440, height: 900 }, throttle: "none" },
  doneWhen: "The Expenses tile opens Entries filtered to this month's counted expenses; GET /v1/finance/overview answers 200",
  firstGlance: {
    purpose: "The company's money this month",
    state: "Expenses and revenue against last month; some entries wait or have no receipt, so not everything is counted",
    nextAction: "Open the expenses, or To approve",
  },
  budgets: {
    taps: 1,
    seconds: 5,
    // Figures page like the Dashboard: generous on words, strict on sentences.
    wordsPerScreen: 320,
    foldWordsPerScreen: 140,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/**
 * Direction reads the Money Overview, then opens the expenses behind the tile. Read-only.
 * Run: pnpm verify drive journey:director-reads-money --role director --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, nav, apiGet, log } = ctx;
  assertStartedAs(ctx, journey);
  await nav("/finance");
  await page.getByRole("heading", { level: 1, name: t("Argent", "Money") }).waitFor({ timeout: 60_000 });
  await page.locator("[data-slot=money-overview] [data-slot=metric-value]").first().waitFor({ timeout: 30_000 });
  const run = journeyRunner(ctx, journey);
  await run.screen("money-overview", "Money › Overview as Direction opens it");

  const tile = page.locator("[data-slot=metric-tile]").filter({ hasText: t("Dépenses", "Expenses") }).locator("[data-slot=metric-link]").first();
  await run.tap(tile);
  await page.waitForURL((url) => url.pathname === "/finance/entries" && url.searchParams.get("direction") === "EXPENSE", { timeout: 30_000 });
  log(`tile opened ${new URL(page.url()).pathname}${new URL(page.url()).search}`);

  const overview = await apiGet("/v1/finance/overview");
  if (overview.status !== 200) throw new Error(`GET /v1/finance/overview → ${overview.status}`);
  log("api cross-check: /v1/finance/overview 200");
  run.finish();
};

export default drive;
