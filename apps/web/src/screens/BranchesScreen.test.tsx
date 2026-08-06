// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BranchListItem } from "@routiq/contracts";
import type { UseBranchesParams } from "../branches/useBranches.js";

/** One record per distinct query key — an unchanged key is a cache hit. */
const issuedQueries: UseBranchesParams[] = [];

vi.mock("react-i18next", async () => {
  const actual = await vi.importActual("react-i18next");
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: {
        language: "fr",
        resolvedLanguage: "fr",
        exists: () => true,
        t: (key: string) => key,
      },
    }),
    initReactI18next: { type: "3rdParty", init: () => {} },
  };
});

const branches: BranchListItem[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    code: "DLA",
    name: "Douala",
    timezone: "Africa/Douala",
    active: true,
    rowVersion: 1,
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    code: "YDE",
    name: "Yaoundé",
    timezone: "Africa/Douala",
    active: false,
    rowVersion: 3,
  },
];

const refetch = vi.fn();
const fetchNextPage = vi.fn();

vi.mock("../branches/useBranches.js", async () => {
  const actual =
    await vi.importActual<typeof import("../branches/useBranches.js")>(
      "../branches/useBranches.js",
    );
  return {
    ...actual,
    useBranches: (params: UseBranchesParams) => {
      const previous = issuedQueries[issuedQueries.length - 1];
      if (previous === undefined || JSON.stringify(previous) !== JSON.stringify(params)) {
        issuedQueries.push(params);
      }
      return {
        data: { pages: [{ items: branches, nextCursor: null }] },
        isError: false,
        isPending: false,
        hasNextPage: false,
        isFetchingNextPage: false,
        fetchNextPage,
        refetch,
      };
    },
  };
});

/** The dialogs own the commands; this screen only owns opening them. */
vi.mock("../branches/CreateBranchDialog.js", () => ({
  CreateBranchDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="create-branch" /> : null,
}));

vi.mock("../branches/BranchActionDialog.js", async () => {
  const actual =
    await vi.importActual<typeof import("../branches/BranchActionDialog.js")>(
      "../branches/BranchActionDialog.js",
    );
  return {
    ...actual,
    BranchActionDialog: ({
      action,
      branch,
    }: {
      action: string;
      branch: BranchListItem;
    }) => (
      <div role="dialog" aria-label="branch-action">
        <span>{action}</span>
        <span>{branch.name}</span>
      </div>
    ),
  };
});

const admin = { role: "ADMIN" as const, enabledModules: ["CORE"] as const };
let meValue: unknown = admin;

vi.mock("../auth/me.js", async () => {
  const actual = await vi.importActual<typeof import("../auth/me.js")>("../auth/me.js");
  return { ...actual, useMeContext: () => meValue };
});

/** jsdom never matches a width query; the table needs a nudge to render desktop. */
function mockDesktop() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

const { BranchesScreen } = await import("./BranchesScreen.js");

describe("BranchesScreen", () => {
  beforeEach(() => {
    issuedQueries.length = 0;
    vi.clearAllMocks();
    meValue = admin;
    mockDesktop();
  });
  afterEach(cleanup);

  it("lists every branch, inactive ones included, with its code and time zone", async () => {
    render(<BranchesScreen />);

    expect(await screen.findByText("DLA")).toBeTruthy();
    expect(screen.getByText("Douala")).toBeTruthy();
    expect(screen.getAllByText("Africa/Douala")).toHaveLength(2);
    expect(screen.getByText("branches.status.active")).toBeTruthy();
    // Reactivating one is why this screen exists, so it cannot be hidden.
    expect(screen.getByText("Yaoundé")).toBeTruthy();
    expect(screen.getByText("branches.status.inactive")).toBeTruthy();
    expect(issuedQueries[0]).toEqual({ sort: "code:asc" });
  });

  it("shows a non-admin the reason rather than the workspace's branches", async () => {
    meValue = { role: "OPS_MANAGER", enabledModules: ["CORE", "ACTIVITIES"] };
    render(<BranchesScreen />);

    expect(await screen.findByText("branches.title")).toBeTruthy();
    expect(screen.getByText("errors.ROLE_FORBIDDEN")).toBeTruthy();
    expect(screen.queryByText("Douala")).toBeNull();
    expect(screen.queryByRole("button", { name: "branches.add.open" })).toBeNull();
  });

  it("offers an inactive branch reactivation, and nothing that assumes it is open", async () => {
    render(<BranchesScreen />);
    await screen.findByText("Yaoundé");

    const menus = screen.getAllByRole("button", { name: "dataTable.actions" });
    await userEvent.click(menus[1]!);

    expect(
      await screen.findByRole("menuitem", { name: "branches.actions.reactivate" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("menuitem", { name: "branches.actions.deactivate" }),
    ).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "branches.actions.rename" })).toBeNull();
  });

  it("opens the deactivation dialog on the row the admin chose", async () => {
    render(<BranchesScreen />);
    await screen.findByText("Douala");

    await userEvent.click(screen.getAllByRole("button", { name: "dataTable.actions" })[0]!);
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "branches.actions.deactivate" }),
    );

    const dialog = await screen.findByRole("dialog", { name: "branch-action" });
    expect(dialog.textContent).toContain("deactivate");
    expect(dialog.textContent).toContain("Douala");
  });

  it("opens the create form from the header", async () => {
    render(<BranchesScreen />);
    await screen.findByText("Douala");

    expect(screen.queryByRole("dialog", { name: "create-branch" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "branches.add.open" }));
    expect(await screen.findByRole("dialog", { name: "create-branch" })).toBeTruthy();
  });
});
