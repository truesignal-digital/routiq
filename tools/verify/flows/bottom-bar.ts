import type { Locator } from "playwright-core";
import type { DriveScript } from "../browser.js";

/**
 * The phone bottom bar (#318): the role's three places and Menu below 768 px,
 * nothing on desktop. On phone it checks that the truck's quick action bar and
 * the Trucks floating button sit above the bar, that both bars step aside
 * while a panel is open, and that Menu opens the sidebar sheet.
 * Run: pnpm verify drive flow:bottom-bar --viewport 390x844 --lang en
 *      pnpm verify drive flow:bottom-bar --lang en   (desktop: no bar)
 */
const flow: DriveScript = async ({ page, nav, shot, quiet, t, log }) => {
  const failures: string[] = [];
  const check = (ok: boolean, what: string) => {
    log(`${ok ? "PASS" : "FAIL"} ${what}`);
    if (!ok) failures.push(what);
  };
  const phone = (page.viewportSize()?.width ?? 1440) < 768;
  const bar = page.getByRole("navigation", { name: t("Raccourcis", "Shortcuts") });
  const above = async (element: Locator, what: string) => {
    const [box, barBox] = [await element.boundingBox(), await bar.boundingBox()];
    check(box !== null && barBox !== null && box.y + box.height <= barBox.y + 0.5, `${what} sits above the bottom bar`);
  };

  await nav("/");
  await quiet();
  if (!phone) {
    check(!(await bar.isVisible()), "no bottom bar on desktop");
    await shot("desktop-home", { caption: "Desktop keeps the sidebar; no bottom bar" });
    if (failures.length > 0) throw new Error(failures.join("\n"));
    return;
  }

  const places = (await bar.getByRole("link").allTextContents()).map((text) => text.trim());
  log(`places: ${places.join(", ")}`);
  check(places.length === 3, "three places");
  check(await bar.getByRole("button", { name: "Menu" }).isVisible(), "then Menu");
  const target = await bar.getByRole("link").first().boundingBox();
  check(target !== null && target.height >= 44, `targets are at least 44 px (${target?.height ?? 0})`);
  await shot("home", { caption: `Phone Home: ${places.join(", ")} and Menu in thumb reach` });

  await bar.getByRole("link", { name: t("Camions", "Trucks"), exact: true }).click();
  await page.getByRole("heading", { level: 1, name: t("Camions", "Trucks") }).waitFor();
  await quiet();
  const fab = page.getByRole("link", { name: t("Enregistrer un camion", "Register a truck") });
  if (await fab.isVisible()) await above(fab, "the Trucks floating button");
  await shot("trucks", { caption: "Trucks is lit; the add button sits above the bar" });

  await page.getByRole("button", { name: /VH003/ }).first().click();
  await page.getByRole("heading", { level: 1, name: "VH003" }).waitFor();
  await quiet();
  const quick = page.getByRole("toolbar", { name: t("Actions rapides", "Quick actions") });
  await above(quick, "the truck's quick action bar");
  await shot("truck", { caption: "On a truck, the quick action bar sits above the bottom bar" });

  await quick.getByRole("button").first().click();
  await page.locator("[data-slot='sheet-content'], [data-slot='dialog-content']").first().waitFor();
  await page.waitForTimeout(400);
  check(!(await bar.isVisible()), "bottom bar hides while a panel is open");
  check(!(await quick.isVisible()), "quick action bar hides while a panel is open");
  await shot("panel-open", { caption: "With a form panel open, both bars step aside" });
  await page.keyboard.press("Escape");
  const discard = page.getByRole("button", { name: t("Abandonner", "Discard") });
  if (await discard.isVisible().catch(() => false)) await discard.click();
  await bar.waitFor();

  if (places.includes(t("Argent", "Money"))) {
    await bar.getByRole("link", { name: t("Argent", "Money"), exact: true }).click();
    await page.getByRole("heading", { level: 1, name: t("Argent", "Money") }).waitFor();
    await quiet();
    await shot("money", { caption: "Money from the bar; the list keeps its last row reachable" });
  }

  await bar.getByRole("button", { name: "Menu" }).click();
  await page.getByRole("dialog", { name: t("Menu de navigation", "Navigation menu") }).waitFor();
  await page.waitForTimeout(500);
  await shot("menu", { caption: "Menu opens the full sidebar as a sheet" });

  if (failures.length > 0) throw new Error(`bottom bar checks failed:\n  ${failures.join("\n  ")}`);
};

export default flow;
