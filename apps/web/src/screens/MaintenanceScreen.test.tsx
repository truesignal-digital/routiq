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
import type { UseWorkOrdersParams } from "../maintenance/useMaintenance.js";

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
  useIssues: () => ({
    data: { pages: [{ items: issueRows, nextCursor: null }] },
    isError: false,
    isPending: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    refetch: vi.fn(),
  }),
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
    actualCostMinor: status === "CLOSED" || status === "PENDING_CLOSE" ? 45_000 : null,
    currency: "XAF",
    issue: { id: ISSUE_ID, safetyCritical: true },
    createdAt: "2026-08-01T08:00:00.000Z",
    completedAt: null,
    cancelledAt: null,
    rowVersion: 3,
  };
}

function makeDetail(row: WorkOrderListItem): WorkOrderDetail {
  return {
    ...row,
    summary: null,
    cancelReason: null,
    createdByCommandId: "7777aaaa-0000-4000-8000-000000000007",
    chronologie: [
      {
        eventId: "aaaa0001-0000-4000-8000-000000000001",
        kind: "work_order.opened",
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
  workOrders: [{ id: WORK_ORDER_ID, status: "OPEN" }],
  assetUnavailable: true,
  rowVersion: 1,
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
  me = opsManager;
  workOrderRow = makeWorkOrder("OPEN");
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
      screen.getByRole("button", { name: "maintenance.workOrders.status.CLOSED" }),
    );

    // Filtering client-side would describe the loaded page, not the workshop.
    await waitFor(() => {
      expect(issuedQueries.some((query) => query.status === "CLOSED")).toBe(true);
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
      within(sheet).getByText("history.event.work_order-opened"),
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
  it("offers declare-closure on an approved work order and nothing else", async () => {
    const user = userEvent.setup();
    renderScreen();

    const sheet = await openSheet(user);
    expect(
      within(sheet).getByRole("button", { name: "maintenance.actions.declareClosure" }),
    ).toBeTruthy();
    expect(
      within(sheet).queryByRole("button", { name: "maintenance.actions.approve" }),
    ).toBeNull();
    expect(
      within(sheet).queryByRole("button", { name: "maintenance.actions.release" }),
    ).toBeNull();
  });

  it("offers approve only on a submitted work order, and only to an approver", async () => {
    const user = userEvent.setup();
    workOrderRow = makeWorkOrder("SUBMITTED");
    detail = makeDetail(workOrderRow);
    me = as("FINANCE_APPROVER");
    renderScreen();

    const sheet = await openSheet(user);
    expect(
      within(sheet).getByRole("button", { name: "maintenance.actions.approve" }),
    ).toBeTruthy();
    expect(
      within(sheet).queryByRole("button", {
        name: "maintenance.actions.declareClosure",
      }),
    ).toBeNull();
  });

  it("offers validate-closure only while the closure is pending", async () => {
    const user = userEvent.setup();
    workOrderRow = makeWorkOrder("PENDING_CLOSE");
    detail = makeDetail(workOrderRow);
    me = as("FINANCE_APPROVER");
    renderScreen();

    const sheet = await openSheet(user);
    expect(
      within(sheet).getByRole("button", { name: "maintenance.actions.approveClosure" }),
    ).toBeTruthy();
  });

  it("offers the return to service once the work order is closed", async () => {
    const user = userEvent.setup();
    workOrderRow = makeWorkOrder("CLOSED");
    detail = makeDetail(workOrderRow);
    renderScreen();

    const sheet = await openSheet(user);
    expect(
      within(sheet).getByRole("button", { name: "maintenance.actions.release" }),
    ).toBeTruthy();
    expect(
      within(sheet).queryByRole("button", {
        name: "maintenance.actions.cancelWorkOrder",
      }),
    ).toBeNull();
  });

  it("shows a read-only role no action at all", async () => {
    const user = userEvent.setup();
    me = as("EXECUTIVE_VIEWER");
    renderScreen();

    const sheet = await openSheet(user);
    for (const action of [
      "maintenance.actions.approve",
      "maintenance.actions.declareClosure",
      "maintenance.actions.approveClosure",
      "maintenance.actions.release",
      "maintenance.actions.cancelWorkOrder",
    ]) {
      expect(within(sheet).queryByRole("button", { name: action })).toBeNull();
    }
    // …and no way to open one either.
    expect(
      screen.queryByRole("button", { name: /maintenance.workOrders.new/ }),
    ).toBeNull();
  });
});

describe("MaintenanceScreen — commands", () => {
  it("declares the closure with the row's version quoted", async () => {
    const user = userEvent.setup();
    renderScreen();

    const sheet = await openSheet(user);
    await user.click(
      within(sheet).getByRole("button", { name: "maintenance.actions.declareClosure" }),
    );

    const cost = await screen.findByLabelText("maintenance.fields.actualCost");
    await user.type(cost, "45000");
    await user.click(
      screen.getByRole("button", { name: "maintenance.actions.declareClosure" }),
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
