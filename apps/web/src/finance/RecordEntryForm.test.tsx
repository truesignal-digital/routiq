// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  recordExpensePayload,
  reverseEntryPayload,
  updatePendingEntryPayload,
  type FinancialEntryDetail,
} from "@routiq/contracts";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { sessionStore } from "../auth/store.js";
import type { CommandClient, SubmitResult } from "../commands/client.js";
import { i18n } from "../i18n/index.js";
import { ApproveEntryForm, RejectEntryForm, ReverseEntryForm } from "./EntryDecisionForms.js";
import { RecordEntryForm } from "./RecordEntryForm.js";

const mocks = vi.hoisted(() => ({
  toastAdd: vi.fn(),
  useAssetRegistrationReference: vi.fn(),
  useCategories: vi.fn(),
  useAssets: vi.fn(),
  useApprovalChain: vi.fn(),
}));

vi.mock("@/components/ui/toast.js", () => ({ toast: { add: mocks.toastAdd } }));
vi.mock("../assets/reference.js", () => ({
  useAssetRegistrationReference: mocks.useAssetRegistrationReference,
}));
vi.mock("../documents/useCategories.js", () => ({ useCategories: mocks.useCategories }));
vi.mock("../assets/useAssets.js", () => ({ useAssets: mocks.useAssets }));
vi.mock("../approval-rules/useApprovalChain.js", () => ({
  useApprovalChain: mocks.useApprovalChain,
}));

const ASSET_ID = "00000000-0000-4000-8000-000000000030";
const WORK_ORDER_ID = "00000000-0000-4000-8000-000000000040";
const ACTIVITY_ID = "00000000-0000-4000-8000-000000000050";
const ENTRY_ID = "00000000-0000-4000-8000-000000000060";
const sessionIdentity = { username: "amina", workspaceSlug: "sotrafret" };

type Seen = { name: string; payload: unknown; envelope: { expectedVersion?: number } };

function recordingClient(result: SubmitResult): CommandClient & { seen: Seen[] } {
  const seen: Seen[] = [];
  return {
    seen,
    submit: async (submission) => {
      seen.push(submission as Seen);
      return result;
    },
  };
}

const posted: SubmitResult = {
  ok: true,
  outcome: {
    commandId: "c1",
    recordId: "e1",
    rowVersion: 1,
    recordStatus: "POSTED",
    warnings: [],
    idempotentReplay: false,
  },
};

function inPanel(node: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Sheet open>
        <SheetContent>{node}</SheetContent>
      </Sheet>
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
  mocks.useApprovalChain.mockReturnValue({ data: undefined });
  sessionStore.save({
    ...sessionIdentity,
    token: "token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  mocks.useAssetRegistrationReference.mockReturnValue({
    data: {
      assetClasses: [],
      branches: [
        { code: "DLA", name: "Douala" },
        { code: "YDE", name: "Yaoundé" },
      ],
    },
    isPending: false,
    isError: false,
  });
  mocks.useCategories.mockReturnValue({
    data: [
      { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel" },
      { code: "REPAIRS", labelFr: "Réparations", labelEn: "Repairs" },
    ],
    isPending: false,
    isError: false,
  });
  mocks.useAssets.mockReturnValue({
    data: {
      pages: [
        {
          items: [
            {
              id: ASSET_ID,
              assetCode: "DLA-T-001",
              registrationNumber: "LT 123 AB",
              manufacturer: "Mercedes",
              model: "Actros",
              lifecycleStatus: "IN_SERVICE",
              rowVersion: 1,
              category: { code: "TRUCK", labelFr: "Camion", labelEn: "Truck" },
              branch: { code: "DLA", name: "Douala" },
            },
          ],
          nextCursor: null,
        },
      ],
    },
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  });
});

afterEach(() => {
  sessionStore.logout(sessionIdentity);
  cleanup();
});

