// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import type {
  IssueListItem,
  WorkOrderDetail,
  WorkOrderListItem,
  WorkOrderStatus,
} from "@routiq/contracts";
import { MeCtx, type MeContext } from "../auth/me.js";
import { sessionStore } from "../auth/store.js";
import { openSelect } from "../test-select.js";
import type {
  UseIssuesParams,
  UseWorkOrdersParams,
} from "../maintenance/useMaintenance.js";

const WORK_ORDER_ID = "1a2b3c4d-0000-4000-8000-000000000001";
const ISSUE_ID = "5e6f7a8b-0000-4000-8000-000000000002";
const ASSET_ID = "9c0d1e2f-0000-4000-8000-000000000003";
const NEW_RECORD_ID = "0000aaaa-0000-4000-8000-00000000000f";
const WORK_ORDER_REFERENCE = "1A2B3C4D";

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  toastAdd: vi.fn(),
}));

vi.mock("@/components/ui/toast.js", () => ({ toast: { add: mocks.toastAdd } }));

vi.mock("../commands/instance.js", () => ({
  commandClient: { submit: mocks.submit },
}));

vi.mock("react-i18next", async () => {
  const actual = await vi.importActual("react-i18next");
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: {
        language: "en",
        resolvedLanguage: "en",
        exists: () => true,
        t: (key: string) => key,
      },
    }),
    initReactI18next: { type: "3rdParty", init: () => {} },
  };
});

vi.mock("../assets/useAssetOptions.js", () => ({
  useAssetOptions: () => [{ value: ASSET_ID, label: "CMR-TR-014" }],
}));

/** One record per distinct query — an unchanged params object is a cache hit. */
const issuedQueries: UseWorkOrdersParams[] = [];
const issuedIssueQueries: UseIssuesParams[] = [];

let workOrderRow: WorkOrderListItem;
let detail: WorkOrderDetail;
let issueRows: IssueListItem[];

vi.mock("../maintenance/useMaintenance.js", () => ({
  maintenanceQueryKey: (slug: string | undefined) => ["ws", slug, "maintenance"],
  useWorkOrders: (params: UseWorkOrdersParams) => {
    const previous = issuedQueries[issuedQueries.length - 1];
    if (previous === undefined || JSON.stringify(previous) !== JSON.stringify(params)) {
      issuedQueries.push(params);
    }
    return {
      data: { pages: [{ items: [workOrderRow], nextCursor: null }] },
      isError: false,
      isPending: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    };
  },
  useIssues: (params: UseIssuesParams = {}) => {
    if (!issuedIssueQueries.some((seen) => JSON.stringify(seen) === JSON.stringify(params))) {
      issuedIssueQueries.push(params);
    }
    return {
      data: { pages: [{ items: issueRows, nextCursor: null }] },
      isError: false,
      isPending: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    };
  },
  useWorkOrder: () => ({
    data: detail,
    isError: false,
    isPending: false,
    refetch: vi.fn(),
  }),
}));

const { MaintenanceScreen } = await import("./MaintenanceScreen.js");

function makeWorkOrder(status: WorkOrderStatus): WorkOrderListItem {
  return {
    id: WORK_ORDER_ID,
    status,
    description: "Remplacement des plaquettes de frein",
    asset: {
      id: ASSET_ID,
      assetCode: "CMR-TR-014",
      registrationNumber: "LT-8842-AB",
    },
    branch: {
      id: "22222222-2222-4222-8222-222222222222",
      code: "DLA",
      name: "Douala",
    },
    expectedCostMinor: 40_000,
    actualCostMinor:
      status === "COMPLETED" || status === "COMPLETION_SUBMITTED" ? 45_000 : null,
    currency: "XAF",
    issue: { id: ISSUE_ID, safetyCritical: true },
    createdAt: "2026-08-01T08:00:00.000Z",
    completedAt: null,
    cancelledAt: null,
    rejectedAt: status === "REJECTED" ? "2026-08-01T10:00:00.000Z" : null,
    rowVersion: 3,
    createdBy: { principalId: null, displayName: null, scope: "WORKSPACE" },
    completedBy: null,
  };
}

