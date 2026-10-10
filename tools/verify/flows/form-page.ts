import type { Locator } from "playwright-core";
import type { DriveContext, DriveScript } from "../browser.js";

/**
 * Long forms share one frame (#663): Record a sheet and Register a truck are a
 * FormPage. On a wide screen: a 760 px column of section cards, each with its
 * state, a "So far" column that sums up what was typed and links what is still
 * missing, and one sticky footer with the hint on the left and the main button
 * last. Records a sheet (450,000 revenue, 86,000 fuel → profit 364,000) and
 * registers a truck, each cross-checked on the API. On a phone: one step per
 * section, then a review with "So far" and the buttons.
 * Mutates the slot (one trip, one truck); reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:form-page --role admin --lang en [--viewport 390x844]
 */
const flow: DriveScript = async (ctx) => {
  const viewport = ctx.page.viewportSize();
  if (viewport === null) throw new Error("no viewport");
  if (viewport.width < 768) await phone(ctx);
  else await desktop(ctx);
};

async function pick({ page }: DriveContext, scope: Locator, placeholder: string | RegExp, option?: RegExp) {
  await scope.getByRole("combobox").filter({ hasText: placeholder }).first().click();
  const options = page.getByRole("option");
  await (option === undefined ? options.first() : options.filter({ hasText: option }).first()).click();
}

const section = ({ page }: DriveContext, title: string) =>
  page.locator("[data-section]").filter({ has: page.getByRole("heading", { level: 2, name: title, exact: true }) });

async function fillSheet(ctx: DriveContext, next?: () => Promise<void>) {
  const { page, t, lang } = ctx;
  const form = page.locator("[data-slot=form-page]");
  await pick(ctx, form, t("Choisir une agence", "Choose a branch"), /DLA/);
  await pick(ctx, form, t("Choisir un type", "Choose a type"));
  await next?.();
  await pick(ctx, form, lang === "fr" ? /^Choisir un (engin|camion|véhicule)/ : /^Choose an? (asset|truck|vehicle)/, /VH001/);
  await page.getByLabel(t("Départ", "Departure"), { exact: true }).fill(t("21/07/2026 07:00", "07/21/2026 07:00"));
  await page.getByLabel(t("Arrivée", "Arrival"), { exact: true }).fill(t("21/07/2026 13:15", "07/21/2026 13:15"));
}

async function chooseCategory({ page, t }: DriveContext, money: Locator, position: number, category: string) {
  await money.getByRole("combobox", { name: t(`Catégorie de la ligne ${position}`, `Category of line ${position}`) }).click();
  await page.getByRole("option", { name: category, exact: true }).click();
  await page.waitForTimeout(300);
}

async function fillLegAndMoney(ctx: DriveContext, next?: () => Promise<void>) {
  const { page, t } = ctx;
  await next?.(); // crew
  await next?.(); // legs
  const origin = page.getByLabel(t("Départ de l'étape 1", "Origin of leg 1"), { exact: true });
  await origin.fill("Douala");
  await origin.press("Tab");
  const destination = page.getByLabel(t("Arrivée de l'étape 1", "Destination of leg 1"), { exact: true });
  await destination.fill("Bafoussam");
  await destination.press("Tab");
  await page.getByLabel(t("Distance de l'étape 1", "Distance of leg 1"), { exact: true }).fill("295");
  await next?.(); // cargo
  await next?.(); // money
  const money = section(ctx, t("Recettes et dépenses", "Revenue and expenses"));
  await money.getByRole("button", { name: t("Ajouter une recette", "Add revenue"), exact: true }).click();
  await chooseCategory(ctx, money, 1, t("Fret", "Freight revenue"));
  await money.getByLabel(t("Montant de la ligne 1", "Amount of line 1")).fill("450000");
  await money.getByRole("button", { name: t("Ajouter une dépense", "Add expense"), exact: true }).click();
  await chooseCategory(ctx, money, 2, t("Carburant", "Fuel"));
  await money.getByLabel(t("Montant de la ligne 2", "Amount of line 2")).fill("86000");
  await money.getByLabel(t("Montant de la ligne 2", "Amount of line 2")).blur();
}

