// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MeCtx, type MeContext } from "../auth/me.js";
import { i18n } from "../i18n/index.js";
import { FinanceEntryDetailScreen } from "./FinanceEntryDetailScreen.js";

const mocks = vi.hoisted(() => ({
  createCommandIntent: vi.fn(),
  useEntry: vi.fn(),
  navigate: vi.fn(),
  toastAdd: vi.fn(),
}));

const searchParams = vi.hoisted(() => ({ current: {} as { reverse?: boolean } }));

vi.mock("@/components/ui/toast.js", () => ({
  toast: { add: mocks.toastAdd },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useParams: () => ({
    entryId: "00000000-0000-4000-8000-000000000010",
  }),
  // `?reverse=1` opens the dialog on arrival.
  useSearch: () => searchParams.current,
}));

vi.mock("../commands/intent.js", () => ({
  createCommandIntent: mocks.createCommandIntent,
}));

vi.mock("../finance/useEntry.js", () => ({
  useEntry: mocks.useEntry,
}));

const approver: MeContext = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  principalId: "00000000-0000-4000-8000-000000000002",
  principalType: "HUMAN",
  membershipId: "00000000-0000-4000-8000-000000000003",
  role: "FINANCE",
  branchScope: "ALL",
  enabledModules: ["CORE", "FINANCE"],
  enabledPresets: ["TRUCKING", "PASSENGER_TRANSPORT"],
};

const MAKER_ID = "00000000-0000-4000-8000-000000000031";

/** The default fixture, waiting for a decision and recorded by `recordedBy`. */
function waiting(recordedBy: string, directionDecides = false) {
  const current = mocks.useEntry.getMockImplementation()?.() ?? mocks.useEntry();
  mocks.useEntry.mockReturnValue({
    ...current,
    data: {
      ...current.data,
      status: "SUBMITTED",
      postedAt: null,
      postingPeriodCode: null,
      rowVersion: 4,
      recordedBy: { principalId: recordedBy, displayName: null, scope: "WORKSPACE" },
      directionDecides,
    },
  });
}

function succeedingIntent() {
  const submit = vi.fn(async () => ({
    ok: true,
    outcome: {
      commandId: crypto.randomUUID(),
      recordId: crypto.randomUUID(),
      rowVersion: 5,
      warnings: [],
      idempotentReplay: false,
    },
  }));
  mocks.createCommandIntent.mockReturnValue({ current: vi.fn(), submit });
  return submit;
}

