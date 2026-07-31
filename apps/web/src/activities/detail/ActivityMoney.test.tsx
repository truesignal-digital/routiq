// @vitest-environment jsdom
import type { ActivityDetail } from "@routiq/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.js";

type Entry = ActivityDetail["financialEntries"][number];

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string;
    params?: Record<string, string>;
    children?: ReactNode;
  }) => (
    <a
      href={Object.entries(params ?? {}).reduce(
        (path, [key, value]) => path.replace(`$${key}`, value),
        to,
      )}
      {...props}
    >
      {children}
    </a>
  ),
}));

const { ActivityMoney, pendingNetMinor, postedNetMinor } = await import(
  "./ActivityMoney.js"
);

const ENTRY_ID = "00000000-0000-4000-8000-000000000031";

function entry(overrides: Partial<Entry> = {}): Entry {
  return {
    entryId: ENTRY_ID,
    entryNumber: "FIN-2026-0001",
    direction: "REVENUE",
    categoryCode: "FREIGHT",
    // XAF has exponent 0 — 900 000 francs is 900 000 minor units.
    amountMinor: 900_000,
    status: "POSTED",
    ...overrides,
  };
}

function digits(element: HTMLElement): string {
  return (element.textContent ?? "").replace(/[^\d+-]/g, "");
}

/** The `<dd>` that follows a summary line's `<dt>`. */
function summaryValue(label: string): HTMLElement {
  const dt = screen.getByText(label).closest("dt");
  const value = dt?.nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`no value for ${label}`);
  return value;
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

afterEach(cleanup);

describe("net sums", () => {
  const entries = [
    entry(),
    entry({ direction: "EXPENSE", categoryCode: "FUEL", amountMinor: 400_000 }),
    entry({ direction: "EXPENSE", amountMinor: 250_000, status: "SUBMITTED" }),
    entry({ direction: "REVENUE", amountMinor: 700_000, status: "REJECTED" }),
    entry({ direction: "REVENUE", amountMinor: 100_000, status: "REVERSED" }),
  ];

  it("counts posted lines only, expenses subtracting", () => {
    expect(postedNetMinor(entries)).toBe(500_000);
  });

  it("keeps lines awaiting approval in their own total", () => {
    expect(pendingNetMinor(entries)).toBe(-250_000);
  });
});

describe("activity money card", () => {
  it("renders nothing when no money touched the activity", () => {
    const { container } = render(<ActivityMoney entries={[]} />);

    expect(container.innerHTML).toBe("");
  });

  it("links each line to its finance entry", () => {
    render(<ActivityMoney entries={[entry()]} />);

    const link = screen.getByRole("link", { name: /FIN-2026-0001/ });
    expect(link.getAttribute("href")).toBe(`/finance/entries/${ENTRY_ID}`);
  });

  it("labels the net as posted-only and keeps pending money out of it", () => {
    render(
      <ActivityMoney
        entries={[
          entry(),
          entry({
            entryId: "00000000-0000-4000-8000-000000000032",
            entryNumber: "FIN-2026-0002",
            direction: "EXPENSE",
            categoryCode: "FUEL",
            amountMinor: 400_000,
            status: "SUBMITTED",
          }),
        ]}
      />,
    );

    expect(digits(summaryValue("Net"))).toBe("+900000");
    expect(digits(summaryValue("Awaiting approval"))).toBe("-400000");
    expect(screen.getByText(/posted only/)).toBeTruthy();
  });

  it("says nothing about pending money when every line is posted", () => {
    render(<ActivityMoney entries={[entry()]} />);

    expect(screen.queryByText("Awaiting approval")).toBeNull();
  });

  it("signs an expense line so a reader can add the column up", () => {
    render(
      <ActivityMoney
        entries={[
          entry({ direction: "EXPENSE", categoryCode: "FUEL", amountMinor: 400_000 }),
        ]}
      />,
    );

    const link = screen.getByRole("link", { name: /FIN-2026-0001/ });
    expect(digits(link)).toContain("-400000");
  });
});
