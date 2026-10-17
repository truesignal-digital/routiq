import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "cashier-records-expense",
  actor: { role: "cashier", person: "The cashier (caissière) of the Douala branch" },
  arrangeAs: "cashier",
  goal: "record money paid out, with its category and amount, before the receipt is lost",
  trigger: "Paying a loading crew or a supplier at the depot",
  frequency: "Several times a day",
  device: { viewport: { width: 390, height: 844 }, throttle: "phone" },
  // Fields typed or picked, not counted as taps: category and amount (2 required), counterparty (1 optional).
  doneWhen: "The new expense is in GET /v1/finance/entries?status=SUBMITTED with its counterparty, and the app confirms it was sent for approval",
  firstGlance: {
    purpose: "My branch's money, and recording an expense",
    state: "This month's expenses; some entries have no receipt",
    nextAction: "Record expense",
  },
  budgets: {
    taps: 2,
    seconds: 10,
    wordsPerScreen: 260,
    foldWordsPerScreen: 80,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/**
 * The cashier opens Money on a phone, records a 150 000 FCFA loading expense, and sees it listed.
 * Writes: reseed between runs (pnpm verify up --slot N --reseed).
 * Run: pnpm verify drive journey:cashier-records-expense --role cashier --viewport 390x844 --throttle phone --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, nav, apiGet, log, quiet } = ctx;
  assertStartedAs(ctx, journey);
  const counterparty = `Port handling ${Date.now().toString(36).slice(-4).toUpperCase()}`;
  await nav("/finance");
  await page.getByRole("heading", { level: 1, name: t("Argent", "Money") }).waitFor({ timeout: 60_000 });
  await quiet();
  const run = journeyRunner(ctx, journey);
  await run.screen("money", "Money as the cashier opens it on a phone");

  await run.tap(page.getByRole("link", { name: t("Saisir une dépense", "Record expense") }).first());
  const form = page.getByRole("dialog", { name: t("Saisir une écriture", "Record an entry") });
  await form.waitFor({ timeout: 30_000 });
  await run.screen("expense-form", "The record panel as it opens");

  await form.getByRole("combobox", { name: t("Catégorie", "Category") }).click();
  await page.getByRole("option", { name: t("Chargement", "Loading") }).click();
  await form.getByLabel(t("Montant (FCFA)", "Amount (FCFA)")).fill("150000");
  await form.getByLabel(t("Tiers (optionnel)", "Counterparty (optional)")).fill(counterparty);

  await run.tap(form.getByRole("button", { name: t("Enregistrer la dépense", "Record the expense") }));
  await page.waitForURL((url) => url.pathname === "/finance/entries", { timeout: 30_000 });
  await page.getByText(t("Écriture envoyée pour approbation", "Entry sent for approval")).first().waitFor({ timeout: 30_000 });
  await run.screen("recorded", "Back on Entries: the expense waits for approval");

  const submitted = await apiGet("/v1/finance/entries?status=SUBMITTED");
  const entries = (submitted.body as { entries?: Array<{ entryNumber: string; counterpartyName?: string | null }> }).entries ?? [];
  const entry = entries.find((item) => item.counterpartyName === counterparty);
  if (entry === undefined) throw new Error(`GET /v1/finance/entries?status=SUBMITTED → ${submitted.status}, no entry for ${counterparty}`);
  log(`api cross-check: ${entry.entryNumber} SUBMITTED for ${counterparty}`);
  run.finish();
};

export default drive;
