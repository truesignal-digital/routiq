import type { Page } from "playwright-core";
import { DEMO_ACCOUNTS, type DemoAccount } from "../accounts.js";
import { signOutThroughNameMenu, type DriveScript } from "../browser.js";

/**
 * The entries list fits its card (#436). Opens it at 1440 × 900 and 1280 × 800
 * with the sidebar open, in French and English, and fails with the measured
 * widths when the page is wider than the screen, when the table scrolls
 * sideways inside its card, when a row's ⋯ menu sits past the card's right
 * edge, when opening that menu scrolls the table and hides the start of the
 * first column, or when no sorted column header shows (a list is never sorted
 * by a column the viewer can't see).
 * Trips and the Money waiting view have the same check in flow:desktop-fit-shell.
 * Run: pnpm verify drive flow:desktop-fit
 */
export const DESKTOP_VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1280, height: 800 },
] as const;

export const FIT_ROUTES = ["/finance/entries"] as const;

/** Routes with a default sort: its column must be on screen at every width. */
const SORTED_ROUTES: readonly string[] = ["/finance/entries"];

/** Every role that reads money: the ⋯ menu differs by role, the columns don't. */
const FIT_USERNAMES = ["nadege", "emilienne", "boris", "clarisse", "sali"] as const;

interface TableMeasure {
  tables: number;
  /** Set when the page itself is wider than the screen, card and all. */
  pageWide?: string;
  /** Tables whose content is wider than the card that holds them. */
  scrolling: string[];
  /** Row controls whose right edge is past the card's visible right edge. */
  cutOff: string[];
  /** The first table's sorted column header, when one shows. */
  sortedBy?: string;
}

// tsx names inner functions with a `__name` helper the page doesn't have, so
// the browser-side code below declares no named functions.
function measureTables(page: Page): Promise<TableMeasure> {
  return page.evaluate(() => {
    const containers = [...document.querySelectorAll<HTMLElement>("main [data-slot='table-container']")];
    const innerWidth = window.innerWidth;
    const pageWidth = document.documentElement.scrollWidth;
    const scrolling: string[] = [];
    const cutOff: string[] = [];
    containers.forEach((container, index) => {
      if (container.scrollWidth > container.clientWidth + 1) {
        scrolling.push(`table ${index + 1}: ${container.scrollWidth} px of content in a ${container.clientWidth} px card`);
      }
      // A card that grew past the screen hides its own right edge, so the
      // visible edge is whichever comes first.
      const edge = Math.min(container.getBoundingClientRect().right, innerWidth);
      for (const control of container.querySelectorAll("tbody button, tbody a[href]")) {
        const box = control.getBoundingClientRect();
        if (box.width === 0 || box.right <= edge + 1) continue;
        cutOff.push(`${control.tagName.toLowerCase()} "${(control.getAttribute("aria-label") ?? control.textContent ?? "").trim().slice(0, 30)}" right ${Math.round(box.right)} > card ${Math.round(edge)}`);
      }
    });
    const sorted = containers[0]?.querySelector("thead th[aria-sort='ascending'], thead th[aria-sort='descending']");
    return {
      tables: containers.length,
      ...(sorted === null || sorted === undefined ? {} : { sortedBy: (sorted.textContent ?? "").trim() }),
      ...(pageWidth > innerWidth ? { pageWide: `page ${pageWidth} px wide on a ${innerWidth} px screen` } : {}),
      scrolling,
      cutOff: cutOff.slice(0, 5),
    };
  });
}

/** Opens the first row's ⋯ menu and reports a sideways scroll it caused. */
async function menuShift(page: Page): Promise<string | undefined> {
  const trigger = page.locator("main [data-slot='table-container'] tbody tr").first().locator("td").last().locator("button[aria-haspopup='menu']");
  if ((await trigger.count()) === 0) return undefined;
  await trigger.click();
  await page.getByRole("menu").waitFor({ timeout: 5_000 });
  const shift = await page.evaluate(() => {
    const container = document.querySelector<HTMLElement>("main [data-slot='table-container']");
    const firstCell = container?.querySelector("tbody tr td");
    if (container === null || container === undefined || firstCell === null || firstCell === undefined) return 0;
    return Math.max(container.scrollLeft, Math.round(container.getBoundingClientRect().left - firstCell.getBoundingClientRect().left));
  });
  await page.keyboard.press("Escape");
  await page.getByRole("menu").waitFor({ state: "hidden", timeout: 5_000 });
  return shift > 1 ? `opening the ⋯ menu scrolled the table ${shift} px and hid the start of the first column` : undefined;
}

