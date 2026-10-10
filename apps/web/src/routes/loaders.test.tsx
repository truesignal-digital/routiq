// @vitest-environment jsdom
import { act, cleanup, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ASSET_ID } from "../vehicle/test/fixtures.js";
import { closeVehicle, openVehicle, requested } from "../vehicle/test/harness.js";

// The shared command client captures `fetch` at import; route it through the stub.
vi.mock("../commands/instance.js", async () => {
  const { createCommandClient } = await import("../commands/client.js");
  const { CommandStatusStore } = await import("../commands/store.js");
  const { sessionStore } = await import("../auth/store.js");
  const commandStatusStore = new CommandStatusStore();
  return {
    commandStatusStore,
    commandClient: createCommandClient({
      store: commandStatusStore,
      getToken: () => sessionStore.getToken(),
      fetchImpl: (input, init) => globalThis.fetch(input, init),
    }),
  };
});

afterEach(async () => {
  cleanup();
  await closeVehicle();
});

it("asks for a screen's data once, and not again when the screen is reopened within 30 s (#496)", async () => {
  const { recorded, router } = await openVehicle(`/assets/${ASSET_ID}`, { role: "DIRECTOR" });
  await screen.findByRole("heading", { level: 1 });
  expect(requested(recorded, `/v1/assets/${ASSET_ID}`)).toHaveLength(1);
  expect(requested(recorded, `/v1/assets/${ASSET_ID}/attention`)).toHaveLength(1);

  await act(async () => {
    await router.navigate({ to: "/assets" });
  });
  await act(async () => {
    await router.navigate({ to: "/assets/$assetId", params: { assetId: ASSET_ID } });
  });
  await screen.findByRole("heading", { level: 1 });

  expect(requested(recorded, `/v1/assets/${ASSET_ID}`)).toHaveLength(1);
  expect(requested(recorded, `/v1/assets/${ASSET_ID}/attention`)).toHaveLength(1);
});

/** What the Maintenance page's loader asks for (routes/maintenance.loader.ts). */
function maintenanceReads(recorded: Awaited<ReturnType<typeof openVehicle>>["recorded"]): string[] {
  return [
    ...requested(recorded, "/v1/maintenance/summary"),
    ...requested(recorded, "/v1/work-orders"),
    ...requested(recorded, "/v1/issues"),
    ...requested(recorded, "/v1/categories").filter((url) => url.searchParams.get("kind") === "ISSUE_TYPE"),
  ].map((url) => `${url.pathname}${url.search}`);
}

it("starts no reads for a page whose module is off: the page gate answers instead (#496, #326)", async () => {
  const { recorded } = await openVehicle("/maintenance", {
    role: "DIRECTOR",
    modules: ["ASSETS", "DOCUMENTS", "FINANCE", "ACTIVITIES"],
  });
  expect(await screen.findByText("This module is not enabled for your company.")).toBeTruthy();
  expect(maintenanceReads(recorded)).toEqual([]);
});

it("starts the same page's reads while its module is on", async () => {
  const { recorded } = await openVehicle("/maintenance", {
    role: "DIRECTOR",
    modules: ["ASSETS", "DOCUMENTS", "FINANCE", "ACTIVITIES", "MAINTENANCE"],
  });
  await screen.findByRole("heading", { level: 1, name: "Maintenance" });
  expect(maintenanceReads(recorded).length).toBeGreaterThan(0);
});
