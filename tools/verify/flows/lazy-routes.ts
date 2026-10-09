import type { Page } from "playwright-core";
import { openSidebar, type DriveScript } from "../browser.js";

/**
 * Screens load on demand (#488). From a cold sign-in, opens every sidebar
 * place the role has, then a truck and each of its sections, and fails when a
 * screen's code request fails, when a page never shows its title, or when the
 * shell (header, sidebar, phone bottom bar) moves or shifts while a screen's
 * code arrives. It starts with a cold load of Home and moves on at once, so it
 * walks ahead of the background fetch; it logs how many code files that load
 * brought and how many arrived during the walk. Best with --throttle phone.
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

interface ShellShift { frame: boolean; text: string }

/**
 * Layout shifts whose moved nodes sit in the shell, since the observer started.
 * `frame` is the header, sidebar or bottom bar itself moving; anything else is
 * content inside it changing, such as a record's crumb filling in.
 */
function watchShellShifts(page: Page): Promise<void> {
  return page.evaluate(() => {
    const store = window as unknown as { __shellShifts?: Array<{ frame: boolean; text: string }> };
    store.__shellShifts = [];
    new PerformanceObserver((list) => {
      type Rect = { x: number; y: number; width: number; height: number };
      type Source = { node?: Node | null; previousRect: Rect; currentRect: Rect };
      for (const entry of list.getEntries() as unknown as Array<{ value: number; sources?: Source[] }>) {
        for (const source of entry.sources ?? []) {
          const node = source.node;
          const el = node instanceof Element ? node : node?.parentElement;
          const shell = el?.closest("[data-slot='sidebar-inset'] > header, [data-slot='sidebar-container'], [data-slot='bottom-bar']");
          if (!shell || !el) continue;
          const what = `${el.tagName.toLowerCase()}${el.getAttribute("data-slot") ? `[${el.getAttribute("data-slot")}]` : ""} "${(el.textContent ?? "").trim().slice(0, 30)}"`;
          const from = source.previousRect;
          const to = source.currentRect;
          const text = `${what} ${entry.value.toFixed(4)} at ${location.pathname}: ${Math.round(from.x)},${Math.round(from.y)} ${Math.round(from.width)}x${Math.round(from.height)} → ${Math.round(to.x)},${Math.round(to.y)} ${Math.round(to.width)}x${Math.round(to.height)}`;
          store.__shellShifts?.push({ frame: el === shell, text });
        }
      }
    }).observe({ type: "layout-shift" });
  });
}

const readShellShifts = (page: Page): Promise<ShellShift[]> =>
  page.evaluate(() => (window as unknown as { __shellShifts?: Array<{ frame: boolean; text: string }> }).__shellShifts ?? []);

const codeFiles = (page: Page) =>
  page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((entry) => /\/static\/.+\.js$/.test(new URL(entry.name).pathname))
      .map((entry) => new URL(entry.name).pathname.replace("/static/", "")),
  );

/** On a phone the sidebar is a sheet: close it and wait until it has gone, or the next open finds it mid-close. */
async function closeSheet(page: Page): Promise<void> {
  const nav = page.getByRole("navigation", { name: "Navigation" });
  if (await nav.isVisible().catch(() => false)) await page.keyboard.press("Escape");
  await nav.waitFor({ state: "hidden", timeout: 10_000 });
}

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

  // Sign-in and the language switch leave time for the background fetch to
  // finish; a cold load of Home, then moving on at once, walks ahead of it.
  await page.goto(new URL("/", page.url()).href);
  await page.getByRole("heading", { level: 1, name: t("Accueil", "Home"), exact: true }).waitFor({ timeout: 60_000 });
  const loadedAtStart = await codeFiles(page);
  log(`code files loaded by a cold load of Home: ${loadedAtStart.length}`);
  await watchShellShifts(page);
  const phone = (page.viewportSize()?.width ?? 1440) < 768;

  // The role's places appear once /v1/me has answered.
  await quiet();
  const nav = await openSidebar(page);
  const labels = (await nav.locator("[data-sidebar='group'] a:not([data-nav-count])").evaluateAll((links) =>
    links.map((a) => {
      const row = a.cloneNode(true) as Element;
      row.querySelectorAll("[data-nav-count-dot]").forEach((dot) => dot.remove());
      return row.textContent?.trim() ?? "";
    }),
  )).filter((label) => label !== "");
  if (phone) await closeSheet(page);
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
    if (phone) await closeSheet(page);
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
  const frameShifts = shellShifts.filter((shift) => shift.frame).map((shift) => shift.text);
  check(frameShifts.length === 0, `the header, sidebar and bottom bar never shifted (${frameShifts.join("; ") || "none"})`);
  for (const shift of shellShifts.filter((each) => !each.frame)) log(`content inside the shell changed: ${shift.text}`);
  check(failedCode.length === 0, `every code file loaded (${failedCode.join("; ") || "no failures"})`);
  const loadedAtEnd = await codeFiles(page);
  log(`code files after the walk: ${loadedAtEnd.length} (${loadedAtEnd.length - loadedAtStart.length} arrived after the first screen)`);

  if (failures.length > 0) throw new Error(`lazy route checks failed:\n  ${failures.join("\n  ")}`);
};

export default flow;
