// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "@/i18n/index.js";
import { ChartViewToggle } from "./chart-view-toggle.js";

afterEach(cleanup);
beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

describe("ChartViewToggle", () => {
  it("offers the view that is not showing, and asks for it", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<ChartViewToggle view="chart" onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: "Table" }));
    expect(onChange).toHaveBeenCalledWith("table");
    rerender(<ChartViewToggle view="table" onChange={onChange} />);
    expect(screen.getByRole("button", { name: "Chart" })).toBeTruthy();
  });
});
