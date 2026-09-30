// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ASSET_ID } from "../vehicle/test/fixtures.js";
import { closeVehicle, identity, openVehicle, type Recorded } from "../vehicle/test/harness.js";
import { useMe } from "./me.js";
import { sessionStore } from "./store.js";

afterEach(async () => {
  cleanup();
  sessionStore.logout({ username: "herve", workspaceSlug: identity.workspaceSlug });
  await closeVehicle();
});

/** Any read of the books: the entries list, approvals, periods, or a vehicle's money. */
function financeReads(recorded: Recorded, from: number): string[] {
  return recorded.requests
    .slice(from)
    .map((request) => request.url.pathname)
    .filter((path) => path.startsWith("/v1/finance") || path.endsWith("/finance"));
}

it("never renders or reads as the previous member after an account switch", async () => {
  const recorded = await openVehicle("/", { role: "ADMIN", members: { herve: "MAINTENANCE" } });
  const user = userEvent.setup();
  // The admin's Home reads the books.
  await waitFor(() => expect(financeReads(recorded, 0)).not.toEqual([]));

  await user.click(await screen.findByRole("button", { name: "Sign out" }));
  const signIn = await screen.findByRole("button", { name: "Sign in" });
  const from = recorded.requests.length;
  await user.clear(screen.getByLabelText("Workspace"));
  await user.type(screen.getByLabelText("Workspace"), identity.workspaceSlug);
  await user.clear(screen.getByLabelText("Username"));
  await user.type(screen.getByLabelText("Username"), "herve");
  await user.type(screen.getByLabelText("PIN code"), "666666");
  await user.click(signIn);

  await screen.findByRole("heading", { name: "Home" });
  await waitFor(() =>
    expect(recorded.requests.slice(from).some((request) => request.url.pathname === "/v1/dashboard")).toBe(true),
  );
  // Home asks the workshop's own profile; the recent entries it would show an admin never load.
  await waitFor(() => expect(recorded.requests.slice(from).some((request) => request.url.pathname === "/v1/me")).toBe(true));
  expect(screen.queryByText("Recent entries")).toBeNull();

  await act(async () => {
    await recorded.router.navigate({ to: "/assets/$assetId", params: { assetId: ASSET_ID } });
  });
  expect(await screen.findByText("Available.")).toBeTruthy();
  await waitFor(() =>
    expect(recorded.requests.slice(from).some((request) => request.url.pathname.endsWith("/attention"))).toBe(true),
  );

  expect(financeReads(recorded, from)).toEqual([]);
});

it("forgets every read when /v1/me says the token is dead", async () => {
  sessionStore.save({ ...identity, token: "expired", expiresAt: "2099-01-01T00:00:00.000Z" });
  vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { code: "AUTH_REQUIRED" } }), { status: 401 }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["ws", identity.workspaceSlug, "finance", "entries", {}], { entries: [], nextCursor: null });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  renderHook(() => useMe(), { wrapper });

  await waitFor(() => expect(sessionStore.getActive()).toBeUndefined());
  expect(client.getQueryData(["ws", identity.workspaceSlug, "finance", "entries", {}])).toBeUndefined();
});
