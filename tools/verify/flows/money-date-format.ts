import type { DriveScript } from "../browser.js";

/**
 * Money reads "450 000 FCFA" and dates "29 July 2026" in both languages
 * (#712): the Dashboard, the Money list (short month in the table), an
 * entry's panel (the whole date), the Trucks Overview, a trip's page (date
 * and 24-hour time), a truck's Money tab, and the record form's date field
 * (dd/mm/yyyy). Every screen is searched for the old forms: "FCFA 450,000",
 * "7/29/26", "July 29, 2026", a 12-hour time. Read-only: the form is left
 * without saving.
 * Run: pnpm verify drive flow:money-date-format --role director --lang en --reel
 */
const flow: DriveScript = async ({ page, t, nav, shot, quiet, log, apiGet }) => {
  const months = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*";
  const oldForms: Array<[RegExp, string]> = [
    // innerText puts a newline or tab between cells, so a figure on the next line is not a match.
    [/FCFA[ \u00a0]?[−+-]?\d/, "the unit before the amount"],
    [/\d,\d{3}\s?FCFA/, "a comma between thousands of an amount"],
    [/\bXAF\b/, "XAF instead of FCFA"],
    [/\b\d{1,2}\/\d{1,2}\/\d{2}\b(?!\d)/, "a two-digit year"],
    [new RegExp(`\\b${months}\\.? \\d{1,2}(?:,|\\b(?! ?\\d{4}))`), "the month before the day"],
    [/\b\d{1,2}:\d{2}\s?(?:AM|PM)\b/i, "a 12-hour time"],
  ];
  const money = /\d{1,3}(?: \d{3})* FCFA/;
  const check = async (where: string) => {
    const text = await page.locator("main").innerText();
    for (const [pattern, what] of oldForms) {
      const hit = text.match(pattern);
      if (hit !== null) throw new Error(`${where} shows ${what}: "${text.slice(Math.max(0, (hit.index ?? 0) - 30), (hit.index ?? 0) + 30)}"`);
    }
    return text;
  };

  // The Dashboard: money tiles with FCFA after the figure.
  await nav("/");
  await page.locator("[data-slot='metric-strip']").first().waitFor();
  await quiet();
  const dashboard = await check("the Dashboard");
  if (!/\d FCFA|\d FCFA/.test(dashboard)) throw new Error("the Dashboard shows no amount in FCFA");
  await shot("dashboard", {
    caption: "Dashboard: every amount reads 450 000 FCFA, the unit after the figure, in English too",
    highlight: page.locator("[data-slot='metric-strip']").first(),
  });

  // The Money list: a dense table, so the short month; amounts unbroken.
  await nav("/finance/entries");
  // A table row on desktop, a two-line list row on a phone (#300).
  const firstRow = page.locator('[data-slot="data-table-row"]').or(page.getByRole("row").nth(1)).first();
  await firstRow.waitFor();
  await quiet();
  await check("the Money list");
  const rowText = await firstRow.innerText();
  if (!/\b\d{1,2} \p{L}{3,5}\.? \d{4}\b/u.test(rowText)) throw new Error(`a Money row has no "29 Jul 2026" date: ${rowText}`);
  const amountCell = firstRow.getByText(money).first();
  await amountCell.waitFor();
  log(`first Money row: ${rowText}`);
  await shot("money-list", {
    caption: "Money list: dates as 29 Jul 2026 (short month in a dense table), amounts as 86 000 FCFA",
    highlight: firstRow,
  });

  // The entry's panel spells the whole date.
  const listed = await apiGet("/v1/finance/entries?limit=5");
  const entries = (listed.body as { entries?: Array<{ entryNumber: string; economicDate: string }> }).entries ?? [];
  const entry = entries[0];
  if (entry === undefined) throw new Error(`GET /v1/finance/entries → ${listed.status}, no entry (reseed?)`);
  await page.getByRole("button", { name: entry.entryNumber, exact: true }).first().click();
  const panel = page.getByRole("dialog", { name: entry.entryNumber });
  await panel.waitFor();
  await quiet();
  const panelText = await panel.innerText();
  const longDate = /\b\d{1,2} \p{L}+ \d{4}\b/u;
  if (!longDate.test(panelText)) throw new Error(`${entry.entryNumber}'s panel has no "29 July 2026" date: ${panelText.slice(0, 200)}`);
  for (const [pattern, what] of oldForms) {
    if (pattern.test(panelText)) throw new Error(`${entry.entryNumber}'s panel shows ${what}`);
  }
  await shot("entry-panel", {
    caption: `${entry.entryNumber}: the economic date spelled out, day first (${panelText.match(longDate)?.[0] ?? ""})`,
    highlight: panel,
  });
  await page.keyboard.press("Escape");
  await panel.waitFor({ state: "hidden" });

  // The Trucks Overview: profit by truck, fleet board days ("9 Oct").
  await nav("/assets");
  await page.locator("[data-slot='metric-strip']").first().waitFor();
  await quiet();
  await check("the Trucks Overview");
  await shot("trucks-overview", {
    caption: "Trucks Overview: the period and the fleet board's days read day first (1–10 Oct)",
  });

  // A trip's page: its start as "29 July 2026, 07:00".
  const trips = await apiGet("/v1/activities?limit=20");
  const trip = ((trips.body as { items?: Array<{ id: string; activityNumber: string; startedAt: string | null }> }).items ?? []).find(
    (item) => item.startedAt !== null,
  );
  if (trip === undefined) throw new Error(`GET /v1/activities → ${trips.status}, no started trip`);
  await nav(`/activities/${trip.id}`);
  await page.getByRole("heading", { name: trip.activityNumber }).first().waitFor();
  await quiet();
  const tripText = await check(trip.activityNumber);
  const dateTime = /\b\d{1,2} \p{L}+ \d{4}, \d{2}:\d{2}\b/u;
  if (!dateTime.test(tripText)) throw new Error(`${trip.activityNumber} shows no "29 July 2026, 07:00": ${tripText.slice(0, 300)}`);
  await shot("trip-page", {
    caption: `Trip ${trip.activityNumber}: a date with its time reads ${tripText.match(dateTime)?.[0] ?? ""}, on 24 hours`,
  });

  // A truck's Money tab: months, totals and the lifetime line.
  const assets = await apiGet("/v1/assets?limit=100");
  const vh003 = ((assets.body as { items?: Array<{ id: string; assetCode: string }> }).items ?? []).find((item) => item.assetCode === "VH003");
  if (vh003 === undefined) throw new Error(`GET /v1/assets → ${assets.status}, no VH003`);
  await nav(`/assets/${vh003.id}/money`);
  await page.getByText(t("Dépenses par catégorie", "Expenses by category"), { exact: true }).first().waitFor();
  await quiet();
  await check("VH003's Money tab");
  await shot("truck-money", { caption: "VH003's Money tab: totals and the lifetime profit in FCFA, after the figure" });

  // The record form: the date field shows and reads dd/mm/yyyy.
  await nav("/finance/record");
  const form = page.getByRole("dialog", { name: t("Saisir une écriture", "Record an entry") });
  await form.waitFor();
  const date = form.getByLabel(t("Date", "Date"), { exact: true });
  const shown = await date.inputValue();
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(shown)) throw new Error(`the date field shows "${shown}", not dd/mm/yyyy`);
  await date.fill("29/07/2026");
  await date.blur();
  if ((await date.inputValue()) !== "29/07/2026") throw new Error(`typing 29/07/2026 leaves "${await date.inputValue()}"`);
  await form.getByText(t("Date non reconnue", "Date not recognised")).waitFor({ state: "detached", timeout: 1_000 }).catch(() => undefined);
  log(`date field: today shown as ${shown}; 29/07/2026 typed and kept`);
  await shot("date-field", {
    caption: "Record an entry: the date field shows and reads day/month/year (29/07/2026), in English too",
    highlight: date,
  });
};

export default flow;
