import type { Page } from "playwright-core";
import { openSidebar, type DriveScript } from "../browser.js";

/**
 * Trucks, Trips and Maintenance open on an Overview tab (#665). As a manager:
 * each page opens on Overview, its tiles match the server's own counts
 * (`/v1/assets/overview`, `/v1/coming-up`, `/v1/activities/summary`,
 * `/v1/maintenance/summary`), and a tile or a To do button opens its tab
 * already filtered, the list matching the filtered read. As the technician
 * (`--role technician`): the app opens on the Maintenance Overview, and no
 * page names revenue or profit or reads money. Read-only.
 * Run: pnpm verify drive flow:module-overviews --role admin --lang en --reel
 *      pnpm verify drive flow:module-overviews --role technician --lang en --reel
 */
const flow: DriveScript = async (ctx) => {
  if (ctx.account.role === "TECHNICIAN") return technician(ctx);
  return manager(ctx);
};

type Ctx = Parameters<DriveScript>[0];

const digits = (text: string | null) => (text ?? "").replace(/\D/g, "");

async function tileValue(page: Page, metric: string): Promise<string> {
  const value = page.locator(`[data-slot='metric-tile'][data-metric='${metric}'] [data-slot='metric-value']`);
  await value.waitFor();
  return digits(await value.textContent());
}

function expectEqual(what: string, shown: string, read: number | null | undefined) {
  if (shown !== String(read)) throw new Error(`${what}: the page shows ${shown}, the read says ${read}`);
}

async function rowsShown(page: Page): Promise<number> {
  return page.locator("[data-slot='data-table'] tbody tr:visible, [data-slot='data-table-row']:visible").count();
}

async function openPage(ctx: Ctx, fr: string, en: string, path: string) {
  await (await openSidebar(ctx.page)).getByRole("link", { name: ctx.t(fr, en), exact: true }).click();
  await ctx.page.waitForURL((url) => url.pathname === path);
  await ctx.page.getByRole("heading", { level: 1, name: ctx.t(fr, en) }).waitFor();
}

async function assertTab(ctx: Ctx, name: RegExp) {
  const tab = ctx.page.locator("[data-slot='module-page-tabs']").getByRole("tab", { name });
  if ((await tab.getAttribute("aria-selected")) !== "true") throw new Error(`${name} is not the selected tab at ${ctx.page.url()}`);
}

