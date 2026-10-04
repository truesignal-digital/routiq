// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ReactNode } from "react";
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
      // `errorMessage` consults this instance for the module-disabled state.
      i18n: { resolvedLanguage: "en", exists: () => true, t: (key: string) => key },
    }),
    initReactI18next: {
      type: "3rdParty",
      init: () => {},
    },
  };
});

const navigate = vi.fn();
const emptySearch = vi.hoisted(() => ({}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useParams: () => ({}),
  useSearch: () => emptySearch,
  Link: ({
    to,
    params,
    search,
    children,
    ...props
  }: {
    to: string;
    params?: Record<string, string>;
    search?: Record<string, string>;
    children?: ReactNode;
  }) => {
    const path = Object.entries(params ?? {}).reduce(
      (built, [key, value]) => built.replace(`$${key}`, value),
      to,
    );
    const query = new URLSearchParams(search ?? {}).toString();
    return (
      <a href={query === "" ? path : `${path}?${query}`} {...props}>
        {children}
      </a>
    );
  },
}));

vi.mock("../auth/me.js", () => ({
  useMeContext: () => ({
    principalId: "test-user",
    role: "MANAGER",
    enabledModules: ["FINANCE"],
  }),
}));

vi.mock("../finance/permissions.js", () => ({
  canReadFinance: vi.fn(() => true),
  canRecordFinance: vi.fn(() => true),
  canReverseEntry: vi.fn(() => false),
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
  links: {
    activityId: null,
    activityNumber: null,
    workOrderId: "00000000-0000-4000-8000-0000000000c1",
    workOrderAssetId: "00000000-0000-4000-8000-0000000000a1",
  },
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

// The row drawer mounts EntrySummary, which reads the entry on its own.
vi.mock("../finance/useEntry.js", () => ({
  useEntry: () => ({
    isPending: false,
    isError: false,
    data: { ...entry, postings: [] },
    refetch: vi.fn(),
  }),
}));

import { canReadFinance, canRecordFinance, canReverseEntry } from "../finance/permissions.js";
import { FinanceEntriesScreen } from "./FinanceEntriesScreen.js";

const DEBOUNCE_MS = 300;

/** The screen states the read's own default order rather than leaving it implicit. */
const DEFAULT_SORT = "postedAt:desc";

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
  // clearAllMocks keeps implementations, so an opt-out set by one test would
  // otherwise follow the next one.
  vi.mocked(canRecordFinance).mockReturnValue(true);
  vi.mocked(canReadFinance).mockReturnValue(true);
  vi.mocked(canReverseEntry).mockReturnValue(false);
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
      expect(issuedQueries).toEqual([{ sort: DEFAULT_SORT }]);

      // A controlled input sees the whole value on each keystroke.
      for (const value of ["2", "20", "202", "2026", "2026-", "2026-0", "2026-07"]) {
        fireEvent.change(periodInput, { target: { value } });
      }

      // Still inside the debounce window: every intermediate value would be its
      // own query key, and its own request, if the debounce were dropped.
      act(() => {
        vi.advanceTimersByTime(DEBOUNCE_MS - 1);
      });
      expect(issuedQueries).toEqual([{ sort: DEFAULT_SORT }]);

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(issuedQueries).toEqual([
        { sort: DEFAULT_SORT },
        { periodCode: "2026-07", sort: DEFAULT_SORT },
      ]);

      // Nothing else may settle onto the same tick and issue a second query.
      act(() => {
        vi.advanceTimersByTime(DEBOUNCE_MS * 2);
      });
      expect(issuedQueries).toEqual([
        { sort: DEFAULT_SORT },
        { periodCode: "2026-07", sort: DEFAULT_SORT },
      ]);
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
      expect(issuedQueries).toEqual([
        { sort: DEFAULT_SORT },
        { assetId: assets[0]!.id, sort: DEFAULT_SORT },
      ]),
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
      expect(issuedQueries).toEqual([
        { sort: DEFAULT_SORT },
        { status: "POSTED", sort: DEFAULT_SORT },
      ]),
    );
  });

  it("offers the view menu and the record action in the toolbar row", () => {
    render(<FinanceEntriesScreen />);

    expect(screen.getByRole("button", { name: "dataTable.view" })).toBeTruthy();

    const action = screen.getByRole("link", {
      name: /finance\.entries\.recordAction/,
    });
    expect(action.getAttribute("href")).toBe("/finance/record");
  });

  it("drops the record action along with the screen when finance reading is denied", () => {
    vi.mocked(canReadFinance).mockReturnValue(false);
    render(<FinanceEntriesScreen />);

    expect(
      screen.queryByRole("link", { name: /finance\.entries\.recordAction/ }),
    ).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("sends the chosen order to the read, restarting the cursor", async () => {
    const user = userEvent.setup();
    render(<FinanceEntriesScreen />);

    await user.click(
      screen.getByRole("button", { name: /finance\.entries\.detail\.amount/ }),
    );

    // A new sort is a new query key, so react-query drops the old pages rather
    // than stitching two orders together. Amounts open largest-first, which is
    // TanStack's default for a numeric column and the useful end for money.
    await waitFor(() =>
      expect(issuedQueries).toEqual([
        { sort: DEFAULT_SORT },
        { sort: "amount:desc" },
      ]),
    );

    await user.click(
      screen.getByRole("button", { name: /finance\.entries\.detail\.amount/ }),
    );
    await waitFor(() =>
      expect(issuedQueries.at(-1)).toEqual({ sort: "amount:asc" }),
    );
  });

  it("never lets the view menu hide the column that opens a row", async () => {
    const user = userEvent.setup();
    render(<FinanceEntriesScreen />);

    await user.click(screen.getByRole("button", { name: "dataTable.view" }));

    const items = (await screen.findAllByRole("menuitemcheckbox")).map(
      (item) => item.textContent,
    );
    expect(items).not.toContain("finance.entries.detail.entryNumber");
    expect(items).toContain("finance.entries.detail.category");
  });

  it("names the work order an entry belongs to and links to it (#87)", () => {
    render(<FinanceEntriesScreen />);

    expect(
      screen.getAllByText("finance.entries.detail.linkedTo").length,
    ).toBeGreaterThan(0);
    const link = screen.getByRole("link", { name: "finance.entries.detail.workOrderLink" });
    expect(link.getAttribute("href")).toBe(
      "/assets/00000000-0000-4000-8000-0000000000a1/maintenance?panel=work_order%3A00000000-0000-4000-8000-0000000000c1",
    );
  });

  it("leaves the row body inert so it can carry controls", async () => {
    const user = userEvent.setup();
    render(<FinanceEntriesScreen />);

    await user.click(screen.getByText("Carburant"));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("offers reversal in the row menu only to a role that may reverse", async () => {
    const user = userEvent.setup();
    render(<FinanceEntriesScreen />);

    await user.click(screen.getByRole("button", { name: "dataTable.actions" }));
    expect(
      (await screen.findAllByRole("menuitem")).map((item) => item.textContent),
    ).toEqual(["finance.entries.viewer.fullScreen"]);

    cleanup();
    // role-config: approver on a posted entry.
    vi.mocked(canReverseEntry).mockReturnValue(true);
    render(<FinanceEntriesScreen />);

    await user.click(screen.getByRole("button", { name: "dataTable.actions" }));
    expect(
      (await screen.findAllByRole("menuitem")).map((item) => item.textContent),
    ).toEqual([
      "finance.entries.viewer.fullScreen",
      "finance.entries.detail.reverseAction",
    ]);
  });

  it("sends a reversal to the detail route with the dialog already open", async () => {
    vi.mocked(canReverseEntry).mockReturnValue(true);
    const user = userEvent.setup();
    render(<FinanceEntriesScreen />);

    await user.click(screen.getByRole("button", { name: "dataTable.actions" }));
    await user.click(
      await screen.findByRole("menuitem", {
        name: "finance.entries.detail.reverseAction",
      }),
    );

    // The dialog is not re-implemented here; the route opens it.
    expect(navigate).toHaveBeenCalledExactlyOnceWith({
      to: "/finance/entries/$entryId",
      params: { entryId: entry.id },
      search: { reverse: true },
    });
  });

  it("opens the row drawer instead of leaving the list", async () => {
    const user = userEvent.setup();
    render(<FinanceEntriesScreen />);

    await user.click(screen.getByRole("button", { name: "FIN-001" }));

    const drawer = await screen.findByRole("dialog");
    expect(within(drawer).getByRole("heading", { name: "FIN-001" })).toBeTruthy();
    // The summary is the real field list, not a placeholder.
    expect(
      within(drawer).getByText("finance.entries.detail.paymentMethod"),
    ).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("hands the entry to its own route from the drawer's full-screen action", async () => {
    const user = userEvent.setup();
    render(<FinanceEntriesScreen />);

    await user.click(screen.getByRole("button", { name: "FIN-001" }));
    await screen.findByRole("dialog");
    await user.click(
      screen.getByRole("button", { name: "finance.entries.viewer.fullScreen" }),
    );

    expect(navigate).toHaveBeenCalledExactlyOnceWith({
      to: "/finance/entries/$entryId",
      params: { entryId: entry.id },
    });
  });

  it("walks the cursor from the pager without changing the filter params", async () => {
    mockUseEntriesValue.hasNextPage = true;
    try {
      const user = userEvent.setup();
      render(<FinanceEntriesScreen />);

      await user.click(screen.getByRole("button", { name: "dataTable.nextPage" }));

      // Advancing the cursor is a fetch, not a new query key.
      expect(mockUseEntriesValue.fetchNextPage).toHaveBeenCalledOnce();
      expect(issuedQueries).toEqual([{ sort: DEFAULT_SORT }]);
    } finally {
      mockUseEntriesValue.hasNextPage = false;
    }
  });
});
