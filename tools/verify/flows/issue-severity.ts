import { openSidebar, type DriveScript, type DriveContext } from "../browser.js";

/**
 * The safety-critical mark after the fact (#96), on VH001 (available in the seed).
 *
 * As the driver (default): report a problem without ticking safety-critical,
 * open it, Mark as safety-critical → the vehicle is grounded and the History
 * tab says who marked it. As an Administrator (`--role admin`, after the driver
 * run on the same slot): take the mark off with a reason → the vehicle stays
 * grounded. Each ends with an API cross-check. Mutates the slot; reset with
 * `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:issue-severity --role driver --lang en
 *      pnpm verify drive flow:issue-severity --role admin --lang en
 */
const DESCRIPTION = "Brakes squeal and pull to the left";

/** Lets the screencast paint what just opened before a shot holds the frame. */
const settle = (ctx: DriveContext) => ctx.page.waitForTimeout(700);

type IssueItem = { id: string; status: string; safetyCritical: boolean; description: string };

async function openVehicle(ctx: DriveContext): Promise<string> {
  const { page, t, quiet } = ctx;
  await (await openSidebar(page)).getByRole("link", { name: t("Camions", "Trucks") }).click();
  await page.getByRole("button", { name: /VH001/ }).first().click();
  await page.getByRole("heading", { level: 1, name: "VH001" }).waitFor();
  await quiet();
  const assetId = /\/assets\/([0-9a-f-]{36})/.exec(page.url())?.[1];
  if (assetId === undefined) throw new Error(`no asset id in ${page.url()}`);
  return assetId;
}

async function openTab(ctx: DriveContext, fr: string, en: string, suffix: string): Promise<void> {
  const { page, t, quiet } = ctx;
  await page
    .getByRole("navigation", { name: t("Sections du véhicule", "Vehicle sections") })
    .getByRole("tab", { name: new RegExp(`^${t(fr, en)}`) })
    .click();
  await page.waitForURL((url) => url.pathname.endsWith(suffix));
  await quiet();
}

async function theProblem(ctx: DriveContext, assetId: string): Promise<IssueItem> {
  const issues = await ctx.apiGet(`/v1/issues?assetId=${assetId}`);
  const issue = ((issues.body as { items?: IssueItem[] }).items ?? []).find(
    (i) => i.status === "OPEN" && i.description === DESCRIPTION,
  );
  if (issue === undefined) throw new Error(`no open "${DESCRIPTION}" problem on VH001`);
  return issue;
}

async function availability(ctx: DriveContext, assetId: string): Promise<string> {
  const detail = await ctx.apiGet(`/v1/assets/${assetId}`);
  return (detail.body as { availability?: { state?: string } }).availability?.state ?? `HTTP ${detail.status}`;
}

