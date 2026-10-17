import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "finance-checks-entry",
  actor: { role: "finance", person: "Finance: the accountant who approves spending" },
  arrangeAs: "finance",
  goal: "open an entry with no receipt, see its status and evidence, and know how to cancel it",
  trigger: "The Missing receipt tile on Money › Overview",
  frequency: "Several times a week",
  device: { viewport: { width: 1440, height: 900 }, throttle: "none" },
  doneWhen: "The Cancel entry dialog is open on the entry's page and GET /v1/finance/entries/:id answers the status the page shows (nothing is sent)",
  firstGlance: {
    purpose: "Entries that have no receipt",
    state: "A list of posted expenses, each missing its receipt",
    nextAction: "Open the oldest entry and add its receipt",
  },
  budgets: {
    taps: 3,
    seconds: 8,
    // The list is data; a record page is facts. Sentences only where a rule meets an action.
    wordsPerScreen: 320,
    foldWordsPerScreen: 200,
    // The cancel dialog may state its one rule at the moment of action.
    proseWordsPerScreen: 25,
    longestBlock: 20,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

const STATUS_WORDS: Record<string, [string, string]> = {
  POSTED: ["Comptabilisée", "Posted"],
  SUBMITTED: ["En attente d'examen", "Awaiting review"],
};

/**
 * Finance → entries with no receipt → one entry's panel → its full page → Cancel entry (dialog only).
 * Read-only: the dialog is closed with its dismiss button.
 * Run: pnpm verify drive journey:finance-checks-entry --role finance --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, nav, apiGet, log } = ctx;
  assertStartedAs(ctx, journey);
  const list = await apiGet("/v1/finance/entries?status=POSTED&evidence=MISSING");
  const entry = ((list.body as { entries?: Array<{ id: string; entryNumber: string; reversesEntryId: string | null }> }).entries ?? []).find(
    (item) => item.reversesEntryId === null,
  );
  if (list.status !== 200 || entry === undefined) throw new Error(`GET /v1/finance/entries?status=POSTED&evidence=MISSING → ${list.status}, nothing to open`);
  log(`opening ${entry.entryNumber}`);

  await nav("/finance/entries?evidence=MISSING");
  await page.getByRole("heading", { level: 1, name: t("Argent", "Money") }).waitFor({ timeout: 60_000 });
  const number = page.getByRole("button", { name: entry.entryNumber, exact: true }).first();
  await number.waitFor({ timeout: 30_000 });
  const run = journeyRunner(ctx, journey);
  await run.screen("missing-receipts", "Entries with no receipt");

  await run.tap(number);
  const panel = page.getByRole("dialog");
  await panel.waitFor();
  await run.screen("entry-panel", `${entry.entryNumber} in the side panel`);

  await run.tap(panel.getByRole("button", { name: t("Ouvrir en plein écran", "Open full screen") }));
  await page.waitForURL((url) => url.pathname === `/finance/entries/${entry.id}`, { timeout: 30_000 });
  await page.getByRole("heading", { level: 1, name: entry.entryNumber }).waitFor({ timeout: 30_000 });
  await run.screen("entry-page", `${entry.entryNumber}'s record page`);

  const cancel = t("Annuler l'écriture", "Cancel entry");
  await run.tap(page.getByRole("button", { name: cancel, exact: true }).first());
  const dialog = page.getByRole("dialog", { name: cancel });
  await dialog.waitFor();
  await run.screen("cancel-dialog", "Cancel entry asks why before anything changes");

  const detail = await apiGet(`/v1/finance/entries/${entry.id}`);
  const status = (detail.body as { status?: string }).status ?? "";
  const words = STATUS_WORDS[status];
  if (detail.status !== 200 || words === undefined) throw new Error(`GET /v1/finance/entries/${entry.id} → ${detail.status} ${status}`);
  await dialog.getByRole("button", { name: t("Garder l'écriture", "Keep entry"), exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  await page.locator("main").getByText(t(...words), { exact: true }).first().waitFor({ timeout: 10_000 });
  log(`api cross-check: ${entry.entryNumber} ${status}, the page says ${t(...words)}`);
  run.finish();
};

export default drive;
