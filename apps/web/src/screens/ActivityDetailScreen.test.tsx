// @vitest-environment jsdom
import type { ActivityDetail } from "@routiq/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
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
import { i18n } from "../i18n/index.js";

const ACTIVITY_ID = "00000000-0000-4000-8000-000000000010";
const COMMAND_ID = "3f1a9c40-1f2b-4d5e-9a77-2c0b1d8e4f60";

const mocks = vi.hoisted(() => ({ useActivity: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ activityId: ACTIVITY_ID }),
  Link: ({
    to,
    params,
    children,
    ...props
  }: {
    to: string;
    params?: Record<string, string>;
    children?: ReactNode;
  }) => (
    <a
      href={Object.entries(params ?? {}).reduce(
        (path, [key, value]) => path.replace(`$${key}`, value),
        to,
      )}
      {...props}
    >
      {children}
    </a>
  ),
}));

vi.mock("../activities/useActivities.js", () => ({ useActivity: mocks.useActivity }));

// The header's action buttons own their own dialogs and command plumbing; this
// screen only has to keep their slot.
vi.mock("../activities/ActivityActions.js", () => ({
  ActivityActions: () => <div data-testid="activity-actions" />,
}));

const { ActivityDetailScreen } = await import("./ActivityDetailScreen.js");

const manager: MeContext = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  principalId: "00000000-0000-4000-8000-000000000002",
  principalType: "HUMAN",
  membershipId: "00000000-0000-4000-8000-000000000003",
  role: "OPS_MANAGER",
  branchScope: "ALL",
  enabledModules: ["CORE", "ACTIVITIES", "FINANCE"],
  enabledPresets: ["TRUCKING", "PASSENGER_TRANSPORT"],
};

/** A haulage job with every module's data present. */
function fullHaulage(): ActivityDetail {
  return {
    id: ACTIVITY_ID,
    activityNumber: "DLA-2026-00042",
    activityType: {
      code: "HAULAGE_JOB",
      labelFr: "Transport de marchandises",
      labelEn: "Haulage job",
    },
    status: "CLOSED",
    completeness: "COMPLETE",
    completenessCodes: [],
    startedAt: "2026-07-18T06:00:00.000Z",
    endedAt: "2026-07-18T18:00:00.000Z",
    customerName: "Cimencam",
    clientReference: "BC-8842",
    branchId: "00000000-0000-4000-8000-000000000004",
    branchCode: "DLA",
    primaryAssetCode: "CAMION-03",
    legCount: 2,
    crewCount: 2,
    originName: null,
    destinationName: null,
    distanceKm: null,
    driverName: null,
    templateCode: "TRUCKING",
    templateVersion: 2,
    customValues: {},
    description: "Ciment en sacs, chargement à l'usine.",
    plannedStartAt: "2026-07-18T05:00:00.000Z",
    plannedEndAt: "2026-07-18T17:00:00.000Z",
    closedAt: "2026-07-19T08:00:00.000Z",
    createdAt: "2026-07-18T05:30:00.000Z",
    createdByCommandId: COMMAND_ID,
    rowVersion: 4,
    segments: [
      {
        id: "00000000-0000-4000-8000-000000000041",
        assetId: "00000000-0000-4000-8000-000000000051",
        assetCode: "CAMION-03",
        role: "PRIMARY",
        startedAt: "2026-07-18T06:00:00.000Z",
        endedAt: "2026-07-18T18:00:00.000Z",
        substitutesSegmentId: null,
        rowVersion: 1,
      },
    ],
    crew: [
      {
        personId: "00000000-0000-4000-8000-000000000061",
        displayName: "Amadou Bello",
        role: "DRIVER",
      },
      {
        personId: "00000000-0000-4000-8000-000000000062",
        displayName: "Pierre Nkomo",
        role: "ASSISTANT",
      },
    ],
    legs: [
      {
        id: "00000000-0000-4000-8000-000000000071",
        legNo: 1,
        segmentId: null,
        originPlaceId: null,
        originName: "Douala",
        destinationPlaceId: null,
        destinationName: "Edéa",
        departedAt: "2026-07-18T06:00:00.000Z",
        arrivedAt: "2026-07-18T09:00:00.000Z",
        distanceKm: 240,
        loadState: "LADEN",
        passengerCount: null,
        customValues: {},
      },
      {
        id: "00000000-0000-4000-8000-000000000072",
        legNo: 2,
        segmentId: null,
        originPlaceId: null,
        originName: "Edéa",
        destinationPlaceId: null,
        destinationName: "Douala",
        departedAt: "2026-07-18T14:00:00.000Z",
        arrivedAt: "2026-07-18T18:00:00.000Z",
        distanceKm: 240,
        loadState: "EMPTY",
        passengerCount: null,
        customValues: {},
      },
    ],
    readings: [
      {
        id: "00000000-0000-4000-8000-000000000091",
        assetId: "00000000-0000-4000-8000-000000000051",
        assetCode: "CAMION-03",
        readingType: "ODOMETER",
        value: 128_400,
        observedAt: "2026-07-18T06:00:00.000Z",
        source: "ACTIVITY_START",
        supersededById: null,
      },
      {
        id: "00000000-0000-4000-8000-000000000092",
        assetId: "00000000-0000-4000-8000-000000000051",
        assetCode: "CAMION-03",
        readingType: "ODOMETER",
        value: 128_880,
        observedAt: "2026-07-18T18:00:00.000Z",
        source: "ACTIVITY_END",
        supersededById: null,
      },
    ],
    financialEntries: [
      {
        entryId: "00000000-0000-4000-8000-000000000081",
        entryNumber: "FIN-2026-0001",
        direction: "REVENUE",
        categoryCode: "FREIGHT",
        amountMinor: 900_000,
        status: "POSTED",
      },
      {
        entryId: "00000000-0000-4000-8000-000000000082",
        entryNumber: "FIN-2026-0002",
        direction: "EXPENSE",
        categoryCode: "FUEL",
        amountMinor: 400_000,
        status: "POSTED",
      },
    ],
  };
}

