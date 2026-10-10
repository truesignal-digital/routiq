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
import { applyNavigate, useTestSearch } from "../test-router.js";

const WORK_ORDER_ID = "1a2b3c4d-0000-4000-8000-000000000001";
const ISSUE_ID = "5e6f7a8b-0000-4000-8000-000000000002";
const ASSET_ID = "9c0d1e2f-0000-4000-8000-000000000003";
const NEW_RECORD_ID = "0000aaaa-0000-4000-8000-00000000000f";
/** This suite's `t` returns keys: the work order's number renders as its catalog key (#608). */
const WORK_ORDER_REFERENCE = "common.recordNumber.workOrder";

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  toastAdd: vi.fn(),
  language: "en",
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => applyNavigate,
  useSearch: () => useTestSearch(),
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
      // Command labels pass fallback keys; every key "exists" here, so the first wins.
      t: (key: string | string[]) => (Array.isArray(key) ? key[0] : key),
      i18n: {
        language: mocks.language,
        resolvedLanguage: mocks.language,
        exists: () => true,
        t: (key: string) => key,
      },
    }),
    initReactI18next: { type: "3rdParty", init: () => {} },
  };
});

// The workspace's ISSUE_TYPE list: a category travels as its code and reads
// back as the label in the viewer's language.
vi.mock("../categories/useCategories.js", async () => {
  const actual = await vi.importActual<typeof import("../categories/useCategories.js")>(
    "../categories/useCategories.js",
  );
  return {
    ...actual,
    useCategories: (kind: string, enabled?: boolean) =>
      kind === "ISSUE_TYPE"
        ? {
            data: [
              { code: "BRAKES", labelFr: "Freins", labelEn: "Brakes", defaultSafetyCritical: true },
              { code: "BODYWORK", labelFr: "Carrosserie", labelEn: "Bodywork", defaultSafetyCritical: false },
            ],
            isPending: false,
            isError: false,
          }
        : actual.useCategories(kind, enabled),
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
  useMaintenanceSummary: () => ({
    data: {
      openIssues: 2,
      openSafetyCritical: 1,
      grounded: 1,
      approvedWorkOrders: 1,
      averageRepairDays: 3.5,
      repairsCounted: 4,
      repairWindowDays: 90,
    },
    isPending: false,
    isError: false,
  }),
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
    number: 7,
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
    declaredCostMinor: null,
    costOutcome: status === "COMPLETED" || status === "COMPLETION_SUBMITTED" ? "LINES" : null,
    costToCome: null,
    currency: "XAF",
    issue: { id: ISSUE_ID, number: 3, safetyCritical: true },
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
        note: null,
        noteCode: null,
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
    otherBranchesCostMinor: 0,
  };
}

const issue: IssueListItem = {
  id: ISSUE_ID,
  number: 3,
  asset: { id: ASSET_ID, assetCode: "CMR-TR-014", registrationNumber: "LT-8842-AB" },
  branch: {
    id: "22222222-2222-4222-8222-222222222222",
    code: "DLA",
    name: "Douala",
  },
  description: "Freins qui sifflent en descente",
  safetyCritical: true,
  category: "BRAKES",
  reportedAt: "2026-07-31T16:30:00.000Z",
  status: "OPEN",
  resolvedAt: null,
  resolutionNote: null,
  dismissedAt: null,
  dismissReason: null,
  workOrders: [{ id: WORK_ORDER_ID, number: 7, status: "APPROVED" }],
  assetUnavailable: true,
  rowVersion: 2,
};

const admin: MeContext = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  principalId: "00000000-0000-4000-8000-000000000002",
  principalType: "HUMAN",
  membershipId: "00000000-0000-4000-8000-000000000003",
  displayName: "Sali Ahmadou",
  workspaceName: "Transports Ngwa",
  role: "ADMIN",
  branchScope: "ALL",
  enabledModules: ["CORE", "ASSETS", "MAINTENANCE"],
  enabledPresets: ["TRUCKING"],
  timezone: "Africa/Douala",
};

function as(role: MeContext["role"]): MeContext {
  return { ...admin, role };
}

