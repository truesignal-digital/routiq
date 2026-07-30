// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  recordHaulageJobSheetPayload,
  recordJourneySheetPayload,
} from "@routiq/contracts";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement, type ReactNode } from "react";
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
import { ActivitySheetScreen } from "./ActivitySheetScreen.js";

const UUID = "00000000-0000-4000-8000-000000000010";
const ASSET_ID = "00000000-0000-4000-8000-000000000030";
const PERSON_ID = "00000000-0000-4000-8000-000000000040";
const sessionIdentity = { username: "amina", workspaceSlug: "sotrafret" };

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  search: vi.fn(),
  submit: vi.fn(),
  useAssetRegistrationReference: vi.fn(),
  useCategories: vi.fn(),
  useAssets: vi.fn(),
  usePersons: vi.fn(),
  usePlaces: vi.fn(),
  toastAdd: vi.fn(),
}));

vi.mock("@/components/ui/toast.js", () => ({
  toast: { add: mocks.toastAdd },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  useSearch: () => mocks.search(),
}));

vi.mock("../commands/instance.js", () => ({
  commandClient: { submit: mocks.submit },
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

vi.mock("../activities/usePersons.js", () => ({
  usePersons: mocks.usePersons,
}));

vi.mock("../activities/usePlaces.js", () => ({
  usePlaces: mocks.usePlaces,
}));

const clerk: MeContext = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  principalId: "00000000-0000-4000-8000-000000000002",
  principalType: "HUMAN",
  membershipId: "00000000-0000-4000-8000-000000000003",
  role: "FIELD_SUBMITTER",
  branchScope: "ALL",
  enabledModules: ["CORE", "ACTIVITIES", "FINANCE"],
  enabledPresets: ["TRUCKING", "PASSENGER_TRANSPORT"],
};

function renderScreen(me: MeContext = clerk): void {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(MeCtx.Provider, { value: me }, createElement(ActivitySheetScreen)),
    ) as ReactNode,
  );
}

function submittedPayload(): unknown {
  return mocks.submit.mock.calls[0]?.[0]?.payload;
}

async function pickFirstOption(
  user: ReturnType<typeof userEvent.setup>,
  label: string,
): Promise<void> {
  await user.click(screen.getByLabelText(label));
  await user.keyboard("{ArrowDown}{Enter}");
}

