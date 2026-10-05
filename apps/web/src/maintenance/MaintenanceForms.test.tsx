// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { IssueListItem } from "@routiq/contracts";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { sessionStore } from "../auth/store.js";
import type { CommandClient, SubmitResult } from "../commands/client.js";
import { i18n } from "../i18n/index.js";
import { openSelect } from "../test-select.js";
import { CreateWorkOrderForm, ReleaseForm, ReportIssueForm } from "./MaintenanceDialogs.js";

const mocks = vi.hoisted(() => ({ toastAdd: vi.fn(), useIssues: vi.fn() }));

vi.mock("@/components/ui/toast.js", () => ({ toast: { add: mocks.toastAdd } }));
vi.mock("./useMaintenance.js", () => ({
  maintenanceQueryKey: (slug: string | undefined) => ["ws", slug, "maintenance"],
  useIssues: mocks.useIssues,
}));

const ASSET_ID = "00000000-0000-4000-8000-000000000004";
const ISSUE_ID = "00000000-0000-4000-8000-000000000080";
const sessionIdentity = { username: "paul", workspaceSlug: "sotrafret" };

const openIssue: IssueListItem = {
  id: ISSUE_ID,
  asset: { id: ASSET_ID, assetCode: "DLA-T-001", registrationNumber: "LT 123 AB" },
  branch: { id: "00000000-0000-4000-8000-0000000000b1", code: "DLA", name: "Douala" },
  description: "Brakes squeal on the descent",
  safetyCritical: true,
  category: "Brakes",
  reportedAt: "2026-09-24T07:00:00.000Z",
  status: "OPEN",
  resolvedAt: null,
  resolutionNote: null,
  dismissedAt: null,
  dismissReason: null,
  workOrders: [],
  assetUnavailable: true,
  rowVersion: 2,
};

type Seen = {
  name: string;
  payload: Record<string, unknown>;
  envelope: { expectedVersion?: number };
};

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

const committed: SubmitResult = {
  ok: true,
  outcome: { commandId: "c1", recordId: "r1", rowVersion: 1, warnings: [], idempotentReplay: false },
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
  sessionStore.save({
    ...sessionIdentity,
    token: "token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  mocks.useIssues.mockReturnValue({ data: { pages: [{ items: [openIssue], nextCursor: null }] } });
});

afterEach(() => {
  sessionStore.logout(sessionIdentity);
  cleanup();
});

describe("maintenance forms pinned to one vehicle", () => {
  it("files an issue against the pinned vehicle, with no picker to change it", async () => {
    const client = recordingClient(committed);
    const onDismiss = vi.fn();
    inPanel(
      <ReportIssueForm
        surface="panel"
        pinnedAssetId={ASSET_ID}
        pinnedAssetLabel="DLA-T-001 · Mercedes Actros"
        client={client}
        onDismiss={onDismiss}
      />,
    );

    const panel = screen.getByRole("dialog", { name: "Report a problem" });
    expect(within(panel).getByText("DLA-T-001 · Mercedes Actros")).toBeTruthy();
    expect(within(panel).queryByRole("combobox", { name: "Asset" })).toBeNull();

    await userEvent.type(within(panel).getByLabelText("Description"), "Left mirror cracked");
    await userEvent.click(within(panel).getByRole("button", { name: "Report the problem" }));

    await waitFor(() => expect(onDismiss).toHaveBeenCalledOnce());
    expect(client.seen[0]!.name).toBe("report-issue");
    expect(client.seen[0]!.payload).toMatchObject({
      assetId: ASSET_ID,
      description: "Left mirror cracked",
      safetyCritical: false,
    });
  });

  it("offers the pinned vehicle's own open issues to a new work order", async () => {
    const client = recordingClient(committed);
    inPanel(
      <CreateWorkOrderForm
        surface="panel"
        pinnedAssetId={ASSET_ID}
        pinnedAssetLabel="DLA-T-001"
        client={client}
        onDismiss={vi.fn()}
      />,
    );

    // Loaded for this vehicle alone, across every branch the member can see.
    expect(mocks.useIssues).toHaveBeenCalledWith({
      assetId: ASSET_ID,
      status: "OPEN",
      branchId: "ALL",
    });
    await openSelect(user(), screen.getByRole("combobox", { name: "Problem" }));
    await userEvent.click(await screen.findByRole("option", { name: "Brakes squeal on the descent" }));
    await userEvent.type(screen.getByLabelText("Description"), "Replace pads");
    // Required since the threshold is read against it.
    expect((screen.getByRole("button", { name: "Open work order" }) as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(screen.getByLabelText("Expected cost"), "85000");
    await userEvent.click(screen.getByRole("button", { name: "Open work order" }));

    await waitFor(() => expect(client.seen).toHaveLength(1));
    expect(client.seen[0]!.payload).toMatchObject({
      assetId: ASSET_ID,
      issueId: ISSUE_ID,
      description: "Replace pads",
      expectedCostMinor: 85000,
    });
  });
});

describe("ReleaseForm on the override path", () => {
  it("needs a reason and quotes the grounding issue's version, citing no work order", async () => {
    const client = recordingClient(committed);
    inPanel(
      <ReleaseForm
        surface="panel"
        subject={{
          kind: "override",
          assetId: ASSET_ID,
          issue: { id: ISSUE_ID, rowVersion: 5, description: "Brakes squeal on the descent" },
        }}
        client={client}
        onDismiss={vi.fn()}
      />,
    );

    const submit = screen.getByRole("button", { name: "Return to service" }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    expect(screen.getByText("Brakes squeal on the descent")).toBeTruthy();

    await userEvent.type(
      screen.getByLabelText("Why no work order was needed"),
      "Pads checked on the spot, within tolerance",
    );
    await userEvent.click(submit);

    await waitFor(() => expect(client.seen).toHaveLength(1));
    expect(client.seen[0]!.name).toBe("release-asset-to-service");
    expect(client.seen[0]!.payload).toEqual({
      assetId: ASSET_ID,
      overrideReason: "Pads checked on the spot, within tolerance",
    });
    expect(client.seen[0]!.envelope.expectedVersion).toBe(5);
  });
});

function user() {
  return userEvent.setup();
}
