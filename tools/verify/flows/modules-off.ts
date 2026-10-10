import { openSidebar, type DriveScript } from "../browser.js";

/**
 * Whatever modules the vendor turned off (#328): reads `GET /v1/me`, then
 * checks that no sidebar row of an off module is offered, that VH001 (while
 * Assets is on) has none of their sections, that a direct link to each of
 * their pages and vehicle sections says the module is not included, and that
 * the app asked the server for none of their reads. Ends with one read of each
 * off module refused MODULE_DISABLED.
 *
 * Precondition (vendor CLI, see features/settings.md), for example:
 *   pnpm --filter @routiq/api entitlement --workspace transports-ngwa --disable-module FINANCE
 * Turn modules back on with --enable-module, or `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:modules-off --role director --lang en
 *      pnpm verify drive flow:modules-off --role driver --lang fr --viewport 390x844
 */
type Module = "ASSETS" | "DOCUMENTS" | "FINANCE" | "ACTIVITIES" | "MAINTENANCE";

const MODULE_NAMES: Record<Module, string> = {
  ASSETS: "Trucks",
  DOCUMENTS: "Documents",
  FINANCE: "Money",
  ACTIVITIES: "Trips",
  MAINTENANCE: "Maintenance",
};

/** Each module's pages (its sidebar rows), vehicle sections and reads, as the manifests declare them. */
const OWNS: Record<Module, { pages: string[]; tabs: string[]; reads: RegExp; probe: string }> = {
  ASSETS: {
    pages: ["/assets"],
    tabs: [],
    reads: /^\/v1\/assets(\/summary|\/[^/]+(\/(attention|history|custodian-candidates))?)?$/,
    probe: "/v1/assets",
  },
  DOCUMENTS: { pages: [], tabs: ["documents"], reads: /^\/v1\/assets\/[^/]+\/documents$/, probe: "" },
  FINANCE: {
    pages: ["/finance/entries", "/finance/periods", "/more/company"],
    tabs: ["money"],
    reads: /^\/v1\/(finance\/|approval-thresholds$|assets\/[^/]+\/finance$)/,
    probe: "/v1/finance/entries",
  },
  ACTIVITIES: {
    pages: ["/activities", "/more/persons"],
    tabs: ["trips"],
    reads: /^\/v1\/(activities|persons|places)(\/|$)|^\/v1\/assets\/[^/]+\/readings$/,
    probe: "/v1/activities",
  },
  MAINTENANCE: {
    pages: ["/maintenance"],
    tabs: ["maintenance"],
    reads: /^\/v1\/(work-orders|issues|maintenance)(\/|$)/,
    probe: "/v1/work-orders",
  },
};

const flow: DriveScript = async ({ page, account, t, shot, quiet, log, apiGet }) => {
  const failures: string[] = [];
  const check = (ok: boolean, what: string) => {
    log(`${ok ? "PASS" : "FAIL"} ${what}`);
    if (!ok) failures.push(what);
  };
  const me = (await apiGet("/v1/me")).body as { enabledModules?: string[] };
  const off = (Object.keys(OWNS) as Module[]).filter((code) => !(me.enabledModules ?? []).includes(code));
  if (off.length === 0) throw new Error("precondition: turn at least one module off first (entitlement --disable-module)");
  const offNames = off.map((code) => MODULE_NAMES[code]).join(", ");
  log(`off: ${off.join(", ")}`);

  const refused: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    for (const code of off) if (OWNS[code].reads.test(path)) refused.push(`${code} ${request.method()} ${path}`);
  });
  const notIncluded = t(
    "Ce module n'est pas activé pour votre entreprise.",
    "This module is not enabled for your company.",
  );
  const phone = (page.viewportSize()?.width ?? 1440) < 768;

  await (await openSidebar(page)).getByRole("link", { name: t("Accueil", "Home"), exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
  await quiet();
  const sidebar = await openSidebar(page);
  for (const code of off) {
    for (const path of OWNS[code].pages) {
      check((await sidebar.locator(`a[href="${path}"]`).count()) === 0, `no sidebar row to ${path} (${code})`);
    }
  }
  await shot(`${account.role.toLowerCase()}-home`, {
    caption: `${offNames} off: Home and the sidebar offer nothing of ${off.length === 1 ? "it" : "them"}`,
    // The phone sheet re-renders while it opens; outline it on desktop only.
    ...(phone ? {} : { highlight: sidebar }),
  });
  if (phone) await page.keyboard.press("Escape");

  const assetsOn = !off.includes("ASSETS");
  let vehiclePath: string | undefined;
  if (assetsOn) {
    const assets = (await apiGet("/v1/assets")).body as { items?: Array<{ id: string; assetCode: string }> };
    const vh001 = assets.items?.find((asset) => asset.assetCode === "VH001");
    if (vh001 !== undefined) {
      vehiclePath = `/assets/${vh001.id}`;
      await page.goto(new URL(vehiclePath, page.url()).toString());
      await page.getByRole("heading", { level: 1, name: "VH001" }).waitFor();
      await quiet();
      const sections = page.getByRole("navigation", { name: t("Sections du véhicule", "Vehicle sections") });
      await sections.getByRole("tab").first().waitFor();
      const tabs = await sections.getByRole("tab").allTextContents();
      log(`VH001 sections: ${tabs.join(", ")}`);
      const offTabs = off.flatMap((code) => OWNS[code].tabs);
      for (const tab of offTabs) {
        check((await sections.locator(`a[href$="/${tab}"]`).count()) === 0, `VH001 has no ${tab} section`);
      }
      await shot("vh001-sections", {
        caption: `VH001 keeps ${tabs.length} sections; none of ${offNames}`,
        highlight: sections,
      });
    }
  }

  for (const code of off) {
    for (const path of OWNS[code].pages) {
      await page.goto(new URL(path, page.url()).toString());
      await page.getByText(notIncluded).waitFor();
      await quiet();
      await shot(`direct${path.replaceAll("/", "-")}`, {
        caption: `A link to ${path}: ${MODULE_NAMES[code]} is not included, and nothing of it loads`,
        highlight: page.getByText(notIncluded),
      });
    }
    if (vehiclePath !== undefined) {
      for (const tab of OWNS[code].tabs) {
        await page.goto(new URL(`${vehiclePath}/${tab}`, page.url()).toString());
        await page.getByText(notIncluded).waitFor();
        await quiet();
        await shot(`direct-vh001-${tab}`, {
          caption: `A link to VH001's ${tab} section says ${MODULE_NAMES[code]} is not included`,
          highlight: page.getByText(notIncluded),
        });
      }
    }
  }

  check(refused.length === 0, `reads of off modules the app asked for: ${refused.length === 0 ? "none" : refused.join(", ")}`);
  for (const code of off) {
    const probe = OWNS[code].probe;
    if (probe === "") continue;
    const reply = await apiGet(probe);
    check(
      reply.status === 403 && JSON.stringify(reply.body).includes("MODULE_DISABLED"),
      `GET ${probe} → ${reply.status} ${JSON.stringify(reply.body)}`,
    );
  }

  if (failures.length > 0) throw new Error(`modules-off failed:\n  ${failures.join("\n  ")}`);
};

export default flow;
