import type { Page } from "playwright-core";
import { resolveAccount } from "../accounts.js";
import { openSidebar, signOutThroughNameMenu, type DriveScript } from "../browser.js";

interface WorkOrderRead {
  id: string;
  status: string;
  description: string;
  actualCostMinor: number | null;
  costToCome: { reason: string; awaitingApproval: boolean } | null;
  pendingCostLines: Array<{ entryId: string; entryNumber: string; amountMinor: number }> | null;
}

/**
 * The invoice that arrives after the repair is closed (#82): the technician
 * closes VH003's brake repair with "Invoice not received yet"; the order and
 * the truck's To do say the cost is still to come; he adds the invoice from
 * the To do with a reason, and it waits for Finance whatever the amount;
 * Finance approves it, the flag goes and the actual cost includes it.
 * Mutates the slot; reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:late-invoice --role technician --lang en
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
  const ref = order.id.slice(0, 8).toUpperCase();
  const readOrder = async () => {
    const response = await apiGet(`/v1/work-orders/${order.id}`);
    if (response.status !== 200) throw new Error(`GET /v1/work-orders/${order.id} → ${response.status}`);
    return response.body as WorkOrderRead;
  };
  const before = await readOrder();
  log(`work order ${ref} "${order.description}" APPROVED, actual cost so far ${String(before.actualCostMinor)}`);
  const closeDialogs = async () => {
    for (let i = 0; i < 3 && (await page.getByRole("dialog").count()) > 0; i += 1) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(400);
    }
  };

  await (await openSidebar(page)).getByRole("link", { name: t("Camions", "Trucks") }).click();
  await page.getByRole("button", { name: /VH003/ }).first().click();
  await page.getByRole("heading", { level: 1, name: "VH003" }).waitFor({ timeout: 90_000 });
  await quiet();
  await nav(`/assets/${asset.id}?panel=work_order:${order.id}`);
  let panel = page.getByRole("dialog").last();
  await panel.getByRole("button", { name: t("Terminer les travaux", "Complete work"), exact: true }).click();
  const close = page.getByRole("dialog").last();
  await close.getByLabel(t("Compte rendu", "Work summary")).fill("Brake lines bled, pressure sensor replaced");
  const pending = close.getByRole("button", { name: t("Facture pas encore reçue", "Invoice not received yet"), exact: true });
  await pending.click();
  await page.waitForTimeout(400);
  await shot("close-invoice-pending", {
    caption: "The technician closes the brake repair before the garage's invoice arrives",
    highlight: pending,
  });
  await close.getByRole("button", { name: t("Terminer les travaux", "Complete work"), exact: true }).click();
  await page.getByText(new RegExp(`^${t("Travaux terminés", "Work completed")}`)).first().waitFor();
  await quiet();

  const closed = await readOrder();
  if (closed.status !== "COMPLETED") throw new Error(`work order is ${closed.status} after the close`);
  if (closed.costToCome?.reason !== "INVOICE_PENDING") throw new Error(`costToCome is ${JSON.stringify(closed.costToCome)}`);
  log(`api cross-check: ${ref} COMPLETED, costToCome ${JSON.stringify(closed.costToCome)}`);

  await nav(`/assets/${asset.id}?panel=work_order:${order.id}`);
  panel = page.getByRole("dialog").last();
  const note = panel.getByText(
    t(
      "Coût à venir : les travaux ont été clôturés avant l'arrivée de la facture.",
      "Cost to come: the work was closed before the invoice arrived.",
    ),
  );
  await note.waitFor();
  await page.waitForTimeout(400);
  await shot("panel-cost-to-come", {
    caption: "The closed work order says its cost is still to come, and keeps Record expense",
    highlight: note,
  });
  await closeDialogs();

  await nav(`/assets/${asset.id}`);
  const todo = page.getByRole("listitem").filter({
    hasText: t(`Facture de la réparation ${ref} à saisir`, `Invoice for repair ${ref} to enter`),
  });
  await todo.waitFor();
  // Centred, so a phone's quick bar and the toast never cover its button.
  await todo.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await quiet();
  await page.waitForTimeout(400);
  await shot("todo-cost-to-come", {
    caption: "VH003's To do asks the workshop to enter the repair's invoice",
    highlight: todo,
  });
  await todo.getByRole("button", { name: t("Saisir une dépense", "Record expense"), exact: true }).click();

  const form = page.getByRole("dialog").last();
  await form.getByRole("combobox", { name: t("Catégorie", "Category") }).click();
  await page.getByRole("option", { name: t("Réparations", "Repairs") }).click();
  await form.getByLabel(t("Montant (FCFA)", "Amount (FCFA)")).fill("62000");
  const reason = form.getByLabel(t("Raison", "Reason"), { exact: true });
  await reason.fill(t("Facture reçue après clôture", "Invoice received after the close"));
  await reason.scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  await shot("late-invoice-form", {
    caption: "Same form as on an open order, plus a required reason; it goes to approval whatever the amount",
    highlight: form.getByText(
      t(
        "Ces travaux sont terminés : la facture passe en validation, quel que soit son montant.",
        "This work is completed: the invoice goes to approval, whatever its amount.",
      ),
    ),
  });
  await form.getByRole("button", { name: t("Enregistrer la dépense", "Record the expense"), exact: true }).click();
  await quiet();
  await page.waitForTimeout(800);

  const waiting = await readOrder();
  const line = waiting.pendingCostLines?.find((l) => l.amountMinor === 62_000);
  if (line === undefined) throw new Error(`no pending 62,000 line on ${ref}: ${JSON.stringify(waiting.pendingCostLines)}`);
  if (waiting.costToCome?.awaitingApproval !== true) throw new Error(`costToCome is ${JSON.stringify(waiting.costToCome)}`);
  log(`api cross-check: ${line.entryNumber} SUBMITTED on ${ref}, costToCome ${JSON.stringify(waiting.costToCome)}`);
  await nav(`/assets/${asset.id}?panel=work_order:${order.id}`);
  panel = page.getByRole("dialog").last();
  const awaiting = panel.getByText(
    t(
      "Coût à venir : la facture est saisie et attend sa validation.",
      "Cost to come: the invoice is recorded and awaits approval.",
    ),
  );
  await awaiting.waitFor();
  await page.waitForTimeout(400);
  await shot("awaiting-approval", {
    caption: `${line.entryNumber} waits for Finance even though a technician's 62,000 would post on an open order`,
    highlight: awaiting,
  });

  await closeDialogs();
  await signInAs(page, "finance");
  await nav("/finance/entries?view=waiting");
  await page.getByRole("heading", { level: 1, name: t("Argent", "Money") }).waitFor();
  // A table row on desktop, a list row on a phone: the button names the entry either way.
  const approve = page.getByRole("button", {
    name: `${t("Approuver l'écriture", "Approve entry")} ${line.entryNumber}`,
    exact: true,
  });
  await approve.waitFor();
  await quiet();
  await approve.evaluate((el) => el.scrollIntoView({ block: "center" }));
  await approve.hover();
  await page.waitForTimeout(800);
  await shot("finance-queue", { caption: `Signed in as Finance: ${line.entryNumber} waits in the approvals`, highlight: approve });
  await approve.click();
  await page.getByText(t("Écriture approuvée", "Entry approved")).first().waitFor();
  await quiet();

  const settled = await readOrder();
  if (settled.costToCome !== null) throw new Error(`costToCome still ${JSON.stringify(settled.costToCome)} after approval`);
  // The actual cost counts pending lines too (#81), so it is the close's plus the invoice.
  const expected = (closed.actualCostMinor ?? 0) + 62_000;
  if (settled.actualCostMinor !== expected) {
    throw new Error(`actual cost ${String(settled.actualCostMinor)}, expected ${expected}`);
  }
  log(`api cross-check: ${ref} costToCome null, actual cost ${settled.actualCostMinor}`);

  await nav(`/assets/${asset.id}?panel=work_order:${order.id}`);
  panel = page.getByRole("dialog").last();
  const actual = panel.getByText(t("Coût réel", "Actual cost"), { exact: true });
  await actual.waitFor();
  await quiet();
  if ((await panel.getByText(/^(Cost to come|Coût à venir)/).count()) !== 0) {
    throw new Error("the panel still says the cost is to come");
  }
  await page.waitForTimeout(400);
  await shot("settled", {
    caption: "Approved: the cost-to-come note is gone and the actual cost includes the late invoice",
    highlight: actual.locator(".."),
  });
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
