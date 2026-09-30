// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FinancialEntryDetail } from "@routiq/contracts";
import type { ReactNode } from "react";

vi.mock("react-i18next", async () => {
  const actual = await vi.importActual("react-i18next");
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { resolvedLanguage: "fr-CM" },
    }),
  };
});

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    to,
    params,
    search: _search,
    children,
    ...props
  }: {
    to: string;
    params?: Record<string, string>;
    search?: unknown;
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

type EntryQueryState = {
  isPending: boolean;
  isError: boolean;
  data: FinancialEntryDetail | undefined;
  refetch: () => void;
};

let entryQuery: EntryQueryState = {
  isPending: true,
  isError: false,
  data: undefined,
  refetch: vi.fn(),
};

vi.mock("./useEntry.js", () => ({
  useEntry: () => entryQuery,
}));

import { EntrySummary } from "./EntrySummary.js";
import { entryVehicleFields } from "../test-entry-fields.js";

const entry: FinancialEntryDetail = {
  id: "00000000-0000-4000-8000-000000000010",
  entryNumber: "FIN-001",
  direction: "EXPENSE",
  status: "POSTED",
  category: { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel", layer: null },
  amountMinor: 25000,
  currency: "XAF",
  economicDate: "2026-07-01",
  postingPeriodCode: "2026-07",
  isLatePosting: false,
  branchId: "00000000-0000-4000-8000-000000000020",
  counterpartyName: "Total Douala",
  paymentMethod: "CASH",
  estimateStatus: "ACTUAL",
  postedAt: "2026-07-01T10:00:00.000Z",
  rowVersion: 1,
  description: "Plein du camion",
  paymentReference: null,
  sourceReference: null,
  rejectedReason: null,
  reversesEntryId: null,
  reversedByEntryId: null,
  ...entryVehicleFields,
  evidenceFiles: [],
  postings: [],
};

afterEach(cleanup);

describe("EntrySummary", () => {
  it("announces the read while it is in flight", () => {
    entryQuery = { isPending: true, isError: false, data: undefined, refetch: vi.fn() };

    render(<EntrySummary entryId={entry.id} />);

    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("finance.entries.loading")).toBeTruthy();
  });

  it("offers a retry when the read fails", () => {
    const refetch = vi.fn();
    entryQuery = { isPending: false, isError: true, data: undefined, refetch };

    render(<EntrySummary entryId={entry.id} />);

    expect(screen.getByRole("alert")).toBeTruthy();
    screen.getByRole("button", { name: "finance.entries.retry" }).click();
    expect(refetch).toHaveBeenCalledOnce();
  });

  it("says so when the entry is gone rather than rendering blank fields", () => {
    entryQuery = { isPending: false, isError: false, data: undefined, refetch: vi.fn() };

    render(<EntrySummary entryId={entry.id} />);

    expect(screen.getByText("finance.entries.detail.notFound")).toBeTruthy();
  });

  it("lists the entry's fields, XAF amounts undivided", () => {
    entryQuery = { isPending: false, isError: false, data: entry, refetch: vi.fn() };

    const { container } = render(<EntrySummary entryId={entry.id} />);

    expect(screen.getByText("FIN-001")).toBeTruthy();
    // fr-CM is the default locale, so the French category label wins.
    expect(screen.getByText("Carburant")).toBeTruthy();
    expect(screen.getByText("Total Douala")).toBeTruthy();
    expect(screen.getByText("Plein du camion")).toBeTruthy();
    // XAF has exponent 0 — 25 000 minor units are 25 000 francs, not 250.
    expect(container.textContent).toMatch(/\+?25\s?000/);
    expect(container.textContent).not.toContain("250,00");
  });

  it("names the work order and trip the entry belongs to (#87)", () => {
    entryQuery = {
      isPending: false,
      isError: false,
      data: {
        ...entry,
        links: {
          activityId: "00000000-0000-4000-8000-0000000000b1",
          activityNumber: "DLA-2026-00042",
          workOrderId: "3f1a9c40-0000-4000-8000-0000000000c1",
          workOrderAssetId: "00000000-0000-4000-8000-0000000000a1",
        },
      },
      refetch: vi.fn(),
    };

    render(<EntrySummary entryId={entry.id} />);

    expect(screen.getByText("finance.entries.detail.linkedTo")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: "finance.entries.detail.workOrderLink" }).getAttribute("href"),
    ).toBe("/assets/00000000-0000-4000-8000-0000000000a1/maintenance");
    expect(
      screen.getByRole("link", { name: "finance.entries.detail.tripLink" }).getAttribute("href"),
    ).toBe("/activities/00000000-0000-4000-8000-0000000000b1");
  });

  it("omits the fields the entry does not carry", () => {
    entryQuery = {
      isPending: false,
      isError: false,
      data: { ...entry, counterpartyName: null, description: null },
      refetch: vi.fn(),
    };

    render(<EntrySummary entryId={entry.id} />);

    expect(screen.queryByText("finance.entries.detail.counterparty")).toBeNull();
    expect(screen.queryByText("finance.entries.detail.description")).toBeNull();
    expect(screen.queryByText("finance.entries.detail.linkedTo")).toBeNull();
    expect(screen.getByText("finance.entries.detail.entryNumber")).toBeTruthy();
  });
});
