// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, type ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MeCtx, type MeContext } from "../auth/me.js";
import { sessionStore } from "../auth/store.js";
import { canApproveEntries } from "../finance/permissions.js";
import { i18n } from "../i18n/index.js";
import { FinanceApprovalsScreen } from "./FinanceApprovalsScreen.js";

const mocks = vi.hoisted(() => ({
  createCommandIntent: vi.fn(),
  useApprovals: vi.fn(),
  toastAdd: vi.fn(),
}));

vi.mock("@/components/ui/toast.js", () => ({
  toast: { add: mocks.toastAdd },
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

vi.mock("../finance/FinanceNav.js", () => ({
  FinanceNav: () => null,
}));

const sessionIdentity = { username: "amina", workspaceSlug: "sotrafret" };

const approver: MeContext = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  principalId: "00000000-0000-4000-8000-000000000002",
  principalType: "HUMAN",
  membershipId: "00000000-0000-4000-8000-000000000003",
  role: "FINANCE_APPROVER",
  branchScope: "ALL",
  enabledModules: ["CORE", "FINANCE"],
};

const approvalEntries = [
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
];

function renderScreen(screenNode: ReactNode, client = new QueryClient()) {
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(MeCtx.Provider, { value: approver }, screenNode),
    ),
  );
}

/** Records every key handed to `invalidateQueries` on a real client. */
function recordingClient(): { client: QueryClient; keys: unknown[][] } {
  const client = new QueryClient();
  const keys: unknown[][] = [];
  const original = client.invalidateQueries.bind(client);
  client.invalidateQueries = ((filters?: { queryKey?: unknown[] }) => {
    if (filters?.queryKey !== undefined) keys.push(filters.queryKey);
    return original(filters);
  }) as QueryClient["invalidateQueries"];
  return { client, keys };
}

function mockApprovals() {
  mocks.useApprovals.mockReturnValue({
    data: {
      entries: approvalEntries,
      total: approvalEntries.length,
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
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
  mockApprovals();
  sessionStore.save({
    ...sessionIdentity,
    token: "token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
});

afterEach(() => {
  sessionStore.logout(sessionIdentity);
  cleanup();
});

describe("finance approval command routing", () => {
  it("dispatches approve then reject through their distinct commands and toasts approval success", async () => {
    expect(canApproveEntries(approver.role, approver.enabledModules)).toBe(true);

    const submissionOrder: string[] = [];
    successfulIntentRecorder(submissionOrder);
    const user = userEvent.setup();
    renderScreen(createElement(FinanceApprovalsScreen));

    await user.click(screen.getAllByRole("button", { name: "Approve" })[0]!);
    await user.click(screen.getAllByRole("button", { name: "Approve" }).at(-1)!);
    await waitFor(() => expect(submissionOrder).toEqual(["approve-entry"]));
    expect(mocks.toastAdd).toHaveBeenCalledWith({
      type: "success",
      title: "Entry approved",
    });

    // Both rows are still in the queue: ADR-0001 leaves removal to the server's
    // next answer rather than crossing the approved row off locally.
    await user.click(screen.getAllByRole("button", { name: "Reject" })[0]!);
    await user.type(screen.getByLabelText("Rejection reason"), "Duplicate entry");
    await user.click(screen.getAllByRole("button", { name: "Reject" }).at(-1)!);

    await waitFor(() =>
      expect(submissionOrder).toEqual(["approve-entry", "reject-entry"]),
    );
  });

  it("invalidates only the reads an approval changes, never the whole workspace", async () => {
    successfulIntentRecorder([]);
    const { client, keys } = recordingClient();
    const user = userEvent.setup();
    renderScreen(createElement(FinanceApprovalsScreen), client);

    await user.click(screen.getAllByRole("button", { name: "Approve" })[0]!);
    await user.click(screen.getAllByRole("button", { name: "Approve" }).at(-1)!);

    await waitFor(() => expect(keys.length).toBe(2));
    expect(keys).toEqual([
      ["ws", "sotrafret", "finance", "approvals"],
      ["ws", "sotrafret", "finance", "entries"],
    ]);
  });

  it("keeps reject submit disabled while the reason is empty", async () => {
    const user = userEvent.setup();
    renderScreen(createElement(FinanceApprovalsScreen));

    await user.click(screen.getAllByRole("button", { name: "Reject" })[0]!);

    expect(
      (screen.getAllByRole("button", { name: "Reject" }).at(-1) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("closes on cancel without dispatching a command", async () => {
    const user = userEvent.setup();
    renderScreen(createElement(FinanceApprovalsScreen));

    await user.click(screen.getAllByRole("button", { name: "Reject" })[0]!);
    expect(screen.getByRole("dialog")).toBeDefined();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull(),
    );
    expect(mocks.createCommandIntent).not.toHaveBeenCalled();
  });
});
