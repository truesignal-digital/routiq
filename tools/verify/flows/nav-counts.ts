import { openSidebar, type DriveScript } from "../browser.js";

/**
 * Navigation counts (#322): the sidebar shows only work that waits on the
 * viewer, counted by the server. Checks each count against GET /v1/nav-counts,
 * opens Maintenance's count into the Problems tab, opens Money's count into the
 * approvals waiting view, approves one entry there and watches the count drop,
 * then collapses the rail on desktop to show the dot. On phone it first checks
 * the bottom bar's places against the same counts. Mutates the slot when
 * Money has a count; reset with `pnpm verify up --reseed`.
 * Run: pnpm verify drive flow:nav-counts --role finance --lang en
 *      pnpm verify drive flow:nav-counts --role technician --lang en
 *      pnpm verify drive flow:nav-counts --viewport 390x844 --lang en
 */
type Counts = { moneyWaiting: number | null; maintenanceNew: number | null };

const flow: DriveScript = async ({ page, account, t, shot, quiet, log, apiGet }) => {
  const failures: string[] = [];
  const check = (ok: boolean, what: string) => {
    log(`${ok ? "PASS" : "FAIL"} ${what}`);
    if (!ok) failures.push(what);
  };
  const phone = (page.viewportSize()?.width ?? 1440) < 768;
  const serverCounts = async () => (await apiGet("/v1/nav-counts")).body as Counts;
  const shown = async (key: keyof Counts): Promise<number> => {
    const nav = await openSidebar(page);
    const badge = nav.locator(`[data-nav-count='${key}']`);
    if ((await badge.count()) === 0) return 0;
    return Number((await badge.textContent())?.trim() ?? "0");
  };

  await quiet();
  const counts = await serverCounts();
  log(`api: ${JSON.stringify(counts)}`);

  // The bottom bar steps aside while the sidebar sheet is open, so read it first.
  if (phone) {
    const bar = page.getByRole("navigation", { name: t("Raccourcis", "Shortcuts") });
    await bar.waitFor();
    await page.waitForTimeout(400);
    const places: Array<[keyof Counts, string]> = [
      ["moneyWaiting", t("Argent", "Money")],
      ["maintenanceNew", "Maintenance"],
    ];
    let onBar = 0;
    for (const [key, label] of places) {
      if ((await bar.getByRole("link", { name: label, exact: true }).count()) === 0) continue;
      const badge = bar.locator(`[data-bar-count='${key}']`);
      const value = (await badge.count()) === 0 ? 0 : Number((await badge.textContent())?.trim() ?? "0");
      check(value === (counts[key] ?? 0), `bottom bar ${label}: shows ${value}, server counts ${counts[key]}`);
      if (value > 0) {
        onBar += 1;
        const color = await badge.evaluate((el) => getComputedStyle(el).backgroundColor);
        log(`bottom bar ${label} badge background ${color}`);
      }
    }
    await shot(`${account.role.toLowerCase()}-bottom-bar-counts`, {
      caption: `Phone bottom bar: ${onBar} place${onBar === 1 ? "" : "s"} carry the same red count as the sidebar`,
    });
  }
  const nav = await openSidebar(page);
  await page.waitForTimeout(400);
  for (const key of ["moneyWaiting", "maintenanceNew"] as const) {
    check((await shown(key)) === (counts[key] ?? 0), `${key}: sidebar shows ${await shown(key)}, server counts ${counts[key]}`);
  }
  const badges = await nav.locator("[data-nav-count]").count();
  const nonZero = Object.values(counts).filter((value) => (value ?? 0) > 0).length;
  check(badges === nonZero, `${badges} rows carry a count; ${nonZero} counts are above zero`);
  await shot(`${account.role.toLowerCase()}-counts`, {
    caption: `${account.role}: counts only where work waits on this role (${JSON.stringify(counts)})`,
  });

  if ((counts.maintenanceNew ?? 0) > 0) {
    await (await openSidebar(page)).locator("[data-nav-count='maintenanceNew']").click();
    await page.waitForURL(/\/maintenance\?.*tab=issues/, { timeout: 10_000 });
    await quiet();
    check(page.url().includes("issueStatus=OPEN"), `Maintenance count opens ${new URL(page.url()).pathname}${new URL(page.url()).search}`);
    // The URL is this PR's half; the screen reading it is #513's. Logged, not failed, until #513 lands.
    const problemsTab = page.getByRole("tab", { name: t("Problèmes", "Problems") });
    const selected = (await problemsTab.count()) > 0 && (await problemsTab.first().getAttribute("aria-selected")) === "true";
    log(`${selected ? "PASS" : "PENDING #513"} Problems tab ${selected ? "is" : "is not"} selected after the count click`);
    await shot("maintenance-count-opens-problems", {
      caption: `The Maintenance count opens the Problems tab on the open ones: ${counts.maintenanceNew} new`,
    });
  }

  if ((counts.moneyWaiting ?? 0) > 0) {
    await (await openSidebar(page)).locator("[data-nav-count='moneyWaiting']").click();
    await page.waitForURL(/\/finance\/(approvals|entries)/, { timeout: 10_000 });
    await quiet();
    await shot("money-count-opens-waiting", {
      caption: `The Money count opens the expenses waiting for approval: ${counts.moneyWaiting}`,
    });

    const me = (await apiGet("/v1/me")).body as { principalId?: string };
    const queue = (await apiGet("/v1/finance/approvals")).body as {
      entries?: Array<{ entryNumber: string; submittedByPrincipalId: string; directionDecides: boolean }>;
    };
    const entry = (queue.entries ?? []).find(
      (item) => !item.directionDecides && item.submittedByPrincipalId !== me.principalId,
    );
    // The waiting view approves from the row's own button, one tap (#314).
    if (entry !== undefined && !phone) {
      await page
        .getByRole("button", { name: `${t("Approuver l'écriture", "Approve entry")} ${entry.entryNumber}`, exact: true })
        .click();
      await page.getByText(t("Écriture approuvée", "Entry approved")).first().waitFor();
      await quiet();
      const after = await serverCounts();
      const before = counts.moneyWaiting ?? 0;
      check(after.moneyWaiting === before - 1, `server count went ${before} → ${after.moneyWaiting} after approving ${entry.entryNumber}`);
      await page.waitForTimeout(500);
      const nowShown = await shown("moneyWaiting");
      check(nowShown === (after.moneyWaiting ?? 0), `sidebar refreshed to ${nowShown} without a reload`);
      await shot("count-drops-after-decision", {
        caption: `Approved ${entry.entryNumber}: the Money count drops to ${after.moneyWaiting} without a reload`,
      });
    } else {
      log("phone, or no entry this role may decide: skipping the decision step");
    }
  }

  if (!phone) {
    await page.getByRole("button", { name: /Afficher ou masquer le menu|Show or hide the menu/ }).first().click();
    await page.waitForTimeout(500);
    const dots = await page.locator("[data-nav-count-dot]").evaluateAll((els) =>
      els.filter((el) => getComputedStyle(el).display !== "none").length,
    );
    const live = Object.values(await serverCounts()).filter((value) => (value ?? 0) > 0).length;
    check(dots === live, `collapsed rail shows ${dots} dots for ${live} counts`);
    const dotted = page.locator("[data-nav-count-dot]").locator("visible=true").first();
    if ((await dotted.count()) > 0) {
      await dotted.locator("xpath=ancestor::a[1]").hover();
      await page.waitForTimeout(700);
    }
    await shot("collapsed-rail-dot", { caption: "Collapsed rail: each count becomes a dot; the tooltip says the number" });
    await page.getByRole("button", { name: /Afficher ou masquer le menu|Show or hide the menu/ }).first().click();
  }

  if (failures.length > 0) throw new Error(`nav counts failed:\n  ${failures.join("\n  ")}`);
};

export default flow;