const flow: DriveScript = async ({ page, shot, quiet, log }) => {
  const failures: string[] = [];
  const accounts = FIT_USERNAMES.map((username) => {
    const account = DEMO_ACCOUNTS.find((candidate) => candidate.username === username);
    if (account === undefined) throw new Error(`no demo account ${username}`);
    return account;
  });

  const goTo = async (route: string) => {
    await page.evaluate((to) => {
      window.history.pushState({}, "", to);
      window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
    }, route);
    await quiet();
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 10_000 }).catch(() => undefined);
    await quiet();
  };

  const signIn = async (account: DemoAccount) => {
    if (!new URL(page.url()).pathname.startsWith("/login")) {
      await signOutThroughNameMenu(page);
    }
    await page.getByLabel(/^(Espace de travail|Workspace)$/).fill(account.workspace);
    await page.getByLabel(/^(Nom d'utilisateur|Username)$/).fill(account.username);
    await page.getByLabel(/^(Code PIN|PIN code)$/).fill(account.pin);
    await page.getByRole("button", { name: /^(Se connecter|Sign in)$/ }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20_000 });
    await quiet();
  };

  const chooseLanguage = async (lang: "fr" | "en") => {
    await goTo("/my-settings");
    await page.getByRole("button", { name: lang === "en" ? "English" : "Français", exact: true }).click();
    await page.getByRole("heading", { name: lang === "en" ? "Language" : "Langue" }).waitFor({ timeout: 10_000 });
  };

  let measured = 0;
  for (const account of accounts) {
    await page.setViewportSize(DESKTOP_VIEWPORTS[0]);
    await signIn(account);
    for (const lang of ["fr", "en"] as const) {
      await chooseLanguage(lang);
      for (const viewport of DESKTOP_VIEWPORTS) {
        await page.setViewportSize(viewport);
        for (const route of FIT_ROUTES) {
          await goTo(route);
          const { tables, pageWide, scrolling, cutOff, sortedBy } = await measureTables(page);
          const shifted = tables > 0 ? await menuShift(page) : undefined;
          const where = `${account.username} (${account.role}) ${lang} ${viewport.width} ${route}`;
          const reasons = [
            ...(pageWide === undefined ? [] : [pageWide]),
            ...scrolling.map((item) => `scrolls sideways: ${item}`),
            ...cutOff.map((item) => `cut off: ${item}`),
            ...(shifted === undefined ? [] : [shifted]),
            ...(SORTED_ROUTES.includes(route) && tables > 0 && sortedBy === undefined
              ? ["the list is sorted by a column that is hidden"]
              : []),
          ];
          measured += tables;
          if (reasons.length > 0) {
            failures.push(`${where}: ${reasons.join("; ")}`);
            log(`OVERFLOW ${where}: ${reasons.join("; ")}`);
            await shot(`overflow-${account.username}-${lang}-${viewport.width}-${route}`, { caption: `${route} as ${account.username} (${lang}) at ${viewport.width} px: the list stays inside the screen` });
          } else {
            log(`ok ${where}: ${tables} table(s)${sortedBy === undefined ? "" : `, sorted by ${sortedBy}`}`);
            if (account === accounts[0] && route === FIT_ROUTES[0]) {
              await shot(`entries-${lang}-${viewport.width}`, {
                caption: `At ${viewport.width} px (${lang}) the entries list fits its card, row actions visible, sorted by a column on screen`,
                highlight: page.locator("main [data-slot='table-container'] thead th[aria-sort='descending']"),
              });
            }
          }
        }
      }
    }
  }
  if (measured === 0) throw new Error("no table was measured; the routes rendered no DataTable");
  if (failures.length > 0) throw new Error(`${failures.length} desktop overflows; first: ${failures[0]}`);
};

export default flow;
