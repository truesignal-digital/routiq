import type { DriveScript } from "../browser.js";

/**
 * Missing values say "Not recorded" in words, never a bare dash (#306): the
 * Trucks list (plate), Money (counterparty), Maintenance (actual cost), then
 * VH003's Details, where an editor gets an inline Add that opens the edit.
 * Read-only. Run: pnpm verify drive flow:not-recorded --lang en [--viewport 390x844]
 */
const flow: DriveScript = async ({ page, t, shot, quiet, nav, log }) => {
  const words = t("Non renseigné", "Not recorded");
  // Phone rows hide the plate and counterparty columns, so lists are only checked for dashes there.
  const phone = (page.viewportSize()?.width ?? 1440) < 768;
  const noDash = async (where: string) => {
    const dashes = await page.locator("main").getByText("—", { exact: true }).count();
    if (dashes > 0) throw new Error(`${where}: ${dashes} bare "—" still on screen`);
    const count = await page.locator("main [data-slot=not-recorded]").count();
    log(`${where}: ${count} "${words}", no bare dash`);
    return count;
  };

  await nav("/assets");
  await quiet();
  if (!phone) await page.getByText(words).first().waitFor();
  await noDash("trucks");
  await shot("trucks-plate", {
    caption: phone
      ? "Trucks on a phone: no bare dash in the list rows"
      : "Trucks: a plate nobody entered reads \"Not recorded\" instead of a dash",
    ...(phone ? {} : { highlight: page.locator("main [data-slot=not-recorded]").first() }),
  });

  await nav("/finance/entries");
  await quiet();
  if (!phone) await page.getByText(words).first().waitFor();
  await noDash("money");
  await shot("money-counterparty", {
    caption: phone ? "Money on a phone: no bare dash in the list rows" : "Money: entries with no counterparty say so in words",
    ...(phone ? {} : { highlight: page.locator("main [data-slot=not-recorded]").first() }),
  });

  await nav("/maintenance");
  await quiet();
  await noDash("maintenance");
  await shot("maintenance-costs", { caption: "Maintenance: a cost not known yet reads \"Not recorded\", never a dash" });

  await nav("/assets");
  await quiet();
  await page.getByRole("button", { name: /VH003/ }).first().click();
  await page.getByRole("heading", { level: 1, name: "VH003" }).waitFor();
  await page
    .getByRole("navigation", { name: t("Sections du véhicule", "Vehicle sections") })
    .getByRole("tab", { name: new RegExp(`^${t("Détails", "Details")}`) })
    .click();
  await page.waitForURL((url) => url.pathname.endsWith("/details"));
  await quiet();
  const year = page.locator("dd", { has: page.locator("[data-slot=not-recorded]") }).first();
  await year.waitFor();
  await noDash("vehicle details");
  await shot("details-add", {
    caption: "Vehicle details: a missing year says \"Not recorded\" with an inline Add for the fleet manager",
    highlight: year,
  });

  await year.getByRole("button", { name: t("Ajouter", "Add"), exact: true }).click();
  await page.getByRole("button", { name: t("Enregistrer les informations", "Save details"), exact: true }).waitFor();
  await shot("details-add-opens-edit", { caption: "Add opens the same edit, so the value can be filled in place" });
  await page.getByRole("button", { name: t("Annuler", "Cancel"), exact: true }).click();
};

export default flow;
