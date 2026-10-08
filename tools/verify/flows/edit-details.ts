import { openSidebar, type DriveScript } from "../browser.js";

/**
 * VH003 → Details → Edit details → set make and model → Save, then read the
 * asset back. Mutates the slot; reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:edit-details --role manager --lang en
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  await (await openSidebar(page)).getByRole("link", { name: t("Camions", "Trucks") }).click();
  await page.getByRole("button", { name: /VH003/ }).first().click();
  await page.getByRole("heading", { level: 1, name: "VH003" }).waitFor();
  const assetId = /\/assets\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  await page
    .getByRole("navigation", { name: t("Sections du véhicule", "Vehicle sections") })
    .getByRole("tab", { name: new RegExp(`^${t("Détails", "Details")}`) })
    .click();
  await page.waitForURL((url) => url.pathname.endsWith("/details"));
  await quiet();

  await page.getByRole("button", { name: t("Modifier les informations", "Edit details"), exact: true }).click();
  await page.getByLabel(t("Marque", "Make"), { exact: true }).fill("Mercedes-Benz");
  await page.getByLabel(t("Modèle", "Model"), { exact: true }).fill("Actros 2640");
  await shot("details-editing", { caption: "Edit details: the make and model fields are open for change" });
  await page.getByRole("button", { name: t("Enregistrer les informations", "Save details"), exact: true }).click();
  await page.getByRole("button", { name: t("Modifier les informations", "Edit details"), exact: true }).waitFor();
  await quiet();
  await shot("details-saved", { caption: "The new make and model are saved and shown on the vehicle" });

  const { status, body } = await apiGet(`/v1/assets/${assetId ?? ""}`);
  const asset = body as { manufacturer?: string | null; model?: string | null; rowVersion?: number };
  if (status !== 200 || asset.manufacturer !== "Mercedes-Benz" || asset.model !== "Actros 2640") {
    throw new Error(`GET /v1/assets/${assetId ?? ""} → ${status} ${JSON.stringify({ manufacturer: asset.manufacturer, model: asset.model })}`);
  }
  log(`api cross-check: VH003 make ${asset.manufacturer}, model ${asset.model}, row version ${asset.rowVersion ?? "?"}`);
};

export default flow;
