import type { DriveScript } from "../browser.js";
import { assertStartedAs, journeyRunner, type Journey } from "../journey/journey.js";

export const journey: Journey = {
  id: "admin-works-todo",
  actor: { role: "admin", person: "The Administrateur (chef d'agence), on the move" },
  arrangeAs: "admin",
  goal: "see everything that waits on them, then start on the first",
  trigger: "The To do count on the Dashboard is high; a quiet moment to clear it",
  frequency: "Daily",
  device: { viewport: { width: 390, height: 844 }, throttle: "phone" },
  doneWhen: "The To do tab lists every row of GET /v1/todo, and the first row's action opens the record it names",
  firstGlance: {
    purpose: "Everything that needs me, most urgent first",
    state: "VH003 grounded under repair, a document expired, receipts missing",
    nextAction: "Act on the first row",
  },
  budgets: {
    taps: 2,
    seconds: 15,
    wordsPerScreen: 250,
    foldWordsPerScreen: 80,
    proseWordsPerScreen: 12,
    longestBlock: 12,
    primaryActionsPerScreen: 1,
    smallTargetsPerScreen: 0,
    axePerScreen: 0,
  },
};

/**
 * Read-only. Dashboard → To do tab → the first row's action.
 * Run: pnpm verify drive journey:admin-works-todo --role admin --viewport 390x844 --throttle phone --lang fr
 */
const drive: DriveScript = async (ctx) => {
  const { page, t, apiGet, log } = ctx;
  assertStartedAs(ctx, journey);
  // --lang en switches on My settings, so the drive may start there.
  if (new URL(page.url()).pathname !== "/") await ctx.nav("/");
  await page.getByRole("heading", { level: 1, name: t("Tableau de bord", "Dashboard") }).waitFor({ timeout: 60_000 });
  await ctx.quiet();
  const run = journeyRunner(ctx, journey);

  await run.tap(page.getByRole("tab", { name: new RegExp(`^${t("À faire", "To do")}`) }));
  await page.locator("[data-slot=dashboard-todo]").waitFor({ timeout: 30_000 });
  const rows = page.locator("[data-slot=dashboard-todo] [data-slot=to-do-row]");
  await rows.first().waitFor({ timeout: 30_000 });
  await run.screen("to-do", "The full To do tab on the Administrateur's phone");

  const todo = await apiGet("/v1/todo");
  const body = todo.body as { rows?: unknown[] };
  const shown = await rows.count();
  if (todo.status !== 200 || body.rows?.length !== shown) {
    throw new Error(`GET /v1/todo → ${todo.status}, ${body.rows?.length ?? "?"} rows; the tab shows ${shown}`);
  }
  log(`api cross-check: /v1/todo ${shown} rows, all shown`);

  const before = page.url();
  const title = await page.getByRole("heading", { level: 1 }).first().textContent();
  await run.tap(rows.first().getByRole("link").last());
  await page.waitForURL((url) => url.href !== before, { timeout: 30_000 });
  await page.waitForFunction((h) => {
    const h1 = document.querySelector("main h1");
    return h1 !== null && h1.textContent !== h;
  }, title, { timeout: 60_000 });
  log(`first row opened ${new URL(page.url()).pathname}`);
  run.finish();
};

export default drive;
