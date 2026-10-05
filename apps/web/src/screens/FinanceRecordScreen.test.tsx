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
import { openSelect } from "../test-select.js";
import { FinanceRecordScreen } from "./FinanceRecordScreen.js";

const ENTRY_ID = "00000000-0000-4000-8000-000000000010";
const ARTIFACT_ID = "00000000-0000-4000-8000-000000000020";
const sessionIdentity = { username: "amina", workspaceSlug: "sotrafret" };

const ASSET_ID = "00000000-0000-4000-8000-000000000030";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  submit: vi.fn(),
  uploadArtifact: vi.fn(),
  useAssetRegistrationReference: vi.fn(),
  useCategories: vi.fn(),
  useAssets: vi.fn(),
  toastAdd: vi.fn(),
}));

vi.mock("@/components/ui/toast.js", () => ({
  toast: { add: mocks.toastAdd },
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

vi.mock("../assets/useAssets.js", () => ({
  useAssets: mocks.useAssets,
}));

vi.mock("../finance/FinanceNav.js", () => ({
  FinanceNav: () => null,
}));

const recorder: MeContext = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  principalId: "00000000-0000-4000-8000-000000000002",
  principalType: "HUMAN",
  membershipId: "00000000-0000-4000-8000-000000000003",
  role: "FINANCE",
  branchScope: "ALL",
  enabledModules: ["CORE", "FINANCE"],
  enabledPresets: ["TRUCKING", "PASSENGER_TRANSPORT"],
};

function renderScreen(me: MeContext = recorder) {
  return render(
    createElement(
      MeCtx.Provider,
      { value: me },
      createElement(FinanceRecordScreen),
    ),
  );
}

async function chooseFuelCategory(user: ReturnType<typeof userEvent.setup>) {
  const category = screen.getByLabelText("Category");
  await openSelect(user, category);
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
  mocks.useAssets.mockReturnValue({
    data: {
      pages: [
        {
          items: [
            {
              id: ASSET_ID,
              assetCode: "TR-001",
              registrationNumber: "LT-123-AB",
              manufacturer: "Iveco",
              model: "Stralis",
              lifecycleStatus: "IN_SERVICE",
              rowVersion: 1,
              category: { code: "TRUCK", labelFr: "Camion", labelEn: "Truck" },
              branch: { code: "DLA", name: "Douala" },
            },
          ],
          nextCursor: null,
        },
      ],
    },
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
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
    await user.click(screen.getByRole("button", { name: "Record the expense" }));

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
    await openSelect(user, screen.getByLabelText("Asset (optional)"));
    await user.keyboard("{ArrowDown}{Enter}");
    await user.click(screen.getByRole("button", { name: "Record the expense" }));

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
        assetId: ASSET_ID,
      }),
    );
  });

  it("offers the fleet as options instead of a raw UUID field", async () => {
    renderScreen();

    // The trigger shows what the entries filter shows: code — display name.
    expect(screen.getByLabelText("Asset (optional)").tagName).not.toBe("INPUT");
    await waitFor(() =>
      expect(screen.getByLabelText("Asset (optional)").textContent).toContain(
        "Assign to a vehicle",
      ),
    );
  });

  it("replaces the outcome panel with a toast and a jump to the entries list", async () => {
    const user = userEvent.setup();
    renderScreen();
    await chooseFuelCategory(user);

    await user.type(screen.getByLabelText("Amount (XAF)"), "125000");
    await user.click(screen.getByRole("button", { name: "Record the expense" }));

    await waitFor(() =>
      expect(mocks.toastAdd).toHaveBeenCalledWith({
        type: "success",
        title: "Transaction recorded and posted",
      }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith({ to: "/finance/entries" });
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("carries a server warning as a line on the same success toast", async () => {
    mocks.submit.mockResolvedValue({
      ok: true,
      outcome: {
        commandId: ENTRY_ID,
        recordId: ENTRY_ID,
        rowVersion: 1,
        recordStatus: "SUBMITTED",
        warnings: ["EVIDENCE_MISSING", "LATE_POSTING"],
        idempotentReplay: false,
      },
    });
    const user = userEvent.setup();
    renderScreen();
    await chooseFuelCategory(user);

    await user.type(screen.getByLabelText("Amount (XAF)"), "125000");
    await user.click(screen.getByRole("button", { name: "Record the expense" }));

    await waitFor(() =>
      expect(mocks.toastAdd).toHaveBeenCalledWith({
        type: "success",
        title: "Transaction sent for approval",
        description:
          "Missing evidence: this category requires supporting documentation or a photo.\n" +
          "This transaction was posted to a previous accounting period.",
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
    await user.click(screen.getByRole("button", { name: "Record the expense" }));

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

  it("aligns with the finance pages while keeping the fields readable", () => {
    const { container } = renderScreen();

    // Wide container so the heading lines up with entries/approvals/periods…
    expect(container.querySelector("section")?.className).toContain("max-w-6xl");
    // …but the form itself stays in a narrow column.
    const form = container.querySelector("form");
    expect(form?.closest(".max-w-xl")).not.toBeNull();
  });

  it("drops the finance tabs — it is an action page, not a section", () => {
    renderScreen();

    // Exactly one tablist: the Expense/Revenue toggle, not FinanceNav.
    expect(screen.getAllByRole("tablist")).toHaveLength(1);
    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Expense",
      "Revenue",
    ]);
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

  it("gives a driver expenses only: no revenue tab", () => {
    renderScreen({ ...recorder, role: "DRIVER" });
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("tab", { name: "Revenue" })).toBeNull();
  });

  it("keeps the cashier on a fresh form, since the entries list is not theirs", async () => {
    const user = userEvent.setup();
    renderScreen({ ...recorder, role: "CASHIER" });
    expect(screen.getByRole("tab", { name: "Revenue" })).toBeTruthy();
    await chooseFuelCategory(user);

    await user.type(screen.getByLabelText("Amount (XAF)"), "125000");
    await user.click(screen.getByRole("button", { name: "Record the expense" }));

    await waitFor(() => expect(mocks.toastAdd).toHaveBeenCalled());
    expect(mocks.navigate).not.toHaveBeenCalled();
    await waitFor(() => expect((screen.getByLabelText("Amount (XAF)") as HTMLInputElement).value).toBe(""));
  });

  it("turns the workshop away: its costs go on work orders", () => {
    renderScreen({ ...recorder, role: "TECHNICIAN" });
    expect(screen.queryByRole("button", { name: "Record the expense" })).toBeNull();
  });
});
