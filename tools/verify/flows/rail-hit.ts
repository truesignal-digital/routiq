import type { DriveScript } from "../browser.js";

/**
 * The collapsed desktop rail: every row's icon takes the pointer, including
 * the last row of a group, which the next group's faded label slides over.
 * Run: pnpm verify drive flow:rail-hit --role director --lang en
 */
const flow: DriveScript = async ({ page, nav, shot, quiet, t, log }) => {
  await nav("/");
  await quiet();
  await page.getByRole("button", { name: t("Afficher ou masquer le menu", "Show or hide the menu") }).first().click();
  await page.locator('[data-collapsible="icon"]').first().waitFor();
  await page.waitForTimeout(400);

  const misses = await page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLElement>('nav a[data-slot="sidebar-menu-button"]')];
    return rows.flatMap((row) => {
      const box = row.getBoundingClientRect();
      const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return hit?.closest('a[data-slot="sidebar-menu-button"]') === row
        ? []
        : [`${row.getAttribute("href") ?? "?"} → ${hit?.getAttribute("data-slot") ?? hit?.tagName ?? "nothing"}`];
    });
  });
  const total = await page.locator('nav a[data-slot="sidebar-menu-button"]').count();
  log(`rail rows hit-tested: ${total}, missed: ${misses.length}`);
  await shot("rail", { caption: "Collapsed rail: every icon takes the pointer" });
  if (total === 0) throw new Error("no rail rows found");
  if (misses.length > 0) throw new Error(`rows covered on the rail:\n${misses.join("\n")}`);
};

export default flow;
