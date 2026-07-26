// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
      t: (key: string) => key,
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

const mockUseEntriesValue = {
  data: { pages: [{ entries: [] }] },
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

vi.mock("../finance/FinanceNav.js", () => ({
  FinanceNav: () => null,
}));

import { FinanceEntriesScreen } from "./FinanceEntriesScreen.js";

const DEBOUNCE_MS = 300;

describe("FinanceEntriesScreen", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    issuedQueries.length = 0;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("queries once for the settled period filter, not once per keystroke", () => {
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

    // The idle asset-filter debounce settles on the same tick; it must not
    // produce a second query of its own.
    act(() => {
      vi.advanceTimersByTime(DEBOUNCE_MS * 2);
    });
    expect(issuedQueries).toEqual([{}, { periodCode: "2026-07" }]);
  });
});
