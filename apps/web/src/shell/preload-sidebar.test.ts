import { QueryClient } from "@tanstack/react-query";
import type { ModuleCode, Role } from "@routiq/contracts";
import { MODULE_CODES } from "@routiq/contracts";
import { afterEach, expect, it } from "vitest";
import type { MeContext } from "../auth/me.js";
import { sessionStore } from "../auth/store.js";
import { preloadSidebarScreens } from "./preload-sidebar.js";

const identity = { username: "ada", workspaceSlug: "transports-douala" };

afterEach(() => sessionStore.logout(identity));

async function preloadedAs(role: Role, modules: readonly ModuleCode[] = MODULE_CODES): Promise<string[]> {
  sessionStore.save({ ...identity, token: "t", expiresAt: "2099-01-01T00:00:00Z" });
  const client = new QueryClient();
  const me: MeContext = {
    workspaceId: "w",
    principalId: "p",
    principalType: "HUMAN",
    membershipId: "m",
    role,
    branchScope: "ALL",
    enabledModules: [...modules],
    enabledPresets: ["TRUCKING"],
  };
  client.setQueryData(["ws", identity.workspaceSlug, "me"], me);
  const preloaded: string[] = [];
  await preloadSidebarScreens({ preloadRoute: async ({ to }) => void preloaded.push(to) }, client);
  return preloaded;
}

it("preloads every row Direction sees, in sidebar order, but not Home", async () => {
  expect(await preloadedAs("DIRECTOR")).toEqual(["/assets", "/activities", "/maintenance", "/finance/entries", "/more"]);
});

it("never preloads a screen the role cannot see (#497)", async () => {
  expect(await preloadedAs("TECHNICIAN")).not.toContain("/finance/entries");
  const cashier = await preloadedAs("CASHIER");
  expect(cashier).not.toContain("/activities");
  expect(cashier).not.toContain("/maintenance");
});

it("never preloads a screen whose module is off", async () => {
  expect(await preloadedAs("DIRECTOR", ["ASSETS"])).toEqual(["/assets", "/more"]);
});
