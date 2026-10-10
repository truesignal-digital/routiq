import { openSidebar, type DriveScript } from "../browser.js";

/**
 * A truck's Money numbers after cancellations (#472, #473), on VH001 as Finance.
 * With September locked, cancel its 85,000 repair so the cancellation posts in
 * October: October's Expenses by category nets negative and shows no share
 * (it read "-8500000%"). Then cancel July's fuel entry that had no receipt:
 * July's Missing receipts drops to 0 and the cancelled row asks for nothing.
 * September is locked through the command first (the Accounting months button
 * sends no version on develop today):
 *   pnpm verify api POST /v1/commands/lock-period --role finance --json '{"version":1,"envelope":{"commandId":"<uuid>","idempotencyKey":"<uuid>","origin":"HUMAN_UI","expectedVersion":1},"payload":{"periodCode":"2026-09"}}'
 * Mutates the slot; reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:vehicle-money-numbers --role finance --lang en
 */
const flow: DriveScript = async ({ page, t, nav, shot, quiet, log, apiGet }) => {
  const assets = await apiGet("/v1/assets?limit=100");
  const truck = ((assets.body as { items?: Array<{ id: string; assetCode: string }> }).items ?? []).find(
    (asset) => asset.assetCode === "VH001",
  );
  if (truck === undefined) throw new Error(`GET /v1/assets → ${assets.status}, no VH001 (reseed?)`);
  const ledger = await apiGet(`/v1/finance/entries?assetId=${truck.id}&status=POSTED&limit=100`);
  const posted = (ledger.body as { entries?: Array<{ id: string; entryNumber: string; economicDate: string; reversesEntryId: string | null }> }).entries ?? [];
  const repair = posted.find((entry) => entry.economicDate.startsWith("2026-09") && entry.reversesEntryId === null);
  const fuel = posted.find((entry) => entry.economicDate.startsWith("2026-07") && entry.reversesEntryId === null);
  if (repair === undefined || fuel === undefined) throw new Error("VH001 has no posted September and July entries (reseed?)");
  log(`VH001: September ${repair.entryNumber}, July ${fuel.entryNumber}`);

  const periods = await apiGet("/v1/finance/periods");
  const septemberStatus = ((periods.body as { periods?: Array<{ periodCode: string; status: string }> }).periods ?? []).find(
    (period) => period.periodCode === "2026-09",
  )?.status;
  if (septemberStatus !== "LOCKED") throw new Error(`September is ${septemberStatus ?? "missing"}: lock it first (see the header)`);

  await (await openSidebar(page)).getByRole("link", { name: t("Mois comptables", "Accounting months") }).click();
  await page.getByRole("heading", { level: 1, name: t("Mois comptables", "Accounting months") }).waitFor();
  await quiet();
  await shot("september-locked", {
    caption: "September is locked: cancelling a September entry posts in October",
    highlight: page.getByRole("row").filter({ hasText: "2026-09" }),
  });

  const cancelFromPanel = async (entryNumber: string, entryId: string, period: string) => {
    await nav(`/assets/${truck.id}/money?period=${period}&panel=entry:${entryId}`);
    const panel = page.getByRole("dialog").filter({ hasText: entryNumber });
    await panel.waitFor();
    await quiet();
    const cancel = t("Annuler l'écriture", "Cancel entry");
    await panel.getByRole("button", { name: cancel, exact: true }).click();
    // The form takes the panel's place: same dialog, now titled by the command.
    const form = page.getByRole("dialog").filter({ has: page.getByRole("radio") });
    await form.getByRole("radio", { name: t("Saisie en double", "Entered twice") }).click();
    await form.getByRole("button", { name: cancel, exact: true }).click();
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const read = await apiGet(`/v1/finance/entries/${entryId}`);
      if ((read.body as { status?: string }).status === "REVERSED") break;
      if (attempt === 29) throw new Error(`${entryNumber} is not REVERSED after Cancel entry`);
      await page.waitForTimeout(500);
    }
    await quiet();
    log(`cancelled ${entryNumber} from its panel`);
  };

  // Every check runs, so a run on the old code shows each wrong number in turn.
  const wrong: string[] = [];

  await cancelFromPanel(repair.entryNumber, repair.id, "2026-09");
  await nav(`/assets/${truck.id}/money?period=2026-10`);
  await page.getByRole("heading", { name: t("Argent · octobre 2026", "Money · October 2026") }).waitFor();
  await quiet();
  const categories = page.locator('[data-slot="card"]').filter({ hasText: t("Dépenses par catégorie", "Expenses by category") });
  await categories.waitFor();
  await shot("october-negative", {
    caption: `October nets −85,000 after cancelling ${repair.entryNumber}: no share is shown`,
    highlight: categories,
  });
  const share = (await categories.textContent()) ?? "";
  if (share.includes("%")) wrong.push(`October's category card shows a share: ${share}`);

  await nav(`/assets/${truck.id}/money?period=2026-07`);
  await page.getByRole("heading", { name: t("Argent · juillet 2026", "Money · July 2026") }).waitFor();
  await quiet();
  const fuelRow = page.getByRole("listitem").filter({ hasText: fuel.entryNumber });
  const missingTile = page.locator('[data-slot="metric-tile"][data-metric="missing"]');
  await shot("july-before-cancel", {
    caption: `${fuel.entryNumber} has no receipt, so July asks for it`,
    highlight: fuelRow,
  });

  await cancelFromPanel(fuel.entryNumber, fuel.id, "2026-07");
  await nav(`/assets/${truck.id}/money?period=2026-07`);
  await quiet();
  // From the top, so the tabs that stick on scroll do not cover the tile.
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot("july-tile-after-cancel", {
    caption: "July's Missing receipts no longer counts the cancelled entry",
    highlight: missingTile,
  });
  await shot("july-row-after-cancel", {
    caption: `Cancelled, ${fuel.entryNumber} no longer asks for its receipt`,
    highlight: fuelRow,
  });
  if ((await fuelRow.getByText(t("Sans reçu", "No receipt")).count()) > 0) {
    wrong.push(`${fuel.entryNumber} still shows No receipt after its cancellation`);
  }

  const july = await apiGet(`/v1/assets/${truck.id}/finance?periodCode=2026-07`);
  const missing = (july.body as { evidenceMissing?: { postedCount: number } }).evidenceMissing?.postedCount;
  if (missing !== 0) wrong.push(`July's posted missing receipts read ${missing ?? july.status}, not 0`);
  const october = await apiGet(`/v1/assets/${truck.id}/finance?periodCode=2026-10`);
  const byCategory = (october.body as { byCategory?: Array<{ code: string; expenseMinor: number }> }).byCategory ?? [];
  log(`api cross-check: July missing receipts ${missing}; October by category ${JSON.stringify(byCategory)}`);
  if (wrong.length > 0) throw new Error(wrong.join("; "));
};

export default flow;
