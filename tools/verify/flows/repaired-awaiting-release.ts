import type { Page } from "playwright-core";
import { openSidebar, type DriveScript } from "../browser.js";
import { DEMO_WORKSPACE, resolveAccount } from "../accounts.js";

/**
 * VH003's brake repair from grounded to released (#92): the technician
 * completes the work order and the status block turns amber, "Repair done,
 * waiting for release to service", with no release button for him; the
 * Administrateur then sees Release to service, releases, and it turns green.
 * Mutates the slot; reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:repaired-awaiting-release --role technician --lang en
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  // The header's status block, not a toast: it opens with one of these leads.
  const status = page
    .locator("[role=status]")
    .filter({ hasText: /^(Grounded|Repair done|Available|Immobilisé|Réparation terminée|Disponible)/ })
    .first();
  const repairedLead = t("Réparation terminée — en attente de remise en service.", "Repair done — waiting for release to service.");
  const release = t("Remettre en service", "Release to service");

  const openVh003 = async () => {
    await (await openSidebar(page)).getByRole("link", { name: t("Camions", "Trucks") }).click();
    await page.getByRole("button", { name: /VH003/ }).first().click();
    await page.getByRole("heading", { level: 1, name: "VH003" }).waitFor({ timeout: 90_000 });
    await quiet();
  };
  // develop before #92 has no data-tone; "unknown" lets a before run reach the completion.
  const tone = async () => (await status.getAttribute("data-tone")) ?? "unknown";
  const settle = () => page.waitForTimeout(600);

  await openVh003();
  const assetId = /\/assets\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";
  if (!["critical", "unknown"].includes(await tone())) throw new Error(`VH003 should start red, got ${await tone()}`);
  await shot("grounded", { caption: "The brake repair is in progress: VH003 is red, grounded", highlight: status });

  await status.getByRole("button", { name: t("Terminer les travaux", "Complete work"), exact: true }).click();
  const dialog = page.getByRole("dialog").last();
  await dialog.waitFor();
  await dialog.getByLabel(t("Compte rendu", "Work summary")).fill("Brake lines bled, pressure sensor replaced");
  const noCost = dialog.getByRole("radio", { name: new RegExp(t("Aucun coût", "No cost"), "i") });
  if ((await noCost.count()) > 0) await noCost.first().check();
  await dialog.getByRole("button", { name: t("Terminer les travaux", "Complete work"), exact: true }).click();
  await page.getByText(new RegExp(`^${t("Travaux terminés", "Work completed")}`)).first().waitFor();
  await quiet();
  // Completing leaves the work order's record panel open over the header.
  for (let i = 0; i < 3 && (await page.getByRole("dialog").count()) > 0; i += 1) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
  await page.getByText(repairedLead, { exact: true }).waitFor({ timeout: 15_000 }).catch(() => {
    throw new Error("the header stays red after the repair");
  });
  await settle();
  if ((await tone()) !== "waiting") throw new Error(`expected amber, got ${await tone()}`);
  if ((await status.getByRole("button", { name: release, exact: true }).count()) !== 0) {
    throw new Error("the technician who completed the repair is offered the release");
  }
  await shot("repaired-technician", {
    caption: "Repair done: amber, waiting on a manager. The technician gets no release button",
    highlight: status,
  });

  await signInAs(page, "admin");
  await openVh003();
  if ((await tone()) !== "waiting") throw new Error(`the Administrateur should see amber, got ${await tone()}`);
  const releaseButton = status.getByRole("button", { name: release, exact: true });
  if (await releaseButton.isDisabled()) throw new Error("Release to service is locked for the Administrateur");
  await shot("repaired-admin", { caption: "The Administrateur sees the same amber state with Release to service", highlight: releaseButton });

  await releaseButton.click();
  const form = page.getByRole("dialog").last();
  await form.waitFor();
  await settle();
  await shot("release-form", { caption: "Releasing asks the Administrateur to confirm" });
  await form.getByRole("button", { name: release, exact: true }).click();
  await quiet();
  await page.getByText(t("Disponible.", "Available."), { exact: true }).waitFor({ timeout: 15_000 });
  for (let i = 0; i < 3 && (await page.getByRole("dialog").count()) > 0; i += 1) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
  await settle();
  if ((await tone()) !== "success") throw new Error(`expected green after release, got ${await tone()}`);
  await shot("released", { caption: "Released to service: VH003 is green, available", highlight: status });

  const after = await apiGet(`/v1/assets/${assetId}`);
  const state = (after.body as { availability?: { state?: string } }).availability?.state;
  if (after.status !== 200 || state !== "AVAILABLE") throw new Error(`GET /v1/assets/${assetId} → ${after.status} ${state ?? "?"}`);
  log(`api cross-check: VH003 availability ${state}`);
};

async function signInAs(page: Page, role: string) {
  const account = resolveAccount(role);
  // On a phone Sign out sits in the menu sheet, outside its navigation landmark.
  await openSidebar(page);
  await page.getByRole("button", { name: /^(Se déconnecter|Sign out)$/ }).filter({ visible: true }).first().click();
  await page.waitForURL((url) => url.pathname === "/login");
  await page.getByLabel(/^(Espace de travail|Workspace)$/).fill(DEMO_WORKSPACE);
  await page.getByLabel(/^(Nom d'utilisateur|Username)$/).fill(account.username);
  await page.getByLabel(/^(Code PIN|PIN code)$/).fill(account.pin);
  await page.getByRole("button", { name: /^(Se connecter|Sign in)$/ }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

export default flow;
