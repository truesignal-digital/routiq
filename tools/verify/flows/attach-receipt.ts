import { openSidebar, type DriveScript } from "../browser.js";

/**
 * Upload through object storage: VH003 → To do → "Attach receipt" on an entry
 * without proof → upload a PNG → the entry's evidence reads back as supplied.
 * Exercises presign → browser PUT to storage → finalize. Mutates the slot.
 * Run: pnpm verify drive flow:attach-receipt --role manager --lang en
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  await (await openSidebar(page)).getByRole("link", { name: t("Camions", "Trucks") }).click();
  await page.getByRole("button", { name: /VH003/ }).first().click();
  await page.getByRole("heading", { level: 1, name: "VH003" }).waitFor();
  await quiet();

  const missing = await apiGet("/v1/finance/entries?evidence=MISSING");
  const before = (missing.body as { entries?: Array<{ id: string; entryNumber: string }> }).entries ?? [];
  const attachLabel = t("Joindre le reçu", "Attach receipt");
  let entry: { id: string; entryNumber: string } | undefined;
  let attach = page.getByRole("button", { name: attachLabel }).first();
  for (const candidate of before) {
    // The innermost element holding both the entry number and an Attach button is that entry's to-do item.
    const item = page.locator("li, div").filter({ hasText: candidate.entryNumber }).filter({ has: page.getByRole("button", { name: attachLabel }) }).last();
    if ((await item.count()) > 0) {
      entry = candidate;
      attach = item.getByRole("button", { name: attachLabel });
      break;
    }
  }
  if (entry === undefined) throw new Error("no To do item offers Attach receipt for an entry from GET /v1/finance/entries?evidence=MISSING");
  log(`attaching a receipt to ${entry.entryNumber}`);

  const receipt = await page.screenshot({ type: "png" });
  await attach.click();
  const dialog = page.getByRole("dialog", { name: t("Joindre un reçu", "Attach a receipt") });
  await dialog.waitFor();
  await dialog.getByLabel(t("Déposez les fichiers ici ou cliquez pour choisir", "Drop files here or click to choose")).setInputFiles({
    name: "receipt.png",
    mimeType: "image/png",
    buffer: receipt,
  });
  await shot("receipt-chosen");
  await dialog.getByRole("button", { name: t("Joindre", "Attach"), exact: true }).click();
  await dialog.waitFor({ state: "hidden", timeout: 20_000 });
  await quiet();
  await shot("receipt-attached");

  const after = await apiGet(`/v1/finance/entries/${entry.id}`);
  const evidence = (after.body as { evidence?: { state?: string; artifactCount?: number } }).evidence;
  if (evidence?.state === "NOT_SUPPLIED" || (evidence?.artifactCount ?? 0) < 1) throw new Error(`evidence after upload: ${JSON.stringify(evidence)}`);
  log(`api cross-check: ${entry.entryNumber} evidence ${evidence?.state ?? "?"}, ${evidence?.artifactCount ?? 0} file(s)`);
};

export default flow;
