import type { DriveScript } from "../browser.js";

interface WorkOrderRead {
  id: string;
  description: string;
  asset: { id: string; assetCode: string };
  actualCostMinor: number | null;
}

const ORDER = "A/C recharge and leak check";

/**
 * A work order's costs on /maintenance and in the vehicle panel (#640, #642,
 * #643), on VH001's completed A/C repair. Captures only, so the same script
 * records the before and after runs side by side.
 *
 * With FINANCE on, as the DLA cashier (branch-limited): the sheet's Costs list
 * holds the line awaiting review among the others (#642), and one line sums
 * what the Yaoundé agency booked (#643), so the list adds up to the Actual
 * cost. With FINANCE off, as Direction: the queue keeps Expected cost and
 * drops the Actual cost column instead of "Not recorded", and the sheet keeps
 * the estimate (#640).
 *
 * Preconditions (vendor and api CLIs): on the work order, a 15,000 expense
 * booked to YDE by Direction and a 120,000 one booked to DLA by the technician
 * (it waits for review). For the FINANCE-off run, turn FINANCE off with the
 * entitlement CLI (features/settings.md).
 * Run: pnpm verify drive flow:work-order-costs --role cashier --lang en --reel
 *      pnpm verify drive flow:work-order-costs --role director --lang en --reel   (FINANCE off)
 */
const flow: DriveScript = async ({ page, t, nav, shot, quiet, log, apiGet }) => {
  const me = (await apiGet("/v1/me")).body as { enabledModules?: string[] };
  const finance = me.enabledModules?.includes("FINANCE") ?? false;
  log(`FINANCE ${finance ? "on" : "off"}`);

  const orders = (await apiGet("/v1/work-orders")).body as { items?: WorkOrderRead[] };
  const order = (orders.items ?? []).find((o) => o.description === ORDER);
  if (order === undefined) throw new Error(`no "${ORDER}" work order (reseed?)`);
  log(`api: actualCostMinor ${String(order.actualCostMinor)}`);

  // The cashier has no Maintenance row; the queue is still theirs to read.
  await nav("/maintenance");
  const table = page.getByRole("table").first();
  await table.waitFor();
  await quiet();
  await page.waitForTimeout(600);
  const headers = await table.getByRole("columnheader").allTextContents();
  log(`columns: ${headers.join(" | ")}`);
  await shot("queue", {
    caption: finance
      ? "The work-order queue"
      : "FINANCE off: which cost columns does the queue show?",
    highlight: table,
  });

  await table.getByRole("row").filter({ hasText: ORDER }).first().getByRole("button").first().click();
  const sheet = page.getByRole("dialog").last();
  await sheet.waitFor();
  await quiet();
  await page.waitForTimeout(600);
  await shot("sheet-facts", {
    caption: finance ? "The A/C repair: Actual cost" : "FINANCE off: is the estimate still there?",
    highlight: sheet.locator("dl").first(),
  });
  if (!finance) return;

  const costs = sheet.getByRole("heading", { name: /^(Costs|Posted costs|Coûts|Coûts comptabilisés)$/ }).first();
  await costs.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await shot("sheet-costs", {
    caption: "Does the costs list add up to the Actual cost, with the line awaiting review and other branches?",
    highlight: costs.locator("xpath=ancestor::div[1]"),
  });

  await page.keyboard.press("Escape");
  await nav(`/assets/${order.asset.id}?panel=work_order:${order.id}`);
  const panel = page.getByRole("dialog").last();
  const panelCosts = panel.getByRole("heading", { name: t("Coûts", "Costs"), exact: true });
  await panelCosts.waitFor({ timeout: 30_000 });
  await panelCosts.scrollIntoViewIfNeeded();
  await quiet();
  await page.waitForTimeout(600);
  await shot("panel-costs", {
    caption: "The vehicle panel's Costs: does it count what other branches booked?",
    highlight: panelCosts.locator("xpath=ancestor::section[1]"),
  });
};

export default flow;
