// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
import { sessionStore } from "../auth/store.js";
import { i18n } from "../i18n/index.js";
import { AssetRegisterScreen } from "./AssetRegisterScreen.js";

const ASSET_ID = "00000000-0000-4000-8000-000000000010";
const sessionIdentity = { username: "amina", workspaceSlug: "sotrafret" };

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  submit: vi.fn(),
  invalidateQueries: vi.fn(),
  useAssetRegistrationReference: vi.fn(),
  statuses: new Map<string, unknown>(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock("../commands/instance.js", () => ({
  commandClient: { submit: mocks.submit },
  commandStatusStore: {
    subscribe: () => () => {},
    getSnapshot: () => mocks.statuses,
  },
}));

vi.mock("../assets/reference.js", () => ({
  useAssetRegistrationReference: mocks.useAssetRegistrationReference,
}));

vi.mock("../components/ui/file-upload.js", () => ({
  FileUpload: () => null,
}));

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>, code: string) {
  await user.type(screen.getByLabelText("Asset code"), code);
  
  // Select Asset class using keyboard navigation on Base UI Select
  const assetClassSelect = screen.getByLabelText("Asset class");
  await user.click(assetClassSelect);
  await user.keyboard("{ArrowDown}{Enter}");
  
  // Select Branch using keyboard navigation on Base UI Select
  const branchSelect = screen.getByLabelText("Branch");
  await user.click(branchSelect);
  await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
}

function submittedPayload() {
  return mocks.submit.mock.calls[0]?.[0].payload;
}

// The screen navigates away before react-hook-form resets isSubmitting; flush
// that trailing update so it doesn't land outside act().
async function submitSettled() {
  await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
  await act(async () => {});
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(ASSET_ID);
  sessionStore.save({
    ...sessionIdentity,
    token: "token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  mocks.useAssetRegistrationReference.mockReturnValue({
    data: {
      assetClasses: [{ code: "TRUCK", labelFr: "Camion", labelEn: "Truck" }],
      branches: [{ code: "DLA", name: "Douala" }],
    },
    isPending: false,
    isError: false,
  });
  mocks.submit.mockResolvedValue({
    ok: true,
    outcome: {
      commandId: ASSET_ID,
      recordId: ASSET_ID,
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

describe("asset register form", () => {
  it("submits numeric fields as numbers, not strings", async () => {
    const user = userEvent.setup();
    render(<AssetRegisterScreen />);

    await fillRequiredFields(user, "TR-001");
    await user.type(screen.getByLabelText("Year"), "2019");
    await user.type(screen.getByLabelText("Make"), "Iveco");
    await user.click(screen.getByRole("button", { name: "Register asset" }));

    await submitSettled();
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(submittedPayload().modelYear).toBe(2019);
    expect(submittedPayload().manufacturer).toBe("Iveco");
  });

  it("omits untouched optional fields instead of sending empty strings", async () => {
    const user = userEvent.setup();
    render(<AssetRegisterScreen />);

    await fillRequiredFields(user, "TR-002");
    await user.click(screen.getByRole("button", { name: "Register asset" }));

    await submitSettled();
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(submittedPayload().registrationNumber).toBeUndefined();
    // What actually reaches the API is the serialized payload.
    expect(JSON.parse(JSON.stringify(submittedPayload()))).toEqual({
      assetId: ASSET_ID,
      assetCode: "TR-002",
      assetClassCode: "TRUCK",
      branchCode: "DLA",
      templateCode: "TRUCKING",
      customValues: {},
    });
  });

  it("keeps a decimal keystroke intact in a number control", async () => {
    const user = userEvent.setup();
    render(<AssetRegisterScreen />);

    await fillRequiredFields(user, "TR-003");
    const capacity = screen.getByLabelText("Capacity");
    await user.type(capacity, "12.5");
    await user.click(screen.getByLabelText("Capacity unit"));
    await user.keyboard("t{Enter}");

    expect((capacity as HTMLInputElement).value).toBe("12.5");

    await user.click(screen.getByRole("button", { name: "Register asset" }));

    await submitSettled();
    expect(mocks.submit).toHaveBeenCalledOnce();
    expect(submittedPayload().capacityValue).toBe(12.5);
    expect(submittedPayload().capacityUnit).toBe("TONNE");
  });
});
