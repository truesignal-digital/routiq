import type { Page } from "playwright-core";
import { openSidebar, type DriveScript } from "../browser.js";

/**
 * Km and daily status (#668). As a manager (`--role director` or `admin`):
 * the Trucks Overview's on-the-road tile and fleet board match
 * `/v1/assets/usage`, and the board has a table view; the Money Overview
 * draws fuel per km by truck with the fleet median and flags the outlier the
 * Dashboard's To do names; the Dashboard shows cost per km; the Trips
 * Overview shows km driven empty and revenue per km by route; the
 * Maintenance Overview shows days off the road per month. As the technician
 * (`--role technician`): the board, km and days off the road, and no money.
 * Read-only. The demo seed has no closed trips this month; arrange some
 * through real commands first (trips with legs or odometer readings, fuel,
 * revenue), as the PR for #668 describes.
 * Run: pnpm verify drive flow:km-daily-status --role director --lang en --reel
 *      pnpm verify drive flow:km-daily-status --role technician --lang en --reel
 */
const flow: DriveScript = async (ctx) => {
  if (ctx.account.role === "TECHNICIAN") return technician(ctx);
  return manager(ctx);
};

type Ctx = Parameters<DriveScript>[0];

interface Usage {
  vehicles: Array<{ assetCode: string; days: string[]; money: { fuelAboveMedianPercent: number | null } | null }>;
  onTheRoad: { last: { tripDays: number; recordedDays: number } };
  money: { period: { costPerKmMinor: number | null }; fuelPerKmMedianMinor: number | null } | null;
  offRoadByMonth: Array<{ days: number }> | null;
  trips: { period: { emptyKm: number; loadedKm: number }; routes: Array<{ from: string; to: string }> } | null;
}

const digits = (text: string | null) => (text ?? "").replace(/\D/g, "");

function expectEqual(what: string, shown: string, read: number | string | null | undefined) {
  if (shown !== String(read)) throw new Error(`${what}: the page shows ${shown}, the read says ${read}`);
}

async function tileValue(page: Page, metric: string): Promise<string> {
  const value = page.locator(`[data-slot='metric-tile'][data-metric='${metric}'] [data-slot='metric-value']`);
  await value.waitFor();
  return digits(await value.textContent());
}

const percent = (part: number, whole: number) => (whole === 0 ? null : Math.round((part / whole) * 100));

async function openPage(ctx: Ctx, fr: string, en: string, path: string) {
  await (await openSidebar(ctx.page)).getByRole("link", { name: ctx.t(fr, en), exact: true }).click();
  await ctx.page.waitForURL((url) => url.pathname === path);
  await ctx.page.getByRole("heading", { level: 1, name: ctx.t(fr, en) }).waitFor();
}

async function usage(ctx: Ctx): Promise<Usage> {
  const reply = await ctx.apiGet("/v1/assets/usage");
  if (reply.status !== 200) throw new Error(`/v1/assets/usage answered ${reply.status}`);
  return reply.body as Usage;
}

async function trucks(ctx: Ctx, read: Usage) {
  const { page, shot, quiet, log } = ctx;
  await openPage(ctx, "Camions", "Trucks", "/assets");
  await quiet();
  const onTheRoad = percent(read.onTheRoad.last.tripDays, read.onTheRoad.last.recordedDays);
  log(`api: on the road ${onTheRoad}% (${read.onTheRoad.last.tripDays} of ${read.onTheRoad.last.recordedDays} recorded days)`);
  expectEqual("On the road", await tileValue(page, "on-the-road"), onTheRoad);
  const card = page.locator("[data-slot='fleet-board-card']");
  await card.scrollIntoViewIfNeeded();
  const rows = card.locator("[data-slot='fleet-board-row'], [data-slot='fleet-board-today-row']");
  await rows.first().waitFor();
  expectEqual("Board rows", String(await rows.count()), read.vehicles.length);
  await shot("trucks-board", {
    caption: "Trucks Overview: on the road over the last 30 days, and the fleet board, one row per truck, one cell per day",
    highlight: card,
  });
  const coverage = page.locator("[data-slot='km-coverage']");
  if ((await coverage.count()) > 0) {
    await shot("trucks-coverage", { caption: "What the km count and what they leave out: a trip with no km is named", highlight: coverage });
  }
  const toggle = card.locator("[data-slot='chart-view-toggle']");
  if (await toggle.isVisible()) {
    await toggle.click();
    await shot("trucks-board-table", { caption: "The board's table view: days on a trip, available, in the workshop, grounded, not recorded", highlight: card });
    await toggle.click();
  }
}

