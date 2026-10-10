import type { Locator, Page } from "playwright-core";
import { openSidebar, signOutThroughNameMenu, type DriveContext, type DriveScript } from "../browser.js";
import { resolveAccount } from "../accounts.js";

/**
 * Release readiness and decision wording (#501, #500, #534, #515), on VH003.
 *
 * As the technician (start here): complete VH003's brake work order; its panel
 * says "stays grounded until released" in amber, as the header does (#500).
 * Then report a second, safety-critical problem. As the Administrateur:
 * Release to service is shown locked, naming that problem, because the server
 * refuses with SAFETY_ISSUE_OPEN (#501); the expense form's approver hint
 * lists both bands, then follows the typed amount to Direction (#534). As
 * Finance: Reject on a waiting entry names the entry and says what follows
 * (#515). Mutates the slot; reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:release-readiness --role technician --lang en --reel
 */
const STEERING = "Steering locks on the left at low speed";

const settle = (ctx: DriveContext) => ctx.page.waitForTimeout(700);

async function openVh003(ctx: DriveContext): Promise<string> {
  const { page, t, quiet } = ctx;
  await (await openSidebar(page)).getByRole("link", { name: t("Camions", "Trucks") }).click();
  await page.getByRole("button", { name: /VH003/ }).first().click();
  await page.getByRole("heading", { level: 1, name: "VH003" }).waitFor({ timeout: 90_000 });
  await quiet();
  const assetId = /\/assets\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (assetId === undefined) throw new Error(`no asset id in ${page.url()}`);
  return assetId;
}

async function closeDialogs(page: Page) {
  for (let i = 0; i < 4 && (await page.getByRole("dialog").count()) > 0; i += 1) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }
}

