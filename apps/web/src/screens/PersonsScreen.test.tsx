// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UsePersonsParams } from "../activities/usePersons.js";

/** One record per distinct query key — an unchanged key is a cache hit. */
const issuedQueries: UsePersonsParams[] = [];

vi.mock("react-i18next", async () => {
  const actual = await vi.importActual("react-i18next");
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key,
      i18n: { language: "fr", resolvedLanguage: "fr", exists: () => true, t: (k: string) => k },
    }),
    initReactI18next: { type: "3rdParty", init: () => {} },
  };
});

const persons = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    displayName: "Amadou Bello",
    personCode: "D-014",
    defaultRole: "DRIVER" as const,
    branchId: "22222222-2222-4222-8222-222222222222",
    active: true,
    loginPrincipalId: null,
    rowVersion: 1,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    displayName: "Estelle Ngo",
    personCode: null,
    defaultRole: null,
    branchId: "22222222-2222-4222-8222-222222222222",
    active: false,
    loginPrincipalId: null,
    rowVersion: 1,
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    displayName: "Sali Ngono",
    personCode: "D-021",
    defaultRole: "DRIVER" as const,
    branchId: "22222222-2222-4222-8222-222222222222",
    active: true,
    loginPrincipalId: "55555555-5555-4555-8555-555555555555",
    rowVersion: 2,
  },
];

const members = [
  {
    principalId: "55555555-5555-4555-8555-555555555555",
    displayName: "Sali Ngono",
    username: "sali",
    role: "DRIVER" as const,
    branchScope: ["22222222-2222-4222-8222-222222222222"],
    status: "ACTIVE" as const,
    rowVersion: 1,
    createdAt: "2026-10-01T00:00:00.000Z",
  },
];

vi.mock("../members/useMembers.js", () => ({
  useMembers: () => ({
    data: { pages: [{ items: members, nextCursor: null }] },
    isError: false,
    isPending: false,
  }),
}));

/** The forms own the commands (PersonLoginForms.test.tsx); this screen only opens them. */
vi.mock("../members/PersonLoginForms.js", async () => {
  const actual = await vi.importActual<typeof import("../members/PersonLoginForms.js")>(
    "../members/PersonLoginForms.js",
  );
  return {
    ...actual,
    LinkPersonLoginForm: ({ person, logins }: { person: { displayName: string; loginPrincipalId: string | null }; logins: unknown[] }) => (
      <div role="dialog" aria-label={person.loginPrincipalId === null ? "link-person-login" : "relink-person-login"}>
        {person.displayName} · {logins.length}
      </div>
    ),
    UnlinkPersonLoginForm: ({ person, loginLabel }: { person: { displayName: string }; loginLabel: string }) => (
      <div role="dialog" aria-label="unlink-person-login">
        {person.displayName} · {loginLabel}
      </div>
    ),
  };
});

const refetch = vi.fn();

const mocks = vi.hoisted(() => ({ toastAdd: vi.fn() }));

vi.mock("@/components/ui/toast.js", () => ({ toast: { add: mocks.toastAdd } }));

vi.mock("../activities/usePersons.js", () => ({
  usePersons: (params: UsePersonsParams) => {
    const previous = issuedQueries[issuedQueries.length - 1];
    if (previous === undefined || JSON.stringify(previous) !== JSON.stringify(params)) {
      issuedQueries.push(params);
    }
    return {
      data: { items: persons },
      isError: false,
      isPending: false,
      refetch,
    };
  },
}));

vi.mock("../reference/asset-registration.js", () => ({
  useAssetRegistrationReference: () => ({
    data: { assetClasses: [], branches: [{ code: "DLA", name: "Douala" }] },
    isError: false,
    isPending: false,
  }),
}));

/** The dialog owns the command; this screen only owns opening it. */
vi.mock("../activities/RegisterPersonDialog.js", () => ({
  RegisterPersonDialog: ({
    open,
    branchCode,
    onRegistered,
  }: {
    open: boolean;
    branchCode: string;
    onRegistered: (personId: string) => void;
  }) =>
    open ? (
      <div role="dialog" aria-label="register-person">
        <span>{branchCode}</span>
        <button type="button" onClick={() => onRegistered("new-person-id")}>
          confirm
        </button>
      </div>
    ) : null,
}));

const me = {
  principalId: "66666666-6666-4666-8666-666666666666",
  role: "ADMIN" as const,
  branchScope: "ALL" as const,
  enabledModules: ["CORE", "ACTIVITIES"] as const,
};

vi.mock("../auth/me.js", async () => {
  const actual = await vi.importActual<typeof import("../auth/me.js")>("../auth/me.js");
  return { ...actual, useMeContext: () => meValue };
});

let meValue: unknown = me;

