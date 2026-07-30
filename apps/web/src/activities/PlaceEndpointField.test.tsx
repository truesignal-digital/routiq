// @vitest-environment jsdom
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { LegEndpoint } from "@routiq/contracts";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n/index.js";
import { sessionStore } from "../auth/store.js";
import { PlaceEndpointField } from "./PlaceEndpointField.js";

const sessionIdentity = { username: "amina", workspaceSlug: "sotrafret" };

const PLACES = [
  { id: "place-douala", name: "Douala" },
  { id: "place-edea", name: "Edéa" },
];

beforeEach(() => {
  sessionStore.save({
    ...sessionIdentity,
    token: "token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify({ items: PLACES }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
});

afterEach(() => {
  sessionStore.logout(sessionIdentity);
  vi.unstubAllGlobals();
  cleanup();
});

/** Re-renders with whatever the field last emitted, like a form field would. */
function renderField(initial?: LegEndpoint) {
  const onChange = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <PlaceEndpointField
        {...(value === undefined ? {} : { value })}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
        label="Départ"
      />
    );
  }

  render(
    <QueryClientProvider client={queryClient}>
      <Harness />
    </QueryClientProvider>,
  );
  return { onChange };
}

describe("PlaceEndpointField", () => {
  it("a typed name that matches nothing becomes a new place with a fresh id", async () => {
    const { onChange } = renderField();

    await userEvent.type(screen.getByLabelText("Départ"), "Kribi");

    const last = onChange.mock.calls.at(-1)?.[0] as LegEndpoint;
    expect(last.kind).toBe("place");
    if (last.kind !== "place") throw new Error("expected a place endpoint");
    expect(last.name).toBe("Kribi");
    expect(last.placeId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("typing a known name reuses that place's id instead of minting a duplicate", async () => {
    const { onChange } = renderField();
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    await userEvent.type(screen.getByLabelText("Départ"), "Douala");

    const last = onChange.mock.calls.at(-1)?.[0] as LegEndpoint;
    if (last.kind !== "place") throw new Error("expected a place endpoint");
    expect(last.placeId).toBe("place-douala");
  });

  it("suggests known places and adopts the one that is clicked", async () => {
    const { onChange } = renderField();
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    await userEvent.type(screen.getByLabelText("Départ"), "Ed");
    const option = await screen.findByRole("option", { name: "Edéa" });
    await userEvent.click(option);

    expect(onChange).toHaveBeenLastCalledWith({
      kind: "place",
      placeId: "place-edea",
      name: "Edéa",
    });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
  });

  it("the ad-hoc toggle switches the union to free text, keeping what was typed", async () => {
    const { onChange } = renderField();

    await userEvent.type(screen.getByLabelText("Départ"), "Carrière PK14");
    await userEvent.click(screen.getByRole("checkbox", { name: "Arrêt ponctuel" }));

    expect(onChange).toHaveBeenLastCalledWith({
      kind: "text",
      text: "Carrière PK14",
    });

    // Typing on keeps it free text — an ad-hoc stop is a decision, not a typo.
    await userEvent.type(screen.getByLabelText("Départ"), " bis");
    const last = onChange.mock.calls.at(-1)?.[0] as LegEndpoint;
    expect(last.kind).toBe("text");
  });

  it("turning the toggle back off returns the same text as a place", async () => {
    const { onChange } = renderField({ kind: "text", text: "Douala" });
    await waitFor(() => expect(fetch).toHaveBeenCalled());

    await userEvent.click(screen.getByRole("checkbox", { name: "Arrêt ponctuel" }));

    expect(onChange).toHaveBeenLastCalledWith({
      kind: "place",
      placeId: "place-douala",
      name: "Douala",
    });
  });
});
