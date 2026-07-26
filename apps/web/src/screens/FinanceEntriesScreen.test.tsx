// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { UseEntriesParams } from "../finance/useEntries.js";

/**
 * One record per distinct query key handed to `useEntries`, which is what
 * react-query turns into a request — an unchanged key is a cache hit, not a
 * fetch. Re-renders that carry identical params therefore record nothing.
 */
const issuedQueries: UseEntriesParams[] = [];

function recordQuery(params: UseEntriesParams): void {
  const previous = issuedQueries[issuedQueries.length - 1];
  if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(params)) {
    return;
  }
  issuedQueries.push(params);
}

vi.mock("react-i18next", async () => {
  const actual = await vi.importActual("react-i18next");
  return {
    ...actual,
    useTranslation: () => ({
      // Keys stand in for messages, except the one option label built from
      // data — the asset select needs distinguishable entries to pick from.
      t: (key: string, options?: Record<string, unknown>) =>
        key === "finance.entries.filters.assetOption"
          ? `${String(options?.["code"])} — ${String(options?.["name"])}`
          : key,
      i18n: { resolvedLanguage: "en" },
    }),
    initReactI18next: {
      type: "3rdParty",
      init: () => {},
    },
  };
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({}),
}));

vi.mock("../auth/me.js", () => ({
  useMeContext: () => ({
    principalId: "test-user",
    role: "MANAGER",
    enabledModules: ["FINANCE"],
  }),
}));

vi.mock("../finance/permissions.js", () => ({
  canRecordFinance: vi.fn(() => true),
  canManagePeriods: () => false,
}));

const entry = {
  id: "00000000-0000-4000-8000-000000000010",
  entryNumber: "FIN-001",
  direction: "EXPENSE",
  status: "POSTED",
  category: { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel" },
  amountMinor: 1000,
  currency: "XAF",
  economicDate: "2026-07-01",
  postingPeriodCode: "2026-07",
  isLatePosting: false,
  branchId: "00000000-0000-4000-8000-000000000020",
  counterpartyName: null,
  paymentMethod: "CASH",
  estimateStatus: "ACTUAL",
  postedAt: "2026-07-01T10:00:00.000Z",
  rowVersion: 1,
};

const mockUseEntriesValue = {
  data: { pages: [{ entries: [entry] }] },
  isPending: false,
  isError: false,
  isFetching: false,
  isFetchingNextPage: false,
  hasNextPage: false,
  fetchNextPage: vi.fn(),
  refetch: vi.fn(),
};

vi.mock("../finance/useEntries.js", () => ({
  useEntries: (params: UseEntriesParams) => {
    recordQuery(params);
    return mockUseEntriesValue;
  },
}));

const assets = [
  {
    id: "00000000-0000-4000-8000-0000000000a1",
    assetCode: "TRK-001",
    registrationNumber: "LT-123-AB",
    manufacturer: "Toyota",
    model: "Coaster",
    lifecycleStatus: "IN_SERVICE",
    rowVersion: 1,
    category: { code: "BUS", labelFr: "Bus", labelEn: "Bus" },
    branch: { code: "DLA", name: "Douala" },
  },
  {
    id: "00000000-0000-4000-8000-0000000000a2",
    assetCode: "TRK-002",
    registrationNumber: null,
    manufacturer: null,
    model: null,
    lifecycleStatus: "IN_SERVICE",
    rowVersion: 1,
    category: { code: "BUS", labelFr: "Bus", labelEn: "Bus" },
    branch: { code: "DLA", name: "Douala" },
  },
];

vi.mock("../assets/useAssets.js", () => ({
  useAssets: () => ({
    data: { pages: [{ items: assets, nextCursor: null }] },
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  }),
}));

vi.mock("../finance/FinanceNav.js", () => ({
  FinanceNav: () => null,
}));

import { FinanceEntriesScreen } from "./FinanceEntriesScreen.js";

const DEBOUNCE_MS = 300;

/** jsdom never matches a width query; the table needs a nudge to render desktop. */
function mockDesktop() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDesktop();
  issuedQueries.length = 0;
});

afterEach(cleanup);

describe("FinanceEntriesScreen", () => {
  it("queries once for the settled period filter, not once per keystroke", () => {
    vi.useFakeTimers();
    try {
      render(<FinanceEntriesScreen />);
      const periodInput = screen.getByPlaceholderText(
        "finance.entries.filters.periodPlaceholder",
      );
      expect(issuedQueries).toEqual([{}]);

      // A controlled input sees the whole value on each keystroke.
      for (const value of ["2", "20", "202", "2026", "2026-", "2026-0", "2026-07"]) {
        fireEvent.change(periodInput, { target: { value } });
      }

      // Still inside the debounce window: every intermediate value would be its
      // own query key, and its own request, if the debounce were dropped.
      act(() => {
        vi.advanceTimersByTime(DEBOUNCE_MS - 1);
      });
      expect(issuedQueries).toEqual([{}]);

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(issuedQueries).toEqual([{}, { periodCode: "2026-07" }]);

      // Nothing else may settle onto the same tick and issue a second query.
      act(() => {
        vi.advanceTimersByTime(DEBOUNCE_MS * 2);
      });
      expect(issuedQueries).toEqual([{}, { periodCode: "2026-07" }]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends the chosen asset's id, never a typed UUID", async () => {
    const user = userEvent.setup();
    render(<FinanceEntriesScreen />);

    // The asset filter is a select over real assets; the only free-text control
    // left on the screen is the period search box.
    expect(screen.queryAllByRole("textbox")).toEqual([]);

    await user.click(
      screen.getByRole("combobox", { name: "finance.entries.filters.asset" }),
    );
    // Code plus display name; the second asset has neither make nor model, so
    // its label falls back to the bare code.
    expect(await screen.findByRole("option", { name: "TRK-002" })).toBeTruthy();
    await user.click(
      await screen.findByRole("option", { name: "TRK-001 — Toyota Coaster" }),
    );

    await waitFor(() =>
      expect(issuedQueries).toEqual([{}, { assetId: assets[0]!.id }]),
    );
  });

  it("refetches with the new status param", async () => {
    const user = userEvent.setup();
    render(<FinanceEntriesScreen />);

    await user.click(
      screen.getByRole("combobox", { name: "finance.entries.filters.status" }),
    );
    await user.click(
      await screen.findByRole("option", { name: "finance.entries.status.POSTED" }),
    );

    await waitFor(() =>
      expect(issuedQueries).toEqual([{}, { status: "POSTED" }]),
    );
  });

  it("pages the cursor through load more without changing the filter params", async () => {
    mockUseEntriesValue.hasNextPage = true;
    try {
      const user = userEvent.setup();
      render(<FinanceEntriesScreen />);

      await user.click(screen.getByRole("button", { name: "dataTable.loadMore" }));

      expect(mockUseEntriesValue.fetchNextPage).toHaveBeenCalledOnce();
      expect(issuedQueries).toEqual([{}]);
    } finally {
      mockUseEntriesValue.hasNextPage = false;
    }
  });
});
