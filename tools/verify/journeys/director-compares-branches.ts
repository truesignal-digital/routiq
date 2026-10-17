import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "director-compares-branches",
  actor: { role: "director", person: "Direction: the owner or managing director" },
  arrangeAs: "director",
  goal: "compare the branches' money this month and see which one lags",
  trigger: "Preparing the monthly meeting with the chefs d'agence",
  frequency: "Weekly",
  device: { viewport: { width: 1440, height: 900 }, throttle: "none" },
  doneWhen: "Profit by branch lists every branch of GET /v1/finance/overview",
  firstGlance: {
    purpose: "Each branch's revenue, expenses and profit for the period",
    state: "Douala makes more than Yaoundé this month",
    nextAction: "Change the period, or open the lagging branch's trucks",
  },
  budgets: {
    taps: 1,
    seconds: 5,
    wordsPerScreen: 200,
    foldWordsPerScreen: 140,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/**
 * Read-only. Dashboard → Profit by branch. The Overview is director-checks-month's.
 * Run: pnpm verify drive journey:director-compares-branches --role director --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, apiGet, log } = ctx;
  assertStartedAs(ctx, journey);
  // --lang en switches on My settings, so the drive may start there.
  if (new URL(page.url()).pathname !== "/") await ctx.nav("/");
  await page.getByRole("heading", { level: 1, name: t("Tableau de bord", "Dashboard") }).waitFor({ timeout: 60_000 });
  await ctx.quiet();
  const run = journeyRunner(ctx, journey);
  await run.tap(page.getByRole("tab", { name: new RegExp(`^${t("Bénéfice par agence", "Profit by branch")}`) }));
  await page.locator("[data-slot=dashboard-branches]").waitFor({ timeout: 30_000 });
  await run.screen("profit-by-branch", "Every branch's money for the period");

  const overview = await apiGet("/v1/finance/overview");
  const branches = (overview.body as { branches?: { name: string }[] | null }).branches ?? [];
  if (overview.status !== 200) throw new Error(`GET /v1/finance/overview → ${overview.status}`);
  for (const branch of branches) {
    if ((await page.locator("[data-slot=dashboard-branches]").getByText(branch.name, { exact: true }).count()) === 0) {
      throw new Error(`branch ${branch.name} is missing from Profit by branch`);
    }
  }
  log(`api cross-check: /v1/finance/overview ${branches.length} branches, all listed`);
  run.finish();
};

export default drive;
