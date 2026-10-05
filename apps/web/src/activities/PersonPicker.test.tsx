// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n/index.js";
import { sessionStore } from "../auth/store.js";
import type { CommandClient } from "../commands/client.js";
import { PersonPicker } from "./PersonPicker.js";

const sessionIdentity = { username: "amina", workspaceSlug: "sotrafret" };

const PERSONS = [
  {
    id: "p-1",
    displayName: "Amadou Bello",
    personCode: "D-014",
    defaultRole: "DRIVER",
    branchId: "b-1",
    active: true,
  },
  {
    id: "p-2",
    displayName: "Estelle Ngo",
    personCode: null,
    defaultRole: "CONDUCTOR",
    branchId: "b-1",
    active: true,
  },
];

function stubPersons(items: unknown[] = PERSONS) {
  const fetchImpl = vi.fn(async () =>
    new Response(JSON.stringify({ items }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchImpl);
  return fetchImpl;
}

beforeEach(() => {
  sessionStore.save({
    ...sessionIdentity,
    token: "token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
});

afterEach(() => {
  sessionStore.logout(sessionIdentity);
  vi.unstubAllGlobals();
  cleanup();
});

const idleClient: CommandClient = {
  submit: async () => ({ ok: false, code: "COMMAND_FAILED" }),
};

function renderPicker(overrides: Partial<Parameters<typeof PersonPicker>[0]> = {}) {
  const onChange = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <PersonPicker
        value=""
        onChange={onChange}
        branchCode="DLA"
        label="Chauffeur"
        client={idleClient}
        {...overrides}
      />
    </QueryClientProvider>,
  );
  return { onChange };
}

describe("PersonPicker", () => {
  it("shows the placeholder until a person is chosen, then that person's name", async () => {
    stubPersons();
    renderPicker();
    expect(screen.getByLabelText("Chauffeur").textContent).toContain(
      "Choisir une personne",
    );

    cleanup();
    renderPicker({ value: "p-2" });
    await waitFor(() =>
      expect(screen.getByLabelText("Chauffeur").textContent).toContain("Estelle Ngo"),
    );
  });

  it("lists the branch's people and narrows them client-side as the clerk types", async () => {
    stubPersons();
    renderPicker();

    await userEvent.click(screen.getByLabelText("Chauffeur"));
    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
    expect(screen.getAllByRole("option")).toHaveLength(2);

    await userEvent.type(
      screen.getByLabelText("Rechercher une personne"),
      "estelle",
    );
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0]?.textContent).toContain("Estelle Ngo");
  });

  it("selecting an option reports the person id and closes the list", async () => {
    stubPersons();
    const { onChange } = renderPicker();

    await userEvent.click(screen.getByLabelText("Chauffeur"));
    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
    await userEvent.click(screen.getByRole("option", { name: /Amadou Bello/ }));

    expect(onChange).toHaveBeenCalledWith("p-1");
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("an empty list still offers registration — capture never dead-ends", async () => {
    stubPersons([]);
    renderPicker();

    await userEvent.click(screen.getByLabelText("Chauffeur"));
    await waitFor(() => expect(screen.getByText("Aucune personne trouvée.")).toBeTruthy());

    await userEvent.click(screen.getByRole("button", { name: "Ajouter une personne" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "Ajouter une personne" })).toBeTruthy(),
    );
  });
});
