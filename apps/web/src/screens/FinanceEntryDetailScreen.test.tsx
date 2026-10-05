// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FinancialEntryDetail } from "@routiq/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/index.js";
import { FinanceEntryDetailScreen } from "./FinanceEntryDetailScreen.js";

const AUTHOR_ID = "00000000-0000-4000-8000-00000000a001";
const OTHER_ID = "00000000-0000-4000-8000-00000000a002";
const ENTRY_ID = "00000000-0000-4000-8000-000000000060";
const BRANCH_ID = "00000000-0000-4000-8000-000000000070";

const mocks = vi.hoisted(() => ({
  me: vi.fn(),
  entry: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ entryId: "00000000-0000-4000-8000-000000000060" }),
  useSearch: () => ({}),
}));
vi.mock("@/auth/me.js", () => ({ useMeContext: mocks.me }));
vi.mock("@/finance/useEntry.js", () => ({ useEntry: mocks.entry }));
vi.mock("@/finance/EntrySummary.js", () => ({ EntrySummary: () => null }));
vi.mock("@/components/record-history-sheet.js", () => ({ RecordHistorySheet: () => null }));
vi.mock("@/shell/BranchScopeNotices.js", () => ({ OtherBranchNotice: () => null }));
vi.mock("../assets/reference.js", () => ({
  useAssetRegistrationReference: () => ({
    data: { assetClasses: [], branches: [{ id: BRANCH_ID, code: "DLA", name: "Douala" }] },
    isPending: false,
    isError: false,
  }),
}));
vi.mock("../documents/useCategories.js", () => ({
  useCategories: () => ({
    data: [{ code: "FUEL", labelFr: "Carburant", labelEn: "Fuel" }],
    isPending: false,
    isError: false,
  }),
}));
vi.mock("../assets/useAssetOptions.js", () => ({ useAssetOptions: () => [] }));

function entry(overrides: Partial<FinancialEntryDetail> = {}): FinancialEntryDetail {
  return {
    id: ENTRY_ID,
    entryNumber: "DLA-2026-00012",
    direction: "EXPENSE",
    status: "SUBMITTED",
    category: { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel", layer: "DIRECT" },
    amountMinor: 145_000,
    currency: "XAF",
    economicDate: "2026-09-12",
    postingPeriodCode: null,
    isLatePosting: false,
    branchId: BRANCH_ID,
    counterpartyName: null,
    paymentMethod: "CASH",
    estimateStatus: "ACTUAL",
    postedAt: null,
    rowVersion: 2,
    reversesEntryId: null,
    recordedBy: { principalId: AUTHOR_ID, displayName: "Amina", scope: "WORKSPACE" },
    evidence: { state: "NOT_SUPPLIED", artifactCount: 0 },
    assetShareMinor: null,
    assetLinks: null,
    description: null,
    paymentReference: null,
    sourceReference: null,
    rejectedReason: null,
    reversedByEntryId: null,
    postings: [
      {
        lineNo: 1,
        amountMinor: 145_000,
        assetId: null,
        assetCode: null,
        assetAttribution: "DIRECT",
        activityId: null,
        workOrderId: null,
        category: { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel" },
      },
    ],
    evidenceFiles: [],
    ...overrides,
  };
}

function signedIn(principalId: string, role: "DRIVER" | "ADMIN" = "DRIVER") {
  mocks.me.mockReturnValue({ principalId, role, enabledModules: ["CORE", "FINANCE"] });
}

function showing(data: FinancialEntryDetail) {
  mocks.entry.mockReturnValue({ isPending: false, isError: false, data, refetch: vi.fn() });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <FinanceEntryDetailScreen />
    </QueryClientProvider>,
  );
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("Edit on the finance entry detail", () => {
  it("is offered to the author while the entry waits, and opens the pre-filled form", async () => {
    signedIn(AUTHOR_ID);
    showing(entry());

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    const dialog = await screen.findByRole("dialog", { name: "Edit entry DLA-2026-00012" });
    expect((dialog.querySelector("input[name='amountInput']") as HTMLInputElement).value).toMatch(
      /^145\s?000$/,
    );
  });

  it("is not offered to anyone else, an admin included", () => {
    signedIn(OTHER_ID, "ADMIN");
    showing(entry());
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("is not offered once the entry is decided", () => {
    signedIn(AUTHOR_ID);
    showing(entry({ status: "REJECTED", rejectedReason: "doublon" }));
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("is not offered for a split entry the single-line form cannot write back", () => {
    signedIn(AUTHOR_ID);
    const line = entry().postings[0]!;
    showing(
      entry({
        postings: [
          { ...line, amountMinor: 100_000 },
          { ...line, lineNo: 2, amountMinor: 45_000 },
        ],
      }),
    );
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });
});
