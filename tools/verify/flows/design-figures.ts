import type { Locator, Page } from "playwright-core";
import type { DriveScript } from "../browser.js";

/**
 * Figures and labels on Home, the Money list, an entry's detail and the Trucks
 * list (#310): amounts, record numbers, codes and plates in the sans face with
 * tabular figures (DS-1), labels in sentence case (DS-4). Each page counts the
 * visible text elements that still render in a monospace face or with
 * text-transform: uppercase, and the flow fails if any page has one.
 * Run: pnpm verify drive flow:design-figures --role finance --lang en
 */

type Offender = { tag: string; text: string };

/** Leaf text elements drawn in a monospace face, and ones the CSS shouts in capitals. */
async function typeOffenders(page: Page): Promise<{ mono: Offender[]; uppercase: Offender[] }> {
  // A string, so the bundler's name helpers never reach the page.
  return page.evaluate(`(() => {
    const leaves = [...document.querySelectorAll("body *")].filter(
      (el) => el.childElementCount === 0 && (el.textContent ?? "").trim() !== "" && el.getClientRects().length > 0,
    );
    const describe = (el) => ({ tag: el.tagName.toLowerCase(), text: (el.textContent ?? "").trim().slice(0, 40) });
    return {
      mono: leaves.filter((el) => /mono|courier|consolas|menlo/i.test(getComputedStyle(el).fontFamily)).map(describe),
      // The wordmark sets the product name in wide caps; it is the logo, not a label (DS-4 exempts components/brand/).
      uppercase: leaves
        .filter((el) => getComputedStyle(el).textTransform === "uppercase" && !el.closest('[data-slot="routiq-wordmark"]'))
        .map(describe),
    };
  })()`);
}

async function visible(locator: Locator): Promise<{ highlight: Locator } | Record<string, never>> {
  return (await locator.isVisible().catch(() => false)) ? { highlight: locator } : {};
}

const flow: DriveScript = async ({ page, nav, t, shot, quiet, log, apiGet }) => {
  const list = await apiGet("/v1/finance/entries?status=POSTED");
  const entries = (list.body as { entries?: Array<{ id: string; entryNumber: string }> }).entries ?? [];
  const entry = entries[0];
  if (list.status !== 200 || entry === undefined) {
    throw new Error(`GET /v1/finance/entries?status=POSTED → ${list.status}, ${entries.length} entries`);
  }

  const failures: string[] = [];
  const check = async (label: string) => {
    const found = await typeOffenders(page);
    log(`${label}: ${found.mono.length} monospace, ${found.uppercase.length} uppercase text elements`);
    for (const o of found.mono) failures.push(`${label}: monospace <${o.tag}> "${o.text}"`);
    for (const o of found.uppercase) failures.push(`${label}: uppercase <${o.tag}> "${o.text}"`);
    return found;
  };

  await nav("/");
  await quiet();
  const home = await check("home");
  await shot("home-figures", {
    caption: `Home: tile labels in sentence case, figures in the sans face (${home.mono.length} monospace, ${home.uppercase.length} uppercase)`,
    ...(await visible(page.locator('[data-slot="metric-value"], [data-slot="kpi-value"]').first())),
  });

  await nav("/finance/entries");
  await page.getByRole("button", { name: entry.entryNumber, exact: true }).first().waitFor();
  await quiet();
  const money = await check("money");
  await shot("money-amounts", {
    caption: `Money: entry numbers and amounts in the sans face, digits aligned (${money.mono.length} monospace, ${money.uppercase.length} uppercase)`,
    ...(await visible(page.getByRole("button", { name: entry.entryNumber, exact: true }).first())),
  });

  await nav(`/finance/entries/${entry.id}`);
  await page.getByText(entry.entryNumber, { exact: true }).first().waitFor();
  await quiet();
  const detail = await check("entry detail");
  await shot("entry-detail-labels", {
    caption: `Entry detail: labels in sentence case, amount and number in the sans face (${detail.mono.length} monospace, ${detail.uppercase.length} uppercase)`,
    ...(await visible(page.locator("dl").first())),
  });

  await nav("/assets");
  await page.getByRole("button", { name: /VH003/ }).first().waitFor();
  await quiet();
  const trucks = await check("trucks");
  await shot("trucks-codes", {
    caption: `Trucks: codes and plates in the sans face, as typed (${trucks.mono.length} monospace, ${trucks.uppercase.length} uppercase)`,
    ...(await visible(page.getByRole("button", { name: /VH003/ }).first())),
  });

  const read = await apiGet(`/v1/finance/entries/${entry.id}`);
  const body = read.body as { entryNumber?: string; amountMinor?: number | string; currency?: string };
  if (read.status !== 200 || body.entryNumber !== entry.entryNumber) {
    throw new Error(`GET /v1/finance/entries/${entry.id} → ${read.status}`);
  }
  log(`api cross-check: ${body.entryNumber} ${body.amountMinor ?? "?"} ${body.currency ?? ""}`);

  if (failures.length > 0) throw new Error(`DS-1/DS-4 in the running app:\n${failures.join("\n")}`);
};

export default flow;
