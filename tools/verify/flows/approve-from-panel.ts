import { openSidebar, type DriveScript } from "../browser.js";

/**
 * Money → "Waiting your approval" → open the oldest pending entry from its number, read it
 * in the record panel, approve from the panel footer, then read it back as
 * POSTED and gone from the queue. Mutates the slot; reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:approve-from-panel --role finance --lang en
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  const queue = await apiGet("/v1/finance/approvals");
  const pending = (queue.body as { entries?: Array<{ id: string; entryNumber: string }> }).entries ?? [];
  const entry = pending[0];
  if (queue.status !== 200 || entry === undefined) throw new Error(`GET /v1/finance/approvals → ${queue.status}, nothing pending (reseed?)`);
  log(`api: ${pending.length} pending; opening ${entry.entryNumber}`);

  await (await openSidebar(page)).getByRole("link", { name: t("Argent", "Money") }).click();
  await page.getByRole("heading", { level: 1, name: t("Argent", "Money") }).waitFor();
  await page.getByRole("button", { name: t("En attente de votre approbation", "Waiting your approval"), exact: true }).click();
  await quiet();
  await shot("approvals-queue", {
    caption: `The waiting view: ${entry.entryNumber} waits for a decision`,
    highlight: page.getByRole("row").filter({ hasText: entry.entryNumber }),
  });

  await page.getByRole("button", { name: entry.entryNumber, exact: true }).click();
  // The toast region is a dialog too, so the panel is the one titled by the entry.
  const panel = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: entry.entryNumber }) });
  await panel.waitFor();
  await quiet();
  // The panel carries the receipt and the history, not just the fields.
  await panel.getByText(t("Justificatif", "Receipt"), { exact: true }).waitFor();
  await panel.getByRole("button", { name: t("Historique", "History") }).waitFor();
  await shot("entry-panel", { caption: `Its number opens the record panel: receipt, history and the decision in one place`, highlight: panel });

  await panel.getByRole("button", { name: t("Approuver l'écriture", "Approve entry"), exact: true }).click();
  await page.getByText(t("Écriture approuvée", "Entry approved")).first().waitFor();
  await panel.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: entry.entryNumber, exact: true }).waitFor({ state: "detached" });
  await quiet();
  await shot("approved", { caption: `Approved from the panel footer: ${entry.entryNumber} leaves the queue` });

  const after = await apiGet(`/v1/finance/entries/${entry.id}`);
  const status = (after.body as { status?: string }).status;
  if (status !== "POSTED") throw new Error(`${entry.entryNumber} is ${status ?? after.status} after approval`);
  const left = await apiGet("/v1/finance/approvals");
  const still = ((left.body as { entries?: Array<{ id: string }> }).entries ?? []).some((row) => row.id === entry.id);
  if (still) throw new Error(`${entry.entryNumber} is still in the queue`);
  log(`api cross-check: ${entry.entryNumber} is now ${status} and out of the queue`);
};

export default flow;
