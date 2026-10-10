// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { MeCtx, type MeContext } from "../auth/me.js";
import { i18n } from "../i18n/index.js";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ assetId: "00000000-0000-4000-8000-000000000099" }),
  useSearch: () => ({}),
  useRouterState: () => "/finance",
  Outlet: () => null,
  Link: ({ children }: { children?: ReactNode }) => children,
}));

const pendingQuery = {
  data: undefined,
  isPending: true,
  isError: false,
  refetch: vi.fn(),
};
const pendingInfiniteQuery = {
  ...pendingQuery,
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: vi.fn(),
};

vi.mock("../finance/useApprovals.js", async () => ({
  ...(await vi.importActual("../finance/useApprovals.js")),
  useApprovals: () => pendingInfiniteQuery,
}));
vi.mock("../finance/usePeriods.js", () => ({ usePeriods: () => pendingQuery }));
vi.mock("../finance/useEntries.js", () => ({ useEntries: () => pendingInfiniteQuery }));
vi.mock("../assets/useAssets.js", () => ({ useAssets: () => pendingInfiniteQuery }));
vi.mock("../reference/asset-registration.js", () => ({
  useAssetRegistrationReference: () => pendingQuery,
}));
vi.mock("../categories/useCategories.js", () => ({ useCategories: () => pendingQuery }));
vi.mock("../documents/useDocuments.js", () => ({
  useAssetDocuments: () => pendingQuery,
}));

const { FinanceScreen } = await import("../screens/FinanceScreen.js");
const { FinancePeriodsScreen } = await import("../screens/FinancePeriodsScreen.js");
const { FinanceRecordScreen } = await import("../screens/FinanceRecordScreen.js");

const SCREENS = [
  ["record", FinanceRecordScreen],
  ["money", FinanceScreen],
  ["periods", FinancePeriodsScreen],
] as const;

/**
 * With the module off the shell never opens these screens (`ModulePageGate`,
 * modules/manifests.test.tsx); what they deny themselves is the role.
 */
const ROLE_GATED = SCREENS.filter(([name]) =>
  name === "periods",
);

function me(overrides: Partial<MeContext>): MeContext {
  return {
    workspaceId: "00000000-0000-4000-8000-000000000001",
    principalId: "00000000-0000-4000-8000-000000000002",
    principalType: "HUMAN",
    membershipId: "00000000-0000-4000-8000-000000000003",
    displayName: "Sali Ahmadou",
    workspaceName: "Transports Ngwa",
    role: "CASHIER",
    branchScope: "ALL",
    enabledModules: [],
    enabledPresets: ["TRUCKING", "PASSENGER_TRANSPORT"],
    timezone: "Africa/Douala",
    ...overrides,
  };
}

function renderScreen(Screen: () => ReactNode, context: MeContext | undefined) {
  return render(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(MeCtx.Provider, { value: context }, createElement(Screen)),
    ),
  );
}

/** The denial as the user sees it: the dashed empty state and its message. */
function deniedSurface(): { markup: string; message: string } | undefined {
  const node = document.querySelector<HTMLElement>(".border-dashed");
  if (node === null) return undefined;
  return { markup: node.className, message: node.textContent ?? "" };
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

afterEach(cleanup);

describe("permission denied surface", () => {
  it("renders one shape and one message across every screen a role is shut out of", () => {
    const surfaces = SCREENS.map(([name, Screen]) => {
      renderScreen(Screen, me({ role: "TECHNICIAN", enabledModules: ["CORE", "FINANCE"] }));
      const surface = deniedSurface();
      expect(surface, name).toBeDefined();
      cleanup();
      return surface!;
    });

    const [first] = surfaces;
    for (const surface of surfaces) {
      expect(surface.markup).toBe(first!.markup);
      expect(surface.message).toBe("Your role does not allow this action.");
    }
  });

  it("says the role is the problem when the module is on but the role is not allowed", () => {
    for (const [name, Screen] of ROLE_GATED) {
      renderScreen(
        Screen,
        me({ role: "DRIVER", enabledModules: ["CORE", "FINANCE"] }),
      );
      expect(deniedSurface()?.message, name).toBe(
        "Your role does not allow this action.",
      );
      cleanup();
    }
  });

  it("shows no denial while the session is still loading", () => {
    for (const [name, Screen] of SCREENS) {
      renderScreen(Screen, undefined);
      expect(deniedSurface()?.message, name).not.toBe("Your role does not allow this action.");
      cleanup();
    }
  });

  it("keeps the wording out of the screens, in the shared error catalog", () => {
    renderScreen(FinancePeriodsScreen, me({ role: "TECHNICIAN", enabledModules: ["CORE", "FINANCE"] }));

    expect(screen.queryByText(/accessDenied/)).toBeNull();
    expect(screen.getByText("Your role does not allow this action.")).toBeDefined();
  });
});