function statusBlock(ctx: DriveContext): Locator {
  return ctx.page
    .locator("[role=status][data-tone]")
    .filter({ hasText: /^(Grounded|Repair done|Available|Immobilisé|Réparation terminée|Disponible)/ })
    .first();
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

/** #500: the completed grounding order's note is amber, the header's tone. */
async function completeTheRepair(ctx: DriveContext) {
  const { page, t, shot, quiet } = ctx;
  const status = statusBlock(ctx);
  await status.getByRole("button", { name: t("Terminer les travaux", "Complete work"), exact: true }).click();
  const form = page.getByRole("dialog").last();
  await form.waitFor();
  await form.getByLabel(t("Compte rendu", "Work summary")).fill("Brake lines bled, pressure sensor replaced");
  const noCost = form.getByRole("radio", { name: new RegExp(t("Aucun coût", "No cost"), "i") });
  if ((await noCost.count()) > 0) await noCost.first().check();
  await form.getByRole("button", { name: t("Terminer les travaux", "Complete work"), exact: true }).click();
  await quiet();

  const note = page
    .getByRole("dialog")
    .last()
    .locator("[data-tone]")
    .filter({ hasText: t("reste immobilisé jusqu'à sa remise en service", "stays grounded until a manager releases it") });
  await note.waitFor({ timeout: 15_000 });
  await page.locator("[role=status][data-tone=waiting]").first().waitFor({ timeout: 15_000 });
  const tone = await note.getAttribute("data-tone");
  if (tone !== "warning") throw new Error(`the work order's note is ${tone}, the header amber`);
  await settle(ctx);
  await shot("note-amber", {
    caption: "Repair done: the work order's note is amber, like the vehicle header behind it",
    highlight: note,
  });
  await closeDialogs(page);
}

async function reportSteering(ctx: DriveContext) {
  const { page, t, quiet } = ctx;
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
}

/** #501: Release to service is locked while the steering problem is open, and says so. */
async function releaseLocked(ctx: DriveContext, assetId: string) {
  const { page, t, shot, log, apiGet } = ctx;
  const status = statusBlock(ctx);
  const release = status.getByRole("button", { name: t("Remettre en service", "Release to service"), exact: true });
  await release.waitFor();
  if (!(await release.isDisabled())) throw new Error("Release to service is offered while the steering problem is open");
  const reason = status.getByText(STEERING, { exact: false });
  await reason.waitFor({ timeout: 5_000 }).catch(() => {
    throw new Error("the locked release does not name the open steering problem");
  });
  await settle(ctx);
  await shot("release-locked", {
    caption: "Another safety-critical problem is open: Release to service is locked and names it",
    highlight: release.locator("xpath=.."),
  });

  const detail = await apiGet(`/v1/assets/${assetId}`);
  const others = (detail.body as { availability?: { otherOpenSafetyIssues?: Array<{ description: string }> } })
    .availability?.otherOpenSafetyIssues;
  if (others?.[0]?.description !== STEERING) throw new Error(`GET /v1/assets → otherOpenSafetyIssues ${JSON.stringify(others)}`);
  log(`api cross-check: availability.otherOpenSafetyIssues = [${others.map((o) => o.description).join(", ")}]`);
}

/** #534: the hint lists every waiting band, then follows the typed amount. */
async function approverHint(ctx: DriveContext) {
  const { page, t, shot } = ctx;
  await page
    .getByRole("button", { name: new RegExp(`^(${t("Saisir une dépense", "Record expense")}|${t("Dépense", "Expense")})$`) })
    .first()
    .click();
  const form = page.getByRole("dialog").last();
  const amount = form.getByLabel(t("Montant (FCFA)", "Amount (FCFA)"));
  await amount.waitFor();
  const hint = form.getByText(new RegExp(t("attend la Finance", "waits for Finance"))).first();
  await hint.waitFor();
  const both = await hint.textContent();
  if (!both?.includes(t("la Direction", "Direction"))) throw new Error(`the hint names one band only: ${both}`);
  await settle(ctx);
  await shot("hint-bands", { caption: "Before an amount is typed, the hint names both approval bands", highlight: hint });

  await amount.fill("1500000");
  const direction = form.getByText(
    new RegExp(t("^Au-delà de 1.000.000.FCFA, cette saisie attend la Direction\\.$", "^Above FCFA.1,000,000, this entry waits for the Director\\.$")),
  );
  await direction.waitFor({ timeout: 5_000 }).catch(() => {
    throw new Error("at 1,500,000 the hint does not name Direction");
  });
  await settle(ctx);
  await shot("hint-amount", { caption: "At 1,500,000 FCFA the hint names Direction, the band that decides it", highlight: direction });
  // Typed data: closing asks to discard first.
  await form.getByRole("button", { name: t("Annuler", "Cancel"), exact: true }).click();
  await page.getByRole("button", { name: t("Abandonner", "Discard"), exact: true }).click();
  await page.getByRole("dialog").first().waitFor({ state: "hidden" });
}

/** #515: the reject dialog names the entry and what follows. */
async function rejectDialog(ctx: DriveContext) {
  const { page, t, shot, quiet, apiGet, log } = ctx;
  const me = await apiGet("/v1/me");
  const principalId = (me.body as { principalId?: string }).principalId;
  const queue = await apiGet("/v1/finance/approvals");
  const entry = ((queue.body as {
    entries?: Array<{ entryNumber: string; submittedByPrincipalId: string; directionDecides: boolean; recordedBy: { displayName: string | null } }>;
  }).entries ?? []).find((item) => !item.directionDecides && item.submittedByPrincipalId !== principalId);
  if (entry === undefined) throw new Error("nothing waiting for Finance (reseed?)");

  await (await openSidebar(page)).getByRole("link", { name: t("Argent", "Money") }).click();
  await page.getByRole("heading", { level: 1, name: t("Argent", "Money") }).waitFor();
  await quiet();
  await page.getByRole("button", { name: t("En attente de votre approbation", "Waiting for your approval"), exact: true }).click();
  const row = page.locator("tr, [data-slot='data-table-row']").filter({ hasText: entry.entryNumber, visible: true });
  await row.waitFor();
  await quiet();
  await row.getByRole("button", { name: `${t("Rejeter l'écriture", "Reject entry")} ${entry.entryNumber}`, exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("textbox") });
  await dialog.waitFor();
  const describedBy = await dialog.getAttribute("aria-describedby");
  const description = page.locator(`[id="${describedBy ?? ""}"]`);
  const text = (await description.textContent()) ?? "";
  if (!text.startsWith(entry.entryNumber)) throw new Error(`the reject dialog does not name ${entry.entryNumber}: ${text}`);
  if (!text.includes(t("dans les comptes", "never counts in the books"))) throw new Error(`no consequence: ${text}`);
  log(`reject dialog: ${text}`);
  await settle(ctx);
  await shot("reject-dialog", {
    caption: `Reject names ${entry.entryNumber}, who reads the reason, and that it never counts in the books`,
    highlight: description,
  });
  await dialog.getByRole("button", { name: t("Garder l'écriture", "Keep entry"), exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
}

const flow: DriveScript = async (ctx) => {
  const { page } = ctx;
  const assetId = await openVh003(ctx);
  await completeTheRepair(ctx);
  await reportSteering(ctx);

  await signInAs(page, "admin");
  await openVh003(ctx);
  await releaseLocked(ctx, assetId);
  await approverHint(ctx);

  await signInAs(page, "finance");
  await rejectDialog(ctx);
};

export default flow;