async function asDriver(ctx: DriveContext): Promise<void> {
  const { page, t, shot, quiet, log } = ctx;
  const assetId = await openVehicle(ctx);
  log(`VH001 starts ${await availability(ctx, assetId)}`);

  await page
    .getByRole("button", { name: new RegExp(`^(${t("Signaler un problème", "Report a problem")}|${t("Problème", "Problem")})$`) })
    .first()
    .click();
  let dialog = page.getByRole("dialog", { name: t("Signaler un problème", "Report a problem") });
  await dialog.waitFor();
  await dialog.getByLabel("Description").fill(DESCRIPTION);
  await settle(ctx);
  await shot("report-unticked", {
    caption: "The driver reports a brake problem and forgets to tick safety-critical",
    highlight: dialog.getByRole("checkbox", { name: t("Critique pour la sécurité", "Safety-critical") }),
  });
  await dialog.getByRole("button", { name: t("Signaler le problème", "Report the problem") }).click();
  await page.getByText(t("Problème signalé", "Problem reported")).first().waitFor();
  await quiet();

  await openTab(ctx, "Maintenance", "Maintenance", "/maintenance");
  await page.getByRole("button", { name: DESCRIPTION }).first().click();
  const panel = page.getByRole("dialog", { name: DESCRIPTION });
  await panel.waitFor();
  await quiet();
  const mark = panel.getByRole("button", { name: t("Marquer critique pour la sécurité", "Mark as safety-critical") });
  await mark.waitFor({ timeout: 5_000 }).catch(() => {
    throw new Error("the problem offers no Mark as safety-critical action");
  });
  await settle(ctx);
  await shot("problem-open", {
    caption: "On the problem, the driver now has Mark as safety-critical",
    highlight: mark,
  });

  await mark.click();
  dialog = page.getByRole("dialog", { name: t("Marquer critique pour la sécurité", "Mark as safety-critical") });
  await dialog.waitFor();
  await settle(ctx);
  await shot("mark-form", {
    caption: "The form says the vehicle is grounded as soon as it is saved",
    highlight: dialog.getByText(t("immobilisé dès l'enregistrement", "grounded as soon as you save"), { exact: false }),
  });
  await dialog.getByRole("button", { name: t("Marquer critique", "Mark as safety-critical") }).click();
  await page.getByText(t("Marqué critique pour la sécurité.", "Marked as safety-critical.")).first().waitFor();
  await quiet();
  await settle(ctx);
  await shot("marked", {
    caption: "The problem is now safety-critical and the vehicle is grounded",
    highlight: page.getByRole("dialog", { name: DESCRIPTION }),
  });

  for (let i = 0; i < 3 && (await page.getByRole("dialog").count()) > 0; i += 1) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  await openTab(ctx, "Historique", "History", "/history");
  const raised = page.getByText(t("Problème marqué critique pour la sécurité", "Problem marked safety-critical")).first();
  await raised.waitFor();
  await settle(ctx);
  await shot("history", {
    caption: "History shows who marked it and the grounding it caused",
    highlight: raised,
  });

  const issue = await theProblem(ctx, assetId);
  const state = await availability(ctx, assetId);
  if (!issue.safetyCritical || state !== "GROUNDED") {
    throw new Error(`problem safetyCritical=${String(issue.safetyCritical)}, VH001 ${state}`);
  }
  log(`api cross-check: problem ${issue.id.slice(0, 8)} safetyCritical=true, VH001 ${state}`);
}

async function asManager(ctx: DriveContext): Promise<void> {
  const { page, t, shot, quiet, log } = ctx;
  const assetId = await openVehicle(ctx);
  const before = await theProblem(ctx, assetId);
  if (!before.safetyCritical) throw new Error("run the driver flow first: the problem is not safety-critical");

  await openTab(ctx, "Maintenance", "Maintenance", "/maintenance");
  await page.getByRole("button", { name: DESCRIPTION }).first().click();
  const panel = page.getByRole("dialog", { name: DESCRIPTION });
  await panel.waitFor();
  await quiet();
  const lower = panel.getByRole("button", { name: t("Retirer la mention critique", "Remove the safety-critical mark") });
  await lower.waitFor();
  await settle(ctx);
  await shot("manager-problem", {
    caption: "An Administrator may take the safety-critical mark off",
    highlight: lower,
  });
  await lower.click();
  const dialog = page.getByRole("dialog", { name: t("Retirer la mention critique", "Remove the safety-critical mark") });
  await dialog.waitFor();
  await dialog.getByRole("textbox").fill(t("Vu au garage : bruit de plaquettes seulement", "Checked at the garage: pad noise only"));
  await settle(ctx);
  await shot("lower-form", {
    caption: "Taking the mark off needs a reason and leaves the vehicle grounded",
    highlight: dialog,
  });
  await dialog.getByRole("button", { name: t("Retirer la mention", "Remove the mark") }).click();
  await page.getByText(t("Mention critique retirée", "Safety-critical mark removed")).first().waitFor();
  await quiet();
  await settle(ctx);
  await shot("lowered", {
    caption: "The mark is off; the chronology shows who took it off",
    highlight: page.getByRole("dialog", { name: DESCRIPTION }),
  });
  for (let i = 0; i < 3 && (await page.getByRole("dialog").count()) > 0; i += 1) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
  }
  await settle(ctx);
  await shot("still-grounded", {
    caption: "The vehicle is still grounded: only a release puts it back on the road",
    highlight: page.getByText(t("Immobilisé", "Grounded"), { exact: false }).first(),
  });

  const after = await theProblem(ctx, assetId);
  const state = await availability(ctx, assetId);
  if (after.safetyCritical || state !== "GROUNDED") {
    throw new Error(`problem safetyCritical=${String(after.safetyCritical)}, VH001 ${state}`);
  }
  log(`api cross-check: problem ${after.id.slice(0, 8)} safetyCritical=false, VH001 still ${state}`);
}

const flow: DriveScript = async (ctx) => {
  if (ctx.account.role === "DRIVER") await asDriver(ctx);
  else await asManager(ctx);
};

export default flow;
