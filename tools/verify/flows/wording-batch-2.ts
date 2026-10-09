import type { Locator, Page } from "playwright-core";
import { openSidebar, signOutThroughNameMenu, type DriveContext, type DriveScript } from "../browser.js";
import { resolveAccount } from "../accounts.js";

/**
 * Wording batch 2 (#562, #563, #564, #573, #585).
 *
 * As the technician (start here): complete VH003's brake work order, then
 * report a second, safety-critical problem; the header names that problem
 * instead of "waiting on a manager to release it" (#562). As Direction: the
 * Money tiles read "Expenses in {month}" and "Revenue in
 * {month}" (#563); locking a past month says late entries post in the current
 * month and keep their date, and locking the current month says posting stops
 * (#585), both cancelled; a closed trip's History says "Trip closed" (#564).
 * As the passenger company's Administrateur: the same in its own word, and
 * emptying the trip sheet's revenue line leaves "No revenue or expense on this
 * sheet." As the driver: the trip sheet opens with no money line (#570) and
 * says "No expense on this sheet yet." (#573).
 * Mutates the slot (VH003); reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:wording-batch-2 --role technician --lang en --reel
 */
const STEERING = "Steering locks on the left at low speed";

const settle = (ctx: DriveContext) => ctx.page.waitForTimeout(700);

async function closeDialogs(page: Page) {
  for (let i = 0; i < 4 && (await page.getByRole("dialog").count()) > 0; i += 1) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
}

