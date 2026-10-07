// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardSeriesPoint } from "@routiq/contracts";
import { i18n } from "../i18n/index.js";
import { ChartAreaInteractive } from "./ChartAreaInteractive.js";

beforeEach(async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        const contentRect = { width: 800, height: 250 } as DOMRectReadOnly;
        this.callback([{ target, contentRect } as ResizeObserverEntry], this as unknown as ResizeObserver);
      }
      unobserve() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: 800,
    height: 250,
    top: 0,
    left: 0,
    right: 800,
    bottom: 250,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await i18n.changeLanguage("fr-CM");
});

/** Sparse daily money the way the demo has it: zero days around one spike (#56). */
function sparseSeries(): DashboardSeriesPoint[] {
  return Array.from({ length: 30 }, (_, index) => {
    const day = String(index + 1).padStart(2, "0");
    const spike = index === 14;
    return {
      date: `2026-07-${day}`,
      expenseMinor: spike ? 1_850_000 : index === 15 ? 120_000 : 0,
      revenueMinor: spike ? 2_400_000 : 0,
    };
  });
}

/** Every y in a path's commands, control points included: the curve stays inside their hull. */
function pathYs(d: string): number[] {
  const numbers = (d.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi) ?? []).map(Number);
  return numbers.filter((_, index) => index % 2 === 1);
}

/** The zero line: a filled area closes along it, so the area path ends on it. */
function axisOf(area: SVGPathElement): number {
  const ys = pathYs(area.getAttribute("d") ?? "");
  const last = ys[ys.length - 1];
  if (last === undefined) throw new Error("empty area path");
  return last;
}

function drawChart() {
  const { container } = render(
    <ChartAreaInteractive
      series={sparseSeries()}
      currency="XAF"
      days={30}
      onDaysChange={() => {}}
      isPending={false}
    />,
  );
  const curves = [...container.querySelectorAll<SVGPathElement>("path.recharts-area-curve")];
  const areas = [...container.querySelectorAll<SVGPathElement>("path.recharts-area-area")];
  return { curves, areas };
}

describe("the expense and revenue chart on Home (#56)", () => {
  it("draws both series and keeps every point of each curve at or above zero", () => {
    const { curves, areas } = drawChart();
    expect(curves).toHaveLength(2);
    expect(areas).toHaveLength(2);

    for (const [index, curve] of curves.entries()) {
      const area = areas[index];
      if (area === undefined) throw new Error("area missing");
      const axis = axisOf(area);
      const ys = pathYs(curve.getAttribute("d") ?? "");
      expect(ys.length).toBeGreaterThan(0);
      // SVG y grows downwards: below zero would be a y past the axis.
      expect(Math.max(...ys)).toBeLessThanOrEqual(axis + 1e-6);
    }
  });

  it("draws a zero day exactly on the axis", () => {
    const { curves, areas } = drawChart();
    const curve = curves[0];
    const area = areas[0];
    if (curve === undefined || area === undefined) throw new Error("chart missing");
    const axis = axisOf(area);
    // The path starts at day 1, a zero day.
    const start = /^M\s*(-?[\d.]+)[ ,](-?[\d.]+)/.exec(curve.getAttribute("d") ?? "");
    expect(Number(start?.[2])).toBeCloseTo(axis, 6);
  });
});