function makeDetail(row: WorkOrderListItem): WorkOrderDetail {
  return {
    ...row,
    summary: null,
    cancelReason: null,
    rejectReason: null,
    completionRejectReason: null,
    resolveLinkedIssue: false,
    createdByCommandId: "7777aaaa-0000-4000-8000-000000000007",
    chronologie: [
      {
        eventId: "aaaa0001-0000-4000-8000-000000000001",
        kind: "work_order.created",
        occurredAt: "2026-08-01T08:00:00.000Z",
        actor: {
          principalId: "bbbb0001-0000-4000-8000-000000000001",
          displayName: "Amina Njoya",
          scope: "WORKSPACE",
        },
      },
    ],
    costLines: [
      {
        postingId: "cccc0001-0000-4000-8000-000000000001",
        entryId: "dddd0001-0000-4000-8000-000000000001",
        entryNumber: "DLA-2026-00007",
        description: "Plaquettes avant",
        amountMinor: 45_000,
        currency: "XAF",
        economicDate: "2026-08-02",
        entryStatus: "POSTED",
      },
    ],
    pendingCostLines: [],
  };
}

const issue: IssueListItem = {
  id: ISSUE_ID,
  asset: { id: ASSET_ID, assetCode: "CMR-TR-014", registrationNumber: "LT-8842-AB" },
  branch: {
    id: "22222222-2222-4222-8222-222222222222",
    code: "DLA",
    name: "Douala",
  },
  description: "Freins qui sifflent en descente",
  safetyCritical: true,
  category: "Freinage",
  reportedAt: "2026-07-31T16:30:00.000Z",
  status: "OPEN",
  resolvedAt: null,
  resolutionNote: null,
  dismissedAt: null,
  dismissReason: null,
  workOrders: [{ id: WORK_ORDER_ID, status: "APPROVED" }],
  assetUnavailable: true,
  rowVersion: 2,
};

const opsManager: MeContext = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  principalId: "00000000-0000-4000-8000-000000000002",
  principalType: "HUMAN",
  membershipId: "00000000-0000-4000-8000-000000000003",
  role: "OPS_MANAGER",
  branchScope: "ALL",
  enabledModules: ["CORE", "ASSETS", "MAINTENANCE"],
  enabledPresets: ["TRUCKING"],
};

function as(role: MeContext["role"]): MeContext {
  return { ...opsManager, role };
}

let me: MeContext = opsManager;

function renderScreen(): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    (
      <QueryClientProvider client={queryClient}>
        <MeCtx.Provider value={me}>
          <MaintenanceScreen />
        </MeCtx.Provider>
      </QueryClientProvider>
    ) as ReactNode,
  );
}

/** Opens the row sheet the way an operator does: through the primary cell. */
async function openSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: WORK_ORDER_REFERENCE }));
  return await screen.findByRole("dialog");
}

function submittedPayload(): Record<string, unknown> {
  return mocks.submit.mock.calls[0]?.[0].payload as Record<string, unknown>;
}

function submittedEnvelope(): Record<string, unknown> {
  return mocks.submit.mock.calls[0]?.[0].envelope as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  issuedQueries.length = 0;
  issuedIssueQueries.length = 0;
  me = opsManager;
  workOrderRow = makeWorkOrder("APPROVED");
  detail = makeDetail(workOrderRow);
  issueRows = [issue];
  sessionStore.save({
    username: "amina",
    workspaceSlug: "sotrafret",
    token: "token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  mocks.submit.mockResolvedValue({
    ok: true,
    outcome: {
      commandId: NEW_RECORD_ID,
      recordId: NEW_RECORD_ID,
      rowVersion: 1,
      warnings: [],
      idempotentReplay: false,
    },
  });
});

afterEach(cleanup);

describe("MaintenanceScreen — work order queue", () => {
  it("lists the work orders the read returned", async () => {
    renderScreen();
    expect(await screen.findByText(WORK_ORDER_REFERENCE)).toBeTruthy();
    expect(screen.getAllByText("CMR-TR-014").length).toBeGreaterThan(0);
    expect(screen.getByText("Douala")).toBeTruthy();
    expect(
      screen.getByText("Remplacement des plaquettes de frein"),
    ).toBeTruthy();
  });

  it("asks the server to filter rather than narrowing the loaded page", async () => {
    const user = userEvent.setup();
    renderScreen();
    await screen.findByText(WORK_ORDER_REFERENCE);

    expect(issuedQueries[0]).toEqual({});

    await user.click(
      screen.getByRole("button", { name: "maintenance.workOrders.status.COMPLETED" }),
    );

    // Filtering client-side would describe the loaded page, not the workshop.
    await waitFor(() => {
      expect(issuedQueries.some((query) => query.status === "COMPLETED")).toBe(true);
    });
  });

  it("owns no branch filter: the shell's switcher is the only branch state", async () => {
    renderScreen();
    await screen.findByText(WORK_ORDER_REFERENCE);
    expect(issuedQueries.at(-1)?.branchId).toBeUndefined();
  });
});