async function signInAs(page: Page, role: string) {
  const account = resolveAccount(role);
  await signOutThroughNameMenu(page);
  await page.getByLabel(/^(Espace de travail|Workspace)$/).fill(account.workspace);
  await page.getByLabel(/^(Nom d'utilisateur|Username)$/).fill(account.username);
  await page.getByLabel(/^(Code PIN|PIN code)$/).fill(account.pin);
  await page.getByRole("button", { name: /^(Se connecter|Sign in)$/ }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

function statusBlock(ctx: DriveContext): Locator {
  return ctx.page
    .locator("[role=status][data-tone]")
    .filter({ hasText: /^(Grounded|Repair done|Available|Immobilisé|Réparation terminée|Disponible)/ })
    .first();
}

/** #562: completed repair + another open safety problem → the sentence names it. */
async function groundedNamesTheOtherProblem(ctx: DriveContext) {
  const { page, t, shot, quiet, apiGet, log } = ctx;
  await (await openSidebar(page)).getByRole("link", { name: t("Camions", "Trucks") }).click();
  await page.getByRole("button", { name: /VH003/ }).first().click();
  await page.getByRole("heading", { level: 1, name: "VH003" }).waitFor({ timeout: 90_000 });
  await quiet();
  const assetId = /\/assets\/([0-9a-f-]{36})/.exec(page.url())?.[1];

  const status = statusBlock(ctx);
  await status.getByRole("button", { name: t("Terminer les travaux", "Complete work"), exact: true }).click();
  const form = page.getByRole("dialog").last();
  await form.waitFor();
  await form.getByLabel(t("Compte rendu", "Work summary")).fill("Brake lines bled, pressure sensor replaced");
  const noCost = form.getByRole("radio", { name: new RegExp(t("Aucun coût", "No cost"), "i") });
  if ((await noCost.count()) > 0) await noCost.first().check();
  await form.getByRole("button", { name: t("Terminer les travaux", "Complete work"), exact: true }).click();
  await quiet();
  await closeDialogs(page);
  await status.getByText(t("en attente d'un responsable", "waiting on a manager to release it")).waitFor();
  await settle(ctx);
  await shot("grounded-before", {
    caption: "Repair completed and nothing else open: the vehicle waits on a manager's release",
    highlight: status,
  });

  await page
    .getByRole("button", { name: new RegExp(`^(${t("Signaler un problème", "Report a problem")}|${t("Problème", "Problem")})$`) })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: t("Signaler un problème", "Report a problem") });
  await dialog.waitFor();
  await dialog.getByLabel("Description").fill(STEERING);
  await dialog.getByRole("checkbox", { name: t("Critique pour la sécurité", "Safety-critical") }).check();
  await dialog.getByRole("button", { name: t("Signaler le problème", "Report the problem") }).click();
  await page.getByText(t("Problème signalé", "Problem reported")).first().waitFor();
  await quiet();
  await closeDialogs(page);

  const sentence = status.getByText(
    t("un autre problème critique est encore ouvert", "another safety-critical problem is still open"),
    { exact: false },
  );
  await sentence.waitFor({ timeout: 15_000 });
  const text = (await status.textContent()) ?? "";
  if (!text.includes(STEERING)) throw new Error(`the sentence does not name the open problem: ${text}`);
  if (/waiting on a manager to release|en attente d'un responsable pour la remise/.test(text)) {
    throw new Error(`the sentence still waits on a manager: ${text}`);
  }
  await settle(ctx);
  await shot("grounded-other-open", {
    caption: "Another safety-critical problem is open: the sentence names it, not a manager",
    highlight: status,
  });

  const detail = await apiGet(`/v1/assets/${assetId ?? ""}`);
  const others = (detail.body as { availability?: { otherOpenSafetyIssues?: Array<{ description: string }> } })
    .availability?.otherOpenSafetyIssues;
  if (others?.[0]?.description !== STEERING) throw new Error(`otherOpenSafetyIssues ${JSON.stringify(others)}`);
  log(`api cross-check: availability.otherOpenSafetyIssues = [${others.map((o) => o.description).join(", ")}]`);
}

/** #563: the Money tiles read naturally. */
async function moneyTiles(ctx: DriveContext) {
  const { page, t, shot, quiet, apiGet, log } = ctx;
  await (await openSidebar(page)).getByRole("link", { name: t("Argent", "Money") }).click();
  await page.getByRole("heading", { level: 1, name: t("Argent", "Money") }).waitFor();
  await quiet();
  const out = page.getByRole("button", { name: new RegExp(`^${t("Sorties en", "Expenses in")} \\p{L}+`, "u") }).first();
  const incoming = page.getByRole("button", { name: new RegExp(`^${t("Entrées en", "Revenue in")} \\p{L}+`, "u") }).first();
  await out.waitFor();
  await incoming.waitFor();
  const body = (await page.locator("main").textContent()) ?? "";
  if (/\bIn in\b/.test(body)) throw new Error('the page still reads "In in"');
  await settle(ctx);
  await shot("money-tiles", {
    caption: "The Money tiles read Expenses in October and Revenue in October",
    highlight: out.locator("xpath=.."),
  });
  const summary = await apiGet("/v1/finance/summary");
  log(`api cross-check: GET /v1/finance/summary → ${summary.status}, month ${(summary.body as { month?: string }).month}`);
}

/** #585: what the lock dialog says, for a past month and for the current one. */
async function lockDialogs(ctx: DriveContext) {
  const { page, t, shot, quiet, nav, apiGet, log } = ctx;
  const periods = await apiGet("/v1/finance/periods");
  const list = (periods.body as { periods?: Array<{ periodCode: string; status: string }> }).periods ?? [];
  log(`api cross-check: periods ${list.map((p) => `${p.periodCode} ${p.status}`).join(", ")}`);

  await nav("/finance/periods");
  await page.getByRole("heading", { level: 1, name: t("Mois comptables", "Accounting months") }).waitFor();
  await quiet();
  const actions = page.getByRole("button", { name: t("Actions", "Actions"), exact: true });
  await actions.first().waitFor();

  // Newest first: the current month, then the open past month.
  for (const [index, label, expected] of [
    [1, "lock-past", t("sera comptabilisée dans le mois en cours et gardera sa date", "posts in the current month and keeps its date")],
    [0, "lock-current", t("plus rien ne pourra être comptabilisé avant sa réouverture", "nothing can be posted until it is reopened")],
  ] as const) {
    await actions.nth(index).click();
    await page.getByRole("menuitem", { name: t("Verrouiller la période", "Lock period") }).click();
    const dialog = page.getByRole("alertdialog");
    await dialog.waitFor();
    const description = dialog.getByText(expected, { exact: false });
    await description.waitFor({ timeout: 5_000 }).catch(async () => {
      throw new Error(`${label}: ${(await dialog.textContent()) ?? ""}`);
    });
    await settle(ctx);
    await shot(label, {
      caption:
        label === "lock-past"
          ? "Locking a past month: late entries post in the current month and keep their date"
          : "Locking the current month: posting stops until it is reopened",
      highlight: description,
    });
    await dialog.getByRole("button", { name: t("Annuler", "Cancel"), exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
  }
  const after = await apiGet("/v1/finance/periods");
  const still = (after.body as { periods?: Array<{ status: string }> }).periods ?? [];
  if (still.some((p) => p.status === "LOCKED")) throw new Error("a cancelled lock dialog locked a month");
}

/** #564: a closed trip's record history names the trip in the fleet's word. */
async function tripHistory(ctx: DriveContext, label: string, word: string) {
  const { page, t, shot, quiet, nav, apiGet, log } = ctx;
  const list = await apiGet("/v1/activities");
  const items = (list.body as { items?: Array<{ id: string; activityNumber: string; status: string }> }).items ?? [];
  const trip = items.find((item) => item.status === "CLOSED");
  if (trip === undefined) throw new Error("no closed trip");
  await nav(`/activities/${trip.id}`);
  await page.getByRole("heading", { level: 1, name: trip.activityNumber }).waitFor();
  await quiet();
  await page.getByRole("button", { name: t("Historique", "History"), exact: true }).click();
  const sheet = page.getByRole("dialog", { name: t("Historique du dossier", "Record history") });
  await sheet.waitFor();
  await quiet();
  let closed = sheet.getByText(word, { exact: true });
  if ((await closed.count()) === 0) {
    await sheet.getByRole("button", { name: t("Tout afficher", "Show all"), exact: true }).click();
    closed = sheet.getByText(word, { exact: true });
  }
  await closed.first().waitFor({ timeout: 5_000 }).catch(async () => {
    throw new Error(`${label}: no "${word}" in ${(await sheet.textContent()) ?? ""}`);
  });
  if (/Activit(y|é) (closed|clôturée)/.test((await sheet.textContent()) ?? "")) {
    throw new Error(`${label}: the history still says Activity closed`);
  }
  await settle(ctx);
  await shot(label, { caption: `${trip.activityNumber}'s history says "${word}"`, highlight: closed.first() });
  const history = await apiGet(`/v1/history/activity/${trip.id}`);
  const kinds = ((history.body as { items?: Array<{ eventType: string }> }).items ?? []).map((i) => i.eventType);
  log(`api cross-check: ${trip.activityNumber} history ${kinds.join(", ")}`);
  await closeDialogs(page);
}

async function openSheet(ctx: DriveContext) {
  const { page, t, quiet, nav } = ctx;
  await nav("/activities/record");
  await page.getByRole("heading", { level: 1, name: t("Saisir une fiche", "Record a sheet") }).waitFor();
  await quiet();
  return page.getByRole("button", { name: t("Retirer la ligne 1", "Remove line 1"), exact: true });
}

/** #573: a manager may add revenue, so the emptied sheet names both. */
async function managerEmptySheet(ctx: DriveContext) {
  const { page, t, shot } = ctx;
  const remove = await openSheet(ctx);
  // The manager's passenger sheet opens with one revenue line; removing it empties the section.
  await remove.click();
  const empty = page.getByText(t("Aucune recette ni dépense sur cette fiche.", "No revenue or expense on this sheet."), {
    exact: true,
  });
  await empty.waitFor({ timeout: 10_000 });
  await empty.scrollIntoViewIfNeeded();
  const driverWords = t("Aucune dépense sur cette fiche pour l'instant.", "No expense on this sheet yet.");
  if ((await page.getByText(driverWords).count()) > 0) {
    throw new Error("the manager's empty sheet uses the driver's wording");
  }
  await settle(ctx);
  await shot("manager-empty-sheet", {
    caption: "A manager's emptied sheet says no revenue or expense",
    highlight: empty.locator("xpath=.."),
  });
}

/** #573: a driver's empty sheet does not mention revenue. */
async function driverEmptySheet(ctx: DriveContext) {
  const { page, t, shot } = ctx;
  const remove = await openSheet(ctx);
  // #570: the driver's sheet opens with no money line at all.
  if ((await remove.count()) > 0) throw new Error("the driver's sheet opened with a money line");
  const empty = page.getByText(t("Aucune dépense sur cette fiche pour l'instant.", "No expense on this sheet yet."), {
    exact: true,
  });
  await empty.waitFor({ timeout: 10_000 });
  await empty.scrollIntoViewIfNeeded();
  if ((await page.getByText(t("Aucune recette ni dépense", "No revenue or expense")).count()) > 0) {
    throw new Error("the driver's empty sheet still mentions revenue");
  }
  await settle(ctx);
  await shot("driver-empty-sheet", {
    caption: "A driver's empty sheet says no expense yet, not revenue or expense",
    highlight: empty.locator("xpath=.."),
  });
}

const flow: DriveScript = async (ctx) => {
  const { page, t } = ctx;
  await groundedNamesTheOtherProblem(ctx);

  // Direction: only Direction and Finance manage accounting months.
  await signInAs(page, "director");
  await moneyTiles(ctx);
  await lockDialogs(ctx);
  await tripHistory(ctx, "trucking-history", t("Trajet clôturé", "Trip closed"));

  await signInAs(page, "passenger-admin");
  await tripHistory(ctx, "passenger-history", t("Voyage clôturé", "Trip closed"));
  await managerEmptySheet(ctx);

  await signInAs(page, "driver");
  await driverEmptySheet(ctx);
};

export default flow;