function renderScreen() {
  return render(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(
        MeCtx.Provider,
        { value: approver },
        createElement(FinanceEntryDetailScreen),
      ),
    ),
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
  mocks.useEntry.mockReturnValue({
    data: {
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
      description: null,
      paymentReference: null,
      sourceReference: null,
      rejectedReason: null,
      reversesEntryId: null,
      reversedByEntryId: null,
      postings: [],
      links: { activityId: null, activityNumber: null, workOrderId: null, workOrderAssetId: null },
      recordedBy: { principalId: MAKER_ID, displayName: "Sali", scope: "WORKSPACE" },
      evidence: { state: "NOT_SUPPLIED", artifactCount: 0 },
      evidenceFiles: [],
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
});

afterEach(cleanup);

describe("finance entry reversal dialog", () => {
  it("cancels without dispatching", async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole("button", { name: "Reverse entry" }));
    await user.click(screen.getByRole("button", { name: "Keep entry" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(mocks.createCommandIntent).not.toHaveBeenCalled();
  });

  it("disables empty submit, dispatches reverse, and emits a success toast", async () => {
    const submit = vi.fn(async () => ({
      ok: true,
      outcome: {
        commandId: crypto.randomUUID(),
        recordId: crypto.randomUUID(),
        rowVersion: 1,
        warnings: [],
        idempotentReplay: false,
      },
    }));
    mocks.createCommandIntent.mockReturnValue({
      current: vi.fn(),
      submit,
    });
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole("button", { name: "Reverse entry" }));
    const dialog = screen.getByRole("dialog", { name: "Reverse entry" });
    const submitButton = within(dialog).getByRole("button", { name: "Reverse entry" });
    expect(within(submitButton.parentElement!).getAllByRole("button").map((button) => button.textContent))
      .toEqual(["Keep entry", "Reverse entry"]);
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);

    await user.type(screen.getByRole("textbox", { name: "Reason for reversal" }), "Duplicate posting");
    await user.click(submitButton);

    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(mocks.createCommandIntent).toHaveBeenCalledWith(
      expect.anything(),
      "reverse-entry",
      1,
    );
    expect(mocks.toastAdd).toHaveBeenCalledWith({
      type: "success",
      title: "Entry reversed",
    });
  });
});

describe("Reverse is one level only (#130)", () => {
  function showingEntry(overrides: Record<string, unknown>) {
    const current = mocks.useEntry();
    mocks.useEntry.mockReturnValue({ ...current, data: { ...current.data, ...overrides } });
  }

  afterEach(() => {
    searchParams.current = {};
  });

  it("offers Reverse on a posted original", () => {
    renderScreen();
    expect(screen.getByRole("button", { name: "Reverse entry" })).toBeTruthy();
  });

  it("offers no Reverse on a reversal, even when the link asks for the dialog", () => {
    showingEntry({
      amountMinor: -1000,
      reversesEntryId: "00000000-0000-4000-8000-000000000099",
    });
    searchParams.current = { reverse: true };
    renderScreen();
    expect(screen.queryByRole("button", { name: "Reverse entry" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers no Reverse on an entry already reversed", () => {
    showingEntry({
      status: "REVERSED",
      reversedByEntryId: "00000000-0000-4000-8000-000000000099",
    });
    renderScreen();
    expect(screen.queryByRole("button", { name: "Reverse entry" })).toBeNull();
  });
});

describe("finance entry detail enums", () => {
  it("renders status, payment method and category translated, never as raw codes", () => {
    renderScreen();

    expect(screen.getByText("Posted")).toBeDefined();
    expect(screen.getByText("Cash")).toBeDefined();
    expect(screen.getByText("Fuel")).toBeDefined();

    const body = document.body.textContent ?? "";
    for (const code of ["POSTED", "CASH", "FUEL"]) {
      expect(body, code).not.toContain(code);
    }
  });

  it("translates the same enums into French when the language changes", async () => {
    await i18n.changeLanguage("fr-CM");
    renderScreen();

    expect(screen.getByText("Comptabilisée")).toBeDefined();
    expect(screen.getByText("Espèces")).toBeDefined();
    expect(screen.getByText("Carburant")).toBeDefined();

    await i18n.changeLanguage("en");
  });
});

describe("decision on the entry page", () => {
  it("offers Approve and Reject while the entry waits, and approves in one tap", async () => {
    waiting(MAKER_ID);
    const submit = succeedingIntent();
    const user = userEvent.setup();
    renderScreen();

    expect(screen.getByRole("button", { name: "Reject entry" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Approve entry" }));

    await waitFor(() => expect(submit).toHaveBeenCalledOnce());
    expect(mocks.createCommandIntent).toHaveBeenCalledWith(expect.anything(), "approve-entry", 1);
    expect(submit).toHaveBeenCalledWith(
      { entryId: "00000000-0000-4000-8000-000000000010" },
      { expectedVersion: 4 },
    );
    // Approve is one tap: no dialog stands between the button and the command.
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(mocks.toastAdd).toHaveBeenCalledWith({ type: "success", title: "Entry approved" });
  });

  it("asks for a reason before rejecting", async () => {
    waiting(MAKER_ID);
    const submit = succeedingIntent();
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole("button", { name: "Reject entry" }));
    await user.type(screen.getByRole("textbox", { name: "Rejection reason" }), "No receipt");
    await user.click(screen.getAllByRole("button", { name: "Reject entry" }).at(-1)!);

    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        { entryId: "00000000-0000-4000-8000-000000000010", reason: "No receipt" },
        { expectedVersion: 4 },
      ),
    );
    expect(mocks.createCommandIntent).toHaveBeenCalledWith(expect.anything(), "reject-entry", 1);
  });

  it("offers no decision on the approver's own entry", () => {
    waiting(approver.principalId);
    renderScreen();

    expect(screen.queryByRole("button", { name: "Approve entry" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject entry" })).toBeNull();
  });

  it("offers no decision above the viewer's approval band, where the Director decides (#262)", () => {
    waiting(MAKER_ID, true);
    renderScreen();

    expect(screen.queryByRole("button", { name: "Approve entry" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject entry" })).toBeNull();
  });

  it("offers no decision once the entry is posted", () => {
    renderScreen();

    expect(screen.queryByRole("button", { name: "Approve entry" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject entry" })).toBeNull();
  });
});
