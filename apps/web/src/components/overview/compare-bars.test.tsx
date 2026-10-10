// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CompareBars } from "./compare-bars.js";

afterEach(cleanup);

const props = {
  format: (value: number) => String(value),
  periodLabel: "October",
  comparisonLabel: "September",
  comparisonText: (value: string) => `vs ${value}`,
  otherLabel: (count: number) => `${count} other`,
};

function rows(): string[] {
  return screen.getAllByRole("listitem").map((row) => row.textContent ?? "");
}

describe("CompareBars", () => {
  it("ranks by this period and writes both figures on every row", () => {
    render(
      <CompareBars
        {...props}
        rows={[
          { key: "a", label: "Tolls", value: 40, comparison: 80 },
          { key: "b", label: "Fuel", value: 390, comparison: 348 },
        ]}
      />,
    );
    expect(rows()).toEqual(["Fuel390 vs 348", "Tolls40 vs 80"]);
    expect(screen.getByText("October")).toBeTruthy();
    expect(screen.getByText("September")).toBeTruthy();
  });

  it("folds the smallest groups into one row past the limit, keeping the sums", () => {
    render(
      <CompareBars
        {...props}
        maxRows={3}
        rows={[
          { key: "a", label: "A", value: 50, comparison: 10 },
          { key: "b", label: "B", value: 40, comparison: 20 },
          { key: "c", label: "C", value: 30, comparison: 30 },
          { key: "d", label: "D", value: 20, comparison: 40 },
        ]}
      />,
    );
    expect(rows()).toEqual(["A50 vs 10", "B40 vs 20", "2 other50 vs 70"]);
  });

  it("scales bars to the largest figure of either period and never below zero", () => {
    const { container } = render(
      <CompareBars
        {...props}
        rows={[
          { key: "a", label: "A", value: 50, comparison: 100 },
          { key: "b", label: "B", value: -20, comparison: 0 },
        ]}
      />,
    );
    const bars = [...container.querySelectorAll<HTMLElement>('[data-slot="compare-bars-row"] .bg-chart-2')];
    expect(bars.map((bar) => bar.style.width)).toEqual(["50%", "0%"]);
  });
});
