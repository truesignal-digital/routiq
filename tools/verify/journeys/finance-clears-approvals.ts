import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "finance-clears-approvals",
  actor: { role: "finance", person: "Finance: the accountant who approves spending" },
  arrangeAs: "finance",
  goal: "decide the entries that wait for them, oldest first",
  trigger: "The Money count in the sidebar, at the desk",
  frequency: "Daily",
  device: { viewport: { width: 1440, height: 900 }, throttle: "none" },
  doneWhen: "The oldest entry Finance may decide is approved: GET /v1/finance/entries/:id answers POSTED and the row leaves the queue",
  firstGlance: {
    purpose: "Entries waiting for my approval",
    state: "Two expenses wait, one has no receipt",
    nextAction: "Approve the oldest entry (or open it to check the receipt)",
  },
  budgets: {
    taps: 1,
    seconds: 5,
    // A short queue: each row is number, date, branch, category, amount, who and the decision.
    wordsPerScreen: 200,
    foldWordsPerScreen: 160,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

interface Pending {
  id: string;
  entryNumber: string;
  submittedByPrincipalId: string;
  directionDecides: boolean;
}

/**
 * Finance opens To approve and approves the oldest entry they may decide from its row.
 * Writes: reseed between runs (pnpm verify up --slot N --reseed).
 * Run: pnpm verify drive journey:finance-clears-approvals --role finance --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, nav, apiGet, log } = ctx;
  assertStartedAs(ctx, journey);
  const me = (await apiGet("/v1/me")).body as { principalId?: string };
  const queue = await apiGet("/v1/finance/approvals");
  const entry = ((queue.body as { entries?: Pending[] }).entries ?? []).find(
    (item) => !item.directionDecides && item.submittedByPrincipalId !== me.principalId,
  );
  if (queue.status !== 200 || entry === undefined) throw new Error(`GET /v1/finance/approvals → ${queue.status}, nothing Finance may decide (reseed?)`);

  // The sidebar count opens this address (modules/finance/manifest.ts).
  await nav("/finance/approve?branch=all");
  await page.getByRole("heading", { level: 1, name: t("Argent", "Money") }).waitFor({ timeout: 60_000 });
  const approve = page.getByRole("button", { name: `${t("Approuver l'écriture", "Approve entry")} ${entry.entryNumber}`, exact: true });
  await approve.waitFor({ timeout: 30_000 });
  const run = journeyRunner(ctx, journey);
  await run.screen("to-approve", "The queue as Finance opens it");

  await run.tap(approve);
  await page.getByText(t("Écriture approuvée", "Entry approved")).first().waitFor({ timeout: 30_000 });
  await approve.waitFor({ state: "detached", timeout: 30_000 });
  await run.screen("approved", `${entry.entryNumber} approved and gone from the queue`);

  const after = await apiGet(`/v1/finance/entries/${entry.id}`);
  const status = (after.body as { status?: string }).status;
  if (status !== "POSTED") throw new Error(`${entry.entryNumber} is ${status ?? after.status} after approval`);
  log(`api cross-check: ${entry.entryNumber} POSTED`);
  run.finish();
};

export default drive;
