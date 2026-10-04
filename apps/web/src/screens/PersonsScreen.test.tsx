// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    displayName: "Estelle Ngo",
    personCode: null,
    defaultRole: null,
    branchId: "22222222-2222-4222-8222-222222222222",
    active: false,
  },
];

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

vi.mock("../assets/reference.js", () => ({
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
  role: "ADMIN" as const,
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
    expect(screen.getByText("D-014")).toBeTruthy();
    expect(screen.getByText("persons.roles.DRIVER")).toBeTruthy();
    expect(screen.getByText("persons.active")).toBeTruthy();
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

    await userEvent.click(await screen.findByRole("button", { name: /persons.register/ }));

    const dialog = await screen.findByRole("dialog", { name: "register-person" });
    expect(dialog.textContent).toContain("DLA");

    await userEvent.click(screen.getByRole("button", { name: "confirm" }));
    expect(refetch).toHaveBeenCalled();
  });

  it("confirms the registration with a toast, as the other capture forms do", async () => {
    render(<PersonsScreen />);

    await userEvent.click(await screen.findByRole("button", { name: /persons.register/ }));
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
      expect(screen.queryByRole("button", { name: /persons.register/ })).toBeNull();
    },
  );

  it("shows a denied surface when the module is off", async () => {
    meValue = { role: "ADMIN", enabledModules: ["CORE"] };
    render(<PersonsScreen />);

    expect(await screen.findByText("persons.title")).toBeTruthy();
    expect(screen.queryByText("Amadou Bello")).toBeNull();
  });
});