describe("MaintenanceScreen — row sheet", () => {
  it("opens the chronologie and the booked costs for the row", async () => {
    const user = userEvent.setup();
    renderScreen();

    const sheet = await openSheet(user);

    expect(within(sheet).getByText("Amina Njoya")).toBeTruthy();
    expect(
      within(sheet).getByText("history.event.work_order-created"),
    ).toBeTruthy();
    expect(within(sheet).getByText("DLA-2026-00007")).toBeTruthy();
    expect(
      within(sheet).getByText("maintenance.detail.entryStatus.POSTED"),
    ).toBeTruthy();
  });

  it("formats XAF as whole units — a 45 000 posting is never divided", async () => {
    const user = userEvent.setup();
    renderScreen();

    const sheet = await openSheet(user);
    // Grouping differs by locale; the digits are what the invariant is about.
    const digits = (sheet.textContent ?? "").replace(/[\s\u00a0\u202f,]/g, "");
    expect(digits).toContain("45000");
    expect(digits).not.toContain("450.00");
  });

  it("names the grounding the linked signalement reports", async () => {
    const user = userEvent.setup();
    renderScreen();

    const sheet = await openSheet(user);
    // Availability is not lifecycle status: the issues read is what publishes it.
    expect(
      within(sheet).getByText("maintenance.detail.unavailableTitle"),
    ).toBeTruthy();
  });
});

