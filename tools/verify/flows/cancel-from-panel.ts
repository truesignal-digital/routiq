import { openSidebar, type DriveScript } from "../browser.js";

/**
 * Cancel entry from the record panel (#525): Money → a posted entry's number →
 * the panel shows the trip it belongs to ("Trip DLA-…" with its space, #455) and
 * Cancel entry in its footer → the same dialog as the full page → reason
 * "Entered twice" → the entry reads back as REVERSED with that reason.
 * Mutates the slot; reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:cancel-from-panel --role finance --lang en
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  const list = await apiGet("/v1/finance/entries?status=POSTED");
  type Row = { id: string; entryNumber: string; reversesEntryId: string | null; links: { activityNumber: string | null } };
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
};

export default flow;
