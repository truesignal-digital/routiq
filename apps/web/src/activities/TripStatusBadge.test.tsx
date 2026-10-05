// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { i18n } from "../i18n/index.js";
import {
  LegLoadBadge,
  TripStatusBadge,
  tripIconTone,
  type TripStatusFacts,
} from "./TripStatusBadge.js";

const open: TripStatusFacts = { status: "OPEN", completeness: null, completenessCodes: [] };
const closed: TripStatusFacts = { status: "CLOSED", completeness: "COMPLETE", completenessCodes: [] };
const closedWithGaps: TripStatusFacts = {
  status: "CLOSED",
  completeness: "COMPLETE_WITH_EXCEPTIONS",
  completenessCodes: ["ACTIVITY_MISSING_CREW", "ACTIVITY_NO_REVENUE"],
};

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

afterEach(cleanup);

describe("trip status badge", () => {
  // #177: a closed trip was grey in the list and green in the detail.
  const cases = [
    ["open", open, "bg-info/10", "lucide-route", "On the road"],
    ["closed", closed, "bg-success/10", "lucide-circle-check", "Closed"],
    ["closed with gaps", closedWithGaps, "bg-warning/10", "lucide-triangle-alert", "Closed, 2 gaps"],
  ] as const;

  it.each(cases)("shows a trip %s with its one tone, glyph and label", (_, trip, tone, icon, label) => {
    const { container } = render(<TripStatusBadge trip={trip} />);
    const badge = container.firstElementChild;

    expect(badge?.className).toContain(tone);
    expect(badge?.querySelector(`.${icon}`)).toBeTruthy();
    expect(badge?.textContent).toBe(label);
  });

  it("speaks French by default", async () => {
    await i18n.changeLanguage("fr-CM");
    try {
      render(<TripStatusBadge trip={open} />);
      expect(screen.getByText("En route")).toBeTruthy();
    } finally {
      await i18n.changeLanguage("en");
    }
  });

  it("marks only a trip on the road in a row icon", () => {
    expect(tripIconTone("OPEN")).toBe("info");
    expect(tripIconTone("CLOSED")).toBe("neutral");
  });
});

describe("leg load badge", () => {
  const cases = [
    ["LADEN", "bg-success/10", "Laden"],
    ["PARTIAL", "bg-info/10", "Partial"],
    ["EMPTY", "bg-foreground/[0.05]", "Empty"],
  ] as const;

  it.each(cases)("shows a %s leg with its tone", (state, tone, label) => {
    const { container } = render(<LegLoadBadge state={state} />);

    expect(container.firstElementChild?.className).toContain(tone);
    expect(container.firstElementChild?.textContent).toBe(label);
    expect(container.querySelector("svg")).toBeNull();
  });
});
