import { openSidebar, type DriveScript } from "../browser.js";

/**
 * Money is a module page (#664): one header (Money, one sentence, Record an
 * expense) over Overview · Entries · To approve. The Overview's tiles match
 * `GET /v1/finance/overview` and `GET /v1/finance/summary`, the range picker
 * lives in the address, a tile opens its tab already filtered, Entries starts
 * with its filters (Missing receipt with its count, no tiles), To approve
 * decides an entry, Back lands on the tab you came from, and the old links
 * land on To approve. A role with no queue (the cashier) sees no To approve
 * tab and no profit. Mutates the slot for an approver (one approval); reset
 * with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:money-page --role finance --lang en --reel
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  type Window = { revenueMinor: number; expenseMinor: number };
  const overview = await apiGet("/v1/finance/overview");
  const ov = overview.body as { view?: string; period?: Window; currency?: string };
  if (overview.status !== 200 || ov.period === undefined) throw new Error(`GET /v1/finance/overview → ${overview.status}`);
  const summary = await apiGet("/v1/finance/summary");
  const body = summary.body as { waiting?: { count: number } | null; missingReceipt?: { count: number } };
  if (summary.status !== 200 || body.missingReceipt === undefined) throw new Error(`GET /v1/finance/summary → ${summary.status}`);
  const approver = body.waiting != null;
  log(`api: overview view ${ov.view}, expenses ${ov.period.expenseMinor}, revenue ${ov.period.revenueMinor}; waiting ${body.waiting?.count ?? "none"}; missing ${body.missingReceipt.count}`);

  const digits = (text: string | null) => (text ?? "").replace(/\D/g, "");
  const heading = page.getByRole("heading", { level: 1, name: t("Argent", "Money") });
  const tabs = page.getByRole("navigation", { name: t("Sections de l’argent", "Money sections") });
  const tab = (fr: string, en: string) => tabs.getByRole("tab", { name: new RegExp(`^${t(fr, en)}`) });
  const assertSelected = async (fr: string, en: string) => {
    if ((await tab(fr, en).getAttribute("aria-selected")) !== "true") throw new Error(`${en} is not the selected tab at ${page.url()}`);
  };

  await (await openSidebar(page)).getByRole("link", { name: t("Argent", "Money") }).click();
  await page.waitForURL((url) => url.pathname === "/finance");
  await heading.waitFor();
  await page.locator("[data-slot='metric-tile'][data-metric='expenses'] [data-slot='metric-value']").waitFor();
  await quiet();
  await assertSelected("Vue d'ensemble", "Overview");
  const tabNames = await tabs.getByRole("tab").allTextContents();
  log(`tabs: ${tabNames.join(" | ")}`);
  if (approver !== tabNames.some((name) => name.startsWith(t("À approuver", "To approve")))) {
    throw new Error(`To approve tab ${approver ? "missing for" : "shown to"} this role: ${tabNames.join(", ")}`);
  }
  for (const [metric, minor] of [["expenses", ov.period.expenseMinor], ["revenue", ov.period.revenueMinor]] as const) {
    const shown = digits(await page.locator(`[data-metric='${metric}'] [data-slot='metric-value']`).textContent());
    if (shown !== String(Math.abs(minor))) throw new Error(`${metric} tile shows ${shown}, overview read says ${minor}`);
  }
  const main = (await page.locator("main").textContent()) ?? "";
  if (ov.view === "REVENUE_AND_EXPENSES" && /\b(profit|loss|bénéfice|perte)\b/i.test(main)) {
    throw new Error("the cashier's Overview names a profit or loss");
  }
  await shot("overview", {
    caption: approver
      ? "Money opens on Overview: tiles from the overview read, expenses by category, and To do"
      : "A cashier's Money Overview: revenue and expenses, missing receipts; no profit, no To approve tab",
  });

  await page.getByRole("radio", { name: t("3 mois", "3 months") }).click();
  await page.waitForURL((url) => url.searchParams.get("range") === "3-months");
  await quiet();
  await shot("range", {
    caption: "The range picker sits on Overview only and lives in the address: 3 closed months vs the 3 before",
    highlight: page.locator("[data-slot='money-overview-period']"),
  });
  await page.getByRole("radio", { name: t("Ce mois", "This month") }).click();
  await page.waitForURL((url) => url.pathname === "/finance" && !url.searchParams.has("range"));
  await quiet();

  await page.locator("[data-metric='missing'] a").click();
  await page.waitForURL((url) => url.pathname === "/finance/entries" && url.searchParams.get("evidence") === "MISSING");
  await heading.waitFor();
  await quiet();
  await assertSelected("Écritures", "Entries");
  if ((await page.locator("[data-slot='metric-strip']").count()) !== 0) throw new Error("Entries still shows tiles");
  // On a phone the filters fold into one Filters button (#300).
  const phone = (page.viewportSize()?.width ?? 1440) < 768;
  if (phone) await page.getByRole("button", { name: new RegExp(`^${t("Filtres", "Filters")}`) }).first().click();
  const missingFilter = page.locator("[data-slot='money-missing-filter']").filter({ visible: true }).first();
  if ((await missingFilter.getAttribute("aria-pressed")) !== "true") throw new Error("Missing receipt filter is not on");
  if (!digits(await missingFilter.textContent()).endsWith(String(body.missingReceipt.count))) {
    throw new Error(`Missing receipt filter count ${await missingFilter.textContent()} ≠ ${body.missingReceipt.count}`);
  }
  await shot("entries-missing", {
    caption: "The Missing receipt tile opens Entries filtered; the list starts with its filters, the count on the filter",
    highlight: missingFilter,
  });
  if (phone) {
    await page.keyboard.press("Escape");
    await page.getByRole("dialog").waitFor({ state: "hidden" });
  }

  if (approver) {
    const queue = await apiGet("/v1/finance/approvals");
    const me = await apiGet("/v1/me");
    const principalId = (me.body as { principalId?: string }).principalId;
    const decidable = ((queue.body as {
      entries?: Array<{ id: string; entryNumber: string; submittedByPrincipalId: string; directionDecides: boolean }>;
    }).entries ?? []).filter((item) => !item.directionDecides && item.submittedByPrincipalId !== principalId);
    const [entry] = decidable;
    if (entry === undefined) throw new Error("nothing waiting for this role (reseed?)");
    const count = digits(await tab("À approuver", "To approve").locator("[data-slot='module-page-tab-count']").textContent());
    if (!count.startsWith(String(body.waiting?.count))) throw new Error(`To approve tab counts ${count}, summary says ${body.waiting?.count}`);

    await tab("À approuver", "To approve").click();
    await page.waitForURL((url) => url.pathname === "/finance/approve");
    const row = page.locator("tr, [data-slot='data-table-row']").filter({ hasText: entry.entryNumber, visible: true });
    await row.waitFor();
    await quiet();
    await assertSelected("À approuver", "To approve");
    await shot("to-approve", {
      caption: `To approve: the same header, ${entry.entryNumber} with Reject and Approve on its row`,
      highlight: row,
    });
    await row.getByRole("button", { name: `${t("Approuver l'écriture", "Approve entry")} ${entry.entryNumber}`, exact: true }).click();
    await page.getByText(t("Écriture approuvée", "Entry approved")).first().waitFor();
    await row.waitFor({ state: "detached" });
    await quiet();
    const after = await apiGet(`/v1/finance/entries/${entry.id}`);
    const status = (after.body as { status?: string }).status;
    if (status !== "POSTED") throw new Error(`${entry.entryNumber} is ${status ?? after.status} after approval`);
    log(`api cross-check: ${entry.entryNumber} is now ${status}`);
    await shot("approved", { caption: `Approve is one tap: ${entry.entryNumber} posts and leaves To approve` });

    await page.goBack();
    await page.waitForURL((url) => url.pathname === "/finance/entries" && url.searchParams.get("evidence") === "MISSING");
    await heading.waitFor();
    await quiet();
    await assertSelected("Écritures", "Entries");
    await shot("back", { caption: "Back lands on the tab you came from, its filter still on" });

    for (const old of ["/finance/approvals", "/finance/entries?view=waiting"]) {
      // A full load, as a notification or bookmark would open it.
      await page.goto(new URL(old, page.url()).href);
      await page.waitForURL((url) => url.pathname === "/finance/approve");
      await heading.waitFor();
      await quiet();
      log(`old link: ${old} → ${new URL(page.url()).pathname}`);
    }
    await shot("old-link", { caption: "The old approvals links land on the To approve tab" });
  } else {
    // A full load: `nav` waits for the address it was given, which a redirect never reaches.
    await page.goto(new URL("/finance/approve", page.url()).href);
    await page.waitForURL((url) => url.pathname === "/finance/entries");
    await heading.waitFor();
    await quiet();
    log("a role with no queue sent to /finance/approve lands on Entries");
    await shot("no-queue", { caption: "With nothing to decide, a link to To approve lands on Entries" });
  }
};

export default flow;
