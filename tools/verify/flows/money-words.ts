import { openSidebar, type DriveScript } from "../browser.js";

/**
 * Money says Revenue, Expenses, Profit and Loss on every screen (#659). The
 * Money page's tiles read Expenses / Revenue (Dépenses / Recettes); a trip
 * that made money reads "Profit", one that lost money "Loss" with an unsigned
 * amount, in its overview tile and its money card; a truck's lifetime line
 * names its profit or loss, and its chart says Expenses by category. Read-only.
 * Seed facts (transports-ngwa): DLA-2026-00001 nets +2,850,000 posted,
 * DLA-2026-00002 −86,000; VH003 lifetime +1,505,000, VH001 −171,000.
 * Run: pnpm verify drive flow:money-words --role director --lang en --reel
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet, nav }) => {
  const retired = /\b(contribution|margin|marge|money in|money out|entrées|sorties)\b|\bNet\b/i;
  const assertNoRetiredWords = async (where: string) => {
    const text = (await page.locator("main").textContent()) ?? "";
    const hit = text.match(retired);
    if (hit !== null) throw new Error(`${where} still says "${hit[0]}"`);
  };

  await (await openSidebar(page)).getByRole("link", { name: t("Argent", "Money") }).click();
  await page.getByRole("heading", { level: 1, name: t("Argent", "Money") }).waitFor();
  await quiet();
  // The Money Overview's tiles (#664) are links to their tab, named by the word itself.
  const expensesTile = page.locator("[data-metric='expenses']").getByText(t("Dépenses", "Expenses"), { exact: true });
  const revenueTile = page.locator("[data-metric='revenue']").getByText(t("Recettes", "Revenue"), { exact: true });
  await expensesTile.waitFor();
  await revenueTile.waitFor();
  await assertNoRetiredWords("the Money page");
  await shot("money-tiles", {
    caption: "Money: the month's tiles say Expenses and Revenue, the same words in French (Dépenses, Recettes)",
    highlight: page.locator("[data-slot='metric-strip']"),
  });

  type Trip = { id: string; activityNumber: string };
  const list = await apiGet("/v1/activities?limit=100");
  const trips = (list.body as { items?: Trip[] }).items ?? [];
  const trip = (number: string) => {
    const found = trips.find((item) => item.activityNumber === number);
    if (found === undefined) throw new Error(`GET /v1/activities → ${list.status}, no ${number} (reseed?)`);
    return found;
  };

  for (const [number, word, amount, caption] of [
    ["DLA-2026-00001", t("Bénéfice", "Profit"), /2[ ,  ]850[ ,  ]000/, "made money: the tile and the money card say Profit"],
    ["DLA-2026-00002", t("Perte", "Loss"), /86[ ,  ]000/, "lost money: Loss 86,000, never Profit −86,000"],
  ] as const) {
    const { id } = trip(number);
    await nav(`/activities/${id}`);
    await page.getByRole("heading", { name: number }).first().waitFor();
    await quiet();
    const tile = page.locator("[data-slot='metric-tile']").filter({ has: page.getByText(word, { exact: true }) });
    await tile.waitFor();
    const tileText = (await tile.textContent()) ?? "";
    if (!amount.test(tileText) || tileText.includes("−")) throw new Error(`${number} tile reads "${tileText}"`);
    await assertNoRetiredWords(number);
    await shot(`${number}-tile`, { caption: `Trip ${number} ${caption}`, highlight: tile });

    // The money card's closing row, not the overview tile's label (also a <dt>).
    const row = page.locator("xpath=//dt[not(ancestor::*[@data-slot='metric-tile'])]").filter({ hasText: word }).first();
    await row.scrollIntoViewIfNeeded();
    const value = (await row.locator("xpath=following-sibling::dd[1]").textContent()) ?? "";
    if (!amount.test(value) || value.includes("−")) throw new Error(`${number} money row reads "${value}"`);
    log(`${number}: tile "${tileText.trim()}", row "${word} ${value.trim()}"`);
    await shot(`${number}-row`, {
      caption: `Its money card ends on the same word: ${word}`,
      highlight: row.locator("xpath=ancestor::*[@data-slot='card'][1]"),
    });
  }

  type Asset = { id: string; assetCode: string };
  const assets = await apiGet("/v1/assets?limit=100");
  const assetItems = (assets.body as { items?: Asset[] }).items ?? [];
  for (const [code, word, amount] of [
    ["VH003", t("Bénéfice", "Profit"), /1[ ,  ]505[ ,  ]000/],
    ["VH001", t("Perte", "Loss"), /171[ ,  ]000/],
  ] as const) {
    const asset = assetItems.find((item) => item.assetCode === code);
    if (asset === undefined) throw new Error(`GET /v1/assets → ${assets.status}, no ${code}`);
    await nav(`/assets/${asset.id}/money`);
    await page.getByRole("heading", { name: new RegExp(`^${t("Argent", "Money")} · `) }).waitFor();
    await quiet();
    await page.getByText(t("Dépenses par catégorie", "Expenses by category"), { exact: true }).first().waitFor();
    const lifetime = page.getByText(new RegExp(t("Depuis l'enregistrement, toutes écritures", "Lifetime, all posted entries")));
    await lifetime.scrollIntoViewIfNeeded();
    const text = (await lifetime.textContent()) ?? "";
    if (!new RegExp(`${word} [^·]*`).test(text) || !amount.test(text) || /\bnet\b/i.test(text)) {
      throw new Error(`${code} lifetime line reads "${text}"`);
    }
    await assertNoRetiredWords(`${code} Money tab`);
    log(`${code}: ${text}`);
    await shot(`${code}-lifetime`, {
      caption: `${code}'s Money tab: the lifetime line names its ${word.toLowerCase()} in words`,
      highlight: lifetime,
    });
  }
};

export default flow;
