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
import { createElement, type ReactNode } from "react";
import { MeCtx, type MeContext } from "../auth/me.js";
import { sessionStore } from "../auth/store.js";
import { i18n } from "../i18n/index.js";
import { BranchProvider, branchStorageKey } from "../shell/branch-context.js";
import { BranchSwitcher } from "../shell/BranchSwitcher.js";
import { openSelect } from "../test-select.js";
import { AssetRegisterScreen } from "./AssetRegisterScreen.js";

const ASSET_ID = "00000000-0000-4000-8000-000000000010";
const sessionIdentity = { username: "amina", workspaceSlug: "sotrafret" };

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  submit: vi.fn(),
  invalidateQueries: vi.fn(),
  useAssetRegistrationReference: vi.fn(),
  statuses: new Map<string, unknown>(),
  toastAdd: vi.fn(),
}));

vi.mock("@/components/ui/toast.js", () => ({ toast: { add: mocks.toastAdd } }));

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

vi.mock("../reference/asset-registration.js", () => ({
  useAssetRegistrationReference: mocks.useAssetRegistrationReference,
}));

vi.mock("../components/ui/file-upload.js", () => ({
  FileUpload: () => null,
}));

async function fillRequiredFields(user: ReturnType<typeof userEvent.setup>, code: string) {
  await user.type(screen.getByLabelText("Asset code"), code);
  
  // Select Asset class using keyboard navigation on Base UI Select
  const assetClassSelect = screen.getByLabelText("Asset class");
  await openSelect(user, assetClassSelect);
  await user.keyboard("{ArrowDown}{Enter}");
  
  // Select Branch using keyboard navigation on Base UI Select
  const branchSelect = screen.getByLabelText("Branch");
  await openSelect(user, branchSelect);
  await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
}

function submittedPayload() {
  return mocks.submit.mock.calls[0]?.[0].payload;
}

const clerk: MeContext = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  principalId: "00000000-0000-4000-8000-000000000002",
  principalType: "HUMAN",
  membershipId: "00000000-0000-4000-8000-000000000003",
  displayName: "Sali Ahmadou",
  workspaceName: "Transports Ngwa",
  role: "ADMIN",
  branchScope: "ALL",
  enabledModules: ["CORE", "ASSETS"],
  enabledPresets: ["TRUCKING", "PASSENGER_TRANSPORT"],
  timezone: "Africa/Douala",
};

/** The screen reads the enabled preset set off /v1/me; the plain render above
 * has no provider, which is the still-loading case. */
