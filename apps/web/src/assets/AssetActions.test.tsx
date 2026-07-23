// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import "../i18n/index.js";
import { MeCtx, type MeContext } from "../auth/me.js";
import type { CommandClient, SubmitResult } from "../commands/client.js";
import type { AssetListItem } from "./model.js";
import { AssetActions } from "./AssetActions.js";

afterEach(cleanup);

const baseAsset: AssetListItem = {
  id: "a1",
  assetCode: "DLA-T-001",
  registrationNumber: null,
  manufacturer: "Mercedes",
  model: "Actros",
  lifecycleStatus: "REGISTERED",
  rowVersion: 4,
  category: { code: "TRUCK", labelFr: "Camion", labelEn: "Truck" },
  branch: { code: "DLA", name: "Douala" },
};

const admin: MeContext = {
  workspaceId: "ws",
  principalId: "p",
  principalType: "HUMAN",
  membershipId: "m",
  role: "ADMIN",
  branchScope: "ALL",
  enabledModules: ["CORE", "ASSETS"],
};

function fakeClient(result: SubmitResult): CommandClient & { seen: unknown[] } {
  const seen: unknown[] = [];
  return {
    seen,
    submit: async (submission) => {
      seen.push(submission);
      return result;
    },
  };
}

function renderActions(
  asset: AssetListItem,
  client: CommandClient,
  me: MeContext = admin,
) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MeCtx.Provider value={me}>
        <AssetActions asset={asset} client={client} />
      </MeCtx.Provider>
    </QueryClientProvider>,
  );
}

describe("status-gated visibility", () => {
  it("REGISTERED shows commission + assign", () => {
    renderActions(baseAsset, fakeClient({ ok: false, code: "COMMAND_FAILED" }));
    expect(screen.getByRole("button", { name: "Mettre en service" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Affecter" })).toBeTruthy();
  });

  it("IN_SERVICE hides commission, keeps assign", () => {
    renderActions(
      { ...baseAsset, lifecycleStatus: "IN_SERVICE" },
      fakeClient({ ok: false, code: "COMMAND_FAILED" }),
    );
    expect(screen.queryByRole("button", { name: "Mettre en service" })).toBeNull();
    expect(screen.getByRole("button", { name: "Affecter" })).toBeTruthy();
  });

  it("RETIRED renders nothing; EXECUTIVE_VIEWER renders nothing", () => {
    renderActions(
      { ...baseAsset, lifecycleStatus: "RETIRED" },
      fakeClient({ ok: false, code: "COMMAND_FAILED" }),
    );
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    renderActions(baseAsset, fakeClient({ ok: false, code: "COMMAND_FAILED" }), {
      ...admin,
      role: "EXECUTIVE_VIEWER",
    });
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("designed failure states", () => {
  it("VERSION_CONFLICT shows the modified-elsewhere prompt with reload, and the envelope carried the rendered rowVersion", async () => {
    const client = fakeClient({ ok: false, code: "VERSION_CONFLICT" });
    renderActions(baseAsset, client);
    await userEvent.click(screen.getByRole("button", { name: "Mettre en service" }));
    await waitFor(() => expect(screen.getByText("Modifié ailleurs")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Actualiser" })).toBeTruthy();
    expect(
      (client.seen[0] as { envelope: { expectedVersion?: number } }).envelope.expectedVersion,
    ).toBe(4);
  });

  it("APPROVAL_REQUIRED shows the informative approval state, not an error alert", async () => {
    renderActions(baseAsset, fakeClient({ ok: false, code: "APPROVAL_REQUIRED" }));
    await userEvent.click(screen.getByRole("button", { name: "Mettre en service" }));
    await waitFor(() => expect(screen.getByText("Approbation requise")).toBeTruthy());
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
