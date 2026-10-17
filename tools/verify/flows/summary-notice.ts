import { openSidebar, type DriveScript } from "../browser.js";

/**
 * The summary notice on every Overview (#667). The Dashboard opens with it
 * when it is due (Monday, the 1st, or a big change: a vehicle grounded this
 * week, expenses 20% above the comparison); otherwise the tiles come first
 * and the counted line sits under them with "Show summary". Its sentence is
 * the server's template (`GET /v1/finance/overview` `summary`) in words.
 * Closing it keeps it closed after a reload; the same notice opens on Money,
 * Trucks, Trips and Maintenance. Writes nothing to the server (the close is
 * stored on the device).
 * Run: pnpm verify drive flow:summary-notice --role director --lang en --reel
 *      (and --viewport 390x844)
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  const region = page.getByRole("region", { name: t("Résumé", "Summary") });
  const show = page.getByRole("button", { name: t("Afficher le résumé", "Show summary") });
  const close = page.getByRole("button", { name: t("Fermer le résumé", "Close the summary") });

  type Notice = { today: string; schedule: string; scheduledOn: string | null; scheduledToday: string | null; changes: Array<{ kind: string; key: string }> };
  const read = await apiGet("/v1/finance/overview");
  const body = read.body as { summary?: { template: string; measure: string; window: string }; notice?: Notice };
  if (read.status !== 200 || body.summary === undefined || body.notice === undefined) {
    throw new Error(`GET /v1/finance/overview → ${read.status} without a summary and notice`);
  }
  const due = body.notice.schedule !== "NEVER" && (body.notice.scheduledToday !== null || body.notice.changes.length > 0);
  log(
    `api: summary ${body.summary.template} (${body.summary.measure}, ${body.summary.window}); today ${body.notice.today}, ` +
      `${body.notice.schedule}, scheduled ${body.notice.scheduledOn ?? "never"} (${body.notice.scheduledToday ?? "not today"}), changes ${body.notice.changes.map((change) => change.kind).join(", ") || "none"}`,
  );

  await (await openSidebar(page)).getByRole("link", { name: t("Tableau de bord", "Dashboard"), exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.locator("[data-slot='metric-strip']").waitFor();
  await quiet();

  if (due) {
    await region.waitFor();
    await shot("dashboard-notice-due", {
      caption: "Due today, so the summary opens above the tiles: one sentence from the server's template, and what it counted",
      highlight: region,
    });
  } else {
    if ((await region.count()) !== 0) throw new Error("the summary shows on a day it is not due");
    await shot("dashboard-notice-hidden", {
      caption: "Not due today: the tiles come first, the counted line sits under them with Show summary",
      highlight: page.locator("[data-slot='overview-counted']"),
    });
    await show.click();
    await region.waitFor();
    await shot("dashboard-notice-shown", {
      caption: "Show summary brings it back: the month in one whole sentence, the biggest change, and what was counted",
      highlight: region,
    });
  }

  await close.click();
  await region.waitFor({ state: "detached" });
  await show.waitFor();
  await shot("dashboard-notice-closed", {
    caption: "Closed: tiles first, and the counted line stays under them so missing data is never hidden",
    highlight: page.locator("[data-slot='overview-counted']"),
  });

  await page.reload();
  await page.locator("[data-slot='metric-strip']").waitFor();
  await quiet();
  if ((await region.count()) !== 0) throw new Error("the summary came back after a reload");
  await show.waitFor();
  await shot("dashboard-notice-reload", {
    caption: "After a reload it stays closed for this person until the next scheduled one",
    highlight: show,
  });

  // The same notice on every module Overview.
  const pages: Array<readonly [string, string, string]> = [
    ["Finances", "Money", "/finance"],
    ["Camions", "Trucks", "/assets"],
    ["Trajets", "Trips", "/activities"],
    ["Maintenance", "Maintenance", "/maintenance"],
  ];
  for (const [fr, en, path] of pages) {
    await (await openSidebar(page)).getByRole("link", { name: t(fr, en), exact: true }).click();
    await page.waitForURL((url) => url.pathname === path);
    await page.locator("[data-slot='metric-strip']").waitFor();
    await quiet();
    if ((await region.count()) === 0) await show.click();
    await region.waitFor();
    const sentence = (await region.locator("[data-slot='overview-summary-sentence']").textContent())?.trim();
    log(`${en}: ${sentence}`);
    await shot(`${en.toLowerCase()}-notice`, {
      caption: `${en} Overview: the same notice, with this page's own sentence and what it counted`,
      highlight: region,
    });
  }
};

export default flow;
