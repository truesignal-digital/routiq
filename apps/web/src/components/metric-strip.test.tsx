import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MetricStrip, type MetricTiles } from "./metric-strip.js";

const tiles: MetricTiles = [
  { label: "Fleet", value: "6" },
  { label: "In service", value: "2" },
  { label: "Attention", value: "3", tone: "warning" },
];

function values(container: HTMLElement): string[] {
  return [...container.querySelectorAll("[data-slot=metric-value]")].map(
    (node) => node.textContent ?? "",
  );
}

describe("MetricStrip", () => {
  it("renders one labelled tile per metric", () => {
    const { container } = render(<MetricStrip tiles={tiles} />);

    expect(container.querySelectorAll("[data-slot=metric-tile]")).toHaveLength(3);
    expect(screen.getByText("Fleet")).toBeTruthy();
    expect(values(container)).toEqual(["6", "2", "3"]);
  });

  it("pairs each label with its value as a description list", () => {
    const { container } = render(<MetricStrip tiles={tiles} />);

    const list = container.querySelector("dl");
    expect(list).toBeTruthy();
    expect(list?.querySelectorAll("dt")).toHaveLength(3);
    expect(list?.querySelectorAll("dd")).toHaveLength(3);
    expect(list?.querySelector("dt")?.textContent).toBe("Fleet");
  });

  it("keeps figures on a tabular grid so tiles do not jitter between reads", () => {
    const { container } = render(<MetricStrip tiles={tiles} />);

    for (const node of container.querySelectorAll("[data-slot=metric-value]")) {
      expect(node.className).toContain("tabular-nums");
    }
  });

  it("marks the warning tile and leaves the others neutral", () => {
    const { container } = render(<MetricStrip tiles={tiles} />);
    const rendered = [...container.querySelectorAll("[data-slot=metric-tile]")];

    expect(rendered.map((tile) => tile.getAttribute("data-tone"))).toEqual([
      "neutral",
      "neutral",
      "warning",
    ]);
    expect(values(container)[2]).toBe("3");
    expect(
      container.querySelectorAll("[data-slot=metric-value]")[2]?.className,
    ).toContain("text-warning-foreground");
  });

  it("swaps values for skeletons while the read is in flight, keeping labels", () => {
    const { container } = render(<MetricStrip tiles={tiles} isPending />);

    expect(container.querySelectorAll("[data-slot=skeleton]")).toHaveLength(3);
    // Nothing that reads as a value: a placeholder is not a number.
    expect(values(container)).toEqual([]);
    expect(screen.getByText("Attention")).toBeTruthy();
    expect(container.querySelector("dl")?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector("dl")?.getAttribute("data-state")).toBe(
      "pending",
    );
  });

  /** A tile that kept its last number would report a count nobody vouched for. */
  it("shows dashes instead of the numbers it was handed when the read failed", () => {
    const { container } = render(<MetricStrip tiles={tiles} isError />);

    expect(values(container)).toEqual(["—", "—", "—"]);
    expect(container.querySelector("dl")?.getAttribute("data-state")).toBe("error");
    expect(container.querySelectorAll("[data-slot=skeleton]")).toHaveLength(0);
  });

  it("dashes a single unknown value without dimming the tiles that do have one", () => {
    const { container } = render(
      <MetricStrip
        tiles={[
          { label: "Fleet", value: "6" },
          { label: "In service", value: null },
        ]}
      />,
    );

    expect(values(container)).toEqual(["6", "—"]);
  });

  it("drops the hint whenever the value it qualifies is missing", () => {
    const ready = render(
      <MetricStrip
        tiles={[
          { label: "Fleet", value: "6", hint: "all branches" },
          { label: "In service", value: "2" },
        ]}
      />,
    );
    expect(screen.getByText("all branches")).toBeTruthy();
    ready.unmount();

    const failed = render(
      <MetricStrip
        tiles={[
          { label: "Fleet", value: "6", hint: "all branches" },
          { label: "In service", value: "2" },
        ]}
        isError
      />,
    );
    expect(failed.queryByText("all branches")).toBeNull();
  });

  it("lays two, three and four tiles out without spilling a row", () => {
    const tile = { label: "A", value: "1" };
    const columns = ([2, 3, 4] as const).map((count) => {
      const { container, unmount } = render(
        <MetricStrip
          tiles={
            Array.from({ length: count }, (_unused, index) => ({
              ...tile,
              label: `Tile ${index}`,
            })) as unknown as MetricTiles
          }
        />,
      );
      const className = container.querySelector("dl")?.className ?? "";
      unmount();
      return className;
    });

    expect(columns[0]).toContain("grid-cols-2");
    expect(columns[1]).toContain("sm:grid-cols-3");
    expect(columns[2]).toContain("sm:grid-cols-4");
  });

  it("colours itself from semantic tokens only", () => {
    const { container } = render(<MetricStrip tiles={tiles} />);

    expect(container.innerHTML).not.toMatch(/amber-|emerald-|sky-|red-/);
  });
});
