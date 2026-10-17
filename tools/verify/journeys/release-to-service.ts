import type { Page } from "playwright-core";
import { resolveAccount } from "../accounts.js";
import { signOutThroughNameMenu, type DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "release-to-service",
  actor: { role: "admin", person: "The Administrateur (chef d'agence) of the truck's branch" },
  // The technician completes the repair first; whoever completed it may not release it.
  arrangeAs: "technician",
  goal: "put a repaired truck back on the road",
  trigger: "The workshop has marked the repair of a grounded truck as done",
  frequency: "A few times a month, between other work",
  device: { viewport: { width: 390, height: 844 }, throttle: "phone" },
  doneWhen: "The truck shows Available and GET /v1/assets/:id returns availability AVAILABLE",
  firstGlance: {
    purpose: "A truck is ready to go back into service",
    state: "VH003 is grounded; the repair is done; nothing else blocks it",
    nextAction: "Release VH003 to service",
  },
  budgets: {
    taps: 3,
    seconds: 20,
    wordsPerScreen: 80,
    foldWordsPerScreen: 40,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/**
 * Arrange as the technician (complete VH003's brake repair through the UI),
 * then measure the Administrateur from Home to Available.
 * Mutates the slot; reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive journey:release-to-service --role technician --viewport 390x844 --throttle phone --lang en
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, quiet, log, apiGet } = ctx;
  assertStartedAs(ctx, journey);
  await completeRepairAsTechnician(page, t, quiet);

  await signInAs(page, journey.actor.role);
  await quiet();
  const run = journeyRunner(ctx, journey);
  await run.screen("home", "Home as the Administrateur after the workshop finished the repair");

  // The repaired truck's To do row carries the next step as its verb.
  const releaseLink = page
    .locator("[data-slot=to-do-row]")
    .filter({ hasText: "VH003" })
    .getByRole("link", { name: t("Remettre en service", "Release"), exact: true })
    .first();
  await releaseLink.scrollIntoViewIfNeeded();
  await run.tap(releaseLink);
  await page.getByRole("heading", { level: 1, name: "VH003" }).waitFor({ timeout: 90_000 });
  await run.screen("vehicle", "VH003 as the Administrateur: repaired, waiting for release");

  const release = t("Remettre en service", "Release to service");
  await run.tap(page.getByRole("button", { name: release, exact: true }).first());
  const form = page.getByRole("dialog").last();
  await form.waitFor();
  await run.screen("confirm", "The release confirmation");

  await run.tap(form.getByRole("button", { name: release, exact: true }));
  await page.getByText(t("Disponible.", "Available."), { exact: true }).waitFor({ timeout: 30_000 });
  for (let i = 0; i < 3 && (await openPanels(page).count()) > 0; i += 1) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
  await run.screen("done", "VH003 released: available");

  const assetId = /\/assets\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";
  const after = await apiGet(`/v1/assets/${assetId}`);
  const state = (after.body as { availability?: { state?: string } }).availability?.state;
  if (after.status !== 200 || state !== "AVAILABLE") throw new Error(`GET /v1/assets/${assetId} → ${after.status} ${state ?? "?"}`);
  log(`api cross-check: VH003 availability ${state}`);
  run.finish();
};

export async function completeRepairAsTechnician(page: Page, t: (fr: string, en: string) => string, quiet: () => Promise<void>) {
  await page.goto(new URL("/assets", page.url()).toString());
  await page.locator("[data-slot='module-page-tabs']").getByRole("tab", { name: t("Camions", "Trucks") }).click();
  await page.getByRole("button", { name: /VH003/ }).first().click();
  await page.getByRole("heading", { level: 1, name: "VH003" }).waitFor({ timeout: 90_000 });
  await quiet();
  const status = page.locator("[role=status]").filter({ hasText: /^(Grounded|Immobilisé)/ }).first();
  // Derive from the state, not from what the last run meant to do: an earlier run may have completed it already.
  if ((await status.count()) === 0) return;
  await status.getByRole("button", { name: t("Terminer les travaux", "Complete work"), exact: true }).click();
  const dialog = page.getByRole("dialog").last();
  await dialog.waitFor();
  await dialog.getByLabel(t("Compte rendu", "Work summary")).fill("Brake lines bled, pressure sensor replaced");
  const noCost = dialog.getByRole("radio", { name: new RegExp(t("Aucun coût", "No cost"), "i") });
  if ((await noCost.count()) > 0) await noCost.first().check();
  await dialog.getByRole("button", { name: t("Terminer les travaux", "Complete work"), exact: true }).click();
  await page.getByText(new RegExp(`^${t("Travaux terminés", "Work completed")}`)).first().waitFor();
  await quiet();
  // Completing leaves the work order's panel open over the page.
  for (let i = 0; i < 3 && (await openPanels(page).count()) > 0; i += 1) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
}

/** Panels and dialogs, not toasts: Base UI toasts are role=dialog with aria-modal=false. */
function openPanels(page: Page) {
  return page.locator("[role=dialog]:not([aria-modal=false])");
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

export default drive;