describe("RecordEntryForm opened from a vehicle", () => {
  it("shows the vehicle instead of the asset picker and charges the line to it and its work order", async () => {
    const client = recordingClient(posted);
    const onRecorded = vi.fn();
    inPanel(
      <RecordEntryForm
        surface="panel"
        lockDirection
        pinnedAssetId={ASSET_ID}
        link={{ workOrderId: WORK_ORDER_ID }}
        defaultCategoryCode="REPAIRS"
        defaultBranchCode="DLA"
        back={{ label: "WO-00000040 · Brake pads", onBack: vi.fn() }}
        client={client}
        onRecorded={onRecorded}
        onDismiss={vi.fn()}
      />,
    );

    const panel = screen.getByRole("dialog", { name: "Record expense" });
    // Pinned: shown read-only, with no picker to move the cost elsewhere.
    expect(within(panel).getByText("Vehicle")).toBeTruthy();
    await waitFor(() => expect(within(panel).getByText(/^DLA-T-001/)).toBeTruthy());
    expect(within(panel).queryByLabelText("Asset (optional)")).toBeNull();
    // Opened as an expense, it offers no revenue tab.
    expect(within(panel).queryByRole("tablist")).toBeNull();
    // The host's category and the vehicle's home branch are preselected.
    expect(within(panel).getByLabelText("Category").textContent).toContain("Repairs");
    expect(within(panel).getByLabelText("Branch").textContent).toContain("Douala");

    await userEvent.type(within(panel).getByLabelText("Amount (FCFA)"), "85000");
    const submit = within(panel).getByRole("button", { name: "Record the expense" });
    expect(within(submit.parentElement!).getAllByRole("button").map((button) => button.textContent))
      .toEqual(["Cancel", "Record the expense"]);
    await userEvent.click(submit);

    await waitFor(() => expect(onRecorded).toHaveBeenCalledOnce());
    expect(client.seen[0]!.name).toBe("record-expense");
    const payload = recordExpensePayload.parse(client.seen[0]!.payload);
    expect(payload.categoryCode).toBe("REPAIRS");
    expect(payload.branchCode).toBe("DLA");
    expect(payload.postings).toEqual([
      {
        assetId: ASSET_ID,
        workOrderId: WORK_ORDER_ID,
        amountMinor: 85_000,
        assetAttribution: "DIRECT",
      },
    ]);
    expect(onRecorded).toHaveBeenCalledWith(posted.ok && posted.outcome, "DLA");
    expect(mocks.toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success", title: "Transaction recorded and posted" }),
    );
  });

  it("puts a trip link on the same single line, never a second entry", async () => {
    const client = recordingClient(posted);
    inPanel(
      <RecordEntryForm
        surface="panel"
        lockDirection
        pinnedAssetId={ASSET_ID}
        pinnedAssetLabel="DLA-T-001"
        link={{ activityId: ACTIVITY_ID }}
        defaultCategoryCode="FUEL"
        defaultBranchCode="DLA"
        client={client}
        onRecorded={vi.fn()}
      />,
    );

    await userEvent.type(screen.getByLabelText("Amount (FCFA)"), "20000");
    await userEvent.click(screen.getByRole("button", { name: "Record the expense" }));

    await waitFor(() => expect(client.seen).toHaveLength(1));
    const payload = recordExpensePayload.parse(client.seen[0]!.payload);
    expect(payload.postings).toHaveLength(1);
    expect(payload.postings[0]).toMatchObject({
      assetId: ASSET_ID,
      activityId: ACTIVITY_ID,
      amountMinor: 20_000,
    });
  });

  it("names a revenue form as revenue when the direction is fixed", () => {
    inPanel(
      <RecordEntryForm
        surface="panel"
        initialDirection="REVENUE"
        lockDirection
        pinnedAssetId={ASSET_ID}
        pinnedAssetLabel="DLA-T-001"
        onRecorded={vi.fn()}
      />,
    );

    expect(screen.getByRole("dialog", { name: "Record revenue" })).toBeTruthy();
  });
});

