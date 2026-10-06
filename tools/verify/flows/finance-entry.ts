import { openSidebar, type DriveScript } from "../browser.js";

/**
 * Finance → Entries → the newest posted entry's drawer → "Open full screen"
 * detail page, with a read-only API cross-check of the same entry.
 * Run: pnpm verify drive flow:finance-entry --role finance --lang en
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  const list = await apiGet("/v1/finance/entries?status=POSTED");
  const entries = (list.body as { entries?: Array<{ id: string; entryNumber: string }> }).entries ?? [];
  const entry = entries[0];
  if (list.status !== 200 || entry === undefined) throw new Error(`GET /v1/finance/entries?status=POSTED → ${list.status}, ${entries.length} entries`);
  log(`api: ${entries.length} posted entries; opening ${entry.entryNumber}`);

  const sidebar = await openSidebar(page);
  await sidebar.getByRole("link", { name: t("Finances", "Finance") }).click();
  await page.getByRole("heading", { level: 1, name: t("Écritures comptables", "Entries") }).waitFor();
  await quiet();
  await shot("entries-list", { caption: "Finance entries list" });

  await page.getByRole("button", { name: entry.entryNumber, exact: true }).first().click();
  const drawer = page.getByRole("dialog");
  await drawer.waitFor();
  await quiet();
  await shot("entry-drawer", { caption: "An entry opens in the side panel from the list" });

  await drawer.getByRole("button", { name: t("Ouvrir en plein écran", "Open full screen") }).click();
  await page.waitForURL((url) => url.pathname === `/finance/entries/${entry.id}`);
  await page.getByRole("heading", { level: 1, name: t("Détail de l'écriture", "Entry detail") }).waitFor();
  await quiet();
  await shot("entry-detail", { caption: "Open full screen shows the entry's detail page" });

  const detail = await apiGet(`/v1/finance/entries/${entry.id}`);
  const body = detail.body as { entryNumber?: string; status?: string; amountMinor?: number; currency?: string };
  if (detail.status !== 200 || body.entryNumber !== entry.entryNumber) throw new Error(`GET /v1/finance/entries/${entry.id} → ${detail.status}`);
  log(`api cross-check: ${body.entryNumber} ${body.status ?? "?"} ${body.amountMinor ?? "?"} ${body.currency ?? ""}`);
};

export default flow;
