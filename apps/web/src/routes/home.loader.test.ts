import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ModuleCode, Role } from "@routiq/contracts";
import { ALL_BRANCHES } from "../shell/branch-context.js";

const member = vi.hoisted(() => ({ role: "DIRECTOR" as Role, enabledModules: ["CORE", "ASSETS", "FINANCE"] as ModuleCode[] }));

vi.mock("./scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./scope.js")>();
  return {
    ...actual,
    scope: async ({ context }: { context: { queryClient: QueryClient } }) => ({
      client: context.queryClient,
      slug: "transports-ngwa",
      me: { role: member.role, enabledModules: member.enabledModules },
      branch: ALL_BRANCHES,
    }),
  };
});

const { dashboardMoney, dashboardOverview, dashboardTodo, home } = await import("./home.loader.js");

/** The query keys a loader asked the cache for; nothing is fetched. */
async function keysOf(run: (args: { context: { queryClient: QueryClient } }) => Promise<void>): Promise<string[]> {
  const queryClient = new QueryClient();
  const keys: string[] = [];
  vi.spyOn(queryClient, "ensureQueryData").mockImplementation(async (options) => {
    keys.push((options.queryKey as unknown[]).slice(2).map((part) => (typeof part === "object" ? JSON.stringify(part) : String(part))).join("/"));
    return undefined;
  });
  vi.spyOn(queryClient, "ensureInfiniteQueryData").mockImplementation(async (options) => {
    keys.push((options.queryKey as unknown[]).slice(2, 4).join("/"));
    return undefined as never;
  });
  await run({ context: { queryClient } });
  return keys;
}

afterEach(() => {
  member.role = "DIRECTOR";
  member.enabledModules = ["CORE", "ASSETS", "FINANCE"];
});

describe("Home's loaders (#496, #666)", () => {
  it("start the Overview's reads for the range in the address, and not Home's own", async () => {
    expect(await keysOf((args) => dashboardOverview({ ...args, deps: { range: "3-months" } }))).toEqual([
      "finance/overview/THREE_MONTHS/ALL",
      "finance/todo",
      "coming-up/14",
      "assets/summary/{}",
    ]);
    expect(await keysOf(home)).toEqual([]);
  });

  it("start the money read on the profit tabs and To do on its tab", async () => {
    expect(await keysOf((args) => dashboardMoney({ ...args, deps: {} }))).toEqual(["finance/overview/THIS_MONTH/ALL"]);
    expect(await keysOf(dashboardTodo)).toEqual(["finance/todo"]);
  });

  it("start Home's tiles for a role without the Overview, and none of the Dashboard's reads", async () => {
    member.role = "CASHIER";
    expect(await keysOf(home)).toContain("dashboard/90/ALL");
    expect(await keysOf((args) => dashboardOverview({ ...args, deps: {} }))).toEqual([]);
    expect(await keysOf(dashboardTodo)).toEqual([]);
  });
});
