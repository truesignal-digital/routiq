import { openSidebar, type DriveContext, type DriveScript } from "../browser.js";

/**
 * A truck on two unfinished trips (#577), on VH003 (Douala), which the demo
 * seed leaves on an open trip. Start a second trip on it first, through the
 * API (the web starts trips from the sheet, which records a finished one):
 *   pnpm verify api POST /v1/commands/create-activity --role admin --json @start.json
 * The command answers VEHICLE_DOUBLE_BOOKED. This flow then opens VH003: both
 * trips are in the To do, waiting on Operations, each naming the other, and a
 * row opens its trip. Ends with an API cross-check.
 * Run: pnpm verify drive flow:vehicle-double-booked --role admin --lang en --reel
 */
const settle = (ctx: DriveContext) => ctx.page.waitForTimeout(700);

type Item = { code: string; subject: { id: string; number: string | null }; params: { tripNumbers?: string[] } };

const flow: DriveScript = async (ctx) => {
  const { page, t, shot, quiet, log } = ctx;
  await (await openSidebar(page)).getByRole("link", { name: t("Camions", "Trucks") }).click();
  await page.getByRole("button", { name: /VH003/ }).first().click();
  await page.getByRole("heading", { level: 1, name: "VH003" }).waitFor();
  await quiet();
  const assetId = /\/assets\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (assetId === undefined) throw new Error(`no asset id in ${page.url()}`);

  const response = await ctx.apiGet(`/v1/assets/${assetId}/attention`);
  const flags = ((response.body as { items?: Item[] }).items ?? []).filter(
    (item) => item.code === "VEHICLE_DOUBLE_BOOKED",
  );
  if (flags.length !== 2) {
    throw new Error(`expected 2 VEHICLE_DOUBLE_BOOKED items on VH003, got ${flags.length}; start a second trip first`);
  }

  const card = page
    .locator("[data-slot=card]")
    .filter({ has: page.getByRole("heading", { level: 2, name: new RegExp(`^${t("À faire", "To do")}`) }) });
  const waiting = card.getByRole("button", { name: new RegExp(`^${t("En attente des autres", "Waiting on others")}`) });
  await waiting.waitFor();
  await waiting.click();
  const overlap = t("chevauche un autre trajet ouvert", "overlaps another open trip");
  const rows = card.getByRole("button", { name: new RegExp(overlap) });
  await rows.first().waitFor();
  await settle(ctx);
  await shot("both-trips-flagged", {
    caption: "VH003 is on two open trips: both are flagged, each naming the other",
    highlight: card,
  });

  await rows.first().click();
  const panel = page.getByRole("dialog").first();
  await panel.waitFor();
  await quiet();
  await settle(ctx);
  await shot("trip-opens", {
    caption: "A flag opens its trip, so whoever knows can close the one that has ended",
    highlight: panel,
  });

  log(
    `api cross-check: ${flags.map((item) => `${item.subject.number} names ${item.params.tripNumbers?.join(", ")}`).join("; ")}`,
  );
};

export default flow;
