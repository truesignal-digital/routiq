import { openSidebar, type DriveScript } from "../browser.js";

/**
 * VH003 → Log fuel, the first form on the field kit's Quick entry layout
 * (#292): it opens with the cursor in the amount, the only empty required
 * field; an empty submit lists what to fix; the optional fold shows its count;
 * a fill-up with an odometer reading sends the FUEL expense and the reading,
 * read back from `GET /v1/finance/entries` and `GET /v1/assets/:id`.
 * Desktop or phone (--viewport 390x844). Mutates the slot; reset with
 * `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:log-fuel --role driver --lang en
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  await (await openSidebar(page)).getByRole("link", { name: t("Camions", "Trucks") }).click();
  await page.getByRole("button", { name: /VH003/ }).first().click();
  await page.getByRole("heading", { level: 1, name: "VH003" }).waitFor();
  const assetId = /\/assets\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";
  await quiet();

  const asset = await apiGet(`/v1/assets/${assetId}`);
  const last = (asset.body as { lastReading?: { readingType: string; value: number } | null }).lastReading;
  const odometer = (last?.readingType === "ODOMETER" ? last.value : 200_000) + 412;

  const logFuel = page.getByRole("button", { name: t("Enregistrer un plein", "Log fuel"), exact: true });
  if (await logFuel.first().isVisible()) {
    await logFuel.first().click();
  } else {
    const more = page.getByRole("button", { name: t("Plus d'actions", "More actions"), exact: true });
    await ((await more.isVisible()) ? more : page.getByRole("button", { name: t("Plus", "More"), exact: true })).click();
    await page
      .getByRole("dialog", { name: t("Toutes les actions", "All actions") })
      .getByRole("button", { name: new RegExp(t("Enregistrer un plein", "Log fuel")) })
      .click();
  }
  const form = page.getByRole("dialog", { name: t("Enregistrer un plein", "Log fuel") });
  const submit = form.getByRole("button", { name: t("Enregistrer le plein", "Save fuel"), exact: true });
  await submit.waitFor();
  const amount = form.getByLabel(t("Montant payé", "Amount paid"), { exact: true });
  await page
    .waitForFunction(() => document.activeElement?.getAttribute("name") === "amountMinor", undefined, { timeout: 3000 })
    .catch(() => {
      throw new Error("Log fuel did not open with the cursor in Amount paid, its first empty required field");
    });
  await shot("fuel-open", {
    caption: "Quick entry: vehicle pinned, cursor in the amount, hint and Save fuel in the footer",
    highlight: form,
  });

  await submit.click();
  const summary = form.getByRole("region", { name: t("1 point à corriger", "1 thing to fix") });
  await summary.waitFor();
  await shot("fuel-empty-submit", {
    caption: "Empty submit sends nothing: the summary and the field name the amount",
    highlight: summary,
  });

  await summary.getByRole("button").click();
  await amount.fill("45000");
  await amount.press("Tab");
  await form.getByLabel(t("Relevé", "Reading"), { exact: true }).fill(String(odometer));
  const fold = form.getByRole("button", { name: new RegExp(t("Plus de détails", "More details")) });
  await fold.click();
  await form.getByLabel("Station", { exact: true }).fill("Total Bonabéri");
  await shot("fuel-filled", {
    caption: "Amount grouped with its FCFA unit, a reading, the optional fold at 1 of 2",
    highlight: form,
  });

  await submit.click();
  await form.waitFor({ state: "detached" });
  await quiet();
  await shot("fuel-saved", { caption: "Panel closed; one toast: expense recorded, reading saved" });

  const entries = await apiGet(`/v1/finance/entries?assetId=${assetId}`);
  const list = (entries.body as { entries?: { amountMinor: number; category: { code: string }; counterpartyName: string | null }[] })
    .entries ?? [];
  const entry = list.find(
    (row) => row.amountMinor === 45_000 && row.category.code === "FUEL" && row.counterpartyName === "Total Bonabéri",
  );
  if (entries.status !== 200 || entry === undefined) {
    throw new Error(`GET /v1/finance/entries?assetId=${assetId} → ${entries.status}; no 45,000 FUEL entry at Total Bonabéri`);
  }
  const after = await apiGet(`/v1/assets/${assetId}`);
  const reading = (after.body as { lastReading?: { value: number } | null }).lastReading;
  if (reading?.value !== odometer) {
    throw new Error(`GET /v1/assets/${assetId} → last reading ${String(reading?.value)}, expected ${odometer}`);
  }
  log(`api cross-check: VH003 has a 45,000 XAF FUEL entry at Total Bonabéri and its last odometer is ${odometer}`);
};

export default flow;