async function desktop(ctx: DriveContext) {
  const { page, t, shot, quiet, log, apiGet, nav } = ctx;
  const wrong: string[] = [];
  const footer = page.locator("[data-slot=form-page-footer]");
  const context = page.locator("[data-slot=form-page-context]");

  await nav("/activities/record");
  await page.getByRole("heading", { level: 1, name: t("Saisir une fiche", "Record a sheet") }).waitFor();
  await quiet();
  const column = await page.locator("[data-slot=form-page-column]").evaluate((el) => Math.round(el.getBoundingClientRect().width));
  const rail = await context.evaluate((el) => Math.round(el.getBoundingClientRect().width));
  log(`form column ${column} px, context column ${rail} px, footer hint "${await footer.locator("p").textContent()}"`);
  if (column > 760) wrong.push(`the form column is ${column} px, wider than 760`);
  await shot("sheet-frame", {
    caption: `Record a sheet: a ${column} px column of titled sections, each with its state, beside "So far" (${rail} px) and one footer`,
    highlight: page.locator("[data-slot=form-page]"),
  });

  await context.getByRole("button", { name: t("Aller à Arrivée", "Go to Arrival") }).click();
  await page.waitForTimeout(600);
  const focusedArrival = await page.evaluate(() => document.activeElement?.closest("[data-field]")?.getAttribute("data-field"));
  if (focusedArrival !== "endedAt") wrong.push(`Go to Arrival focused ${focusedArrival ?? "nothing"}`);
  await shot("still-missing-go", {
    caption: "Still missing → Arrival scrolls to the Arrival field and puts the cursor in it",
    highlight: page.locator("[data-field=endedAt]"),
  });

  await fillSheet(ctx);
  await fillLegAndMoney(ctx);
  await quiet();
  const soFar = (await context.locator("[data-slot=form-page-so-far]").innerText()).replace(/\s+/g, " ");
  log(`So far: ${soFar}`);
  for (const expected of ["VH001", "Douala → Bafoussam", "295 km", "450", "86", "364"]) {
    if (!soFar.includes(expected)) wrong.push(`So far does not show ${expected}`);
  }
  const hint = await footer.locator("p").textContent();
  if (hint !== t("Rien ne manque", "Nothing missing")) wrong.push(`footer hint reads "${hint}"`);
  const buttons = await footer.getByRole("button").allTextContents();
  log(`footer buttons: ${buttons.join(" | ")}`);
  if (buttons.at(-1) !== t("Enregistrer la fiche", "Record sheet")) wrong.push(`last footer button is ${buttons.at(-1)}`);
  await context.scrollIntoViewIfNeeded();
  await shot("sheet-so-far", {
    caption: "So far reads VH001, Douala → Bafoussam, 295 km, revenue 450,000, expenses 86,000 and profit 364,000; nothing is missing",
    highlight: context,
  });
  await shot("sheet-footer", {
    caption: "One sticky footer: Nothing missing on the left, Record and close then Record sheet on the right",
    highlight: footer,
  });

  await footer.getByRole("button", { name: t("Enregistrer la fiche", "Record sheet"), exact: true }).click();
  await page.waitForURL((url) => /^\/activities\/[0-9a-f-]{36}$/.test(url.pathname), { timeout: 20_000 });
  await quiet();
  const activityId = new URL(page.url()).pathname.split("/").pop() ?? "";
  const detail = await apiGet(`/v1/activities/${activityId}`);
  const trip = detail.body as { activityNumber?: string; financialEntries?: Array<{ direction: string; amountMinor: number }> | null };
  const money = (trip.financialEntries ?? []).map((entry) => `${entry.direction} ${entry.amountMinor}`).sort();
  log(`api: ${trip.activityNumber ?? activityId} → ${detail.status}, money ${money.join(", ")}`);
  if (detail.status !== 200 || money.join(",") !== "EXPENSE 86000,REVENUE 450000") wrong.push(`the trip's money reads ${money.join(", ")}`);
  await shot("sheet-recorded", { caption: `The sheet is recorded as ${trip.activityNumber ?? "a trip"} with its revenue and fuel` });

  const code = `FP-${Date.now().toString(36).slice(-4).toUpperCase()}`;
  await nav("/assets");
  await quiet();
  await nav("/assets/new");
  await page.getByRole("heading", { level: 1, name: t("Enregistrer un camion", "Register a truck") }).waitFor();
  await quiet();
  const registerButtons = await footer.getByRole("button").evaluateAll((els) =>
    els.map((el) => ({ text: el.textContent ?? "", width: Math.round(el.getBoundingClientRect().width) })),
  );
  log(`register footer: ${registerButtons.map((b) => `${b.text} ${b.width} px`).join(" | ")}`);
  if (registerButtons.map((b) => b.text).join("|") !== t("Annuler|Enregistrer le camion", "Cancel|Register truck")) {
    wrong.push(`register footer reads ${registerButtons.map((b) => b.text).join(" | ")}`);
  }
  if (registerButtons.some((b) => b.width > 260)) wrong.push("a register footer button is stretched");
  await shot("register-frame", {
    caption: "Register a truck in the same frame: Identity, Plate and make, Capacity, Purchase and Papers, each with its state, and So far",
    highlight: page.locator("[data-slot=form-page]"),
  });

  await page.getByLabel(t("Code du camion", "Truck code"), { exact: true }).fill(code);
  await page.getByRole("combobox", { name: t("Classe d'actif", "Asset class") }).click();
  await page.getByRole("option", { name: t("Camion", "Truck"), exact: true }).click();
  const branch = page.locator("[data-field=branchCode]").getByRole("combobox");
  if ((await branch.textContent())?.includes(t("Choisir", "Choose")) ?? true) {
    await branch.click();
    await page.getByRole("option").first().click();
  }
  await page.getByLabel(t("Marque", "Make"), { exact: true }).fill("Iveco");
  await page.getByLabel(t("Modèle", "Model"), { exact: true }).fill("Stralis");
  await quiet();
  const registerSoFar = (await context.innerText()).replace(/\s+/g, " ");
  log(`register So far: ${registerSoFar}`);
  if (!registerSoFar.includes(code) || !registerSoFar.includes("Iveco Stralis")) wrong.push("register So far misses the code or make");
  await shot("register-so-far", {
    caption: `So far shows ${code}, the class, the branch and Iveco Stralis; papers read Not recorded; footer: Cancel then Register truck`,
    highlight: context,
  });
  await footer.getByRole("button", { name: t("Enregistrer le camion", "Register truck"), exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/assets", { timeout: 20_000 });
  await quiet();
  const listed = await apiGet(`/v1/assets?search=${code}`);
  const items = (listed.body as { items?: Array<{ assetCode: string; manufacturer?: string | null }> }).items ?? [];
  log(`api: GET /v1/assets?search=${code} → ${listed.status}, ${JSON.stringify(items.map((i) => [i.assetCode, i.manufacturer]))}`);
  if (items[0]?.assetCode !== code) wrong.push(`${code} is not in the trucks list`);
  await shot("register-done", { caption: `${code} is registered and the trucks list opens` });

  if (wrong.length > 0) throw new Error(wrong.join("; "));
}

async function phone(ctx: DriveContext) {
  const { page, t, shot, quiet, log, nav } = ctx;
  const wrong: string[] = [];
  const footer = page.locator("[data-slot=form-page-footer]");
  const step = page.locator("[data-slot=form-page-step]");
  const next = async () => {
    await footer.getByRole("button", { name: t("Suivant", "Next"), exact: true }).click();
  };

  await nav("/activities/record");
  await page.getByRole("heading", { level: 1, name: t("Saisir une fiche", "Record a sheet") }).waitFor();
  await quiet();
  await step.waitFor();
  log(`first step: ${await step.innerText()}`);
  const visible = await page.locator("[data-section]:not([hidden])").count();
  if (visible !== 1) wrong.push(`${visible} sections show on the first step`);
  await shot("phone-step-1", {
    caption: "On a phone Record a sheet is one step per section: step 1 of 7, References, with Next in the footer",
    highlight: step,
  });

  await fillSheet(ctx, next);
  await shot("phone-step-2", {
    caption: "Step 2, the truck and its times; the footer counts what is still missing",
    highlight: section(ctx, t("Camion et compteurs", "Truck and meters")).or(page.locator("[data-section=vehicle]")),
  });
  await fillLegAndMoney(ctx, next);
  await next();
  await quiet();
  const review = page.locator("[data-slot=form-page-review]");
  await review.waitFor();
  const soFar = (await review.locator("[data-slot=form-page-so-far]").innerText()).replace(/\s+/g, " ");
  log(`review So far: ${soFar}`);
  for (const expected of ["VH001", "Douala → Bafoussam", "295 km", "364"]) {
    if (!soFar.includes(expected)) wrong.push(`the review does not show ${expected}`);
  }
  const buttons = await footer.getByRole("button").allTextContents();
  if (buttons.at(-1) !== t("Enregistrer la fiche", "Record sheet")) wrong.push(`the review's last button is ${buttons.at(-1)}`);
  await shot("phone-review", {
    caption: "The last step is a review: So far with profit 364,000, each section's state with Change, and Record sheet last",
    highlight: review,
  });
  await footer.getByRole("button", { name: t("Enregistrer la fiche", "Record sheet"), exact: true }).click();
  await page.waitForURL((url) => /^\/activities\/[0-9a-f-]{36}$/.test(url.pathname), { timeout: 20_000 });
  await quiet();
  await shot("phone-recorded", { caption: "Recorded from the review step: the trip opens" });

  await nav("/assets");
  await quiet();
  await nav("/assets/new");
  await page.getByRole("heading", { level: 1, name: t("Enregistrer un camion", "Register a truck") }).waitFor();
  await step.waitFor();
  await shot("phone-register-step-1", {
    caption: "Register a truck on a phone: step 1 of 6, Identity",
    highlight: step,
  });
  for (let index = 0; index < 5; index += 1) await next();
  await shot("phone-register-review", {
    caption: "Its review lists what is still missing (code and class) with a Go link to each, and Cancel then Register truck",
    highlight: page.locator("[data-slot=form-page-review]"),
  });
  await page.getByRole("button", { name: t("Aller à Code du camion", "Go to Truck code") }).click();
  await page.waitForTimeout(600);
  const focused = await page.evaluate(() => document.activeElement?.closest("[data-field]")?.getAttribute("data-field"));
  if (focused !== "assetCode") wrong.push(`Go to Truck code focused ${focused ?? "nothing"}`);
  await shot("phone-register-go", {
    caption: "Go to Truck code opens the Identity step with the cursor in the code",
    highlight: page.locator("[data-field=assetCode]"),
  });

  if (wrong.length > 0) throw new Error(wrong.join("; "));
}

export default flow;