async function manager(ctx: Ctx) {
  const { page, t, shot, quiet, log, apiGet } = ctx;

  // Trucks
  const fleet = (await apiGet("/v1/assets/overview")).body as {
    total: number;
    canDrive: number;
    grounded: { count: number } | null;
    idle: { count: number } | null;
  };
  const comingUp = (await apiGet("/v1/coming-up?days=30")).body as { rows: Array<{ code: string }> };
  const due = comingUp.rows.filter((row) => row.code === "DOCUMENT_DUE").length;
  log(`api: can drive ${fleet.canDrive}/${fleet.total}, grounded ${fleet.grounded?.count}, idle ${fleet.idle?.count}, documents due ${due}`);

  await openPage(ctx, "Camions", "Trucks", "/assets");
  await quiet();
  await assertTab(ctx, new RegExp(`^${t("Vue d'ensemble", "Overview")}`));
  expectEqual("Can drive", await tileValue(page, "can-drive"), fleet.canDrive);
  expectEqual("Grounded", await tileValue(page, "grounded"), fleet.grounded?.count);
  expectEqual("Idle", await tileValue(page, "idle"), fleet.idle?.count);
  expectEqual("Documents due", await tileValue(page, "documents-due"), due);
  await shot("trucks-overview", {
    caption: "Trucks opens on Overview: can drive, grounded, documents due and idle trucks, each counted by the server",
    highlight: page.locator("[data-slot='metric-strip']"),
  });
  const profit = page.locator("[data-slot='profit-by-truck']");
  if ((await profit.count()) > 0) {
    await shot("trucks-profit", {
      caption: "Profit by truck, losses first, for the roles that read profit; documents and services due beside it",
      highlight: profit,
    });
  }

  await page.locator("[data-metric='grounded'] a").click();
  await page.waitForURL((url) => url.pathname === "/assets/list" && url.searchParams.get("availability") === "GROUNDED");
  await quiet();
  await assertTab(ctx, new RegExp(`^${t("Camions", "Trucks")}`));
  const grounded = (await apiGet("/v1/assets?availability=GROUNDED")).body as { items: unknown[] };
  if ((await page.locator("[data-slot='metric-strip']").count()) !== 0) throw new Error("the Trucks tab still shows tiles");
  if ((await rowsShown(page)) !== grounded.items.length) {
    throw new Error(`Trucks tab lists ${await rowsShown(page)} rows, /v1/assets?availability=GROUNDED returns ${grounded.items.length}`);
  }
  await shot("trucks-grounded", {
    caption: "The Grounded tile opens the Trucks tab filtered to the grounded trucks, the same rule the tile counts",
    highlight: page.locator("[data-slot='data-table']"),
  });

  await page.locator("[data-slot='module-page-tabs']").getByRole("tab", { name: /^(Vue d'ensemble|Overview)/ }).click();
  await page.waitForURL((url) => url.pathname === "/assets");
  await page.locator("[data-metric='documents-due'] a").click();
  await page.waitForURL((url) => url.pathname === "/assets/documents" && url.searchParams.get("expiry") === "DUE_30");
  await quiet();
  if ((await rowsShown(page)) !== due) throw new Error(`Documents tab lists ${await rowsShown(page)} papers due, Coming up says ${due}`);
  await shot("trucks-documents", {
    caption: "Documents due opens the Documents tab on the papers due in 30 days, from the same Coming up read",
    highlight: page.locator("[data-slot='fleet-documents']"),
  });

  // Trips
  const trips = (await apiGet("/v1/activities/summary")).body as {
    weekClosed: number;
    open: number;
    incomplete: number;
    closedMissing: { fuel: number | null; km: number };
  };
  log(`api: trips closed this week ${trips.weekClosed}, open ${trips.open}, missing data ${trips.incomplete}, no fuel ${trips.closedMissing.fuel}, no km ${trips.closedMissing.km}`);
  await openPage(ctx, "Trajets", "Trips", "/activities");
  await quiet();
  expectEqual("Closed this week", await tileValue(page, "week-closed"), trips.weekClosed);
  expectEqual("Open", await tileValue(page, "open"), trips.open);
  expectEqual("Closed with missing data", await tileValue(page, "incomplete"), trips.incomplete);
  await shot("trips-overview", {
    caption: "Trips opens on Overview: closed, open, closed with missing data, km this week, and trips per week",
    highlight: page.locator("[data-slot='trips-overview']"),
  });
  const fuel = trips.closedMissing.fuel ?? 0;
  if (fuel > 0) {
    const row = page.locator("[data-slot='to-do-row']").filter({ hasText: t("sans carburant", "without fuel") });
    await shot("trips-todo", { caption: "To do: the open trips and the closed trips with no fuel, one button each", highlight: row });
    await row.getByRole("link").click();
    await page.waitForURL((url) => url.pathname === "/activities/list" && url.searchParams.get("missing") === "fuel");
    await quiet();
    const listed = (await apiGet("/v1/activities?missing=fuel")).body as { items: unknown[] };
    if ((await rowsShown(page)) !== listed.items.length) {
      throw new Error(`Trips tab lists ${await rowsShown(page)}, /v1/activities?missing=fuel returns ${listed.items.length}`);
    }
    await shot("trips-no-fuel", {
      caption: "The button opens the Trips tab on the closed trips with no fuel recorded",
      highlight: page.locator("[data-slot='data-table']"),
    });
  }

  // Maintenance
  const workshop = (await apiGet("/v1/maintenance/summary")).body as {
    openIssues: number;
    grounded: number;
    openWorkOrders: number;
    repairCost: { amountMinor: number } | null;
  };
  log(`api: new problems ${workshop.openIssues}, off the road ${workshop.grounded}, work orders open ${workshop.openWorkOrders}, repair cost ${workshop.repairCost?.amountMinor ?? "withheld"}`);
  await openPage(ctx, "Maintenance", "Maintenance", "/maintenance");
  await quiet();
  expectEqual("New problems", await tileValue(page, "new-problems"), workshop.openIssues);
  expectEqual("Off the road", await tileValue(page, "off-the-road"), workshop.grounded);
  expectEqual("Work orders open", await tileValue(page, "work-orders-open"), workshop.openWorkOrders);
  await shot("maintenance-overview", {
    caption: "Maintenance opens on Overview: new problems, off the road, work orders open, days to repair, repair cost",
    highlight: page.locator("[data-slot='maintenance-overview']"),
  });
  await page.locator("[data-metric='work-orders-open'] a").click();
  await page.waitForURL((url) => url.pathname === "/maintenance/work-orders" && url.searchParams.get("only") === "open");
  await quiet();
  const open = (await apiGet("/v1/work-orders?open=true")).body as { items: unknown[] };
  if ((await rowsShown(page)) !== open.items.length) {
    throw new Error(`Work orders tab lists ${await rowsShown(page)}, /v1/work-orders?open=true returns ${open.items.length}`);
  }
  await shot("maintenance-open-work-orders", {
    caption: "Work orders open opens the Work orders tab on the orders still open",
    highlight: page.locator("[data-slot='data-table']"),
  });
}

async function technician(ctx: Ctx) {
  const { page, shot, quiet } = ctx;
  const moneyReads: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/v1/finance")) moneyReads.push(path);
  });
  // Signing in lands on Home's address (the drive then visits My settings for
  // the language); the technician's Home is the workshop's Overview.
  await (await openSidebar(page)).getByRole("link", { name: ctx.t("Accueil", "Home"), exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/maintenance");
  await page.getByRole("heading", { level: 1, name: "Maintenance" }).waitFor();
  await page.locator("[data-slot='maintenance-overview'] [data-slot='metric-strip'][data-state='ready']").waitFor();
  await quiet();
  const noMoneyWords = async (where: string) => {
    const text = (await page.locator("main").textContent()) ?? "";
    if (/\b(revenue|profit|loss|recettes?|bénéfice|perte)\b/i.test(text)) throw new Error(`${where} names revenue or profit for the technician`);
  };
  await noMoneyWords("Maintenance");
  await shot("technician-maintenance", {
    caption: "The technician opens on the Maintenance Overview: repair cost from work orders, no revenue, no profit",
    highlight: page.locator("[data-slot='metric-strip']"),
  });
  await openPage(ctx, "Camions", "Trucks", "/assets");
  await page.locator("[data-slot='trucks-overview'] [data-slot='metric-strip'][data-state='ready']").waitFor();
  await quiet();
  await noMoneyWords("Trucks");
  if ((await page.locator("[data-slot='profit-by-truck']").count()) !== 0) throw new Error("the technician sees profit by truck");
  if (moneyReads.length > 0) throw new Error(`the technician's pages read money: ${moneyReads.join(", ")}`);
  await shot("technician-trucks", {
    caption: "The technician's Trucks Overview: availability and papers due, no profit by truck and no money read",
    highlight: page.locator("[data-slot='trucks-overview']"),
  });
}

export default flow;
