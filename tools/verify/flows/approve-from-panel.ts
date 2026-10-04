import { openSidebar, type DriveScript } from "../browser.js";

/**
 * Finance → Approvals → open the oldest pending entry from its number, read it
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

  await (await openSidebar(page)).getByRole("link", { name: t("Finances", "Finance") }).click();
  await page.getByRole("navigation", { name: t("Sections financières", "Finance sections") }).getByRole("tab", { name: new RegExp(`^${t("Approbations", "Approvals")}`) }).click();
  await page.getByRole("heading", { level: 1, name: t("Approbations", "Approvals") }).waitFor();
  await quiet();
  await shot("approvals-queue");

  await page.getByRole("button", { name: entry.entryNumber, exact: true }).click();
  // The toast region is a dialog too, so the panel is the one titled by the entry.
  const panel = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: entry.entryNumber }) });
  await panel.waitFor();
  await quiet();
  await shot("entry-panel");

  await panel.getByRole("button", { name: t("Approuver", "Approve"), exact: true }).click();
  await page.getByText(t("Écriture approuvée", "Entry approved")).first().waitFor();
  await panel.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: entry.entryNumber, exact: true }).waitFor({ state: "detached" });
  await quiet();
  await shot("approved");

  const after = await apiGet(`/v1/finance/entries/${entry.id}`);
  const status = (after.body as { status?: string }).status;
  if (status !== "POSTED") throw new Error(`${entry.entryNumber} is ${status ?? after.status} after approval`);
  const left = await apiGet("/v1/finance/approvals");
  const still = ((left.body as { entries?: Array<{ id: string }> }).entries ?? []).some((row) => row.id === entry.id);
  if (still) throw new Error(`${entry.entryNumber} is still in the queue`);
  log(`api cross-check: ${entry.entryNumber} is now ${status} and out of the queue`);
};

export default flow;