function setDateTime(label: string, value: string): void {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

/** The shortest sheet a clerk can hand in: references, vehicle, one money line. */
async function fillMinimalSheet(
  user: ReturnType<typeof userEvent.setup>,
): Promise<void> {
  await pickFirstOption(user, "Activity type");
  await pickFirstOption(user, "Primary asset");
  setDateTime("Departure", "2026-07-28T06:00");
  setDateTime("Arrival", "2026-07-28T14:30");
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(UUID);
  sessionStore.save({
    ...sessionIdentity,
    token: "token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  mocks.search.mockReturnValue({});
  mocks.useAssetRegistrationReference.mockReturnValue({
    data: { assetClasses: [], branches: [{ code: "DLA", name: "Douala" }] },
    isPending: false,
    isError: false,
  });
  mocks.useCategories.mockImplementation((kind: string) => ({
    data:
      kind === "ACTIVITY_TYPE"
        ? [
            {
              code: "SCHEDULED_JOURNEY",
              labelFr: "Voyage régulier",
              labelEn: "Scheduled journey",
            },
          ]
        : kind === "REVENUE_CATEGORY"
          ? [{ code: "TICKETS", labelFr: "Billetterie", labelEn: "Ticket sales" }]
          : [{ code: "FUEL", labelFr: "Carburant", labelEn: "Fuel" }],
    isPending: false,
    isError: false,
  }));
  mocks.useAssets.mockReturnValue({
    data: {
      pages: [
        {
          items: [
            {
              id: ASSET_ID,
              assetCode: "BUS-001",
              registrationNumber: "LT-123-AB",
              manufacturer: "Toyota",
              model: "Coaster",
              lifecycleStatus: "IN_SERVICE",
              rowVersion: 1,
              category: { code: "BUS", labelFr: "Bus", labelEn: "Bus" },
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
  mocks.usePersons.mockReturnValue({
    data: {
      items: [
        {
          id: PERSON_ID,
          displayName: "Amadou Bello",
          personCode: "D-014",
          defaultRole: "DRIVER",
          branchId: "b-1",
          active: true,
        },
      ],
    },
    isPending: false,
    isError: false,
  });
  mocks.usePlaces.mockReturnValue({
    data: { items: [{ id: "00000000-0000-4000-8000-000000000050", name: "Douala" }] },
    isPending: false,
    isError: false,
  });
  mocks.submit.mockResolvedValue({
    ok: true,
    outcome: {
      commandId: UUID,
      recordId: UUID,
      rowVersion: 1,
      recordStatus: "CLOSED",
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

describe("activity sheet capture", () => {
  it("dispatches a journey sheet the contract accepts", async () => {
    const user = userEvent.setup();
    renderScreen();
    await fillMinimalSheet(user);

    // Crew: the driver named on the sheet, picked from the branch's people.
    await user.click(screen.getByLabelText("Crew member 1"));
    await waitFor(() => expect(screen.getByRole("listbox")).toBeTruthy());
    await user.click(screen.getByRole("option", { name: /Amadou Bello/ }));

    // One leg, both ends named.
    await user.type(screen.getByLabelText("Origin of leg 1"), "Douala");
    await user.type(screen.getByLabelText("Destination of leg 1"), "Edea");
    await user.type(screen.getByLabelText("Distance of leg 1"), "240");
    await user.type(screen.getByLabelText("Passengers on leg 1"), "54");

    await user.type(screen.getByLabelText("Seats sold"), "54");

    // The pre-created revenue line.
    await pickFirstOption(user, "Category of line 1");
    await user.type(screen.getByLabelText("Amount of line 1"), "480000");

    await user.click(screen.getByRole("button", { name: "Record sheet" }));

    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    expect(mocks.submit.mock.calls[0]?.[0]?.name).toBe("record-journey-sheet");

    const parsed = recordJourneySheetPayload.safeParse(submittedPayload());
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.branchCode).toBe("DLA");
    expect(parsed.data?.seatsSold).toBe(54);
    expect(parsed.data?.legs).toHaveLength(1);
    expect(parsed.data?.legs[0]?.passengerCount).toBe(54);
    expect(parsed.data?.crew).toEqual([
      { activityPersonId: UUID, personId: PERSON_ID, role: "DRIVER" },
    ]);
    expect(parsed.data?.entries[0]).toMatchObject({
      direction: "REVENUE",
      categoryCode: "TICKETS",
      // XAF has exponent 0 — 480 000 francs is 480 000 minor units.
      amountMinor: 480_000,
      attributeToActivity: true,
    });
  });

  it("dispatches a haulage sheet the contract accepts", async () => {
    const user = userEvent.setup();
    renderScreen();

    await user.click(screen.getByRole("tab", { name: "Haulage job" }));
    await fillMinimalSheet(user);
    await user.type(screen.getByLabelText("Cargo"), "Bagged cement");
    await user.type(screen.getByLabelText("Weight (kg)"), "28000");

    await user.click(screen.getByRole("button", { name: "Record sheet" }));

    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    expect(mocks.submit.mock.calls[0]?.[0]?.name).toBe("record-haulage-job-sheet");

    const parsed = recordHaulageJobSheetPayload.safeParse(submittedPayload());
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.success).toBe(true);
    expect(parsed.data?.cargoDescription).toBe("Bagged cement");
    expect(parsed.data?.cargoWeightKg).toBe(28_000);
    // The untouched trailer row and the untouched leg never reach the payload.
    expect(parsed.data?.extraSegments).toEqual([]);
    expect(parsed.data?.legs).toEqual([]);
  });

  it("names the money lines still waiting for an approver", async () => {
    mocks.submit.mockResolvedValue({
      ok: true,
      outcome: {
        commandId: UUID,
        recordId: UUID,
        rowVersion: 1,
        recordStatus: "CLOSED",
        warnings: [],
        children: [
          { entityType: "financial_entry", id: UUID, status: "SUBMITTED", warnings: [] },
          { entityType: "financial_entry", id: UUID, status: "POSTED", warnings: [] },
        ],
        idempotentReplay: false,
      },
    });
    const user = userEvent.setup();
    renderScreen();
    await fillMinimalSheet(user);
    await pickFirstOption(user, "Category of line 1");
    await user.type(screen.getByLabelText("Amount of line 1"), "480000");

    await user.click(screen.getByRole("button", { name: "Record sheet" }));

    await waitFor(() =>
      expect(mocks.toastAdd).toHaveBeenCalledWith({
        type: "success",
        title: "Sheet recorded",
        description: "1 line awaiting approval",
      }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/activities/$activityId",
      params: { activityId: UUID },
    });
  });

  it("offers no capture surface to a viewer", () => {
    renderScreen({ ...clerk, role: "EXECUTIVE_VIEWER" });

    expect(screen.queryByRole("button", { name: "Record sheet" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Journey" })).toBeNull();
  });

  /**
   * ADR-0004: a workspace that runs one business type should not be asked which
   * business type this sheet is. The server refuses the other preset anyway —
   * these keep the form from offering a choice it would reject.
   */
  describe("single-preset workspace", () => {
    it("drops the switcher and records the one flavour the workspace runs", async () => {
      const user = userEvent.setup();
      renderScreen({ ...clerk, enabledPresets: ["TRUCKING"] });

      expect(screen.queryByRole("tablist")).toBeNull();
      expect(screen.queryByRole("tab", { name: "Journey" })).toBeNull();
      expect(screen.queryByRole("tab", { name: "Haulage job" })).toBeNull();

      // Haulage is what TRUCKING means, so its fields are the ones on screen.
      await waitFor(() => expect(screen.queryByLabelText("Cargo")).not.toBeNull());
      expect(screen.queryByLabelText("Seats sold")).toBeNull();

      await fillMinimalSheet(user);
      await user.click(screen.getByRole("button", { name: "Record sheet" }));

      await waitFor(() => expect(mocks.submit).toHaveBeenCalled());
      expect(mocks.submit.mock.calls[0]?.[0]?.name).toBe("record-haulage-job-sheet");
    });

    it("falls back when a link names the preset the workspace does not run", async () => {
      mocks.search.mockReturnValue({ template: "journey" });
      renderScreen({ ...clerk, enabledPresets: ["TRUCKING"] });

      await waitFor(() => expect(screen.queryByLabelText("Cargo")).not.toBeNull());
      expect(screen.queryByLabelText("Seats sold")).toBeNull();
      expect(screen.queryByRole("tablist")).toBeNull();
    });

    it("keeps the switcher for a workspace running both", () => {
      renderScreen({ ...clerk, enabledPresets: ["TRUCKING", "PASSENGER_TRANSPORT"] });

      expect(screen.getByRole("tab", { name: "Journey" })).not.toBeNull();
      expect(screen.getByRole("tab", { name: "Haulage job" })).not.toBeNull();
    });
  });

  it("keeps the shared fields across a tab switch and drops the other flavour's", async () => {
    const user = userEvent.setup();
    renderScreen();
    await fillMinimalSheet(user);
    await user.type(screen.getByLabelText("Seats sold"), "54");

    await user.click(screen.getByRole("tab", { name: "Haulage job" }));
    await waitFor(() => expect(screen.queryByLabelText("Seats sold")).toBeNull());
    await user.type(screen.getByLabelText("Cargo"), "Bagged cement");

    await user.click(screen.getByRole("tab", { name: "Journey" }));

    // The vehicle and its times came off the same paper sheet either way.
    await waitFor(() =>
      expect((screen.getByLabelText("Departure") as HTMLInputElement).value).toBe(
        "2026-07-28T06:00",
      ),
    );
    expect(screen.getByLabelText("Activity type").textContent).toContain(
      "Scheduled journey",
    );
    // Seats belong to the journey alone, and were cleared on the way out.
    expect((screen.getByLabelText("Seats sold") as HTMLInputElement).value).toBe("");

    await user.click(screen.getByRole("tab", { name: "Haulage job" }));
    await waitFor(() =>
      expect((screen.getByLabelText("Cargo") as HTMLInputElement).value).toBe(""),
    );
  });
});
