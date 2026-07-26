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
import { toRecordExpensePayload } from "../finance/model.js";
import { i18n } from "../i18n/index.js";
import { FinanceRecordScreen } from "./FinanceRecordScreen.js";

const ENTRY_ID = "00000000-0000-4000-8000-000000000010";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  submit: vi.fn(),
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
});

afterEach(() => {
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
});
