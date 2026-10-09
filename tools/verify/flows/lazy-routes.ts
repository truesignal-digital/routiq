import type { Page } from "playwright-core";
import { openSidebar, type DriveScript } from "../browser.js";

/**
 * Screens load on demand (#488). From a cold sign-in, opens every sidebar
 * place the role has, then a truck and each of its sections, and fails when a
 * screen's code request fails, when a page never shows its title, or when the
 * shell (header, sidebar, phone bottom bar) moves or shifts while a screen's
 * code arrives. Logs which code files the sign-in page loaded and how many
 * arrived after it. Best with --throttle phone, so code is still arriving
 * while the run moves around.
 * Run: pnpm verify drive flow:lazy-routes --role director --lang en --throttle phone
 */

interface ShellBox { name: string; x: number; y: number; width: number; height: number }

// tsx names inner functions with a `__name` helper the page doesn't have, so
// the browser-side code below declares no named functions.
function shellBoxes(page: Page): Promise<ShellBox[]> {
  return page.evaluate(() =>
    [
      ["header", document.querySelector("[data-slot='sidebar-inset'] > header")],
      ["sidebar", document.querySelector("[data-slot='sidebar-container']")],
      ["bottom bar", document.querySelector("[data-slot='bottom-bar']")],
    ]
      .filter((entry): entry is [string, Element] => entry[1] !== null)
      .map(([name, el]) => {
        const box = el.getBoundingClientRect();
        return { name, x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
      })
      .filter((box) => box.width > 0 && box.height > 0),
  );
}

/** Layout shifts whose moved nodes sit in the shell, since the observer started. */
function watchShellShifts(page: Page): Promise<void> {
  return page.evaluate(() => {
    const store = window as unknown as { __shellShifts?: string[] };
    store.__shellShifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as Array<{ value: number; sources?: Array<{ node?: Node | null }> }>) {
        for (const source of entry.sources ?? []) {
          const node = source.node;
          const el = node instanceof Element ? node : node?.parentElement;
          const shell = el?.closest("[data-slot='sidebar-inset'] > header, [data-slot='sidebar-container'], [data-slot='bottom-bar']");
          if (shell) store.__shellShifts?.push(`${shell.tagName.toLowerCase()} ${entry.value.toFixed(4)}`);
        }
      }
    }).observe({ type: "layout-shift" });
  });
}

const readShellShifts = (page: Page) => page.evaluate(() => (window as unknown as { __shellShifts?: string[] }).__shellShifts ?? []);

const codeFiles = (page: Page) =>
  page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((entry) => /\/static\/.+\.js$/.test(new URL(entry.name).pathname))
      .map((entry) => new URL(entry.name).pathname.replace("/static/", "")),
  );

const flow: DriveScript = async ({ page, account, shot, quiet, t, log }) => {
  const failures: string[] = [];
  const check = (ok: boolean, what: string) => {
    log(`${ok ? "PASS" : "FAIL"} ${what}`);
    if (!ok) failures.push(what);
  };
  const failedCode: string[] = [];
  page.on("requestfailed", (request) => {
    if (/\/static\/.+\.js$/.test(request.url())) failedCode.push(`${request.url()} ${request.failure()?.errorText ?? ""}`);
  });
  page.on("response", (response) => {
    if (/\/static\/.+\.js$/.test(response.url()) && response.status() >= 400) failedCode.push(`${response.url()} ${response.status()}`);
  });

  const loadedAtStart = await codeFiles(page);
  log(`code files loaded by sign-in and the first screen: ${loadedAtStart.length}`);
  await watchShellShifts(page);
  const phone = (page.viewportSize()?.width ?? 1440) < 768;

  const nav = await openSidebar(page);
  const labels = (await nav.locator("[data-sidebar='group'] a:not([data-nav-count])").evaluateAll((links) =>
    links.map((a) => {
      const row = a.cloneNode(true) as Element;
      row.querySelectorAll("[data-nav-count-dot]").forEach((dot) => dot.remove());
      return row.textContent?.trim() ?? "";
    }),
  )).filter((label) => label !== "");
  if (phone) await page.keyboard.press("Escape");
  log(`${account.role} places: ${labels.join(", ")}`);

  const reference = await shellBoxes(page);
  for (const label of labels) {
    const sidebar = await openSidebar(page);
    await sidebar.getByRole("link", { name: label, exact: true }).click();
    const titled = await page
      .getByRole("heading", { level: 1, name: label, exact: true })
      .waitFor({ timeout: 30_000 })
      .then(() => true, () => false);
    check(titled, `${label}: page opens with its title`);
    await quiet();
    if (phone) await page.keyboard.press("Escape").catch(() => undefined);
    const boxes = await shellBoxes(page);
    check(JSON.stringify(boxes) === JSON.stringify(reference), `${label}: shell in place ${JSON.stringify(boxes)}`);
    await shot(`place-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, { caption: `${label} opens on demand; the header${phone ? " and bottom bar" : " and sidebar"} stay where they were` });
  }

  // A truck and each of its sections: the vehicle routes are the deepest lazy tree.
  const sidebar = await openSidebar(page);
  await sidebar.getByRole("link", { name: t("Camions", "Trucks"), exact: true }).click();
  await page.getByRole("heading", { level: 1, name: t("Camions", "Trucks") }).waitFor();
  await quiet();
  const truck = page.getByRole("button", { name: /VH00\d/ }).first();
  if (await truck.isVisible().catch(() => false)) {
    await truck.click();
    const sections = page.getByRole("navigation", { name: t("Sections du véhicule", "Vehicle sections") });
    await sections.getByRole("tab").first().waitFor({ timeout: 30_000 });
    await quiet();
    for (const tab of await sections.getByRole("tab").all()) {
      const name = (await tab.textContent())?.trim() ?? "";
      await tab.click();
      await quiet();
      const shown = await page.locator("main [role='status'], main h2, main table, main ul, main p").first().waitFor({ timeout: 30_000 }).then(() => true, () => false);
      check(shown, `truck section ${name} shows content`);
    }
    await shot("truck-sections", { caption: "Every section of the truck opened in turn; each loads its own code" });
  } else {
    log("this role sees no truck to open");
  }

  const shellShifts = await readShellShifts(page);
  check(shellShifts.length === 0, `no layout shift inside the shell (${shellShifts.join("; ") || "none"})`);
  check(failedCode.length === 0, `every code file loaded (${failedCode.join("; ") || "no failures"})`);
  const loadedAtEnd = await codeFiles(page);
  log(`code files after the walk: ${loadedAtEnd.length} (${loadedAtEnd.length - loadedAtStart.length} arrived after the first screen)`);

  if (failures.length > 0) throw new Error(`lazy route checks failed:\n  ${failures.join("\n  ")}`);
};

export default flow;
