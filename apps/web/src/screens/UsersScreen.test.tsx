// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberListItem } from "@routiq/contracts";
import type { UseMembersParams } from "../members/useMembers.js";

/** One record per distinct query key — an unchanged key is a cache hit. */
const issuedQueries: UseMembersParams[] = [];

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

const members: MemberListItem[] = [
  {
    principalId: "11111111-1111-4111-8111-111111111111",
    displayName: "Amina Fotso",
    username: "amina",
    role: "ADMIN",
    branchScope: "ALL",
    status: "ACTIVE",
    rowVersion: 3,
    createdAt: "2026-06-01T08:00:00.000Z",
  },
  {
    principalId: "22222222-2222-4222-8222-222222222222",
    displayName: "Estelle Ngo",
    username: "estelle",
    role: "FIELD_SUBMITTER",
    branchScope: ["branch-yde"],
    status: "DEACTIVATED",
    rowVersion: 5,
    createdAt: "2026-06-02T08:00:00.000Z",
  },
];

const refetch = vi.fn();
const fetchNextPage = vi.fn();

vi.mock("../members/useMembers.js", () => ({
  useMembers: (params: UseMembersParams) => {
    const previous = issuedQueries[issuedQueries.length - 1];
    if (previous === undefined || JSON.stringify(previous) !== JSON.stringify(params)) {
      issuedQueries.push(params);
    }
    return {
      data: { pages: [{ items: members, nextCursor: null }] },
      isError: false,
      isPending: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage,
      refetch,
    };
  },
}));

vi.mock("../assets/reference.js", () => ({
  useAssetRegistrationReference: () => ({
    data: {
      assetClasses: [],
      branches: [
        { id: "branch-dla", code: "DLA", name: "Douala" },
        { id: "branch-yde", code: "YDE", name: "Yaoundé" },
      ],
    },
    isError: false,
    isPending: false,
  }),
}));

/** The dialogs own the commands; this screen only owns opening them. */
vi.mock("../members/AddMemberDialog.js", () => ({
  AddMemberDialog: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="add-member" /> : null,
}));

vi.mock("../members/MemberActionDialog.js", async () => {
  const actual =
    await vi.importActual<typeof import("../members/MemberActionDialog.js")>(
      "../members/MemberActionDialog.js",
    );
  return {
    ...actual,
    MemberActionDialog: ({ action, member }: { action: string; member: MemberListItem }) => (
      <div role="dialog" aria-label="member-action">
        <span>{action}</span>
        <span>{member.displayName}</span>
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

const { UsersScreen } = await import("./UsersScreen.js");

describe("UsersScreen", () => {
  beforeEach(() => {
    issuedQueries.length = 0;
    vi.clearAllMocks();
    meValue = admin;
    mockDesktop();
  });
  afterEach(cleanup);

  it("lists members with their login, role, branch scope and standing", async () => {
    render(<UsersScreen />);

    expect(await screen.findByText("Amina Fotso")).toBeTruthy();
    expect(screen.getByText("amina")).toBeTruthy();
    expect(screen.getByText("users.roles.ADMIN")).toBeTruthy();
    expect(screen.getByText("users.status.ACTIVE")).toBeTruthy();
    // A scoped membership prints branch names, not the ids it stores.
    expect(screen.getByText("Yaoundé")).toBeTruthy();
    expect(screen.getByText("users.status.DEACTIVATED")).toBeTruthy();
  });

  it("shows a non-admin the reason rather than the workspace's usernames", async () => {
    meValue = { role: "OPS_MANAGER", enabledModules: ["CORE", "ACTIVITIES"] };
    render(<UsersScreen />);

    expect(await screen.findByText("users.title")).toBeTruthy();
    expect(screen.getByText("errors.ROLE_FORBIDDEN")).toBeTruthy();
    expect(screen.queryByText("Amina Fotso")).toBeNull();
    expect(screen.queryByText("amina")).toBeNull();
    expect(screen.queryByRole("button", { name: "commands.add-member.label" })).toBeNull();
  });

  it("asks the server for former members rather than filtering the loaded page", async () => {
    render(<UsersScreen />);
    await screen.findByText("Amina Fotso");

    expect(issuedQueries[0]).toEqual({ sort: "displayName:asc" });

    await userEvent.click(screen.getByRole("combobox", { name: "users.filters.status" }));
    await userEvent.click(
      await screen.findByRole("option", { name: "users.filters.includeDeactivated" }),
    );

    await waitFor(() => {
      expect(issuedQueries.some((query) => query.includeDeactivated === true)).toBe(true);
    });
  });

  it("offers a deactivated member reactivation, and nothing that assumes a login", async () => {
    render(<UsersScreen />);
    await screen.findByText("Estelle Ngo");

    const menus = screen.getAllByRole("button", { name: "dataTable.actions" });
    await userEvent.click(menus[1]!);

    expect(await screen.findByRole("menuitem", { name: "commands.reactivate-member.label" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "commands.deactivate-member.label" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "commands.reset-member-pin.label" })).toBeNull();
  });

  it("opens the action dialog on the row the admin chose", async () => {
    render(<UsersScreen />);
    await screen.findByText("Amina Fotso");

    await userEvent.click(screen.getAllByRole("button", { name: "dataTable.actions" })[0]!);
    await userEvent.click(await screen.findByRole("menuitem", { name: "commands.reset-member-pin.label" }));

    const dialog = await screen.findByRole("dialog", { name: "member-action" });
    expect(dialog.textContent).toContain("pin");
    expect(dialog.textContent).toContain("Amina Fotso");
  });

  it("opens the add form from the header", async () => {
    render(<UsersScreen />);
    await screen.findByText("Amina Fotso");

    expect(screen.queryByRole("dialog", { name: "add-member" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "commands.add-member.label" }));
    expect(await screen.findByRole("dialog", { name: "add-member" })).toBeTruthy();
  });
});
