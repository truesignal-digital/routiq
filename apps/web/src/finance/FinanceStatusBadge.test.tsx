// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { FinancialEntryListItem } from "@routiq/contracts";
import { FinanceStatusBadge } from "./FinanceStatusBadge.js";

type Status = FinancialEntryListItem["status"];

afterEach(cleanup);

describe("FinanceStatusBadge", () => {
  const cases = [
    ["SUBMITTED", "lucide-loader-circle", "bg-info/10"],
    ["POSTED", "lucide-circle-check", "bg-success/10"],
    ["REJECTED", "lucide-circle-x", "bg-destructive/10"],
    ["REVERSED", "lucide-undo-2", "bg-foreground/[0.05]"],
  ] as const satisfies readonly (readonly [Status, string, string])[];

  it.each(cases)("marks %s with its own glyph and tone", (status, icon, tone) => {
    const { container } = render(
      <FinanceStatusBadge status={status}>{status}</FinanceStatusBadge>,
    );

    expect(container.querySelector(`.${icon}`)).toBeTruthy();
    expect(container.querySelector("span")?.className).toContain(tone);
    expect(screen.getByText(status)).toBeTruthy();
  });

  it("gives a reversed entry a glyph the neutral tone would not supply", () => {
    const { container } = render(
      <FinanceStatusBadge status="REVERSED">Reversed</FinanceStatusBadge>,
    );

    // Neutral has no default icon, so this one can only come from the status map.
    expect(container.querySelector(".lucide-undo-2")).toBeTruthy();
  });

  it("keeps the glyph out of the accessible name", () => {
    const { container } = render(
      <FinanceStatusBadge status="POSTED">Comptabilisée</FinanceStatusBadge>,
    );

    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
    expect(container.textContent).toBe("Comptabilisée");
  });
});
