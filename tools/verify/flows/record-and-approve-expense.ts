import { resolveAccount } from "../accounts.js";
import { signOutThroughNameMenu, type DriveScript } from "../browser.js";

interface HistoryItem {
  eventType: string;
}

/**
 * The cashier records a 150 000 XAF loading expense (above the 100 000 XAF
 * threshold, so it waits for Finance), signs out, and Finance approves it from
 * the queue. After each command the entry's history must hold that command's
 * audit event: the dispatcher refuses to commit a command without one (#153).
 * Mutates the slot; reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:record-and-approve-expense --role cashier --lang en
 */
const flow: DriveScript = async ({ page, t, nav, shot, quiet, log, apiGet }) => {
  const counterparty = `Port handling ${Date.now().toString(36).slice(-4).toUpperCase()}`;
  // A table row on desktop, a card on a phone; the innermost match is the item itself.
  const itemWith = (text: string) =>
    page.getByRole("row").or(page.locator("div.rounded-xl.border")).filter({ hasText: text }).last();

  await nav("/finance/record");
  // The record panel opens over Entries (#296).
  await page.getByRole("dialog", { name: t("Saisir une écriture", "Record an entry") }).waitFor();
  await page.getByRole("combobox", { name: t("Catégorie", "Category") }).click();
  await page.getByRole("option", { name: t("Chargement", "Loading") }).click();
  await page.getByLabel(t("Montant (FCFA)", "Amount (FCFA)")).fill("150000");
  await page.getByLabel(t("Tiers (optionnel)", "Counterparty (optional)")).fill(counterparty);
  // The fills scroll the page; the still and the screencast must agree on where the amount sits.
  const amount = page.getByLabel(t("Montant (FCFA)", "Amount (FCFA)"));
  await amount.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot("expense-form", {
    caption: "The cashier records a 150,000 FCFA loading expense, above the 100,000 approval threshold",
    highlight: amount,
  });
  await page.getByRole("button", { name: t("Enregistrer la dépense", "Record the expense") }).click();
  await page.waitForURL((url) => url.pathname === "/finance/entries");
  const recorded = itemWith(counterparty);
  await recorded.waitFor();
  await recorded.scrollIntoViewIfNeeded();
  await quiet();
  await page.waitForTimeout(600);

  const submitted = await apiGet("/v1/finance/entries?status=SUBMITTED");
  const entries = (submitted.body as { entries?: Array<{ id: string; entryNumber: string; counterpartyName?: string | null }> }).entries ?? [];
  const entry = entries.find((item) => item.counterpartyName === counterparty);
  if (entry === undefined) throw new Error(`GET /v1/finance/entries?status=SUBMITTED → ${submitted.status}, no entry for ${counterparty}`);
  const afterRecord = await historyOf(entry.id);
  if (!afterRecord.includes("financial_entry.submitted")) throw new Error(`history of ${entry.entryNumber} after recording: ${afterRecord.join(", ")}`);
  log(`api cross-check: ${entry.entryNumber} SUBMITTED, history ${afterRecord.join(", ")}`);
  await shot("expense-sent", {
    caption: `Saved as ${entry.entryNumber}, awaiting Finance's review`,
    highlight: recorded,
  });

  const finance = resolveAccount("finance");
  await signOutThroughNameMenu(page);
  await page.waitForURL((url) => url.pathname === "/login");
  await page.getByLabel(/^(Espace de travail|Workspace)$/).fill(finance.workspace);
  await page.getByLabel(/^(Nom d'utilisateur|Username)$/).fill(finance.username);
  await page.getByLabel(/^(Code PIN|PIN code)$/).fill(finance.pin);
  await page.waitForTimeout(400);
  await shot("finance-sign-in", {
    caption: `The cashier signs out; Finance (${finance.username}) signs in`,
    highlight: page.getByLabel(/^(Nom d'utilisateur|Username)$/),
  });
  await page.getByRole("button", { name: /^(Se connecter|Sign in)$/ }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await quiet();

  await nav("/finance/entries?view=waiting");
  await page.getByRole("heading", { level: 1, name: t("Argent", "Money") }).waitFor();
  const row = itemWith(entry.entryNumber);
  await row.waitFor();
  await quiet();
  // The screencast only sends a frame when something paints; hovering the row
  // paints the loaded table so the beat doesn't show the loading skeleton.
  await row.hover();
  await page.waitForTimeout(1000);
  await shot("approvals-queue", { caption: `Signed in as Finance: ${entry.entryNumber} waits in the Money page's waiting view`, highlight: row });

  await row.getByRole("button", { name: `${t("Approuver l'écriture", "Approve entry")} ${entry.entryNumber}`, exact: true }).click();
  await page.getByText(t("Écriture approuvée", "Entry approved")).first().waitFor();
  await row.waitFor({ state: "detached" });
  await quiet();

  const after = await apiGet(`/v1/finance/entries/${entry.id}`);
  const status = (after.body as { status?: string }).status;
  if (status !== "POSTED") throw new Error(`${entry.entryNumber} is ${status ?? after.status} after approval`);
  const afterApprove = await historyOf(entry.id);
  if (!afterApprove.includes("financial_entry.approved")) throw new Error(`history of ${entry.entryNumber} after approval: ${afterApprove.join(", ")}`);
  log(`api cross-check: ${entry.entryNumber} POSTED, history ${afterApprove.join(", ")}`);
  await shot("approved", { caption: `Approved: ${entry.entryNumber} leaves the queue` });

  await nav(`/finance/entries/${entry.id}`);
  // The record page is titled with the entry's own number (#662).
  await page.getByRole("heading", { level: 1, name: entry.entryNumber }).waitFor();
// History is the record page's last tab (#662).
  await page.getByRole("tab", { name: t("Historique", "History"), exact: true }).click();
  const sheet = page.getByRole("region", { name: t("Historique du dossier", "Record history") });
  await sheet.getByRole("listitem").first().waitFor();
  await quiet();
  await shot("history", {
    caption: `${entry.entryNumber} is posted; its history records both commands, submit and approve`,
    highlight: sheet.getByRole("list").first(),
  });

  async function historyOf(entryId: string): Promise<string[]> {
    const history = await apiGet(`/v1/history/financial_entry/${entryId}`);
    if (history.status !== 200) throw new Error(`GET /v1/history/financial_entry/${entryId} → ${history.status}`);
    return ((history.body as { items?: HistoryItem[] }).items ?? []).map((item) => item.eventType);
  }
};

export default flow;
