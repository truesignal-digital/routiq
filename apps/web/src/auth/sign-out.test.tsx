// @vitest-environment jsdom
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandSubmission } from "@routiq/contracts";
import { commandClient } from "../commands/instance.js";
import { queryClient as appQueryClient } from "../lib/query-client.js";
import { ASSET_ID } from "../vehicle/test/fixtures.js";
import { closeVehicle, identity, openVehicle, type Recorded } from "../vehicle/test/harness.js";
import { useMe } from "./me.js";
import { clearSessionEndedNotice, sessionEndedNotice } from "./sign-out.js";
import { sessionStore } from "./store.js";

afterEach(async () => {
  cleanup();
  clearSessionEndedNotice();
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
  const recorded = await openVehicle("/", { role: "ADMIN", members: { herve: "TECHNICIAN" } });
  const user = userEvent.setup();
  // The admin's Home reads the books.
  await waitFor(() => expect(financeReads(recorded, 0)).not.toEqual([]));

  await user.click(await screen.findByRole("button", { name: /^Sali Ahmadou/ }));
  await user.click(await screen.findByRole("menuitem", { name: "Sign out" }));
  const signIn = await screen.findByRole("button", { name: "Sign in" });
  const from = recorded.requests.length;
  await user.clear(screen.getByLabelText("Workspace"));
  await user.type(screen.getByLabelText("Workspace"), identity.workspaceSlug);
  await user.clear(screen.getByLabelText("Username"));
  await user.type(screen.getByLabelText("Username"), "herve");
  await user.type(screen.getByLabelText("PIN code"), "666666");
  await user.click(signIn);

  // The technician opens on the Maintenance Overview (#665), not on the admin's Home.
  await screen.findByRole("heading", { name: "Maintenance" });
  await waitFor(() =>
    expect(recorded.requests.slice(from).some((request) => request.url.pathname === "/v1/maintenance/summary")).toBe(true),
  );
  // The app asks the workshop's own profile; the recent entries it would show an admin never load.
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

describe("any 401 ends the session (T4)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    clearSessionEndedNotice();
  });

  it("ends it when a read answers 401, and leaves a notice for the sign-in screen", async () => {
    sessionStore.save({ ...identity, token: "revoked", expiresAt: "2099-01-01T00:00:00.000Z" });
    await appQueryClient
      .fetchQuery({ queryKey: ["ws", identity.workspaceSlug, "members"], queryFn: () => Promise.reject(new Error("MEMBERS_401")), retry: false })
      .catch(() => undefined);

    expect(sessionStore.getActive()).toBeUndefined();
    expect(sessionEndedNotice()).toBe(true);
  });

  it("ends it when a command is refused for a dead token", async () => {
    sessionStore.save({ ...identity, token: "revoked", expiresAt: "2099-01-01T00:00:00.000Z" });
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ error: { code: "AUTH_INVALID_TOKEN" } }), { status: 401 }));
    const result = await commandClient.submit({
      name: "add-note",
      version: 1,
      envelope: { commandId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), origin: "HUMAN_UI", sourceArtifactIds: [] },
      payload: {},
    } satisfies CommandSubmission<Record<string, never>>);

    expect(result).toMatchObject({ ok: false, code: "AUTH_INVALID_TOKEN" });
    expect(sessionStore.getActive()).toBeUndefined();
    expect(sessionEndedNotice()).toBe(true);
  });

  it("leaves the session alone for any other refusal", async () => {
    sessionStore.save({ ...identity, token: "token", expiresAt: "2099-01-01T00:00:00.000Z" });
    await appQueryClient
      .fetchQuery({ queryKey: ["ws", identity.workspaceSlug, "members"], queryFn: () => Promise.reject(new Error("MEMBERS_403")), retry: false })
      .catch(() => undefined);

    expect(sessionStore.getActive()).toBeDefined();
    expect(sessionEndedNotice()).toBe(false);
  });
});