const { PersonsScreen } = await import("./PersonsScreen.js");

describe("PersonsScreen", () => {
  beforeEach(() => {
    issuedQueries.length = 0;
    refetch.mockClear();
    mocks.toastAdd.mockClear();
    meValue = me;
  });
  afterEach(cleanup);

  it("lists people with their code, role and standing", async () => {
    render(<PersonsScreen />);

    expect(await screen.findByText("Amadou Bello")).toBeTruthy();
    const amadou = screen.getByText("Amadou Bello").closest("tr")!;
    expect(within(amadou).getByText("D-014")).toBeTruthy();
    expect(within(amadou).getByText("persons.roles.DRIVER")).toBeTruthy();
    expect(within(amadou).getByText("persons.active")).toBeTruthy();
    // A person with neither code nor usual role still reads as a row.
    expect(screen.getByText("Estelle Ngo")).toBeTruthy();
    expect(screen.getByText("persons.inactive")).toBeTruthy();
  });

  it("asks the server to search rather than narrowing the loaded page", async () => {
    render(<PersonsScreen />);
    await screen.findByText("Amadou Bello");

    await userEvent.type(
      screen.getByRole("searchbox", { name: "persons.searchPlaceholder" }),
      "bello",
    );

    await waitFor(() => {
      expect(issuedQueries.some((query) => query.search === "bello")).toBe(true);
    });
  });

  it("registers into the branch it resolved, then reloads the list", async () => {
    render(<PersonsScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "commands.register-person.label" }));

    const dialog = await screen.findByRole("dialog", { name: "register-person" });
    expect(dialog.textContent).toContain("DLA");

    await userEvent.click(screen.getByRole("button", { name: "confirm" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("confirms the registration with a toast, as the other capture forms do", async () => {
    render(<PersonsScreen />);

    await userEvent.click(await screen.findByRole("button", { name: "commands.register-person.label" }));
    await userEvent.click(await screen.findByRole("button", { name: "confirm" }));

    // The row lands in the branch on screen, so nothing is added about where.
    expect(mocks.toastAdd).toHaveBeenCalledWith({
      type: "success",
      title: "Personne enregistrée",
    });
  });

  it.each(["FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"])(
    "%s reads the list but is offered no way to add",
    async (role) => {
      meValue = { role, enabledModules: ["CORE", "ACTIVITIES"] };
      render(<PersonsScreen />);

      expect(await screen.findByText("Amadou Bello")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "commands.register-person.label" })).toBeNull();
    },
  );

  function rowMenuOrNull(name: string): HTMLElement | null {
    const row = screen.getByText(name).closest("tr");
    if (row === null) throw new Error(`No row for ${name}`);
    return within(row).queryByRole("button", { name: "dataTable.actions" });
  }

  it("offers the Administrateur to link a login to a person who has none (#569)", async () => {
    render(<PersonsScreen />);

    await screen.findByText("Amadou Bello");
    await userEvent.click(rowMenuOrNull("Amadou Bello")!);
    await userEvent.click(await screen.findByRole("menuitem", { name: "commands.link-person-login.label" }));

    const dialog = await screen.findByRole("dialog", { name: "link-person-login" });
    // Sali's login is held by Sali's person, so nothing is free for Amadou.
    expect(dialog.textContent).toBe("Amadou Bello · 0");
  });

  it("shows a linked person's login, and offers to change or unlink it", async () => {
    render(<PersonsScreen />);

    expect(await screen.findByText("persons.columns.login")).toBeTruthy();
    const row = screen.getByText("Sali Ngono").closest("tr")!;
    expect(within(row).getByText("persons.login.option")).toBeTruthy();

    await userEvent.click(rowMenuOrNull("Sali Ngono")!);
    expect(await screen.findByRole("menuitem", { name: "commands.link-person-login.relink.label" })).toBeTruthy();
    await userEvent.click(screen.getByRole("menuitem", { name: "commands.unlink-person-login.label" }));

    const dialog = await screen.findByRole("dialog", { name: "unlink-person-login" });
    expect(dialog.textContent).toBe("Sali Ngono · persons.login.option");
  });

  it("offers no login action on an inactive person", async () => {
    render(<PersonsScreen />);
    await screen.findByText("Estelle Ngo");

    expect(rowMenuOrNull("Estelle Ngo")).toBeNull();
  });

  it.each(["FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"])(
    "%s sees no login column and no login action",
    async (role) => {
      meValue = { ...me, role };
      render(<PersonsScreen />);
      await screen.findByText("Amadou Bello");

      expect(screen.queryByText("persons.columns.login")).toBeNull();
      expect(rowMenuOrNull("Amadou Bello")).toBeNull();
    },
  );

  // With Trips off the shell never opens this screen: modules/manifests.test.tsx.
});
