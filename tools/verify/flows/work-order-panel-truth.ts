import type { Page } from "playwright-core";
import { resolveAccount } from "../accounts.js";
import { openSidebar, signOutThroughNameMenu, type DriveScript } from "../browser.js";

interface WorkOrderRead {
  id: string;
  status: string;
  actualCostMinor: number | null;
  costLines: Array<{ amountMinor: number }> | null;
  pendingCostLines: Array<{ amountMinor: number; entryNumber: string }> | null;
}

const STEERING = "Steering locks on the left at low speed";

/**
 * What the work-order panel says once the repair is closed (#588, #612), on VH003.
 * As the technician (start here): close the brake repair with "Invoice not
 * received yet", record the 62,000 invoice (it waits for review), and report
 * a second safety-critical problem. As Finance, who has no step on the order:
 * the panel's note and its footer name that problem as what holds the truck,
 * not a manager (#588); the Costs list shows the pending invoice, marked
 * "Awaiting review", so it adds up to the Actual cost (#612). Captures only,
 * so the same script records the before and after runs side by side.
 * Mutates the slot; reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:work-order-panel-truth --role technician --lang en --reel
 */
const flow: DriveScript = async ({ page, t, nav, shot, quiet, log, apiGet }) => {
  const assets = await apiGet("/v1/assets?search=VH003");
  const asset = ((assets.body as { items?: Array<{ id: string; assetCode: string }> }).items ?? []).find(
    (a) => a.assetCode === "VH003",
  );
  if (asset === undefined) throw new Error(`GET /v1/assets?search=VH003 → ${assets.status}`);
  const orders = await apiGet(`/v1/work-orders?assetId=${asset.id}`);
  const order = ((orders.body as { items?: WorkOrderRead[] }).items ?? []).find((o) => o.status === "APPROVED");
  if (order === undefined) throw new Error("no approved work order on VH003 (reseed?)");
  const panelUrl = `/assets/${asset.id}?panel=work_order:${order.id}`;
  const closeDialogs = async () => {
    for (let i = 0; i < 4 && (await page.getByRole("dialog").count()) > 0; i += 1) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
  };

  await (await openSidebar(page)).getByRole("link", { name: t("Camions", "Trucks") }).click();
  await page.getByRole("button", { name: /VH003/ }).first().click();
  await page.getByRole("heading", { level: 1, name: "VH003" }).waitFor({ timeout: 90_000 });
  await quiet();

  // Close with the invoice still to come.
  await nav(panelUrl);
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: t("Terminer les travaux", "Complete work"), exact: true })
    .click();
  const close = page.getByRole("dialog").last();
  await close.getByLabel(t("Compte rendu", "Work summary")).fill("Brake lines bled, pressure sensor replaced");
  await close.getByRole("button", { name: t("Facture pas encore reçue", "Invoice not received yet"), exact: true }).click();
  await close.getByRole("button", { name: t("Terminer les travaux", "Complete work"), exact: true }).click();
  await page.getByText(new RegExp(`^${t("Travaux terminés", "Work completed")}`)).first().waitFor();
  await quiet();

  // The invoice arrives; it waits for Finance.
  await nav(panelUrl);
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: t("Saisir une dépense", "Record expense"), exact: true })
    .click();
  const form = page.getByRole("dialog").last();
  await form.getByRole("combobox", { name: t("Catégorie", "Category") }).click();
  await page.getByRole("option", { name: t("Réparations", "Repairs") }).click();
  await form.getByLabel(t("Montant (FCFA)", "Amount (FCFA)")).fill("62000");
  await form.getByLabel(t("Raison", "Reason"), { exact: true }).fill(t("Facture reçue après clôture", "Invoice received after the close"));
  await form.getByRole("button", { name: t("Enregistrer la dépense", "Record the expense"), exact: true }).click();
  await quiet();
  await page.waitForTimeout(800);
  await closeDialogs();

  // A second safety-critical problem on the same truck.
  await nav(`/assets/${asset.id}`);
  await page
    .getByRole("button", { name: new RegExp(`^(${t("Signaler un problème", "Report a problem")}|${t("Problème", "Problem")})$`) })
    .first()
    .click();
  const report = page.getByRole("dialog", { name: t("Signaler un problème", "Report a problem") });
  await report.waitFor();
  await report.getByLabel("Description").fill(STEERING);
  await report.getByRole("checkbox", { name: t("Critique pour la sécurité", "Safety-critical") }).check();
  await report.getByRole("button", { name: t("Signaler le problème", "Report the problem") }).click();
  await page.getByText(t("Problème signalé", "Problem reported")).first().waitFor();
  await quiet();
  await closeDialogs();

  const read = await apiGet(`/v1/work-orders/${order.id}`);
  const wo = read.body as WorkOrderRead;
  const listed = [...(wo.costLines ?? []), ...(wo.pendingCostLines ?? [])].reduce((sum, l) => sum + l.amountMinor, 0);
  log(
    `api cross-check: ${wo.status}, actualCostMinor ${String(wo.actualCostMinor)}, lines listed ${listed} (pending ${JSON.stringify(wo.pendingCostLines?.map((l) => l.entryNumber))})`,
  );

  // Finance has no step on a completed order, so the footer says what it waits on.
  await signInAs(page, "finance");
  await nav(panelUrl);
  const panel = page.getByRole("dialog").last();
  await panel.getByText(t("Coût réel", "Actual cost"), { exact: true }).waitFor({ timeout: 30_000 });
  await quiet();
  await page.waitForTimeout(600);
  await shot("panel-note", {
    caption: "Finance opens the closed brake repair: what does the note say holds the truck?",
    highlight: panel.locator("[data-tone]").first(),
  });
  const costs = panel.getByRole("heading", { name: t("Coûts", "Costs"), exact: true });
  await costs.scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await shot("panel-costs", {
    caption: "Actual cost counts the 62,000 invoice awaiting review: does the Costs list show it?",
    highlight: costs.locator("xpath=ancestor::section[1]"),
  });
  const footer = panel.locator("[data-slot='sheet-footer']");
  if ((await footer.count()) > 0) {
    await page.waitForTimeout(400);
    await shot("panel-footer", {
      caption: "The footer line: who the truck is waiting on",
      highlight: footer.first(),
    });
  } else {
    log("no footer on the panel");
  }
};

async function signInAs(page: Page, role: string) {
  const account = resolveAccount(role);
  await signOutThroughNameMenu(page);
  await page.getByLabel(/^(Espace de travail|Workspace)$/).fill(account.workspace);
  await page.getByLabel(/^(Nom d'utilisateur|Username)$/).fill(account.username);
  await page.getByLabel(/^(Code PIN|PIN code)$/).fill(account.pin);
  await page.getByRole("button", { name: /^(Se connecter|Sign in)$/ }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

export default flow;
