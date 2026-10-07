import { openSidebar, type DriveScript } from "../browser.js";

/**
 * VH003 → All actions → Add note: an empty submit lists what to fix and sends
 * nothing, its link puts the cursor in the field, then the note is added and
 * read back from the vehicle's history. Desktop or phone (--viewport 390x844).
 * Mutates the slot; reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:add-note --role manager --lang en
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  await (await openSidebar(page)).getByRole("link", { name: t("Camions", "Trucks") }).click();
  await page.getByRole("button", { name: /VH003/ }).first().click();
  await page.getByRole("heading", { level: 1, name: "VH003" }).waitFor();
  const assetId = /\/assets\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";
  await quiet();

  const more = page.getByRole("button", { name: t("Plus d'actions", "More actions"), exact: true });
  await ((await more.isVisible()) ? more : page.getByRole("button", { name: t("Plus", "More"), exact: true })).click();
  await page
    .getByRole("dialog", { name: t("Toutes les actions", "All actions") })
    .getByRole("button", { name: new RegExp(t("Ajouter une note", "Add note")) })
    .click();
  const form = page.getByRole("dialog", { name: t("Ajouter une note", "Add note") });
  const submit = form.getByRole("button", { name: t("Ajouter la note", "Add the note"), exact: true });
  await submit.waitFor();
  await shot("note-open", { caption: "Add note opens on the vehicle, pinned to VH003", highlight: form });

  await submit.click();
  const summary = form.getByRole("region", { name: t("1 point à corriger", "1 thing to fix") });
  await summary.waitFor();
  await shot("note-empty-submit", {
    caption: "An empty submit lists what to fix at the top and sends nothing",
    highlight: summary,
  });

  await summary.getByRole("button").click();
  const field = form.getByLabel("Note", { exact: true });
  await page
    .waitForFunction(() => document.activeElement?.getAttribute("name") === "body", undefined, { timeout: 2000 })
    .catch(() => {
      throw new Error("the summary link did not move focus to the Note field");
    });
  const body = `Spare wheel missing at handover (${new Date().toISOString().slice(11, 19)})`;
  await field.fill(body);
  await shot("note-filled", { caption: "The summary link put the cursor in the Note field; the note is typed", highlight: field });

  await submit.click();
  await form.waitFor({ state: "detached" });
  await quiet();
  await shot("note-added", { caption: "The panel closed and the toast confirms the note was added" });

  const { status, body: history } = await apiGet(`/v1/assets/${assetId}/history`);
  if (status !== 200 || !JSON.stringify(history).includes(body)) {
    throw new Error(`GET /v1/assets/${assetId}/history → ${status}; the note "${body}" is not in it`);
  }
  log(`api cross-check: VH003 history holds the note "${body}"`);
};

export default flow;
