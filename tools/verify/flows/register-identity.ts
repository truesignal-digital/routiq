import type { Locator } from "playwright-core";
import { openSidebar, type DriveScript, type DriveContext } from "../browser.js";

/**
 * Register a truck holds the plate and chassis number to the Details edit's
 * rules (#122): an 18-character chassis number and VH003's plate, re-spaced,
 * are both refused; the Details edit refuses the same chassis number in the
 * same words. Ends by counting the trucks that carry VH003's plate.
 * Mutates the slot on a build without the rule; reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:register-identity --role admin --lang en
 */
const LONG_CHASSIS = "WDB9634031L1234567";
const VH003_PLATE = "LT 482 AB";

async function openRegisterForm({ page, nav, t, quiet }: DriveContext, code: string) {
  // From the trucks list, so a second visit starts from an empty form.
  await nav("/assets");
  await quiet();
  await nav("/assets/new");
  await page.getByLabel(t("Code du camion", "Truck code"), { exact: true }).fill(code);
  await page.getByRole("combobox", { name: t("Classe d'actif", "Asset class") }).click();
  await page.getByRole("option", { name: t("Camion", "Truck"), exact: true }).click();
  // The shell's branch switcher carries the same name.
  const branch = page.locator("form").getByRole("combobox", { name: t("Agence", "Branch") });
  if ((await branch.textContent())?.includes(t("Choisir", "Choose")) ?? true) {
    await branch.click();
    await page.getByRole("option").first().click();
  }
  await quiet();
}

/**
 * Outline the field holding the message when it shows. A build without the
 * rule registers the truck instead; outline its row in the trucks list then,
 * so a before run shows what got in.
 */
async function outline(message: Locator, otherwise?: Locator): Promise<{ highlight?: Locator }> {
  const shown = await message.waitFor({ timeout: 3000 }).then(
    () => true,
    () => false,
  );
  if (shown) {
    const field = message.locator("xpath=ancestor::*[@data-slot='form-item'][1]");
    // Clear of the sticky breadcrumb, so the field's label shows.
    await field.evaluate((element) => element.scrollIntoView({ block: "center" }));
    return { highlight: field };
  }
  return otherwise !== undefined && (await otherwise.count()) > 0 ? { highlight: otherwise } : {};
}

async function submit({ page, t, quiet }: DriveContext) {
  await page.getByRole("button", { name: t("Enregistrer le camion", "Register truck"), exact: true }).click();
  await quiet();
  await page.waitForTimeout(400);
}

const flow: DriveScript = async (ctx) => {
  const { page, t, shot, quiet, log, apiGet } = ctx;
  const suffix = Date.now().toString(36).slice(-4).toUpperCase();
  const chassisField = () => page.getByLabel(t("Numéro de châssis", "Chassis number"), { exact: true });
  const plateField = () => page.getByLabel(t("Immatriculation", "Registration number"), { exact: true });

  await openRegisterForm(ctx, `CH-${suffix}`);
  await chassisField().fill(LONG_CHASSIS);
  await shot("long-chassis", {
    caption: "Register a truck with an 18-character chassis number, one past the Details edit's limit",
    highlight: chassisField(),
  });
  await submit(ctx);
  await shot("long-chassis-refused", {
    caption: "Register a truck refuses it with the Details edit's sentence: 17 characters at most",
    ...(await outline(
      page.getByText(t("Le numéro de châssis est trop long", "The chassis number is too long")).first(),
      page.getByRole("row", { name: new RegExp(`CH-${suffix}`) }),
    )),
  });

  await openRegisterForm(ctx, `PL-${suffix}`);
  await plateField().fill("lt-482-ab");
  await shot("duplicate-plate", {
    caption: `Register a truck under VH003's plate ${VH003_PLATE}, typed lower case with dashes`,
    highlight: plateField(),
  });
  ctx.expectRefusal({ status: 409, url: /\/v1\/commands\/register-asset$/ });
  await submit(ctx);
  await shot("duplicate-plate-refused", {
    caption: "The server refuses a plate another truck carries, and the form says so on the plate field",
    ...(await outline(
      page.getByText(t("Un autre véhicule a déjà cette immatriculation.", "Another vehicle already has this plate.")).first(),
      page.getByRole("row", { name: new RegExp(`PL-${suffix}`) }),
    )),
  });

  await (await openSidebar(page)).getByRole("link", { name: t("Camions", "Trucks") }).click();
  await page.getByRole("button", { name: /VH003/ }).first().click();
  await page.getByRole("heading", { level: 1, name: "VH003" }).waitFor();
  await page
    .getByRole("navigation", { name: t("Sections du véhicule", "Vehicle sections") })
    .getByRole("tab", { name: new RegExp(`^${t("Détails", "Details")}`) })
    .click();
  await page.waitForURL((url) => url.pathname.endsWith("/details"));
  await quiet();
  await page.getByRole("button", { name: t("Modifier les informations", "Edit details"), exact: true }).click();
  const detailsChassis = page.getByRole("textbox", { name: t("N° de châssis", "Chassis number"), exact: true });
  await detailsChassis.fill(LONG_CHASSIS);
  await page.getByRole("button", { name: t("Enregistrer les informations", "Save details"), exact: true }).click();
  await shot("details-same-words", {
    caption: "The Details edit refuses the same chassis number in the same words",
    ...(await outline(page.getByText(t("Le numéro de châssis est trop long", "The chassis number is too long")).first())),
  });

  const { status, body } = await apiGet("/v1/assets?search=482");
  const items = (body as { items?: Array<{ assetCode: string; registrationNumber?: string | null; chassisNumber?: string | null }> }).items ?? [];
  const plateKey = (plate: string) => plate.replace(/[\s-]/g, "").toUpperCase();
  const sharing = items.filter((a) => a.registrationNumber != null && plateKey(a.registrationNumber) === "LT482AB");
  log(`api cross-check: GET /v1/assets?search=482 → ${status}; trucks with plate ${VH003_PLATE}: ${sharing.map((a) => a.assetCode).join(", ")}`);
  const long = await apiGet(`/v1/assets?search=CH-${suffix}`);
  const registered = ((long.body as { items?: unknown[] }).items ?? []).length;
  log(`api cross-check: trucks registered with the 18-character chassis number: ${registered}`);
  if (status !== 200 || sharing.length !== 1 || registered !== 0) {
    throw new Error(`expected one truck on ${VH003_PLATE} and none with a long chassis, found ${sharing.length} and ${registered}`);
  }
};

export default flow;
