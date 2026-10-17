import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "admin-checks-access",
  actor: { role: "admin", person: "The Administrateur (chef d'agence), away from the desk" },
  arrangeAs: "admin",
  goal: "check who can sign in, with which role and in which branches, and whether anyone is locked out",
  trigger: "Someone says they can't sign in, or a person leaves",
  frequency: "Weekly",
  device: { viewport: { width: 390, height: 844 }, throttle: "phone" },
  doneWhen: "Every member of GET /v1/members is on the list with their role and branches",
  firstGlance: {
    purpose: "Who can sign in to ROUTIQ",
    state: "Every member is active; each row says role and branches",
    nextAction: "Add a user, or open a member's actions",
  },
  budgets: {
    taps: 1,
    seconds: 10,
    // A list of people is data; sentences are not.
    wordsPerScreen: 200,
    foldWordsPerScreen: 110,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/**
 * Read-only. Opens Users on the phone, reads it, then one member's actions.
 * Run: pnpm verify drive journey:admin-checks-access --role admin --viewport 390x844 --throttle phone --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, nav, log, apiGet } = ctx;
  assertStartedAs(ctx, journey);
  await nav("/more/users");
  await page.getByRole("heading", { level: 1, name: t("Utilisateurs", "Users") }).waitFor({ timeout: 60_000 });
  const run = journeyRunner(ctx, journey);
  await run.screen("users", "Users on the Administrateur's phone");

  const members = (await apiGet("/v1/members")).body as { items: { displayName: string; role: string }[] };
  const main = page.locator("main");
  const text = (await main.innerText()).replace(/\s+/g, " ");
  const missing = members.items.filter((member) => !text.includes(member.displayName));
  if (missing.length > 0) throw new Error(`not listed: ${missing.map((m) => m.displayName).join(", ")}`);
  // Branch scope is a trust rule: each row says it. Checked after the measure, so a miss still leaves the report.
  const allBranches = t("Toutes les agences", "All branches");
  const scopeMissing = text.includes(allBranches) ? undefined : `no row names its branches ("${allBranches}")`;
  log(`api cross-check: ${members.items.length} members of GET /v1/members listed; branches ${scopeMissing ?? "shown"}`);

  const other = members.items.find((member) => member.role === "DRIVER");
  if (other === undefined) throw new Error("no driver in the seed");
  await run.tap(page.locator("[data-slot=data-table-row]").filter({ hasText: other.displayName }).first().getByRole("button", { name: t("Actions", "Actions") }));
  await page.getByRole("menu").waitFor();
  await run.screen("member-actions", `What the Administrateur can do for ${other.displayName}`);
  try {
    run.finish();
  } finally {
    if (scopeMissing !== undefined) ctx.log(`DONE-WHEN FAILS: ${scopeMissing}`);
  }
  if (scopeMissing !== undefined) throw new Error(scopeMissing);
};

export default drive;
