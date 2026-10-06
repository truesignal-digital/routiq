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
