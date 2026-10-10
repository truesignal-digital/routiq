import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { MetricStrip, metricTiles, moneyMetric, type MetricTiles } from "./metric-strip.js";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    search,
    children,
    ...props
  }: {
    to: string;
    search?: Record<string, string | undefined>;
    children?: ReactNode;
  }) => {
    const query = new URLSearchParams(
      Object.entries(search ?? {}).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ).toString();
    return (
      <a href={query === "" ? to : `${to}?${query}`} {...props}>
        {children}
      </a>
    );
  },
}));

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
    // The dash is the one left in the app (guard H19); it is named for a screen reader.
    expect(screen.getAllByRole("img", { name: "Chargement impossible" })).toHaveLength(3);
    expect(container.querySelector("dl")?.getAttribute("data-state")).toBe("error");
    expect(container.querySelectorAll("[data-slot=skeleton]")).toHaveLength(0);
  });

  it("says a single unknown value is not recorded, without dimming the tiles that do have one", () => {
    const { container } = render(
      <MetricStrip
        tiles={[
          { label: "Fleet", value: "6" },
          { label: "In service", value: null },
        ]}
      />,
    );

    expect(values(container)).toEqual(["6", "Non renseigné"]);
  });

  /** "Not recorded" is a claim about the books; a withheld figure was never missing from them. */
  it("leaves a withheld value out instead of calling it not recorded", () => {
    const { container } = render(
      <MetricStrip
        tiles={[
          { label: "Fleet", value: "6" },
          { label: "Waiting", value: null, withheld: true, hint: "Finances indisponibles" },
        ]}
      />,
    );

    expect(values(container)).toEqual(["6", ""]);
    expect(screen.queryByText("Non renseigné")).toBeNull();
    expect(screen.getByText("Finances indisponibles")).toBeTruthy();
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

  it("lays two to five tiles out without spilling a row", () => {
    const tile = { label: "A", value: "1" };
    const columns = ([2, 3, 4, 5] as const).map((count) => {
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
    expect(columns[3]).toContain("lg:grid-cols-5");
  });

  it("colours itself from semantic tokens only", () => {
    const { container } = render(<MetricStrip tiles={tiles} />);

    expect(container.innerHTML).not.toMatch(/amber-|emerald-|sky-|red-/);
  });

  it("leaves a tile without a filter target as plain text", () => {
    render(<MetricStrip tiles={tiles} />);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("turns a tile with a filter target into a pressed-state button", async () => {
    const onSelect = vi.fn();
    const { container } = render(
      <MetricStrip
        tiles={[
          { label: "Fleet", value: "6", onSelect, selected: true },
          { label: "In service", value: "2", onSelect: () => {} },
        ]}
      />,
    );

    const fleet = screen.getByRole("button", { name: "Fleet" });
    expect(fleet.getAttribute("aria-pressed")).toBe("true");
    expect(
      screen.getByRole("button", { name: "In service" }).getAttribute("aria-pressed"),
    ).toBe("false");
    // Still a description list: the button sits inside the term.
    expect(container.querySelector("dt button")).toBe(fleet);

    await userEvent.setup().click(fleet);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("turns a tile with a link into a link over the whole card", () => {
    const { container } = render(
      <MetricStrip
        tiles={[
          { id: "assets", label: "Trucks in service", value: "6", link: { to: "/assets" } },
          {
            label: "Expenses",
            value: "4",
            link: { to: "/finance/entries", search: { direction: "EXPENSE", periodCode: undefined } },
          },
        ]}
      />,
    );

    const link = screen.getByRole("link", { name: "Trucks in service" });
    expect(link.getAttribute("href")).toBe("/assets");
    expect(container.querySelector("dt a")).toBe(link);
    expect(link.className).toContain("after:absolute");
    expect(screen.getByRole("link", { name: "Expenses" }).getAttribute("href")).toBe(
      "/finance/entries?direction=EXPENSE",
    );
    expect(container.querySelector("[data-metric=assets]")).toBeTruthy();
  });

  it("keeps a secondary line on its own destination, above the tile's link", () => {
    render(
      <MetricStrip
        tiles={[
          {
            label: "Waiting",
            value: "3",
            link: { to: "/finance/approvals" },
            secondary: { label: "2 in other branches", to: "/finance/approvals", search: { branch: "all" } },
          },
          { label: "Fleet", value: "6" },
        ]}
      />,
    );

    const secondary = screen.getByRole("link", { name: "2 in other branches" });
    expect(secondary.getAttribute("href")).toBe("/finance/approvals?branch=all");
    expect(secondary.className).toContain("z-10");
  });

  it("puts the method behind an info button next to the label", () => {
    render(
      <MetricStrip
        tiles={[
          { label: "Posted", value: "4", info: "Counted by posting date" },
          { label: "Fleet", value: "6" },
        ]}
      />,
    );

    expect(screen.getByRole("button", { name: "Mode de calcul" })).toBeTruthy();
  });

  it("shows an amount as its figure with the currency as a small unit", () => {
    const { container } = render(
      <MetricStrip
        tiles={[
          { label: "Spent", ...moneyMetric(1_250_000, "XAF") },
          { label: "Unknown", ...moneyMetric(null) },
        ]}
      />,
    );

    const [spent, unknown] = [...container.querySelectorAll("[data-slot=metric-value]")];
    expect(spent?.querySelector("small")?.textContent).toBe("FCFA");
    expect(spent?.textContent?.replace(/\s/g, "")).toBe("1250000FCFA");
    expect(unknown?.textContent).toBe("Non renseigné");
  });

  it("builds a strip from a run-time list only when it has one to five tiles", () => {
    const tile = { label: "Fleet", value: "6" };
    expect(metricTiles([])).toBeUndefined();
    expect(metricTiles([tile])).toHaveLength(1);
    expect(metricTiles([tile, tile, tile, tile, tile])).toHaveLength(5);
    expect(metricTiles([tile, tile, tile, tile, tile, tile])).toBeUndefined();
  });
});
