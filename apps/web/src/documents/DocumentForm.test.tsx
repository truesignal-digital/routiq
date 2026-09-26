// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { sessionStore } from "../auth/store.js";
import type { CommandClient, SubmitResult } from "../commands/client.js";
import { i18n } from "../i18n/index.js";
import { DocumentForm } from "./DocumentForm.js";
import type { AssetDocument } from "./model.js";

const mocks = vi.hoisted(() => ({ toastAdd: vi.fn(), useCategories: vi.fn() }));

vi.mock("@/components/ui/toast.js", () => ({ toast: { add: mocks.toastAdd } }));
vi.mock("./useCategories.js", () => ({ useCategories: mocks.useCategories }));

const ASSET_ID = "00000000-0000-4000-8000-000000000004";
const OLD_DOCUMENT_ID = "00000000-0000-4000-8000-000000000070";
const sessionIdentity = { username: "amina", workspaceSlug: "sotrafret" };

const insurance: AssetDocument = {
  id: OLD_DOCUMENT_ID,
  type: { code: "INSURANCE", labelFr: "Assurance", labelEn: "Insurance" },
  title: "Chanas Assurances",
  documentNumber: "POL-2025-118",
  issuedAt: "2025-09-20",
  expiresAt: "2026-09-19",
  supersedesDocumentId: null,
  supersededByDocumentId: null,
  createdAt: "2025-09-20T08:00:00.000Z",
};

type Seen = { name: string; payload: Record<string, unknown> };

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
  outcome: { commandId: "c1", recordId: "d1", rowVersion: 1, warnings: [], idempotentReplay: false },
};

function inPanel(node: ReactNode) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Sheet open>
        <SheetContent>{node}</SheetContent>
      </Sheet>
    </QueryClientProvider>,
  );
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

beforeEach(() => {
  vi.clearAllMocks();
  sessionStore.save({
    ...sessionIdentity,
    token: "token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  mocks.useCategories.mockReturnValue({
    data: [{ code: "INSURANCE", labelFr: "Assurance", labelEn: "Insurance" }],
    isPending: false,
    isError: false,
  });
});

afterEach(() => {
  sessionStore.logout(sessionIdentity);
  cleanup();
});

describe("DocumentForm on a vehicle's record panel", () => {
  it("renews: the vehicle and the document type are fixed, and the new one supersedes the old", async () => {
    const client = recordingClient(committed);
    const onDone = vi.fn();
    inPanel(
      <DocumentForm
        surface="panel"
        pinnedAssetId={ASSET_ID}
        pinnedAssetLabel="DLA-T-001 · Mercedes Actros"
        renews={insurance}
        back={{ label: "Insurance", onBack: vi.fn() }}
        client={client}
        onDone={onDone}
        onDismiss={vi.fn()}
      />,
    );

    const panel = screen.getByRole("dialog", { name: "Renew Chanas Assurances" });
    expect(within(panel).getByText("DLA-T-001 · Mercedes Actros")).toBeTruthy();
    expect(within(panel).getByLabelText("Document type").getAttribute("data-disabled")).not.toBeNull();
    // Pre-filled from the document being renewed.
    expect((within(panel).getByLabelText("Number") as HTMLInputElement).value).toBe("POL-2025-118");

    const expires = within(panel).getByLabelText("Expires");
    await userEvent.clear(expires);
    await userEvent.type(expires, "2027-09-19");
    await userEvent.click(within(panel).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
    expect(client.seen[0]!.name).toBe("add-or-renew-document");
    expect(client.seen[0]!.payload).toMatchObject({
      assetId: ASSET_ID,
      documentTypeCode: "INSURANCE",
      supersedesDocumentId: OLD_DOCUMENT_ID,
      expiresAt: "2027-09-19",
    });
    expect(mocks.toastAdd).toHaveBeenCalledWith({ type: "success", title: "Document renewed" });
  });

  it("answers an already-superseded renewal as information, keeping the form", async () => {
    const onDismiss = vi.fn();
    inPanel(
      <DocumentForm
        surface="panel"
        pinnedAssetId={ASSET_ID}
        pinnedAssetLabel="DLA-T-001"
        renews={insurance}
        client={recordingClient({ ok: false, code: "DOCUMENT_ALREADY_SUPERSEDED" })}
        onDismiss={onDismiss}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
