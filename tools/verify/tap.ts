import type { Page } from "playwright-core";
import { openNameMenu, openSidebar } from "./browser.js";

/**
 * Opens `path` the way a user does: its sidebar row (opening the menu first on
 * phone widths), else a link on the current screen, else a link on Home. A
 * real tap, unlike pushState, gives the app's link handlers (hover and touch
 * preloads) their chance to run, so measurements include them (#494).
 * `landsOn` is the path a redirecting link ends on, such as the old Approvals
 * page that opens Money's waiting view (#314).
 */
export async function tapTo(page: Page, path: string, landsOn = path): Promise<void> {
  const nav = await openSidebar(page);
  const row = nav.locator(`a[href="${path}"]`);
  if ((await row.count()) > 0) {
    await row.first().click();
    await waitForPath(page, landsOn);
    return;
  }
  await closeSidebar(page);
  if (await tapLinkInMain(page, path, landsOn)) return;
  const home = (await openSidebar(page)).locator(`a[href="/"]`);
  await home.first().click();
  await waitForPath(page, "/");
  await page.getByRole("main").locator(`a[href="${path}"]`).first().waitFor({ timeout: 30_000 });
  if (!(await tapLinkInMain(page, path, landsOn))) throw new Error(`no link to ${path} in the sidebar, on ${page.url()} or on Home`);
}

/** Taps the first element in the main column whose text is exactly `text`, such as a vehicle's code in the list. */
export async function tapText(page: Page, text: string): Promise<void> {
  const before = new URL(page.url()).pathname;
  await page.getByRole("main").getByText(text, { exact: true }).first().click();
  await page.waitForURL((url) => url.pathname !== before, { timeout: 30_000 });
}

/** The sidebar's own links, in order, as the current account sees them. */
export async function sidebarPaths(page: Page): Promise<string[]> {
  const nav = await openSidebar(page);
  const hrefs = await nav.locator("a[href^='/']").evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
  await closeSidebar(page);
  // A row's waiting-count badge links to a filtered view of the same place (#322).
  return [...new Set(hrefs.filter((href) => href !== "" && !href.includes("?")))];
}

/** My settings has no link: it opens from the name menu at the sidebar's foot (#316). */
export async function tapMySettings(page: Page): Promise<void> {
  await (await openNameMenu(page)).getByRole("menuitem", { name: /^(Mes réglages|My settings)$/ }).click();
  await waitForPath(page, "/my-settings");
}

async function tapLinkInMain(page: Page, path: string, landsOn: string): Promise<boolean> {
  const link = page.getByRole("main").locator(`a[href="${path}"]`);
  if ((await link.count()) === 0) return false;
  await link.first().click();
  await waitForPath(page, landsOn);
  return true;
}

/** On phone widths the sidebar is a sheet over the page; desktop leaves it open. */
async function closeSidebar(page: Page): Promise<void> {
  const sheet = page.locator("[data-slot='sidebar'][data-mobile='true']");
  if (await sheet.isVisible().catch(() => false)) {
    await page.keyboard.press("Escape");
    await sheet.waitFor({ state: "hidden", timeout: 10_000 });
  }
}

function waitForPath(page: Page, path: string): Promise<void> {
  return page.waitForURL((url) => url.pathname === path, { timeout: 30_000 });
}
