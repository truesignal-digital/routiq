import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "director-checks-month",
  actor: { role: "director", person: "Direction: the owner or managing director" },
  arrangeAs: "director",
  goal: "see how the month is going, what changed it, and what needs them",
  trigger: "Opening ROUTIQ at the office, most mornings",
  frequency: "Daily",
  device: { viewport: { width: 1440, height: 900 }, throttle: "none" },
  doneWhen: "Profit by truck lists every truck for the month and GET /v1/finance/overview answers 200",
  firstGlance: {
    purpose: "How the company is doing this month, and what needs me",
    state: "This month's money against last month; one truck is grounded and repaired",
    nextAction: "Act on the first row of Needs you (release VH003)",
  },
  budgets: {
    taps: 1,
    seconds: 5,
    // A dashboard is figures, so the total is generous; sentences are not.
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
 * Direction lands on the Dashboard, reads it, then opens Profit by truck.
 * Read-only.
 * Run: pnpm verify drive journey:director-checks-month --role director --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, apiGet, log } = ctx;
  assertStartedAs(ctx, journey);
  await page.getByRole("heading", { level: 1, name: t("Tableau de bord", "Dashboard") }).waitFor({ timeout: 60_000 });
  const run = journeyRunner(ctx, journey);
  await run.screen("dashboard", "The Dashboard as Direction sees it on arrival");

  // The preset's vocabulary names the vehicle (camion, car…), so match the start only.
  await run.tap(page.getByRole("tab", { name: new RegExp(`^${t("Bénéfice par (?!agence)", "Profit by (?!branch)")}`) }));
  await page.locator("[data-slot=dashboard-vehicles]").waitFor({ timeout: 30_000 });
  await run.screen("profit-by-truck", "Every truck's money for the month");

  const overview = await apiGet("/v1/finance/overview");
  if (overview.status !== 200) throw new Error(`GET /v1/finance/overview → ${overview.status}`);
  log("api cross-check: /v1/finance/overview 200");
  run.finish();
};

export default drive;
