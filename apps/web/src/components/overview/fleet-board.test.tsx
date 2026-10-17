// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import type { DailyStatus } from "@routiq/contracts";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/index.js";
import { FleetBoard } from "./fleet-board.js";

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

const days = Array.from({ length: 30 }, (_unused, index) => `2026-${index < 21 ? "09" : "10"}-${String(index < 21 ? index + 10 : index - 20).padStart(2, "0")}`);
const week = (status: DailyStatus, count: number): DailyStatus[] => Array.from({ length: count }, () => status);
const rows = [
  { key: "a3", label: "VH003", to: "/assets/a3", days: [...week("ON_TRIP", 20), ...week("WORKSHOP", 8), ...week("GROUNDED", 2)] },
  { key: "a12", label: "VH012", days: [...week("NOT_RECORDED", 30)] },
];

describe("FleetBoard", () => {
  it("names every cell, links each vehicle and reads out the cell under the pointer", () => {
    render(<FleetBoard rows={rows} days={days} />);
    expect(screen.getAllByRole("img")).toHaveLength(60);
    const cell = screen.getByRole("img", { name: "VH003 · 9 Oct · Grounded" });
    expect(screen.getByRole("link", { name: "VH003" }).getAttribute("href")).toBe("/assets/a3");
    expect(screen.getByText("Today")).toBeTruthy();
    fireEvent.pointerEnter(cell);
    expect(screen.getByText("VH003 · 9 Oct · Grounded", { selector: "[data-slot=fleet-board-pointed]" })).toBeTruthy();
    expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
  });

  it("counts each status per vehicle in its table view, and never invents a share", async () => {
    render(<FleetBoard rows={rows} days={days} />);
    await userEvent.click(screen.getByRole("button", { name: "Table" }));
    const [, first, second] = screen.getAllByRole("row").map((row) => row.textContent);
    expect(first).toBe("VH00320082067%");
    expect(second).toBe("VH012000030Not recorded");
  });

  it("lists today's status on a phone", () => {
    phone.value = true;
    const { container } = render(<FleetBoard rows={rows} days={days} />);
    const listed = [...container.querySelectorAll("[data-slot=fleet-board-today-row]")].map((row) => row.textContent);
    expect(listed[0]).toContain("Grounded");
    expect(listed[0]).toContain("20 days on the road");
    expect(listed[1]).toContain("Not recorded");
    // The whole row is the truck link's touch target on a phone.
    const row = container.querySelector<HTMLElement>("[data-slot=fleet-board-today-row]")!;
    expect(row.className).toContain("relative");
    expect(row.querySelector("a")?.className).toContain("after:inset-0");
  });
});
