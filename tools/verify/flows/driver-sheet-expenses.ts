import type { DriveScript } from "../browser.js";

/**
 * A driver's trip sheet (#532): Revenue and expenses offers Add expense only,
 * the line has no switch to revenue, and the sheet records with its expense.
 * Drivers record expenses; trip prices are the office's. Works for the trucking
 * driver and the passenger one (`--role passenger-driver`), whose journey used
 * to open with a revenue line. Built for a phone: run it at 390 × 844.
 * Mutates the slot; reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:driver-sheet-expenses --role driver --lang en --viewport 390x844
 */
const flow: DriveScript = async ({ page, t, lang, nav, shot, quiet, log, apiGet }) => {
  // Every check runs, so a run on the old code shows each wrong screen in turn.
  const wrong: string[] = [];

  await nav("/activities/record");
  await page.getByRole("heading", { level: 1, name: t("Saisir une fiche", "Record a sheet") }).waitFor();
  await quiet();

  const money = page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByRole("button", { name: t("Ajouter une dépense", "Add expense"), exact: true }) });
  const addRevenue = money.getByRole("button", { name: t("Ajouter une recette", "Add revenue"), exact: true });
  await money.scrollIntoViewIfNeeded();
  await shot("money-section", {
    caption: "A driver's sheet offers Add expense only: revenue is the office's to record",
    highlight: money,
  });
  if ((await addRevenue.count()) > 0) wrong.push("Add revenue is offered to the driver");
  // The passenger journey used to open with a revenue line already there.
  if ((await money.getByRole("tablist").count()) > 0) wrong.push("the sheet opened with a revenue/expense line");

  const pick = async (placeholder: string | RegExp, option?: RegExp) => {
    await page.getByRole("combobox").filter({ hasText: placeholder }).first().click();
    const options = page.getByRole("option");
    await (option === undefined ? options.first() : options.filter({ hasText: option }).first()).click();
  };
  // Douala: the demo's vehicles live there, and the asset list follows the branch.
  await pick(t("Choisir une agence", "Choose a branch"), /DLA/);
  await pick(t("Choisir un type", "Choose a type"));
  // The preset names the vehicle: a truck, or a vehicle on a passenger line.
  await pick(lang === "fr" ? /^Choisir un (engin|camion|véhicule)/ : /^Choose an? (asset|truck|vehicle)/);
  await page.getByLabel(t("Départ", "Departure"), { exact: true }).fill(t("07/10/2026 06:00", "10/07/2026 06:00"));
  await page.getByLabel(t("Arrivée", "Arrival"), { exact: true }).fill(t("07/10/2026 14:30", "10/07/2026 14:30"));

  const lines = await money.getByRole("combobox").count();
  if (lines === 0) await money.getByRole("button", { name: t("Ajouter une dépense", "Add expense"), exact: true }).click();
  await money.getByRole("combobox").first().click();
  await page.getByRole("option").first().click();
  await money.getByLabel(t("Montant de la ligne 1", "Amount of line 1")).fill("25000");
  await money.getByLabel(t("Montant de la ligne 1", "Amount of line 1")).blur();
  await shot("expense-line", {
    caption: "Line 1 is an expense, with no switch to revenue",
    highlight: money,
  });
  if ((await money.getByRole("tab", { name: t("Recette", "Revenue") }).count()) > 0) {
    wrong.push("line 1 can still be switched to revenue");
  }

  await page.getByRole("button", { name: t("Enregistrer la fiche", "Record sheet"), exact: true }).click();
  await page.waitForURL((url) => /^\/activities\/[0-9a-f-]{36}$/.test(url.pathname), { timeout: 20_000 });
  await quiet();
  await shot("trip-recorded", { caption: "The trip is recorded with the driver's expense" });

  const activityId = new URL(page.url()).pathname.split("/").pop() ?? "";
  const detail = await apiGet(`/v1/activities/${activityId}`);
  const body = detail.body as {
    activityNumber?: string;
    financialEntries?: Array<{ direction: string; amountMinor: number }> | null;
  };
  if (detail.status !== 200) throw new Error(`GET /v1/activities/${activityId} → ${detail.status}`);
  const entries = body.financialEntries;
  if (entries != null) {
    if (entries.length !== 1 || entries[0]?.direction !== "EXPENSE" || entries[0].amountMinor !== 25_000) {
      wrong.push(`the trip's money reads ${JSON.stringify(entries)}`);
    }
  }
  log(`api cross-check: ${body.activityNumber ?? activityId} recorded; money ${entries == null ? "not shown to this role" : JSON.stringify(entries)}`);
  if (wrong.length > 0) throw new Error(wrong.join("; "));
};

export default flow;
