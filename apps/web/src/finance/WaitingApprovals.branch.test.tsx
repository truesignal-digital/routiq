// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MeCtx, type MeContext } from "../auth/me.js";
import { sessionStore } from "../auth/store.js";
import { i18n } from "../i18n/index.js";
import { BranchProvider, branchStorageKey } from "../shell/branch-context.js";
import { WaitingApprovals } from "./WaitingApprovals.js";

/** The queue's own search params; `?branch=all` arrives widened. */
const search: { current: { branch?: string } } = { current: {} };

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useSearch: () => search.current,
  Link: ({ children }: { children?: unknown }) => children,
}));
const DLA = { id: "00000000-0000-4000-8000-000000000020", code: "DLA", name: "Douala" };
const YDE = { id: "00000000-0000-4000-8000-000000000021", code: "YDE", name: "Yaoundé" };

const REFERENCE = { assetClasses: [], branches: [DLA, YDE] };

function entry(id: string, number: string, branchId: string) {
  return {
    id,
    entryNumber: number,
    direction: "EXPENSE",
    status: "SUBMITTED",
    category: { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel" },
    amountMinor: 1000,
    currency: "XAF",
    economicDate: "2026-07-01",
    postingPeriodCode: null,
    isLatePosting: false,
    branchId,
    counterpartyName: null,
    paymentMethod: "CASH",
    estimateStatus: "ACTUAL",
    postedAt: null,
    rowVersion: 1,
    submittedByPrincipalId: "00000000-0000-4000-8000-000000000030",
    submittedAt: "2026-07-01T10:00:00.000Z",
  };
}

const QUEUE = [
  entry("00000000-0000-4000-8000-000000000010", "FIN-001", DLA.id),
  entry("00000000-0000-4000-8000-000000000011", "FIN-002", YDE.id),
];

/** The queue read filters server-side, so the stub does too. */
function stubFetch(queue = QUEUE) {
  const requested: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: RequestInfo | URL) => {
      const href = String(url);
      if (href.startsWith("/v1/reference/asset-registration")) {
        return new Response(JSON.stringify(REFERENCE), { status: 200 });
      }
      if (href.startsWith("/v1/finance/approvals")) {
        requested.push(href);
        const branchId = new URLSearchParams(href.split("?")[1]).get("branchId");
        const entries =
          branchId === null
            ? queue
            : queue.filter((row) => row.branchId === branchId);
        const outsideBranchCount =
          branchId === null ? 0 : queue.length - entries.length;
        return new Response(
          JSON.stringify({
            entries,
            nextCursor: null,
            total: entries.length,
            outsideBranchCount,
          }),
          { status: 200 },
        );
      }
      return new Response("{}", { status: 200 });
    }),
  );
  return requested;
}

const approver: MeContext = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  principalId: "00000000-0000-4000-8000-000000000002",
  principalType: "HUMAN",
  membershipId: "00000000-0000-4000-8000-000000000003",
  displayName: "Sali Ahmadou",
  workspaceName: "Transports Ngwa",
  role: "FINANCE",
  branchScope: "ALL",
  enabledModules: ["CORE", "FINANCE"],
  enabledPresets: ["TRUCKING"],
  timezone: "Africa/Douala",
};

function renderScreen() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MeCtx.Provider value={approver}>
        <BranchProvider>
          <WaitingApprovals arrivingWidened={search.current.branch === "all"} />
        </BranchProvider>
      </MeCtx.Provider>
    </QueryClientProvider>,
  );
}

function lastQuery(requested: string[]) {
  return new URLSearchParams(requested[requested.length - 1]!.split("?")[1]);
}