describe("MaintenanceScreen — state-driven actions", () => {
  function actionButton(sheet: HTMLElement, key: string) {
    return within(sheet).queryByRole("button", { name: `maintenance.actions.${key}` });
  }

  it("offers completion and cancellation on an approved work order and nothing else", async () => {
    const user = userEvent.setup();
    renderScreen();

    const sheet = await openSheet(user);
    expect(actionButton(sheet, "complete")).toBeTruthy();
    expect(actionButton(sheet, "cancelWorkOrder")).toBeTruthy();
    for (const absent of ["approve", "reject", "approveCompletion", "release"]) {
      expect(actionButton(sheet, absent), absent).toBeNull();
    }
  });

  it("offers approve and reject on a submitted work order, only to an approver", async () => {
    const user = userEvent.setup();
    workOrderRow = makeWorkOrder("SUBMITTED");
    detail = makeDetail(workOrderRow);
    me = as("FINANCE_APPROVER");
    renderScreen();

    const sheet = await openSheet(user);
    expect(actionButton(sheet, "approve")).toBeTruthy();
    expect(actionButton(sheet, "reject")).toBeTruthy();
    expect(actionButton(sheet, "complete")).toBeNull();
    // Cancelling is the workshop's call, not the approver's.
    expect(actionButton(sheet, "cancelWorkOrder")).toBeNull();
  });

  it("lets the workshop cancel a submitted work order but not decide it", async () => {
    const user = userEvent.setup();
    workOrderRow = makeWorkOrder("SUBMITTED");
    detail = makeDetail(workOrderRow);
    renderScreen();

    const sheet = await openSheet(user);
    expect(actionButton(sheet, "cancelWorkOrder")).toBeTruthy();
    expect(actionButton(sheet, "approve")).toBeNull();
    expect(actionButton(sheet, "reject")).toBeNull();
  });

  it("offers approve and reject completion only while the completion is submitted", async () => {
    const user = userEvent.setup();
    workOrderRow = makeWorkOrder("COMPLETION_SUBMITTED");
    detail = makeDetail(workOrderRow);
    me = as("ADMIN");
    renderScreen();

    const sheet = await openSheet(user);
    expect(actionButton(sheet, "approveCompletion")).toBeTruthy();
    expect(actionButton(sheet, "rejectCompletion")).toBeTruthy();
    expect(actionButton(sheet, "cancelWorkOrder")).toBeTruthy();
    expect(actionButton(sheet, "complete")).toBeNull();
  });

  it("offers the return to service once the work order is completed", async () => {
    const user = userEvent.setup();
    workOrderRow = makeWorkOrder("COMPLETED");
    detail = makeDetail(workOrderRow);
    renderScreen();

    const sheet = await openSheet(user);
    expect(actionButton(sheet, "release")).toBeTruthy();
    expect(actionButton(sheet, "cancelWorkOrder")).toBeNull();
  });

  it("offers no return to service when the asset is not grounded", async () => {
    const user = userEvent.setup();
    workOrderRow = makeWorkOrder("COMPLETED");
    detail = makeDetail(workOrderRow);
    issueRows = [{ ...issue, status: "RESOLVED", assetUnavailable: false }];
    renderScreen();

    const sheet = await openSheet(user);
    expect(actionButton(sheet, "release")).toBeNull();
  });

  it("closes the terminal states to every action, even for an admin", async () => {
    const user = userEvent.setup();
    me = as("ADMIN");
    workOrderRow = makeWorkOrder("REJECTED");
    detail = { ...makeDetail(workOrderRow), rejectReason: "Devis trop élevé" };
    renderScreen();

    const sheet = await openSheet(user);
    expect(within(sheet).getByText("Devis trop élevé")).toBeTruthy();
    expect(within(sheet).getByText("maintenance.fields.rejectReason")).toBeTruthy();
    for (const key of [
      "approve",
      "reject",
      "complete",
      "approveCompletion",
      "rejectCompletion",
      "release",
      "cancelWorkOrder",
    ]) {
      expect(actionButton(sheet, key), key).toBeNull();
    }
  });

  it("shows why a completion was sent back on the reopened work order", async () => {
    const user = userEvent.setup();
    detail = {
      ...makeDetail(workOrderRow),
      completionRejectReason: "Facture des disques manquante",
    };
    renderScreen();

    const sheet = await openSheet(user);
    expect(within(sheet).getByText("Facture des disques manquante")).toBeTruthy();
    expect(
      within(sheet).getByText("maintenance.fields.completionRejectReason"),
    ).toBeTruthy();
  });

  it("shows an executive viewer no action anywhere, whatever the status", async () => {
    me = as("EXECUTIVE_VIEWER");
    for (const status of [
      "SUBMITTED",
      "APPROVED",
      "COMPLETION_SUBMITTED",
      "COMPLETED",
    ] as const) {
      const user = userEvent.setup();
      workOrderRow = makeWorkOrder(status);
      detail = makeDetail(workOrderRow);
      renderScreen();

      const sheet = await openSheet(user);
      expect(within(sheet).queryAllByRole("button", { name: /^maintenance\.actions\./ }))
        .toEqual([]);
      cleanup();
    }

    const user = userEvent.setup();
    renderScreen();
    // …no way to open a record either…
    expect(screen.queryByRole("button", { name: /maintenance.workOrders.new/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /maintenance.issues.new/ })).toBeNull();
    // …and no menu on an open signalement.
    await user.click(screen.getByRole("tab", { name: "maintenance.issues.tab" }));
    await screen.findByText("Freins qui sifflent en descente");
    expect(screen.queryByRole("button", { name: "dataTable.actions" })).toBeNull();
  });
});

describe("MaintenanceScreen — row sheet costs", () => {
  it("keeps pending cost lines apart from the posted set", async () => {
    const user = userEvent.setup();
    detail = {
      ...makeDetail(workOrderRow),
      pendingCostLines: [
        {
          postingId: "cccc0002-0000-4000-8000-000000000002",
          entryId: "dddd0002-0000-4000-8000-000000000002",
          entryNumber: "DLA-2026-00009",
          description: "Disques avant",
          amountMinor: 250_000,
          currency: "XAF",
          economicDate: "2026-08-03",
          entryStatus: "SUBMITTED",
        },
      ],
    };
    renderScreen();

    const sheet = await openSheet(user);
    const posted = within(sheet).getByText("maintenance.detail.costLines").parentElement;
    const pending = within(sheet).getByText("maintenance.detail.pendingCostLines")
      .parentElement;
    if (posted === null || pending === null) throw new Error("cost sections missing");

    expect(within(posted).getByText("DLA-2026-00007")).toBeTruthy();
    expect(within(posted).queryByText("DLA-2026-00009")).toBeNull();
    expect(within(pending).getByText("DLA-2026-00009")).toBeTruthy();
    expect(
      within(pending).getByText("maintenance.detail.entryStatus.SUBMITTED"),
    ).toBeTruthy();
    expect(
      within(pending).getByText("maintenance.detail.pendingCostLinesHint"),
    ).toBeTruthy();
  });

  it("shows no pending section when nothing awaits approval", async () => {
    const user = userEvent.setup();
    renderScreen();

    const sheet = await openSheet(user);
    expect(within(sheet).queryByText("maintenance.detail.pendingCostLines")).toBeNull();
  });
});

