import { openSidebar, type DriveScript } from "../browser.js";

/**
 * Cancel entry from the record panel (#525): Money → a posted entry's number →
 * the panel shows the trip it belongs to ("Trip DLA-…" with its space, #455) and
 * Cancel entry in its footer → the same dialog as the full page → reason
 * "Entered twice" → the entry reads back as REVERSED with that reason. Then a
 * second posted expense: panel → Cancel entry → "Wrong details" → Record again
 * → the new entry appears in the list without a reload.
 * Mutates the slot; reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:cancel-from-panel --role finance --lang en
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  const list = await apiGet("/v1/finance/entries?status=POSTED");
  type Row = { id: string; entryNumber: string; direction: string; reversesEntryId: string | null; links: { activityNumber: string | null; workOrderId: string | null } };
  const entries = (list.body as { entries?: Row[] }).entries ?? [];
  const entry = entries.find((e) => e.reversesEntryId === null && e.links.activityNumber !== null);
  if (entry === undefined) throw new Error(`GET /v1/finance/entries?status=POSTED → ${list.status}, no posted trip entry to cancel (reseed?)`);
  const tripNumber = entry.links.activityNumber ?? "";
  log(`cancelling ${entry.entryNumber}, linked to trip ${tripNumber}`);

  await (await openSidebar(page)).getByRole("link", { name: t("Argent", "Money") }).click();
  await page.getByRole("heading", { level: 1, name: t("Argent", "Money") }).waitFor();
  await quiet();

  await page.getByRole("button", { name: entry.entryNumber, exact: true }).click();
  // The toast region is a dialog too, so the panel is the one titled by the entry.
  const panel = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: entry.entryNumber }) });
  await panel.waitFor();
  await quiet();
  const tripLink = panel.getByRole("link", { name: new RegExp(`^${t("Trajet", "Trip")} ${tripNumber}$`) });
  await tripLink.waitFor();
  const cancel = t("Annuler l'écriture", "Cancel entry");
  const cancelButton = panel.getByRole("button", { name: cancel, exact: true });
  await cancelButton.waitFor();
  await shot("entry-panel", {
    caption: `The record panel for ${entry.entryNumber} links its trip and offers Cancel entry`,
    highlight: panel.locator("[data-slot='drawer-footer']"),
  });

  await cancelButton.click();
  const dialog = page.getByRole("dialog", { name: cancel });
  await dialog.waitFor();
  await panel.waitFor({ state: "hidden" });
  await dialog.getByRole("radio", { name: t("Saisie en double", "Entered twice") }).click();
  await page.waitForTimeout(300);
  await shot("cancel-dialog", { caption: "The same Cancel entry dialog as the full page asks why first", highlight: dialog });
  await dialog.getByRole("button", { name: cancel, exact: true }).click();
  await dialog.waitFor({ state: "hidden", timeout: 15_000 });
  await quiet();
  await shot("cancelled", {
    caption: `${entry.entryNumber} is cancelled without leaving the list`,
    highlight: page.getByRole("row").filter({ hasText: entry.entryNumber }).first(),
  });

  const original = await apiGet(`/v1/finance/entries/${entry.id}`);
  const body = original.body as { status?: string; reversedByEntryId?: string | null; cancellation?: { reasonCode: string } | null };
  if (body.status !== "REVERSED" || !body.reversedByEntryId) throw new Error(`original is ${body.status ?? original.status}`);
  if (body.cancellation?.reasonCode !== "ENTERED_TWICE") throw new Error(`reason is ${JSON.stringify(body.cancellation)}`);
  log(`api cross-check: ${entry.entryNumber} is REVERSED for ENTERED_TWICE, cancelled by ${body.reversedByEntryId}`);

  // Wrong details → Record again, from the panel: the list must show the new entry without a reload.
  // Not a work-order line: only Direction, the Administrator and the Technician book those (#410).
  const second = entries.find(
    (e) => e.reversesEntryId === null && e.direction === "EXPENSE" && e.links.workOrderId === null && e.id !== entry.id,
  );
  if (second === undefined) throw new Error("no second posted expense to cancel (reseed?)");
  const before = new Set(((await apiGet("/v1/finance/entries")).body as { entries?: Row[] }).entries?.map((e) => e.entryNumber));
  log(`cancelling ${second.entryNumber} for wrong details`);
  await page.getByRole("button", { name: second.entryNumber, exact: true }).click();
  const secondPanel = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: second.entryNumber }) });
  await secondPanel.getByRole("button", { name: cancel, exact: true }).click();
  await dialog.waitFor();
  await dialog.getByRole("radio", { name: t("Mauvais détails, à ressaisir", "Wrong details, to record again") }).click();
  await dialog.getByRole("button", { name: cancel, exact: true }).click();
  const recordAgain = dialog.getByRole("button", { name: t("Enregistrer à nouveau", "Record again"), exact: true });
  await recordAgain.waitFor({ timeout: 15_000 });
  await recordAgain.click();
  const form = page.getByRole("dialog", { name: t("Enregistrer une dépense", "Record expense") });
  await form.waitFor();
  await page.waitForTimeout(300);
  await shot("record-again-form", { caption: `Wrong details: Record again opens pre-filled from ${second.entryNumber}`, highlight: form });
  await form.getByRole("button", { name: t("Enregistrer la dépense", "Record the expense"), exact: true }).click();
  await form.waitFor({ state: "hidden", timeout: 15_000 });

  const after = ((await apiGet("/v1/finance/entries")).body as { entries?: Row[] }).entries ?? [];
  const recorded = after.find((e) => !before.has(e.entryNumber) && e.reversesEntryId === null);
  if (recorded === undefined) throw new Error("the API lists no new entry after Record again");
  // No reload: the list itself has to pick the new entry up.
  const newRow = page.getByRole("button", { name: recorded.entryNumber, exact: true });
  await newRow.waitFor({ timeout: 10_000 });
  await quiet();
  await shot("recorded-again", {
    caption: `${recorded.entryNumber}, recorded again, is in the list without a reload`,
    highlight: page.getByRole("row").filter({ has: newRow }).first(),
  });
  log(`api cross-check: recorded again as ${recorded.entryNumber}; the list shows it without a reload`);
};

export default flow;
