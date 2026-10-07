import { openSidebar, type DriveScript } from "../browser.js";

/**
 * Money → "Waiting your approval" → approve, from the row's own button (one tap), the oldest pending
 * entry the viewer may decide (someone else recorded it, and it is inside the
 * viewer's approval band), then read it back as POSTED. Mutates the slot; reset
 * with `pnpm verify up --reseed`. Finance decides up to 1 000 000 XAF; above
 * that only Direction can (ADR-0009).
 * Run: pnpm verify drive flow:approve-entry --role finance --lang en
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  const queue = await apiGet("/v1/finance/approvals");
  const me = await apiGet("/v1/me");
  const principalId = (me.body as { principalId?: string }).principalId;
  const pending =
    (queue.body as {
      entries?: Array<{ id: string; entryNumber: string; submittedByPrincipalId: string; directionDecides: boolean }>;
    }).entries ?? [];
  const entry = pending.find((item) => !item.directionDecides && item.submittedByPrincipalId !== principalId);
  if (queue.status !== 200 || entry === undefined) throw new Error(`GET /v1/finance/approvals → ${queue.status}, nothing this role may decide (reseed?)`);
  log(`api: ${pending.length} pending; approving ${entry.entryNumber}`);

  await (await openSidebar(page)).getByRole("link", { name: t("Finances", "Finance") }).click();
  await page.getByRole("heading", { level: 1, name: t("Finances", "Money") }).waitFor();
  await page.getByRole("button", { name: t("En attente de votre approbation", "Waiting your approval"), exact: true }).click();
  await quiet();
  await shot("approvals-queue", { caption: `The waiting view: ${entry.entryNumber} waits for this role's decision` });

  // Approve is one tap: the row's button sends the command, no dialog first.
  await page.getByRole("button", { name: `${t("Approuver l'écriture", "Approve entry")} ${entry.entryNumber}`, exact: true }).click();
  await page.getByText(t("Écriture approuvée", "Entry approved")).first().waitFor();
  await quiet();
  await shot("approved", { caption: `Approved in one tap from the row: ${entry.entryNumber} is posted` });

  const after = await apiGet(`/v1/finance/entries/${entry.id}`);
  const status = (after.body as { status?: string }).status;
  if (status !== "POSTED") throw new Error(`${entry.entryNumber} is ${status ?? after.status} after approval`);
  log(`api cross-check: ${entry.entryNumber} is now ${status}`);
};

export default flow;