describe("MaintenanceScreen — commands", () => {
  it("declares completion with the row's version quoted", async () => {
    const user = userEvent.setup();
    renderScreen();

    const sheet = await openSheet(user);
    await user.click(
      within(sheet).getByRole("button", { name: "maintenance.actions.complete" }),
    );

    const cost = await screen.findByLabelText("maintenance.fields.actualCost");
    await user.type(cost, "45000");
    await user.click(
      screen.getByRole("button", { name: "maintenance.actions.complete" }),
    );

    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    expect(mocks.submit.mock.calls[0]?.[0].name).toBe("complete-work-order");
    expect(submittedPayload()).toMatchObject({
      workOrderId: WORK_ORDER_ID,
      currency: "XAF",
      // XAF has exponent 0: 45 000 francs are 45 000 minor units.
      actualCostMinor: 45_000,
    });
    // §5.3 optimistic concurrency — every work-order mutation quotes the version.
    expect(submittedEnvelope()["expectedVersion"]).toBe(3);
  });

  it("resolves the linked signalement by default when completing", async () => {
    const user = userEvent.setup();
    renderScreen();

    const sheet = await openSheet(user);
    await user.click(
      within(sheet).getByRole("button", { name: "maintenance.actions.complete" }),
    );
    await screen.findByLabelText("maintenance.fields.resolveLinkedIssue");
    await user.click(
      screen.getByRole("button", { name: "maintenance.actions.complete" }),
    );

    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    expect(submittedPayload()["resolveLinkedIssue"]).toBe(true);
  });

  it("sends resolveLinkedIssue false when the box is unticked", async () => {
    const user = userEvent.setup();
    renderScreen();

    const sheet = await openSheet(user);
    await user.click(
      within(sheet).getByRole("button", { name: "maintenance.actions.complete" }),
    );
    await user.click(await screen.findByLabelText("maintenance.fields.resolveLinkedIssue"));
    await user.click(
      screen.getByRole("button", { name: "maintenance.actions.complete" }),
    );

    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    expect(submittedPayload()["resolveLinkedIssue"]).toBe(false);
  });

  it("offers no linked-issue box on preventive work", async () => {
    const user = userEvent.setup();
    workOrderRow = { ...makeWorkOrder("APPROVED"), issue: null };
    detail = makeDetail(workOrderRow);
    renderScreen();

    const sheet = await openSheet(user);
    await user.click(
      within(sheet).getByRole("button", { name: "maintenance.actions.complete" }),
    );
    await screen.findByLabelText("maintenance.fields.actualCost");
    expect(screen.queryByLabelText("maintenance.fields.resolveLinkedIssue")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "maintenance.actions.complete" }),
    );

    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    expect("resolveLinkedIssue" in submittedPayload()).toBe(false);
  });

  it("rejects a submitted work order with a reason and the row's version", async () => {
    const user = userEvent.setup();
    workOrderRow = makeWorkOrder("SUBMITTED");
    detail = makeDetail(workOrderRow);
    me = as("FINANCE_APPROVER");
    renderScreen();

    const sheet = await openSheet(user);
    await user.click(
      within(sheet).getByRole("button", { name: "maintenance.actions.reject" }),
    );

    // A refusal must say why: the button stays shut on an empty reason.
    const submit = await screen.findByRole("button", { name: "maintenance.actions.reject" });
    expect(submit.hasAttribute("disabled")).toBe(true);

    await user.type(screen.getByLabelText("maintenance.fields.reason"), "Devis trop élevé");
    await user.click(
      screen.getByRole("button", { name: "maintenance.actions.reject" }),
    );

    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    expect(mocks.submit.mock.calls[0]?.[0].name).toBe("reject-work-order");
    expect(submittedPayload()).toEqual({
      workOrderId: WORK_ORDER_ID,
      reason: "Devis trop élevé",
    });
    expect(submittedEnvelope()["expectedVersion"]).toBe(3);
  });

  it("sends a submitted completion back with a reason", async () => {
    const user = userEvent.setup();
    workOrderRow = makeWorkOrder("COMPLETION_SUBMITTED");
    detail = makeDetail(workOrderRow);
    me = as("FINANCE_APPROVER");
    renderScreen();

    const sheet = await openSheet(user);
    await user.click(
      within(sheet).getByRole("button", { name: "maintenance.actions.rejectCompletion" }),
    );
    await user.type(
      await screen.findByLabelText("maintenance.fields.reason"),
      "Facture manquante",
    );
    await user.click(
      screen.getByRole("button", { name: "maintenance.actions.rejectCompletion" }),
    );

    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    expect(mocks.submit.mock.calls[0]?.[0].name).toBe("reject-work-order-completion");
    expect(submittedPayload()).toEqual({
      workOrderId: WORK_ORDER_ID,
      reason: "Facture manquante",
    });
    expect(submittedEnvelope()["expectedVersion"]).toBe(3);
  });

  it("approves a submitted completion under the closure command's wire name", async () => {
    const user = userEvent.setup();
    workOrderRow = makeWorkOrder("COMPLETION_SUBMITTED");
    detail = makeDetail(workOrderRow);
    me = as("FINANCE_APPROVER");
    renderScreen();

    const sheet = await openSheet(user);
    await user.click(
      within(sheet).getByRole("button", { name: "maintenance.actions.approveCompletion" }),
    );
    await screen.findByLabelText("maintenance.fields.note");
    await user.click(
      screen.getByRole("button", { name: "maintenance.actions.approveCompletion" }),
    );

    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    expect(mocks.submit.mock.calls[0]?.[0].name).toBe("approve-work-order-closure");
    expect(submittedPayload()).toEqual({ workOrderId: WORK_ORDER_ID });
    expect(submittedEnvelope()["expectedVersion"]).toBe(3);
  });

  it("releases the asset on the completed work order it cites", async () => {
    const user = userEvent.setup();
    workOrderRow = makeWorkOrder("COMPLETED");
    detail = makeDetail(workOrderRow);
    renderScreen();

    const sheet = await openSheet(user);
    await user.click(
      within(sheet).getByRole("button", { name: "maintenance.actions.release" }),
    );
    await screen.findByLabelText("maintenance.fields.note");
    await user.click(
      screen.getByRole("button", { name: "maintenance.actions.release" }),
    );

    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    expect(mocks.submit.mock.calls[0]?.[0].name).toBe("release-asset-to-service");
    expect(submittedPayload()).toEqual({ assetId: ASSET_ID, workOrderId: WORK_ORDER_ID });
    expect(submittedEnvelope()["expectedVersion"]).toBe(3);
  });

  it("moves the header onto the refetched detail once completion is declared", async () => {
    const user = userEvent.setup();
    // Only the detail read learns the work order completed: the table handed
    // the drawer a row snapshot when it opened and never revises it, so a header
    // still bound to that snapshot would keep showing "Approuvé" and no cost.
    mocks.submit.mockImplementation(async () => {
      detail = {
        ...makeDetail(makeWorkOrder("COMPLETED")),
        actualCostMinor: 485_000,
        summary: "Plaquettes et disques remplacés",
      };
      return {
        ok: true,
        outcome: {
          commandId: NEW_RECORD_ID,
          recordId: WORK_ORDER_ID,
          rowVersion: 4,
          warnings: [],
          idempotentReplay: false,
        },
      };
    });

    renderScreen();
    const sheet = await openSheet(user);
    expect(
      within(sheet).getByText("maintenance.workOrders.status.APPROVED"),
    ).toBeTruthy();

    await user.click(
      within(sheet).getByRole("button", { name: "maintenance.actions.complete" }),
    );
    await user.type(
      await screen.findByLabelText("maintenance.fields.actualCost"),
      "485000",
    );
    await user.click(
      screen.getByRole("button", { name: "maintenance.actions.complete" }),
    );

    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());

    const reopened = await screen.findByRole("dialog");
    await waitFor(() => {
      expect(
        within(reopened).getByText("maintenance.workOrders.status.COMPLETED"),
      ).toBeTruthy();
    });
    expect(
      within(reopened).queryByText("maintenance.workOrders.status.APPROVED"),
    ).toBeNull();

    const digits = (reopened.textContent ?? "").replace(/[\s  ,]/g, "");
    expect(digits).toContain("485000");
    expect(within(reopened).getByText("Plaquettes et disques remplacés")).toBeTruthy();

    // The list row the table still holds is the stale copy — proof the header
    // is reading the detail rather than the snapshot beside it.
    expect(workOrderRow.status).toBe("APPROVED");
    expect(workOrderRow.actualCostMinor).toBeNull();
  });

  it("reports a signalement as safety-critical when the box is ticked", async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(
      await screen.findByRole("button", { name: /maintenance.issues.new/ }),
    );

    await openSelect(
      user,
      await screen.findByRole("combobox", { name: "maintenance.fields.asset" }),
    );
    await user.keyboard("{ArrowDown}{Enter}");
    await user.type(
      screen.getByLabelText("maintenance.fields.description"),
      "Freins qui sifflent",
    );
    await user.click(screen.getByLabelText("maintenance.fields.safetyCritical"));
    await user.click(
      screen.getByRole("button", { name: "maintenance.issues.newSubmit" }),
    );

    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    expect(mocks.submit.mock.calls[0]?.[0].name).toBe("report-issue");
    expect(submittedPayload()).toMatchObject({
      assetId: ASSET_ID,
      description: "Freins qui sifflent",
      safetyCritical: true,
    });
    // Client-generated so the same signalement can be captured offline (§6).
    expect(typeof submittedPayload()["issueId"]).toBe("string");
  });
});

