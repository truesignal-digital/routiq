import type { DriveScript } from "../browser.js";

/**
 * Trips list → the closed Douala → Garoua trip, cross-checked with GET /v1/activities/:id.
 * Run: pnpm verify drive flow:trips --role manager --lang en
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  const list = await apiGet("/v1/activities");
  const items = (list.body as { items?: Array<{ id: string; activityNumber: string; status: string }> }).items ?? [];
  const trip = items.find((item) => item.status === "CLOSED");
  if (list.status !== 200 || trip === undefined) throw new Error(`GET /v1/activities → ${list.status}, no closed trip`);

  await page.getByRole("navigation", { name: "Navigation" }).getByRole("link", { name: t("Trajets", "Trips") }).click();
  await page.getByRole("heading", { level: 1, name: t("Trajets", "Trips") }).waitFor();
  await quiet();
  await shot("trips-list");

  await page.getByRole("button", { name: trip.activityNumber, exact: true }).first().click();
  await page.waitForURL((url) => url.pathname === `/activities/${trip.id}`);
  await page.getByRole("heading", { level: 1, name: trip.activityNumber }).waitFor();
  await quiet();
  await shot("trip-detail");

  const detail = await apiGet(`/v1/activities/${trip.id}`);
  const body = detail.body as { status?: string; completeness?: string };
  if (detail.status !== 200) throw new Error(`GET /v1/activities/${trip.id} → ${detail.status}`);
  log(`api cross-check: ${trip.activityNumber} ${body.status ?? "?"} ${body.completeness ?? ""}`);
};

export default flow;
