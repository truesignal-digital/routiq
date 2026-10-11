import { openSidebar, type DriveScript } from "../browser.js";

/**
 * One can-drive count (#699): the Dashboard's tile and the Trucks Overview's
 * tile show the same count out of the same fleet, both from
 * `GET /v1/assets/overview` in the caller's branch scope. Read-only.
 * Run: pnpm verify drive flow:can-drive --role director --lang en --reel
 *      (and --role admin-yde for one branch; --viewport 390x844)
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  const read = await apiGet("/v1/assets/overview");
  const fleet = read.body as { total?: number; canDrive?: number };
  if (read.status !== 200 || fleet.total === undefined || fleet.canDrive === undefined) {
    throw new Error(`GET /v1/assets/overview → ${read.status}`);
  }
  log(`api: can drive ${fleet.canDrive} of ${fleet.total}`);
  const value = (metric: string) =>
    page.locator(`[data-slot='metric-tile'][data-metric='${metric}'] [data-slot='metric-value']`);
  const tile = (metric: string) => page.locator(`[data-slot='metric-tile'][data-metric='${metric}']`);
  const said = t(`${fleet.canDrive} sur ${fleet.total}`, `${fleet.canDrive} of ${fleet.total}`);

  await (await openSidebar(page)).getByRole("link", { name: t("Tableau de bord", "Dashboard"), exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await value("canDrive").waitFor();
  await quiet();
  const dashboard = (await value("canDrive").textContent())?.replace(/\s/g, " ").trim();
  if (dashboard !== said) throw new Error(`Dashboard tile shows ${dashboard}, the read says ${said}`);
  log(`Dashboard tile: ${dashboard} · ${(await tile("canDrive").textContent())?.trim()}`);
  await tile("canDrive").scrollIntoViewIfNeeded();
  await shot("dashboard-can-drive", {
    caption: `Dashboard: ${said} can drive, out of the fleet not sold, retired or written off`,
    highlight: tile("canDrive"),
  });

  await (await openSidebar(page)).getByRole("link", { name: t("Camions", "Trucks"), exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/assets");
  await value("can-drive").waitFor();
  await quiet();
  const count = (await value("can-drive").textContent())?.replace(/\D/g, "");
  const hint = (await tile("can-drive").textContent()) ?? "";
  if (count !== String(fleet.canDrive)) throw new Error(`Trucks tile shows ${count}, the read says ${fleet.canDrive}`);
  if (!hint.includes(t(`sur ${fleet.total}`, `of ${fleet.total}`))) {
    throw new Error(`Trucks tile "${hint}" does not say out of ${fleet.total}`);
  }
  log(`Trucks Overview tile: ${hint.trim()}`);
  await shot("trucks-can-drive", {
    caption: `Trucks Overview: the same ${said}, from the same read`,
    highlight: tile("can-drive"),
  });
};

export default flow;