let me: MeContext = admin;

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
  me = admin;
  mocks.language = "en";
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
      screen.getByRole("radio", { name: "maintenance.workOrders.status.COMPLETED" }),
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

describe("MaintenanceScreen — cost columns", () => {
  const headers = async () => {
    await screen.findByText(WORK_ORDER_REFERENCE);
    return screen.getAllByRole("columnheader").map((header) => header.textContent);
  };

  it("shows Expected and Actual cost while FINANCE is on", async () => {
    me = { ...admin, enabledModules: [...admin.enabledModules, "FINANCE"] };
    renderScreen();
    expect(await headers()).toEqual(
      expect.arrayContaining([
        "maintenance.workOrders.columns.expectedCost",
        "maintenance.workOrders.columns.actualCost",
      ]),
    );
  });

  it("drops the Actual cost column while FINANCE is off, keeping the estimate (#640)", async () => {
    workOrderRow = { ...makeWorkOrder("COMPLETED"), actualCostMinor: null, costOutcome: null };
    renderScreen();
    const shown = await headers();
    expect(shown).toContain("maintenance.workOrders.columns.expectedCost");
    expect(shown).not.toContain("maintenance.workOrders.columns.actualCost");
    expect(screen.queryByText(/not recorded|notRecorded/i)).toBeNull();
  });

  it("drops both cost columns for a driver, who reads no work-order money (#390)", async () => {
    me = { ...as("DRIVER"), enabledModules: [...admin.enabledModules, "FINANCE"] };
    workOrderRow = { ...makeWorkOrder("APPROVED"), expectedCostMinor: null };
    renderScreen();
    const shown = await headers();
    expect(shown).not.toContain("maintenance.workOrders.columns.expectedCost");
    expect(shown).not.toContain("maintenance.workOrders.columns.actualCost");
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
      within(sheet).getByText("finance.entries.status.POSTED"),
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
  function actionButton(sheet: HTMLElement, command: string) {
    return within(sheet).queryByRole("button", { name: `commands.${command}.label` });
  }

  it("offers completion and cancellation on an approved work order and nothing else", async () => {
    const user = userEvent.setup();
    renderScreen();

    const sheet = await openSheet(user);
    expect(actionButton(sheet, "complete-work-order")).toBeTruthy();
    expect(actionButton(sheet, "cancel-work-order")).toBeTruthy();
    for (const absent of [
      "approve-work-order",
      "reject-work-order",
      "approve-work-order-closure",
      "release-asset-to-service",
    ]) {
      expect(actionButton(sheet, absent), absent).toBeNull();
    }
  });

  it.each(["DIRECTOR", "ADMIN"] as const)(
    "offers approve and reject on a submitted work order to %s",
    async (role) => {
      const user = userEvent.setup();
      workOrderRow = makeWorkOrder("SUBMITTED");
      detail = makeDetail(workOrderRow);
      me = as(role);
      renderScreen();

      const sheet = await openSheet(user);
      expect(actionButton(sheet, "approve-work-order")).toBeTruthy();
      expect(actionButton(sheet, "reject-work-order")).toBeTruthy();
      expect(actionButton(sheet, "complete-work-order")).toBeNull();
    },
  );

  it("offers Finance no work-order decision", async () => {
    const user = userEvent.setup();
    workOrderRow = makeWorkOrder("SUBMITTED");
    detail = makeDetail(workOrderRow);
    me = as("FINANCE");
    renderScreen();

    const sheet = await openSheet(user);
    expect(actionButton(sheet, "approve-work-order")).toBeNull();
    expect(actionButton(sheet, "reject-work-order")).toBeNull();
    expect(actionButton(sheet, "cancel-work-order")).toBeNull();
  });

  it("lets the workshop cancel a submitted work order but not decide it", async () => {
    const user = userEvent.setup();
    workOrderRow = makeWorkOrder("SUBMITTED");
    detail = makeDetail(workOrderRow);
    me = as("TECHNICIAN");
    renderScreen();

    const sheet = await openSheet(user);
    expect(actionButton(sheet, "cancel-work-order")).toBeTruthy();
    expect(actionButton(sheet, "approve-work-order")).toBeNull();
    expect(actionButton(sheet, "reject-work-order")).toBeNull();
  });

  it("offers approve and reject completion only while the completion is submitted", async () => {
    const user = userEvent.setup();
    workOrderRow = makeWorkOrder("COMPLETION_SUBMITTED");
    detail = makeDetail(workOrderRow);
    me = as("ADMIN");
    renderScreen();

    const sheet = await openSheet(user);
    expect(actionButton(sheet, "approve-work-order-closure")).toBeTruthy();
    expect(actionButton(sheet, "reject-work-order-completion")).toBeTruthy();
    expect(actionButton(sheet, "cancel-work-order")).toBeTruthy();
    expect(actionButton(sheet, "complete-work-order")).toBeNull();
  });

  it("offers the return to service once the work order is completed", async () => {
    const user = userEvent.setup();
    workOrderRow = makeWorkOrder("COMPLETED");
    detail = makeDetail(workOrderRow);
    renderScreen();

    const sheet = await openSheet(user);
    expect(actionButton(sheet, "release-asset-to-service")).toBeTruthy();
    expect(actionButton(sheet, "cancel-work-order")).toBeNull();
  });

  it("offers no return to service when the asset is not grounded", async () => {
    const user = userEvent.setup();
    workOrderRow = makeWorkOrder("COMPLETED");
    detail = makeDetail(workOrderRow);
    issueRows = [{ ...issue, status: "RESOLVED", assetUnavailable: false }];
    renderScreen();

    const sheet = await openSheet(user);
    expect(actionButton(sheet, "release-asset-to-service")).toBeNull();
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
      "approve-work-order",
      "reject-work-order",
      "complete-work-order",
      "approve-work-order-closure",
      "reject-work-order-completion",
      "release-asset-to-service",
      "cancel-work-order",
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

  it("shows the counter no action anywhere, whatever the status", async () => {
    me = as("CASHIER");
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
      expect(within(sheet).queryAllByRole("button", { name: /^commands\./ }))
        .toEqual([]);
      cleanup();
    }

    const user = userEvent.setup();
    renderScreen();
    // …no way to open a record either…
    expect(screen.queryByRole("button", { name: "commands.create-work-order.label" })).toBeNull();
    expect(screen.queryByRole("button", { name: "commands.report-issue.label" })).toBeNull();
    // …and no menu on an open signalement.
    await user.click(screen.getByRole("tab", { name: "maintenance.issues.tab" }));
    await screen.findByText("Freins qui sifflent en descente");
    expect(screen.queryByRole("button", { name: "dataTable.actions" })).toBeNull();
  });
});

describe("MaintenanceScreen — row sheet costs", () => {
  it("lists pending lines in Costs, marked awaiting review, so the list adds up to Actual cost (#642)", async () => {
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
    const costs = within(sheet).getByText("maintenance.detail.costLines").parentElement;
    if (costs === null) throw new Error("cost section missing");

    expect(within(costs).getByText("DLA-2026-00007")).toBeTruthy();
    expect(within(costs).getByText("DLA-2026-00009")).toBeTruthy();
    expect(within(costs).getByText("finance.entries.status.SUBMITTED")).toBeTruthy();
    // No second section telling the reader these are not counted.
    expect(within(sheet).queryByText("maintenance.detail.pendingCostLines")).toBeNull();
    expect(within(sheet).queryByText("maintenance.detail.pendingCostLinesHint")).toBeNull();
  });

  it("sums the lines booked in other branches into one line, without their details (#643)", async () => {
    const user = userEvent.setup();
    detail = { ...makeDetail(workOrderRow), otherBranchesCostMinor: 12_000 };
    renderScreen();

    const sheet = await openSheet(user);
    const costs = within(sheet).getByText("maintenance.detail.costLines").parentElement;
    if (costs === null) throw new Error("cost section missing");
    const other = within(costs).getByText("maintenance.detail.otherBranchesCost").closest("li");
    if (other === null) throw new Error("other-branches line missing");
    expect((other.textContent ?? "").replace(/[\s\u00a0\u202f,]/g, "")).toContain("12000");
  });

  it("shows no other-branches line when every line is the reader's", async () => {
    const user = userEvent.setup();
    renderScreen();

    const sheet = await openSheet(user);
    expect(within(sheet).queryByText("maintenance.detail.otherBranchesCost")).toBeNull();
  });

  it("keeps the estimate in the sheet while FINANCE is off, and drops the actual cost (#640)", async () => {
    const user = userEvent.setup();
    workOrderRow = { ...makeWorkOrder("COMPLETED"), actualCostMinor: null, costOutcome: null };
    detail = { ...makeDetail(workOrderRow), costLines: null, pendingCostLines: null, otherBranchesCostMinor: null };
    renderScreen();

    const sheet = await openSheet(user);
    expect(within(sheet).getByText("maintenance.workOrders.columns.expectedCost")).toBeTruthy();
    expect((sheet.textContent ?? "").replace(/[\s\u00a0\u202f,]/g, "")).toContain("40000");
    expect(within(sheet).queryByText("maintenance.workOrders.columns.actualCost")).toBeNull();
    expect(within(sheet).queryByText("maintenance.detail.costLines")).toBeNull();
  });

  it("shows a driver no cost facts and no cost sections when the server withholds the money (#390)", async () => {
    const user = userEvent.setup();
    me = as("DRIVER");
    workOrderRow = { ...makeWorkOrder("COMPLETED"), expectedCostMinor: null, actualCostMinor: null };
    detail = { ...makeDetail(workOrderRow), costLines: null, pendingCostLines: null, otherBranchesCostMinor: null };
    renderScreen();

    const sheet = await openSheet(user);
    // Withheld is not "not recorded": the cost facts are left out (#306).
    expect(within(sheet).queryByText("maintenance.workOrders.columns.expectedCost")).toBeNull();
    expect(within(sheet).queryByText("maintenance.workOrders.columns.actualCost")).toBeNull();
    expect(within(sheet).queryByText("maintenance.detail.costLines")).toBeNull();
    expect(within(sheet).queryByText("maintenance.detail.costLinesEmpty")).toBeNull();
    expect(within(sheet).queryByText("maintenance.detail.pendingCostLines")).toBeNull();
  });

});

describe("MaintenanceScreen — commands", () => {
  it("opens Complete work order in the side panel at the Line items width (#296)", async () => {
    const user = userEvent.setup();
    renderScreen();

    const sheet = await openSheet(user);
    await user.click(
      within(sheet).getByRole("button", { name: "commands.complete-work-order.label" }),
    );

    const panel = await screen.findByRole("dialog", { name: "commands.complete-work-order.label" });
    expect(panel.getAttribute("data-slot")).toBe("sheet-content");
    expect(panel.className).toContain("sm:max-w-[560px]");
  });

  it("declares completion with the row's version quoted", async () => {
    const user = userEvent.setup();
    renderScreen();

    const sheet = await openSheet(user);
    await user.click(
      within(sheet).getByRole("button", { name: "commands.complete-work-order.label" }),
    );

    // The 45 000 already booked against the order is shown first, and
    // "nothing more" is the default: the close adds no line.
    expect(await screen.findByText("maintenance.close.recorded")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "maintenance.close.nothingMore" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    await user.click(
      screen.getByRole("button", { name: "commands.complete-work-order.submit" }),
    );

    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    expect(mocks.submit.mock.calls[0]?.[0]).toMatchObject({
      name: "complete-work-order",
      version: 2,
    });
    expect(submittedPayload()).toMatchObject({
      workOrderId: WORK_ORDER_ID,
      currency: "XAF",
      costOutcome: "LINES",
      costLines: [],
    });
    expect("actualCostMinor" in submittedPayload()).toBe(false);
    // §5.3 optimistic concurrency — every work-order mutation quotes the version.
    expect(submittedEnvelope()["expectedVersion"]).toBe(3);
  });

  it("resolves the linked signalement by default when completing", async () => {
    const user = userEvent.setup();
    renderScreen();

    const sheet = await openSheet(user);
    await user.click(
      within(sheet).getByRole("button", { name: "commands.complete-work-order.label" }),
    );
    await screen.findByLabelText("maintenance.fields.resolveLinkedIssue");
    await user.click(
      screen.getByRole("button", { name: "commands.complete-work-order.submit" }),
    );

    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    expect(submittedPayload()["resolveLinkedIssue"]).toBe(true);
  });

  it("sends resolveLinkedIssue false when the box is unticked", async () => {
    const user = userEvent.setup();
    renderScreen();

    const sheet = await openSheet(user);
    await user.click(
      within(sheet).getByRole("button", { name: "commands.complete-work-order.label" }),
    );
    await user.click(await screen.findByLabelText("maintenance.fields.resolveLinkedIssue"));
    await user.click(
      screen.getByRole("button", { name: "commands.complete-work-order.submit" }),
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
      within(sheet).getByRole("button", { name: "commands.complete-work-order.label" }),
    );
    await screen.findByText("maintenance.close.recorded");
    expect(screen.queryByLabelText("maintenance.fields.resolveLinkedIssue")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "commands.complete-work-order.submit" }),
    );

    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    expect("resolveLinkedIssue" in submittedPayload()).toBe(false);
  });

  it("rejects a submitted work order with a reason and the row's version", async () => {
    const user = userEvent.setup();
    workOrderRow = makeWorkOrder("SUBMITTED");
    detail = makeDetail(workOrderRow);
    me = as("ADMIN");
    renderScreen();

    const sheet = await openSheet(user);
    await user.click(
      within(sheet).getByRole("button", { name: "commands.reject-work-order.label" }),
    );

    // A refusal must say why: the button stays shut on an empty reason.
    const submit = await screen.findByRole("button", { name: "commands.reject-work-order.submit" });
    expect(submit.hasAttribute("disabled")).toBe(true);

    await user.type(screen.getByRole("textbox", { name: "maintenance.fields.reason" }), "Devis trop élevé");
    await user.click(
      screen.getByRole("button", { name: "commands.reject-work-order.submit" }),
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
    me = as("ADMIN");
    renderScreen();

    const sheet = await openSheet(user);
    await user.click(
      within(sheet).getByRole("button", { name: "commands.reject-work-order-completion.label" }),
    );
    await user.type(
      await screen.findByRole("textbox", { name: "maintenance.fields.reason" }),
      "Facture manquante",
    );
    await user.click(
      screen.getByRole("button", { name: "commands.reject-work-order-completion.submit" }),
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
    me = as("ADMIN");
    renderScreen();

    const sheet = await openSheet(user);
    await user.click(
      within(sheet).getByRole("button", { name: "commands.approve-work-order-closure.label" }),
    );
    await screen.findByLabelText("maintenance.fields.note");
    await user.click(
      screen.getByRole("button", { name: "commands.approve-work-order-closure.submit" }),
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
      within(sheet).getByRole("button", { name: "commands.release-asset-to-service.label" }),
    );
    await screen.findByLabelText("maintenance.fields.note");
    await user.click(
      screen.getByRole("button", { name: "commands.release-asset-to-service.submit" }),
    );

    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    expect(mocks.submit.mock.calls[0]?.[0].name).toBe("release-asset-to-service");
    expect(submittedPayload()).toEqual({ assetId: ASSET_ID, workOrderId: WORK_ORDER_ID });
    expect(submittedEnvelope()["expectedVersion"]).toBe(3);
  });

  it("moves the header onto the refetched detail once completion is declared", async () => {
    const user = userEvent.setup();
    // The actual cost is Finance's figure: on screen only while FINANCE is on (#640).
    me = { ...admin, enabledModules: [...admin.enabledModules, "FINANCE"] };
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
      within(sheet).getByRole("button", { name: "commands.complete-work-order.label" }),
    );
    await screen.findByText("maintenance.close.recorded");
    await user.click(
      screen.getByRole("button", { name: "commands.complete-work-order.submit" }),
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
      await screen.findByRole("button", { name: "commands.report-issue.label" }),
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
      screen.getByRole("button", { name: "commands.report-issue.submit" }),
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

  it("opens Report a problem in the side panel, as the vehicle does (#296)", async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(
      await screen.findByRole("button", { name: "commands.report-issue.label" }),
    );

    const panel = await screen.findByRole("dialog", { name: "commands.report-issue.label" });
    expect(panel.getAttribute("data-slot")).toBe("sheet-content");
    expect(panel.className).toContain("sm:max-w-[440px]");
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
    expect(screen.getByText("Brakes")).toBeTruthy();
    expect(screen.getAllByText("maintenance.issues.safetyCritical").length).toBeGreaterThan(0);
    expect(screen.getByText("maintenance.issues.unavailable")).toBeTruthy();
  });

  it.each([
    ["en", "Bodywork"],
    ["fr", "Carrosserie"],
  ])("shows the category's label in %s, never its code", async (language, label) => {
    mocks.language = language;
    issueRows = [{ ...issue, category: "BODYWORK" }];
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole("tab", { name: "maintenance.issues.tab" }));

    expect(await screen.findByText(label)).toBeTruthy();
    expect(screen.queryByText("BODYWORK")).toBeNull();
  });

  it("opens the work-order form prefilled from a signalement row", async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole("tab", { name: "maintenance.issues.tab" }));
    await screen.findByText("Freins qui sifflent en descente");

    await user.click(screen.getByRole("button", { name: "dataTable.actions" }));
    await user.click(
      await screen.findByRole("menuitem", {
        name: "commands.create-work-order.label",
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
    // The expected cost is required: the approval threshold is read against it.
    const submitButton = screen.getByRole("button", {
      name: "commands.create-work-order.submit",
    });
    expect(submitButton.hasAttribute("disabled")).toBe(true);
    await user.type(screen.getByLabelText("maintenance.fields.expectedCost"), "45000");
    await user.click(submitButton);

    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    expect(mocks.submit.mock.calls[0]?.[0].name).toBe("create-work-order");
    expect(submittedPayload()).toMatchObject({
      assetId: ASSET_ID,
      issueId: ISSUE_ID,
      description: "Changer les plaquettes",
      expectedCostMinor: 45_000,
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
      await screen.findByRole("radio", { name: "maintenance.issues.status.OPEN" }),
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
      await screen.findByRole("radio", { name: "maintenance.issues.status.DISMISSED" }),
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

    await openIssueAction(user, "commands.resolve-issue.label");
    await user.type(
      await screen.findByLabelText("maintenance.fields.note"),
      "Collier resserré sur place",
    );
    await user.click(
      screen.getByRole("button", { name: "commands.resolve-issue.submit" }),
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

    await openIssueAction(user, "commands.resolve-issue.label");
    await screen.findByLabelText("maintenance.fields.note");
    await user.click(
      screen.getByRole("button", { name: "commands.resolve-issue.submit" }),
    );

    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    expect(submittedPayload()).toEqual({ issueId: ISSUE_ID });
  });

  it("dismisses an open signalement only with a reason", async () => {
    const user = userEvent.setup();
    renderScreen();

    await openIssueAction(user, "commands.dismiss-issue.label");
    const submit = await screen.findByRole("button", {
      name: "commands.dismiss-issue.submit",
    });
    expect(submit.hasAttribute("disabled")).toBe(true);

    await user.type(screen.getByRole("textbox", { name: "maintenance.fields.reason" }), "Rien constaté");
    await user.click(
      screen.getByRole("button", { name: "commands.dismiss-issue.submit" }),
    );

    await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
    expect(mocks.submit.mock.calls[0]?.[0].name).toBe("dismiss-issue");
    expect(submittedPayload()).toEqual({ issueId: ISSUE_ID, reason: "Rien constaté" });
    expect(submittedEnvelope()["expectedVersion"]).toBe(2);
  });

  it("leaves a driver's report to the workshop: no resolve, dismiss or plan", async () => {
    me = as("DRIVER");
    renderScreen();

    await userEvent.click(screen.getByRole("tab", { name: "maintenance.issues.tab" }));
    await screen.findByText("Freins qui sifflent en descente");
    expect(screen.queryByRole("button", { name: "dataTable.actions" })).toBeNull();
  });
});

// With the module off the shell never opens this screen: modules/maintenance/manifest.test.tsx.
