import { openSidebar, type DriveScript } from "../browser.js";

/**
 * An entry's "Linked to" names its work order by the order's description, never
 * by a fragment of its id (#547): Money list row → the entry's side panel →
 * Open full screen → the link opens the work order in its vehicle's
 * Maintenance tab. Read-only.
 * Run: pnpm verify drive flow:work-order-link --role finance --lang en
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  const list = await apiGet("/v1/finance/entries?status=POSTED");
  type Row = {
    id: string;
    entryNumber: string;
    links: { workOrderId: string | null; workOrderAssetId: string | null; workOrderDescription: string | null };
  };
  const entries = (list.body as { entries?: Row[] }).entries ?? [];
  const entry = entries.find((e) => e.links.workOrderId !== null);
  const description = entry?.links.workOrderDescription;
  if (entry === undefined || !description) {
    throw new Error(`GET /v1/finance/entries?status=POSTED → ${list.status}, no posted work-order entry with a description`);
  }
  const idFragment = (entry.links.workOrderId ?? "").slice(0, 8).toUpperCase();
  const name = `${t("Ordre de travail :", "Work order:")} ${description}`;
  log(`${entry.entryNumber} belongs to work order "${description}" (id starts ${idFragment})`);

  const noIdFragment = async (where: string, text: string) => {
    if (text.toUpperCase().includes(idFragment)) throw new Error(`${where} still shows the id fragment ${idFragment}`);
  };

  await (await openSidebar(page)).getByRole("link", { name: t("Argent", "Money") }).click();
  await page.getByRole("heading", { level: 1, name: t("Argent", "Money") }).waitFor();
  await quiet();
  const row = page.getByRole("row").filter({ has: page.getByRole("button", { name: entry.entryNumber, exact: true }) });
  const rowLink = row.getByRole("link", { name, exact: true });
  await rowLink.waitFor();
  await noIdFragment("the list row", (await row.textContent()) ?? "");
  await shot("list-linked-to", {
    caption: `In the Money list, ${entry.entryNumber} is linked to its work order by name`,
    highlight: rowLink,
  });

  await row.getByRole("button", { name: entry.entryNumber, exact: true }).click();
  const panel = page.getByRole("dialog").filter({ has: page.getByRole("heading", { name: entry.entryNumber }) });
  await panel.waitFor();
  await quiet();
  const panelLink = panel.getByRole("link", { name, exact: true });
  await panelLink.waitFor();
  await noIdFragment("the side panel", (await panel.textContent()) ?? "");
  await shot("panel-linked-to", { caption: "The side panel names the same work order", highlight: panelLink });

  await panel.getByRole("button", { name: t("Ouvrir en plein écran", "Open full screen") }).click();
  await page.waitForURL((url) => url.pathname === `/finance/entries/${entry.id}`);
  await quiet();
  const detailLink = page.getByRole("main").getByRole("link", { name, exact: true });
  await detailLink.waitFor();
  await noIdFragment("the entry detail", (await page.getByRole("main").textContent()) ?? "");
  await shot("detail-linked-to", { caption: "The entry's full page names it too", highlight: detailLink });

  await detailLink.click();
  await page.waitForURL((url) => url.pathname === `/assets/${entry.links.workOrderAssetId}/maintenance`);
  const workOrderPanel = page.getByRole("dialog").filter({ hasText: description });
  await workOrderPanel.first().waitFor();
  await quiet();
  await shot("work-order-opened", {
    caption: "The link opens that work order in its vehicle's Maintenance tab",
    highlight: workOrderPanel.first(),
  });

  const detail = await apiGet(`/v1/finance/entries/${entry.id}`);
  const links = (detail.body as { links?: Row["links"] }).links;
  if (links?.workOrderDescription !== description) throw new Error(`detail read names ${JSON.stringify(links)}`);
  log(`api cross-check: GET /v1/finance/entries/${entry.id} links.workOrderDescription = "${description}"`);
};

export default flow;
