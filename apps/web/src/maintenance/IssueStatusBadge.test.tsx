// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { i18n } from "../i18n/index.js";
import { IssueStatusBadge, type IssueStatusFacts } from "./IssueStatusBadge.js";

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

afterEach(cleanup);

const notPlanned: IssueStatusFacts = { status: "OPEN", workOrders: [{ status: "REJECTED" }] };
const inWorkOrder: IssueStatusFacts = { status: "OPEN", workOrders: [{ status: "APPROVED" }] };
const resolved: IssueStatusFacts = { status: "RESOLVED", workOrders: [{ status: "COMPLETED" }] };
const dismissed: IssueStatusFacts = { status: "DISMISSED", workOrders: [] };

describe("IssueStatusBadge", () => {
  // #177: a resolved problem was green in Maintenance and grey on the vehicle.
  const cases = [
    ["open with no active work order", notPlanned, "bg-warning/10", "lucide-clock", "Not planned yet"],
    ["open in a work order", inWorkOrder, "bg-info/10", "lucide-wrench", "In a work order"],
    ["resolved", resolved, "bg-success/10", "lucide-circle-check", "Resolved"],
    ["dismissed", dismissed, "bg-foreground/[0.05]", null, "Dismissed"],
  ] as const;

  it.each(cases)("shows an issue %s with its one tone, glyph and label", (_, issue, tone, icon, label) => {
    const { container } = render(<IssueStatusBadge issue={issue} />);
    const badge = container.firstElementChild;

    expect(badge?.className).toContain(tone);
    if (icon === null) expect(badge?.querySelector("svg")).toBeNull();
    else expect(badge?.querySelector(`.${icon}`)).toBeTruthy();
    expect(badge?.textContent).toBe(label);
  });
});
