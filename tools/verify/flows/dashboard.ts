import { openSidebar, type DriveScript } from "../browser.js";

/**
 * Home is the Dashboard (#666). Direction, finance and administrators get its
 * tabs, Overview · To do · Profit by truck · Profit by branch, under one
 * header. The Overview's tiles match `GET /v1/finance/overview` and
 * `GET /v1/assets/overview`, the profit bridge adds up from last month's profit
 * to this month's, To do and Coming up count the whole Branch Scope, and the
 * range rides along from tab to tab. On a phone the tiles go two by two, To do
 * comes before the charts, the bridge is a list and the trucks card is "Trucks
 * at a loss". The cashier, the workshop and the driver keep Home's tiles: no
 * tabs, no money read. Read-only.
 * Run: pnpm verify drive flow:dashboard --role director --lang en --reel
 *      (and --viewport 390x844; --role cashier for the roles without it)
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet, account }) => {
  const digits = (text: string | null) => (text ?? "").replace(/\D/g, "");
  const phone = (page.viewportSize()?.width ?? 1440) < 768;
  const heading = page.getByRole("heading", { level: 1, name: t("Tableau de bord", "Dashboard") });
  const tabs = page.getByRole("navigation", { name: t("Sections du tableau de bord", "Dashboard sections") });
  const tab = (fr: string, en: string) => tabs.getByRole("tab", { name: new RegExp(`^${t(fr, en)}`) });

  await (await openSidebar(page)).getByRole("link", { name: t("Tableau de bord", "Dashboard"), exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await heading.waitFor();
  await quiet();

  if (!["DIRECTOR", "ADMIN", "FINANCE"].includes(account.role)) {
    if ((await tabs.count()) !== 0) throw new Error(`${account.role} sees the Dashboard's tabs`);
    await shot("home-without-overview", {
      caption: `${account.role === "DRIVER" ? "The driver" : account.role === "CASHIER" ? "The cashier" : "The workshop"} keeps Home's tiles: no Overview, no profit, no tabs`,
    });
    return;
  }

  type Window = { from: string; to: string; revenueMinor: number; expenseMinor: number; profitMinor: number | null };
  const read = await apiGet("/v1/finance/overview?range=TWELVE_MONTHS");
  const overview = read.body as {
    period?: Window;
    comparison?: Window;
    vehicles?: Array<{ assetCode: string }> | null;
    branches?: Array<{ name: string }> | null;
  };
  if (read.status !== 200 || overview.period === undefined || overview.comparison === undefined) {
    throw new Error(`GET /v1/finance/overview → ${read.status}`);
  }
  const fleet = (await apiGet("/v1/assets/overview")).body as { total?: number; canDrive?: number };
  const todo = (await apiGet("/v1/todo")).body as { totalCount?: number; rows?: unknown[] };
  log(
    `api: 12 months revenue ${overview.period.revenueMinor}, expenses ${overview.period.expenseMinor}, profit ${overview.period.profitMinor}; ` +
      `can drive ${fleet.canDrive} of ${fleet.total}; to do ${todo.totalCount}`,
  );

  const tabNames = (await tabs.getByRole("tab").allTextContents()).map((name) => name.replace(/\d+$/, ""));
  log(`tabs: ${tabNames.join(" | ")}`);
  await page.locator("[data-metric='canDrive'] [data-slot='metric-value']").waitFor();
  const canDrive = (await page.locator("[data-metric='canDrive'] [data-slot='metric-value']").textContent())?.trim();
  if (canDrive !== t(`${fleet.canDrive} sur ${fleet.total}`, `${fleet.canDrive} of ${fleet.total}`)) {
    throw new Error(`can-drive tile shows ${canDrive}, assets overview says ${fleet.canDrive} of ${fleet.total}`);
  }
  await shot("overview", {
    caption: "Home is the Dashboard: Overview, To do, Profit by truck, Profit by branch; tiles against the same days last month",
    highlight: page.locator("[data-slot='metric-strip']"),
  });

  // Twelve closed months against the twelve before: the range with the demo's money in it.
  await page.getByRole("radio", { name: t("12 mois", "12 months") }).click();
  await page.waitForURL((url) => url.searchParams.get("range") === "12-months");
  await quiet();
  // A company with no revenue in the read (an internal fleet) gets its costs and no profit anywhere.
  const mode = await page.locator("[data-slot='dashboard-overview']").getAttribute("data-mode");
  const checks: Array<readonly [string, number]> =
    mode === "profit"
      ? [["revenue", overview.period.revenueMinor], ["expenses", overview.period.expenseMinor], ["profit", overview.period.profitMinor ?? 0]]
      : [["expenses", overview.period.expenseMinor]];
  for (const [metric, minor] of checks) {
    const shown = digits(await page.locator(`[data-metric='${metric}'] [data-slot='metric-value']`).textContent());
    if (shown !== String(Math.abs(minor))) throw new Error(`${metric} tile shows ${shown}, overview read says ${minor}`);
  }
  log(`api cross-check (${mode} view): ${checks.map(([metric]) => metric).join(", ")} tiles = GET /v1/finance/overview?range=TWELVE_MONTHS`);
  if (mode !== "profit") {
    const main = (await page.locator("main").textContent()) ?? "";
    if (/\b(profit|loss|bénéfice|perte)\b/i.test(main.replace(/Profit by (truck|vehicle|branch)|Bénéfice par (camion|véhicule|agence)/g, ""))) {
      throw new Error("the costs view names a profit or loss");
    }
    await shot("overview-costs", {
      caption: "No revenue recorded here: expenses, vehicle costs and company costs, and no profit anywhere",
      highlight: page.locator("[data-slot='metric-strip']"),
    });
    return;
  }
  await shot("overview-12-months", {
    caption: "12 months: revenue, expenses and profit match the overview read; profit says its share of revenue",
    highlight: page.locator("[data-metric='profit']"),
  });

  const why = page.locator("[data-slot='dashboard-why']");
  if (!phone) await why.getByRole("button", { name: t("Tableau", "Table") }).click();
  const rows = why.locator("[data-slot='profit-bridge-row']");
  await rows.first().waitFor();
  const values = await rows.evaluateAll((nodes) =>
    nodes.map((node) => {
      const text = node.querySelector("dd")?.textContent ?? "";
      const amount = Number(text.replace(/\D/g, ""));
      const negative = /[−-]|(Loss|Perte)/.test(text);
      return negative ? -amount : amount;
    }),
  );
  const start = values[0] ?? 0;
  const end = values[values.length - 1] ?? 0;
  const changes = values.slice(1, -1).reduce((sum, value) => sum + value, 0);
  if (start + changes !== end || end !== (overview.period.profitMinor ?? 0) || start !== (overview.comparison.profitMinor ?? 0)) {
    throw new Error(`bridge: ${start} + ${changes} ≠ ${end} (read: ${overview.comparison.profitMinor} → ${overview.period.profitMinor})`);
  }
  log(`bridge adds up: ${start} + (${values.slice(1, -1).join(" ")}) = ${end}`);
  await why.scrollIntoViewIfNeeded();
  await shot("bridge", {
    caption: phone
      ? "On a phone the bridge is a list that adds up, from last period's profit to this one's"
      : "What changed the profit, as its table: revenue, each expense category, company costs; it adds up exactly",
    highlight: why,
  });

  const vehicles = page.locator("[data-slot='dashboard-vehicles-card']");
  await vehicles.scrollIntoViewIfNeeded();
  await shot("trucks", {
    caption: phone
      ? "On a phone: Trucks at a loss, worst first; the full table is the next tab"
      : "Profit by truck, losses first, then all trucks − company costs = company profit",
    highlight: vehicles,
  });

  const lower = page.locator("[data-slot='dashboard-branches-card']");
  await lower.scrollIntoViewIfNeeded();
  await shot("branches-coming-up", {
    caption: "Truck profit by branch (company costs not split) and Coming up for the next 14 days",
    highlight: lower,
  });

  await tab("À faire", "To do").click();
  await page.waitForURL((url) => url.pathname === "/to-do");
  await page.locator("[data-slot='dashboard-todo'] [data-slot='to-do-row']").first().waitFor();
  const listed = await page.locator("[data-slot='dashboard-todo'] [data-slot='to-do-row']").count();
  if (listed !== (todo.rows ?? []).length) throw new Error(`To do lists ${listed} rows, GET /v1/todo has ${(todo.rows ?? []).length}`);
  await shot("to-do", {
    caption: `To do lists every row (${listed}), safety first, each with its one button`,
    highlight: page.locator("[data-slot='dashboard-todo']"),
  });

  await tab("Bénéfice par camion", "Profit by truck").click();
  await page.waitForURL((url) => url.pathname === "/profit-by-vehicle" && url.searchParams.get("range") === "12-months");
  await page.locator("[data-slot='company-lines']").waitFor();
  await quiet();
  await shot("profit-by-truck", {
    caption: "Profit by truck: the full table for the range, and the lines down to company profit",
  });

  await tab("Bénéfice par agence", "Profit by branch").click();
  await page.waitForURL((url) => url.pathname === "/profit-by-branch");
  await page.locator("[data-slot='company-costs-note']").waitFor();
  await quiet();
  const branchRows = (overview.branches ?? []).length;
  log(`branches in the read: ${branchRows}`);
  await shot("profit-by-branch", {
    caption: "Profit by branch: each branch's trucks, revenue, expenses and truck profit",
  });
};

export default flow;
