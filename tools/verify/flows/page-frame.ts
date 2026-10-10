import type { DriveScript } from "../browser.js";

/**
 * One page width (#658): money entry, trip, truck, Record a sheet, Register a
 * truck, Company settings and My settings all sit in the page frame, and its
 * content box is the same width on each: at most 1 200 px, centred, inside
 * 24 px gutters (16 on a phone). Measures the content width and left edge of
 * each page's frame at the run's viewport and fails when they differ.
 * Run as Direction (Company settings is theirs):
 *   pnpm verify drive flow:page-frame --role director --lang en --viewport 1920x1080
 *   ... --viewport 1440x900, ... --viewport 390x844
 */
const flow: DriveScript = async ({ page, t, shot, quiet, log, apiGet, nav }) => {
  const first = async <T,>(route: string, key: "items" | "entries"): Promise<T> => {
    const { status, body } = await apiGet(route);
    const item = (body as Record<string, T[] | undefined>)[key]?.[0];
    if (status !== 200 || item === undefined) throw new Error(`GET ${route} → ${status}, nothing to open`);
    return item;
  };
  const entry = await first<{ id: string; entryNumber: string }>("/v1/finance/entries?status=POSTED", "entries");
  const trip = await first<{ id: string }>("/v1/activities", "items");
  const truck = await first<{ id: string; assetCode: string }>("/v1/assets", "items");

  const pages = [
    { route: `/finance/entries/${entry.id}`, name: t("Écriture", "Money entry") },
    { route: `/activities/${trip.id}`, name: t("Trajet", "Trip detail") },
    { route: `/assets/${truck.id}`, name: t("Camion", "Truck page") },
    { route: "/activities/record", name: t("Saisir une feuille", "Record a sheet") },
    { route: "/assets/new", name: t("Enregistrer un camion", "Register a truck") },
    { route: "/more/company", name: t("Paramètres de l'entreprise", "Company settings") },
    { route: "/my-settings", name: t("Mes paramètres", "My settings") },
  ];

  const viewport = page.viewportSize();
  if (viewport === null) throw new Error("no viewport");
  const phone = viewport.width < 640;
  const measured: { name: string; content: number; left: number; gutter: number; overflow: number }[] = [];

  for (const { route, name } of pages) {
    await nav(route);
    await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 15_000 });
    await quiet();
    // Before #658 the container had no data-page-frame; its classes find it for a before run.
    const frame = page.locator("[data-page-frame], section.mx-auto.w-full").first();
    await frame.waitFor();
    const box = await frame.evaluate((el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const padLeft = parseFloat(style.paddingLeft);
      const padRight = parseFloat(style.paddingRight);
      return {
        content: Math.round(rect.width - padLeft - padRight),
        left: Math.round(rect.left + padLeft),
        gutter: Math.round(padLeft),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    measured.push({ name, ...box });
    log(`${name} (${route}): content ${box.content} px, left edge ${box.left} px, gutter ${box.gutter} px`);
    await shot(`frame-${measured.length}`, {
      caption: `${name} at ${viewport.width} px: page content ${box.content} px wide, starting ${box.left} px from the left`,
      highlight: frame,
    });
  }

  const widths = new Set(measured.map((m) => m.content));
  const lefts = new Set(measured.map((m) => m.left));
  const problems: string[] = [];
  if (widths.size !== 1 || lefts.size !== 1) {
    problems.push(`pages differ: ${measured.map((m) => `${m.name} ${m.content}@${m.left}`).join(", ")}`);
  }
  for (const m of measured) {
    if (m.content > 1200) problems.push(`${m.name}: content ${m.content} px is wider than 1 200`);
    if (m.gutter !== (phone ? 16 : 24)) problems.push(`${m.name}: gutter ${m.gutter} px, expected ${phone ? 16 : 24}`);
    if (m.overflow > 0) problems.push(`${m.name}: the page scrolls sideways by ${m.overflow} px`);
  }
  if (problems.length > 0) throw new Error(problems.join("; "));
  log(`all ${measured.length} pages: content ${[...widths][0]} px from ${[...lefts][0]} px at ${viewport.width} × ${viewport.height}`);
};

export default flow;
