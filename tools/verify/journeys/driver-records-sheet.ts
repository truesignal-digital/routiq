import type { Locator } from "playwright-core";
import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "driver-records-sheet",
  actor: { role: "driver", person: "A driver (chauffeur) at the end of a trip" },
  arrangeAs: "driver",
  goal: "record the trip they just drove, with the fuel they paid, on their phone",
  trigger: "Back at the depot, or parked at the destination",
  frequency: "Once per trip, most days",
  device: { viewport: { width: 390, height: 844 }, throttle: "phone" },
  doneWhen: "The recorded trip's page opens, and GET /v1/activities/:id answers 200 with the driver's one 25 000 FCFA expense",
  firstGlance: {
    purpose: "Record a trip sheet",
    state: "A new sheet, nothing filled yet",
    nextAction: "Pick the branch and the kind of trip",
  },
  // Fields typed (not counted as taps): departure, arrival, one expense amount. Five picks: branch, type, truck, expense category, and its option.
  budgets: {
    taps: 16,
    seconds: 20,
    // One step of a form on a phone: its fields' labels, not paragraphs.
    wordsPerScreen: 120,
    foldWordsPerScreen: 90,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/**
 * Writes one trip: run `pnpm verify up --slot N --reseed` between runs.
 * The sheet is one step per section on a phone (#663): Next walks them, the
 * review step holds Record sheet.
 * Run: pnpm verify drive journey:driver-records-sheet --role driver --viewport 390x844 --throttle phone --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, lang, nav, quiet, apiGet, log } = ctx;
  assertStartedAs(ctx, journey);
  await nav("/activities/record");
  await page.getByRole("heading", { level: 1, name: t("Saisir une fiche", "Record a sheet") }).waitFor({ timeout: 30_000 });
  await quiet();
  const run = journeyRunner(ctx, journey);
  await run.screen("sheet-start", "The sheet's first step on the driver's phone");

  const footer = page.locator("[data-slot=form-page-footer]");
  const next = footer.getByRole("button", { name: t("Suivant", "Next"), exact: true });
  const pick = async (trigger: Locator, option?: RegExp) => {
    await run.tap(trigger);
    const options = page.getByRole("option");
    await run.tap(option === undefined ? options.first() : options.filter({ hasText: option }).first());
  };
  const walkTo = async (target: Locator) => {
    while (!(await target.isVisible()) && (await next.count()) > 0) await run.tap(next);
  };

  // Douala: the demo's trucks live there, and the truck list follows the branch.
  await pick(page.getByRole("combobox").filter({ hasText: t("Choisir une agence", "Choose a branch") }).first(), /DLA/);
  await pick(page.getByRole("combobox").filter({ hasText: t("Choisir un type", "Choose a type") }).first());

  const truck = page.getByRole("combobox").filter({ hasText: lang === "fr" ? /^Choisir un (engin|camion|véhicule)/ : /^Choose an? (asset|truck|vehicle)/ }).first();
  await walkTo(truck);
  await run.screen("sheet-vehicle", "The truck and times step");
  await pick(truck);
  await page.getByLabel(t("Départ", "Departure"), { exact: true }).fill("07/10/2026 06:00");
  await page.getByLabel(t("Arrivée", "Arrival"), { exact: true }).fill("07/10/2026 14:30");

  const addExpense = page.getByRole("button", { name: t("Ajouter une dépense", "Add expense"), exact: true });
  await walkTo(addExpense);
  await run.screen("sheet-money", "The driver's costs step: expenses only");
  const money = page.locator('[data-slot="card"]').filter({ has: addExpense });
  if ((await money.getByRole("combobox").count()) === 0) await run.tap(addExpense);
  await pick(money.getByRole("combobox").first());
  const amount = money.getByLabel(t("Montant de la ligne 1", "Amount of line 1"));
  await amount.fill("25000");
  await amount.blur();

  const record = footer.getByRole("button", { name: t("Enregistrer la fiche", "Record sheet"), exact: true });
  await walkTo(record);
  await run.screen("sheet-review", "The review before recording");
  await run.tap(record);
  await page.waitForURL((url) => /^\/activities\/[0-9a-f-]{36}$/.test(url.pathname), { timeout: 30_000 });
  await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 30_000 });
  await run.screen("trip-recorded", "The recorded trip");

  const activityId = new URL(page.url()).pathname.split("/").pop() ?? "";
  const detail = await apiGet(`/v1/activities/${activityId}`);
  const body = detail.body as { activityNumber?: string; financialEntries?: Array<{ direction: string; amountMinor: number }> | null };
  if (detail.status !== 200) throw new Error(`GET /v1/activities/${activityId} → ${detail.status}`);
  const entries = body.financialEntries;
  if (entries != null && (entries.length !== 1 || entries[0]?.direction !== "EXPENSE" || entries[0].amountMinor !== 25_000)) {
    throw new Error(`the trip's money reads ${JSON.stringify(entries)}`);
  }
  log(`api cross-check: ${body.activityNumber ?? activityId} recorded; fields typed 3, picks 5`);
  run.finish();
};

export default drive;
