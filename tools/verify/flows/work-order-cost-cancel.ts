import { openSidebar, type DriveScript } from "../browser.js";

/**
 * As Finance, cancel a posted work-order cost for wrong details (#559). Only
 * Direction, the Administrator and the technician book work-order costs
 * (#410, #414), so Cancel entry never offers Record again here: it says who
 * records it again and opens the work order. Once from the Money side panel,
 * once from the entry's full page. Each original reads back REVERSED for
 * WRONG_DETAILS, and nothing else was sent.
 * On a build that still offers Record again, the flow clicks it, records the
 * copy and stops on the server's 403, which is the bug.
 * Precondition after a reseed: a second posted work-order cost. Approve the
 * pending one through a real command as Direction:
 * `pnpm verify api POST /v1/commands/approve-entry --role director --json @body.json`
 * with `{ "version": 1, "envelope": {…}, "payload": { "entryId": "<DLA-2026-00006's id>" } }`.
 * Mutates the slot; reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:work-order-cost-cancel --role finance --lang en
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet, expectRefusal }) => {
  type Row = { id: string; entryNumber: string; reversesEntryId: string | null; links: { workOrderId: string | null } };
  const list = await apiGet("/v1/finance/entries?status=POSTED");
  const costs = ((list.body as { entries?: Row[] }).entries ?? []).filter(
    (e) => e.reversesEntryId === null && e.links.workOrderId !== null,
  );
  const [first, second] = costs;
  if (first === undefined || second === undefined) {
    throw new Error(`GET /v1/finance/entries?status=POSTED → ${list.status}, ${costs.length} posted work-order costs; need 2 (see the precondition)`);
  }
  log(`work-order costs: ${first.entryNumber} (side panel), ${second.entryNumber} (full page)`);

  const cancel = t("Annuler l'écriture", "Cancel entry");
  const dialog = page.getByRole("dialog", { name: cancel });
  const wrongDetails = t("Mauvais détails, à ressaisir", "Wrong details, to record again");
  const recordAgain = dialog.getByRole("button", { name: t("Enregistrer à nouveau", "Record again"), exact: true });
  const openWorkOrder = dialog.getByRole("button", { name: t("Ouvrir l'ordre de travail", "Open the work order"), exact: true });

  /** Wrong details → Cancel entry → the hand-off; on the old build, Record again → 403. */
  const cancelForWrongDetails = async (entry: Row, where: string) => {
    await dialog.waitFor();
    await dialog.getByRole("radio", { name: wrongDetails }).click();
    await page.waitForTimeout(300);
    await shot(`${where}-wrong-details`, {
      caption: `${where === "panel" ? "From the side panel" : "From the full page"}, Finance cancels ${entry.entryNumber}, a work-order cost, for wrong details`,
      highlight: dialog,
    });
    await dialog.getByRole("button", { name: cancel, exact: true }).click();
    await recordAgain.or(openWorkOrder).first().waitFor({ timeout: 15_000 });
    await quiet();

    if (await recordAgain.isVisible()) {
      await shot(`${where}-record-again-offered`, { caption: "Record again is offered to Finance", highlight: recordAgain });
      expectRefusal({ status: 403, url: /\/v1\/commands\/record-expense$/ });
      await recordAgain.click();
      const form = page.getByRole("dialog", { name: t("Enregistrer une dépense", "Record expense") });
      await form.waitFor();
      const refused = page.waitForResponse((r) => /\/v1\/commands\/record-expense$/.test(r.url()));
      await form.getByRole("button", { name: t("Enregistrer la dépense", "Record the expense"), exact: true }).click();
      const response = await refused;
      await page.waitForTimeout(500);
      await shot(`${where}-refused`, { caption: `The server refuses Finance's copy with ${response.status()}`, highlight: form });
      throw new Error(`Record again was offered and record-expense answered ${response.status()}`);
    }

    await shot(`${where}-hand-off`, {
      caption: "No Record again: it says who records it again and offers the work order",
      highlight: dialog,
    });
    const original = await apiGet(`/v1/finance/entries/${entry.id}`);
    const body = original.body as { status?: string; cancellation?: { reasonCode: string } | null };
    if (body.status !== "REVERSED" || body.cancellation?.reasonCode !== "WRONG_DETAILS") {
      throw new Error(`${entry.entryNumber} is ${body.status ?? original.status}, ${JSON.stringify(body.cancellation)}`);
    }
    log(`api cross-check: ${entry.entryNumber} is REVERSED for WRONG_DETAILS`);

    await openWorkOrder.click();
    await page.waitForURL((url) => url.pathname.endsWith("/maintenance") && url.search.includes(entry.links.workOrderId ?? "-"));
    await quiet();
    await shot(`${where}-work-order`, {
      caption: "Open the work order goes to the order the cost belongs to",
      highlight: page.getByRole("dialog").last(),
    });
  };

  // Money → the entry's side panel.
  await (await openSidebar(page)).getByRole("link", { name: t("Argent", "Money") }).click();
  await page.getByRole("heading", { level: 1, name: t("Argent", "Money") }).waitFor();
  await quiet();
  await page.getByRole("button", { name: first.entryNumber, exact: true }).click();
  const panel = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: first.entryNumber }) });
  await panel.getByRole("button", { name: cancel, exact: true }).click();
  await cancelForWrongDetails(first, "panel");

  // The entry's full page.
  await page.goto(new URL(`/finance/entries/${second.id}`, page.url()).toString());
  // The record page is titled with the entry's own number (#662).
  await page.getByRole("heading", { level: 1, name: second.entryNumber }).waitFor();
  await quiet();
  await page.getByRole("main").getByRole("button", { name: cancel, exact: true }).click();
  await cancelForWrongDetails(second, "page");

  // Nothing but the two cancellations went out: no copy for the server to refuse.
  const after = ((await apiGet("/v1/finance/entries")).body as { entries?: Row[] }).entries ?? [];
  const copies = after.filter((e) => e.reversesEntryId === null && e.links.workOrderId !== null && !costs.some((c) => c.id === e.id));
  if (copies.length !== 0) throw new Error(`${copies.length} new work-order entries appeared`);
  log("api cross-check: no new work-order entry after the two cancellations");
};

export default flow;
