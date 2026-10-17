import { signOutThroughNameMenu, type DriveScript } from "../browser.js";
import { resolveAccount } from "../accounts.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "driver-signs-in",
  actor: { role: "driver", person: "A driver (chauffeur), at the depot before the first trip" },
  arrangeAs: "driver",
  goal: "sign in and see their Home: the trucks they can take and what they recorded",
  trigger: "The phone was signed out, or a shared phone changes hands",
  frequency: "Daily",
  device: { viewport: { width: 390, height: 844 }, throttle: "phone" },
  doneWhen: "Home shows after one tap on Sign in and GET /v1/me answers role DRIVER",
  firstGlance: {
    purpose: "Sign in to ROUTIQ (then: my Home)",
    state: "Signed out, my company and name already filled in",
    nextAction: "Type my PIN and tap Sign in",
  },
  budgets: {
    taps: 1,
    seconds: 8,
    wordsPerScreen: 120,
    foldWordsPerScreen: 80,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/**
 * The runner always signs in first, so the arrange step signs out through the
 * name menu: the sign-in screen is then what a returning driver sees.
 * Read-only. Run: pnpm verify drive journey:driver-signs-in --role driver --viewport 390x844 --throttle phone --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, apiGet, log } = ctx;
  assertStartedAs(ctx, journey);
  const driver = resolveAccount(journey.arrangeAs);
  await ctx.quiet();
  await signOutThroughNameMenu(page);
  const run = journeyRunner(ctx, journey);
  await page.getByRole("button", { name: t("Se connecter", "Sign in") }).waitFor();
  await run.screen("login", "Signed out: the sign-in screen on a driver's phone");

  // Typing isn't counted; the last session's workspace and username are kept.
  await page.getByLabel(t("Espace de travail", "Workspace"), { exact: true }).fill(driver.workspace);
  await page.getByLabel(t("Nom d'utilisateur", "Username"), { exact: true }).fill(driver.username);
  await page.getByLabel(t("Code PIN", "PIN code"), { exact: true }).fill(driver.pin);
  await run.tap(page.getByRole("button", { name: t("Se connecter", "Sign in") }));
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 30_000 });
  await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 60_000 });
  await run.screen("home", "The driver's Home after signing in");

  const me = await apiGet("/v1/me");
  const role = (me.body as { role?: string }).role;
  if (me.status !== 200 || role !== "DRIVER") throw new Error(`GET /v1/me → ${me.status} ${role ?? ""}`);
  log(`api cross-check: GET /v1/me → role ${role}`);
  run.finish();
};

export default drive;