describe("approvals queue under the shell's current branch", () => {
  beforeEach(async () => {
    search.current = {};
    await i18n.changeLanguage("fr-CM");
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
    localStorage.removeItem(branchStorageKey("ws-1"));
    sessionStore.logout({ username: "amina", workspaceSlug: "ws-1" });
  });

  it("shows every branch's pending work by default", async () => {
    const requested = stubFetch();

    renderScreen();
    await screen.findByText("FIN-001");

    expect(lastQuery(requested).get("branchId")).toBeNull();
    expect(screen.getByText("FIN-002")).toBeTruthy();
  });

  it("names each row's branch, so a mixed queue can be read", async () => {
    stubFetch();

    renderScreen();
    await screen.findByText("FIN-001");

    expect(screen.getByText("Douala")).toBeTruthy();
    expect(screen.getByText("Yaoundé")).toBeTruthy();
  });

  it("presets its filter to the shell's agency instead of following it silently", async () => {
    localStorage.setItem(branchStorageKey("ws-1"), DLA.id);
    const requested = stubFetch();

    renderScreen();
    await screen.findByText("FIN-001");

    await waitFor(() => expect(lastQuery(requested).get("branchId")).toBe(DLA.id));
    // The preset is a visible control, not a hidden narrowing.
    expect(screen.getByRole("combobox", { name: "Agence" })).toBeTruthy();
    expect(await screen.findByText("Filtré : Douala — 1 résultat")).toBeTruthy();
  });

  it("names the pending work its filter is hiding", async () => {
    localStorage.setItem(branchStorageKey("ws-1"), DLA.id);
    const requested = stubFetch();

    renderScreen();
    await waitFor(() => expect(lastQuery(requested).get("branchId")).toBe(DLA.id));

    expect(
      await screen.findByRole("button", {
        name: "+1 en attente dans une autre agence",
      }),
    ).toBeTruthy();
  });

  it("widens to every branch from the overflow line", async () => {
    localStorage.setItem(branchStorageKey("ws-1"), DLA.id);
    const requested = stubFetch();

    renderScreen();
    await waitFor(() => expect(lastQuery(requested).get("branchId")).toBe(DLA.id));

    await userEvent.click(
      await screen.findByRole("button", {
        name: "+1 en attente dans une autre agence",
      }),
    );

    await waitFor(() => expect(lastQuery(requested).get("branchId")).toBeNull());
    expect(await screen.findByText("FIN-002")).toBeTruthy();
  });

  it("says nothing about other branches when the queue already spans them", async () => {
    const requested = stubFetch();

    renderScreen();
    await screen.findByText("FIN-001");
    await waitFor(() => expect(lastQuery(requested).get("branchId")).toBeNull());

    expect(screen.queryByText(/en attente dans/)).toBeNull();
  });

  it("says nothing when the filtered branch is the only one with pending work", async () => {
    localStorage.setItem(branchStorageKey("ws-1"), DLA.id);
    // Every pending row already sits in the filtered branch: no overflow.
    const requested = stubFetch([
      entry("00000000-0000-4000-8000-000000000010", "FIN-001", DLA.id),
    ]);

    renderScreen();
    await waitFor(() => expect(lastQuery(requested).get("branchId")).toBe(DLA.id));
    await screen.findByText("FIN-001");

    expect(screen.queryByText(/en attente dans/)).toBeNull();
  });

  it("arrives widened when sent from an overflow line elsewhere", async () => {
    // The shell is on Douala, but ?branch=all says the approver came here to
    // see what Douala was hiding.
    localStorage.setItem(branchStorageKey("ws-1"), DLA.id);
    search.current = { branch: "all" };
    const requested = stubFetch();

    renderScreen();
    await screen.findByText("FIN-001");

    expect(lastQuery(requested).get("branchId")).toBeNull();
    expect(await screen.findByText("FIN-002")).toBeTruthy();
  });

  it("lets the approver widen the queue back to every branch", async () => {
    localStorage.setItem(branchStorageKey("ws-1"), DLA.id);
    const requested = stubFetch();

    renderScreen();
    await screen.findByText("FIN-001");
    await waitFor(() => expect(lastQuery(requested).get("branchId")).toBe(DLA.id));

    await userEvent.click(screen.getByRole("combobox", { name: "Agence" }));
    await userEvent.click(await screen.findByRole("option", { name: "Tous" }));

    await waitFor(() => expect(lastQuery(requested).get("branchId")).toBeNull());
    expect(await screen.findByText("FIN-002")).toBeTruthy();
  });
});
