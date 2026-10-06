import type { DriveScript } from "../browser.js";

/**
 * Cancel entry (#426): entry detail → Cancel entry → reason "Wrong details" →
 * Record again, pre-filled → a new entry. The original reads back as REVERSED
 * with its cancellation's reason; the new entry is a normal recording.
 * Mutates the slot; reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:reverse-entry --role finance --lang en
 */
const flow: DriveScript = async ({ page, t, nav, shot, quiet, log, apiGet }) => {
  const list = await apiGet("/v1/finance/entries?status=POSTED");
  const entries = (list.body as { entries?: Array<{ id: string; entryNumber: string; reversesEntryId: string | null }> }).entries ?? [];
  const entry = entries.find((e) => e.reversesEntryId === null);
  if (entry === undefined) throw new Error(`GET /v1/finance/entries?status=POSTED → ${list.status}, nothing to cancel`);
  log(`cancelling ${entry.entryNumber}`);

  await nav(`/finance/entries/${entry.id}`);
  await page.getByRole("heading", { level: 1, name: t("Détail de l'écriture", "Entry detail") }).waitFor();
  await quiet();
  const cancel = t("Annuler l'écriture", "Cancel entry");
  await page.getByRole("button", { name: cancel, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: cancel });
  await dialog.getByRole("radio", { name: t("Mauvais détails, à ressaisir", "Wrong details, to record again") }).click();
  await page.waitForTimeout(300);
  await shot("cancel-dialog");
  await dialog.getByRole("button", { name: cancel, exact: true }).click();

  const recordAgain = dialog.getByRole("button", { name: t("Enregistrer à nouveau", "Record again"), exact: true });
  await recordAgain.waitFor({ timeout: 15_000 });
  await quiet();
  await shot("record-again-offered");
  await recordAgain.click();

  const form = page.getByRole("dialog", { name: t("Enregistrer une dépense", "Record expense") });
  await form.waitFor();
  await page.waitForTimeout(300);
  await shot("record-again-form");
  await form.getByRole("button", { name: t("Enregistrer la dépense", "Record the expense"), exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/finance/entries/") && !url.pathname.endsWith(entry.id), { timeout: 15_000 });
  await quiet();
  await shot("new-entry");

  const original = await apiGet(`/v1/finance/entries/${entry.id}`);
  const body = original.body as {
    status?: string;
    reversedByEntryId?: string | null;
    cancellation?: { reasonCode: string; reasonText: string | null } | null;
  };
  if (body.status !== "REVERSED" || !body.reversedByEntryId) throw new Error(`original is ${body.status ?? original.status}`);
  if (body.cancellation?.reasonCode !== "WRONG_DETAILS") throw new Error(`reason is ${JSON.stringify(body.cancellation)}`);
  log(`api cross-check: ${entry.entryNumber} is REVERSED for WRONG_DETAILS, cancelled by ${body.reversedByEntryId}`);
  const newId = new URL(page.url()).pathname.split("/").pop() ?? "";
  const recorded = await apiGet(`/v1/finance/entries/${newId}`);
  const again = recorded.body as { entryNumber?: string; reversesEntryId?: string | null; cancellation?: unknown };
  if (again.reversesEntryId !== null || again.cancellation !== null) throw new Error(`new entry is not a plain recording: ${JSON.stringify(again)}`);
  log(`api cross-check: recorded again as ${again.entryNumber ?? newId}`);
};

export default flow;