describe("MaintenanceScreen — signalements tab", () => {
  it("lists issues with their safety and availability state", async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole("tab", { name: "maintenance.issues.tab" }));

    expect(
      await screen.findByText("Freins qui sifflent en descente"),
    ).toBeTruthy();
    expect(screen.getByText("Freinage")).toBeTruthy();
    expect(screen.getAllByText("maintenance.issues.safetyCritical").length).toBeGreaterThan(0);
    expect(screen.getByText("maintenance.issues.unavailable")).toBeTruthy();
  });

  it("opens the work-order form prefilled from a signalement row", async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole("tab", { name: "maintenance.issues.tab" }));
    await screen.findByText("Freins qui sifflent en descente");

    await user.click(screen.getByRole("button", { name: "dataTable.actions" }));
    await user.click(
      await screen.findByRole("menuitem", {
        name: "maintenance.issues.createWorkOrder",
      }),
    );

    // Both references are fixed by the row, so neither field can contradict it.
    const asset = await screen.findByRole("combobox", {
      name: "maintenance.fields.asset",
    });
    expect(asset.getAttribute("data-disabled")).not.toBeNull();
    await user.type(
      screen.getByLabelText("maintenance.fields.description"),
      "Changer les plaquettes",
    );
    await user.click(
      screen.getByRole("button", { name: "maintenance.workOrders.newSubmit" }),
    );

    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    expect(mocks.submit.mock.calls[0]?.[0].name).toBe("create-work-order");
    expect(submittedPayload()).toMatchObject({
      assetId: ASSET_ID,
      issueId: ISSUE_ID,
      description: "Changer les plaquettes",
    });
  });

  it("shows each signalement's status and why it was closed", async () => {
    const user = userEvent.setup();
    issueRows = [
      {
        ...issue,
        status: "DISMISSED",
        dismissedAt: "2026-08-01T09:00:00.000Z",
        dismissReason: "Doublon du signalement de lundi",
      },
    ];
    renderScreen();

    await user.click(screen.getByRole("tab", { name: "maintenance.issues.tab" }));
    await screen.findByText("Freins qui sifflent en descente");
    expect(screen.getAllByText("maintenance.issues.status.DISMISSED").length).toBeGreaterThan(1);
    expect(screen.getByText("Doublon du signalement de lundi")).toBeTruthy();
    // A closed signalement has nothing left to decide.
    expect(screen.queryByRole("button", { name: "dataTable.actions" })).toBeNull();
  });

  it("asks the server to filter signalements by status", async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole("tab", { name: "maintenance.issues.tab" }));
    await user.click(
      await screen.findByRole("button", { name: "maintenance.issues.status.OPEN" }),
    );

    await waitFor(() => {
      expect(issuedIssueQueries.some((query) => query.status === "OPEN")).toBe(true);
    });
    // The sheet's lookup stays unfiltered: a closed signalement still names the grounding.
    expect(issuedIssueQueries.some((query) => query.status === undefined)).toBe(true);
  });

  it("says the filter found nothing rather than claiming a first run", async () => {
    const user = userEvent.setup();
    issueRows = [];
    renderScreen();

    await user.click(screen.getByRole("tab", { name: "maintenance.issues.tab" }));
    await user.click(
      await screen.findByRole("button", { name: "maintenance.issues.status.DISMISSED" }),
    );

    expect(await screen.findByText("maintenance.issues.filteredEmpty")).toBeTruthy();
    expect(screen.queryByText("maintenance.issues.emptyHint")).toBeNull();
  });

  async function openIssueAction(
    user: ReturnType<typeof userEvent.setup>,
    name: string,
  ): Promise<void> {
    await user.click(screen.getByRole("tab", { name: "maintenance.issues.tab" }));
    await screen.findByText("Freins qui sifflent en descente");
    await user.click(screen.getByRole("button", { name: "dataTable.actions" }));
    await user.click(await screen.findByRole("menuitem", { name }));
  }

  it("resolves an open signalement with an optional note and its version", async () => {
    const user = userEvent.setup();
    renderScreen();

    await openIssueAction(user, "maintenance.actions.resolveIssue");
    await user.type(
      await screen.findByLabelText("maintenance.fields.note"),
      "Collier resserré sur place",
    );
    await user.click(
      screen.getByRole("button", { name: "maintenance.actions.resolveIssue" }),
    );

    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    expect(mocks.submit.mock.calls[0]?.[0].name).toBe("resolve-issue");
    expect(submittedPayload()).toEqual({
      issueId: ISSUE_ID,
      note: "Collier resserré sur place",
    });
    expect(submittedEnvelope()["expectedVersion"]).toBe(2);
  });

  it("resolves without a note when none is given", async () => {
    const user = userEvent.setup();
    renderScreen();

    await openIssueAction(user, "maintenance.actions.resolveIssue");
    await screen.findByLabelText("maintenance.fields.note");
    await user.click(
      screen.getByRole("button", { name: "maintenance.actions.resolveIssue" }),
    );

    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    expect(submittedPayload()).toEqual({ issueId: ISSUE_ID });
  });

  it("dismisses an open signalement only with a reason", async () => {
    const user = userEvent.setup();
    renderScreen();

    await openIssueAction(user, "maintenance.actions.dismissIssue");
    const submit = await screen.findByRole("button", {
      name: "maintenance.actions.dismissIssue",
    });
    expect(submit.hasAttribute("disabled")).toBe(true);

    await user.type(screen.getByLabelText("maintenance.fields.reason"), "Rien constaté");
    await user.click(
      screen.getByRole("button", { name: "maintenance.actions.dismissIssue" }),
    );

    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    expect(mocks.submit.mock.calls[0]?.[0].name).toBe("dismiss-issue");
    expect(submittedPayload()).toEqual({ issueId: ISSUE_ID, reason: "Rien constaté" });
    expect(submittedEnvelope()["expectedVersion"]).toBe(2);
  });

  it("lets a field submitter resolve a signalement but not dismiss it", async () => {
    const user = userEvent.setup();
    me = as("FIELD_SUBMITTER");
    renderScreen();

    await user.click(screen.getByRole("tab", { name: "maintenance.issues.tab" }));
    await screen.findByText("Freins qui sifflent en descente");
    await user.click(screen.getByRole("button", { name: "dataTable.actions" }));

    expect(
      await screen.findByRole("menuitem", { name: "maintenance.actions.resolveIssue" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("menuitem", { name: "maintenance.actions.dismissIssue" }),
    ).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: "maintenance.issues.createWorkOrder" }),
    ).toBeNull();
  });
});

describe("MaintenanceScreen — module gate", () => {
  it("shows a denied surface when the module is off", async () => {
    me = { ...opsManager, enabledModules: ["CORE", "ASSETS"] };
    renderScreen();

    expect(await screen.findByText("maintenance.title")).toBeTruthy();
    expect(screen.queryByText(WORK_ORDER_REFERENCE)).toBeNull();
    expect(screen.queryByRole("tab", { name: "maintenance.issues.tab" })).toBeNull();
  });
});
