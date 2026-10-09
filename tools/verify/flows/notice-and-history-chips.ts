import type { DriveScript } from "../browser.js";

/**
 * The approval-rules notice sits in the page's own column (#467), and record
 * history chips name only fields the change list can show (#465). Needs a rule
 * change Finance has not acknowledged yet, made through the real command:
 * Run: pnpm verify up --reseed --slot N && pnpm verify api POST /v1/commands/update-approval-threshold --role director --json '{"version":1,"envelope":{"commandId":"<uuid>","idempotencyKey":"<unique>","origin":"HUMAN_UI"},"payload":{"commandType":"record-expense","amountMaxMinor":150000}}' --slot N && pnpm verify drive flow:notice-and-history-chips --role finance --lang en --slot N
 * Read-only itself (it never acknowledges the notice); add `--viewport 390x844` for the phone.
 */
const TRIP = "DLA-2026-00002";

const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet, nav }) => {
  const misaligned: string[] = [];
  const notice = page.locator('[data-slot="approval-rules-notice"]');

  for (const [route, name] of [
    ["/", "home"],
    ["/my-settings", "my-settings"],
  ] as const) {
    await nav(route);
    await notice.waitFor({ timeout: 15_000 });
    await quiet();
    const title = page.getByRole("heading", { level: 1 }).first();
    await title.waitFor();
    const [noticeBox, titleBox] = [await notice.boundingBox(), await title.boundingBox()];
    const offset = Math.round((noticeBox?.x ?? 0) - (titleBox?.x ?? 0));
    log(`${route}: notice left ${noticeBox?.x}, title left ${titleBox?.x}, offset ${offset}px`);
    if (Math.abs(offset) > 1) misaligned.push(`${route} offset ${offset}px`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot(`notice-${name}`, {
      caption:
        offset === 0
          ? "The rules notice starts on the page title's left edge"
          : `The rules notice starts ${Math.abs(offset)} px away from the page title`,
      highlight: notice,
    });
  }

  const trips = await apiGet(`/v1/activities?search=${TRIP}`);
  const trip = ((trips.body as { items?: Array<{ id: string; activityNumber: string }> }).items ?? []).find(
    (a) => a.activityNumber === TRIP,
  );
  if (trip === undefined) throw new Error(`GET /v1/activities?search=${TRIP} → ${trips.status}, no ${TRIP}`);
  const history = await apiGet(`/v1/history/activity/${trip.id}`);
  const events = (history.body as { items?: Array<{ eventId: string; eventType: string; changedFields: string[] }> }).items ?? [];
  const created = events.find((event) => event.eventType === "activity.created");
  if (created === undefined) throw new Error(`no activity.created event on ${TRIP}`);
  log(`api: ${TRIP} activity.created changedFields: ${created.changedFields.join(", ")}`);
  log(`api: ${TRIP} activity.created shownFields: ${(created as { shownFields?: string[] }).shownFields?.join(", ") ?? "(not sent)"}`);

  await nav(`/activities/${trip.id}`);
  await quiet();
  await page.getByRole("button", { name: t("Historique", "History"), exact: true }).first().click();
  const sheet = page.getByRole("dialog", { name: t("Historique du dossier", "Record history") });
  await sheet.waitFor();
  await quiet();
  const createdRow = sheet.locator('[data-testid="timeline-event"]').last();
  await createdRow.waitFor();
  await createdRow.scrollIntoViewIfNeeded();
  const chips = (await createdRow.locator("ul li").allInnerTexts()).map((text) => text.trim());
  log(`chips on the created event: ${chips.join(", ")}`);
  const customChip = chips.includes(t("champs personnalisés", "custom fields"));
  await shot("history-created-chips", {
    caption: customChip
      ? "The trip's creation names “custom fields”, a field the change list never shows"
      : "The trip's creation names only fields the change list can show",
    highlight: createdRow,
  });

  await createdRow.getByRole("button", { name: t("Voir les changements", "Show changes") }).click();
  await quiet();
  const list = createdRow.locator("dl");
  await list.waitFor();
  await list.scrollIntoViewIfNeeded();
  const rows = (await list.locator("dt").allInnerTexts()).map((text) => text.trim());
  log(`change list rows: ${rows.join(", ")}`);
  const unlisted = chips.filter((chip) => !rows.includes(chip.toLowerCase()) && !rows.includes(chip));
  await shot("history-created-changes", {
    caption:
      unlisted.length === 0
        ? "Every chip has its row in the change list"
        : `Chips with no row below: ${unlisted.join(", ")}`,
    highlight: list,
  });

  if (misaligned.length > 0) throw new Error(`notice not in the page column: ${misaligned.join("; ")}`);
  if (unlisted.length > 0) throw new Error(`chips with no row in the change list: ${unlisted.join(", ")}`);
};

export default flow;
