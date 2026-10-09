import { randomUUID } from "node:crypto";
import { openSidebar, type DriveContext, type DriveScript } from "../browser.js";

/**
 * #511: trips that start just after local midnight belong to that local day.
 * Arranges two closed trips on VH001 through the real sheet command: one at
 * 00:30 Douala on this week's Monday (late Sunday night), one at 00:15 on
 * Tuesday (late Monday night). Then the "This week" tile must list what it
 * counts, and a Monday-only filter must list the Monday trip, not Tuesday's.
 * Mutates: reseed before each run.
 * Run: pnpm verify up --slot N --reseed && pnpm verify drive flow:trip-day-filter --slot N --role admin --lang en --reel
 */

const ACTIVITY_NUMBER = /^[A-Z]+-\d{4}-\d{5}$/;

async function recordClosedTrip(
  ctx: DriveContext,
  assetId: string,
  customerName: string,
  startedAt: string,
  endedAt: string,
): Promise<string> {
  const token = await ctx.page.evaluate(() => {
    const raw = window.localStorage.getItem("routiq.sessions.v1");
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as { activeKey?: string; sessions?: Record<string, { token?: string }> };
    return parsed.activeKey === undefined ? null : (parsed.sessions?.[parsed.activeKey]?.token ?? null);
  });
  if (token === null) throw new Error("no session token to arrange the trips with");
  const activityId = randomUUID();
  const response = await fetch(`${ctx.state.urls.api}/v1/commands/record-haulage-job-sheet`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({
      version: 1,
      envelope: { commandId: randomUUID(), idempotencyKey: `trip-day-filter-${randomUUID()}`, origin: "HUMAN_UI" },
      payload: {
        activityId,
        close: true,
        branchCode: "DLA",
        activityTypeCode: "HAULAGE_JOB",
        primarySegmentId: randomUUID(),
        primaryAssetId: assetId,
        startedAt,
        endedAt,
        customerName,
      },
    }),
  });
  if (!response.ok) throw new Error(`record-haulage-job-sheet → ${response.status} ${await response.text()}`);
  const detail = await ctx.apiGet(`/v1/activities/${activityId}`);
  const activityNumber = (detail.body as { activityNumber?: string }).activityNumber;
  if (detail.status !== 200 || activityNumber === undefined) throw new Error(`GET /v1/activities/${activityId} → ${detail.status}`);
  return activityNumber;
}

/** The trip numbers the list shows, in order. */
async function listedTrips(ctx: DriveContext): Promise<string[]> {
  const texts = await ctx.page.getByRole("button", { name: ACTIVITY_NUMBER }).allInnerTexts();
  return [...new Set(texts.map((text) => text.trim()))];
}

/** Paints one more frame after the list lands, so the reel holds the loaded list, not its skeleton. */
async function settle(ctx: DriveContext): Promise<void> {
  await ctx.page.getByRole("columnheader").first().hover();
  await ctx.page.waitForTimeout(300);
}

const flow: DriveScript = async (ctx) => {
  const { page, t, shot, quiet, log, apiGet } = ctx;

  const summaryBefore = await apiGet("/v1/activities/summary");
  const week = (summaryBefore.body as { week?: { from: string; to: string } }).week;
  if (summaryBefore.status !== 200 || week === undefined) throw new Error(`GET /v1/activities/summary → ${summaryBefore.status}`);
  const monday = week.from;
  const tuesday = new Date(Date.parse(`${monday}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

  const assets = await apiGet("/v1/assets?limit=100");
  const vh001 = ((assets.body as { items?: Array<{ id: string; assetCode: string }> }).items ?? []).find(
    (asset) => asset.assetCode === "VH001",
  );
  if (vh001 === undefined) throw new Error(`GET /v1/assets → ${assets.status}, no VH001`);

  const sundayNight = await recordClosedTrip(ctx, vh001.id, "Night run, starts Mon 00:30", `${monday}T00:30:00+01:00`, `${monday}T06:30:00+01:00`);
  const mondayNight = await recordClosedTrip(ctx, vh001.id, "Night run, starts Tue 00:15", `${tuesday}T00:15:00+01:00`, `${tuesday}T05:00:00+01:00`);
  const names = new Map([
    [sundayNight, `${sundayNight} (Mon 00:30)`],
    [mondayNight, `${mondayNight} (Tue 00:15)`],
  ]);
  log(`arranged ${sundayNight} at ${monday} 00:30 and ${mondayNight} at ${tuesday} 00:15, Douala time`);

  await (await openSidebar(page)).getByRole("link", { name: t("Trajets", "Trips") }).click();
  await page.getByRole("heading", { level: 1, name: t("Trajets", "Trips") }).waitFor();
  await quiet();
  const summary = await apiGet("/v1/activities/summary");
  const thisWeek = (summary.body as { thisWeek?: number }).thisWeek ?? 0;

  const weekTile = page.getByRole("button", { name: new RegExp(t("Cette semaine", "This week")) });
  await weekTile.click();
  await page.waitForURL((url) => url.searchParams.get("from") === week.from && url.searchParams.get("to") === week.to);
  await quiet();
  const weekList = await listedTrips(ctx);
  log(`This week tile: ${thisWeek}; list: ${weekList.join(", ") || "none"}`);
  await settle(ctx);
  await shot("week-tile", {
    caption: `The "This week" tile counts ${thisWeek} trips, so the list it opens should show ${thisWeek}`,
    highlight: page.getByRole("table"),
  });

  // Monday twice: the first click starts a new range, the second closes it on the same day.
  await page.getByRole("button", { name: `${t("Du", "From")} – ${t("Au", "To")}` }).click();
  const mondayLabel = new Intl.DateTimeFormat(ctx.lang === "fr" ? "fr-FR" : "en-US", { dateStyle: "full", timeZone: "UTC" }).format(
    new Date(`${monday}T00:00:00Z`),
  );
  const mondayCell = page.getByRole("dialog").getByRole("button", { name: mondayLabel, exact: true });
  await mondayCell.click();
  await mondayCell.click();
  await page.keyboard.press("Escape");
  await page.waitForURL((url) => url.searchParams.get("from") === monday && url.searchParams.get("to") === monday);
  await quiet();
  const mondayList = await listedTrips(ctx);
  log(`Monday ${monday} only: ${mondayList.join(", ") || "none"}`);
  await settle(ctx);
  await shot("monday-only", {
    caption: `Monday only: ${names.get(sundayNight)} belongs here, ${names.get(mondayNight)} does not`,
    highlight: page.getByRole("table"),
  });

  if (weekList.length !== thisWeek) throw new Error(`the tile counts ${thisWeek} but its list shows ${weekList.length}`);
  if (mondayList.join() !== sundayNight) throw new Error(`Monday should list only ${sundayNight}, got ${mondayList.join(", ") || "none"}`);
};

export default flow;
