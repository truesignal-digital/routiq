import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "admin-registers-truck",
  actor: { role: "admin", person: "The Administrateur (chef d'agence)" },
  arrangeAs: "admin",
  goal: "register a newly bought truck with its code, class, branch, plate and make",
  trigger: "A new truck arrives at the branch",
  frequency: "A few times a year",
  device: { viewport: { width: 1440, height: 900 }, throttle: "none" },
  doneWhen: "The trucks list opens and GET /v1/assets?search=<code> returns the new truck with its make",
  firstGlance: {
    purpose: "Register a new truck",
    state: "An empty form; code, class and branch are required, the rest can wait",
    nextAction: "Type the truck's code",
  },
  budgets: {
    // Register, the class select and its option, Register truck.
    taps: 4,
    seconds: 15,
    // A long form's labels and section states are its words; sentences are not.
    wordsPerScreen: 200,
    foldWordsPerScreen: 150,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/**
 * Typing isn't a tap, so the form's fields have their own bar: what the goal
 * needs typed or picked (code, class, branch, plate, make, model; with all
 * branches in scope the branch is a pick) and what the form shows at all.
 */
const FIELDS = { filled: 6, shown: 14 };

/**
 * Writes one truck; reset with `pnpm verify up --reseed` between runs.
 * Run: pnpm verify drive journey:admin-registers-truck --role admin --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, nav, quiet, apiGet, log } = ctx;
  assertStartedAs(ctx, journey);
  await nav("/assets");
  await page.locator("[data-slot=trucks-overview]").waitFor({ timeout: 60_000 });
  await quiet();
  const run = journeyRunner(ctx, journey);
  await run.tap(page.locator("main").getByRole("link", { name: t("Enregistrer un camion", "Register a truck"), exact: true }).first());
  await page.getByRole("heading", { level: 1, name: t("Enregistrer un camion", "Register a truck") }).waitFor({ timeout: 30_000 });
  await run.screen("register-form", "Register a truck, empty");

  const form = page.locator("[data-slot=form-page]");
  const shown = await form
    .locator("input:not([type=hidden]):not([type=file]), [role=combobox], textarea, [data-slot=file-upload]")
    .evaluateAll((els) => els.filter((el) => (el as HTMLElement).offsetParent !== null).length);

  const code = `JR-${Date.now().toString(36).slice(-4).toUpperCase()}`;
  let filled = 0;
  await page.getByLabel(t("Code du camion", "Truck code"), { exact: true }).fill(code);
  filled += 1;
  await run.tap(page.getByRole("combobox", { name: t("Classe d'actif", "Asset class") }));
  await run.tap(page.getByRole("option", { name: t("Camion", "Truck"), exact: true }));
  filled += 1;
  const branch = page.locator("[data-field=branchCode]").getByRole("combobox");
  if ((await branch.textContent())?.includes(t("Choisir", "Choose")) ?? true) {
    await branch.click();
    await page.getByRole("option").first().click();
    filled += 1;
  }
  await page.getByLabel(t("Immatriculation", "Registration number"), { exact: true }).fill(`LT ${Date.now().toString().slice(-4)} A`);
  await page.getByLabel(t("Marque", "Make"), { exact: true }).fill("Iveco");
  await page.getByLabel(t("Modèle", "Model"), { exact: true }).fill("Stralis");
  filled += 3;
  await quiet();

  await run.tap(page.locator("[data-slot=form-page-footer]").getByRole("button", { name: t("Enregistrer le camion", "Register truck"), exact: true }));
  await page.waitForURL((url) => url.pathname === "/assets", { timeout: 20_000 });
  await page.locator("[data-slot=trucks-overview]").waitFor({ timeout: 30_000 });

  const listed = await apiGet(`/v1/assets?search=${code}`);
  const items = (listed.body as { items?: Array<{ assetCode: string; manufacturer?: string | null }> }).items ?? [];
  log(`api cross-check: GET /v1/assets?search=${code} → ${listed.status}, ${JSON.stringify(items.map((i) => [i.assetCode, i.manufacturer]))}`);
  if (items[0]?.assetCode !== code || items[0]?.manufacturer !== "Iveco") throw new Error(`${code} is not registered with its make`);
  log(`${filled <= FIELDS.filled ? "pass" : "OVER"} fields filled: ${filled} / ${FIELDS.filled}`);
  log(`${shown <= FIELDS.shown ? "pass" : "OVER"} fields shown: ${shown} / ${FIELDS.shown}`);
  run.finish();
};

export default drive;
