// @vitest-environment jsdom
import type { ActivityDetail } from "@routiq/contracts";
import userEvent from "@testing-library/user-event";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/index.js";

type Entry = NonNullable<ActivityDetail["financialEntries"]>[number];

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
    categoryLabelFr: "Fret",
    categoryLabelEn: "Freight",
    // XAF has exponent 0 — 900 000 francs is 900 000 minor units.
    amountMinor: 900_000,
    status: "POSTED",
    reversesEntryId: null,
    cancelledBy: null,
    ...overrides,
  };
}

function digits(element: HTMLElement): string {
  // The minus is the typographic U+2212 in every language.
  return (element.textContent ?? "").replace(/\u2212/g, "-").replace(/[^\d+-]/g, "");
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
    entry({ direction: "REVENUE", amountMinor: -100_000, status: "POSTED" }),
  ];

  it("counts posted lines only, expenses subtracting", () => {
    expect(postedNetMinor(entries)).toBe(500_000);
  });

  it("nets a reversed entry and its reversal to zero (#60)", () => {
    const pair = [
      entry({ direction: "EXPENSE", amountMinor: 45_000, status: "REVERSED" }),
      entry({ direction: "EXPENSE", amountMinor: -45_000, status: "POSTED" }),
    ];
    expect(postedNetMinor(pair)).toBe(0);
  });

  it("keeps lines awaiting approval in their own total", () => {
    expect(pendingNetMinor(entries)).toBe(-250_000);
  });
});

describe("activity money card", () => {
  it("shows a cancelled entry as one struck-through line, the net unchanged (#427)", async () => {
    const cancellationId = "00000000-0000-4000-8000-000000000039";
    render(
      <ActivityMoney
        totals
        scope="LEDGER"
        entries={[
          entry(),
          entry({
            entryId: "00000000-0000-4000-8000-000000000038",
            entryNumber: "FIN-2026-0008",
            direction: "EXPENSE",
            amountMinor: 45_000,
            status: "REVERSED",
            cancelledBy: {
              entryId: cancellationId,
              entryNumber: "FIN-2026-0009",
              postingPeriodCode: "2026-08",
              postedAt: "2026-08-20T10:00:00.000Z",
              reasonCode: null,
              reasonText: "Entered twice",
              recordedBy: { principalId: null, displayName: "Awa", scope: "WORKSPACE" },
              folded: true,
            },
          }),
          entry({
            entryId: cancellationId,
            entryNumber: "FIN-2026-0009",
            direction: "EXPENSE",
            amountMinor: -45_000,
            status: "POSTED",
            reversesEntryId: "00000000-0000-4000-8000-000000000038",
          }),
        ]}
      />,
    );

    expect(screen.queryByRole("link", { name: /FIN-2026-0009/ })).toBeNull();
    const original = screen.getByRole("link", { name: /FIN-2026-0008/ });
    expect(original.querySelector(".line-through")).not.toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Show cancellation" }));
    expect(screen.getByText("Reason: Entered twice")).toBeDefined();
    // The pair still nets to zero: the net is the freight alone.
    expect(digits(summaryValue("Net"))).toBe("+900000");
  });

  it("renders nothing when no money touched the activity", () => {
    const { container } = render(<ActivityMoney totals scope="LEDGER" entries={[]} />);

    expect(container.innerHTML).toBe("");
  });

  it("lists a driver's own entries without a net summed over them (#264)", () => {
    render(<ActivityMoney totals={false} scope="OWN_ENTRIES" entries={[entry()]} />);

    expect(screen.getByRole("link", { name: /FIN-2026-0001/ })).toBeDefined();
    expect(screen.queryByText("Net")).toBeNull();
    expect(screen.getByText("Only the entries you recorded on this activity.")).toBeDefined();
  });

  it("links each line to its finance entry", () => {
    render(<ActivityMoney totals scope="LEDGER" entries={[entry()]} />);

    const link = screen.getByRole("link", { name: /FIN-2026-0001/ });
    expect(link.getAttribute("href")).toBe(`/finance/entries/${ENTRY_ID}`);
  });

  it("labels the net as posted-only and keeps pending money out of it", () => {
    render(
      <ActivityMoney
        totals
        scope="LEDGER"
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
    render(<ActivityMoney totals scope="LEDGER" entries={[entry()]} />);

    expect(screen.queryByText("Awaiting approval")).toBeNull();
  });

  it("signs an expense line so a reader can add the column up", () => {
    render(
      <ActivityMoney
        totals
        scope="LEDGER"
        entries={[
          entry({ direction: "EXPENSE", categoryCode: "FUEL", amountMinor: 400_000 }),
        ]}
      />,
    );

    const link = screen.getByRole("link", { name: /FIN-2026-0001/ });
    expect(digits(link)).toContain("-400000");
  });

  it("signs DLA-2026-00008 as Finance does: an expense reads minus, its reversal plus (E2.8)", async () => {
    const fuel = { entryNumber: "DLA-2026-00008", direction: "EXPENSE", categoryCode: "FUEL" } as const;
    const lines = [
      entry({ ...fuel, amountMinor: 86_000, status: "REVERSED" }),
      entry({
        ...fuel,
        entryId: "00000000-0000-4000-8000-000000000033",
        entryNumber: "DLA-2026-00009",
        amountMinor: -86_000,
      }),
    ];
    const amountOf = (number: string) =>
      (screen.getByRole("link", { name: new RegExp(number) }).lastElementChild?.textContent ?? "").replace(
        /\s/g,
        " ",
      );

    render(<ActivityMoney totals scope="LEDGER" entries={lines} />);
    expect(amountOf("DLA-2026-00008")).toBe("−FCFA 86,000");
    expect(amountOf("DLA-2026-00009")).toBe("+FCFA 86,000");
    cleanup();

    await i18n.changeLanguage("fr-CM");
    render(<ActivityMoney totals scope="LEDGER" entries={lines} />);
    expect(amountOf("DLA-2026-00008")).toBe("−86 000 FCFA");
    await i18n.changeLanguage("en");
  });

  it("names each line's category in the reader's language, never its code (#129)", async () => {
    const fuel = entry({
      direction: "EXPENSE",
      categoryCode: "FUEL",
      categoryLabelFr: "Carburant",
      categoryLabelEn: "Fuel",
      amountMinor: 86_000,
    });
    const { unmount } = render(<ActivityMoney totals scope="LEDGER" entries={[fuel]} />);

    const english = screen.getByRole("link", { name: /FIN-2026-0001/ });
    expect(english.textContent).toContain("Fuel");
    expect(english.textContent).not.toContain("FUEL");
    unmount();

    await i18n.changeLanguage("fr-CM");
    try {
      render(<ActivityMoney totals scope="LEDGER" entries={[fuel]} />);
      const french = screen.getByRole("link", { name: /FIN-2026-0001/ });
      expect(french.textContent).toContain("Carburant");
      expect(french.textContent).not.toContain("FUEL");
    } finally {
      await i18n.changeLanguage("en");
    }
  });
});