async function maintenance(ctx: Ctx, read: Usage) {
  const { page, shot, quiet } = ctx;
  await openPage(ctx, "Maintenance", "Maintenance", "/maintenance");
  await quiet();
  const card = page.locator("[data-slot='days-off-road']");
  await card.waitFor();
  const columns = card.locator("[data-slot='month-column']");
  expectEqual("Months", String(await columns.count()), read.offRoadByMonth?.length);
  await card.scrollIntoViewIfNeeded();
  await shot("maintenance-off-road", {
    caption: "Maintenance Overview: days off the road per month, truck-days in the workshop or grounded, this month partial",
    highlight: card,
  });
}

async function manager(ctx: Ctx) {
  const { page, t, shot, quiet, log } = ctx;
  const read = await usage(ctx);
  if (read.money === null) throw new Error("this role should read vehicle money");

  await trucks(ctx, read);

  // Money
  await openPage(ctx, "Argent", "Money", "/finance");
  await quiet();
  const fuel = page.locator("[data-slot='fuel-per-km-by-truck']");
  await fuel.waitFor();
  await fuel.scrollIntoViewIfNeeded();
  const outliers = read.vehicles.filter((vehicle) => vehicle.money?.fuelAboveMedianPercent != null);
  log(`api: fuel median ${read.money.fuelPerKmMedianMinor}, above it: ${outliers.map((vehicle) => vehicle.assetCode).join(", ")}`);
  for (const outlier of outliers) {
    await fuel.getByText(outlier.assetCode, { exact: true }).first().waitFor();
  }
  await shot("money-fuel-per-km", {
    caption: "Money Overview: fuel per km by truck against the fleet median; a truck more than 20% above it is flagged",
    highlight: fuel,
  });

  // Dashboard
  await openPage(ctx, "Tableau de bord", "Dashboard", "/");
  await quiet();
  const cost = page.locator("[data-slot='metric-tile'][data-metric='cost-per-km']");
  await cost.waitFor();
  expectEqual("Cost per km", await tileValue(page, "cost-per-km"), read.money.period.costPerKmMinor);
  await shot("dashboard-cost-per-km", {
    caption: "Dashboard: cost per km, expenses divided by known km, against the same days last month",
    highlight: cost,
  });
  await page
    .getByRole("navigation", { name: t("Sections du tableau de bord", "Dashboard sections") })
    .getByRole("tab", { name: new RegExp(`^${t("À faire", "To do")}`) })
    .click();
  await quiet();
  for (const outlier of outliers) {
    const row = page.locator("[data-slot='to-do-row']").filter({ hasText: outlier.assetCode }).filter({ hasText: t("carburant", "fuel") });
    await row.first().waitFor();
    await shot("dashboard-todo-fuel", { caption: `To do: ${outlier.assetCode} spends more on fuel per km than the fleet`, highlight: row.first() });
  }

  // Trips
  await openPage(ctx, "Trajets", "Trips", "/activities");
  await quiet();
  const empty = read.trips === null ? null : percent(read.trips.period.emptyKm, read.trips.period.emptyKm + read.trips.period.loadedKm);
  expectEqual("Km driven empty", await tileValue(page, "empty-km"), empty);
  const routes = page.locator("[data-slot='revenue-per-km-by-route']");
  await routes.waitFor();
  await routes.scrollIntoViewIfNeeded();
  await shot("trips-routes", {
    caption: "Trips Overview: km driven empty, and revenue per km by route, empty returns included",
    highlight: routes,
  });

  await maintenance(ctx, read);
}

async function technician(ctx: Ctx) {
  const { page, shot, log } = ctx;
  const read = await usage(ctx);
  if (read.money !== null) throw new Error("the technician must not read vehicle money");
  log("api: the technician's usage read carries no money");
  await maintenance(ctx, read);
  await trucks(ctx, read);
  const text = (await page.locator("main").textContent()) ?? "";
  const money = text.match(/(\d[\d\s]*)\s?(XAF|FCFA)\s?\/\s?km/i);
  if (money !== null) throw new Error(`the technician sees a money figure per km: ${money[0]}`);
  if (/revenue per km|fuel per km|cost per km/i.test(text)) throw new Error("the technician sees a per-km money chart");
  await shot("technician-no-money", { caption: "The technician sees the board and the km, never a cost or revenue per km" });
}

export default flow;
