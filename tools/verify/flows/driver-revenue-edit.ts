import { openSidebar, type DriveScript } from "../browser.js";

/**
 * As the driver: Trips → their trip → its pending revenue line → the entry's
 * page offers no Edit (#572). A driver records expenses only (#532), and
 * `update-pending-entry` refuses them a revenue entry with ROLE_FORBIDDEN.
 * Ends by reading the entry back unchanged.
 * Precondition, through a real command (a driver could record revenue on a
 * trip sheet before #570): after a reseed, `pnpm verify api POST
 * /v1/commands/record-haulage-job-sheet --role driver --json @body.json` with
 * one REVENUE entry above the auto-approve band on VH001.
 * Run: pnpm verify drive flow:driver-revenue-edit --role driver --lang en
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  type Row = { id: string; entryNumber: string; amountMinor: number; direction: string; status: string };
  const list = await apiGet("/v1/finance/entries?status=SUBMITTED");
  const entry = ((list.body as { entries?: Row[] }).entries ?? []).find((row) => row.direction === "REVENUE");
  if (list.status !== 200 || entry === undefined) {
    throw new Error(`GET /v1/finance/entries → ${list.status}, no pending revenue entry of the driver's (see the precondition)`);
  }
  const detail = await apiGet(`/v1/finance/entries/${entry.id}`);
  const activityId = (detail.body as { postings?: Array<{ activityId: string | null }> }).postings?.[0]?.activityId;
  if (activityId == null) throw new Error(`${entry.entryNumber} is on no trip`);
  const trip = await apiGet(`/v1/activities/${activityId}`);
  const tripNumber = (trip.body as { activityNumber?: string }).activityNumber;
  if (tripNumber === undefined) throw new Error(`GET /v1/activities/${activityId} → ${trip.status}`);
  log(`api: ${entry.entryNumber} is the driver's pending REVENUE entry on ${tripNumber}, ${entry.amountMinor} XAF`);

  await (await openSidebar(page)).getByRole("link", { name: t("Trajets", "Trips") }).click();
  await page.getByRole("heading", { level: 1, name: t("Trajets", "Trips") }).waitFor();
  await page.getByRole("button", { name: tripNumber, exact: true }).first().click();
  await page.getByRole("heading", { level: 1, name: tripNumber }).waitFor();
  await quiet();
  const line = page.getByRole("link").filter({ hasText: entry.entryNumber });
  await line.waitFor();
  await shot("trip-money", { caption: `The driver's trip ${tripNumber}: revenue ${entry.entryNumber} waits for approval`, highlight: line });

  await line.click();
  await page.waitForURL((url) => url.pathname === `/finance/entries/${entry.id}`);
  await page.getByRole("main").getByText(entry.entryNumber, { exact: true }).first().waitFor();
  await quiet();
  const edit = page.getByRole("main").getByRole("button", { name: t("Modifier", "Edit"), exact: true });
  const offered = await edit.count();
  await shot("entry-page", {
    caption:
      offered === 0
        ? `${entry.entryNumber} is revenue: the driver who recorded it gets no Edit`
        : `${entry.entryNumber} is revenue, yet the driver is offered Edit`,
    highlight: offered === 0 ? page.getByRole("main") : edit.first(),
  });
  if (offered > 0) throw new Error(`the driver is offered Edit on revenue ${entry.entryNumber}`);

  const after = await apiGet(`/v1/finance/entries/${entry.id}`);
  const read = after.body as Partial<Row>;
  if (read.status !== "SUBMITTED" || read.amountMinor !== entry.amountMinor) {
    throw new Error(`${entry.entryNumber} reads ${read.status ?? after.status} ${read.amountMinor ?? "?"}, expected SUBMITTED ${entry.amountMinor}`);
  }
  log(`api cross-check: ${entry.entryNumber} still SUBMITTED at ${read.amountMinor} XAF`);
};

export default flow;
