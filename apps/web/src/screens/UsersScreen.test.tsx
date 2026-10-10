// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MemberListItem } from "@routiq/contracts";
import type { UseMembersParams } from "../members/useMembers.js";

/** One record per distinct query key — an unchanged key is a cache hit. */
const issuedQueries: UseMembersParams[] = [];
/** Whether the screen let the members read run, on its latest render. */
let membersEnabled: boolean | undefined;

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
    role: "DIRECTOR",
    branchScope: "ALL",
    status: "ACTIVE",
    rowVersion: 3,
    createdAt: "2026-06-01T08:00:00.000Z",
  },
  {
    principalId: "22222222-2222-4222-8222-222222222222",
    displayName: "Estelle Ngo",
    username: "estelle",
    role: "DRIVER",
    branchScope: ["branch-yde"],
    status: "DEACTIVATED",
    rowVersion: 5,
    createdAt: "2026-06-02T08:00:00.000Z",
  },
  {
    principalId: "33333333-3333-4333-8333-333333333333",
    displayName: "Brice Ekane",
    username: "brice",
    role: "FINANCE",
    branchScope: ["branch-dla"],
    status: "ACTIVE",
    rowVersion: 1,
    createdAt: "2026-06-03T08:00:00.000Z",
  },
  {
    principalId: "44444444-4444-4444-8444-444444444444",
    displayName: "Carine Mbida",
    username: "carine",
    role: "ADMIN",
    branchScope: ["branch-dla"],
    status: "ACTIVE",
    rowVersion: 1,
    createdAt: "2026-06-04T08:00:00.000Z",
  },
  {
    principalId: "55555555-5555-4555-8555-555555555555",
    displayName: "Didier Talla",
    username: "didier",
    role: "DRIVER",
    branchScope: ["branch-dla"],
    status: "ACTIVE",
    rowVersion: 1,
    createdAt: "2026-06-05T08:00:00.000Z",
  },
  {
    principalId: "66666666-6666-4666-8666-666666666666",
    displayName: "Eric Fouda",
    username: "eric",
    role: "TECHNICIAN",
    branchScope: ["branch-yde"],
    status: "ACTIVE",
    rowVersion: 1,
    createdAt: "2026-06-06T08:00:00.000Z",
  },
];

const refetch = vi.fn();
const fetchNextPage = vi.fn();

