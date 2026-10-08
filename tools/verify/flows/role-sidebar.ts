import { openSidebar, type DriveScript } from "../browser.js";

/**
 * Each role sees only the sidebar places it can use, grouped by the work
 * (#312). Checks the rows against the role table in the issue, then opens
 * every row and checks that the page title and the first crumb after Home
 * repeat the row's label. Run once per role:
 *   pnpm verify drive flow:role-sidebar --role director --lang en
 */
const EXPECTED: Record<string, { daily: readonly [string, string][]; company: readonly [string, string][] }> = {
  DIRECTOR: {
    daily: [["Accueil", "Home"], ["Camions", "Trucks"], ["Trajets", "Trips"], ["Maintenance", "Maintenance"], ["Argent", "Money"]],
    company: [
      ["Personnel", "People"],
      ["Utilisateurs", "Users"],
      ["Agences", "Branches"],
      ["Paramètres de l'entreprise", "Company settings"],
    ],
  },
  ADMIN: {
    daily: [["Accueil", "Home"], ["Camions", "Trucks"], ["Trajets", "Trips"], ["Maintenance", "Maintenance"], ["Argent", "Money"]],
    company: [["Personnel", "People"], ["Utilisateurs", "Users"]],
  },
  FINANCE: {
    daily: [["Accueil", "Home"], ["Camions", "Trucks"], ["Trajets", "Trips"], ["Argent", "Money"]],
    company: [["Personnel", "People"]],
  },
  CASHIER: { daily: [["Accueil", "Home"], ["Camions", "Trucks"], ["Argent", "Money"]], company: [] },
  TECHNICIAN: { daily: [["Accueil", "Home"], ["Camions", "Trucks"], ["Maintenance", "Maintenance"]], company: [] },
  DRIVER: { daily: [["Accueil", "Home"], ["Camions", "Trucks"], ["Trajets", "Trips"]], company: [] },
};

const flow: DriveScript = async ({ page, account, shot, quiet, t, log }) => {
  const expected = EXPECTED[account.role];
  if (expected === undefined) throw new Error(`no expected sidebar for ${account.role}`);
  const failures: string[] = [];
  const check = (ok: boolean, what: string) => {
    log(`${ok ? "PASS" : "FAIL"} ${what}`);
    if (!ok) failures.push(what);
  };
  const phone = (page.viewportSize()?.width ?? 1440) < 768;

  const readSidebar = async () => {
    const nav = await openSidebar(page);
    await page.waitForTimeout(400);
    return nav.evaluate((root) =>
      [...root.querySelectorAll("[data-sidebar='group']")].map((group) => ({
        heading: group.querySelector("[data-sidebar='group-label']")?.textContent?.trim() ?? "",
        // A row's own words: not its count link (#322), not the rail's dot.
        rows: [...group.querySelectorAll("a:not([data-nav-count])")].map((a) => {
          const row = a.cloneNode(true) as Element;
          row.querySelectorAll("[data-nav-count-dot]").forEach((dot) => dot.remove());
          return row.textContent?.trim() ?? "";
        }),
      })),
    );
  };

  await quiet();
  const groups = await readSidebar();
  const daily = expected.daily.map(([fr, en]) => t(fr, en));
  const company = expected.company.map(([fr, en]) => t(fr, en));
  const want = [
    { heading: t("Au quotidien", "Daily work"), rows: daily },
    ...(company.length > 0 ? [{ heading: t("Entreprise", "Company"), rows: company }] : []),
  ];
  const got = groups;
  check(JSON.stringify(got) === JSON.stringify(want), `${account.role} sidebar ${JSON.stringify(got)} matches the role table`);
  await shot(`${account.role.toLowerCase()}-sidebar`, {
    caption: `${account.role}: ${daily.join(", ")}${company.length > 0 ? ` | Company: ${company.join(", ")}` : ""}`,
  });

  for (const label of [...daily, ...company]) {
    const nav = await openSidebar(page);
    await nav.getByRole("link", { name: label, exact: true }).click();
    await quiet();
    const title = page.getByRole("heading", { level: 1, name: label, exact: true });
    const titled = await title.waitFor({ timeout: 10_000 }).then(() => true, () => false);
    check(titled, `${label}: page title repeats the row label`);
    if (label !== t("Accueil", "Home") && !phone) {
      const crumbs = await page.locator("[data-slot='breadcrumb-list'] li").allTextContents();
      const named = crumbs.map((crumb) => crumb.trim()).filter((crumb) => crumb !== "");
      check(named[1] === label, `${label}: first crumb after Home is "${named[1] ?? ""}"`);
    }
  }
  if (company.length > 0) {
    await shot(`${account.role.toLowerCase()}-company-page`, { caption: `${company.at(-1)} opens from the Company group; the title and the crumb repeat the row label` });
  }

  if (failures.length > 0) throw new Error(`sidebar checks failed:\n  ${failures.join("\n  ")}`);
};

export default flow;
