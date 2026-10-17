import { openSidebar, type DriveScript } from "../browser.js";

type Period = { periodCode: string; status: "OPEN" | "LOCKED"; rowVersion: number };

/**
 * Company → Accounting months → lock a month the books already hold, then
 * reopen it with a reason (#571). The month is the newest OPEN one with a
 * stored row (rowVersion ≥ 1), the case that needs `expectedVersion`. After
 * each command `GET /v1/finance/periods` must show the new status and a row
 * version one higher. Reopening is Direction's alone, so run as the director.
 * Mutates the slot; reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:lock-period --role director --lang en
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  const readPeriods = async (): Promise<Period[]> => {
    const res = await apiGet("/v1/finance/periods");
    if (res.status !== 200) throw new Error(`GET /v1/finance/periods → ${res.status}`);
    return (res.body as { periods?: Period[] }).periods ?? [];
  };
  const readPeriod = async (code: string): Promise<Period> => {
    const found = (await readPeriods()).find((p) => p.periodCode === code);
    if (found === undefined) throw new Error(`${code} missing from GET /v1/finance/periods`);
    return found;
  };

  const target = (await readPeriods())
    .filter((p) => p.status === "OPEN" && p.rowVersion >= 1)
    .sort((a, b) => b.periodCode.localeCompare(a.periodCode))[0];
  if (target === undefined) throw new Error("no OPEN month with a stored row to lock (reseed?)");
  log(`api: locking ${target.periodCode} at row version ${target.rowVersion}`);

  await (await openSidebar(page)).getByRole("link", { name: t("Mois comptables", "Accounting months"), exact: true }).click();
  await page.getByRole("heading", { level: 1, name: t("Mois comptables", "Accounting months") }).waitFor();
  await quiet();
  const row = page.getByRole("row").filter({ hasText: target.periodCode });
  await shot("months", { caption: `Accounting months: ${target.periodCode} is open`, highlight: row });

  const lockLabel = t("Verrouiller la période", "Lock period");
  await row.getByRole("button", { name: "Actions", exact: true }).click();
  await page.getByRole("menuitem", { name: lockLabel, exact: true }).click();
  const lockDialog = page.getByRole("alertdialog", { name: lockLabel });
  await lockDialog.waitFor();
  await shot("lock-dialog", { caption: `Lock ${target.periodCode}: the dialog asks to confirm`, highlight: lockDialog });
  await lockDialog.getByRole("button", { name: lockLabel, exact: true }).click();
  await page.getByText(t("Période verrouillée", "Period locked")).first().waitFor();
  await lockDialog.waitFor({ state: "hidden" });
  await quiet();
  await row.getByText(t("Verrouillée", "Locked")).first().waitFor();
  await shot("locked", { caption: `${target.periodCode} is locked: the row says so and no error showed`, highlight: row });

  const locked = await readPeriod(target.periodCode);
  if (locked.status !== "LOCKED" || locked.rowVersion !== target.rowVersion + 1) {
    throw new Error(`after lock ${target.periodCode} is ${locked.status} v${locked.rowVersion}, expected LOCKED v${target.rowVersion + 1}`);
  }
  log(`api cross-check: ${target.periodCode} LOCKED at row version ${locked.rowVersion}`);

  const reopenLabel = t("Rouvrir la période", "Reopen period");
  await row.getByRole("button", { name: "Actions", exact: true }).click();
  await page.getByRole("menuitem", { name: reopenLabel, exact: true }).click();
  const reopenDialog = page.getByRole("dialog", { name: reopenLabel });
  await reopenDialog.waitFor();
  await reopenDialog.getByLabel(t("Motif de la réouverture", "Reason for reopening")).fill("Late fuel receipt to record");
  await shot("reopen-dialog", { caption: `Reopen ${target.periodCode}: Direction gives a reason`, highlight: reopenDialog });
  await reopenDialog.getByRole("button", { name: reopenLabel, exact: true }).click();
  await page.getByText(t("Période rouverte", "Period reopened")).first().waitFor();
  await reopenDialog.waitFor({ state: "hidden" });
  await quiet();
  await row.getByText(t("Ouverte", "Open"), { exact: true }).waitFor();
  await shot("reopened", { caption: `${target.periodCode} is open again`, highlight: row });

  const reopened = await readPeriod(target.periodCode);
  if (reopened.status !== "OPEN" || reopened.rowVersion !== target.rowVersion + 2) {
    throw new Error(`after reopen ${target.periodCode} is ${reopened.status} v${reopened.rowVersion}, expected OPEN v${target.rowVersion + 2}`);
  }
  log(`api cross-check: ${target.periodCode} OPEN at row version ${reopened.rowVersion}`);
};

export default flow;
