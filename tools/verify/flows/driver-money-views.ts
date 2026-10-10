import { openSidebar, type DriveScript } from "../browser.js";

/**
 * A driver's money views say and hold expenses only (#593, #594). Sali's trip
 * page titles its money card "Expenses", so does the trip sheet's, her money
 * list holds expenses only (GET /v1/finance/entries), and VH001's readings
 * name her trip but not Boris's (GET /v1/assets/:id/readings).
 *
 * Precondition after a reseed, through real commands on VH001 in DLA: Sali
 * records an open trip with a start reading and a 20,000 XAF fuel expense on
 * it (`--role driver`); Boris records an open trip with a start reading and
 * 300,000 XAF of revenue on Sali's trip (`--role admin`).
 * Run: pnpm verify drive flow:driver-money-views --role driver --lang en --viewport 390x844 --reel
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet, nav }) => {
  type Trip = { id: string; activityNumber: string; status: string };
  const list = await apiGet("/v1/activities?limit=100");
  const own = ((list.body as { items?: Trip[] }).items ?? []).find((item) => item.status === "OPEN");
  if (list.status !== 200 || own === undefined) throw new Error(`GET /v1/activities → ${list.status}, no open trip of hers`);

  await (await openSidebar(page)).getByRole("link", { name: t("Trajets", "Trips") }).click();
  await page.getByRole("heading", { level: 1, name: t("Trajets", "Trips") }).waitFor();
  await quiet();
  await page.getByRole("button", { name: own.activityNumber, exact: true }).first().click();
  await page.waitForURL((url) => url.pathname === `/activities/${own.id}`);
  await quiet();

  const tripMoney = await apiGet(`/v1/activities/${own.id}`);
  const lines = (tripMoney.body as { financialEntries?: Array<{ direction: string }> | null }).financialEntries ?? [];
  if (lines.length === 0 || lines.some((line) => line.direction !== "EXPENSE")) {
    throw new Error(`trip money for the driver: ${JSON.stringify(lines)}`);
  }
  const costs = page.getByText(t("Dépenses", "Expenses"), { exact: true }).first();
  await costs.scrollIntoViewIfNeeded();
  if ((await page.getByText(t("Recettes et dépenses", "Revenue and expenses"), { exact: true }).count()) > 0) {
    throw new Error("the trip page still says revenue");
  }
  await shot("trip-costs", {
    caption: `Her trip ${own.activityNumber}: the money card is titled Expenses and lists her fuel only`,
    highlight: costs.locator("xpath=ancestor::*[@data-slot='card'][1]"),
  });

  await page.goBack();
  await page.getByRole("heading", { level: 1, name: t("Trajets", "Trips") }).waitFor();
  await page.getByRole("button", { name: t("Saisir une fiche", "Record a sheet") }).first().click();
  await quiet();
  const sheetCosts = page.getByText(t("Dépenses", "Expenses"), { exact: true }).first();
  await sheetCosts.scrollIntoViewIfNeeded();
  await shot("sheet-costs", {
    caption: "Her trip sheet's money card is titled Expenses too: she adds expenses only",
    highlight: sheetCosts.locator("xpath=ancestor::*[@data-slot='card'][1]"),
  });

  await nav("/finance/entries");
  await quiet();
  const entries = await apiGet("/v1/finance/entries?limit=100");
  const rows = (entries.body as { entries?: Array<{ entryNumber: string; direction: string }> }).entries ?? [];
  if (entries.status !== 200 || rows.some((row) => row.direction !== "EXPENSE")) {
    throw new Error(`GET /v1/finance/entries → ${entries.status}: ${rows.map((row) => row.direction).join(", ")}`);
  }
  log(`api: her money list holds ${rows.length} entries, all EXPENSE`);
  await shot("money-list", {
    caption: `Her money list: ${rows.length} expenses she recorded, no revenue`,
    highlight: page.getByRole("main"),
  });

  const assets = await apiGet("/v1/assets?limit=100");
  const truck = ((assets.body as { items?: Array<{ id: string; assetCode: string }> }).items ?? []).find(
    (asset) => asset.assetCode === "VH001",
  );
  if (truck === undefined) throw new Error("VH001 is not in her vehicles");
  const readings = await apiGet(`/v1/assets/${truck.id}/readings?limit=100`);
  const items =
    (readings.body as { items?: Array<{ activityId: string | null; activityNumber: string | null }> }).items ?? [];
  const named = items.filter((item) => item.activityNumber !== null);
  const foreign = named.filter((item) => item.activityId !== own.id);
  log(`api: VH001 readings ${items.length}, naming a trip ${named.length} (${named.map((item) => item.activityNumber).join(", ")})`);
  if (!named.some((item) => item.activityId === own.id)) throw new Error("her own reading lost its trip");
  if (foreign.length > 0) throw new Error(`readings name trips she cannot read: ${foreign.map((item) => item.activityNumber).join(", ")}`);

  await nav(`/assets/${truck.id}`);
  await quiet();
  await shot("vehicle", {
    caption: `VH001's readings name her trip ${own.activityNumber} and no other driver's`,
    highlight: page.getByRole("main"),
  });
};

export default flow;
