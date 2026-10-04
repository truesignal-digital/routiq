// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CommandResult, WorkOrderDetail } from "@routiq/contracts";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { MeCtx, type MeContext } from "../auth/me.js";
import { sessionStore } from "../auth/store.js";
import type { CommandClient, SubmitResult } from "../commands/client.js";
import { i18n } from "../i18n/index.js";
import { openSelect } from "../test-select.js";
import { todayIsoDate } from "./close-cost.js";
import { CompleteWorkOrderForm, type WorkOrderRef } from "./MaintenanceDialogs.js";

const mocks = vi.hoisted(() => ({
  toastAdd: vi.fn(),
  detail: undefined as unknown,
  upload: vi.fn(),
}));

vi.mock("@/components/ui/toast.js", () => ({ toast: { add: mocks.toastAdd } }));
vi.mock("./useMaintenance.js", () => ({
  maintenanceQueryKey: (slug: string | undefined) => ["ws", slug, "maintenance"],
  useIssues: () => ({ data: { pages: [] } }),
  useWorkOrder: () => ({ data: mocks.detail, isPending: false, isError: false }),
}));
vi.mock("../documents/useCategories.js", () => ({
  useCategories: () => ({
    data: [
      { code: "REPAIRS", labelFr: "Réparations", labelEn: "Repairs" },
      { code: "TYRES", labelFr: "Pneumatiques", labelEn: "Tyres" },
    ],
    isSuccess: true,
    isPending: false,
    isError: false,
  }),
}));
vi.mock("../artifacts/upload.js", () => ({
  uploadArtifact: mocks.upload,
  downscaleImage: async (file: File) => file,
}));

const WORK_ORDER_ID = "00000000-0000-4000-8000-0000000000a1";
const ASSET_ID = "00000000-0000-4000-8000-000000000004";
const sessionIdentity = { username: "boris", workspaceSlug: "ngwa" };

const ref: WorkOrderRef = {
  id: WORK_ORDER_ID,
  assetId: ASSET_ID,
  status: "APPROVED",
  issueId: null,
  rowVersion: 3,
};

function makeDetail(overrides: Partial<WorkOrderDetail> = {}): WorkOrderDetail {
  return {
    id: WORK_ORDER_ID,
    status: "APPROVED",
    description: "Freins avant",
    asset: { id: ASSET_ID, assetCode: "VH003", registrationNumber: "LT 482 AB" },
    branch: { id: "00000000-0000-4000-8000-0000000000b1", code: "DLA", name: "Douala" },
    expectedCostMinor: 45_000,
    actualCostMinor: null,
    declaredCostMinor: null,
    costOutcome: null,
    currency: "XAF",
    issue: null,
    createdAt: "2026-09-29T08:00:00.000Z",
    completedAt: null,
    cancelledAt: null,
    rejectedAt: null,
    rowVersion: 3,
    createdBy: { principalId: null, displayName: null, scope: "WORKSPACE" },
    completedBy: null,
    summary: null,
    cancelReason: null,
    rejectReason: null,
    completionRejectReason: null,
    resolveLinkedIssue: false,
    createdByCommandId: "00000000-0000-4000-8000-0000000000c1",
    chronologie: [],
    costLines: [],
    pendingCostLines: [],
    ...overrides,
  };
}

const costLine = (entryId: string, amountMinor: number) => ({
  postingId: entryId.replace(/.$/, "f"),
  entryId,
  entryNumber: "DLA-2026-00007",
  description: null,
  amountMinor,
  currency: "XAF",
  economicDate: "2026-09-29",
  entryStatus: "POSTED" as const,
});

function me(role: MeContext["role"], modules: MeContext["enabledModules"] = ["CORE", "FINANCE", "MAINTENANCE"]): MeContext {
  return {
    workspaceId: "00000000-0000-4000-8000-000000000001",
    principalId: "00000000-0000-4000-8000-000000000002",
    principalType: "HUMAN",
    membershipId: "00000000-0000-4000-8000-000000000003",
    role,
    branchScope: "ALL",
    enabledModules: modules,
    enabledPresets: ["TRUCKING"],
  };
}

type Seen = {
  name: string;
  version: number;
  payload: Record<string, unknown>;
  envelope: { expectedVersion?: number; sourceArtifactIds?: string[] };
};

function recordingClient(outcome: Partial<CommandResult> = {}): CommandClient & { seen: Seen[] } {
  const seen: Seen[] = [];
  return {
    seen,
    submit: async (submission) => {
      seen.push(submission as Seen);
      const result: SubmitResult = {
        ok: true,
        outcome: {
          commandId: "c1",
          recordId: WORK_ORDER_ID,
          rowVersion: 4,
          recordStatus: "COMPLETED",
          warnings: [],
          idempotentReplay: false,
          ...outcome,
        },
      };
      return result;
    },
  };
}

