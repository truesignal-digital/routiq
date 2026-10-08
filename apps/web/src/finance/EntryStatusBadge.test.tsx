// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { i18n } from "../i18n/index.js";
import { EntryStatusBadge, type EntryStatus } from "./EntryStatusBadge.js";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

afterEach(cleanup);

describe("EntryStatusBadge", () => {
  // #177: the same entry was blue in Finance, amber on trips and grey once
  // posted on the vehicle. Waiting is warning, done is success, everywhere.
  const cases = [
    ["SUBMITTED", "bg-warning/10", "lucide-clock", "Awaiting review"],
    ["POSTED", "bg-success/10", "lucide-circle-check", "Posted"],
    ["REJECTED", "bg-destructive/10", "lucide-circle-x", "Rejected"],
    ["REVERSED", "bg-foreground/[0.05]", "lucide-undo-2", "Cancelled"],
  ] as const satisfies readonly (readonly [EntryStatus, string, string, string])[];

  it.each(cases)("shows %s with its one tone, glyph and label", (status, tone, icon, label) => {
    const { container } = render(<EntryStatusBadge status={status} />);
    const badge = container.firstElementChild;

    expect(badge?.className).toContain(tone);
    expect(badge?.querySelector(`.${icon}`)).toBeTruthy();
    expect(badge?.textContent).toBe(label);
  });

  it("keeps the glyph out of the accessible name", () => {
    const { container } = render(<EntryStatusBadge status="POSTED" />);

    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("reads in sentence case, not shouting", () => {
    const { container } = render(<EntryStatusBadge status="POSTED" />);

    expect(container.firstElementChild?.className).not.toContain("uppercase");
  });
});
