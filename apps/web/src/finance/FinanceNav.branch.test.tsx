// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { MouseEventHandler, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n/index.js";
import { MeCtx, type MeContext } from "../auth/me.js";
import { sessionStore } from "../auth/store.js";
import { BranchProvider, branchStorageKey } from "../shell/branch-context.js";
import { FinanceNav } from "./FinanceNav.js";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: "/finance/entries" } }),
  // jsdom cannot follow a real anchor, so the default is suppressed.
  Link: ({
    to,
    children,
    onClick,
    ...props
  }: {
    to: string;
    children?: ReactNode;
    onClick?: MouseEventHandler<HTMLAnchorElement>;
  }) => (
    <a
      href={to}
      {...props}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
    >
      {children}
    </a>
  ),
}));

const DLA = { id: "branch-dla", code: "DLA", name: "Douala" };
const YDE = { id: "branch-yde", code: "YDE", name: "Yaoundé" };

const REFERENCE = { assetClasses: [], branches: [DLA, YDE] };

/** Two pending entries, one per agency — the queue filters server-side. */
const QUEUE = [
  { id: "entry-1", branchId: DLA.id },
  { id: "entry-2", branchId: YDE.id },
];

function stubFetch() {
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
          branchId === null ? QUEUE : QUEUE.filter((row) => row.branchId === branchId);
        return new Response(
          JSON.stringify({
            entries: [],
            nextCursor: null,
            total: entries.length,
            outsideBranchCount: branchId === null ? 0 : QUEUE.length - entries.length,
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
  workspaceId: "ws",
  principalId: "p",
  principalType: "HUMAN",
  membershipId: "m",
  role: "FINANCE_APPROVER",
  branchScope: "ALL",
  enabledModules: ["CORE", "FINANCE"],
  enabledPresets: ["TRUCKING"],
};

function renderNav() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MeCtx.Provider value={approver}>
        <BranchProvider>
          <FinanceNav />
        </BranchProvider>
      </MeCtx.Provider>
    </QueryClientProvider>,
  );
}

describe("finance nav badge under the shell's current branch", () => {
  beforeEach(() => {
    sessionStore.save({
      username: "ada",
      workspaceSlug: "ws-1",
      token: "tok",
      expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    localStorage.removeItem(branchStorageKey("ws-1"));
    sessionStore.logout({ username: "ada", workspaceSlug: "ws-1" });
  });

  it("counts every pending approval in scope while an agency is in force", async () => {
    localStorage.setItem(branchStorageKey("ws-1"), DLA.id);
    const requested = stubFetch();

    renderNav();

    // The ambient branch narrows collections and their filters; it never quiets
    // an attention signal, or work would sit pending in a branch nobody looks at.
    const badge = await screen.findByLabelText("2 approbations en attente");
    expect(badge.textContent).toBe("2");
    await waitFor(() => expect(requested).toHaveLength(1));
    expect(new URLSearchParams(requested[0]!.split("?")[1]).get("branchId")).toBeNull();
  });
});