describe("RecordEntryForm switching between expense and revenue (#449)", () => {
  function openRecord() {
    inPanel(
      <RecordEntryForm
        surface="panel"
        defaultBranchCode="DLA"
        client={recordingClient(posted)}
        onRecorded={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    return screen.getByRole("dialog");
  }

  it("does not flag an untouched category when the direction flips", async () => {
    const panel = openRecord();

    await userEvent.click(within(panel).getByRole("tab", { name: "Revenue" }));

    expect(within(panel).getByRole("tab", { name: "Revenue" }).getAttribute("aria-selected"))
      .toBe("true");
    expect(within(panel).queryByText(/This field is required/)).toBeNull();
  });

  it("clears a picked category on the flip without calling the empty field an error", async () => {
    const panel = openRecord();
    await userEvent.click(within(panel).getByLabelText("Category"));
    await userEvent.click(await screen.findByRole("option", { name: "Fuel" }));
    expect(within(panel).getByLabelText("Category").textContent).toContain("Fuel");

    await userEvent.click(within(panel).getByRole("tab", { name: "Revenue" }));

    expect(within(panel).getByLabelText("Category").textContent).not.toContain("Fuel");
    expect(within(panel).queryByText(/This field is required/)).toBeNull();
    expect(
      within(panel).getByRole("button", { name: "Record the revenue" }).hasAttribute("disabled"),
    ).toBe(true);
  });
});

describe("RecordEntryForm states the approval rule beside the amount (#422)", () => {
  const steps = (upTo: number) => [
    { upToMinor: upTo, outcome: "POSTS_DIRECTLY" },
    { upToMinor: 1_000_000, outcome: "FINANCE_APPROVES" },
    { upToMinor: null, outcome: "DIRECTION_APPROVES" },
  ];

  it("names the band above which this entry waits, per direction", async () => {
    mocks.useApprovalChain.mockReturnValue({
      data: {
        currency: "XAF",
        chains: [
          { commandType: "record-expense", steps: steps(150_000) },
          { commandType: "record-revenue", steps: steps(100_000) },
        ],
        notice: null,
      },
    });
    inPanel(<RecordEntryForm surface="panel" pinnedAssetId={ASSET_ID} onRecorded={vi.fn()} />);
    expect(screen.getByText("Above FCFA 150,000, this entry waits for Finance.")).toBeTruthy();

    inPanel(
      <RecordEntryForm
        surface="panel"
        initialDirection="REVENUE"
        lockDirection
        pinnedAssetId={ASSET_ID}
        onRecorded={vi.fn()}
      />,
    );
    expect(screen.getByText("Above FCFA 100,000, this entry waits for Finance.")).toBeTruthy();
  });

  it("tells Direction its entries post at any amount", () => {
    mocks.useApprovalChain.mockReturnValue({
      data: {
        currency: "XAF",
        chains: [{ commandType: "record-expense", steps: [{ upToMinor: null, outcome: "POSTS_DIRECTLY" }] }],
        notice: null,
      },
    });
    inPanel(<RecordEntryForm surface="panel" pinnedAssetId={ASSET_ID} onRecorded={vi.fn()} />);
    expect(screen.getByText("Your entries post directly at any amount.")).toBeTruthy();
  });

  it("says nothing while the rules are unknown", () => {
    inPanel(<RecordEntryForm surface="panel" pinnedAssetId={ASSET_ID} onRecorded={vi.fn()} />);
    expect(screen.queryByText(/this entry waits/)).toBeNull();
  });
});

describe("entry decisions on a record panel", () => {
  const entry = { id: ENTRY_ID, rowVersion: 3 };

  it("approves at the version the approver was shown", async () => {
    const client = recordingClient(posted);
    const onDismiss = vi.fn();
    inPanel(
      <ApproveEntryForm surface="panel" entry={entry} client={client} onDismiss={onDismiss} />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Approve entry" }));

    await waitFor(() => expect(onDismiss).toHaveBeenCalledOnce());
    expect(client.seen[0]!.name).toBe("approve-entry");
    expect(client.seen[0]!.payload).toEqual({ entryId: ENTRY_ID });
    expect(client.seen[0]!.envelope.expectedVersion).toBe(3);
  });

  it("will not reject without a reason", async () => {
    const client = recordingClient(posted);
    inPanel(
      <RejectEntryForm surface="panel" entry={entry} client={client} onDismiss={vi.fn()} />,
    );

    const submit = screen.getByRole("button", { name: "Reject entry" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(within(submit.parentElement!).getAllByRole("button").map((button) => button.textContent))
      .toEqual(["Keep entry", "Reject entry"]);
    const reason = screen.getByRole("textbox", { name: "Rejection reason" });
    expect(reason.hasAttribute("required")).toBe(true);
    expect(reason.getAttribute("aria-required")).toBe("true");
    await userEvent.type(reason, "Duplicate");
    expect(submit.disabled).toBe(false);
  });

  function openCancel(client: CommandClient, extra: { onReversed?: (id: string, code: string) => void; onRecordAgain?: () => void } = {}) {
    inPanel(<ReverseEntryForm surface="panel" entry={entry} client={client} onDismiss={vi.fn()} {...extra} />);
    return screen.getByRole("dialog", { name: "Cancel entry" });
  }

  it("asks for a reason from the short list, with Cancel entry last and destructive (#426)", async () => {
    const panel = openCancel(recordingClient(posted));
    const reasons = within(panel).getByRole("radiogroup", { name: "Why cancel this entry?" });
    expect(within(reasons).getAllByRole("radio").map((radio) => radio.getAttribute("aria-label") ?? radio.closest("label")?.textContent)).toEqual([
      "Entered twice",
      "Didn't happen",
      "Wrong details, to record again",
      "Other",
    ]);
    const submit = within(panel).getByRole("button", { name: "Cancel entry" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(submit.getAttribute("data-variant") ?? submit.className).toMatch(/destructive/);
    expect(within(submit.parentElement!).getAllByRole("button").map((button) => button.textContent))
      .toEqual(["Keep entry", "Cancel entry"]);
    // The text field is for Other only.
    expect(within(panel).queryByRole("textbox")).toBeNull();
  });

  it("sends the exact v2 payload for a listed reason, one cancellation id per opening", async () => {
    const client = recordingClient(posted);
    const onReversed = vi.fn();
    const panel = openCancel(client, { onReversed });

    await userEvent.click(within(panel).getByRole("radio", { name: "Entered twice" }));
    await userEvent.click(within(panel).getByRole("button", { name: "Cancel entry" }));

    await waitFor(() => expect(onReversed).toHaveBeenCalledOnce());
    const sent = client.seen[0] as Seen & { version: number };
    expect(sent.name).toBe("reverse-entry");
    expect(sent.version).toBe(2);
    const payload = sent.payload as { reversalEntryId: string };
    expect(sent.payload).toEqual({
      reversalEntryId: payload.reversalEntryId,
      originalEntryId: ENTRY_ID,
      reasonCode: "ENTERED_TWICE",
    });
    expect(reverseEntryPayload.safeParse(sent.payload).success).toBe(true);
    expect(onReversed).toHaveBeenCalledWith(payload.reversalEntryId, "ENTERED_TWICE");
    expect(sent.envelope.expectedVersion).toBe(3);
  });

  it("requires words for Other and sends them trimmed", async () => {
    const client = recordingClient(posted);
    const panel = openCancel(client, { onReversed: vi.fn() });
    const submit = within(panel).getByRole("button", { name: "Cancel entry" }) as HTMLButtonElement;

    await userEvent.click(within(panel).getByRole("radio", { name: "Other" }));
    const text = within(panel).getByRole("textbox", { name: "Say why" });
    expect(text.getAttribute("aria-required")).toBe("true");
    expect(submit.disabled).toBe(true);
    await userEvent.type(text, "  Card refunded  ");
    expect(submit.disabled).toBe(false);
    await userEvent.click(submit);

    await waitFor(() => expect(client.seen).toHaveLength(1));
    expect(client.seen[0]!.payload).toMatchObject({ reasonCode: "OTHER", reasonText: "Card refunded" });
  });

  it("offers Record again after a cancellation for wrong details", async () => {
    const onRecordAgain = vi.fn();
    const panel = openCancel(recordingClient(posted), { onRecordAgain });

    await userEvent.click(within(panel).getByRole("radio", { name: "Wrong details, to record again" }));
    await userEvent.click(within(panel).getByRole("button", { name: "Cancel entry" }));

    await userEvent.click(await screen.findByRole("button", { name: "Record again" }));
    expect(onRecordAgain).toHaveBeenCalledOnce();
  });

  it("closes straight away for the other reasons", async () => {
    const onRecordAgain = vi.fn();
    const onDismiss = vi.fn();
    inPanel(
      <ReverseEntryForm surface="panel" entry={entry} client={recordingClient(posted)} onDismiss={onDismiss} onRecordAgain={onRecordAgain} />,
    );
    await userEvent.click(screen.getByRole("radio", { name: "Didn't happen" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel entry" }));
    await waitFor(() => expect(onDismiss).toHaveBeenCalledOnce());
    expect(screen.queryByRole("button", { name: "Record again" })).toBeNull();
  });
});

describe("RecordEntryForm editing the author's pending entry", () => {
  const BRANCH_ID = "00000000-0000-4000-8000-000000000070";
  const AUTHOR_ID = "00000000-0000-4000-8000-000000000080";

  const pending: FinancialEntryDetail = {
    id: ENTRY_ID,
    entryNumber: "DLA-2026-00012",
    direction: "EXPENSE",
    status: "SUBMITTED",
    category: { code: "REPAIRS", labelFr: "Réparations", labelEn: "Repairs", layer: "DIRECT" },
    amountMinor: 45_000,
    currency: "XAF",
    economicDate: "2026-09-12",
    postingPeriodCode: null,
    isLatePosting: false,
    branchId: BRANCH_ID,
    counterpartyName: "Garage Tchinda",
    paymentMethod: "MOMO",
    estimateStatus: "ACTUAL",
    postedAt: null,
    rowVersion: 4,
    reversesEntryId: null,
    recordedBy: { principalId: AUTHOR_ID, displayName: "Amina", scope: "WORKSPACE" },
    evidence: { state: "PAYMENT_REFERENCE", artifactCount: 0 },
    assetShareMinor: null,
    assetLinks: null,
    links: { activityId: null, activityNumber: null, workOrderId: null, workOrderAssetId: null },
    description: "Plaquettes de frein",
    paymentReference: "MP-778",
    sourceReference: null,
    rejectedReason: null,
    reversedByEntryId: null,
    cancellation: null,
    postings: [
      {
        lineNo: 1,
        amountMinor: 45_000,
        assetId: ASSET_ID,
        assetCode: "DLA-T-001",
        assetAttribution: "DIRECT",
        activityId: null,
        workOrderId: WORK_ORDER_ID,
        category: { code: "REPAIRS", labelFr: "Réparations", labelEn: "Repairs" },
      },
    ],
    evidenceFiles: [],
    directionDecides: false,
  };

  const submitted: SubmitResult = {
    ok: true,
    outcome: {
      commandId: "c2",
      recordId: ENTRY_ID,
      rowVersion: 5,
      recordStatus: "SUBMITTED",
      warnings: [],
      idempotentReplay: false,
    },
  };

  beforeEach(() => {
    mocks.useAssetRegistrationReference.mockReturnValue({
      data: {
        assetClasses: [],
        branches: [
          { id: BRANCH_ID, code: "DLA", name: "Douala" },
          { id: "00000000-0000-4000-8000-000000000071", code: "YDE", name: "Yaoundé" },
        ],
      },
      isPending: false,
      isError: false,
    });
  });

  function openEdit(client: CommandClient, onRecorded = vi.fn()) {
    inPanel(
      <RecordEntryForm
        surface="panel"
        editing={pending}
        pinnedAssetId={ASSET_ID}
        pinnedAssetLabel="DLA-T-001"
        client={client}
        onRecorded={onRecorded}
        onDismiss={vi.fn()}
      />,
    );
    return screen.getByRole("dialog", { name: "Edit entry DLA-2026-00012" });
  }

  it("records again from a cancelled entry: pre-filled, a new entry through the normal record command (#426)", async () => {
    const client = recordingClient(posted);
    const onRecorded = vi.fn();
    const cancelled: FinancialEntryDetail = { ...pending, status: "REVERSED", postedAt: "2026-09-12T08:00:00.000Z" };
    inPanel(
      <RecordEntryForm surface="panel" recordAgainFrom={cancelled} client={client} onRecorded={onRecorded} onDismiss={vi.fn()} />,
    );
    const panel = screen.getByRole("dialog", { name: "Record expense" });

    const amount = within(panel).getByLabelText("Amount (FCFA)") as HTMLInputElement;
    expect(amount.value).toMatch(/^45\s?000$/);
    expect(within(panel).getByLabelText("Category").textContent).toContain("Repairs");
    expect(within(panel).getByLabelText("Payment method").textContent).toContain("Mobile Money");
    expect((within(panel).getByLabelText("Date") as HTMLInputElement).value).toBe("9/12/26");
    expect((within(panel).getByLabelText("Description (optional)") as HTMLTextAreaElement).value).toBe(
      "Plaquettes de frein",
    );
    await waitFor(() => expect(within(panel).getByLabelText("Branch").textContent).toContain("Douala"));

    await userEvent.clear(amount);
    await userEvent.type(amount, "40000");
    await userEvent.click(within(panel).getByRole("button", { name: "Record the expense" }));

    await waitFor(() => expect(onRecorded).toHaveBeenCalledOnce());
    const sent = client.seen[0] as Seen & { version: number };
    expect(sent.name).toBe("record-expense");
    const payload = recordExpensePayload.parse(sent.payload);
    expect(payload.entryId).not.toBe(ENTRY_ID);
    expect(payload).toMatchObject({
      branchCode: "DLA",
      categoryCode: "REPAIRS",
      economicDate: "2026-09-12",
      amountMinor: 40_000,
      paymentMethod: "MOMO",
      counterpartyName: "Garage Tchinda",
      description: "Plaquettes de frein",
      paymentReference: "MP-778",
    });
    expect(payload.postings).toEqual([
      expect.objectContaining({ assetId: ASSET_ID, workOrderId: WORK_ORDER_ID, amountMinor: 40_000 }),
    ]);
  });

  it("keeps the entry number in the title on one line (#442)", () => {
    const panel = openEdit(recordingClient(submitted));
    const numbers = [...panel.querySelectorAll("[data-slot='sheet-title'] [data-record-number]")];
    expect(numbers.map((node) => node.textContent)).toEqual(["DLA-2026-00012"]);
  });

  it("opens pre-filled with what the author recorded", () => {
    const panel = openEdit(recordingClient(submitted));

    expect((within(panel).getByLabelText("Amount (FCFA)") as HTMLInputElement).value).toMatch(/^45\s?000$/);
    expect(within(panel).getByLabelText("Category").textContent).toContain("Repairs");
    expect(within(panel).getByLabelText("Payment method").textContent).toContain("Mobile Money");
    expect((within(panel).getByLabelText("Date") as HTMLInputElement).value).toBe("9/12/26");
    expect((within(panel).getByLabelText("Counterparty (optional)") as HTMLInputElement).value).toBe(
      "Garage Tchinda",
    );
    expect((within(panel).getByLabelText("Description (optional)") as HTMLTextAreaElement).value).toBe(
      "Plaquettes de frein",
    );
    expect((within(panel).getByLabelText("Payment reference (optional)") as HTMLInputElement).value).toBe(
      "MP-778",
    );
    // Direction and branch stay as recorded; files go through "attach a receipt".
    expect(within(panel).queryByRole("tablist")).toBeNull();
    expect(within(panel).queryByRole("combobox", { name: "Branch" })).toBeNull();
    expect(within(panel).getByText("Douala (DLA)")).toBeTruthy();
    expect(within(panel).queryByText("Evidence (optional)")).toBeNull();
  });

  it("saves the new amount with update-pending-entry at the version shown, keeping the line's links", async () => {
    const client = recordingClient(submitted);
    const onRecorded = vi.fn();
    const panel = openEdit(client, onRecorded);

    const amount = within(panel).getByLabelText("Amount (FCFA)");
    await userEvent.clear(amount);
    await userEvent.type(amount, "54000");
    await userEvent.click(within(panel).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(onRecorded).toHaveBeenCalledOnce());
    expect(client.seen[0]!.name).toBe("update-pending-entry");
    expect(client.seen[0]!.envelope.expectedVersion).toBe(4);
    const payload = updatePendingEntryPayload.parse(client.seen[0]!.payload);
    expect(payload).toMatchObject({
      entryId: ENTRY_ID,
      categoryCode: "REPAIRS",
      amountMinor: 54_000,
      paymentMethod: "MOMO",
      paymentReference: "MP-778",
      economicDate: "2026-09-12",
    });
    expect(payload.postings).toEqual([
      { assetId: ASSET_ID, workOrderId: WORK_ORDER_ID, amountMinor: 54_000, assetAttribution: "DIRECT" },
    ]);
    expect(mocks.toastAdd).toHaveBeenCalledWith(
      expect.objectContaining({ type: "success", title: "Entry updated, still awaiting approval" }),
    );
  });

  it("says the entry was decided meanwhile when an approver acted first", async () => {
    const client = recordingClient({ ok: false, code: "VERSION_CONFLICT" });
    const onRecorded = vi.fn();
    const panel = openEdit(client, onRecorded);

    await userEvent.click(within(panel).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(within(panel).getByText("This entry has already been decided")).toBeTruthy());
    expect(onRecorded).not.toHaveBeenCalled();
    expect(within(panel).queryByRole("button", { name: "Save changes" })).toBeNull();
  });

  it("reads a refusal for status the same way", async () => {
    const panel = openEdit(recordingClient({ ok: false, code: "INVALID_STATE_TRANSITION" }));

    await userEvent.click(within(panel).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(within(panel).getByText("This entry has already been decided")).toBeTruthy());
  });
});
