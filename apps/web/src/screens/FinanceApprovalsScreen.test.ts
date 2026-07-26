// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, type ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MeCtx, type MeContext } from "../auth/me.js";
import {
  canApproveEntries,
  canManagePeriods,
} from "../finance/permissions.js";
import { currentPeriodCode } from "../finance/model.js";
import { i18n } from "../i18n/index.js";
import { FinanceApprovalsScreen } from "./FinanceApprovalsScreen.js";
import { FinancePeriodsScreen } from "./FinancePeriodsScreen.js";

const mocks = vi.hoisted(() => ({
  createCommandIntent: vi.fn(),
  useApprovals: vi.fn(),
  usePeriods: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../commands/intent.js", () => ({
  createCommandIntent: mocks.createCommandIntent,
}));

vi.mock("../finance/useApprovals.js", () => ({
  useApprovals: mocks.useApprovals,
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

function renderScreen(screenNode: ReactNode) {
  return render(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(MeCtx.Provider, { value: approver }, screenNode),
    ),
  );
}

function successfulIntentRecorder(submissionOrder: string[]) {
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

afterEach(cleanup);

describe("finance approval command routing", () => {
  it("submits approve entry A, then reject entry B through their distinct commands", async () => {
    expect(canApproveEntries(approver.role, approver.enabledModules)).toBe(true);

    mocks.useApprovals.mockReturnValue({
      data: {
        entries: [
          {
            id: "00000000-0000-4000-8000-000000000010",
            entryNumber: "FIN-001",
            direction: "EXPENSE",
            status: "SUBMITTED",
            category: { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel" },
            amountMinor: 1000,
            currency: "XAF",
            economicDate: "2026-07-01",
            postingPeriodCode: null,
            isLatePosting: false,
            branchId: "00000000-0000-4000-8000-000000000020",
            counterpartyName: null,
            paymentMethod: "CASH",
            estimateStatus: "ACTUAL",
            postedAt: null,
            rowVersion: 1,
            submittedByPrincipalId: "00000000-0000-4000-8000-000000000030",
            submittedAt: "2026-07-01T10:00:00.000Z",
          },
          {
            id: "00000000-0000-4000-8000-000000000011",
            entryNumber: "FIN-002",
            direction: "EXPENSE",
            status: "SUBMITTED",
            category: { code: "TOLLS", labelFr: "Péages", labelEn: "Tolls" },
            amountMinor: 500,
            currency: "XAF",
            economicDate: "2026-07-02",
            postingPeriodCode: null,
            isLatePosting: false,
            branchId: "00000000-0000-4000-8000-000000000020",
            counterpartyName: null,
            paymentMethod: "CASH",
            estimateStatus: "ACTUAL",
            postedAt: null,
            rowVersion: 2,
            submittedByPrincipalId: "00000000-0000-4000-8000-000000000031",
            submittedAt: "2026-07-02T10:00:00.000Z",
          },
        ],
        total: 2,
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });

    const submissionOrder: string[] = [];
    successfulIntentRecorder(submissionOrder);
    const user = userEvent.setup();
    renderScreen(createElement(FinanceApprovalsScreen));

    await user.click(screen.getAllByRole("button", { name: "Approve" })[0]!);
    await user.click(screen.getAllByRole("button", { name: "Approve" }).at(-1)!);
    await waitFor(() => expect(submissionOrder).toEqual(["approve-entry"]));
    await user.click(screen.getByRole("button", { name: "Close" }));

    await user.click(screen.getByRole("button", { name: "Reject" }));
    await user.type(screen.getByLabelText("Rejection reason"), "Duplicate entry");
    await user.click(screen.getAllByRole("button", { name: "Reject" }).at(-1)!);

    await waitFor(() =>
      expect(submissionOrder).toEqual(["approve-entry", "reject-entry"]),
    );
  });
});

describe("finance period command routing", () => {
  it("submits lock, then reopen through their distinct commands", async () => {
    expect(canManagePeriods(approver.role, approver.enabledModules)).toBe(true);

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

    const submissionOrder: string[] = [];
    successfulIntentRecorder(submissionOrder);
    const user = userEvent.setup();
    renderScreen(createElement(FinancePeriodsScreen));

    await user.click(screen.getByRole("button", { name: "Lock" }));
    await user.click(screen.getAllByRole("button", { name: "Lock" }).at(-1)!);
    await waitFor(() => expect(submissionOrder).toEqual(["lock-period"]));
    await user.click(screen.getByRole("button", { name: "Close" }));

    await user.click(screen.getByRole("button", { name: "Reopen" }));
    await user.type(screen.getByLabelText("Reason for reopening"), "Correction needed");
    await user.click(screen.getAllByRole("button", { name: "Reopen" }).at(-1)!);

    await waitFor(() =>
      expect(submissionOrder).toEqual(["lock-period", "reopen-period"]),
    );
  });
});
