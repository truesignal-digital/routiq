// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MeCtx, type MeContext } from "../auth/me.js";
import { currentPeriodCode } from "../finance/model.js";
import { i18n } from "../i18n/index.js";
import { FinancePeriodsScreen } from "./FinancePeriodsScreen.js";

const mocks = vi.hoisted(() => ({
  createCommandIntent: vi.fn(),
  usePeriods: vi.fn(),
  toastSuccess: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: {
    success: mocks.toastSuccess,
    warning: mocks.toastWarning,
    error: vi.fn(),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../commands/intent.js", () => ({
  createCommandIntent: mocks.createCommandIntent,
}));

vi.mock("../finance/usePeriods.js", () => ({
  usePeriods: mocks.usePeriods,
}));

vi.mock("../finance/FinanceNav.js", () => ({
  FinanceNav: () => null,
}));

const approver: MeContext = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  principalId: "00000000-0000-4000-8000-000000000002",
  principalType: "HUMAN",
  membershipId: "00000000-0000-4000-8000-000000000003",
  role: "FINANCE_APPROVER",
  branchScope: "ALL",
  enabledModules: ["CORE", "FINANCE"],
};

function renderScreen() {
  return render(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(
        MeCtx.Provider,
        { value: approver },
        createElement(FinancePeriodsScreen),
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

/** Period codes top to bottom, read through each row's first cell. */
function periodCodesInOrder(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0]?.textContent ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDesktop();
  mocks.usePeriods.mockReturnValue({
    data: {
      periods: [
        {
          periodCode: currentPeriodCode(),
          status: "OPEN",
          lockedAt: null,
          entryCount: 2,
          rowVersion: 1,
        },
        {
          periodCode: "2026-06",
          status: "LOCKED",
          lockedAt: "2026-07-01T10:00:00.000Z",
          entryCount: 4,
          rowVersion: 2,
        },
      ],
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
});

afterEach(cleanup);

describe("finance period command routing", () => {
  it("dispatches lock then reopen through their distinct commands", async () => {
    const submissionOrder: string[] = [];
    mocks.createCommandIntent.mockImplementation(
      (_client: unknown, commandName: string) => ({
        current: vi.fn(),
        submit: vi.fn(async () => {
          submissionOrder.push(commandName);
          return {
            ok: true,
            outcome: {
              commandId: crypto.randomUUID(),
              recordId: crypto.randomUUID(),
              rowVersion: 1,
              warnings: [],
              idempotentReplay: false,
            },
          };
        }),
      }),
    );
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole("button", { name: "Lock" }));
    expect(screen.getByRole("alertdialog")).toBeDefined();
    await user.click(screen.getAllByRole("button", { name: "Lock" }).at(-1)!);
    await waitFor(() => expect(submissionOrder).toEqual(["lock-period"]));
    expect(mocks.toastSuccess).toHaveBeenCalledWith("Period locked");

    await user.click(screen.getByRole("button", { name: "Reopen" }));
    await user.type(screen.getByLabelText("Reason for reopening"), "Correction needed");
    await user.click(screen.getAllByRole("button", { name: "Reopen" }).at(-1)!);

    await waitFor(() =>
      expect(submissionOrder).toEqual(["lock-period", "reopen-period"]),
    );
  });

  it("cancels reopen without dispatching", async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole("button", { name: "Reopen" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull(),
    );
    expect(mocks.createCommandIntent).not.toHaveBeenCalled();
  });

  // The periods read is unpaginated, so client-side sorting reorders the whole
  // list — the reason these headers carry a sort control and the entries table's
  // headers do not.
  it("reorders the whole list from a column header, newest period first by default", async () => {
    const user = userEvent.setup();
    renderScreen();

    expect(periodCodesInOrder()).toEqual([currentPeriodCode(), "2026-06"]);

    // Busiest period first: 2026-06 holds four entries, the current one two.
    await user.click(screen.getByRole("button", { name: "Entries" }));
    expect(periodCodesInOrder()).toEqual(["2026-06", currentPeriodCode()]);

    await user.click(screen.getByRole("button", { name: "Entries" }));
    expect(periodCodesInOrder()).toEqual([currentPeriodCode(), "2026-06"]);
  });

  it("cancels lock from the overlay without dispatching", async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole("button", { name: "Lock" }));
    const overlay = document.querySelector<HTMLElement>(
      '[data-slot="alert-dialog-overlay"]',
    );
    expect(overlay).not.toBeNull();
    await user.click(overlay!);

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mocks.createCommandIntent).not.toHaveBeenCalled();
  });
});
