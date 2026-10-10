import { openSidebar, type DriveScript } from "../browser.js";

/**
 * Money is one page (#314): the lead line names the open and last locked
 * month, the tiles match `GET /v1/finance/summary`, the "Waiting for your approval"
 * tile opens the queue with Reject and Approve on each row, Reject asks for a
 * reason, Approve is one tap, the old /finance/approvals link lands on the same
 * view, and Accounting months is one click from the header. Mutates the slot
 * (one approval); reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:money-page --role finance --lang en --reel
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  const summary = await apiGet("/v1/finance/summary");
  const body = summary.body as { waiting?: { count: number } | null; missingReceipt?: { count: number } };
  if (summary.status !== 200 || !body.waiting) throw new Error(`GET /v1/finance/summary → ${summary.status}, no waiting tile for this role`);
  const queue = await apiGet("/v1/finance/approvals");
  const me = await apiGet("/v1/me");
  const principalId = (me.body as { principalId?: string }).principalId;
  const decidable = ((queue.body as {
    entries?: Array<{ id: string; entryNumber: string; submittedByPrincipalId: string; directionDecides: boolean }>;
  }).entries ?? []).filter((item) => !item.directionDecides && item.submittedByPrincipalId !== principalId);
  if (decidable.length !== body.waiting.count) {
    throw new Error(`waiting tile counts ${body.waiting.count}, queue holds ${decidable.length} this role may decide`);
  }
  const [entry, second] = decidable;
  if (entry === undefined) throw new Error("nothing waiting for this role (reseed?)");
  log(`api: summary waiting ${body.waiting.count} = decidable rows in the queue`);

  await (await openSidebar(page)).getByRole("link", { name: t("Argent", "Money") }).click();
  const heading = page.getByRole("heading", { level: 1, name: t("Argent", "Money") });
  await heading.waitFor();
  await quiet();
  const lead = page.locator("[data-slot='money-lead']");
  await lead.waitFor();
  if ((await page.getByRole("tablist").count()) !== 0) throw new Error("the Money page still shows section tabs");
  await shot("money-page", {
    caption: "Money is one page: the lead line names the open and locked month, the tiles count this month",
    highlight: page.locator("[data-slot='metric-strip']"),
  });

  const waitingTile = page.getByRole("button", { name: t("En attente de votre approbation", "Waiting for your approval"), exact: true });
  const shown = (await page.locator("[data-slot='metric-tile']").filter({ has: waitingTile }).locator("[data-slot='metric-value']").textContent())?.trim();
  if (shown !== String(body.waiting.count)) throw new Error(`waiting tile shows ${shown}, API says ${body.waiting.count}`);
  await waitingTile.click();
  await page.waitForURL((url) => url.searchParams.get("view") === "waiting");
  // A table row on desktop, a list row on a phone (#300).
  const row = page.locator("tr, [data-slot='data-table-row']").filter({ hasText: entry.entryNumber, visible: true });
  await row.waitFor();
  await quiet();
  await shot("waiting-view", {
    caption: `The waiting tile filters the list: ${entry.entryNumber} shows Reject and Approve on its row`,
    highlight: row,
  });

  await row.getByRole("button", { name: `${t("Rejeter l'écriture", "Reject entry")} ${entry.entryNumber}`, exact: true }).click();
  const dialog = page.getByRole("dialog").filter({ has: page.getByRole("textbox") });
  await dialog.waitFor();
  await shot("reject-dialog", { caption: "Reject opens the decision dialog and asks for a reason", highlight: dialog });
  await dialog.getByRole("button", { name: t("Garder l'écriture", "Keep entry"), exact: true }).click();
  await dialog.waitFor({ state: "hidden" });

  await row.getByRole("button", { name: `${t("Approuver l'écriture", "Approve entry")} ${entry.entryNumber}`, exact: true }).click();
  await page.getByText(t("Écriture approuvée", "Entry approved")).first().waitFor();
  await row.waitFor({ state: "detached" });
  await quiet();
  await shot("approved", { caption: `Approve is one tap: ${entry.entryNumber} posts and leaves the waiting view` });
  const after = await apiGet(`/v1/finance/entries/${entry.id}`);
  const status = (after.body as { status?: string }).status;
  if (status !== "POSTED") throw new Error(`${entry.entryNumber} is ${status ?? after.status} after approval`);
  log(`api cross-check: ${entry.entryNumber} is now ${status}`);

  // A full load of the old link, as a notification or bookmark would open it;
  // `nav` waits for the URL it was given, which a redirect never reaches.
  await page.goto(new URL("/finance/approvals", page.url()).href);
  await heading.waitFor();
  await page.getByRole("button", { name: t("Retirer le filtre : En attente d’approbation", "Clear filter: Waiting approval") }).waitFor();
  await quiet();
  const landed = new URL(page.url());
  if (landed.pathname !== "/finance/entries" || landed.searchParams.get("view") !== "waiting") {
    throw new Error(`/finance/approvals landed on ${landed.pathname}${landed.search}`);
  }
  log(`old link: /finance/approvals → ${landed.pathname}${landed.search}`);
  await shot("old-link", {
    caption: second === undefined
      ? "The old /finance/approvals link lands on the same waiting view"
      : `The old /finance/approvals link lands on the same waiting view, ${second.entryNumber} next`,
  });

  // The header's link, not the Company row of the same name in the sidebar.
  await page.getByRole("main").getByRole("link", { name: t("Mois comptables", "Accounting months") }).click();
  await page.getByRole("heading", { level: 1, name: t("Mois comptables", "Accounting months") }).waitFor();
  await quiet();
  await shot("accounting-months", { caption: "Accounting months is one click from the Money header, titled the same" });
};

export default flow;
