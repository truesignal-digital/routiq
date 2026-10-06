import type { DriveScript } from "../browser.js";

/**
 * Home dashboard: KPI cards for the role, cross-checked against GET /v1/dashboard.
 * Run: pnpm verify drive flow:home --role finance --lang en
 */
const flow: DriveScript = async ({ page, t, nav, shot, log, apiGet }) => {
  await nav("/");
  await page.getByRole("heading", { level: 1, name: t("Accueil", "Home") }).waitFor();
  await page.locator('[data-slot="kpi-card"]').first().waitFor();
  await shot("home", { caption: "Home: each card matches what the dashboard read returns" });

  const cards = await page.locator('[data-slot="kpi-card"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-kpi")));
  log(`kpi cards shown: ${cards.join(", ")}`);
  const { status, body } = await apiGet("/v1/dashboard?days=90");
  const dashboard = body as { pendingApprovals?: { count: number } | null };
  if (status !== 200) throw new Error(`GET /v1/dashboard → ${status}`);
  if (cards.includes("pendingApprovals")) {
    const shown = (await page.locator('[data-kpi="pendingApprovals"] [data-slot="kpi-value"]').innerText()).trim();
    const expected = String(dashboard.pendingApprovals?.count ?? "missing");
    if (shown !== expected) throw new Error(`pending approvals card shows ${shown}, API says ${expected}`);
    log(`api cross-check: pending approvals ${shown} = GET /v1/dashboard pendingApprovals.count`);
  } else {
    log(`api cross-check: no approvals card; GET /v1/dashboard pendingApprovals = ${JSON.stringify(dashboard.pendingApprovals ?? null)}`);
  }
};

export default flow;
