import type { Page } from "playwright-core";
import { DEMO_ACCOUNTS, DEMO_WORKSPACE, type DemoAccount } from "../accounts.js";
import type { DriveContext, DriveScript } from "../browser.js";

/**
 * No list page scrolls sideways on a 390 px phone (#183). Signs in as every
 * demo account, opens each list route at 390 × 844 in French and English, and
 * fails with the route and the measured width when the page is wider than the
 * screen or a control sticks out past its right edge. It also opens an open
 * and a closed trip, whose header carries the most actions, and fails when the
 * trip number breaks across lines (#395).
 * Run: pnpm verify drive flow:phone-overflow
 */
export const PHONE = { width: 390, height: 844 } as const;

export const LIST_ROUTES = [
  "/",
  "/assets",
  "/activities",
  "/maintenance",
  "/finance/entries",
  "/finance/approvals",
  "/finance/periods",
  "/more",
  "/more/persons",
  "/more/users",
  "/more/branches",
] as const;

interface Measure {
  scrollWidth: number;
  innerWidth: number;
  /** Controls whose right edge is past the screen and that no scroll container holds. */
  cutOff: string[];
  /** Lines the page title takes; a record number must stay on one. */
  titleLines: number;
}

// tsx names inner functions with a `__name` helper the page doesn't have, so
// the browser-side code below declares no named functions.
function measure(page: Page): Promise<Measure> {
  return page.evaluate(() => {
    const innerWidth = window.innerWidth;
    const cutOff: string[] = [];
    for (const el of document.querySelectorAll("main button, main a[href], main input, main [role='combobox'], header button")) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0 || box.right <= innerWidth + 1) continue;
      let scrolled = false;
      for (let node = el.parentElement; node !== null && node !== document.documentElement; node = node.parentElement) {
        const overflowX = getComputedStyle(node).overflowX;
        if ((overflowX === "auto" || overflowX === "scroll") && node.scrollWidth > node.clientWidth) scrolled = true;
      }
      if (!scrolled) cutOff.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? "").trim().slice(0, 40)}" right ${Math.round(box.right)}`);
    }
    const title = document.querySelector("main h1");
    const lineHeight = title === null ? 0 : parseFloat(getComputedStyle(title).lineHeight);
    const titleLines = title === null || !(lineHeight > 0) ? 1 : Math.round(title.getBoundingClientRect().height / lineHeight);
    return { scrollWidth: document.documentElement.scrollWidth, innerWidth, cutOff: cutOff.slice(0, 5), titleLines };
  });
}

/** One open and one closed trip; the open one shows every capture action. */
async function tripRoutes(apiGet: DriveContext["apiGet"]): Promise<string[]> {
  const list = await apiGet("/v1/activities");
  const items = (list.body as { items?: Array<{ id: string; status: string }> }).items ?? [];
  const routes = (["OPEN", "CLOSED"] as const).map((status) => {
    const trip = items.find((item) => item.status === status);
    if (trip === undefined) throw new Error(`GET /v1/activities → ${list.status}, no ${status} trip`);
    return `/activities/${trip.id}`;
  });
  return routes;
}

const flow: DriveScript = async ({ page, shot, quiet, log, apiGet }) => {
  await page.setViewportSize(PHONE);
  const failures: string[] = [];
  const routes = [...LIST_ROUTES, ...(await tripRoutes(apiGet))];

  const goTo = async (route: string) => {
    await page.evaluate((to) => {
      window.history.pushState({}, "", to);
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
    }, route);
    await quiet();
    // Some roles are redirected or denied; either way the screen draws an h1.
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 10_000 }).catch(() => undefined);
    await quiet();
  };

  const signIn = async (account: DemoAccount) => {
    if (!new URL(page.url()).pathname.startsWith("/login")) {
      await goTo("/more");
      await page.getByRole("main").getByRole("button", { name: /^(Se déconnecter|Sign out)$/ }).click();
      await page.waitForURL((url) => url.pathname === "/login");
    }
    await page.getByLabel(/^(Espace de travail|Workspace)$/).fill(DEMO_WORKSPACE);
    await page.getByLabel(/^(Nom d'utilisateur|Username)$/).fill(account.username);
    await page.getByLabel(/^(Code PIN|PIN code)$/).fill(account.pin);
    await page.getByRole("button", { name: /^(Se connecter|Sign in)$/ }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
    await quiet();
  };

  const chooseLanguage = async (lang: "fr" | "en") => {
    await goTo("/more");
    await page.getByRole("button", { name: lang === "en" ? "English" : "Français", exact: true }).click();
    await page.getByRole("heading", { name: lang === "en" ? "Language" : "Langue" }).waitFor({ timeout: 10_000 });
  };

  for (const account of DEMO_ACCOUNTS) {
    await signIn(account);
    for (const lang of ["fr", "en"] as const) {
      await chooseLanguage(lang);
      for (const route of routes) {
        await goTo(route);
        const { scrollWidth, innerWidth, cutOff, titleLines } = await measure(page);
        const where = `${account.username} (${account.role}) ${lang} ${route}`;
        const titleBroken = route.startsWith("/activities/") && titleLines > 1;
        if (scrollWidth > innerWidth || cutOff.length > 0 || titleBroken) {
          const reasons = [
            ...(scrollWidth > innerWidth ? [`page ${scrollWidth} px wide on a ${innerWidth} px screen`] : []),
            ...cutOff.map((item) => `cut off: ${item}`),
            ...(titleBroken ? [`trip number on ${titleLines} lines`] : []),
          ];
          failures.push(`${where}: ${reasons.join("; ")}`);
          log(`OVERFLOW ${where}: ${reasons.join("; ")}`);
          await shot(`overflow-${account.username}-${lang}-${route}`);
        } else {
          log(`ok ${where}: ${scrollWidth} px`);
        }
      }
    }
  }
  if (failures.length > 0) throw new Error(`${failures.length} phone overflows; first: ${failures[0]}`);
};

export default flow;