vi.mock("../members/useMembers.js", () => ({
  useMembers: (params: UseMembersParams, options?: { enabled?: boolean }) => {
    membersEnabled = options?.enabled;
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

const director = {
  principalId: "11111111-1111-4111-8111-111111111111",
  role: "DIRECTOR" as const,
  branchScope: "ALL" as const,
  enabledModules: ["CORE"] as const,
};
/** An Administrateur of Douala, listed as Carine. */
const doualaAdmin = {
  principalId: "44444444-4444-4444-8444-444444444444",
  role: "ADMIN" as const,
  branchScope: ["branch-dla"],
  enabledModules: ["CORE"] as const,
};
let meValue: unknown = director;

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

/** The ⋯ menu on one member's row, or null when the row offers none. */
function rowMenuOrNull(name: string): HTMLElement | null {
  const row = screen.getByText(name).closest("tr");
  if (row === null) throw new Error(`No row for ${name}`);
  return within(row).queryByRole("button", { name: "dataTable.actions" });
}

function rowMenu(name: string): HTMLElement {
  const menu = rowMenuOrNull(name);
  if (menu === null) throw new Error(`No actions on ${name}`);
  return menu;
}

describe("UsersScreen", () => {
  beforeEach(() => {
    issuedQueries.length = 0;
    membersEnabled = undefined;
    vi.clearAllMocks();
    meValue = director;
    mockDesktop();
  });
  afterEach(cleanup);

  it("lists members with their login, role, branch scope and standing", async () => {
    render(<UsersScreen />);

    expect(await screen.findByText("Amina Fotso")).toBeTruthy();
    expect(screen.getByText("amina")).toBeTruthy();
    expect(screen.getByText("users.roles.DIRECTOR")).toBeTruthy();
    expect(screen.getAllByText("users.status.ACTIVE").length).toBeGreaterThan(0);
    // A scoped membership prints branch names, not the ids it stores.
    expect(screen.getAllByText("Yaoundé").length).toBeGreaterThan(0);
    expect(screen.getByText("users.status.DEACTIVATED")).toBeTruthy();
  });

  it.each(["FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"])(
    "shows %s the reason rather than the workspace's usernames",
    async (role) => {
    meValue = { ...director, role, enabledModules: ["CORE", "ACTIVITIES"] };
    render(<UsersScreen />);

    expect(await screen.findByText("users.title")).toBeTruthy();
    expect(screen.getByText("errors.ROLE_FORBIDDEN")).toBeTruthy();
    expect(screen.queryByText("Amina Fotso")).toBeNull();
    expect(screen.queryByText("amina")).toBeNull();
    expect(screen.queryByRole("button", { name: "commands.add-member.label" })).toBeNull();
    },
  );

  it.each(["FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"])(
    "never asks the server for members as %s, who would be refused (#600)",
    async (role) => {
      meValue = { ...director, role, enabledModules: ["CORE", "ACTIVITIES"] };
      render(<UsersScreen />);

      expect(await screen.findByText("errors.ROLE_FORBIDDEN")).toBeTruthy();
      expect(membersEnabled).toBe(false);
    },
  );

  it("waits for the signed-in role before asking for members", () => {
    meValue = undefined;
    render(<UsersScreen />);
    expect(membersEnabled).toBe(false);
  });

  it.each([
    ["DIRECTOR", director],
    ["ADMIN", doualaAdmin],
  ])("asks the server for members as %s", async (_role, actor) => {
    meValue = actor;
    render(<UsersScreen />);

    expect(await screen.findByText("Amina Fotso")).toBeTruthy();
    expect(membersEnabled).toBe(true);
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

    await userEvent.click(rowMenu("Estelle Ngo"));

    expect(await screen.findByRole("menuitem", { name: "commands.reactivate-member.label" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "commands.deactivate-member.label" })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: "commands.reset-member-pin.label" })).toBeNull();
  });

  it("opens the action dialog on the row the admin chose", async () => {
    render(<UsersScreen />);
    await screen.findByText("Amina Fotso");

    await userEvent.click(rowMenu("Brice Ekane"));
    await userEvent.click(await screen.findByRole("menuitem", { name: "commands.reset-member-pin.label" }));

    const dialog = await screen.findByRole("dialog", { name: "member-action" });
    expect(dialog.textContent).toContain("pin");
    expect(dialog.textContent).toContain("Brice Ekane");
  });

  it("gives the Director every row but a Director's, their own included", async () => {
    render(<UsersScreen />);
    await screen.findByText("Amina Fotso");

    for (const name of ["Brice Ekane", "Carine Mbida", "Didier Talla", "Eric Fouda"]) {
      expect(rowMenuOrNull(name)).not.toBeNull();
    }
    // Direction is appointed by the vendor, never managed from Users (ADR-0009).
    expect(rowMenuOrNull("Amina Fotso")).toBeNull();
  });

  it("gives an Administrateur only the field roles of their own branches", async () => {
    meValue = doualaAdmin;
    render(<UsersScreen />);
    await screen.findByText("Amina Fotso");

    // Director, Finance, another Administrateur (themselves), and a technician
    // of Yaoundé are beyond them; the Douala driver is theirs.
    expect(rowMenuOrNull("Amina Fotso")).toBeNull();
    expect(rowMenuOrNull("Brice Ekane")).toBeNull();
    expect(rowMenuOrNull("Carine Mbida")).toBeNull();
    expect(rowMenuOrNull("Eric Fouda")).toBeNull();
    expect(rowMenuOrNull("Estelle Ngo")).toBeNull();

    await userEvent.click(rowMenu("Didier Talla"));
    expect(await screen.findByRole("menuitem", { name: "commands.update-member-role.label" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "commands.reset-member-pin.label" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "commands.deactivate-member.label" })).toBeTruthy();
  });

  it("opens the add form from the header", async () => {
    render(<UsersScreen />);
    await screen.findByText("Amina Fotso");

    expect(screen.queryByRole("dialog", { name: "add-member" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "commands.add-member.label" }));
    expect(await screen.findByRole("dialog", { name: "add-member" })).toBeTruthy();
  });
});
