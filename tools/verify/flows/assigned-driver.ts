import { openSidebar, type DriveScript } from "../browser.js";

/**
 * VH003 → All actions → Change assigned driver → pick another member → Details
 * and History name the assigned driver, never the custodian (#91, ADR-0010).
 * Mutates the slot; reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:assigned-driver --role admin --lang en
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  const label = t("Chauffeur attitré", "Assigned driver");
  const banned = /custodian|gardien|responsable/i;
  const noOldWord = async (where: string) => {
    const text = await page.locator("main").innerText();
    const line = text.split("\n").find((l) => banned.test(l) && !/en attente d'un responsable/.test(l));
    if (line !== undefined) throw new Error(`${where} still says "${line}"`);
  };

  await (await openSidebar(page)).getByRole("link", { name: t("Camions", "Trucks") }).click();
  await page.getByRole("button", { name: /VH003/ }).first().click();
  await page.getByRole("heading", { level: 1, name: "VH003" }).waitFor({ timeout: 90_000 });
  const assetId = /\/assets\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";
  await quiet();
  // The facts line is hidden below md; on a phone the Details tab carries it.
  const facts = page.getByText(new RegExp(`^${label} `)).first();
  if ((page.viewportSize()?.width ?? 1440) >= 768) {
    await facts.waitFor({ timeout: 10_000 }).catch(() => {
      throw new Error(`the vehicle header never says "${label}"`);
    });
    await shot("header", { caption: "The vehicle header names the assigned driver", highlight: facts });
  } else {
    await shot("header", { caption: "The vehicle opens; on a phone the assigned driver sits in Details" });
  }

  const headerMore = page.getByRole("button", { name: t("Plus d'actions", "More actions"), exact: true });
  if (await headerMore.isVisible()) await headerMore.click();
  else await page.getByRole("toolbar", { name: t("Actions rapides", "Quick actions") }).getByRole("button", { name: t("Plus", "More"), exact: true }).click();
  const all = page.getByRole("dialog", { name: t("Toutes les actions", "All actions") });
  const action = all.getByRole("button", { name: new RegExp(t("Changer de chauffeur attitré", "Change assigned driver")) });
  await action.scrollIntoViewIfNeeded();
  // Let the sheet's scroll settle so the reel's beat shows the highlighted row.
  await page.waitForTimeout(600);
  await shot("all-actions", { caption: "All actions offers Change assigned driver", highlight: action });
  await action.click();

  const form = page.getByRole("dialog", { name: t("Changer de chauffeur attitré", "Change assigned driver") });
  await form.waitFor();
  await form.getByLabel(t("Nouveau chauffeur attitré", "New assigned driver"), { exact: true }).click();
  const nobody = t("Personne (retirer le chauffeur attitré)", "Nobody (clear the assigned driver)");
  const options = page.getByRole("option");
  await options.first().waitFor();
  const names = await options.allInnerTexts();
  const current = (await apiGet(`/v1/assets/${assetId}`)).body as { custodian?: { displayName?: string } | null };
  const pick = names.find((n) => n.trim() !== nobody && n.trim() !== current.custodian?.displayName);
  if (pick === undefined) throw new Error(`no other member to pick among ${JSON.stringify(names)}`);
  await options.filter({ hasText: pick.trim() }).first().click();
  await page.getByRole("listbox").waitFor({ state: "hidden" });
  await page.waitForTimeout(600);
  await shot("picked", {
    caption: `${pick.trim()} is picked as the new assigned driver`,
    highlight: form.getByLabel(t("Nouveau chauffeur attitré", "New assigned driver"), { exact: true }),
  });
  await form.getByRole("button", { name: t("Changer de chauffeur attitré", "Change assigned driver"), exact: true }).click();
  await form.waitFor({ state: "hidden" });
  await quiet();

  await page
    .getByRole("navigation", { name: t("Sections du véhicule", "Vehicle sections") })
    .getByRole("tab", { name: new RegExp(`^${t("Détails", "Details")}`) })
    .click();
  await page.waitForURL((url) => url.pathname.endsWith("/details"));
  await quiet();
  const row = page.getByText(label, { exact: true }).first();
  await row.waitFor();
  await noOldWord("Details");
  await shot("details", { caption: `Details shows ${pick.trim()} as the assigned driver`, highlight: row });

  await page
    .getByRole("navigation", { name: t("Sections du véhicule", "Vehicle sections") })
    .getByRole("tab", { name: new RegExp(`^${t("Historique", "History")}`) })
    .click();
  await page.waitForURL((url) => url.pathname.endsWith("/history"));
  await quiet();
  const event = page.getByText(t(`Nouveau chauffeur attitré : ${pick.trim()}`, `Assigned driver changed to ${pick.trim()}`)).first();
  await event.waitFor();
  await noOldWord("History");
  await shot("history", { caption: "History records the change as an assigned driver change", highlight: event });

  const after = await apiGet(`/v1/assets/${assetId}`);
  const asset = after.body as { custodian?: { displayName?: string } | null };
  if (after.status !== 200 || asset.custodian?.displayName !== pick.trim()) {
    throw new Error(`GET /v1/assets/${assetId} → ${after.status} custodian ${JSON.stringify(asset.custodian)}`);
  }
  log(`api cross-check: VH003 custodian (internal name) is ${asset.custodian.displayName}`);
};

export default flow;
