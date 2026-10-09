import { openSidebar, type DriveScript } from "../browser.js";

/**
 * Trucks list → VH003 → every vehicle workspace tab the role can see, with a
 * screenshot per tab and a read-only API cross-check of the asset.
 * Run: pnpm verify drive flow:vehicle-workspace --role manager --lang en
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  const sidebar = await openSidebar(page);
  await sidebar.getByRole("link", { name: t("Camions", "Trucks") }).click();
  await page.getByRole("heading", { name: t("Camions", "Trucks"), level: 1 }).waitFor();
  await quiet();
  await shot("trucks-list", { caption: "Trucks list" });

  await page.getByRole("button", { name: /VH003/ }).first().click();
  await page.getByRole("heading", { level: 1, name: "VH003" }).waitFor();
  await quiet();
  await shot("vh003-overview", { caption: "VH003 opens on its Overview tab" });
  const assetId = /\/assets\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (assetId === undefined) throw new Error(`no asset id in ${page.url()}`);

  const sections = page.getByRole("navigation", { name: t("Sections du véhicule", "Vehicle sections") });
  await sections.getByRole("tab").first().waitFor();
  const tabs: Array<[fr: string, en: string, path: string]> = [
    ["Maintenance", "Maintenance", "/maintenance"],
    ["Argent", "Money", "/money"],
    ["Trajets", "Trips", "/trips"],
    ["Documents", "Documents", "/documents"],
    ["Historique", "History", "/history"],
    ["Détails", "Details", "/details"],
  ];
  for (const [fr, en, suffix] of tabs) {
    const tab = sections.getByRole("tab", { name: new RegExp(`^${t(fr, en)}`) });
    if (!(await tab.isVisible())) {
      log(`tab ${t(fr, en)} is not offered to this role`);
      continue;
    }
    await tab.click();
    await page.waitForURL((url) => url.pathname.endsWith(suffix));
    await quiet();
    await shot(`vh003-${en.toLowerCase()}`, { caption: `VH003, ${en} tab` });
  }

  const { status, body } = await apiGet(`/v1/assets/${assetId}`);
  const asset = body as { assetCode?: string; registrationNumber?: string | null; lifecycleStatus?: string };
  if (status !== 200 || asset.assetCode !== "VH003") throw new Error(`GET /v1/assets/${assetId} → ${status}`);
  log(`api cross-check: GET /v1/assets/${assetId} → 200, ${asset.assetCode}, plate ${asset.registrationNumber ?? "none"}, ${asset.lifecycleStatus ?? "?"}`);
};

export default flow;