function renderForm(client: CommandClient, viewer: MeContext = me("ADMIN"), workOrder = ref) {
  const onDismiss = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MeCtx.Provider value={viewer}>
        <Sheet open>
          <SheetContent>
            <CompleteWorkOrderForm
              surface="panel"
              workOrder={workOrder}
              client={client}
              onDismiss={onDismiss}
            />
          </SheetContent>
        </Sheet>
      </MeCtx.Provider>
    </QueryClientProvider>,
  );
  return { panel: screen.getByRole("dialog"), onDismiss };
}

const submitButton = (panel: HTMLElement) => within(panel).getByRole("button", { name: "Declare complete" });

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.detail = makeDetail();
  mocks.upload.mockResolvedValue({ ok: true });
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

describe("closing a work order with nothing recorded", () => {
  it("asks for one amount, shows the expected cost as a hint and never as the value", async () => {
    const client = recordingClient();
    const { panel } = renderForm(client);

    const amount = within(panel).getByLabelText("How much did the repair cost?");
    expect((amount as HTMLInputElement).value).toBe("");
    expect(within(panel).getByText(/Expected: .*45.000/)).toBeTruthy();
    // Everything else is pre-filled: the repair category and today.
    expect(within(panel).getByText(/Repairs · /)).toBeTruthy();
    // Closing with no choice is not possible.
    expect(submitButton(panel).hasAttribute("disabled")).toBe(true);

    await userEvent.type(amount, "50000");
    await userEvent.click(submitButton(panel));

    await waitFor(() => expect(client.seen).toHaveLength(1));
    const [sent] = client.seen;
    expect(sent).toMatchObject({ name: "complete-work-order", version: 2 });
    expect(sent!.envelope.expectedVersion).toBe(3);
    expect(sent!.payload).toMatchObject({
      workOrderId: WORK_ORDER_ID,
      costOutcome: "LINES",
      costLines: [
        {
          categoryCode: "REPAIRS",
          // XAF has exponent 0: 50 000 francs are 50 000 minor units.
          amountMinor: 50_000,
          economicDate: todayIsoDate(),
        },
      ],
    });
    expect("actualCostMinor" in sent!.payload).toBe(false);
  });

  it.each([
    ["No cost", "NO_COST"],
    ["Invoice not received yet", "INVOICE_PENDING"],
  ] as const)("closes with %s in one tap", async (label, costOutcome) => {
    const client = recordingClient();
    const { panel } = renderForm(client);

    await userEvent.click(within(panel).getByRole("button", { name: label }));
    expect(within(panel).queryByLabelText("How much did the repair cost?")).toBeNull();
    await userEvent.click(submitButton(panel));

    await waitFor(() => expect(client.seen).toHaveLength(1));
    expect(client.seen[0]!.payload).toMatchObject({ costOutcome, costLines: [] });
  });

  it("goes back to the amount after picking an alternative", async () => {
    const { panel } = renderForm(recordingClient());
    await userEvent.click(within(panel).getByRole("button", { name: "No cost" }));
    await userEvent.click(within(panel).getByRole("button", { name: "Enter an amount" }));
    expect(within(panel).getByLabelText("How much did the repair cost?")).toBeTruthy();
    expect(submitButton(panel).hasAttribute("disabled")).toBe(true);
  });

  it("adds a second line with its own category and note", async () => {
    const client = recordingClient();
    const { panel } = renderForm(client);

    await userEvent.type(within(panel).getByLabelText("How much did the repair cost?"), "30000");
    await userEvent.click(within(panel).getByRole("button", { name: "Add a line" }));
    const second = within(panel).getAllByTestId("cost-line")[1]!;
    await openSelect(userEvent.setup(), within(second).getByRole("combobox"));
    await userEvent.click(await screen.findByRole("option", { name: "Tyres" }));
    await userEvent.type(within(second).getByLabelText("Amount"), "20000");
    await userEvent.type(within(second).getByLabelText("Detail (optional)"), "Pneu avant");
    await userEvent.click(submitButton(panel));

    await waitFor(() => expect(client.seen).toHaveLength(1));
    const lines = client.seen[0]!.payload["costLines"] as Array<Record<string, unknown>>;
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatchObject({ categoryCode: "TYRES", amountMinor: 20_000, note: "Pneu avant" });
    expect(lines[0]!["entryId"]).not.toBe(lines[1]!["entryId"]);
  });

  it("sends the receipt photo with its line and on the envelope", async () => {
    const client = recordingClient();
    const { panel } = renderForm(client);

    await userEvent.type(within(panel).getByLabelText("How much did the repair cost?"), "50000");
    await userEvent.upload(
      within(panel).getByLabelText("Drop files here or click to choose"),
      new File(["receipt"], "recu.jpg", { type: "image/jpeg" }),
    );
    await waitFor(() => expect(mocks.upload).toHaveBeenCalled());
    await waitFor(() => expect(submitButton(panel).hasAttribute("disabled")).toBe(false));
    await userEvent.click(submitButton(panel));

    await waitFor(() => expect(client.seen).toHaveLength(1));
    const photoId = mocks.upload.mock.calls[0]![0] as string;
    expect(client.seen[0]!.envelope.sourceArtifactIds).toEqual([photoId]);
    expect(client.seen[0]!.payload).toMatchObject({
      costLines: [{ evidenceArtifactIds: [photoId] }],
    });
  });
});

