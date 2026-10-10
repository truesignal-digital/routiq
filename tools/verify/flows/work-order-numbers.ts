import { type DriveScript } from "../browser.js";

interface Row {
  id: string;
  assetCode?: string;
  status?: string;
  asset?: { id: string };
  issue?: { id: string } | null;
}

/**
 * How work orders and problems are named (#608). On the Maintenance queue, on
 * a truck's Maintenance tab and in the work-order panel ("From problem …").
 * Captures only, so the same script records the before (id fragments such as
 * 1E2D1747) and after (WO-0007 / PRB-0003, OT-0007 / PB-0003 in French) runs.
 * Read-only.
 * Run: pnpm verify drive flow:work-order-numbers --role admin --lang en --reel
 */
const flow: DriveScript = async ({ page, t, nav, shot, quiet, log, apiGet }) => {
  const orders = ((await apiGet("/v1/work-orders")).body as { items?: Row[] }).items ?? [];
  const order =
    orders.find((row) => row.issue != null && row.status === "APPROVED") ??
    orders.find((row) => row.issue != null) ??
    orders[0];
  if (order?.asset === undefined) throw new Error("no work order in the seed (reseed?)");
  log(`work order ${order.id} on asset ${order.asset.id}`);

  await nav("/maintenance");
  await quiet();
  const queue = page.getByRole("table").first();
  await shot("maintenance-queue", {
    caption: t("La file des ordres de travail, par numéro", "The work-order queue, each order by its number"),
    highlight: queue,
  });

  await nav(`/assets/${order.asset.id}/maintenance`);
  await quiet();
  await shot("vehicle-maintenance-tab", {
    caption: t("L'onglet Maintenance du camion", "The truck's Maintenance tab: work orders and problems by number"),
  });

  await nav(`/assets/${order.asset.id}/maintenance?panel=work_order:${order.id}`);
  const panel = page.getByRole("dialog").first();
  await panel.waitFor();
  await quiet();
  await shot("work-order-panel", {
    caption: t("Le panneau de l'ordre de travail et son problème", "The work-order panel names the order and the problem behind it"),
    highlight: panel,
  });
};

export default flow;
