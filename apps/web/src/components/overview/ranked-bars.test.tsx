// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/index.js";
import { RankedBars } from "./ranked-bars.js";

const phone = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => phone.value }));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...props }: { to: string; children?: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

afterEach(() => {
  cleanup();
  phone.value = false;
});
beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

const rows = [
  { key: "a", label: "VH001", value: 290, to: "/assets/a" },
  { key: "b", label: "VH007", value: 360, flagged: true, detail: "24% above the median" },
  { key: "c", label: "VH009", value: 318 },
  { key: "d", label: "VH004", value: 296 },
];
const props = { format: (value: number) => `${value} XAF`, labelHeader: "Truck", valueHeader: "Fuel per km" };

describe("RankedBars", () => {
  it("sorts largest first, writes each figure, and marks a flagged row with ▲ and words", () => {
    const { container } = render(
      <RankedBars {...props} rows={rows} reference={{ value: 293, label: "Fleet median 293 XAF" }} flagLabel="Above the fleet median" />,
    );
    const shown = [...container.querySelectorAll("[data-slot=ranked-bars-row]")];
    expect(shown.map((row) => row.textContent)).toEqual([
      "VH00724% above the median▲ Above the fleet median: 360 XAF",
      "VH009318 XAF",
      "VH004296 XAF",
      "VH001290 XAF",
    ]);
    expect(shown[0]?.hasAttribute("data-flagged")).toBe(true);
    expect(screen.getByText("Fleet median 293 XAF")).toBeTruthy();
    expect(screen.getByRole("link", { name: "VH001" }).getAttribute("href")).toBe("/assets/a");
  });

  it("shows the top three on a phone and says how many it left out", () => {
    phone.value = true;
    render(<RankedBars {...props} rows={rows} moreLabel={(count) => `${count} more`} />);
    expect(screen.queryByText("VH001")).toBeNull();
    expect(screen.getByText("1 more")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Table" })).toBeNull();
  });

  it("has a table view listing every row", async () => {
    render(<RankedBars {...props} rows={rows} maxRows={2} />);
    await userEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(screen.getByRole("columnheader", { name: "Fuel per km" })).toBeTruthy();
    expect(screen.getByText("290 XAF")).toBeTruthy();
  });
});