describe("closing a work order with costs already recorded", () => {
  beforeEach(() => {
    mocks.detail = makeDetail({
      costLines: [
        costLine("00000000-0000-4000-8000-0000000000e1", 250_000),
        costLine("00000000-0000-4000-8000-0000000000e2", 60_000),
      ],
    });
  });

  it("shows them first and adds nothing unless asked", async () => {
    const client = recordingClient();
    const { panel } = renderForm(client);

    expect(within(panel).getByText(/Already recorded: .*310.000.*\(2 lines\)/)).toBeTruthy();
    expect(
      within(panel).getByRole("button", { name: "No, that's all" }).getAttribute("aria-pressed"),
    ).toBe("true");
    // "No cost" would contradict the books.
    expect(within(panel).queryByRole("button", { name: "No cost" })).toBeNull();
    expect(within(panel).queryByLabelText("Amount to add")).toBeNull();

    await userEvent.click(submitButton(panel));
    await waitFor(() => expect(client.seen).toHaveLength(1));
    expect(client.seen[0]!.payload).toMatchObject({ costOutcome: "LINES", costLines: [] });
  });

  it("adds a cost on top when the closer says so", async () => {
    const client = recordingClient();
    const { panel } = renderForm(client);

    await userEvent.click(within(panel).getByRole("button", { name: "Yes, add a cost" }));
    expect(submitButton(panel).hasAttribute("disabled")).toBe(true);
    await userEvent.type(within(panel).getByLabelText("Amount to add"), "15000");
    await userEvent.click(submitButton(panel));

    await waitFor(() => expect(client.seen).toHaveLength(1));
    expect(client.seen[0]!.payload).toMatchObject({
      costOutcome: "LINES",
      costLines: [{ amountMinor: 15_000 }],
    });
  });
});

describe("who may put money on the close", () => {
  it("lets the workshop type the amount", () => {
    const { panel } = renderForm(recordingClient(), me("TECHNICIAN"));
    expect(within(panel).getByLabelText("How much did the repair cost?")).toBeTruthy();
  });

  it("offers only the two alternatives when the books are switched off, and makes no choice for the closer", async () => {
    const client = recordingClient();
    const { panel } = renderForm(client, me("ADMIN", ["CORE", "MAINTENANCE"]));

    expect(within(panel).queryByLabelText("How much did the repair cost?")).toBeNull();
    expect(within(panel).queryByRole("button", { name: "Add a line" })).toBeNull();
    expect(submitButton(panel).hasAttribute("disabled")).toBe(true);

    await userEvent.click(within(panel).getByRole("button", { name: "Invoice not received yet" }));
    await userEvent.click(submitButton(panel));
    await waitFor(() => expect(client.seen).toHaveLength(1));
    expect(client.seen[0]!.payload).toMatchObject({ costOutcome: "INVOICE_PENDING" });
  });
});

describe("after the close", () => {
  it("says it went for review only when something waits for review", async () => {
    const client = recordingClient({
      children: [{ entityType: "financial_entry", id: "e1", status: "SUBMITTED", warnings: [] }],
    });
    const { panel } = renderForm(client);
    await userEvent.type(within(panel).getByLabelText("How much did the repair cost?"), "450000");
    await userEvent.click(submitButton(panel));

    await waitFor(() => expect(mocks.toastAdd).toHaveBeenCalled());
    expect(mocks.toastAdd.mock.calls[0]![0]).toMatchObject({
      title: "Work completed. Sent for review.",
    });
  });

  it("says only that the work is done when everything went through", async () => {
    const client = recordingClient({
      children: [{ entityType: "financial_entry", id: "e1", status: "POSTED", warnings: [] }],
    });
    const { panel } = renderForm(client);
    await userEvent.type(within(panel).getByLabelText("How much did the repair cost?"), "50000");
    await userEvent.click(submitButton(panel));

    await waitFor(() => expect(mocks.toastAdd).toHaveBeenCalled());
    expect(mocks.toastAdd.mock.calls[0]![0]).toMatchObject({ title: "Work completed" });
  });

  it("says it went for review when the close itself is held", async () => {
    const client = recordingClient({ recordStatus: "COMPLETION_SUBMITTED" });
    const { panel } = renderForm(client);
    await userEvent.click(within(panel).getByRole("button", { name: "No cost" }));
    await userEvent.click(submitButton(panel));

    await waitFor(() => expect(mocks.toastAdd).toHaveBeenCalled());
    expect(mocks.toastAdd.mock.calls[0]![0]).toMatchObject({
      title: "Work completed. Sent for review.",
    });
  });
});
