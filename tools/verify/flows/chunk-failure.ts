import type { Page } from "playwright-core";
import type { DriveScript } from "../browser.js";

/**
 * A screen whose code cannot be fetched never blanks the app (#488 review).
 * Each case blocks one screen's code file the way a dropped connection or a
 * deploy would, opens that screen in-app, and counts full page loads:
 *   A  the background fetch of Company settings fails once; later, online, it opens with no reload
 *   B  offline before the background fetch reached Branches: the shell stays, a translated error
 *      with Try again shows in the screen's slot, no reload; back online it opens by itself
 *   C  online, People's code fails on the tap: the error shows, no reload; Try again opens it
 *   D  a deploy replaced the files (index.html names another entry): one reload, never a second
 * The blocked files show up as failed requests, and each error the screen's
 * boundary catches is logged to the console; both are expected here.
 * Run: pnpm verify drive flow:chunk-failure --role director --lang en
 */

const screenError = (page: Page, t: (fr: string, en: string) => string) =>
  page.getByRole("alert").filter({ hasText: t("Impossible d'ouvrir cette page", "This page could not be opened") });

const flow: DriveScript = async ({ page, shot, log, nav, t }) => {
  const failures: string[] = [];
  const check = (ok: boolean, what: string) => {
    log(`${ok ? "PASS" : "FAIL"} ${what}`);
    if (!ok) failures.push(what);
  };
  const home = new URL("/", page.url()).href;
  let loads = 0;
  page.on("load", () => {
    loads += 1;
  });
  const failedCode: string[] = [];
  page.on("requestfailed", (request) => {
    if (/\/static\/.+\.js$/.test(request.url())) failedCode.push(request.url().split("/static/")[1] ?? request.url());
  });
  const heading = (name: string) => page.getByRole("heading", { level: 1, name, exact: true });
  const shellHeader = page.locator("[data-slot='sidebar-inset'] > header");
  const coldHome = async () => {
    await page.goto(home);
    await heading(t("Accueil", "Home")).waitFor({ timeout: 60_000 });
  };

  // A: a transient failure during the background fetch, then online.
  await page.route("**/static/CompanySettingsScreen-*.js", (route) => route.abort("failed"));
  await coldHome();
  const started = Date.now();
  while (!failedCode.some((file) => file.startsWith("CompanySettingsScreen")) && Date.now() - started < 120_000) await page.waitForTimeout(500);
  check(failedCode.some((file) => file.startsWith("CompanySettingsScreen")), "A: the background fetch of Company settings failed once");
  await page.unroute("**/static/CompanySettingsScreen-*.js");
  let before = loads;
  await nav("/more/company");
  const openedA = await heading(t("Paramètres de l'entreprise", "Company settings")).waitFor({ timeout: 30_000 }).then(() => true, () => false);
  check(openedA && loads === before, `A: Company settings opens in-app after the failed fetch (full page loads: ${loads - before})`);

  // B: offline before the background fetch reached Branches.
  await page.route("**/static/BranchesScreen-*.js", (route) => route.abort("internetdisconnected"));
  await coldHome();
  await page.context().setOffline(true);
  await page.unroute("**/static/BranchesScreen-*.js");
  before = loads;
  await nav("/more/branches");
  const shownB = await screenError(page, t).waitFor({ timeout: 30_000 }).then(() => true, () => false);
  check(shownB, "B: offline, Branches shows the translated error in its slot");
  check(loads === before && (await shellHeader.isVisible()), `B: no reload and the shell stays (full page loads: ${loads - before})`);
  check(await page.getByRole("button", { name: t("Réessayer", "Try again"), exact: true }).isVisible(), "B: the error offers Try again");
  await shot("b-offline-unfetched-screen", {
    caption: "Offline before Branches' code arrived: the shell stays and the page says it could not open, with Try again",
    highlight: screenError(page, t),
  });
  await page.context().setOffline(false);
  const recoveredB = await heading(t("Agences", "Branches")).waitFor({ timeout: 30_000 }).then(() => true, () => false);
  check(recoveredB && loads === before, "B: back online, Branches opens by itself without a reload");
  await shot("b-back-online", { caption: "Back online: Branches opens by itself, no reload" });

  // C: online, the screen's code fails on the tap; Try again.
  // Every attempt fails while the connection is bad, the app's retry under a new URL included.
  const persons = /\/static\/PersonsScreen-[^/?]+\.js(\?.*)?$/;
  await page.route(persons, (route) => route.abort("failed"));
  await coldHome();
  before = loads;
  await nav("/more/persons");
  const shownC = await screenError(page, t).waitFor({ timeout: 30_000 }).then(() => true, () => false);
  check(shownC && loads === before, `C: online, a failed fetch shows the error and no reload (full page loads: ${loads - before})`);
  await page.unroute(persons);
  await page.getByRole("button", { name: t("Réessayer", "Try again"), exact: true }).click();
  const openedC = await heading(t("Personnel", "People")).waitFor({ timeout: 30_000 }).then(() => true, () => false);
  check(openedC && loads === before, "C: Try again opens People in-app");
  await shot("c-try-again", { caption: "Try again fetched People's code and opened it, without a reload" });

  // D: a deploy replaced the files. The app's own check reads index.html (a fetch); the
  // browser's navigations keep the real one, so the reload lands on a working app.
  await page.evaluate(() => sessionStorage.removeItem("routiq-reloaded-for-entry"));
  // The old file is gone from the server, under any query string too.
  const removed = /\/static\/UsersScreen-[^/?]+\.js(\?.*)?$/;
  await page.route(removed, (route) => route.fulfill({ status: 404, body: "" }));
  await page.route(home, async (route) => {
    if (route.request().resourceType() !== "fetch") return route.continue();
    const response = await route.fetch();
    const html = (await response.text()).replace(/(src="\/static\/index-)[^"]+(\.js")/, "$1after-deploy$2");
    return route.fulfill({ response, body: html });
  });
  await coldHome();
  before = loads;
  await nav("/more/users");
  await page.waitForTimeout(3_000);
  await page.waitForLoadState("load");
  const shownD = await screenError(page, t).waitFor({ timeout: 60_000 }).then(() => true, () => false);
  check(loads - before === 1, `D: exactly one reload after a deploy (full page loads: ${loads - before})`);
  check(shownD && (await shellHeader.isVisible()), "D: the file still missing after the reload, the error shows in place instead of a second reload");
  await page.unroute(removed);
  await page.unroute(home);

  if (failures.length > 0) throw new Error(`chunk failure checks failed:\n  ${failures.join("\n  ")}`);
};

export default flow;