/**
 * The other end of the range: a journey opened from a phone with nothing on it
 * but a number and a vehicle. §3.4 warn-don't-block means this is a legitimate
 * record, not a broken one.
 */
function sparseJourney(): ActivityDetail {
  return {
    ...fullHaulage(),
    activityNumber: "YDE-2026-00007",
    activityType: {
      code: "SCHEDULED_JOURNEY",
      labelFr: "Voyage régulier",
      labelEn: "Scheduled journey",
    },
    status: "OPEN",
    completeness: null,
    completenessCodes: [],
    startedAt: "2026-07-29T06:00:00.000Z",
    endedAt: null,
    customerName: null,
    clientReference: null,
    primaryAssetCode: null,
    legCount: 0,
    crewCount: 0,
    templateCode: "PASSENGER_TRANSPORT",
    templateVersion: 1,
    description: null,
    plannedStartAt: null,
    plannedEndAt: null,
    closedAt: null,
    createdByCommandId: null,
    segments: [],
    crew: [],
    legs: [],
    readings: [],
    financialEntries: [],
  };
}

/** Card titles, so a section assertion cannot be satisfied by a stat tile label. */
function sectionTitles(): string[] {
  return Array.from(document.querySelectorAll("[data-slot='card-title']")).map(
    (node) => (node.textContent ?? "").trim(),
  );
}

function renderScreen() {
  return render(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(MeCtx.Provider, { value: manager }, createElement(ActivityDetailScreen)),
    ),
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
  mocks.useActivity.mockReturnValue({
    data: fullHaulage(),
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
});

describe("activity detail — a full haulage job", () => {
  it("stacks every module the record has data for", () => {
    renderScreen();

    expect(screen.getByRole("heading", { name: "DLA-2026-00042" })).toBeTruthy();
    expect(screen.getByTestId("activity-actions")).toBeTruthy();
    // The timeline is one action away from every record, and costs nothing
    // until it is opened.
    expect(screen.getByRole("button", { name: "History" })).toBeTruthy();
    expect(sectionTitles()).toEqual([
      "Planned vs actual",
      "Assets and crew",
      "Legs",
      "Revenue and costs",
    ]);
  });

  it("surfaces the fields the old screen dropped on the floor", () => {
    renderScreen();

    expect(screen.getByText("Ciment en sacs, chargement à l'usine.")).toBeTruthy();
    expect(screen.getAllByText(/^Closed /).length).toBeGreaterThan(0);
    expect(screen.getByText("Douala → Edéa")).toBeTruthy();
    expect(screen.getByText("Laden")).toBeTruthy();
    expect(screen.getByText(/\+480 km/)).toBeTruthy();
  });

  it("stamps where the record came from", () => {
    renderScreen();

    const stamp = screen.getByText(/TRUCKING v2/);
    expect(stamp.textContent).toContain("command 3f1a9c40");
  });

  it("nets the posted money and links the lines out to finance", () => {
    renderScreen();

    const link = screen.getByRole("link", { name: /FIN-2026-0001/ });
    expect(link.getAttribute("href")).toBe(
      "/finance/entries/00000000-0000-4000-8000-000000000081",
    );
    expect(screen.getAllByText(/posted/i).length).toBeGreaterThan(0);
  });
});

describe("activity detail — a sparse open journey", () => {
  beforeEach(() => {
    mocks.useActivity.mockReturnValue({
      data: sparseJourney(),
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
  });

  it("leaves out every section with nothing in it", () => {
    renderScreen();

    // The overview band is the only card a bare record earns.
    expect(sectionTitles()).toEqual([]);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("still answers the questions the header can answer", () => {
    renderScreen();

    expect(screen.getByRole("heading", { name: "YDE-2026-00007" })).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    // An open activity has no end, and the band says so instead of showing a dash.
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText(/PASSENGER_TRANSPORT v1/)).toBeTruthy();
  });

  it("keeps a zero net honest rather than hiding the tile", () => {
    renderScreen();

    const net = screen.getByText("Net").nextElementSibling;
    expect((net?.textContent ?? "").replace(/[^\d+-]/g, "")).toBe("0");
  });
});
