import type { DriveScript } from "../browser.js";

/**
 * Lists on a phone are two-line rows from DataTable, with one Filters button
 * (#300). Visits every module list, checks each row is at least 60 px with no
 * card border and no stray " · –", then opens the Filters sheet on the entries
 * list, picks a status and checks the button counts it.
 * Run: pnpm verify drive flow:phone-list-rows --role director --lang en --viewport 390x844
 */
const ROUTES = [
  ["/", "Home: recent entries as list rows"],
  ["/assets", "Trucks: title left, status badge right"],
  ["/activities", "Trips: number, then type, date and truck on the second line"],
  ["/maintenance", "Work orders: reference, truck and description, cost and status on the right"],
  ["/finance/entries", "Money: amount right in tabular figures, status under it"],
  ["/finance/approve", "Waiting for your approval: the same row anatomy, Reject and Approve under the amount"],
  ["/finance/periods", "Periods: entry count right, status under it"],
  ["/more/persons", "People"],
  ["/more/users", "Users"],
  ["/more/branches", "Branches"],
] as const;

interface RowCheck {
  rows: number;
  short: number;
  boxed: number;
  strayDash: number;
}

const flow: DriveScript = async ({ page, nav, shot, quiet, t, log, apiGet }) => {
  const problems: string[] = [];

  for (const [route, caption] of ROUTES) {
    await nav(route);
    await quiet();
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 10_000 }).catch(() => undefined);
    await page.locator('[data-slot="data-table-row"]').first().waitFor({ timeout: 10_000 }).catch(() => undefined);
    await quiet();

    const check = await page.evaluate((): RowCheck => {
      const rows = [...document.querySelectorAll<HTMLElement>('[data-slot="data-table-row"]')];
      return {
        rows: rows.length,
        short: rows.filter((row) => row.getBoundingClientRect().height < 59.5).length,
        boxed: rows.filter((row) => {
          const style = getComputedStyle(row);
          return style.borderTopWidth !== "0px" || style.borderLeftWidth !== "0px";
        }).length,
        strayDash: rows.filter((row) =>
          /·\s*[–—]|[–—]\s*·/.test(
            row.querySelector('[data-slot="data-table-row-meta"]')?.textContent ?? "",
          ),
        ).length,
      };
    });
    log(`${route}: ${check.rows} rows, ${check.short} under 60 px, ${check.boxed} boxed, ${check.strayDash} with a stray dash`);
    if (check.short + check.boxed + check.strayDash > 0) problems.push(`${route} ${JSON.stringify(check)}`);
    await shot(`list${route.replace(/[/?=&]/g, "-") || "-home"}`, { caption });
  }

  await nav("/finance/entries");
  await quiet();
  const filters = page.getByRole("button", { name: t("Filtres", "Filters"), exact: true });
  await filters.waitFor();
  await shot("entries-filters-button", {
    caption: "On a phone the entries filters fold into one Filters button",
    highlight: filters,
  });

  await filters.click();
  const sheet = page.getByRole("dialog");
  await sheet.waitFor();
  await shot("entries-filters-sheet", {
    caption: "The button opens a bottom sheet with the same controls and a clear action",
    highlight: sheet,
  });

  await sheet.getByRole("combobox", { name: t("Statut", "Status") }).click();
  await page.getByRole("option", { name: t("Comptabilisée", "Posted"), exact: true }).click();
  await quiet();
  await sheet.getByRole("button", { name: t("Voir les résultats", "Show results") }).click();
  await sheet.waitFor({ state: "hidden" });
  await quiet();
  const counted = page.getByRole("button", { name: t("Filtres (1)", "Filters (1)"), exact: true });
  await counted.waitFor();
  await shot("entries-filtered", {
    caption: "One status picked: the button reads Filters (1) and the list shows posted entries",
    highlight: counted,
  });

  const posted = await apiGet("/v1/finance/entries?status=POSTED");
  const entries = (posted.body as { entries?: unknown[] }).entries ?? [];
  const shown = await page.locator('[data-slot="data-table-row"]').count();
  log(`api cross-check: GET /v1/finance/entries?status=POSTED → ${posted.status}, ${entries.length} entries; ${shown} rows on screen`);
  if (posted.status !== 200 || shown !== Math.min(entries.length, 50)) {
    problems.push(`filtered list shows ${shown} rows, the read has ${entries.length}`);
  }

  if (problems.length > 0) throw new Error(`phone rows off-spec:\n${problems.join("\n")}`);
};

export default flow;
