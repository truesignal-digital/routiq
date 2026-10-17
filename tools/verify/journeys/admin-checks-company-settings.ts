import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "admin-checks-company-settings",
  actor: { role: "admin", person: "The Administrateur (chef d'agence), at the office" },
  arrangeAs: "admin",
  goal: "check up to which amount an entry posts without review, who approves above it, and when the summary shows",
  trigger: "A cashier asks why an expense waits for approval",
  frequency: "Monthly",
  device: { viewport: { width: 1440, height: 900 }, throttle: "none" },
  doneWhen:
    "The page shows both thresholds of GET /v1/approval-thresholds in FCFA and the schedule of GET /v1/company-settings; the change panel opens with the current amounts",
  firstGlance: {
    purpose: "The company's approval amounts and Overview summary",
    state: "Up to 100 000 FCFA posts directly; Finance approves up to 1 000 000 FCFA; above, the Director",
    nextAction: "Change the approval thresholds",
  },
  budgets: {
    taps: 1,
    seconds: 5,
    // Rules are short lines with amounts, one per role; not paragraphs about them.
    wordsPerScreen: 220,
    foldWordsPerScreen: 160,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/**
 * Read-only. Company settings, then the change-thresholds panel (dismissed, nothing sent).
 * Run: pnpm verify drive journey:admin-checks-company-settings --role admin --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, nav, log, apiGet } = ctx;
  assertStartedAs(ctx, journey);
  await nav("/more/company");
  await page.getByRole("heading", { level: 1, name: t("Paramètres de l'entreprise", "Company settings") }).waitFor({ timeout: 60_000 });
  const approvals = page.getByRole("region", { name: t("Approbations", "Approvals"), exact: true });
  await approvals.getByRole("list").first().waitFor({ timeout: 30_000 });
  const run = journeyRunner(ctx, journey);
  await run.screen("company-settings", "Company settings as the Administrateur sees them");

  const thresholds = (await apiGet("/v1/approval-thresholds")).body as {
    recordingThresholdMinor: number;
    financeCeilingMinor: number;
  };
  const text = (await approvals.innerText()).replace(/\s+/g, " ");
  for (const amount of [thresholds.recordingThresholdMinor, thresholds.financeCeilingMinor]) {
    const shown = `${new Intl.NumberFormat("fr-FR").format(amount).replace(/\s/g, " ")} FCFA`;
    if (!text.replace(/\s/g, " ").includes(shown)) throw new Error(`approvals do not show ${shown}`);
  }
  const settings = (await apiGet("/v1/company-settings")).body as { summarySchedule: string };
  log(`api cross-check: thresholds ${thresholds.recordingThresholdMinor} / ${thresholds.financeCeilingMinor} FCFA shown; schedule ${settings.summarySchedule}`);

  await run.tap(approvals.getByRole("button", { name: t("Modifier les seuils d'approbation", "Change approval thresholds"), exact: true }));
  const sheet = page.getByRole("dialog");
  await sheet.waitFor();
  await run.screen("change-thresholds", "The change-thresholds panel, with the current amounts");
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "detached" });
  run.finish();
};

export default drive;
