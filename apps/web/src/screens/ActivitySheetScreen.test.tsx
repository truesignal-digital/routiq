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
import { BranchProvider, branchStorageKey } from "../shell/branch-context.js";
import { BranchSwitcher } from "../shell/BranchSwitcher.js";
import { openSelect } from "../test-select.js";
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

vi.mock("../reference/asset-registration.js", () => ({
  useAssetRegistrationReference: mocks.useAssetRegistrationReference,
}));

vi.mock("../categories/useCategories.js", () => ({
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
  displayName: "Sali Ahmadou",
  workspaceName: "Transports Ngwa",
  role: "DRIVER",
  branchScope: "ALL",
  enabledModules: ["CORE", "ACTIVITIES", "FINANCE"],
  enabledPresets: ["TRUCKING", "PASSENGER_TRANSPORT"],
};

/** The office side: records the fares and freight a driver does not (#532). */
const manager: MeContext = { ...clerk, displayName: "Boris Ekane", role: "ADMIN" };

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
  await openSelect(user, screen.getByLabelText(label));
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

/**
 * Typing a whole sheet field by field costs most of the default 5s budget, so
 * a loaded worker pool turns these two into flakes rather than failures. The
 * headroom is about machine contention, not about what they assert.
 */
const FULL_SHEET_TIMEOUT_MS = 20_000;

describe("activity sheet capture", () => {
  it("dispatches a journey sheet the contract accepts", async () => {
    const user = userEvent.setup({ delay: 1 });
    renderScreen(manager);
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
    // Recording states what happened; the trip stays open until someone closes it.
    expect(parsed.data?.close).toBe(false);
  }, FULL_SHEET_TIMEOUT_MS);

  it("dispatches a haulage sheet the contract accepts", async () => {
    const user = userEvent.setup({ delay: 1 });
    renderScreen();

    await user.click(screen.getByRole("tab", { name: "Trucking" }));
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
    expect(parsed.data?.close).toBe(false);
    // The untouched trailer row and the untouched leg never reach the payload.
    expect(parsed.data?.extraSegments).toEqual([]);
    expect(parsed.data?.legs).toEqual([]);
  }, FULL_SHEET_TIMEOUT_MS);

  // #573: a driver records expenses only (#532), so their empty sheet does not
  // mention revenue; a manager's still does.
  it("words the empty money section for who may add revenue", async () => {
    const user = userEvent.setup({ delay: 1 });
    // A driver's sheet opens with no money line at all (#570).
    renderScreen();
    expect(await screen.findByText("No expense on this sheet yet.")).toBeTruthy();
    expect(screen.queryByText(/revenue or expense/)).toBeNull();
    cleanup();

    // A manager's passenger sheet opens with one revenue line; removing it empties the section.
    renderScreen(manager);
    await user.click(await screen.findByRole("button", { name: "Remove line 1" }));
    expect(await screen.findByText("No revenue or expense on this sheet.")).toBeTruthy();
    expect(screen.queryByText("No expense on this sheet yet.")).toBeNull();
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
    const user = userEvent.setup({ delay: 1 });
    renderScreen(manager);
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

  it("closes the activity only through the second, explicit action", async () => {
    const user = userEvent.setup({ delay: 1 });
    renderScreen();
    await fillMinimalSheet(user);

    await user.click(screen.getByRole("button", { name: "Record and close" }));

    await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
    expect(mocks.submit.mock.calls[0]?.[0]?.name).toBe("record-journey-sheet");

    const parsed = recordJourneySheetPayload.safeParse(submittedPayload());
    expect(parsed.error?.issues ?? []).toEqual([]);
    expect(parsed.data?.close).toBe(true);

    await waitFor(() =>
      expect(mocks.toastAdd).toHaveBeenCalledWith({
        type: "success",
        title: "Sheet recorded and activity closed",
      }),
    );
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: "/activities/$activityId",
      params: { activityId: UUID },
    });
  });

  describe("a driver's money lines (#532)", () => {
    it("opens a driver's journey with no revenue line, and offers expenses only", async () => {
      const user = userEvent.setup({ delay: 1 });
      renderScreen();
      await screen.findByRole("button", { name: "Add expense" });

      expect(screen.queryByRole("button", { name: "Add revenue" })).toBeNull();
      expect(screen.queryByLabelText("Category of line 1")).toBeNull();

      await user.click(screen.getByRole("button", { name: "Add expense" }));
      // An expense line with nothing to flip it to revenue.
      expect(screen.queryByRole("tablist", { name: "Direction of line 1" })).toBeNull();
      expect(screen.queryByRole("tab", { name: "Revenue" })).toBeNull();

      await fillMinimalSheet(user);
      await pickFirstOption(user, "Category of line 1");
      await user.type(screen.getByLabelText("Amount of line 1"), "25000");
      await user.click(screen.getByRole("button", { name: "Record sheet" }));

      await waitFor(() => expect(mocks.submit).toHaveBeenCalledOnce());
      const parsed = recordJourneySheetPayload.safeParse(submittedPayload());
      expect(parsed.error?.issues ?? []).toEqual([]);
      expect(parsed.data?.entries).toEqual([
        expect.objectContaining({ direction: "EXPENSE", categoryCode: "FUEL", amountMinor: 25_000 }),
      ]);
    }, FULL_SHEET_TIMEOUT_MS);

    it.each([
      ["an Administrateur", manager],
      ["Direction", { ...manager, role: "DIRECTOR" } satisfies MeContext],
    ])("still gives %s a revenue line and the button to add one", async (_who, me) => {
      renderScreen(me);
      await screen.findByRole("button", { name: "Add revenue" });
      expect(screen.getByRole("tablist", { name: "Direction of line 1" })).toBeTruthy();
      expect(screen.getByRole("tab", { name: "Revenue", selected: true })).toBeTruthy();
    });
  });

  it("offers no capture surface to a viewer", () => {
    renderScreen({ ...clerk, role: "CASHIER" });

    expect(screen.queryByRole("button", { name: "Record sheet" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Record and close" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Passenger transport" })).toBeNull();
  });

  /**
   * ADR-0004: a workspace that runs one business type should not be asked which
   * business type this sheet is. The server refuses the other preset anyway —
   * these keep the form from offering a choice it would reject.
   */
  describe("single-preset workspace", () => {
    it("drops the switcher and records the one flavour the workspace runs", async () => {
      const user = userEvent.setup({ delay: 1 });
      renderScreen({ ...clerk, enabledPresets: ["TRUCKING"] });

      expect(screen.queryByRole("tablist")).toBeNull();
      expect(screen.queryByRole("tab", { name: "Passenger transport" })).toBeNull();
      expect(screen.queryByRole("tab", { name: "Trucking" })).toBeNull();

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

      expect(screen.getByRole("tab", { name: "Passenger transport" })).not.toBeNull();
      expect(screen.getByRole("tab", { name: "Trucking" })).not.toBeNull();
    });
  });

  describe("branch field under the shell's agency", () => {
    const DLA = { id: "branch-dla", code: "DLA", name: "Douala" };
    const YDE = { id: "branch-yde", code: "YDE", name: "Yaound\u00e9" };

    function renderUnderShell(): void {
      mocks.useAssetRegistrationReference.mockReturnValue({
        data: { assetClasses: [], branches: [DLA, YDE] },
        isPending: false,
        isError: false,
        refetch: vi.fn(),
      });
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        createElement(
          QueryClientProvider,
          { client: queryClient },
          createElement(
            MeCtx.Provider,
            { value: clerk },
            createElement(BranchProvider, {
              children: [
                createElement(BranchSwitcher, { key: "switcher" }),
                createElement(ActivitySheetScreen, { key: "screen" }),
              ],
            }),
          ),
        ) as ReactNode,
      );
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

      await openSelect(user, screen.getByRole("combobox", { name: "Current branch" }));
      await user.click(await screen.findByRole("option", { name: "Yaound\u00e9" }));

      // A sheet started in Douala and left open would otherwise keep filing
      // there after the operator moved the shell on.
      await waitFor(() =>
        expect(screen.getByLabelText("Branch").textContent).toContain("Yaound\u00e9"),
      );
    });
  });

  it("keeps the shared fields across a tab switch and drops the other flavour's", async () => {
    const user = userEvent.setup({ delay: 1 });
    renderScreen();
    await fillMinimalSheet(user);
    await user.type(screen.getByLabelText("Seats sold"), "54");

    await user.click(screen.getByRole("tab", { name: "Trucking" }));
    await waitFor(() => expect(screen.queryByLabelText("Seats sold")).toBeNull());
    await user.type(screen.getByLabelText("Cargo"), "Bagged cement");

    await user.click(screen.getByRole("tab", { name: "Passenger transport" }));

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

    await user.click(screen.getByRole("tab", { name: "Trucking" }));
    await waitFor(() =>
      expect((screen.getByLabelText("Cargo") as HTMLInputElement).value).toBe(""),
    );
  });
});
