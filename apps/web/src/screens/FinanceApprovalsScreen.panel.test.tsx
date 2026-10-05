// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MeCtx, type MeContext } from "../auth/me.js";
import { sessionStore } from "../auth/store.js";
import { i18n } from "../i18n/index.js";
import { BranchProvider } from "../shell/branch-context.js";
import { FinanceApprovalsScreen } from "./FinanceApprovalsScreen.js";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => ({}),
  Link: ({ children }: { children?: unknown }) => children,
}));
vi.mock("../finance/FinanceNav.js", () => ({ FinanceNav: () => null }));
// The shared client binds `fetch` when the module loads; this one reads it per
// call, so the stub below answers the commands too.
vi.mock("../commands/instance.js", async () => {
  const { createCommandClient } = await import("../commands/client.js");
  const { CommandStatusStore } = await import("../commands/store.js");
  const { sessionStore } = await import("../auth/store.js");
  const commandStatusStore = new CommandStatusStore();
  return {
    commandStatusStore,
    commandClient: createCommandClient({
      store: commandStatusStore,
      getToken: () => sessionStore.getToken(),
      fetchImpl: (input, init) => globalThis.fetch(input, init),
    }),
  };
});

const DLA = { id: "00000000-0000-4000-8000-000000000020", code: "DLA", name: "Douala" };
const SUBMITTER = "00000000-0000-4000-8000-000000000030";

const approver: MeContext = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  principalId: "00000000-0000-4000-8000-000000000002",
  principalType: "HUMAN",
  membershipId: "00000000-0000-4000-8000-000000000003",
  role: "FINANCE",
  branchScope: "ALL",
  enabledModules: ["CORE", "FINANCE"],
  enabledPresets: ["TRUCKING"],
};

function entry(id: string, number: string, submittedBy = SUBMITTER) {
  return {
    id,
    entryNumber: number,
    direction: "EXPENSE",
    status: "SUBMITTED",
    category: { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel" },
    amountMinor: 150000,
    currency: "XAF",
    economicDate: "2026-07-01",
    postingPeriodCode: null,
    isLatePosting: false,
    branchId: DLA.id,
    counterpartyName: "Garage Akwa",
    paymentMethod: "CASH",
    estimateStatus: "ACTUAL",
    postedAt: null,
    rowVersion: 3,
    reversesEntryId: null,
    recordedBy: { principalId: submittedBy, displayName: "Hervé", scope: "WORKSPACE" },
    directionDecides: false,
    evidence: { state: "NOT_SUPPLIED", artifactCount: 0 },
    assetShareMinor: null,
    assetLinks: null,
    links: {
      activityId: null,
      activityNumber: null,
      workOrderId: null,
      workOrderAssetId: null,
    },
    submittedByPrincipalId: submittedBy,
    submittedAt: "2026-07-01T10:00:00.000Z",
  };
}

const FIN_001 = entry("00000000-0000-4000-8000-000000000010", "FIN-001");
const FIN_002 = entry("00000000-0000-4000-8000-000000000011", "FIN-002");

interface SentCommand {
  name: string;
  payload: Record<string, unknown>;
  expectedVersion: unknown;
}

/**
 * A server in miniature: the queue holds what is still SUBMITTED, and an
 * approval takes the entry out of it, so the row leaves because the next read
 * says so (ADR-0001), not because the screen crossed it off.
 */
function stubServer(initial = [FIN_001, FIN_002]) {
  let queue = [...initial];
  const sent: SentCommand[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const href = String(url);
      if (href.startsWith("/v1/commands/")) {
        const name = decodeURIComponent(href.slice("/v1/commands/".length));
        const body = JSON.parse(String(init?.body)) as {
          envelope: Record<string, unknown>;
          payload: Record<string, unknown>;
        };
        sent.push({
          name,
          payload: body.payload,
          expectedVersion: body.envelope["expectedVersion"],
        });
        if (name === "approve-entry") {
          queue = queue.filter((row) => row.id !== body.payload["entryId"]);
        }
        return new Response(
          JSON.stringify({
            commandId: body.envelope["commandId"],
            recordId: body.payload["entryId"],
            rowVersion: 4,
            warnings: [],
            idempotentReplay: false,
          }),
          { status: 200 },
        );
      }
      if (href.startsWith("/v1/reference/asset-registration")) {
        return new Response(JSON.stringify({ assetClasses: [], branches: [DLA] }), {
          status: 200,
        });
      }
      if (href.startsWith("/v1/finance/approvals")) {
        return new Response(
          JSON.stringify({
            entries: queue,
            nextCursor: null,
            total: queue.length,
            outsideBranchCount: 0,
          }),
          { status: 200 },
        );
      }
      if (href.startsWith("/v1/finance/entries/")) {
        const id = decodeURIComponent(href.slice("/v1/finance/entries/".length));
        const row = initial.find((candidate) => candidate.id === id);
        if (row === undefined) return new Response("{}", { status: 404 });
        return new Response(
          JSON.stringify({
            ...row,
            description: "Plaquettes de frein",
            paymentReference: null,
            sourceReference: null,
            rejectedReason: null,
            reversedByEntryId: null,
            postings: [],
            evidenceFiles: [],
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }),
  );
  return sent;
}

function renderScreen() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MeCtx.Provider value={approver}>
        <BranchProvider>
          <FinanceApprovalsScreen />
        </BranchProvider>
      </MeCtx.Provider>
    </QueryClientProvider>,
  );
}

describe("approvals queue: the entry opens in the record panel", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("en");
  });

  afterAll(async () => {
    await i18n.changeLanguage("fr-CM");
  });

  beforeEach(() => {
    sessionStore.save({
      username: "amina",
      workspaceSlug: "ws-1",
      token: "tok",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    sessionStore.logout({ username: "amina", workspaceSlug: "ws-1" });
  });

  it("opens the entry from its number with Approve and Reject in the footer", async () => {
    stubServer();
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole("button", { name: "FIN-001" }));

    const panel = await screen.findByRole("dialog");
    // The entry itself, from the same summary the entries list shows: its
    // receipt and its history come with it.
    expect(await within(panel).findByText("Plaquettes de frein")).toBeTruthy();
    expect(within(panel).getByText("Receipt")).toBeTruthy();
    expect(within(panel).getByText("No receipt")).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "History" })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Approve entry" })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Reject entry" })).toBeTruthy();
  });

  it("approves in one tap from the panel, and the row leaves the queue", async () => {
    const sent = stubServer();
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole("button", { name: "FIN-001" }));
    const panel = await screen.findByRole("dialog");
    await user.click(within(panel).getByRole("button", { name: "Approve entry" }));

    await waitFor(() =>
      expect(sent).toEqual([
        {
          name: "approve-entry",
          payload: { entryId: FIN_001.id },
          expectedVersion: FIN_001.rowVersion,
        },
      ]),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "FIN-001" })).toBeNull(),
    );
    expect(screen.getByRole("button", { name: "FIN-002" })).toBeTruthy();
  });

  it("asks for a reason before rejecting from the panel", async () => {
    const sent = stubServer();
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole("button", { name: "FIN-001" }));
    const panel = await screen.findByRole("dialog");
    await user.click(within(panel).getByRole("button", { name: "Reject entry" }));

    const reason = await screen.findByRole("textbox", { name: "Rejection reason" });
    expect(sent).toEqual([]);
    await user.type(reason, "No receipt");
    await user.click(screen.getByRole("button", { name: "Reject entry" }));

    await waitFor(() =>
      expect(sent).toEqual([
        {
          name: "reject-entry",
          payload: { entryId: FIN_001.id, reason: "No receipt" },
          expectedVersion: FIN_001.rowVersion,
        },
      ]),
    );
  });

  it("offers no decision on the approver's own submission", async () => {
    stubServer([entry(FIN_001.id, "FIN-001", approver.principalId)]);
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole("button", { name: "FIN-001" }));
    const panel = await screen.findByRole("dialog");
    expect(await within(panel).findByText("Plaquettes de frein")).toBeTruthy();

    expect(within(panel).queryByRole("button", { name: "Approve entry" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: "Reject entry" })).toBeNull();
  });

  it("offers no decision in the footer above the approver's band, where the Director decides (#262)", async () => {
    stubServer([{ ...entry(FIN_001.id, "FIN-001"), directionDecides: true }]);
    const user = userEvent.setup();
    renderScreen();

    await user.click(await screen.findByRole("button", { name: "FIN-001" }));
    const panel = await screen.findByRole("dialog");
    expect(await within(panel).findByText("Plaquettes de frein")).toBeTruthy();

    expect(within(panel).queryByRole("button", { name: "Approve entry" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: "Reject entry" })).toBeNull();
  });
});

