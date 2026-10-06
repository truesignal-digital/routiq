// @vitest-environment jsdom
import { QueryClient } from "@tanstack/react-query";
import { isRedirect } from "@tanstack/react-router";
import { afterEach, expect, it, vi } from "vitest";
import { sessionStore } from "../auth/store.js";
import { loadShell } from "./shell-loader.js";

const identity = { username: "ada", workspaceSlug: "transports-douala" };

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStore.logout(identity);
});

function serve(meStatus: number) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), "http://app.test").pathname;
    if (path === "/v1/me") {
      return meStatus === 200
        ? Response.json({ workspaceId: "w", principalId: "p", principalType: "USER", membershipId: "m", role: "DIRECTOR", branchScope: "ALL", enabledModules: [], enabledPresets: ["TRUCKING"] })
        : new Response(null, { status: meStatus });
    }
    if (path === "/v1/approval-chain") return Response.json({ steps: [], notice: null });
    if (path === "/v1/reference/asset-registration") return Response.json({ assetClasses: [], branches: [] });
    throw new Error(`unexpected ${path}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

it("loads the member before the shell draws, and the notice and branches with it", async () => {
  const fetchMock = serve(200);
  sessionStore.save({ ...identity, token: "t", expiresAt: "2099-01-01T00:00:00Z" });
  const client = new QueryClient();
  const me = await loadShell(client, "/assets");
  expect(me.role).toBe("DIRECTOR");
  const paths = fetchMock.mock.calls.map(([input]) => new URL(String(input), "http://app.test").pathname).sort();
  expect(paths).toEqual(["/v1/approval-chain", "/v1/me", "/v1/reference/asset-registration"]);
});

it("ends the session and sends a dead token back to the PIN, then to where it was going", async () => {
  serve(401);
  sessionStore.save({ ...identity, token: "t", expiresAt: "2099-01-01T00:00:00Z" });
  const client = new QueryClient();
  const outcome = await loadShell(client, "/assets?status=ACTIVE").catch((error: unknown) => error);
  expect(isRedirect(outcome)).toBe(true);
  expect((outcome as { options: { to: string; search: unknown } }).options).toMatchObject({ to: "/login", search: { redirect: "/assets?status=ACTIVE" } });
  expect(sessionStore.getActive()).toBeUndefined();
});
