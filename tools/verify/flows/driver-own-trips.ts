import { openSidebar, type DriveScript } from "../browser.js";

/**
 * A driver's Trips list holds their own trips only (#545): recorded by them,
 * planned for them, or crewed by them as driver (ADR-0012 §3). Precondition:
 * Sali and Patrice each recorded one trip in Yaoundé, a branch both drive
 * for. Cross-checked against GET /v1/activities as the same driver.
 * Run: pnpm verify drive flow:driver-own-trips --role driver --lang en, then --role driver-yde
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet, account }) => {
  const list = await apiGet("/v1/activities?limit=100");
  if (list.status !== 200) throw new Error(`GET /v1/activities → ${list.status}`);
  const items =
    (list.body as { items?: Array<{ activityNumber: string; customerName: string | null }> }).items ?? [];
  log(`api: ${account.username} lists ${items.length} trip(s): ${items.map((item) => item.activityNumber).join(", ")}`);

  await (await openSidebar(page)).getByRole("link", { name: t("Trajets", "Trips") }).click();
  await page.getByRole("heading", { level: 1, name: t("Trajets", "Trips") }).waitFor();
  await quiet();

  const shown = [];
  for (const item of items) {
    const row = page.getByRole("button", { name: item.activityNumber, exact: true }).first();
    if ((await row.count()) === 0) throw new Error(`${item.activityNumber} is listed by the API but not on screen`);
    shown.push(item.activityNumber);
  }
  await shot("own-trips", {
    caption: `${account.displayName} sees ${items.length === 1 ? "one trip" : `${items.length} trips`}: ${
      items.map((item) => item.customerName ?? item.activityNumber).join(", ") || "none"
    }`,
    highlight: page.getByRole("main"),
  });
  log(`screen: ${shown.join(", ")}`);
};

export default flow;
