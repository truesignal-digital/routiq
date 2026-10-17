import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

type Period = { periodCode: string; status: "OPEN" | "LOCKED"; rowVersion: number };

export const journey: Journey = {
  id: "finance-locks-period",
  actor: { role: "finance", person: "Finance: the accountant who closes the month" },
  arrangeAs: "finance",
  goal: "see which months are still open and start locking last month",
  trigger: "The month close on Money › Overview, early in the month",
  frequency: "Monthly",
  device: { viewport: { width: 1440, height: 900 }, throttle: "none" },
  doneWhen: "The Lock period dialog is open for the newest open month the books hold, and GET /v1/finance/periods still shows it OPEN (nothing is sent)",
  firstGlance: {
    purpose: "The company's accounting months and whether each is locked",
    state: "Recent months are open; some hold entries waiting for approval",
    nextAction: "Lock last month",
  },
  budgets: {
    taps: 2,
    seconds: 5,
    wordsPerScreen: 220,
    foldWordsPerScreen: 160,
    // The lock dialog says what locking does, once, at the moment of action.
    proseWordsPerScreen: 30,
    longestBlock: 25,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/**
 * Finance → Accounting months → Actions → Lock period, up to the dialog. Read-only:
 * the dialog is dismissed. To lock for real, run flow:lock-period and reseed.
 * Run: pnpm verify drive journey:finance-locks-period --role finance --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, nav, apiGet, log } = ctx;
  assertStartedAs(ctx, journey);
  const readPeriods = async (): Promise<Period[]> => {
    const res = await apiGet("/v1/finance/periods");
    if (res.status !== 200) throw new Error(`GET /v1/finance/periods → ${res.status}`);
    return (res.body as { periods?: Period[] }).periods ?? [];
  };
  const target = (await readPeriods())
    .filter((p) => p.status === "OPEN" && p.rowVersion >= 1)
    .sort((a, b) => b.periodCode.localeCompare(a.periodCode))[0];
  if (target === undefined) throw new Error("no OPEN month with a stored row (reseed?)");
  log(`target ${target.periodCode}`);

  await nav("/finance/periods");
  await page.getByRole("heading", { level: 1, name: t("Mois comptables", "Accounting months") }).waitFor({ timeout: 60_000 });
  const row = page.getByRole("row").filter({ hasText: target.periodCode });
  await row.waitFor({ timeout: 30_000 });
  const run = journeyRunner(ctx, journey);
  await run.screen("months", "Accounting months as Finance opens them");

  const lockLabel = t("Verrouiller la période", "Lock period");
  await run.tap(row.getByRole("button", { name: "Actions", exact: true }));
  await run.tap(page.getByRole("menuitem", { name: lockLabel, exact: true }));
  const dialog = page.getByRole("alertdialog", { name: lockLabel });
  await dialog.waitFor();
  await run.screen("lock-dialog", `Lock ${target.periodCode}: the dialog says what locking does`);

  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  const after = (await readPeriods()).find((p) => p.periodCode === target.periodCode);
  if (after?.status !== "OPEN" || after.rowVersion !== target.rowVersion) throw new Error(`${target.periodCode} changed: ${JSON.stringify(after)}`);
  log(`api cross-check: ${target.periodCode} still OPEN v${after.rowVersion}`);
  run.finish();
};

export default drive;
