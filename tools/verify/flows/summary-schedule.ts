import { openSidebar, type DriveScript } from "../browser.js";

/**
 * Company settings › Dashboard summary (#669). Direction or an Administrator
 * (#711) picks when the summary notice shows on every Overview: every Monday and on the 1st (the
 * default), Mondays only, the 1st only, or never. Picks "Never: tiles only",
 * checks every Overview read follows it (`notice.schedule`), shows the
 * Dashboard opening on the tiles with "Show summary" still there, then puts
 * the default back. Writes two set-summary-schedule commands.
 * Run: pnpm verify drive flow:summary-schedule --role director --lang en --reel
 *      (and --viewport 390x844, or --role admin); as Finance, the Cashier, the
 *      Technician or a Driver, /more/company shows a denial.
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  type Notice = { schedule: string; scheduledOn: string | null; scheduledToday: string | null; changes: unknown[] };
  const noticeOf = async (route: string): Promise<Notice> => {
    const read = await apiGet(route);
    const notice = (read.body as { notice?: Notice }).notice;
    if (read.status !== 200 || notice === undefined) throw new Error(`GET ${route} → ${read.status} without a notice`);
    return notice;
  };
  const overviews = ["/v1/finance/overview", "/v1/assets/overview", "/v1/activities/summary", "/v1/maintenance/summary"];
  const expectSchedule = async (schedule: string) => {
    for (const route of overviews) {
      const notice = await noticeOf(route);
      if (notice.schedule !== schedule) throw new Error(`${route} notice follows ${notice.schedule}, not ${schedule}`);
      log(`api: ${route} → schedule ${notice.schedule}, scheduled ${notice.scheduledOn ?? "never"} (${notice.scheduledToday ?? "not today"}), ${notice.changes.length} changes`);
    }
  };

  const section = page.getByRole("region", { name: t("Résumé du tableau de bord", "Dashboard summary") });
  const openSettings = async () => {
    await (await openSidebar(page)).getByRole("link", { name: t("Paramètres de l'entreprise", "Company settings"), exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/more/company");
    await section.waitFor();
    await quiet();
  };
  const choose = async (fr: string, en: string) => {
    await section.getByRole("button", { name: t("Modifier le résumé du tableau de bord", "Change Dashboard summary") }).click();
    const sheet = page.getByRole("dialog");
    await sheet.waitFor();
    await sheet.getByText(t(fr, en), { exact: true }).click();
    return sheet;
  };

  const before = await apiGet("/v1/company-settings");
  log(`api: GET /v1/company-settings → ${before.status} ${JSON.stringify(before.body)}`);
  await expectSchedule("MONDAY_AND_MONTH_START");

  const region = page.getByRole("region", { name: t("Résumé", "Summary") });
  const openDashboard = async () => {
    await (await openSidebar(page)).getByRole("link", { name: t("Tableau de bord", "Dashboard"), exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/");
    await page.locator("[data-slot='metric-strip']").waitFor();
    await quiet();
  };
  const dueByDefault = (await noticeOf("/v1/finance/overview")).changes.length > 0;
  if (dueByDefault) {
    await openDashboard();
    await region.waitFor();
    await shot("dashboard-default", {
      caption: "On the default schedule, a big change (a truck grounded this week) opens the summary above the tiles",
      highlight: region,
    });
  }

  await openSettings();
  await shot("settings-default", {
    caption: "Company settings › Dashboard summary: by default the summary shows every Monday and on the 1st of the month",
    highlight: section,
  });

  const sheet = await choose("Jamais : les indicateurs seulement", "Never: tiles only");
  await shot("settings-form", {
    caption: "The Director or an Administrator picks one of four schedules for the whole company; the one in force is pinned above",
    highlight: sheet,
  });
  await sheet.getByRole("button", { name: t("Enregistrer", "Save"), exact: true }).click();
  await sheet.waitFor({ state: "detached" });
  await section.getByText(t("Jamais : les indicateurs seulement", "Never: tiles only"), { exact: true }).waitFor();
  await quiet();
  await shot("settings-never", {
    caption: "Saved through the set-summary-schedule command: Never, tiles only. Each person can still close it",
    highlight: section,
  });
  await expectSchedule("NEVER");

  await openDashboard();
  if ((await region.count()) !== 0) throw new Error("the summary opened on its own under Never");
  const show = page.getByRole("button", { name: t("Afficher le résumé", "Show summary") });
  await show.waitFor();
  await shot("dashboard-never", {
    caption: "Under Never the Dashboard opens on the tiles, even with the grounding; the counted line and Show summary stay under them",
    highlight: page.locator("[data-slot='overview-counted']"),
  });
  await show.click();
  await region.waitFor();
  await shot("dashboard-never-asked", {
    caption: "Show summary still opens it on request",
    highlight: region,
  });

  await openSettings();
  const back = await choose("Chaque lundi et le 1er du mois", "Every Monday and on the 1st of the month");
  await back.getByRole("button", { name: t("Enregistrer", "Save"), exact: true }).click();
  await back.waitFor({ state: "detached" });
  await section.getByText(t("Chaque lundi et le 1er du mois", "Every Monday and on the 1st of the month"), { exact: true }).waitFor();
  await quiet();
  await shot("settings-back-to-default", {
    caption: "Back to the default: every Monday and on the 1st of the month",
    highlight: section,
  });
  await expectSchedule("MONDAY_AND_MONTH_START");
};

export default flow;
