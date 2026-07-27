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
  Link: ({ children }: { children?: ReactNode }) => children,
}));

vi.mock("../finance/FinanceNav.js", () => ({ FinanceNav: () => null }));

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
vi.mock("../assets/reference.js", () => ({
  useAssetRegistrationReference: () => pendingQuery,
}));
vi.mock("../documents/useCategories.js", () => ({ useCategories: () => pendingQuery }));
vi.mock("../documents/useDocuments.js", () => ({
  useAssetDocuments: () => pendingQuery,
}));

const { AssetDocumentsScreen } = await import("../screens/AssetDocumentsScreen.js");
const { FinanceApprovalsScreen } = await import("../screens/FinanceApprovalsScreen.js");
const { FinanceEntriesScreen } = await import("../screens/FinanceEntriesScreen.js");
const { FinancePeriodsScreen } = await import("../screens/FinancePeriodsScreen.js");
const { FinanceRecordScreen } = await import("../screens/FinanceRecordScreen.js");

const SCREENS = [
  ["record", FinanceRecordScreen],
  ["entries", FinanceEntriesScreen],
  ["approvals", FinanceApprovalsScreen],
  ["periods", FinancePeriodsScreen],
  ["documents", AssetDocumentsScreen],
] as const;

/** Every screen a role can be shut out of, minus the two role-gated finance ones. */
const MODULE_GATED = SCREENS;
const ROLE_GATED = SCREENS.filter(([name]) =>
  name === "approvals" || name === "periods",
);

function me(overrides: Partial<MeContext>): MeContext {
  return {
    workspaceId: "00000000-0000-4000-8000-000000000001",
    principalId: "00000000-0000-4000-8000-000000000002",
    principalType: "HUMAN",
    membershipId: "00000000-0000-4000-8000-000000000003",
    role: "EXECUTIVE_VIEWER",
    branchScope: "ALL",
    enabledModules: [],
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
  it("renders one shape and one message across every module-gated screen", () => {
    const surfaces = MODULE_GATED.map(([name, Screen]) => {
      renderScreen(Screen, me({}));
      const surface = deniedSurface();
      expect(surface, name).toBeDefined();
      cleanup();
      return surface!;
    });

    const [first] = surfaces;
    for (const surface of surfaces) {
      expect(surface.markup).toBe(first!.markup);
      expect(surface.message).toBe(
        "This module is not enabled for your workspace.",
      );
    }
  });

  it("says the role is the problem when the module is on but the role is not allowed", () => {
    for (const [name, Screen] of ROLE_GATED) {
      renderScreen(
        Screen,
        me({ role: "FIELD_SUBMITTER", enabledModules: ["CORE", "FINANCE"] }),
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
      expect(deniedSurface()?.message, name).not.toBe(
        "This module is not enabled for your workspace.",
      );
      cleanup();
    }
  });

  it("keeps the wording out of the screens, in the shared error catalog", () => {
    renderScreen(FinancePeriodsScreen, me({}));

    expect(screen.queryByText(/accessDenied/)).toBeNull();
    expect(
      screen.getByText("This module is not enabled for your workspace."),
    ).toBeDefined();
  });
});
