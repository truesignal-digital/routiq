// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import "../i18n/index.js";
import { sessionStore } from "../auth/store.js";
import type { CommandClient, SubmitResult } from "../commands/client.js";
import { AssetActionForm } from "./AssetActions.js";

const mocks = vi.hoisted(() => ({ toastAdd: vi.fn(), useAssetRegistrationReference: vi.fn() }));

vi.mock("@/components/ui/toast.js", () => ({ toast: { add: mocks.toastAdd } }));
vi.mock("./reference.js", () => ({
  useAssetRegistrationReference: mocks.useAssetRegistrationReference,
}));

const ASSET_ID = "00000000-0000-4000-8000-000000000004";
const MEMBERSHIP_ID = "00000000-0000-4000-8000-000000000090";
const sessionIdentity = { username: "amina", workspaceSlug: "sotrafret" };

type Seen = { name: string; payload: unknown; envelope: { expectedVersion?: number } };

function recordingClient(result: SubmitResult): CommandClient & { seen: Seen[] } {
  const seen: Seen[] = [];
  return {
    seen,
    submit: async (submission) => {
      seen.push(submission as Seen);
      return result;
    },
  };
}

const committed: SubmitResult = {
  ok: true,
  outcome: { commandId: "c1", recordId: ASSET_ID, rowVersion: 5, warnings: [], idempotentReplay: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  sessionStore.save({
    ...sessionIdentity,
    token: "token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  mocks.useAssetRegistrationReference.mockReturnValue({
    data: { assetClasses: [], branches: [{ code: "DLA", name: "Douala" }] },
    isPending: false,
    isError: false,
  });
});

afterEach(() => {
  sessionStore.logout(sessionIdentity);
  cleanup();
});

describe("AssetActionForm", () => {
  it("renders on a record panel and sends what the custodian slot contributes", async () => {
    const client = recordingClient(committed);
    const onDone = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Sheet open>
          <SheetContent>
            <AssetActionForm
              surface="panel"
              asset={{ id: ASSET_ID, lifecycleStatus: "IN_SERVICE", rowVersion: 4 }}
              action="assign"
              custodian={{
                field: <p>Custodian picker</p>,
                value: { custodianMembershipId: MEMBERSHIP_ID },
              }}
              back={{ label: "DLA-T-001", onBack: vi.fn() }}
              client={client}
              onDone={onDone}
              onDismiss={vi.fn()}
            />
          </SheetContent>
        </Sheet>
      </QueryClientProvider>,
    );

    expect(screen.getByRole("dialog", { name: "Changer d'agence" })).toBeTruthy();
    expect(screen.getByText("Custodian picker")).toBeTruthy();
    // A custodian alone is enough: no branch has to be picked with it.
    await userEvent.click(screen.getByRole("button", { name: "Changer d'agence" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledOnce());
    expect(client.seen[0]!.name).toBe("assign-asset");
    expect(client.seen[0]!.payload).toEqual({
      assetId: ASSET_ID,
      custodianMembershipId: MEMBERSHIP_ID,
    });
    expect(client.seen[0]!.envelope.expectedVersion).toBe(4);
  });
});