function renderWithPresets(enabledPresets: MeContext["enabledPresets"]) {
  render(
    createElement(
      MeCtx.Provider,
      { value: { ...clerk, enabledPresets } },
      createElement(AssetRegisterScreen),
    ) as ReactNode,
  );
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

describe("template preset", () => {
  it("hides the picker and registers against the workspace's only preset", async () => {
    const user = userEvent.setup();
    renderWithPresets(["PASSENGER_TRANSPORT"]);

    expect(screen.queryByLabelText("Business template")).toBeNull();
    // The passenger template's own field is proof the code was auto-set.
    await waitFor(() => expect(screen.queryByLabelText("Seat count *")).not.toBeNull());

    await fillRequiredFields(user, "BUS-001");
    await user.type(screen.getByLabelText("Seat count *"), "52");
    await user.click(screen.getByRole("button", { name: "Register asset" }));

    await submitSettled();
    expect(submittedPayload().templateCode).toBe("PASSENGER_TRANSPORT");
  });

  it("keeps the picker for a workspace running both", () => {
    renderWithPresets(["TRUCKING", "PASSENGER_TRANSPORT"]);

    expect(screen.getByLabelText("Business template")).not.toBeNull();
  });
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

describe("plate and chassis number (#122: the Details edit's rules)", () => {
  const LONG_CHASSIS = "WDB9634031L1234567";

  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  it("registers through register-asset v2, the plate trimmed", async () => {
    const user = userEvent.setup();
    render(<AssetRegisterScreen />);

    await fillRequiredFields(user, "TR-010");
    await user.type(screen.getByLabelText("Registration number"), "  LT 482 AB ");
    await user.type(screen.getByLabelText("Chassis number"), "WDB9634031L123456");
    await user.click(screen.getByRole("button", { name: "Register asset" }));

    await submitSettled();
    const submission = mocks.submit.mock.calls[0]?.[0];
    expect(submission.name).toBe("register-asset");
    expect(submission.version).toBe(2);
    expect(submission.payload.registrationNumber).toBe("LT 482 AB");
    expect(submission.payload.chassisNumber).toBe("WDB9634031L123456");
  });

  it.each([
    ["en", "Chassis number", "Register asset", "The chassis number is too long (17 characters at most)."],
    ["fr-CM", "Numéro de châssis", "Enregistrer l'actif", "Le numéro de châssis est trop long (17 caractères au plus)."],
  ])("refuses a chassis number past 17 characters in the Details edit's words (%s)", async (language, label, submit, message) => {
    await i18n.changeLanguage(language);
    const user = userEvent.setup();
    render(<AssetRegisterScreen />);

    await user.type(screen.getByLabelText(label), LONG_CHASSIS);
    await user.click(screen.getByRole("button", { name: submit }));

    expect(await screen.findByText(message)).not.toBeNull();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it.each([
    ["en", "Another vehicle already has this plate."],
    ["fr-CM", "Un autre véhicule a déjà cette immatriculation."],
  ])("puts a plate another vehicle carries on the plate field (%s)", async (language, message) => {
    mocks.submit.mockResolvedValueOnce({
      ok: false,
      code: "DUPLICATE_REGISTRATION_NUMBER",
      metadata: { assetId: "00000000-0000-4000-8000-000000000099" },
    });
    const user = userEvent.setup();
    render(<AssetRegisterScreen />);

    await fillRequiredFields(user, "TR-011");
    await user.type(screen.getByLabelText("Registration number"), "LT 482 AB");
    await act(async () => {
      await i18n.changeLanguage(language);
    });
    await user.click(screen.getByRole("button", { name: language === "en" ? "Register asset" : "Enregistrer l'actif" }));

    const plate = screen.getByRole("textbox", { name: language === "en" ? "Registration number" : "Immatriculation" });
    await waitFor(() => expect(plate.getAttribute("aria-invalid")).toBe("true"));
    expect(screen.getAllByText(message).length).toBeGreaterThan(0);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});

describe("branch field under the shell's agency", () => {
  const DLA = { id: "branch-dla", code: "DLA", name: "Douala" };
  const YDE = { id: "branch-yde", code: "YDE", name: "Yaoundé" };

  function renderUnderShell() {
    mocks.useAssetRegistrationReference.mockReturnValue({
      data: {
        assetClasses: [{ code: "TRUCK", labelFr: "Camion", labelEn: "Truck" }],
        branches: [DLA, YDE],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    render(
      createElement(BranchProvider, {
        children: [
          createElement(BranchSwitcher, { key: "switcher" }),
          createElement(AssetRegisterScreen, { key: "screen" }),
        ],
      }) as ReactNode,
    );
  }

  async function moveShellTo(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.click(screen.getByRole("combobox", { name: "Current branch" }));
    await user.click(await screen.findByRole("option", { name }));
  }

  afterEach(() => {
    localStorage.removeItem(branchStorageKey(sessionIdentity.workspaceSlug));
  });

  it("follows the shell's agency rather than latching the first fill", async () => {
    const user = userEvent.setup();
    localStorage.setItem(branchStorageKey(sessionIdentity.workspaceSlug), DLA.id);
    renderUnderShell();

    await waitFor(() =>
      expect(screen.getByLabelText("Branch").textContent).toContain("Douala"),
    );

    await moveShellTo(user, "Yaoundé");

    // The bug this guards: a field filled once kept registering into Douala
    // long after the shell had moved on.
    await waitFor(() =>
      expect(screen.getByLabelText("Branch").textContent).toContain("Yaoundé"),
    );
  });

  it("says what happened before it says where, for a branch off the lens", async () => {
    const user = userEvent.setup();
    localStorage.setItem(branchStorageKey(sessionIdentity.workspaceSlug), DLA.id);
    renderUnderShell();

    await waitFor(() =>
      expect(screen.getByLabelText("Branch").textContent).toContain("Douala"),
    );
    await user.type(screen.getByLabelText("Asset code"), "TR-009");
    await openSelect(user, screen.getByLabelText("Asset class"));
    await user.keyboard("{ArrowDown}{Enter}");
    await openSelect(user, screen.getByLabelText("Branch"));
    await user.click(await screen.findByRole("option", { name: /Yaoundé/ }));
    await user.click(screen.getByRole("button", { name: "Register asset" }));

    await submitSettled();
    // The domain owns the title; the agency it landed in is a line under it,
    // not a replacement for what the operator just did.
    expect(mocks.toastAdd).toHaveBeenCalledWith({
      type: "success",
      title: "Asset registered",
      description: "Saved in Yaoundé",
      actionProps: { children: "View", onClick: expect.any(Function) },
    });
  });

  it("keeps an explicit choice against the shell's preset", async () => {
    const user = userEvent.setup();
    localStorage.setItem(branchStorageKey(sessionIdentity.workspaceSlug), DLA.id);
    renderUnderShell();

    await waitFor(() =>
      expect(screen.getByLabelText("Branch").textContent).toContain("Douala"),
    );

    await user.click(screen.getByLabelText("Branch"));
    await user.click(await screen.findByRole("option", { name: /Yaoundé/ }));

    // The preset is a default, not a lock — the operator's own pick stands.
    await waitFor(() =>
      expect(screen.getByLabelText("Branch").textContent).toContain("Yaoundé"),
    );
  });
});
