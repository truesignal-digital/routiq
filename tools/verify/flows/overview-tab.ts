import { openSidebar, type DriveScript } from "../browser.js";

/**
 * VH003 opens on its Overview tab with To do first and open; collapsing it
 * leaves the count, and the choice survives a reload (#90).
 * Leaves `routiq-vehicle-todo` expanded again at the end.
 * Run: pnpm verify drive flow:overview-tab --role admin --lang en
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet }) => {
  await (await openSidebar(page)).getByRole("link", { name: t("Camions", "Trucks") }).click();
  await page.getByRole("button", { name: /VH003/ }).first().click();
  await page.getByRole("heading", { level: 1, name: "VH003" }).waitFor({ timeout: 90_000 });
  const assetId = /\/assets\/([0-9a-f-]{36})$/.exec(page.url())?.[1];
  if (assetId === undefined) throw new Error(`VH003 did not open on its default route: ${page.url()}`);
  await quiet();

  const sections = page.getByRole("navigation", { name: t("Sections du véhicule", "Vehicle sections") });
  const overview = sections.getByRole("tab", { name: new RegExp(`^${t("Vue d'ensemble", "Overview")}`) });
  await overview.waitFor({ timeout: 10_000 }).catch(() => {
    throw new Error(`the first tab is not called "${t("Vue d'ensemble", "Overview")}"`);
  });
  if ((await overview.getAttribute("aria-selected")) !== "true") throw new Error("Overview is not the selected tab");
  await shot("overview", { caption: "VH003 opens on the Overview tab, at the same address as before", highlight: overview });

  const title = t("À faire", "To do");
  const toggle = page.getByRole("button", { name: new RegExp(`^${title}`) });
  const firstCard = page.locator("main [data-slot=card]").first();
  if (!(await firstCard.getByRole("button", { name: new RegExp(`^${title}`) }).isVisible())) {
    throw new Error("To do is not the first block of Overview");
  }
  if ((await toggle.getAttribute("aria-expanded")) !== "true") throw new Error("To do is not open on first visit");
  await shot("todo-open", { caption: "To do is the first block and starts open", highlight: firstCard });

  await toggle.click();
  const collapsed = (await toggle.innerText()).replace(/\s+/g, " ").trim();
  if ((await toggle.getAttribute("aria-expanded")) !== "false" || !/\d+$/.test(collapsed)) {
    throw new Error(`collapse failed: "${collapsed}"`);
  }
  await shot("todo-collapsed", { caption: "Collapsed, To do keeps its count", highlight: toggle });

  await page.reload();
  await page.getByRole("heading", { level: 1, name: "VH003" }).waitFor({ timeout: 90_000 });
  await quiet();
  if ((await toggle.getAttribute("aria-expanded")) !== "false") throw new Error("the collapsed choice was not remembered");
  await shot("todo-remembered", { caption: "After a reload this browser still shows To do collapsed", highlight: toggle });

  await toggle.click();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") throw new Error("To do did not reopen");
  await shot("todo-reopened", { caption: "One tap opens it again", highlight: firstCard });

  const stored = await page.evaluate(() => localStorage.getItem("routiq-vehicle-todo"));
  const attention = await apiGet(`/v1/assets/${assetId}/attention`);
  const items = (attention.body as { items?: unknown[] }).items ?? [];
  if (attention.status !== 200) throw new Error(`GET /v1/assets/${assetId}/attention → ${attention.status}`);
  log(`stored preference: ${stored ?? "none"}; collapsed header "${collapsed}"; attention read: ${items.length} items`);
};

export default flow;
