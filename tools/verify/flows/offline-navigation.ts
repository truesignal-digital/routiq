import type { Page } from "playwright-core";
import { openSidebar, type DriveScript } from "../browser.js";

/**
 * Once Home has settled the app fetches every other screen's code in the
 * background (#488), so losing the connection afterwards does not stop someone
 * moving between screens: each opens with its title, never a blank page or a
 * failed code request. Its data waits in the loading skeleton (TanStack Query
 * pauses while the browser is offline). The app has no service worker yet, so a
 * full reload while offline is out of scope. It starts from a cold load of
 * Users, so Home proves a signed-in deep-link start fetches Home too.
 * Run: pnpm verify drive flow:offline-navigation --role director --lang en
 */

const codeCount = (page: Page) =>
  page.evaluate(() => performance.getEntriesByType("resource").filter((entry) => /\/static\/.+\.js$/.test(new URL(entry.name).pathname)).length);

/** On a phone the sidebar is a sheet: close it and wait until it has gone, or the next open finds it mid-close. */
async function closeSheet(page: Page): Promise<void> {
  const nav = page.getByRole("navigation", { name: "Navigation" });
  if (await nav.isVisible().catch(() => false)) await page.keyboard.press("Escape");
  await nav.waitFor({ state: "hidden", timeout: 10_000 });
}

const flow: DriveScript = async ({ page, shot, quiet, log }) => {
  const failures: string[] = [];
  const check = (ok: boolean, what: string) => {
    log(`${ok ? "PASS" : "FAIL"} ${what}`);
    if (!ok) failures.push(what);
  };

  // Start signed in on a deep link, not Home: Home's code then only arrives
  // through the background fetch, which must include it.
  await page.goto(new URL("/more/users", page.url()).href);
  await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 60_000 });
  // The background fetch is done when no new code file has arrived for 3 s.
  await quiet();
  let previous = -1;
  for (let count = await codeCount(page); count !== previous; count = await codeCount(page)) {
    previous = count;
    await page.waitForTimeout(3_000);
  }
  log(`code files in memory before going offline: ${previous}`);

  const nav = await openSidebar(page);
  const labels = (await nav.locator("[data-sidebar='group'] a:not([data-nav-count])").evaluateAll((links) =>
    links.map((a) => {
      const row = a.cloneNode(true) as Element;
      row.querySelectorAll("[data-nav-count-dot]").forEach((dot) => dot.remove());
      return row.textContent?.trim() ?? "";
    }),
  )).filter((label) => label !== "");
  const phone = (page.viewportSize()?.width ?? 1440) < 768;
  if (phone) await closeSheet(page);

  const failedCode: string[] = [];
  page.on("requestfailed", (request) => {
    if (/\/static\/.+\.js$/.test(request.url())) failedCode.push(request.url());
  });
  await page.context().setOffline(true);
  log("connection dropped");
  for (const label of labels) {
    const sidebar = await openSidebar(page);
    await sidebar.getByRole("link", { name: label, exact: true }).click();
    const titled = await page
      .getByRole("heading", { level: 1, name: label, exact: true })
      .waitFor({ timeout: 15_000 })
      .then(() => true, () => false);
    check(titled, `offline: ${label} opens with its title`);
    if (phone) await closeSheet(page);
  }
  await shot("offline-last-place", { caption: "Offline after Home settled: every place still opens with its title; its data waits for the connection" });
  await page.context().setOffline(false);
  check(failedCode.length === 0, `no code request needed while offline (${failedCode.join("; ") || "none"})`);

  if (failures.length > 0) throw new Error(`offline navigation checks failed:\n  ${failures.join("\n  ")}`);
};

export default flow;
