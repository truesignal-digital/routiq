import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "director-checks-branches",
  // Branches is Direction's page (branches/permissions.ts); the Administrateur is refused it.
  actor: { role: "director", person: "Direction: the owner or managing director, at the office" },
  arrangeAs: "director",
  goal: "see which branches are open and set up, before giving someone a branch",
  trigger: "Opening a site, or giving a new user their branches",
  frequency: "Monthly",
  device: { viewport: { width: 1440, height: 900 }, throttle: "none" },
  doneWhen: "Every branch of GET /v1/branches is on the list with its code, name and whether it is active",
  firstGlance: {
    purpose: "The company's branches",
    state: "Bafoussam, Douala and Yaoundé are all active",
    nextAction: "Create a branch",
  },
  budgets: {
    taps: 1,
    seconds: 5,
    wordsPerScreen: 120,
    foldWordsPerScreen: 120,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/**
 * Read-only. Branches, then the Create a branch panel (dismissed, nothing sent).
 * Run: pnpm verify drive journey:director-checks-branches --role director --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, nav, log, apiGet } = ctx;
  assertStartedAs(ctx, journey);
  await nav("/more/branches");
  await page.getByRole("heading", { level: 1, name: t("Agences", "Branches") }).waitFor({ timeout: 60_000 });
  const run = journeyRunner(ctx, journey);
  await run.screen("branches", "Branches as Direction sees them");

  const branches = (await apiGet("/v1/branches")).body as { items: { code: string; name: string }[] };
  for (const branch of branches.items) {
    await page.getByRole("row").filter({ hasText: branch.code }).filter({ hasText: branch.name }).first().waitFor();
  }
  log(`api cross-check: ${branches.items.map((b) => b.code).join(", ")} listed`);

  await run.tap(page.getByRole("button", { name: t("Créer une agence", "Create a branch"), exact: true }));
  const form = page.getByRole("dialog");
  await form.waitFor();
  await run.screen("create-branch", "The Create a branch panel");
  await page.keyboard.press("Escape");
  await form.waitFor({ state: "detached" });
  run.finish();
};

export default drive;
