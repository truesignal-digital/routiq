import type { DriveScript } from "../browser.js";
import { describe, named, pageNow, readShifts } from "../shifts.js";
import { sidebarPaths, tapText, tapTo } from "../tap.js";

/**
 * Nothing in the sidebar, header, notices or page moves once it is drawn
 * (#494). Every API read is held for HOLD_MS, so data always arrives after the
 * first paint, as it does on a slow phone. At a phone and a desktop width the
 * flow reloads Home, taps each sidebar row and opens a vehicle from the list,
 * and fails, naming region and phase, on any shift in a named region.
 * Run: pnpm verify drive flow:no-shift
 */
export const HOLD_MS = 1_500;

/** Shifts can land after the requests settle (an image, a font, a late effect). */
const LINGER_MS = 1_000;

const VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
] as const;

const flow: DriveScript = async ({ page, shot, quiet, log, apiGet }) => {
  let holding = false;
  await page.route("**/v1/**", async (route) => {
    const request = route.request();
    if (holding && request.method() === "GET" && !request.url().includes("/v1/telemetry")) {
      await new Promise((resolve) => setTimeout(resolve, HOLD_MS));
    }
    await route.continue().catch(() => undefined);
  });

  const list = await apiGet("/v1/assets?limit=1&sort=assetCode:asc");
  const firstCode = (list.body as { items?: Array<{ assetCode: string }> }).items?.[0]?.assetCode;

  const failures: string[] = [];
  const measure = async (label: string, start: number, act: () => Promise<void>) => {
    holding = true;
    try {
      await act();
      await quiet();
    } finally {
      holding = false;
    }
    const readyAt = await pageNow(page);
    await page.waitForTimeout(LINGER_MS);
    const shifts = await readShifts(page, start);
    const lines = describe(shifts, start, readyAt);
    const unnamed = shifts.length - named(shifts).length;
    if (lines.length === 0) {
      log(`ok ${label}${unnamed > 0 ? ` (${unnamed} shift(s) outside named regions)` : ""}`);
      return;
    }
    for (const line of lines) failures.push(`${label}: ${line}`);
    log(`SHIFT ${label}: ${lines.join("; ")}`);
    await shot(`shift-${label}`, { caption: `${label}: something moved after it was drawn` });
  };

  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    const at = `${viewport.width}px`;
    await tapTo(page, "/");
    await quiet();

    await measure(`${at} reload Home`, 0, () => page.reload().then(() => undefined));

    for (const path of await sidebarPaths(page)) {
      await measure(`${at} tap ${path}`, await pageNow(page), () => tapTo(page, path));
    }

    if (firstCode === undefined) {
      log("no vehicle in the list; vehicle workspace not measured");
    } else {
      await tapTo(page, "/assets");
      await quiet();
      await measure(`${at} open vehicle ${firstCode}`, await pageNow(page), () => tapText(page, firstCode));
    }
  }

  if (failures.length > 0) throw new Error(`${failures.length} layout shift(s) in named regions; first: ${failures[0]}`);
};

export default flow;
