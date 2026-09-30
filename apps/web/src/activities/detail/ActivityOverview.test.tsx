// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { i18n } from "../../i18n/index.js";
import { ActivityOverview, type ActivityOverviewData } from "./ActivityOverview.js";

function overview(
  overrides: Partial<ActivityOverviewData> = {},
): ActivityOverviewData {
  return {
    status: "CLOSED",
    startedAt: "2026-07-18T06:00:00.000Z",
    endedAt: "2026-07-18T17:30:00.000Z",
    legCount: 2,
    financialEntries: [],
    ...overrides,
  };
}

/** The `<dd>` that follows a tile's `<dt>` label. */
function tile(label: string): HTMLElement {
  const value = screen.getByText(label).nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`no tile for ${label}`);
  return value;
}

function tone(label: string): string | null {
  return (
    screen
      .getByText(label)
      .closest("[data-slot='metric-tile']")
      ?.getAttribute("data-tone") ?? null
  );
}

function digits(element: HTMLElement): string {
  return (element.textContent ?? "").replace(/[^\d+-]/g, "");
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

afterEach(cleanup);

describe("activity overview band", () => {
  it("counts the legs the server counted", () => {
    render(<ActivityOverview activity={overview()} />);

    expect(tile("Legs").textContent).toContain("2");
  });

  it("says an open activity is running, and flags the tile", () => {
    render(<ActivityOverview activity={overview({ status: "OPEN", endedAt: null })} />);

    expect(tile("Ended").textContent).toContain("Running");
    expect(tone("Ended")).toBe("warning");
  });

  it("dashes a closed activity with no end rather than calling it running", () => {
    render(<ActivityOverview activity={overview({ status: "CLOSED", endedAt: null })} />);

    expect(tile("Ended").textContent).toContain("—");
    expect(screen.queryByText("Running")).toBeNull();
  });

  it("nets only the posted lines, and says so", () => {
    render(
      <ActivityOverview
        activity={overview({
          financialEntries: [
            {
              entryId: "00000000-0000-4000-8000-000000000001",
              entryNumber: "E-1",
              direction: "REVENUE",
              categoryCode: "FREIGHT",
              // XAF has exponent 0 — 900 000 francs is 900 000 minor units.
              amountMinor: 900_000,
              status: "POSTED",
            },
            {
              entryId: "00000000-0000-4000-8000-000000000002",
              entryNumber: "E-2",
              direction: "EXPENSE",
              categoryCode: "FUEL",
              amountMinor: 400_000,
              status: "POSTED",
            },
            {
              entryId: "00000000-0000-4000-8000-000000000003",
              entryNumber: "E-3",
              direction: "EXPENSE",
              categoryCode: "TOLLS",
              amountMinor: 250_000,
              status: "SUBMITTED",
            },
          ],
        })}
      />,
    );

    const net = tile("Net");
    expect(digits(net)).toBe("+500000");
    expect(net.textContent).toContain("posted lines only");
    expect(tone("Net")).toBe("neutral");
  });

  it("flags a loss and signs it, so colour is never the only signal", () => {
    render(
      <ActivityOverview
        activity={overview({
          financialEntries: [
            {
              entryId: "00000000-0000-4000-8000-000000000004",
              entryNumber: "E-4",
              direction: "EXPENSE",
              categoryCode: "REPAIRS",
              amountMinor: 120_000,
              status: "POSTED",
            },
          ],
        })}
      />,
    );

    expect(digits(tile("Net"))).toBe("-120000");
    expect(tone("Net")).toBe("warning");
  });

  it("leaves the net out when the server kept the ledger back (#103)", () => {
    render(<ActivityOverview activity={overview({ financialEntries: null })} />);

    expect(screen.queryByText("Net")).toBeNull();
    expect(tile("Legs").textContent).toContain("2");
  });
});
