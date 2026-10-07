import { openNameMenu, signOutThroughNameMenu, type DriveScript } from "../browser.js";

/**
 * The name menu (#316): the sidebar footer names the person and their role and
 * branch; its menu holds My settings and Sign out. /more lands on Home.
 * Cross-checked against GET /v1/me. Desktop 1440, then phone 390.
 * Run: pnpm verify drive flow:name-menu --role driver --lang en --reel
 */
const flow: DriveScript = async ({ page, t, nav, shot, quiet, log, apiGet }) => {
  const { status, body } = await apiGet("/v1/me");
  const me = body as { displayName?: string; workspaceName?: string; role?: string };
  if (status !== 200 || !me.displayName || !me.workspaceName) {
    throw new Error(`GET /v1/me → ${status}, names ${JSON.stringify([me.displayName, me.workspaceName])}`);
  }
  log(`api cross-check: GET /v1/me → ${me.displayName} (${me.role}) at ${me.workspaceName}`);

  await page.setViewportSize({ width: 1440, height: 900 });
  await nav("/");
  const footer = page.locator('[data-sidebar="footer"]');
  await footer.getByText(me.displayName).waitFor();
  await shot("footer-desktop", { caption: `Desktop: the sidebar footer shows ${me.displayName}, the role and the branch` });

  let menu = await openNameMenu(page);
  await menu.getByText(me.workspaceName).waitFor();
  await shot("menu-desktop", { caption: "The name menu: My settings and Sign out" });
  // A full-page shot of a tall page resizes the viewport, which closes the popup.
  if (!(await menu.isVisible())) menu = await openNameMenu(page);

  await menu.getByRole("menuitem", { name: t("Mes réglages", "My settings") }).click();
  await page.getByRole("heading", { level: 1, name: t("Mes réglages", "My settings") }).waitFor();
  await quiet();
  await shot("my-settings-desktop", { caption: "My settings: Language and Appearance, no Sign out here" });

  await page.getByRole("button", { name: t("Sombre", "Dark"), exact: true }).click();
  await quiet();
  await shot("dark", { caption: "Appearance → Dark applies at once" });
  await page.getByRole("button", { name: t("Comme le téléphone", "Same as phone"), exact: true }).click();

  // Not ctx.nav: it waits for the URL it was given, and /more never stays.
  await page.evaluate(() => {
    window.history.pushState({}, "", "/more");
    window.dispatchEvent(new PopStateEvent("popstate", { state: window.history.state }));
  });
  await page.waitForURL((url) => url.pathname === "/");
  await page.getByRole("heading", { level: 1, name: t("Accueil", "Home") }).waitFor();
  await quiet();
  if (new URL(page.url()).pathname !== "/") throw new Error(`/more landed on ${page.url()}`);
  log("/more redirected to /");
  await shot("more-redirect", { caption: "The old More page now lands on Home; the sidebar has no More row" });

  await page.setViewportSize({ width: 390, height: 844 });
  await nav("/");
  const phoneMenu = await openNameMenu(page);
  await shot("menu-phone", { caption: "Phone: the same menu opens from the name at the bottom of the menu sheet" });
  await phoneMenu.getByRole("menuitem", { name: t("Mes réglages", "My settings") }).click();
  await page.getByRole("heading", { level: 1, name: t("Mes réglages", "My settings") }).waitFor();
  await quiet();
  await shot("my-settings-phone", { caption: "Phone: My settings fits at 390 px" });

  await signOutThroughNameMenu(page);
  await shot("signed-out", { caption: "Sign out from the name menu returns to the sign-in screen" });
};

export default flow;
