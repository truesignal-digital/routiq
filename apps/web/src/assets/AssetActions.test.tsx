// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../i18n/index.js";
import { MeCtx, type MeContext } from "../auth/me.js";
import { sessionStore } from "../auth/store.js";
import type { CommandClient, SubmitResult } from "../commands/client.js";
import type { AssetListItem } from "@routiq/contracts";
import { AssetActions, assetActions } from "./AssetActions.js";

const mocks = vi.hoisted(() => ({ toastAdd: vi.fn() }));

vi.mock("@/components/ui/toast.js", () => ({
  toast: { add: mocks.toastAdd },
}));

const sessionIdentity = { username: "amina", workspaceSlug: "sotrafret" };

beforeEach(() => {
  vi.clearAllMocks();
  sessionStore.save({
    ...sessionIdentity,
    token: "token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
});

afterEach(() => {
  sessionStore.logout(sessionIdentity);
  cleanup();
});

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
  displayName: "Sali Ahmadou",
  workspaceName: "Transports Ngwa",
  role: "ADMIN",
  branchScope: "ALL",
  enabledModules: ["CORE", "ASSETS"],
  enabledPresets: ["TRUCKING", "PASSENGER_TRANSPORT"],
  timezone: "Africa/Douala",
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
  queryClient = new QueryClient(),
) {
  return render(
    <QueryClientProvider client={queryClient}>
      <MeCtx.Provider value={me}>
        <AssetActions asset={asset} client={client} />
      </MeCtx.Provider>
    </QueryClientProvider>,
  );
}

/** Opens the dialog the way an operator does, from the button row. */
async function openDialog(name: RegExp | string) {
  await userEvent.click(screen.getByRole("button", { name }));
  return screen.findByRole("dialog");
}

const committed: SubmitResult = {
  ok: true,
  outcome: {
    commandId: "c1",
    recordId: "a1",
    rowVersion: 5,
    warnings: [],
    idempotentReplay: false,
  },
};

describe("which actions an asset offers", () => {
  it("REGISTERED offers commission and assign", () => {
    for (const role of ["DIRECTOR", "ADMIN"] as const) {
      expect(assetActions(baseAsset, role, ["CORE", "ASSETS"])).toEqual(["commission", "assign"]);
    }
  });

  it("IN_SERVICE drops commission and keeps assign", () => {
    expect(
      assetActions(
        { ...baseAsset, lifecycleStatus: "IN_SERVICE" },
        "ADMIN",
        ["CORE", "ASSETS"],
      ),
    ).toEqual(["assign"]);
  });

  /** §3.4: nothing operational happens to an asset that has left the fleet. */
  it("offers nothing on a disposed asset, whatever the role", () => {
    for (const status of ["SOLD", "RETIRED", "WRITTEN_OFF"] as const) {
      expect(
        assetActions({ ...baseAsset, lifecycleStatus: status }, "ADMIN", [
          "CORE",
          "ASSETS",
        ]),
        status,
      ).toEqual([]);
    }
  });

  it("follows each command's roles: no transfer for the field, no commission for finance", () => {
    expect(assetActions(baseAsset, "DRIVER", ["CORE", "ASSETS"])).toEqual([]);
    expect(assetActions(baseAsset, "TECHNICIAN", ["CORE", "ASSETS"])).toEqual([]);
    expect(assetActions(baseAsset, "FINANCE", ["CORE", "ASSETS"])).toEqual([
      "assign",
    ]);
    for (const role of ["DIRECTOR", "ADMIN"] as const) {
      expect(assetActions(baseAsset, role, ["CORE", "ASSETS"])).toEqual(["commission", "assign"]);
    }
  });

  it("offers nothing to a viewer role, or without the module", () => {
    expect(assetActions(baseAsset, "CASHIER", ["CORE", "ASSETS"])).toEqual(
      [],
    );
    expect(assetActions(baseAsset, "ADMIN", ["CORE"])).toEqual([]);
  });
});

describe("status-gated visibility", () => {
  it("REGISTERED shows commission + assign", () => {
    renderActions(baseAsset, fakeClient({ ok: false, code: "COMMAND_FAILED" }));
    expect(screen.getByRole("button", { name: "Mettre en service" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Changer d'agence" })).toBeTruthy();
  });

  it("IN_SERVICE hides commission, keeps assign", () => {
    renderActions(
      { ...baseAsset, lifecycleStatus: "IN_SERVICE" },
      fakeClient({ ok: false, code: "COMMAND_FAILED" }),
    );
    expect(screen.queryByRole("button", { name: "Mettre en service" })).toBeNull();
    expect(screen.getByRole("button", { name: "Changer d'agence" })).toBeTruthy();
  });

  it("RETIRED renders nothing; CASHIER renders nothing", () => {
    renderActions(
      { ...baseAsset, lifecycleStatus: "RETIRED" },
      fakeClient({ ok: false, code: "COMMAND_FAILED" }),
    );
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    renderActions(baseAsset, fakeClient({ ok: false, code: "COMMAND_FAILED" }), {
      ...admin,
      role: "CASHIER",
    });
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("committed actions", () => {
  it("confirms a commission with a toast instead of closing the dialog in silence", async () => {
    renderActions(baseAsset, fakeClient(committed));

    await openDialog("Mettre en service");
    await userEvent.click(screen.getByRole("button", { name: "Mettre en service" }));

    await waitFor(() =>
      expect(mocks.toastAdd).toHaveBeenCalledWith({
        type: "success",
        title: "Actif mis en service",
      }),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("invalidates the asset list alone, not every workspace read", async () => {
    const queryClient = new QueryClient();
    const keys: unknown[][] = [];
    const original = queryClient.invalidateQueries.bind(queryClient);
    queryClient.invalidateQueries = ((filters?: { queryKey?: unknown[] }) => {
      if (filters?.queryKey !== undefined) keys.push(filters.queryKey);
      return original(filters);
    }) as QueryClient["invalidateQueries"];

    renderActions(baseAsset, fakeClient(committed), admin, queryClient);
    await openDialog("Mettre en service");
    await userEvent.click(screen.getByRole("button", { name: "Mettre en service" }));

    await waitFor(() => expect(keys.length).toBe(1));
    expect(keys[0]).toEqual(["ws", "sotrafret", "assets"]);
  });

  /** A branch nobody picked would be a transfer nobody asked for. */
  it("holds the assign command until a branch is chosen", async () => {
    const client = fakeClient(committed);
    renderActions({ ...baseAsset, lifecycleStatus: "IN_SERVICE" }, client);

    await openDialog("Changer d'agence");

    expect(screen.getByRole("button", { name: "Changer d'agence" })).toHaveProperty(
      "disabled",
      true,
    );
    expect(client.seen).toHaveLength(0);
  });
});

describe("designed failure states", () => {
  it("VERSION_CONFLICT shows the modified-elsewhere prompt with reload, and the envelope carried the rendered rowVersion", async () => {
    const client = fakeClient({ ok: false, code: "VERSION_CONFLICT" });
    renderActions(baseAsset, client);

    await openDialog("Mettre en service");
    await userEvent.click(screen.getByRole("button", { name: "Mettre en service" }));

    await waitFor(() => expect(screen.getByText("Modifié ailleurs")).toBeTruthy());
    expect(screen.getByRole("button", { name: "Actualiser" })).toBeTruthy();
    expect(
      (client.seen[0] as { envelope: { expectedVersion?: number } }).envelope
        .expectedVersion,
    ).toBe(4);
  });

  it("APPROVAL_REQUIRED shows the informative approval state, not an error alert", async () => {
    renderActions(baseAsset, fakeClient({ ok: false, code: "APPROVAL_REQUIRED" }));

    await openDialog("Mettre en service");
    await userEvent.click(screen.getByRole("button", { name: "Mettre en service" }));

    await waitFor(() => expect(screen.getByText("Approbation requise")).toBeTruthy());
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /** The outcome stays on screen: a dialog that closed itself would hide it. */
  it("keeps the failure inside the dialog rather than firing a toast", async () => {
    renderActions(baseAsset, fakeClient({ ok: false, code: "COMMAND_FAILED" }));

    await openDialog("Mettre en service");
    await userEvent.click(screen.getByRole("button", { name: "Mettre en service" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(mocks.toastAdd).not.toHaveBeenCalled();
  });
});
