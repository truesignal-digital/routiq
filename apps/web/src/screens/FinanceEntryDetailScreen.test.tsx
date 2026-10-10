// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { FinancialEntryDetail } from "@routiq/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
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
  navigate: vi.fn(),
  submit: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => ({ entryId: "00000000-0000-4000-8000-000000000060" }),
  useSearch: () => ({}),
}));
vi.mock("@/auth/me.js", () => ({ useMeContext: mocks.me }));
vi.mock("../commands/instance.js", async () => {
  const { CommandStatusStore } = await import("../commands/store.js");
  return { commandStatusStore: new CommandStatusStore(), commandClient: { submit: mocks.submit } };
});
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

function signedIn(principalId: string, role: "DRIVER" | "ADMIN" | "CASHIER" | "FINANCE" = "DRIVER") {
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

// #542: Finance opened an entry above its band and found no Approve or Reject,
// and no reason why.
describe("an entry above the viewer's approval band", () => {
  it("says the Director decides instead of offering Approve and Reject", () => {
    signedIn(OTHER_ID, "FINANCE");
    showing(entry({ amountMinor: 1_450_000, directionDecides: true, approver: "DIRECTION_APPROVES" }));
    expect(screen.queryByRole("button", { name: /^Approve/ })).toBeNull();
    expect(screen.getByText("Above your approval band: the Director decides.")).toBeTruthy();
  });

  it("says nothing of the kind inside the band", () => {
    signedIn(OTHER_ID, "FINANCE");
    showing(entry({ directionDecides: false, approver: "FINANCE_APPROVES" }));
    expect(screen.getByRole("button", { name: /^Approve/ })).toBeTruthy();
    expect(screen.queryByText("Above your approval band: the Director decides.")).toBeNull();
  });
});

describe("Edit on the finance entry detail", () => {
  it("is offered to the author while the entry waits, and opens the pre-filled form on the side panel", async () => {
    signedIn(AUTHOR_ID);
    showing(entry());

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    const dialog = await screen.findByRole("dialog", { name: "Edit entry DLA-2026-00012" });
    // Editing a fact opens the panel, never a centred dialog: the form is
    // taller than a laptop window (#470).
    expect(dialog.dataset.slot).toBe("sheet-content");
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

  // #572: a driver records expenses only, so their pending revenue entry
  // offers no edit; the server refuses the save with ROLE_FORBIDDEN too.
  it("is not offered to a driver on their own pending revenue entry", () => {
    signedIn(AUTHOR_ID);
    showing(entry({ direction: "REVENUE" }));
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("is offered to a cashier on their own pending revenue entry", () => {
    signedIn(AUTHOR_ID, "CASHIER");
    showing(entry({ direction: "REVENUE" }));
    expect(screen.getByRole("button", { name: "Edit" })).toBeTruthy();
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

describe("Cancel entry on a work-order cost, as Finance (#559)", () => {
  const WORK_ORDER_ID = "00000000-0000-4000-8000-00000000d001";
  const ASSET_ID = "00000000-0000-4000-8000-0000000000a1";
  const workOrderCost = () =>
    entry({
      status: "POSTED",
      links: { activityId: null, activityNumber: null, workOrderId: WORK_ORDER_ID, workOrderAssetId: ASSET_ID, workOrderDescription: "Brake pads front axle" },
    });

  it("cancels for wrong details, then offers the work order, never Record again", async () => {
    mocks.submit.mockResolvedValue({
      ok: true,
      outcome: { commandId: "c1", recordId: "r1", rowVersion: 1, recordStatus: "POSTED", warnings: [], idempotentReplay: false },
    });
    signedIn(OTHER_ID, "FINANCE");
    showing(workOrderCost());
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Cancel entry" }));
    const form = await screen.findByRole("dialog", { name: "Cancel entry" });
    await user.click(within(form).getByRole("radio", { name: "Wrong details, to record again" }));
    await user.click(within(form).getByRole("button", { name: "Cancel entry" }));

    await screen.findByText(/Ask the Director, the Administrator or the work order's technician/);
    expect(screen.queryByRole("button", { name: "Record again" })).toBeNull();
    expect(mocks.submit).toHaveBeenCalledOnce();
    await user.click(screen.getByRole("button", { name: "Open the work order" }));
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/assets/$assetId/maintenance",
      params: { assetId: ASSET_ID },
      search: { panel: `work_order:${WORK_ORDER_ID}` },
    });
  });
});
