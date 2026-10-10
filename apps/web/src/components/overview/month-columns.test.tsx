// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { i18n } from "@/i18n/index.js";
import { MonthColumns } from "./month-columns.js";

afterEach(cleanup);
beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

const columns = [
  { key: "2026-09", label: "Sep", month: "September", value: 12, valueText: "12", description: "September: 12 truck-days off the road" },
  { key: "2026-10", label: "Oct", month: "October (so far)", value: 4, valueText: "4", description: "October (so far): 4 truck-days off the road", partial: true },
];

describe("MonthColumns", () => {
  it("names each month in words and draws the partial one as partial", () => {
    const { container } = render(<MonthColumns columns={columns} monthHeader="Month" valueHeader="Days off the road" />);
    expect(screen.getByRole("img", { name: "October (so far): 4 truck-days off the road" })).toBeTruthy();
    const drawn = [...container.querySelectorAll("[data-slot=month-column]")];
    expect(drawn.map((column) => column.hasAttribute("data-partial"))).toEqual([false, true]);
  });

  it("has a table view, newest month first", async () => {
    render(<MonthColumns columns={columns} monthHeader="Month" valueHeader="Days off the road" />);
    await userEvent.click(screen.getByRole("button", { name: "Table" }));
    const cells = screen.getAllByRole("row").map((row) => row.textContent);
    expect(cells.slice(1)).toEqual(["October (so far)4", "September12"]);
  });
});
