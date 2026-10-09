import { openSidebar, type DriveScript } from "../browser.js";

/**
 * Maintenance turned off by the vendor (#326): nothing of it is offered and its
 * records are kept. The sidebar has no Maintenance row; VH001 has no
 * Maintenance tab and its actions no problem or work-order step; the money
 * entry a work order paid for (DLA-2026-00007) no longer links to it, on the
 * truck's Money tab or on the entry's page; and the direct links /maintenance
 * and /assets/VH001/maintenance say the module is not included without asking
 * the server for a single maintenance read. Ends with the read refused
 * MODULE_DISABLED, and the work orders still in the books.
 *
 * Precondition (vendor CLI, see features/settings.md):
 *   pnpm --filter @routiq/api entitlement --workspace transports-ngwa --disable-module MAINTENANCE
 * Turn it back on with --enable-module MAINTENANCE, or `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:maintenance-off --role director --lang en
 *      pnpm verify drive flow:maintenance-off --role technician --lang en --viewport 390x844
 */
const MAINTENANCE_READ = /\/v1\/(work-orders|issues|maintenance)(\/|\?|$)/;

const flow: DriveScript = async ({ page, account, t, nav, shot, quiet, log, apiGet }) => {
  const failures: string[] = [];
  const check = (ok: boolean, what: string) => {
    log(`${ok ? "PASS" : "FAIL"} ${what}`);
    if (!ok) failures.push(what);
  };
  const maintenanceReads: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (MAINTENANCE_READ.test(url.pathname)) maintenanceReads.push(`${request.method()} ${url.pathname}`);
  });
  const notIncluded = t(
    "Ce module n'est pas activé pour votre espace de travail.",
    "This module is not enabled for your workspace.",
  );
  const phone = (page.viewportSize()?.width ?? 1440) < 768;
  const role = account.role;
  const readsMoney = ["DIRECTOR", "ADMIN", "FINANCE"].includes(role);

  const me = (await apiGet("/v1/me")).body as { enabledModules?: string[] };
  if (me.enabledModules?.includes("MAINTENANCE") !== false) {
    throw new Error("precondition: turn Maintenance off first (entitlement --disable-module MAINTENANCE)");
  }
  log(`modules on: ${me.enabledModules.join(", ")}`);

  await nav("/");
  await quiet();
  const sidebar = await openSidebar(page);
  check((await sidebar.getByRole("link", { name: "Maintenance", exact: true }).count()) === 0, "no Maintenance row in the sidebar");
  await shot(`${role.toLowerCase()}-sidebar`, {
    caption: "Maintenance is off: the sidebar has no Maintenance row",
    highlight: sidebar,
  });
  if (phone) await page.keyboard.press("Escape");
  if (phone) {
    const bar = page.getByRole("navigation", { name: t("Raccourcis", "Shortcuts") });
    check((await bar.getByRole("link", { name: "Maintenance", exact: true }).count()) === 0, "no Maintenance place on the bottom bar");
  }

  const assets = (await apiGet("/v1/assets")).body as { items?: Array<{ id: string; assetCode: string }> };
  const vh001 = assets.items?.find((asset) => asset.assetCode === "VH001");
  if (vh001 === undefined) throw new Error("VH001 is not in GET /v1/assets");
  const places = phone
    ? page.getByRole("navigation", { name: t("Raccourcis", "Shortcuts") })
    : await openSidebar(page);
  await places.getByRole("link", { name: t("Camions", "Trucks") }).click();
  await page.getByRole("heading", { name: t("Camions", "Trucks"), level: 1 }).waitFor();
  await page.getByRole("button", { name: /VH001/ }).first().click();
  await page.getByRole("heading", { level: 1, name: "VH001" }).waitFor();
  await quiet();
  const sections = page.getByRole("navigation", { name: t("Sections du véhicule", "Vehicle sections") });
  await sections.getByRole("tab").first().waitFor();
  const tabs = await sections.getByRole("tab").allTextContents();
  check(!tabs.some((tab) => tab.startsWith("Maintenance")), `VH001 sections: ${tabs.join(", ")}`);
  await shot("vh001-sections", { caption: `VH001: no Maintenance section (${tabs.length} sections)`, highlight: sections });

  await page.getByRole("button", { name: /^(Plus d'actions|More actions|Plus|More)$/ }).locator("visible=true").first().click();
  const sheet = page.getByRole("dialog");
  await sheet.waitFor();
  await page.waitForTimeout(300);
  for (const label of [t("Signaler un problème", "Report a problem"), t("Créer un ordre de travail", "Create work order")]) {
    check((await sheet.getByText(label, { exact: true }).count()) === 0, `no "${label}" among VH001's actions`);
  }
  await shot("vh001-actions", { caption: "All actions: no problem to report, no work order to open", highlight: sheet });
  await page.keyboard.press("Escape");
  await sheet.waitFor({ state: "hidden" });

  if (readsMoney) {
    const entries = (await apiGet("/v1/finance/entries?q=DLA-2026-00007")).body as {
      entries?: Array<{ id: string; entryNumber: string; economicDate: string }>;
    };
    const entry = entries.entries?.find((item) => item.entryNumber === "DLA-2026-00007");
    if (entry !== undefined) {
      // The Money tab reads one month: the repair's.
      await page.goto(new URL(`/assets/${vh001.id}/money?period=${entry.economicDate.slice(0, 7)}`, page.url()).toString());
      const row = page.getByText("DLA-2026-00007", { exact: true }).first();
      await row.waitFor();
      await quiet();
      await row.scrollIntoViewIfNeeded();
      const forWorkOrder = await page.getByText(new RegExp(t("pour l'ordre de travail", "for work order"), "i")).count();
      check(forWorkOrder === 0, "VH001's money rows name no work order");
      await shot("vh001-money", {
        caption:
          forWorkOrder === 0
            ? "VH001 Money: the repair entry keeps its amount, with no link into the hidden work order"
            : "VH001 Money: the repair entry still links to a work order nobody can open",
        highlight: row,
      });

      await page.goto(new URL(`/finance/entries/${entry.id}`, page.url()).toString());
      await page.getByText("DLA-2026-00007").first().waitFor();
      await quiet();
      const link = page.getByRole("link", { name: new RegExp(t("Ordre de travail", "Work order")) });
      const linked = await link.count();
      check(linked === 0, "DLA-2026-00007's page has no work-order link");
      await shot("entry-work-order-link", {
        caption:
          linked === 0
            ? "The entry a work order paid for: still there, no link into the hidden module"
            : "The entry a work order paid for still links into the hidden module",
        ...(linked === 0 ? {} : { highlight: link.first() }),
      });
    } else {
      log("DLA-2026-00007 not readable by this role");
    }
  }

  const before = maintenanceReads.length;
  await page.goto(new URL("/maintenance", page.url()).toString());
  await page.getByText(notIncluded).waitFor();
  await quiet();
  const readsHere = maintenanceReads.length - before;
  await shot("direct-maintenance-link", {
    caption:
      readsHere === 0
        ? "A bookmarked /maintenance link: the module is not included, and nothing is loaded"
        : `A bookmarked /maintenance link: the page asks for ${readsHere} maintenance reads, all refused`,
    highlight: page.getByText(notIncluded),
  });

  await page.goto(new URL(`/assets/${vh001.id}/maintenance`, page.url()).toString());
  await page.getByText(notIncluded).waitFor();
  await quiet();
  await shot("direct-vehicle-tab-link", {
    caption: "A link to VH001's Maintenance section says the module is not included",
    highlight: page.getByText(notIncluded),
  });
  check(maintenanceReads.length === 0, `maintenance reads the app asked for: ${maintenanceReads.length === 0 ? "none" : maintenanceReads.join(", ")} (${before} before the direct links)`);

  const refused = await apiGet("/v1/work-orders");
  check(
    refused.status === 403 && JSON.stringify(refused.body).includes("MODULE_DISABLED"),
    `GET /v1/work-orders → ${refused.status} ${JSON.stringify(refused.body)}`,
  );

  if (failures.length > 0) throw new Error(`maintenance-off failed:\n  ${failures.join("\n  ")}`);
};

export default flow;
