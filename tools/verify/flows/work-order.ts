import { openSidebar, type DriveScript } from "../browser.js";

/**
 * VH003 Maintenance tab → create a work order from the open bodywork problem →
 * complete it with a repair cost. Reads the order back as COMPLETED with the cost.
 * Mutates the slot; reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:work-order --role technician --lang en
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  const assets = await apiGet("/v1/assets?search=VH003");
  const asset = ((assets.body as { items?: Array<{ id: string; assetCode: string }> }).items ?? []).find((a) => a.assetCode === "VH003");
  if (asset === undefined) throw new Error(`GET /v1/assets?search=VH003 → ${assets.status}`);
  const issues = await apiGet(`/v1/issues?assetId=${asset.id}`);
  const issue = ((issues.body as { items?: Array<{ id: string; status: string; safetyCritical: boolean; description?: string }> }).items ?? []).find(
    (i) => i.status === "OPEN" && !i.safetyCritical,
  );
  if (issue === undefined) throw new Error("no open, non-safety-critical problem on VH003 (reseed?)");
  const issueRef = issue.id.slice(0, 8).toUpperCase();
  log(`problem ${issueRef}: ${issue.description ?? ""}`);

  await (await openSidebar(page)).getByRole("link", { name: t("Camions", "Trucks") }).click();
  await page.getByRole("button", { name: /VH003/ }).first().click();
  await page.getByRole("heading", { level: 1, name: "VH003" }).waitFor();
  await page
    .getByRole("navigation", { name: t("Sections du véhicule", "Vehicle sections") })
    .getByRole("tab", { name: /^Maintenance/ })
    .click();
  await page.waitForURL((url) => url.pathname.endsWith("/maintenance"));
  await quiet();

  await page.getByRole("button", { name: new RegExp(`^${t("Actions pour", "Actions for")} .*${issueRef}`) }).click();
  await page.getByRole("menuitem", { name: new RegExp(`^${t("Créer un ordre de travail", "Create work order")}`) }).click();
  let dialog = page.getByRole("dialog");
  await dialog.waitFor();
  const description = dialog.getByLabel("Description");
  if ((await description.inputValue()) === "") await description.fill("Refit the rear mudguard bracket");
  await dialog.getByLabel(t("Coût prévu", "Expected cost")).fill("60000");
  await shot("new-work-order", { caption: "A work order is created from the reported problem" });
  await dialog.getByRole("button", { name: t("Créer l'ordre de travail", "Create the work order") }).click();
  await page.getByText(t("Ordre de travail ouvert", "Work order opened")).first().waitFor();
  await quiet();
  await shot("work-order-opened", { caption: "The work order is open" });

  const orders = await apiGet(`/v1/work-orders?assetId=${asset.id}`);
  const order = ((orders.body as { items?: Array<{ id: string; status: string; issue: { id: string } | null }> }).items ?? []).find((o) => o.issue?.id === issue.id);
  if (order === undefined) throw new Error("the new work order is not in GET /v1/work-orders");
  const orderRef = order.id.slice(0, 8).toUpperCase();
  log(`work order ${orderRef} is ${order.status}`);
  // Opening the order leaves the problem's record panel open on top of the tab.
  for (let i = 0; i < 3 && (await page.getByRole("dialog").count()) > 0; i += 1) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
  }

  await page.getByRole("button", { name: new RegExp(`^${t("Actions pour", "Actions for")} .*${orderRef}`) }).click();
  await page.getByRole("menuitem", { name: new RegExp(`^${t("Terminer les travaux", "Complete work")}`) }).click();
  dialog = page.getByRole("dialog");
  await dialog.getByLabel(t("Compte rendu", "Work summary")).fill("Bracket replaced, mudguard refitted");
  await dialog.getByLabel(t("Combien a coûté la réparation ?", "How much did the repair cost?")).fill("55000");
  await shot("complete-with-cost", { caption: "Completing asks for the cost: 55,000 XAF" });
  await dialog.getByRole("button", { name: t("Terminer les travaux", "Complete work") }).click();
  await page.getByText(new RegExp(`^${t("Travaux terminés", "Work completed")}`)).first().waitFor();
  await quiet();
  await shot("work-order-completed", { caption: "The work order is completed with its cost booked" });

  const after = await apiGet(`/v1/work-orders/${order.id}`);
  const done = after.body as { status?: string; actualCostMinor?: number | null; costOutcome?: string | null };
  if (after.status !== 200 || !["COMPLETED", "COMPLETION_SUBMITTED"].includes(done.status ?? "")) throw new Error(`work order is ${done.status ?? after.status}`);
  if (done.actualCostMinor !== 55_000) throw new Error(`actual cost is ${String(done.actualCostMinor)}, expected 55000`);
  log(`api cross-check: ${orderRef} ${done.status}, actual cost ${done.actualCostMinor} XAF, cost outcome ${done.costOutcome ?? "?"}`);
};

export default flow;
