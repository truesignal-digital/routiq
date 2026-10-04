import type { DriveScript } from "../browser.js";
import { DEMO_WORKSPACE, resolveAccount } from "../accounts.js";

/**
 * Role switching: sign out of the current account and sign in as the executive
 * viewer, whose home has no approvals card and whose truck page is view-only.
 * Run: pnpm verify drive flow:switch-user --role admin --lang en
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  const viewer = resolveAccount("viewer");
  await page.getByRole("navigation", { name: "Navigation" }).waitFor();
  await page.getByRole("button", { name: t("Se déconnecter", "Sign out") }).first().click();
  await page.waitForURL((url) => url.pathname === "/login");
  await shot("signed-out");

  await page.getByLabel(/^(Espace de travail|Workspace)$/).fill(DEMO_WORKSPACE);
  await page.getByLabel(/^(Nom d'utilisateur|Username)$/).fill(viewer.username);
  await page.getByLabel(/^(Code PIN|PIN code)$/).fill(viewer.pin);
  await page.getByRole("button", { name: /^(Se connecter|Sign in)$/ }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await page.locator('[data-slot="kpi-card"]').first().waitFor();
  await quiet();
  await shot(`home-as-${viewer.username}`);
  if ((await page.locator('[data-kpi="pendingApprovals"]').count()) !== 0) throw new Error("the viewer sees the approvals card");

  const me = await apiGet("/v1/me");
  const role = (me.body as { role?: string }).role;
  if (me.status !== 200 || role !== viewer.role) throw new Error(`GET /v1/me → ${me.status} ${role ?? ""}`);
  log(`api cross-check: GET /v1/me as the new session → role ${role}`);
};

export default flow;
