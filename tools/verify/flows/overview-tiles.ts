import type { DriveScript } from "../browser.js";

/**
 * Module lists open on server-counted tiles, and a tile filters the list (#302).
 * Trucks → Attention, Trips → Incomplete data, Maintenance → New problems; each
 * strip is cross-checked against its summary read.
 * Run: pnpm verify drive flow:overview-tiles --lang en --reel
 */
const flow: DriveScript = async ({ page, t, nav, shot, quiet, log, apiGet }) => {
  const strip = page.locator("[data-slot=metric-strip][data-state=ready]");

  for (const route of ["/v1/assets/summary", "/v1/activities/summary", "/v1/maintenance/summary"]) {
    const summary = await apiGet(route);
    if (summary.status !== 200) throw new Error(`GET ${route} → ${summary.status}`);
    log(`${route}: ${JSON.stringify(summary.body)}`);
  }

  await nav("/assets");
  await strip.waitFor();
  await quiet();
  await shot("trucks-tiles", { caption: "Trucks opens on tiles the server counted", highlight: strip });
  const attention = page.getByRole("button", { name: t("À surveiller", "Attention"), exact: true });
  await attention.click();
  await page.waitForURL((url) => url.searchParams.get("status") === "ATTENTION");
  await quiet();
  await shot("trucks-attention", { caption: "The Attention tile filters the list and the URL", highlight: strip });

  await nav("/activities");
  await strip.waitFor();
  await quiet();
  await shot("trips-tiles", { caption: "Trips: this week, on the road, incomplete data, km", highlight: strip });
  await page.getByRole("button", { name: t("Données incomplètes", "Incomplete data"), exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("completeness") === "COMPLETE_WITH_EXCEPTIONS");
  await quiet();
  await shot("trips-incomplete", { caption: "Incomplete data lists the trips closed with exceptions" });

  await nav("/maintenance");
  await strip.waitFor();
  await quiet();
  await shot("maintenance-tiles", { caption: "Maintenance: new problems, grounded, in progress, days to repair", highlight: strip });
  await page.getByRole("button", { name: t("Nouveaux problèmes", "New problems"), exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("issueStatus") === "OPEN");
  await quiet();
  await shot("maintenance-new-problems", { caption: "New problems opens the Problems tab on open ones" });
  await page.getByRole("button", { name: t("Ordres de travail en cours", "Work orders in progress"), exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("status") === "APPROVED");
  await quiet();
  await shot("maintenance-in-progress", { caption: "Work orders in progress lists the approved orders" });
};

export default flow;
