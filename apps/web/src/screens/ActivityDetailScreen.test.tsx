// @vitest-environment jsdom
import type { ActivityDetail } from "@routiq/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
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
import { i18n } from "../i18n/index.js";
import { filledButtons, recordHeader } from "../test/record.js";

const ACTIVITY_ID = "00000000-0000-4000-8000-000000000010";
const COMMAND_ID = "3f1a9c40-1f2b-4d5e-9a77-2c0b1d8e4f60";

const mocks = vi.hoisted(() => ({
  useActivity: vi.fn(),
  navigate: vi.fn(),
  open: vi.fn(),
  search: { current: {} as { tab?: "legs" | "money" | "history" } },
}));

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ activityId: ACTIVITY_ID }),
  useSearch: () => mocks.search.current,
  useNavigate: () => mocks.navigate,
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: `/activities/${ACTIVITY_ID}` } }),
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

// The trip's forms own their own command plumbing (ActivityActions.test.tsx);
// this screen only places the buttons: captures in the header, the close and
// the fix for what is missing in the status block.
vi.mock("../activities/ActivityActions.js", async () => {
  const { Button } = await import("../components/ui/button");
  return {
    useActivityActions: (activity: ActivityDetail) => ({
      buttons: {
        close: activity.status === "OPEN" ? <Button>Close the activity</Button> : null,
        leg: activity.status === "OPEN" ? <Button variant="outline">Record a leg</Button> : null,
        reading: null,
        expense: null,
        substitute: null,
        reopen: activity.status === "CLOSED" ? <Button variant="outline">Reopen the activity</Button> : null,
      },
      forms: null,
      open: mocks.open,
      can: { reopen: activity.status === "CLOSED" },
    }),
  };
});

// The trail has its own tests (record-history-sheet.test.tsx).
vi.mock("../components/record-history-sheet.js", () => ({
  RecordHistory: () => <div data-testid="history-tab" />,
  LatestHistory: () => <section data-testid="latest-history" />,
}));

const { ActivityDetailScreen } = await import("./ActivityDetailScreen.js");

