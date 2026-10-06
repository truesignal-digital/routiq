import type { Page } from "playwright-core";

/**
 * Layout shifts named by where they happened (#494). A shift is a
 * `layout-shift` entry without recent input; its region is the named part of
 * the app its moved nodes sit in. The app marks regions with
 * `data-shift-region` (header, notice, page); the sidebar keeps its own
 * `data-slot="sidebar"`, because the vendored Sidebar passes extra props to a
 * Sheet, not to a DOM node, on phone widths.
 *
 * A whole-page CLS score misses what users notice: each shift here is small, so
 * the sum stays "good" while the sidebar visibly rebuilds.
 */
export const SHIFT_REGIONS = ["sidebar", "header", "notice", "page"] as const;
export type ShiftRegion = (typeof SHIFT_REGIONS)[number];

export interface Shift {
  /** ms since the document's time origin */
  t: number;
  value: number;
  /** Named regions the moved nodes sit in; empty when none is named (or the nodes are gone). */
  regions: string[];
}

/** Collects named shifts in every document the context loads; read back with readShifts. */
export const SHIFT_PROBE = `(() => {
  const shifts = (window.__routiqShifts = []);
  const regionOf = (node) => {
    const el = node && node.nodeType === 1 ? node : node && node.parentElement;
    if (!el || !el.closest) return undefined;
    const named = el.closest("[data-shift-region]");
    if (named) return named.getAttribute("data-shift-region");
    if (el.closest("[data-slot='sidebar']")) return "sidebar";
    return undefined;
  };
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput || !(entry.value > 0)) continue;
        const regions = [];
        for (const source of entry.sources || []) {
          const region = regionOf(source.node);
          if (region && !regions.includes(region)) regions.push(region);
        }
        shifts.push({ t: entry.startTime, value: entry.value, regions });
      }
    }).observe({ type: "layout-shift", buffered: true });
  } catch {}
})();`;

/** Shifts recorded in the current document since `since` (ms on the page's clock). */
export function readShifts(page: Page, since = 0): Promise<Shift[]> {
  return page.evaluate((from) => {
    const all = (window as unknown as { __routiqShifts?: Array<{ t: number; value: number; regions: string[] }> }).__routiqShifts ?? [];
    return all.filter((shift) => shift.t >= from);
  }, since);
}

/** The page's clock, to bound a later readShifts. */
export function pageNow(page: Page): Promise<number> {
  return page.evaluate(() => performance.now());
}

/** Shifts that moved something in a named region. */
export function named(shifts: readonly Shift[]): Shift[] {
  return shifts.filter((shift) => shift.regions.some((region) => (SHIFT_REGIONS as readonly string[]).includes(region)));
}

/**
 * One line per named shift: region, phase and size. `readyAt` is when the
 * screen had rendered and its requests had settled; a shift before it happened
 * while the screen loaded, one after it moved a screen the user was reading.
 */
export function describe(shifts: readonly Shift[], start: number, readyAt: number): string[] {
  return named(shifts).map((shift) => {
    const phase = shift.t <= readyAt ? "while loading" : "after ready";
    return `${shift.regions.join("+")} ${phase} at +${Math.round(shift.t - start)} ms (${shift.value.toFixed(4)})`;
  });
}
