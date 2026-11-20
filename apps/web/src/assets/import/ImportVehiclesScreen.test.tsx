// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, type ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MeCtx, type MeContext } from "@/auth/me.js";
import { i18n } from "@/i18n/index.js";
import { ImportVehiclesScreen } from "./ImportVehiclesScreen.js";
import { headerLabels } from "./labels.js";
import { allImportFields, fieldLabelKey, normalizeLabel } from "./model.js";

const mocks = vi.hoisted(() => ({
  submit: vi.fn(),
  invalidateQueries: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: ReactNode; className?: string }) =>
    createElement("a", { href: to, className }, children),
}));

vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }),
}));

vi.mock("@/auth/store.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/auth/store.js")>()),
  useActiveSession: () => ({ workspaceSlug: "ngwa" }),
}));

vi.mock("@/commands/instance.js", () => ({ commandClient: { submit: mocks.submit } }));

vi.mock("@/reference/asset-registration.js", () => ({
  useAssetRegistrationReference: () => ({
    data: {
      assetClasses: [{ code: "TRUCK", labelFr: "Camion", labelEn: "Truck" }],
      branches: [{ id: "b1", code: "DLA", name: "Douala" }],
    },
    isError: false,
  }),
}));

vi.mock("./useExistingAssets.js", () => ({
  useExistingAssets: () => ({ data: { assetCodes: new Set(["VH-OLD"]), plates: new Set() }, isError: false }),
}));

const admin: MeContext = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  principalId: "00000000-0000-4000-8000-000000000002",
  principalType: "HUMAN",
  membershipId: "00000000-0000-4000-8000-000000000003",
  displayName: "Sali Ahmadou",
  workspaceName: "Transports Ngwa",
  role: "ADMIN",
  branchScope: "ALL",
  enabledModules: ["CORE", "ASSETS"],
  enabledPresets: ["TRUCKING"],
  timezone: "Africa/Douala",
};

function renderAs(me: MeContext) {
  render(createElement(MeCtx.Provider, { value: me }, createElement(ImportVehiclesScreen)));
}

function csv(text: string) {
  return new File([text], "vehicles.csv", { type: "text/csv" });
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

beforeEach(() => {
  mocks.submit.mockImplementation(async (submission: { payload: { assetId: string } }) => ({
    ok: true,
    outcome: { commandId: "c", recordId: submission.payload.assetId, rowVersion: 1, warnings: [], idempotentReplay: false },
  }));
});

afterEach(() => {
  vi.clearAllMocks();
  cleanup();
});

describe("header wordings", () => {
  it("each French and English label names exactly one field", () => {
    const labels = headerLabels(i18n);
    for (const field of allImportFields()) {
      for (const lng of ["fr", "en"]) {
        expect(labels.get(normalizeLabel(i18n.getFixedT(lng)(fieldLabelKey(field)))), `${lng} ${field}`).toBe(field);
      }
    }
  });
});

describe("ImportVehiclesScreen", () => {
  it("previews the file, then sends one register-asset per ready row", async () => {
    const user = userEvent.setup();
    renderAs(admin);

    await user.upload(
      screen.getByLabelText("Choose a CSV file"),
      csv("Code de l'actif;Classe d'actif;Agence\nVH1;Camion;DLA\nVH2;TRUCK;Douala\nVH3;TRUCK;Yaoundé\nVH-OLD;TRUCK;DLA\n"),
    );

    expect(await screen.findByText("2 rows ready, 2 rows to fix")).toBeTruthy();
    expect(screen.getAllByText("Branch: not found in your workspace").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Asset code: already registered").length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Import 2 vehicles" }));

    expect(await screen.findByText("2 registered, 0 awaiting approval, 0 failed, 2 rows not sent")).toBeTruthy();
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    for (const [submission] of mocks.submit.mock.calls) {
      expect(submission).toMatchObject({ name: "register-asset", version: 2, envelope: { origin: "CSV_IMPORT" } });
    }
    expect(mocks.submit.mock.calls.map(([s]) => s.payload.assetCode)).toEqual(["VH1", "VH2"]);
    await waitFor(() => expect(mocks.invalidateQueries).toHaveBeenCalledWith({ queryKey: ["ws", "ngwa", "assets"] }));
  });

  it("shows the server's stable code for a row it refused, and approval rows apart", async () => {
    mocks.submit
      .mockResolvedValueOnce({ ok: false, code: "DUPLICATE_REGISTRATION_NUMBER" })
      .mockResolvedValueOnce({ ok: false, code: "APPROVAL_REQUIRED" });
    const user = userEvent.setup();
    renderAs(admin);

    await user.upload(screen.getByLabelText("Choose a CSV file"), csv("Asset code,Asset class,Branch\nVH1,TRUCK,DLA\nVH2,TRUCK,DLA\n"));
    await user.click(await screen.findByRole("button", { name: "Import 2 vehicles" }));

    expect(await screen.findByText("0 registered, 1 awaiting approval, 1 failed, 0 rows not sent")).toBeTruthy();
    expect(screen.getAllByText(/\(DUPLICATE_REGISTRATION_NUMBER\)/).length).toBeGreaterThan(0);
  });

  it("stops on an unknown header and names it", async () => {
    const user = userEvent.setup();
    renderAs(admin);

    await user.upload(screen.getByLabelText("Choose a CSV file"), csv("Asset code,Asset class,Branch,Colour\nVH1,TRUCK,DLA,red\n"));

    expect(await screen.findByText('Unknown column: "Colour". Use the template\'s headers.')).toBeTruthy();
    expect(mocks.submit).not.toHaveBeenCalled();
  });

  it("is closed to roles that may not register a vehicle", () => {
    renderAs({ ...admin, role: "DRIVER" });
    expect(screen.getByText("Your role does not allow this action.")).toBeTruthy();
    expect(screen.queryByLabelText("Choose a CSV file")).toBeNull();
  });
});
