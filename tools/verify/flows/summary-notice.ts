import { openSidebar, type DriveScript } from "../browser.js";

/**
 * The summary notice on every module Overview (#667): Money, Trucks, Trips
 * and Maintenance. Each opens with it when it is due (Monday, the 1st, or a
 * big change: a vehicle grounded this week, expenses 20% above the
 * comparison); otherwise the tiles come first and the counted line sits under
 * them with "Show summary". Money's sentence is the server's template
 * (`GET /v1/finance/overview` `summary`) in words. On each page: due → open;
 * not due → closed with Show summary, which opens it; closing keeps it closed
 * after a reload. The Dashboard shows no summary today: the Dashboard round
 * removed it, and that removal waits on the owner's sign-off. Writes nothing
 * to the server (the close is stored on the device).
 * Run: pnpm verify drive flow:summary-notice --role director --lang en --reel
 *      (and --viewport 390x844)
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  const region = page.getByRole("region", { name: t("Résumé", "Summary") });
  const show = page.getByRole("button", { name: t("Afficher le résumé", "Show summary") });
  const close = page.getByRole("button", { name: t("Fermer le résumé", "Close the summary") });
  const counted = page.locator("[data-slot='overview-counted'][data-summary='closed']");

  type Notice = { today: string; schedule: string; scheduledOn: string | null; scheduledToday: string | null; changes: Array<{ kind: string; key: string }> };
  const noticeOf = async (route: string): Promise<Notice> => {
    const read = await apiGet(route);
    const notice = (read.body as { notice?: Notice }).notice;
    if (read.status !== 200 || notice === undefined) throw new Error(`GET ${route} → ${read.status} without a notice`);
    return notice;
  };
  const money = await apiGet("/v1/finance/overview");
  const summary = (money.body as { summary?: { template: string; measure: string; window: string } }).summary;
  if (money.status !== 200 || summary === undefined) throw new Error(`GET /v1/finance/overview → ${money.status} without a summary`);
  log(`api: money summary ${summary.template} (${summary.measure}, ${summary.window})`);

  // Waits on the owner: the Dashboard round removed the summary there; until they sign off, it shows none.
  await (await openSidebar(page)).getByRole("link", { name: t("Tableau de bord", "Dashboard"), exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.locator("[data-slot='dashboard-verdict']").waitFor();
  await quiet();
  if ((await region.count()) !== 0) throw new Error("the Dashboard shows a summary");
  if ((await show.count()) !== 0) throw new Error("the Dashboard offers Show summary");
  await shot("dashboard-no-summary", {
    caption: "The Dashboard leads with its verdict and shows no summary (that removal waits on the owner)",
    highlight: page.locator("[data-slot='dashboard-verdict']"),
  });

  const pages: Array<readonly [string, string, string, string]> = [
    ["Argent", "Money", "/finance", "/v1/finance/overview"],
    ["Camions", "Trucks", "/assets", "/v1/assets/overview"],
    ["Trajets", "Trips", "/activities", "/v1/activities/summary"],
    ["Maintenance", "Maintenance", "/maintenance", "/v1/maintenance/summary"],
  ];
  for (const [fr, en, path, route] of pages) {
    const name = en.toLowerCase();
    const notice = await noticeOf(route);
    const due = notice.schedule !== "NEVER" && (notice.scheduledToday !== null || notice.changes.length > 0);
    log(
      `api: ${route} → today ${notice.today}, ${notice.schedule}, scheduled ${notice.scheduledOn ?? "never"} ` +
        `(${notice.scheduledToday ?? "not today"}), changes ${notice.changes.map((change) => change.kind).join(", ") || "none"}`,
    );
    const open = async () => {
      await (await openSidebar(page)).getByRole("link", { name: t(fr, en), exact: true }).click();
      await page.waitForURL((url) => url.pathname === path);
      await page.locator("[data-slot='metric-strip']").waitFor();
      await quiet();
    };
    await open();

    if (due) {
      await region.waitFor();
      await shot(`${name}-notice-due`, {
        caption: `${en} Overview: due today, so the summary opens above the tiles with this page's own sentence`,
        highlight: region,
      });
    } else {
      if ((await region.count()) !== 0) throw new Error(`${en}: the summary shows on a day it is not due`);
      await counted.waitFor();
      await shot(`${name}-notice-hidden`, {
        caption: `${en} Overview: not due today, so the tiles come first and the counted line sits under them with Show summary`,
        highlight: counted,
      });
      await show.click();
      await region.waitFor();
      await shot(`${name}-notice-shown`, {
        caption: `${en} Overview: Show summary brings it back`,
        highlight: region,
      });
    }
    const sentence = (await region.locator("[data-slot='overview-summary-sentence']").textContent())?.trim();
    if (sentence === undefined || sentence === "") throw new Error(`${en}: the summary has no sentence`);
    log(`${en}: ${sentence}`);
    const strip = page.locator("[data-slot='metric-strip']");
    const regionBox = await region.boundingBox();
    const stripBox = await strip.boundingBox();
    if (regionBox === null || stripBox === null || regionBox.y >= stripBox.y) throw new Error(`${en}: the summary is not above the tiles`);

    await close.click();
    await region.waitFor({ state: "detached" });
    await counted.waitFor();
    await show.waitFor();
    await shot(`${name}-notice-closed`, {
      caption: `${en} Overview: closed, the tiles come first and the counted line stays under them`,
      highlight: counted,
    });

    await page.reload();
    await page.locator("[data-slot='metric-strip']").waitFor();
    await quiet();
    if ((await region.count()) !== 0) throw new Error(`${en}: the summary came back after a reload`);
    await show.waitFor();
    await shot(`${name}-notice-reload`, {
      caption: `${en} Overview: after a reload it stays closed for this person until the next one is due`,
      highlight: show,
    });
  }
};

export default flow;