describe("approvals queue: economic date and submission date (#55)", () => {
  // DLA-2026-00005: a repair from July sent for approval in October.
  const lateRepair = {
    ...entry(FIN_001.id, "FIN-001"),
    economicDate: "2026-07-29",
    submittedAt: "2026-10-04T09:00:00.000Z",
  };

  beforeEach(() => {
    sessionStore.save({
      username: "amina",
      workspaceSlug: "ws-1",
      token: "tok",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    sessionStore.logout({ username: "amina", workspaceSlug: "ws-1" });
    await i18n.changeLanguage("fr-CM");
  });

  it.each([
    {
      locale: "en",
      economicLabel: "Economic date",
      economicDate: "7/29/26",
      submittedLabel: "Submitted",
      submittedDate: "10/4/26",
    },
    {
      locale: "fr-CM",
      economicLabel: "Date comptable",
      economicDate: "29/07/2026",
      submittedLabel: "Soumis le",
      submittedDate: "04/10/2026",
    },
  ])("shows each date under its own heading in $locale", async (viewer) => {
    await i18n.changeLanguage(viewer.locale);
    stubServer([lateRepair]);
    renderScreen();

    const row = await screen.findByRole("row", { name: /FIN-001/ });
    const headers = screen.getAllByRole("columnheader");
    const cells = within(row).getAllByRole("cell");
    const economicColumn = headers.indexOf(
      screen.getByRole("columnheader", { name: viewer.economicLabel }),
    );
    expect(cells[economicColumn]?.textContent).toBe(viewer.economicDate);
    const submittedColumn = headers.indexOf(
      screen.getByRole("columnheader", { name: viewer.submittedLabel }),
    );
    expect(cells[submittedColumn]?.textContent).toBe(viewer.submittedDate);
  });
});
