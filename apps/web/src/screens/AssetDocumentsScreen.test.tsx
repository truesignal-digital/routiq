// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { MeCtx, type MeContext } from "../auth/me.js";
import { sessionStore } from "../auth/store.js";
import { i18n } from "../i18n/index.js";

const ASSET_ID = "00000000-0000-4000-8000-000000000010";
const DOCUMENT_ID = "00000000-0000-4000-8000-000000000020";
const sessionIdentity = { username: "amina", workspaceSlug: "sotrafret" };

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  useAssetDocuments: vi.fn(),
  useCategories: vi.fn(),
  toastAdd: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ assetId: ASSET_ID }),
}));

vi.mock("@/components/ui/toast.js", () => ({
  toast: { add: mocks.toastAdd },
}));

vi.mock("../commands/instance.js", () => ({
  commandClient: { submit: mocks.submit },
}));

vi.mock("../documents/useDocuments.js", () => ({
  useAssetDocuments: mocks.useAssetDocuments,
}));

vi.mock("../documents/useCategories.js", () => ({
  useCategories: mocks.useCategories,
}));

vi.mock("../components/ui/file-upload.js", () => ({
  FileUpload: () => null,
}));

const { AssetDocumentsScreen } = await import("./AssetDocumentsScreen.js");

const manager: MeContext = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  principalId: "00000000-0000-4000-8000-000000000002",
  principalType: "HUMAN",
  membershipId: "00000000-0000-4000-8000-000000000003",
  role: "OPS_MANAGER",
  branchScope: "ALL",
  enabledModules: ["CORE", "DOCUMENTS"],
  enabledPresets: ["TRUCKING", "PASSENGER_TRANSPORT"],
};

/** Records every key handed to `invalidateQueries` on a real client. */
function recordingClient(): { client: QueryClient; keys: unknown[][] } {
  const client = new QueryClient();
  const keys: unknown[][] = [];
  const original = client.invalidateQueries.bind(client);
  client.invalidateQueries = ((filters?: { queryKey?: unknown[] }) => {
    if (filters?.queryKey !== undefined) keys.push(filters.queryKey);
    return original(filters);
  }) as QueryClient["invalidateQueries"];
  return { client, keys };
}

function renderScreen(client = new QueryClient()) {
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        MeCtx.Provider,
        { value: manager },
        createElement(AssetDocumentsScreen),
      ),
    ),
  );
}

async function fillAndSave(user: ReturnType<typeof userEvent.setup>) {
  // The header action and the empty state both offer it.
  await user.click(screen.getAllByRole("button", { name: "Add a document" })[0]!);
  await user.click(screen.getByLabelText("Document type"));
  await user.keyboard("{ArrowDown}{Enter}");
  await user.click(screen.getByRole("button", { name: "Save" }));
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(DOCUMENT_ID);
  sessionStore.save({
    ...sessionIdentity,
    token: "token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  mocks.useAssetDocuments.mockReturnValue({
    data: { documents: [] },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
  mocks.useCategories.mockReturnValue({
    data: [{ code: "INSURANCE", labelFr: "Assurance", labelEn: "Insurance" }],
    isPending: false,
    isError: false,
  });
  mocks.submit.mockResolvedValue({
    ok: true,
    outcome: {
      commandId: DOCUMENT_ID,
      recordId: DOCUMENT_ID,
      rowVersion: 1,
      warnings: [],
      idempotentReplay: false,
    },
  });
});

afterEach(() => {
  sessionStore.logout(sessionIdentity);
  vi.restoreAllMocks();
  cleanup();
});

describe("asset documents", () => {
  it("confirms a saved document with a toast instead of closing in silence", async () => {
    const user = userEvent.setup();
    renderScreen();

    await fillAndSave(user);

    await waitFor(() =>
      expect(mocks.toastAdd).toHaveBeenCalledWith({
        type: "success",
        title: "Document saved",
      }),
    );
  });

  it("invalidates this asset's documents alone, not every workspace read", async () => {
    const { client, keys } = recordingClient();
    const user = userEvent.setup();
    renderScreen(client);

    await fillAndSave(user);

    await waitFor(() => expect(keys.length).toBe(1));
    expect(keys[0]).toEqual(["ws", "sotrafret", "asset", ASSET_ID, "documents"]);
  });
});
