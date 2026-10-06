import { DEMO_WORKSPACE, resolveAccount } from "../accounts.js";
import { openSidebar, type DriveScript } from "../browser.js";

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
  const counterparty = `Port handling ${Date.now()}`;
  // A table row on desktop, a card on a phone; the innermost match is the item itself.
  const itemWith = (text: string) =>
    page.getByRole("row").or(page.locator("div.rounded-xl.border")).filter({ hasText: text }).last();

  await nav("/finance/record");
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.getByRole("combobox", { name: t("Catégorie", "Category") }).click();
  await page.getByRole("option", { name: t("Chargement", "Loading") }).click();
  await page.getByLabel(t("Montant (FCFA)", "Amount (FCFA)")).fill("150000");
  await page.getByLabel(t("Tiers (optionnel)", "Counterparty (optional)")).fill(counterparty);
  await shot("expense-form", {
    caption: "The cashier records a 150,000 FCFA loading expense, above the 100,000 approval threshold",
    highlight: page.getByRole("button", { name: t("Enregistrer la dépense", "Record the expense") }),
  });
  await page.getByRole("button", { name: t("Enregistrer la dépense", "Record the expense") }).click();
  await page.waitForURL((url) => url.pathname === "/finance/entries");
  const recorded = itemWith(counterparty);
  await recorded.waitFor();
  await quiet();

  const submitted = await apiGet("/v1/finance/entries?status=SUBMITTED");
  const entries = (submitted.body as { entries?: Array<{ id: string; entryNumber: string; counterpartyName?: string | null }> }).entries ?? [];
  const entry = entries.find((item) => item.counterpartyName === counterparty);
  if (entry === undefined) throw new Error(`GET /v1/finance/entries?status=SUBMITTED → ${submitted.status}, no entry for ${counterparty}`);
  const afterRecord = await historyOf(entry.id);
  if (!afterRecord.includes("financial_entry.submitted")) throw new Error(`history of ${entry.entryNumber} after recording: ${afterRecord.join(", ")}`);
  log(`api cross-check: ${entry.entryNumber} SUBMITTED, history ${afterRecord.join(", ")}`);
  await shot("expense-sent", {
    caption: `Saved as ${entry.entryNumber}, awaiting review; its history holds the submit event`,
    highlight: recorded,
  });

  const finance = resolveAccount("finance");
  await openSidebar(page);
  await page.getByRole("button", { name: t("Se déconnecter", "Sign out") }).locator("visible=true").first().click();
  await page.waitForURL((url) => url.pathname === "/login");
  await page.getByLabel(/^(Espace de travail|Workspace)$/).fill(DEMO_WORKSPACE);
  await page.getByLabel(/^(Nom d'utilisateur|Username)$/).fill(finance.username);
  await page.getByLabel(/^(Code PIN|PIN code)$/).fill(finance.pin);
  await page.getByRole("button", { name: /^(Se connecter|Sign in)$/ }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await quiet();

  await nav("/finance/approvals");
  await page.getByRole("heading", { level: 1, name: t("Approbations", "Approvals") }).waitFor();
  const row = itemWith(entry.entryNumber);
  await row.waitFor();
  await quiet();
  await shot("approvals-queue", { caption: `Signed in as Finance: ${entry.entryNumber} is in the approvals queue`, highlight: row });

  await row.getByRole("button", { name: "Actions" }).click();
  await page.getByRole("menuitem", { name: t("Approuver l'écriture", "Approve entry") }).click();
  await page.getByText(t("Écriture approuvée", "Entry approved")).first().waitFor();
  await quiet();

  const after = await apiGet(`/v1/finance/entries/${entry.id}`);
  const status = (after.body as { status?: string }).status;
  if (status !== "POSTED") throw new Error(`${entry.entryNumber} is ${status ?? after.status} after approval`);
  const afterApprove = await historyOf(entry.id);
  if (!afterApprove.includes("financial_entry.approved")) throw new Error(`history of ${entry.entryNumber} after approval: ${afterApprove.join(", ")}`);
  log(`api cross-check: ${entry.entryNumber} POSTED, history ${afterApprove.join(", ")}`);
  await shot("approved", { caption: `Approved: ${entry.entryNumber} is posted, and its history holds the approval event too` });

  async function historyOf(entryId: string): Promise<string[]> {
    const history = await apiGet(`/v1/history/financial_entry/${entryId}`);
    if (history.status !== 200) throw new Error(`GET /v1/history/financial_entry/${entryId} → ${history.status}`);
    return ((history.body as { items?: HistoryItem[] }).items ?? []).map((item) => item.eventType);
  }
};

export default flow;
