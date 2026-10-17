import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "member-sets-language",
  actor: { role: "driver", person: "Any member; here a driver who reads English better" },
  arrangeAs: "driver",
  goal: "switch the app's language",
  trigger: "A new phone, or a colleague left it in the other language",
  frequency: "Rarely",
  device: { viewport: { width: 390, height: 844 }, throttle: "phone" },
  doneWhen: "My settings shows the other language and localStorage routiq-language holds it",
  firstGlance: {
    purpose: "My own settings: who I am, language, appearance",
    state: "Français is selected",
    nextAction: "Tap English",
  },
  budgets: {
    // Menu button, name menu, My settings, then the language.
    taps: 4,
    seconds: 8,
    wordsPerScreen: 80,
    foldWordsPerScreen: 80,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/**
 * Changes only this device's language preference. With --lang en it switches
 * back to French, so both runs make a real change.
 * Run: pnpm verify drive journey:member-sets-language --role driver --viewport 390x844 --throttle phone --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, log } = ctx;
  assertStartedAs(ctx, journey);
  await ctx.quiet();
  await page.locator("[data-slot='sidebar-inset'][aria-busy='true']").waitFor({ state: "detached", timeout: 30_000 });
  const run = journeyRunner(ctx, journey);
  await run.tap(page.getByRole("button", { name: t("Afficher ou masquer le menu", "Show or hide the menu") }).first());
  await run.tap(page.locator('[data-sidebar="footer"] [data-sidebar="menu-button"]').first());
  await run.tap(page.getByRole("menuitem", { name: t("Mes réglages", "My settings") }));
  await page.getByRole("heading", { level: 1, name: t("Mes réglages", "My settings") }).waitFor({ timeout: 30_000 });
  await run.screen("my-settings", "My settings on a phone");

  const target = ctx.lang === "fr" ? { label: "English", stored: "en", heading: "My settings" } : { label: "Français", stored: "fr-CM", heading: "Mes réglages" };
  await run.tap(page.getByRole("button", { name: target.label, exact: true }));
  await page.getByRole("heading", { level: 1, name: target.heading }).waitFor({ timeout: 10_000 });
  await run.screen("my-settings-switched", `My settings after choosing ${target.label}`);

  const stored = await page.evaluate(() => localStorage.getItem("routiq-language"));
  if (stored !== target.stored) throw new Error(`routiq-language is ${stored ?? "unset"}, expected ${target.stored}`);
  log(`device language stored: ${stored}`);
  run.finish();
};

export default drive;
