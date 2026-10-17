import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";
import { openVehicle } from "./admin-checks-truck.js";

export const journey: Journey = {
  id: "director-reads-truck-money",
  actor: { role: "director", person: "Direction: the owner or managing director" },
  arrangeAs: "director",
  goal: "see what one truck cost this month, what is not counted yet, and where the money went",
  trigger: "Profit by truck shows VH001 costing more than the others",
  frequency: "Weekly",
  device: { viewport: { width: 1440, height: 900 }, throttle: "none" },
  doneWhen: "VH001's Money tab shows the month's posted expenses equal to GET /v1/assets/:id/finance posted.expenseMinor",
  firstGlance: {
    purpose: "What this truck cost this month and why",
    state: "This month's posted expenses, what waits for review, receipts missing",
    nextAction: "Open the biggest category's entries, or chase the missing receipts",
  },
  budgets: {
    taps: 1,
    seconds: 5,
    // Figures are words too; sentences are not.
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
 * Read-only.
 * Run: pnpm verify drive journey:director-reads-truck-money --role director --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, apiGet, log, lang } = ctx;
  assertStartedAs(ctx, journey);
  await ctx.quiet();
  const id = await openVehicle(ctx, "VH001");
  const run = journeyRunner(ctx, journey);
  await run.screen("vehicle-now", "VH001's Overview on Direction's desk");

  const sections = page.getByRole("navigation", { name: t("Sections du véhicule", "Vehicle sections") });
  await run.tap(sections.getByRole("tab", { name: new RegExp(`^${t("Argent", "Money")}`) }));
  await page.waitForURL((url) => url.pathname.endsWith("/money"));
  await run.screen("money", "VH001's Money tab for this month");

  const finance = await apiGet(`/v1/assets/${id}/finance`);
  const posted = (finance.body as { posted?: { expenseMinor?: number } }).posted?.expenseMinor;
  if (finance.status !== 200 || posted === undefined) throw new Error(`GET /v1/assets/${id}/finance → ${finance.status}`);
  // "450 000 FCFA" in both languages, non-breaking spaces between groups.
  const shown = `${new Intl.NumberFormat(lang === "fr" ? "fr-FR" : "en-GB").format(posted).replace(/[\s,. ]/g, " ")} FCFA`;
  const text = ((await page.locator("main").textContent()) ?? "").replace(/[\s ]/g, " ");
  if (!text.includes(shown)) throw new Error(`Money tab does not show posted expenses ${shown}`);
  log(`api cross-check: posted expenses ${posted} shown as ${shown}`);
  run.finish();
};

export default drive;
