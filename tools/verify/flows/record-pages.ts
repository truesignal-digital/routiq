import type { DriveScript } from "../browser.js";

/**
 * Record pages share one frame (#662): the money entry, the trip and the
 * truck each have the record header (number + status badge, facts line,
 * actions top right with at most one filled button), the status block holding
 * the decision, tabs with Overview first and History last (in the address),
 * and on a full page the context column. Read-only: nothing is approved.
 * Run as Finance (an entry waiting for them, a trip with gaps, a truck):
 *   pnpm verify drive flow:record-pages --role finance --lang en [--viewport 390x844] --reel
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet, nav, account }) => {
  const filledInHeader = async () =>
    page
      .locator('[data-slot="record-header"] [data-slot="button"]')
      .evaluateAll((buttons) => buttons.filter((button) => /(^|\s)bg-primary(\s|$)/.test(button.className)).length);
  const fullWidthButtons = async () =>
    page
      .locator('main [data-slot="button"]')
      .evaluateAll(
        (buttons) =>
          buttons.filter(
            (button) =>
              /(^|\s)w-full(\s|$)/.test(button.className) && button.closest('[data-slot="record-action-bar"]') === null,
          ).length,
      );
  const phone = (page.viewportSize()?.width ?? 1280) < 768;
  const check = async (what: string) => {
    const filled = await filledInHeader();
    const wide = await fullWidthButtons();
    log(`${what}: ${filled} filled button(s) in the header, ${wide} full-width button(s) in the page`);
    if (filled > 1) throw new Error(`${what}: ${filled} filled buttons in the record header`);
    if (wide > 0) throw new Error(`${what}: ${wide} full-width buttons under the record`);
  };

  // 1. A money entry waiting for this approver.
  const waiting = await apiGet("/v1/finance/entries?status=SUBMITTED");
  const rows =
    (waiting.body as { entries?: Array<{ id: string; entryNumber: string; recordedBy: { principalId: string | null } }> })
      .entries ?? [];
  const me = (await apiGet("/v1/me")).body as { principalId?: string };
  const entry = rows.find((row) => row.recordedBy.principalId !== me.principalId) ?? rows[0];
  if (entry === undefined) throw new Error(`GET /v1/finance/entries?status=SUBMITTED → ${waiting.status}, nothing waiting`);
  log(`entry ${entry.entryNumber} as ${account.username}`);

  await nav(`/finance/entries/${entry.id}`);
  await page.getByRole("heading", { level: 1, name: entry.entryNumber }).waitFor();
  await quiet();
  const block = page.locator('[data-slot="status-block"]');
  await block.waitFor();
  const approve = phone
    ? page.getByRole("toolbar", { name: t("Décision", "Decision") }).getByRole("button", { name: t("Approuver l'écriture", "Approve entry") })
    : block.getByRole("button", { name: t("Approuver l'écriture", "Approve entry") });
  await approve.waitFor();
  await check("money entry");
  await shot("entry-header", {
    caption: `The entry is titled ${entry.entryNumber} with its status; Approve and Reject sit in the status block, not under the card`,
    highlight: block,
  });
  if (!phone) {
    await shot("entry-context", {
      caption: "The context column holds the amount, what it is linked to and the latest history",
      highlight: page.getByRole("complementary", { name: t("À propos de cet enregistrement", "About this record") }),
    });
  }
  const tabs = await page.getByRole("tab").allInnerTexts();
  log(`entry tabs: ${tabs.map((tab) => tab.replace(/\s+/g, " ").trim()).join(" · ")}`);
  await page.getByRole("tab", { name: t("Historique", "History"), exact: true }).click();
  await page.waitForURL((url) => url.searchParams.get("tab") === "history");
  const trail = page.getByRole("region", { name: t("Historique du dossier", "Record history") });
  await trail.waitFor();
  await quiet();
  await shot("entry-history", { caption: "History is the last tab, and the tab is in the address (?tab=history)", highlight: trail });

  // 2. A trip closed with things missing.
  const trips = await apiGet("/v1/activities?completeness=COMPLETE_WITH_EXCEPTIONS");
  const trip = ((trips.body as { items?: Array<{ id: string; activityNumber: string }> }).items ?? [])[0];
  if (trip === undefined) throw new Error(`GET /v1/activities?completeness=COMPLETE_WITH_EXCEPTIONS → ${trips.status}, none`);
  await nav(`/activities/${trip.id}`);
  await page.getByRole("heading", { level: 1, name: trip.activityNumber }).waitFor();
  await quiet();
  const tripBlock = page.locator('[data-slot="status-block"]');
  await tripBlock.waitFor();
  await check("trip");
  await shot("trip-gaps", {
    caption: `${trip.activityNumber} is closed with things missing: the status block names them`,
    highlight: tripBlock,
  });
  const tripTabs = await page.getByRole("tab").allInnerTexts();
  log(`trip tabs: ${tripTabs.map((tab) => tab.replace(/\s+/g, " ").trim()).join(" · ")}`);
  const overviewCards = page.locator("main [data-slot='card']").first();
  await overviewCards.scrollIntoViewIfNeeded();
  await shot("trip-overview", {
    caption: "The Overview groups the facts like the sheet; empty ones read Not recorded",
    highlight: page.locator("main [data-slot='card']").filter({ hasText: t("Équipage", "Crew") }).first(),
  });
  await page.getByRole("tab", { name: /^(Legs|Étapes)/ }).click();
  await page.waitForURL((url) => url.searchParams.get("tab") === "legs");
  await quiet();
  await shot("trip-legs", { caption: "Legs is its own tab, between Overview and Money" });

  // 3. The truck: same header, Details before History.
  const assets = await apiGet("/v1/assets");
  const truck = ((assets.body as { items?: Array<{ id: string; assetCode: string }> }).items ?? []).find(
    (item) => item.assetCode === "VH003",
  );
  if (truck === undefined) throw new Error(`GET /v1/assets → ${assets.status}, no VH003`);
  await nav(`/assets/${truck.id}`);
  const header = page.locator('[data-slot="record-header"]');
  await header.getByRole("heading", { level: 1 }).waitFor();
  await quiet();
  await check("truck");
  const truckTabs = (await page.getByRole("tab").allInnerTexts()).map((tab) => tab.replace(/\d+$/, "").trim());
  log(`truck tabs: ${truckTabs.join(" · ")}`);
  if (truckTabs.at(-1) !== t("Historique", "History")) throw new Error(`truck tabs end with ${truckTabs.at(-1)}`);
  await shot("truck-header", {
    caption: "The truck uses the same header: code, status badge, one facts line; Details comes before History",
    highlight: header,
  });

  const detail = await apiGet(`/v1/finance/entries/${entry.id}`);
  const body = detail.body as { status?: string };
  if (detail.status !== 200 || body.status !== "SUBMITTED") throw new Error(`entry ${entry.entryNumber} is ${body.status}`);
  log(`api cross-check: ${entry.entryNumber} still ${body.status}; nothing was decided`);
};

export default flow;
