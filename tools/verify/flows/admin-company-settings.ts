import { openSidebar, type DriveScript } from "../browser.js";

/**
 * Administrators change the company settings too (#711, ADR-0013). Opens
 * Company settings from the sidebar, checks the page says who may change it,
 * moves the "Posts directly up to" threshold, checks the company's band moved
 * (GET /v1/approval-thresholds) and the last change names the caller, then
 * puts 100 000 back. Writes two update-approval-threshold commands.
 * Run as the Administrator scoped to Yaoundé, so the change is shown to be the
 * company's, not a branch copy:
 *   pnpm verify drive flow:admin-company-settings --role admin-yde --lang en --reel
 *   (and --viewport 390x844); Direction runs it the same way.
 */
const flow: DriveScript = async ({ page, account, t, shot, quiet, log, apiGet }) => {
  type Thresholds = {
    recordingThresholdMinor: number | null;
    financeCeilingMinor: number | null;
    overrides: unknown[];
    lastChange: { changedBy: string | null } | null;
  };
  const thresholds = async (): Promise<Thresholds> => {
    const read = await apiGet("/v1/approval-thresholds");
    if (read.status !== 200) throw new Error(`GET /v1/approval-thresholds → ${read.status}`);
    return read.body as Thresholds;
  };
  const settings = await apiGet("/v1/company-settings");
  if (settings.status !== 200) throw new Error(`GET /v1/company-settings → ${settings.status}`);
  log(`api: GET /v1/company-settings → ${settings.status} ${JSON.stringify(settings.body)}`);
  const before = await thresholds();
  log(`api: GET /v1/approval-thresholds → recording ${before.recordingThresholdMinor}, ceiling ${before.financeCeilingMinor}, ${before.overrides.length} branch/category exceptions`);

  await (await openSidebar(page)).getByRole("link", { name: t("Paramètres de l'entreprise", "Company settings"), exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/more/company");
  const approvals = page.getByRole("region", { name: t("Approbations", "Approvals"), exact: true });
  await approvals.waitFor();
  const who = page.getByText(
    t(
      "Des règles qui s'appliquent à toute l'entreprise. Seuls la Direction et les Administrateurs peuvent les modifier.",
      "Rules that apply to everyone in the company. Only the Director and Administrators can change them.",
    ),
    { exact: true },
  );
  await who.waitFor();
  await quiet();
  await shot("company-settings", {
    caption: `${account.displayName}, an Administrator for one branch, opens Company settings: the Director and Administrators can change these rules`,
    highlight: who,
  });

  const setRecording = async (amount: string) => {
    const title = t("Modifier les seuils d'approbation", "Change approval thresholds");
    await approvals.getByRole("button", { name: title, exact: true }).click();
    // By name: the saved toast is a dialog too.
    const sheet = page.getByRole("dialog", { name: title });
    await sheet.waitFor();
    const field = sheet.getByLabel(t("Enregistré directement jusqu'à", "Posts directly up to"));
    await field.fill(amount);
    return sheet;
  };

  const sheet = await setRecording("150000");
  await quiet();
  await shot("thresholds-form", {
    caption: "Posts directly up to 150,000 for the whole company; the sheet shows the new chain and who will be told",
    highlight: sheet,
  });
  await sheet.getByRole("button", { name: t("Enregistrer les seuils", "Save thresholds"), exact: true }).click();
  await sheet.waitFor({ state: "detached" });
  const changedBy = approvals.getByText(new RegExp(account.displayName));
  await changedBy.waitFor();
  await quiet();
  await shot("thresholds-saved", {
    caption: `Saved through update-approval-threshold: the company's chain moved, and the last change names ${account.displayName}`,
    highlight: changedBy,
  });

  const after = await thresholds();
  log(`api: after → recording ${after.recordingThresholdMinor}, ceiling ${after.financeCeilingMinor}, changed by ${after.lastChange?.changedBy}, ${after.overrides.length} exceptions`);
  if (after.recordingThresholdMinor !== 150_000) throw new Error(`recording band is ${after.recordingThresholdMinor}, not 150000`);
  if (after.lastChange?.changedBy !== account.displayName) throw new Error(`last change names ${after.lastChange?.changedBy}`);
  if (after.overrides.length !== before.overrides.length) throw new Error("a branch exception appeared: the change was not the company's");

  const back = await setRecording(String(before.recordingThresholdMinor ?? 100_000));
  await back.getByRole("button", { name: t("Enregistrer les seuils", "Save thresholds"), exact: true }).click();
  await back.waitFor({ state: "detached" });
  await quiet();
  const restored = await thresholds();
  if (restored.recordingThresholdMinor !== before.recordingThresholdMinor) {
    throw new Error(`recording band left at ${restored.recordingThresholdMinor}`);
  }
  await shot("thresholds-restored", {
    caption: "Put back to the company's earlier threshold",
    highlight: approvals.getByRole("heading", { name: t("Approbations", "Approvals"), exact: true }),
  });
  log(`api: restored → recording ${restored.recordingThresholdMinor}`);
};

export default flow;