const manager: MeContext = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  principalId: "00000000-0000-4000-8000-000000000002",
  principalType: "HUMAN",
  membershipId: "00000000-0000-4000-8000-000000000003",
  displayName: "Sali Ahmadou",
  workspaceName: "Transports Ngwa",
  role: "ADMIN",
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
    recordedByPrincipalId: null,
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
    plannedAsset: null,
    plannedDriver: null,
    plannedOriginName: null,
    plannedDestinationName: null,
    cancellation: null,
    discrepancyCodes: [],
    priceCurrency: "XAF",
    financialEntries: [
      {
        entryId: "00000000-0000-4000-8000-000000000081",
        entryNumber: "FIN-2026-0001",
        direction: "REVENUE",
        categoryCode: "FREIGHT",
        categoryLabelFr: "Fret",
        categoryLabelEn: "Freight",
        amountMinor: 900_000,
        status: "POSTED",
        reversesEntryId: null,
        cancelledBy: null,
      },
      {
        entryId: "00000000-0000-4000-8000-000000000082",
        entryNumber: "FIN-2026-0002",
        direction: "EXPENSE",
        categoryCode: "FUEL",
        categoryLabelFr: "Carburant",
        categoryLabelEn: "Fuel",
        amountMinor: 400_000,
        status: "POSTED",
        reversesEntryId: null,
        cancelledBy: null,
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
    recordedByPrincipalId: null,
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

function tabNames(): string[] {
  return screen.getAllByRole("tab").map((tab) => (tab.textContent ?? "").trim());
}

function statusBlock(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-slot="status-block"]');
}

function showing(data: ActivityDetail) {
  mocks.useActivity.mockReturnValue({ data, isPending: false, isError: false, refetch: vi.fn() });
}

function renderScreen(me: MeContext = manager) {
  return render(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(MeCtx.Provider, { value: me }, createElement(ActivityDetailScreen)),
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
  mocks.search.current = {};
  showing(fullHaulage());
});

afterEach(() => {
  cleanup();
});

describe("the trip's record header (#662)", () => {
  it("titles the page with the trip number, its state beside it, and one facts line", () => {
    renderScreen();

    const header = recordHeader();
    expect(within(header).getByRole("heading", { level: 1 }).textContent).toBe("DLA-2026-00042");
    expect(within(header).getByText("Closed")).toBeTruthy();
    const facts = header.querySelector('[data-slot="record-facts"]')?.textContent ?? "";
    expect(facts).toContain("Haulage job");
    expect(facts).toContain("Cimencam");
    expect(facts).toContain("Closed ");
  });

  it("holds at most one filled button, and History is a tab, never a button", () => {
    showing(sparseJourney());
    renderScreen();

    expect(filledButtons(recordHeader())).toHaveLength(0);
    expect(within(recordHeader()).getByRole("button", { name: "Record a leg" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "History" })).toBeNull();
    expect(screen.getByRole("tab", { name: "History" })).toBeTruthy();
  });

  it("stamps where the record came from", () => {
    renderScreen();

    const stamp = screen.getByText(/TRUCKING v2/);
    expect(stamp.textContent).toContain("command 3f1a9c40");
  });
});

describe("the trip's status block (#662)", () => {
  it("is not there when nothing waits: a complete closed trip", () => {
    renderScreen();
    expect(statusBlock()).toBeNull();
    // Reopen stays an ordinary header action.
    expect(within(recordHeader()).getByRole("button", { name: "Reopen the activity" })).toBeTruthy();
  });

  it("holds the close while the trip is on the road", () => {
    showing(sparseJourney());
    renderScreen();

    const block = statusBlock();
    expect(block?.textContent).toContain("On the road");
    expect(within(block as HTMLElement).getByRole("button", { name: "Close the activity" })).toBeTruthy();
    expect(within(recordHeader()).queryByRole("button", { name: "Close the activity" })).toBeNull();
  });

  it("says what a trip closed with gaps misses and offers to complete it", async () => {
    showing({
      ...fullHaulage(),
      completeness: "COMPLETE_WITH_EXCEPTIONS",
      completenessCodes: ["ACTIVITY_MISSING_CREW", "ACTIVITY_NO_REVENUE"],
    });
    renderScreen();

    const block = statusBlock() as HTMLElement;
    expect(block.textContent).toContain("Closed, but 2 things are missing");
    expect(within(block).getByText("No crew recorded")).toBeTruthy();
    expect(within(block).getByText("No revenue attributed")).toBeTruthy();
    await userEvent.click(within(block).getByRole("button", { name: "Complete the activity" }));
    expect(mocks.open).toHaveBeenCalledWith("reopen");
    // The fix is in the block; the header does not offer it twice.
    expect(within(recordHeader()).queryByRole("button", { name: "Reopen the activity" })).toBeNull();
  });
});

describe("the trip's tabs (#662)", () => {
  it("are Overview, Legs, Money and History, in that order", () => {
    renderScreen();
    expect(tabNames()).toEqual(["Overview", "Legs2", "Money", "History"]);
  });

  it("keep the open tab in the address", async () => {
    renderScreen();
    await userEvent.click(screen.getByRole("tab", { name: /Legs/ }));
    const call = mocks.navigate.mock.calls.at(-1)?.[0] as {
      to: string;
      search: (previous: Record<string, unknown>) => Record<string, unknown>;
      replace: boolean;
    };
    expect(call.to).toBe(".");
    expect(call.search({})).toEqual({ tab: "legs" });
  });

  it("shows the legs on Legs", () => {
    mocks.search.current = { tab: "legs" };
    renderScreen();

    expect(screen.getByRole("tab", { name: /Legs/, selected: true })).toBeTruthy();
    expect(screen.getByText("Douala → Edéa")).toBeTruthy();
    expect(screen.getByText("Laden")).toBeTruthy();
  });

  it("shows the lines and the profit on Money, linking each line to its entry", () => {
    mocks.search.current = { tab: "money" };
    renderScreen();

    const link = screen.getByRole("link", { name: /FIN-2026-0001/ });
    expect(link.getAttribute("href")).toBe("/finance/entries/00000000-0000-4000-8000-000000000081");
    expect(screen.getAllByText("Profit").length).toBeGreaterThan(0);
  });

  it("shows the trail on History", () => {
    mocks.search.current = { tab: "history" };
    renderScreen();
    expect(screen.getByTestId("history-tab")).toBeTruthy();
  });
});

describe("the trip's Overview (#662)", () => {
  it("groups the facts like the sheet: vehicle and crew, then the job", () => {
    renderScreen();

    expect(sectionTitles()).toEqual(["Vehicle and crew", "Job", "Planned vs actual"]);
    expect(screen.getByText("Amadou Bello")).toBeTruthy();
    expect(screen.getByText("Meter at departure").nextElementSibling?.textContent).toMatch(/^128,400 km$/);
    expect(screen.getByText("Meter at arrival").nextElementSibling?.textContent).toMatch(/^128,880 km$/);
    expect(screen.getByText("Ciment en sacs, chargement à l'usine.")).toBeTruthy();
    expect(screen.getByText("Customer reference").nextElementSibling?.textContent).toBe("BC-8842");
  });

  it("says Not recorded for what a bare open journey lacks", () => {
    showing(sparseJourney());
    renderScreen();

    expect(screen.getByText("Ended").nextElementSibling?.textContent).toBe("Not recorded");
    for (const label of ["Crew", "Meter at departure", "Customer", "Notes"]) {
      expect(screen.getByText(label).nextElementSibling?.textContent, label).toBe("Not recorded");
    }
    expect(screen.getByText(/PASSENGER_TRANSPORT v1/)).toBeTruthy();
  });
});

describe("the trip's context column (#662)", () => {
  it("holds the money box, the linked vehicle and the latest history", () => {
    renderScreen();

    const aside = screen.getByRole("complementary", { name: "About this record" });
    const money = within(aside).getByRole("heading", { name: "Money" }).closest("section") as HTMLElement;
    const digits = (label: string) =>
      (within(money).getByText(label).nextElementSibling?.textContent ?? "").replace(/[^\d]/g, "");
    expect(digits("Profit")).toBe("500000");
    expect(digits("Revenue")).toBe("900000");
    expect(digits("Expenses")).toBe("400000");
    expect(within(aside).getByRole("link", { name: /CAMION-03/ }).getAttribute("href")).toBe(
      "/assets/00000000-0000-4000-8000-000000000051",
    );
    expect(within(aside).getByTestId("latest-history")).toBeTruthy();
  });

  it("calls a trip that lost money a loss, and a trip without revenue says so", () => {
    showing({
      ...fullHaulage(),
      financialEntries: (fullHaulage().financialEntries ?? []).filter((entry) => entry.direction === "EXPENSE"),
    });
    renderScreen();

    const aside = screen.getByRole("complementary", { name: "About this record" });
    expect(within(aside).getByText("Loss").nextElementSibling?.textContent?.replace(/[^\d-]/g, "")).toBe("400000");
    expect(within(aside).getByText("Revenue").nextElementSibling?.textContent).toBe("Not recorded");
  });
});

describe("a reader the server keeps the ledger from (#103)", () => {
  it("shows the trip without its Money tab or money box", () => {
    showing({ ...fullHaulage(), financialEntries: null });
    renderScreen();

    expect(tabNames()).toEqual(["Overview", "Legs2", "History"]);
    expect(screen.queryByText("Profit")).toBeNull();
    expect(screen.queryByRole("link", { name: /FIN-2026-0001/ })).toBeNull();
  });
});

/**
 * #408: the money tab says whose entries it lists from the reader's entries
 * scope. The counter reads its branches' entries, not only its own.
 */
describe("whose entries the money tab lists (#408)", () => {
  const sentences = {
    en: {
      own: "Only the entries you recorded on this activity.",
      branch: "Only the entries of your branches on this activity.",
    },
    "fr-CM": {
      own: "Seules les écritures que vous avez saisies sur cette activité.",
      branch: "Seules les écritures de vos agences sur cette activité.",
    },
  } as const;

  afterEach(async () => {
    await i18n.changeLanguage("en");
  });

  for (const locale of ["en", "fr-CM"] as const) {
    it(`tells the driver and the cashier apart on the same trip (${locale})`, async () => {
      await i18n.changeLanguage(locale);
      mocks.search.current = { tab: "money" };
      const { own, branch } = sentences[locale];

      const driver = renderScreen({ ...manager, role: "DRIVER" });
      expect(screen.getByText(own)).toBeTruthy();
      expect(screen.queryByText(branch)).toBeNull();
      // A driver's own entries are no trip's money: no money box beside them.
      expect(screen.queryByRole("heading", { name: locale === "en" ? "Money" : "Argent" })).toBeNull();
      driver.unmount();

      renderScreen({ ...manager, role: "CASHIER" });
      expect(screen.getByText(branch)).toBeTruthy();
      expect(screen.queryByText(own)).toBeNull();
    });
  }
});
