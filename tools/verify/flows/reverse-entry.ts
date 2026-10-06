import type { DriveScript } from "../browser.js";

/**
 * Entry detail → Reverse with a reason → the app lands on the new reversal entry,
 * which links back to the original; the original reads back as REVERSED.
 * Mutates the slot; reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:reverse-entry --role finance --lang en
 */
const flow: DriveScript = async ({ page, t, nav, shot, quiet, log, apiGet }) => {
  const list = await apiGet("/v1/finance/entries?status=POSTED");
  const entries = (list.body as { entries?: Array<{ id: string; entryNumber: string; reversesEntryId: string | null }> }).entries ?? [];
  const entry = entries.find((e) => e.reversesEntryId === null);
  if (entry === undefined) throw new Error(`GET /v1/finance/entries?status=POSTED → ${list.status}, nothing reversible`);
  log(`reversing ${entry.entryNumber}`);

  await nav(`/finance/entries/${entry.id}`);
  await page.getByRole("heading", { level: 1, name: t("Détail de l'écriture", "Entry detail") }).waitFor();
  await quiet();
  await page.getByRole("button", { name: t("Contre-passer l'écriture", "Reverse entry"), exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel(t("Motif du contre-passage", "Reason for reversal")).fill("Verification run: duplicate fuel receipt");
  await shot("reverse-dialog", { caption: "Reverse asks for a reason before anything changes" });
  await dialog.getByRole("button", { name: t("Contre-passer l'écriture", "Reverse entry"), exact: true }).click();
  await page.waitForURL((url) => url.pathname.startsWith("/finance/entries/") && !url.pathname.endsWith(entry.id), { timeout: 15_000 });
  await page.getByRole("button", { name: `${t("Extourne l'écriture", "Reverses entry")} #${entry.entryNumber}` }).waitFor();
  await quiet();
  await shot("reversal-entry", { caption: "The reversal is a new entry that links back to the original" });

  const original = await apiGet(`/v1/finance/entries/${entry.id}`);
  const body = original.body as { status?: string; reversedByEntryId?: string | null };
  if (body.status !== "REVERSED" || !body.reversedByEntryId) throw new Error(`original is ${body.status ?? original.status}`);
  log(`api cross-check: ${entry.entryNumber} is REVERSED, reversed by ${body.reversedByEntryId}`);
};

export default flow;
