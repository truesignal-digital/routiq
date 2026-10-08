import { openSidebar, signOutThroughNameMenu, type DriveScript } from "../browser.js";

/**
 * The ROUTIQ logo in the neutral theme (#320): the sidebar header shows the
 * logo, the collapsed rail the mark alone, the sign-in page the logo above the
 * form; light and dark. "powered by ROUTIQ" stays hidden until a company logo
 * fills the header (#350).
 * Run: pnpm verify drive flow:brand --lang en  (and --viewport 390x844)
 */
const flow: DriveScript = async ({ page, shot, quiet, t, log }) => {
  const phone = (page.viewportSize()?.width ?? 1440) < 768;
  const failures: string[] = [];
  const expect = (ok: boolean, what: string) => {
    log(`${ok ? "PASS" : "FAIL"} ${what}`);
    if (!ok) failures.push(what);
  };

  const showSidebar = async () => {
    await quiet();
    await openSidebar(page);
    // The phone sheet slides in; a frame taken mid-animation is half transparent.
    await page.waitForTimeout(500);
  };

  await showSidebar();
  const header = page.locator("[data-sidebar=header]").filter({ visible: true }).first();
  expect(await header.locator("[data-slot=routiq-logo]").isVisible(), "sidebar header shows the ROUTIQ logo");
  expect(await page.locator("[data-slot=powered-by-routiq]").count() === 0, "no powered-by while ROUTIQ fills the header");
  await shot("sidebar-logo", {
    caption: "The sidebar header now shows the ROUTIQ logo instead of a truck icon",
  });

  if (!phone) {
    await page.getByRole("button", { name: t("Afficher ou masquer le menu", "Show or hide the menu") }).first().click();
    await page.locator("[data-collapsible=icon]").waitFor();
    const mark = header.getByRole("img", { name: t("Logo ROUTIQ", "ROUTIQ logo") });
    expect(await mark.isVisible(), "collapsed rail shows the named mark");
    expect(!(await header.locator("[data-slot=routiq-wordmark]").isVisible()), "collapsed rail hides the wordmark");
    await shot("rail-mark", { caption: "Collapsed, the rail keeps only the mark" });
    await page.getByRole("button", { name: t("Afficher ou masquer le menu", "Show or hide the menu") }).first().click();
    await page.locator("[data-state=expanded]").first().waitFor();
  }

  await page.evaluate(() => localStorage.setItem("routiq-theme", "dark"));
  await page.reload();
  await page.getByRole("heading", { level: 1 }).first().waitFor();
  await showSidebar();
  await shot("sidebar-dark", { caption: "Dark theme: the letter follows the text colour, the pin stays blue" });

  await signOutThroughNameMenu(page);
  await page.waitForURL(/\/login/);
  const login = page.locator("main [data-slot=routiq-logo]");
  await login.waitFor();
  expect(await page.getByRole("heading", { level: 1, name: /routiq/i }).isVisible(), "sign-in heading is the logo");
  await shot("sign-in-dark", { caption: "The sign-in page shows the logo above the form, dark theme" });

  await page.evaluate(() => localStorage.setItem("routiq-theme", "light"));
  await page.reload();
  await login.waitFor();
  expect(await page.locator("[data-slot=powered-by-routiq]").count() === 0, "sign-in footer shows no powered-by yet");
  await shot("sign-in-light", { caption: "The sign-in page in the light theme" });

  if (failures.length > 0) throw new Error(`brand checks failed:\n  ${failures.join("\n  ")}`);
};

export default flow;
