// @vitest-environment jsdom
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
import { toRecordExpensePayload } from "../finance/model.js";
import { i18n } from "../i18n/index.js";
import { FinanceRecordScreen } from "./FinanceRecordScreen.js";

const ENTRY_ID = "00000000-0000-4000-8000-000000000010";
const ARTIFACT_ID = "00000000-0000-4000-8000-000000000020";
const sessionIdentity = { username: "amina", workspaceSlug: "sotrafret" };

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  submit: vi.fn(),
  uploadArtifact: vi.fn(),
  useAssetRegistrationReference: vi.fn(),
  useCategories: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("../commands/instance.js", () => ({
  commandClient: {
    submit: mocks.submit,
  },
}));

vi.mock("../artifacts/upload.js", () => ({
  downscaleImage: (file: File) => Promise.resolve(file),
  uploadArtifact: mocks.uploadArtifact,
}));

vi.mock("../assets/reference.js", () => ({
  useAssetRegistrationReference: mocks.useAssetRegistrationReference,
}));

vi.mock("../documents/useCategories.js", () => ({
  useCategories: mocks.useCategories,
}));

vi.mock("../finance/FinanceNav.js", () => ({
  FinanceNav: () => null,
}));

const submitter: MeContext = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  principalId: "00000000-0000-4000-8000-000000000002",
  principalType: "HUMAN",
  membershipId: "00000000-0000-4000-8000-000000000003",
  role: "FIELD_SUBMITTER",
  branchScope: "ALL",
  enabledModules: ["CORE", "FINANCE"],
};

function renderScreen() {
  return render(
    createElement(
      MeCtx.Provider,
      { value: submitter },
      createElement(FinanceRecordScreen),
    ),
  );
}

async function chooseFuelCategory(user: ReturnType<typeof userEvent.setup>) {
  const category = screen.getByLabelText("Category");
  await user.click(category);
  await user.keyboard("{ArrowDown}{Enter}");
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(ENTRY_ID);
  sessionStore.save({
    ...sessionIdentity,
    token: "token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  mocks.useAssetRegistrationReference.mockReturnValue({
    data: {
      assetClasses: [],
      branches: [{ code: "DLA", name: "Douala" }],
    },
    isPending: false,
    isError: false,
  });
  mocks.useCategories.mockReturnValue({
    data: [{ code: "FUEL", labelFr: "Carburant", labelEn: "Fuel" }],
    isPending: false,
    isError: false,
  });
  mocks.submit.mockResolvedValue({
    ok: true,
    outcome: {
      commandId: ENTRY_ID,
      recordId: ENTRY_ID,
      rowVersion: 1,
      recordStatus: "POSTED",
      warnings: [],
      idempotentReplay: false,
    },
  });
  mocks.uploadArtifact.mockImplementation(async (artifactId: string, file: Blob) => ({
    ok: true,
    artifact: { id: artifactId, sha256: "abc123", sizeBytes: file.size },
  }));
});

afterEach(() => {
  sessionStore.logout(sessionIdentity);
  vi.restoreAllMocks();
  cleanup();
});

describe("finance record form", () => {
  it("blocks submission when the amount is invalid", async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseFuelCategory(user);

    await user.type(screen.getByLabelText("Amount (XAF)"), "0");
    await user.click(screen.getByRole("button", { name: "Record" }));

    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("dispatches the unchanged expense payload for a valid form", async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseFuelCategory(user);

    const amount = screen.getByLabelText("Amount (XAF)");
    await user.type(amount, "125000");
    await user.tab();
    expect((amount as HTMLInputElement).value).toBe("125 000");
    await user.type(screen.getByLabelText("Counterparty (optional)"), "Fuel Station");
    await user.type(screen.getByLabelText("Description (optional)"), "Diesel");
    await user.type(screen.getByLabelText("Payment reference (optional)"), "R-42");
    await user.type(screen.getByLabelText("Asset (optional)"), "asset-123");
    await user.click(screen.getByRole("button", { name: "Record" }));

    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    const submission = mocks.submit.mock.calls[0]?.[0];
    expect(submission.payload).toEqual(
      toRecordExpensePayload({
        entryId: ENTRY_ID,
        branchCode: "DLA",
        economicDate: new Date().toISOString().split("T")[0]!,
        categoryCode: "FUEL",
        amountMinor: 125_000,
        paymentMethod: "CASH",
        counterpartyName: "Fuel Station",
        description: "Diesel",
        paymentReference: "R-42",
        assetId: "asset-123",
      }),
    );
  });

  it("dispatches completed evidence uploads as source artifact ids", async () => {
    const user = userEvent.setup();
    renderScreen();
    vi.mocked(globalThis.crypto.randomUUID).mockReturnValue(ARTIFACT_ID);
    await chooseFuelCategory(user);

    await user.upload(
      screen.getByLabelText("Drop files here or click to choose"),
      new File(["receipt"], "receipt.jpg", { type: "image/jpeg" }),
    );
    await waitFor(() => expect(screen.queryByRole("progressbar")).toBeNull());
    await user.type(screen.getByLabelText("Amount (XAF)"), "125000");
    await user.click(screen.getByRole("button", { name: "Record" }));

    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    expect(mocks.submit.mock.calls[0]?.[0].envelope.sourceArtifactIds).toEqual([
      ARTIFACT_ID,
    ]);
  });

  it("preselects the branch when the workspace has only one", async () => {
    renderScreen();

    await waitFor(() =>
      expect(screen.getByLabelText("Branch").textContent).toContain("DLA"),
    );
  });

  it("shows localized labels in the closed select triggers, never raw codes", async () => {
    const user = userEvent.setup();
    renderScreen();

    // Defaults to CASH without the popup ever opening.
    const payment = screen.getByLabelText("Payment method");
    expect(payment.textContent).toContain("Cash");
    expect(payment.textContent).not.toContain("CASH");

    await waitFor(() =>
      expect(screen.getByLabelText("Branch").textContent).toContain("Douala"),
    );

    await chooseFuelCategory(user);
    const category = screen.getByLabelText("Category");
    expect(category.textContent).toContain("Fuel");
    expect(category.textContent).not.toContain("FUEL");
  });

  it("renders the direction toggle as a stock tabs pill", () => {
    renderScreen();

    const list = screen.getByRole("tablist");
    expect(list.className).toContain("bg-muted");
    expect(
      list.className
        .split(/\s+/)
        .filter((c) => c.startsWith("group-data-horizontal/tabs:h-")),
    ).toEqual(["group-data-horizontal/tabs:h-11"]);

    for (const tab of screen.getAllByRole("tab")) {
      // Sized by the strip; a height here would push the pill past its edges.
      expect(tab.className).toContain("h-[calc(100%-1px)]");
      expect(tab.className).not.toMatch(/(^|\s)min-h-/);
    }

    const active = screen.getByRole("tab", { name: "Expense" });
    expect(active.hasAttribute("data-active")).toBe(true);
    expect(active.className).toContain("data-active:bg-background");
    expect(active.className).toContain(
      "group-data-[variant=default]/tabs-list:data-active:shadow-sm",
    );
  });

  it("clears the chosen category when the direction flips", async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseFuelCategory(user);
    expect(screen.getByLabelText("Category").textContent).not.toContain(
      "Choose a category",
    );

    // Stock Tabs exposes the direction toggle as a tablist, not two buttons.
    await user.click(screen.getByRole("tab", { name: "Revenue" }));

    await waitFor(() =>
      expect(screen.getByLabelText("Category").textContent).toContain(
        "Choose a category",
      ),
    );
  });
});
