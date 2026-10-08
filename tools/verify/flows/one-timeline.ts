import type { DriveScript } from "../browser.js";

/**
 * One timeline with decision notes (#308): VH003's approved work order is
 * cancelled from its record panel with a reason; the panel's chronology shows
 * the reason under the act, the panel's History button opens the record
 * history with the same note, and the vehicle's History tab shows it too.
 * Mutates the slot; reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:one-timeline --lang en
 */
const REASON = "Parts arrive next week, reopen then";

const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet, nav }) => {
  const assets = await apiGet("/v1/assets?search=VH003");
  const asset = ((assets.body as { items?: Array<{ id: string; assetCode: string }> }).items ?? []).find((a) => a.assetCode === "VH003");
  if (asset === undefined) throw new Error(`GET /v1/assets?search=VH003 → ${assets.status}`);
  const orders = await apiGet(`/v1/work-orders?assetId=${asset.id}`);
  const items = (orders.body as { items?: Array<{ id: string; status: string }> }).items ?? [];
  // A second run (another viewport or language) reads the order the first one cancelled.
  const order = items.find((o) => o.status === "APPROVED") ?? items.find((o) => o.status === "CANCELLED");
  if (order === undefined) throw new Error("no APPROVED or CANCELLED work order on VH003 (reseed?)");
  const cancelNow = order.status === "APPROVED";
  log(`work order ${order.id} (${order.status})`);

  await nav(`/assets/${asset.id}/maintenance?panel=work_order:${order.id}`);
  const panel = page.getByRole("dialog").last();
  await panel.waitFor();
  await quiet();
  const chronology = panel.getByRole("heading", { name: t("Chronologie", "Chronology") }).locator("xpath=..").locator("xpath=..");
  await shot("panel-before", { caption: "The work order's panel: its chronology and a History button", highlight: chronology });

  if (cancelNow) {
    await panel.getByRole("button", { name: new RegExp(`^${t("Annuler l'ordre", "Cancel order")}|^${t("Annuler l'ordre de travail", "Cancel work order")}`) }).first().click();
    const form = page.getByRole("dialog").last();
    await form.getByRole("textbox").first().fill(REASON);
    await shot("cancel-with-reason", { caption: "Cancelling asks for a reason" });
    await form.getByRole("button", { name: t("Annuler l'ordre de travail", "Cancel work order"), exact: true }).click();
    await page.getByText(REASON).first().waitFor({ timeout: 15_000 });
    await quiet();
  }

  const record = page.getByRole("dialog").last();
  const note = record.locator('[data-testid="timeline-event"]').filter({ hasText: REASON }).first();
  await note.waitFor();
  await note.scrollIntoViewIfNeeded();
  await shot("chronology-note", { caption: "The chronology shows the reason under “Work order cancelled”", highlight: note });

  await record.getByRole("button", { name: t("Historique", "History"), exact: true }).click();
  const sheet = page.getByRole("dialog", { name: t("Historique du dossier", "Record history") });
  await sheet.waitFor();
  await quiet();
  const sheetNote = sheet.locator('[data-testid="timeline-event"]').filter({ hasText: REASON }).first();
  await sheetNote.waitFor();
  await shot("history-sheet-note", { caption: "History opens from the panel and shows the same note", highlight: sheetNote });

  for (let i = 0; i < 3 && (await page.getByRole("dialog").count()) > 0; i += 1) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
  await page
    .getByRole("navigation", { name: t("Sections du véhicule", "Vehicle sections") })
    .getByRole("tab", { name: new RegExp(`^${t("Historique", "History")}`) })
    .click();
  await page.waitForURL((url) => url.pathname.endsWith("/history"));
  await quiet();
  const tabNote = page.locator('[data-testid="timeline-event"]').filter({ hasText: REASON }).first();
  await tabNote.waitFor();
  await shot("history-tab-note", { caption: "The vehicle's History tab renders the same timeline, note included", highlight: tabNote });

  const after = await apiGet(`/v1/work-orders/${order.id}`);
  const chronologie = (after.body as { chronologie?: Array<{ kind: string; note: string | null }> }).chronologie ?? [];
  const cancelled = chronologie.find((event) => event.kind === "work_order.cancelled");
  if (cancelled?.note !== REASON) throw new Error(`chronologie note is ${String(cancelled?.note)}`);
  log(`api cross-check: work_order.cancelled note = "${cancelled.note}"`);
};

export default flow;
