// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ActivityDetail, CommandWarningCode } from "@routiq/contracts";
import {
  recordExpensePayload,
  recordMeterReadingPayload,
  recordMovementLegPayload,
} from "@routiq/contracts";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { MeCtx, type MeContext } from "../auth/me.js";
import { sessionStore } from "../auth/store.js";
import type { CommandClient, SubmitResult } from "../commands/client.js";
import { PageHeader } from "../components/page.js";
import { i18n } from "../i18n/index.js";
import { openSelect } from "../test-select.js";
import { ActivityActions, localOffsetMinutes, toOffsetIso } from "./ActivityActions.js";

const mocks = vi.hoisted(() => ({
  toastAdd: vi.fn(),
  useAssets: vi.fn(),
  usePlaces: vi.fn(),
  useCategories: vi.fn(),
}));

vi.mock("@/components/ui/toast.js", () => ({
  toast: { add: mocks.toastAdd },
}));

vi.mock("../assets/useAssets.js", () => ({
  useAssets: mocks.useAssets,
}));

vi.mock("./usePlaces.js", () => ({
  usePlaces: mocks.usePlaces,
}));

vi.mock("../documents/useCategories.js", () => ({
  useCategories: mocks.useCategories,
}));

// The trip's expense is RecordEntryForm: its branch list and approval hint.
vi.mock("../assets/reference.js", () => ({
  useAssetRegistrationReference: () => ({
    data: { assetClasses: [], branches: [{ code: "DLA", name: "Douala" }] },
    isPending: false,
    isError: false,
  }),
}));

vi.mock("../approval-rules/useApprovalChain.js", () => ({
  useApprovalChain: () => ({ data: undefined }),
}));

const ACTIVITY_ID = "00000000-0000-4000-8000-000000000001";
const OPEN_SEGMENT_ID = "00000000-0000-4000-8000-000000000002";
const CLOSED_SEGMENT_ID = "00000000-0000-4000-8000-000000000003";
const PRIMARY_ASSET_ID = "00000000-0000-4000-8000-000000000004";
const RESCUE_ASSET_ID = "00000000-0000-4000-8000-000000000005";
const GENERATED_IDS = [
  "00000000-0000-4000-8000-000000000101",
  "00000000-0000-4000-8000-000000000102",
  "00000000-0000-4000-8000-000000000103",
  "00000000-0000-4000-8000-000000000104",
] as const;
const DOUALA_PLACE_ID = "00000000-0000-4000-8000-0000000000d1";
const EDEA_PLACE_ID = "00000000-0000-4000-8000-0000000000d2";

const sessionIdentity = { username: "amina", workspaceSlug: "sotrafret" };

const openActivity: ActivityDetail = {
  id: ACTIVITY_ID,
  activityNumber: "ACT-2026-0007",
  activityType: { code: "HAULAGE_JOB", labelFr: "Transport", labelEn: "Haulage" },
  status: "OPEN",
  completeness: null,
  completenessCodes: [],
  startedAt: "2026-07-20T06:00:00.000Z",
  endedAt: null,
  customerName: "Brasseries du Cameroun",
  clientReference: "WB-4471",
  branchId: "00000000-0000-4000-8000-0000000000b1",
  branchCode: "DLA",
  primaryAssetCode: "DLA-T-001",
  legCount: 2,
  crewCount: 1,
  originName: null,
  destinationName: null,
  distanceKm: null,
  driverName: null,
  templateCode: "TRUCKING",
  templateVersion: 1,
  customValues: {},
  description: null,
  plannedStartAt: null,
  plannedEndAt: null,
  closedAt: null,
  createdAt: "2026-07-20T05:45:00.000Z",
  createdByCommandId: "00000000-0000-4000-8000-0000000000d1",
  // The signed-in member of `meWith`, so a DRIVER may close it.
  recordedByPrincipalId: "00000000-0000-4000-8000-0000000000f2",
  rowVersion: 7,
  segments: [
    {
      id: CLOSED_SEGMENT_ID,
      assetId: "00000000-0000-4000-8000-0000000000c1",
      assetCode: "DLA-R-009",
      role: "TRAILER",
      startedAt: "2026-07-20T06:00:00.000Z",
      endedAt: "2026-07-20T10:00:00.000Z",
      substitutesSegmentId: null,
      rowVersion: 4,
    },
    {
      id: OPEN_SEGMENT_ID,
      assetId: PRIMARY_ASSET_ID,
      assetCode: "DLA-T-001",
      role: "PRIMARY",
      startedAt: "2026-07-20T06:00:00.000Z",
      endedAt: null,
      substitutesSegmentId: null,
      rowVersion: 3,
    },
  ],
  crew: [],
  legs: [],
  readings: [],
  plannedAsset: null,
  plannedDriver: null,
  plannedOriginName: null,
  plannedDestinationName: null,
  cancellation: null,
  discrepancyCodes: [],
  priceCurrency: "XAF",
  financialEntries: [],
};

const closedActivity: ActivityDetail = {
  ...openActivity,
  status: "CLOSED",
  completeness: "COMPLETE_WITH_EXCEPTIONS",
  completenessCodes: ["ACTIVITY_NO_REVENUE"],
  endedAt: "2026-07-21T09:00:00.000Z",
  closedAt: "2026-07-21T09:30:00.000Z",
  segments: openActivity.segments.map((segment) => ({
    ...segment,
    endedAt: segment.endedAt ?? "2026-07-21T09:00:00.000Z",
  })),
};

function meWith(role: MeContext["role"]): MeContext {
  return {
    workspaceId: "00000000-0000-4000-8000-0000000000f1",
    principalId: "00000000-0000-4000-8000-0000000000f2",
    principalType: "HUMAN",
    membershipId: "00000000-0000-4000-8000-0000000000f3",
    displayName: "Sali Ahmadou",
    workspaceName: "Transports Ngwa",
    role,
    branchScope: "ALL",
    enabledModules: ["CORE", "ASSETS", "ACTIVITIES"],
    enabledPresets: ["TRUCKING", "PASSENGER_TRANSPORT"],
  };
}

interface RecordingClient extends CommandClient {
  seen: Array<{
    name: string;
    payload: unknown;
    envelope: { expectedVersion?: number };
  }>;
}

function recordingClient(...results: SubmitResult[]): RecordingClient {
  const seen: RecordingClient["seen"] = [];
  let call = 0;
  return {
    seen,
    submit: async (submission) => {
      seen.push(
        submission as unknown as {
          name: string;
          payload: unknown;
          envelope: { expectedVersion?: number };
        },
      );
      return results[Math.min(call++, results.length - 1)]!;
    },
  };
}

function committed(
  warnings: CommandWarningCode[] = [],
  recordStatus?: string,
): SubmitResult {
  return {
    ok: true,
    outcome: {
      commandId: "00000000-0000-4000-8000-0000000000e1",
      recordId: ACTIVITY_ID,
      rowVersion: 8,
      warnings,
      idempotentReplay: false,
      ...(recordStatus === undefined ? {} : { recordStatus }),
    },
  };
}

const DETAIL_KEY = [
  "ws",
  sessionIdentity.workspaceSlug,
  "activities",
  "detail",
  ACTIVITY_ID,
] as const;

function renderActions(
  activity: ActivityDetail,
  client: CommandClient,
  me: MeContext = meWith("ADMIN"),
  queryClient = new QueryClient(),
) {
  const view = render(
    <QueryClientProvider client={queryClient}>
      <MeCtx.Provider value={me}>
        <ActivityActions activity={activity} client={client} />
      </MeCtx.Provider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

beforeEach(() => {
  vi.clearAllMocks();
  let generated = 0;
  vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(
    () => GENERATED_IDS[Math.min(generated++, GENERATED_IDS.length - 1)]!,
  );
  sessionStore.save({
    ...sessionIdentity,
    token: "token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
  mocks.useAssets.mockReturnValue({
    data: {
      pages: [
        {
          items: [
            {
              id: PRIMARY_ASSET_ID,
              assetCode: "DLA-T-001",
              registrationNumber: null,
              manufacturer: "Mercedes",
              model: "Actros",
              lifecycleStatus: "IN_SERVICE",
              rowVersion: 2,
              category: { code: "TRUCK", labelFr: "Camion", labelEn: "Truck" },
              branch: { code: "DLA", name: "Douala" },
            },
            {
              id: RESCUE_ASSET_ID,
              assetCode: "DLA-T-014",
              registrationNumber: null,
              manufacturer: "Renault",
              model: "Kerax",
              lifecycleStatus: "IN_SERVICE",
              rowVersion: 5,
              category: { code: "TRUCK", labelFr: "Camion", labelEn: "Truck" },
              branch: { code: "DLA", name: "Douala" },
            },
          ],
          nextCursor: null,
        },
      ],
    },
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  });
  mocks.usePlaces.mockReturnValue({
    data: {
      items: [
        { id: DOUALA_PLACE_ID, name: "Douala" },
        { id: EDEA_PLACE_ID, name: "Edéa" },
      ],
    },
    isPending: false,
    isError: false,
  });
  mocks.useCategories.mockReturnValue({
    data: [
      { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel" },
      { code: "TOLL", labelFr: "Péage", labelEn: "Toll" },
    ],
    isPending: false,
    isError: false,
  });
});

afterEach(() => {
  sessionStore.logout(sessionIdentity);
  cleanup();
});

describe("offset stamping", () => {
  it("turns a zoneless datetime-local value into an offset-bearing ISO instant", () => {
    expect(toOffsetIso("2026-07-20T18:30", 60)).toBe("2026-07-20T18:30:00+01:00");
    expect(toOffsetIso("2026-07-20T18:30", 0)).toBe("2026-07-20T18:30:00+00:00");
    expect(toOffsetIso("2026-07-20T18:30", -330)).toBe("2026-07-20T18:30:00-05:30");
    expect(toOffsetIso("2026-07-20T18:30:45", 60)).toBe("2026-07-20T18:30:45+01:00");
  });

  it("reads the browser zone as minutes east of UTC", () => {
    expect(localOffsetMinutes("2026-07-20T18:30")).toBe(
      -new Date("2026-07-20T18:30").getTimezoneOffset(),
    );
    expect(localOffsetMinutes("not-a-date")).toBe(0);
  });
});

describe("role and status gating", () => {
  it("DRIVER may close and substitute an open job but never reopen a closed one", () => {
    renderActions(openActivity, recordingClient(committed()), meWith("DRIVER"));
    expect(screen.getByRole("button", { name: "Close the activity" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Substitute asset" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Reopen the activity" })).toBeNull();

    cleanup();
    renderActions(closedActivity, recordingClient(committed()), meWith("DRIVER"));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("DRIVER may not close or substitute a trip someone else recorded, but still captures on it", () => {
    const othersTrip = {
      ...openActivity,
      recordedByPrincipalId: "00000000-0000-4000-8000-0000000000e9",
    };
    renderActions(othersTrip, recordingClient(committed()), meWith("DRIVER"));
    expect(screen.queryByRole("button", { name: "Close the activity" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Substitute asset" })).toBeNull();
    expect(screen.getByRole("button", { name: "Add a leg" })).toBeTruthy();

    cleanup();
    renderActions(othersTrip, recordingClient(committed()), meWith("ADMIN"));
    expect(screen.getByRole("button", { name: "Close the activity" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Substitute asset" })).toBeTruthy();
  });

  it("ADMIN gets reopen on a closed job, and nothing else", () => {
    renderActions(closedActivity, recordingClient(committed()), meWith("ADMIN"));
    expect(screen.getByRole("button", { name: "Reopen the activity" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close the activity" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Substitute asset" })).toBeNull();
  });

  it("CASHIER sees no write affordance at all", () => {
    renderActions(openActivity, recordingClient(committed()), meWith("CASHIER"));
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("hides substitute when every segment has already been closed out", () => {
    renderActions(
      {
        ...openActivity,
        segments: openActivity.segments.map((segment) => ({
          ...segment,
          endedAt: "2026-07-20T10:00:00.000Z",
        })),
      },
      recordingClient(committed()),
    );
    expect(screen.getByRole("button", { name: "Close the activity" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Substitute asset" })).toBeNull();
  });
});

describe("trip header on a phone (#395)", () => {
  // jsdom has no layout, so this pins the classes between the header and each
  // button; the 390 px width itself is measured in the running app by
  // `pnpm verify drive flow:phone-overflow`, which opens an open and a closed trip.
  function wrapBlockers(button: HTMLElement): string[] {
    const blockers: string[] = [];
    for (let node = button.parentElement; node !== null; node = node.parentElement) {
      if (node.tagName === "HEADER") break;
      const classes = node.className.split(/\s+/);
      blockers.push(
        ...classes.filter(
          (c) => c === "shrink-0" || c === "flex-nowrap" || c === "whitespace-nowrap",
        ),
      );
    }
    return blockers;
  }

  it.each([
    ["an open trip, ADMIN", openActivity, "ADMIN"],
    ["an open trip, DRIVER", openActivity, "DRIVER"],
    ["a closed trip, ADMIN", closedActivity, "ADMIN"],
  ] as const)("stacks under the trip number and wraps every action for %s", (_, activity, role) => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MeCtx.Provider value={meWith(role)}>
          <PageHeader
            title={activity.activityNumber}
            actions={
              <>
                <ActivityActions activity={activity} client={recordingClient(committed())} />
                <button type="button">History</button>
              </>
            }
          />
        </MeCtx.Provider>
      </QueryClientProvider>,
    );

    const title = screen.getByRole("heading", { level: 1, name: activity.activityNumber });
    expect(title.parentElement?.className.split(/\s+/)).toContain("flex-col");
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(1);
    for (const button of buttons) {
      expect(button.parentElement?.className.split(/\s+/)).toContain("flex-wrap");
      expect({ button: button.textContent, blockers: wrapBlockers(button) }).toEqual({
        button: button.textContent,
        blockers: [],
      });
    }
  });
});

describe("close", () => {
  it("requires an end date when the activity has none, then sends it with the activity's rowVersion", async () => {
    const user = userEvent.setup();
    const client = recordingClient(committed());
    renderActions(openActivity, client);

    await user.click(screen.getByRole("button", { name: "Close the activity" }));
    const dialog = screen.getByRole("dialog", { name: "Close the activity" });
    const submit = within(dialog).getByRole("button", { name: "Close the activity" });
    expect(within(submit.parentElement!).getAllByRole("button").map((button) => button.textContent))
      .toEqual(["Cancel", "Close the activity"]);
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("End date and time"), {
      target: { value: "2026-07-21T18:30" },
    });
    await user.type(screen.getByLabelText("Note (optional)"), "Client signed off");
    await user.click(screen.getByRole("button", { name: "Close the activity" }));

    await waitFor(() => expect(client.seen.length).toBe(1));
    const submission = client.seen[0]!;
    expect(submission.name).toBe("close-activity");
    expect(submission.envelope.expectedVersion).toBe(openActivity.rowVersion);
    const payload = submission.payload as { activityId: string; endedAt: string; note: string };
    expect(payload.activityId).toBe(ACTIVITY_ID);
    expect(payload.note).toBe("Client signed off");
    expect(payload.endedAt).toMatch(/^2026-07-21T18:30:00[+-]\d{2}:\d{2}$/);
  });

  it("leaves end date optional — and omitted from the payload — once the activity already has one", async () => {
    const user = userEvent.setup();
    const client = recordingClient(committed());
    renderActions({ ...openActivity, endedAt: "2026-07-21T09:00:00.000Z" }, client);

    await user.click(screen.getByRole("button", { name: "Close the activity" }));
    expect(screen.getByLabelText("End date and time (optional)")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close the activity" }));

    await waitFor(() => expect(client.seen.length).toBe(1));
    expect(client.seen[0]!.payload).toEqual({ activityId: ACTIVITY_ID });
  });

  it("surfaces the completeness codes the server warned about in the success toast", async () => {
    const user = userEvent.setup();
    renderActions(
      { ...openActivity, endedAt: "2026-07-21T09:00:00.000Z" },
      recordingClient(committed(["ACTIVITY_NO_LEGS", "ACTIVITY_NO_REVENUE"])),
    );

    await user.click(screen.getByRole("button", { name: "Close the activity" }));
    await user.click(screen.getByRole("button", { name: "Close the activity" }));

    await waitFor(() =>
      expect(mocks.toastAdd).toHaveBeenCalledWith({
        type: "success",
        title: "Activity closed",
        description: "No legs recorded\nNo revenue attributed",
      }),
    );
  });

  it("invalidates the activity detail read so the banner reflects the new verdict", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient();
    queryClient.setQueryData(DETAIL_KEY, openActivity);

    renderActions(
      { ...openActivity, endedAt: "2026-07-21T09:00:00.000Z" },
      recordingClient(committed()),
      meWith("ADMIN"),
      queryClient,
    );

    await user.click(screen.getByRole("button", { name: "Close the activity" }));
    await user.click(screen.getByRole("button", { name: "Close the activity" }));

    await waitFor(() =>
      expect(queryClient.getQueryState(DETAIL_KEY)?.isInvalidated).toBe(true),
    );
  });

  it("keeps the dialog open and explains a hard block instead of dropping the operator's input", async () => {
    const user = userEvent.setup();
    renderActions(
      { ...openActivity, endedAt: "2026-07-21T09:00:00.000Z" },
      recordingClient({ ok: false, code: "ACTIVITY_CLOSE_BLOCKED" }),
    );

    await user.click(screen.getByRole("button", { name: "Close the activity" }));
    await user.click(screen.getByRole("button", { name: "Close the activity" }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "Cannot close: the actual dates or at least one assigned asset are missing.",
        ),
      ).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: "Close the activity" })).toBeTruthy();
    expect(mocks.toastAdd).not.toHaveBeenCalled();
  });
});

describe("reopen", () => {
  it("refuses to submit without a reason and sends the activity's rowVersion once given one", async () => {
    const user = userEvent.setup();
    const client = recordingClient(committed());
    renderActions(closedActivity, client, meWith("ADMIN"));

    await user.click(screen.getByRole("button", { name: "Reopen the activity" }));
    const submit = screen.getByRole("button", { name: "Reopen the activity" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    const reason = screen.getByLabelText("Reason");
    await user.type(reason, "   ");
    expect(
      (screen.getByRole("button", { name: "Reopen the activity" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);

    await user.clear(reason);
    await user.type(reason, "  Waybill arrived late  ");
    await user.click(screen.getByRole("button", { name: "Reopen the activity" }));

    await waitFor(() => expect(client.seen.length).toBe(1));
    const submission = client.seen[0]!;
    expect(submission.name).toBe("reopen-activity");
    expect(submission.envelope.expectedVersion).toBe(closedActivity.rowVersion);
    expect(submission.payload).toEqual({
      activityId: ACTIVITY_ID,
      reason: "Waybill arrived late",
    });
    await waitFor(() =>
      expect(mocks.toastAdd).toHaveBeenCalledWith({
        type: "success",
        title: "Activity reopened",
      }),
    );
  });
});

describe("substitute", () => {
  it("locks on the outgoing SEGMENT's rowVersion, not the activity's", async () => {
    const user = userEvent.setup();
    const client = recordingClient(committed());
    renderActions(openActivity, client);

    await user.click(screen.getByRole("button", { name: "Substitute asset" }));
    await openSelect(user, screen.getByLabelText("Replacement asset"));
    await user.keyboard("{ArrowDown}{Enter}");
    fireEvent.change(screen.getByLabelText("Handover date and time"), {
      target: { value: "2026-07-20T14:00" },
    });
    await user.type(screen.getByLabelText("Outgoing meter reading (optional)"), "412880");
    await user.click(screen.getByRole("button", { name: "Substitute asset" }));

    await waitFor(() => expect(client.seen.length).toBe(1));
    const submission = client.seen[0]!;
    expect(submission.name).toBe("substitute-asset");
    expect(submission.envelope.expectedVersion).toBe(3);
    expect(submission.envelope.expectedVersion).not.toBe(openActivity.rowVersion);

    const payload = submission.payload as {
      activityId: string;
      outgoingSegmentId: string;
      newSegmentId: string;
      substituteAssetId: string;
      handoverAt: string;
      outgoingReading?: { readingId: string; value: number; observedAt: string };
      incomingReading?: unknown;
    };
    expect(payload.activityId).toBe(ACTIVITY_ID);
    // Only the still-running segment is offered, so it is the one preselected.
    expect(payload.outgoingSegmentId).toBe(OPEN_SEGMENT_ID);
    expect(payload.newSegmentId).toBe(GENERATED_IDS[0]);
    expect(payload.substituteAssetId).toBe(RESCUE_ASSET_ID);
    expect(payload.handoverAt).toMatch(/^2026-07-20T14:00:00[+-]\d{2}:\d{2}$/);
    expect(payload.outgoingReading).toEqual({
      readingId: GENERATED_IDS[1],
      readingType: "ODOMETER",
      value: 412_880,
      observedAt: payload.handoverAt,
    });
    expect(payload.incomingReading).toBeUndefined();

    await waitFor(() =>
      expect(mocks.toastAdd).toHaveBeenCalledWith({
        type: "success",
        title: "Asset substituted",
      }),
    );
  });

  it("offers the still-running segment only, and never the outgoing asset as its own replacement", async () => {
    const user = userEvent.setup();
    renderActions(openActivity, recordingClient(committed()));

    await user.click(screen.getByRole("button", { name: "Substitute asset" }));
    // The trailer segment already ended; it is not a handover candidate.
    expect(screen.getByLabelText("Outgoing asset").textContent).toContain("DLA-T-001");

    await user.click(screen.getByLabelText("Replacement asset"));
    await waitFor(() => expect(screen.getAllByRole("option").length).toBe(1));
    expect(screen.getByRole("option").textContent).toContain("DLA-T-014");
  });

  it("stays disabled until a replacement and a handover time are both chosen", async () => {
    const user = userEvent.setup();
    renderActions(openActivity, recordingClient(committed()));

    await user.click(screen.getByRole("button", { name: "Substitute asset" }));
    const submit = () =>
      screen.getByRole("button", { name: "Substitute asset" }) as HTMLButtonElement;
    expect(submit().disabled).toBe(true);

    await openSelect(user, screen.getByLabelText("Replacement asset"));
    await user.keyboard("{ArrowDown}{Enter}");
    expect(submit().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Handover date and time"), {
      target: { value: "2026-07-20T14:00" },
    });
    await waitFor(() => expect(submit().disabled).toBe(false));
  });
});

describe("mid-trip capture", () => {
  const withLegs: ActivityDetail = {
    ...openActivity,
    legs: [
      {
        id: "00000000-0000-4000-8000-0000000000a1",
        legNo: 3,
        segmentId: OPEN_SEGMENT_ID,
        originPlaceId: DOUALA_PLACE_ID,
        originName: "Douala",
        destinationPlaceId: EDEA_PLACE_ID,
        destinationName: "Edéa",
        departedAt: null,
        arrivedAt: null,
        distanceKm: 68,
        loadState: "LADEN",
        passengerCount: null,
        customValues: {},
      },
      {
        id: "00000000-0000-4000-8000-0000000000a2",
        legNo: 1,
        segmentId: OPEN_SEGMENT_ID,
        originPlaceId: null,
        originName: "Bonabéri",
        destinationPlaceId: DOUALA_PLACE_ID,
        destinationName: "Douala",
        departedAt: null,
        arrivedAt: null,
        distanceKm: null,
        loadState: null,
        passengerCount: null,
        customValues: {},
      },
    ],
  };

  it("offers the three capture actions only while the job is open and writable", () => {
    renderActions(openActivity, recordingClient(committed()), meWith("DRIVER"));
    expect(screen.getByRole("button", { name: "Add a leg" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Record odometer" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Record expense" })).toBeTruthy();

    cleanup();
    renderActions(closedActivity, recordingClient(committed()), meWith("ADMIN"));
    expect(screen.queryByRole("button", { name: "Add a leg" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Record odometer" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Record expense" })).toBeNull();
  });

  it("numbers a new leg from the highest legNo on the job, not from how many there are", async () => {
    const user = userEvent.setup();
    const client = recordingClient(committed());
    renderActions(withLegs, client);

    await user.click(screen.getByRole("button", { name: "Add a leg" }));
    const submit = () =>
      screen.getByRole("button", { name: "Record the leg" }) as HTMLButtonElement;
    expect(submit().disabled).toBe(true);

    await user.type(screen.getByLabelText("From"), "Edéa");
    expect(submit().disabled).toBe(true);
    await user.type(screen.getByLabelText("To"), "Kribi");
    fireEvent.change(screen.getByLabelText("Departure time (optional)"), {
      target: { value: "2026-07-20T14:00" },
    });
    fireEvent.change(screen.getByLabelText("Distance in km (optional)"), {
      target: { value: "116" },
    });
    await waitFor(() => expect(submit().disabled).toBe(false));
    await user.click(submit());

    await waitFor(() => expect(client.seen.length).toBe(1));
    const submission = client.seen[0]!;
    expect(submission.name).toBe("record-movement-leg");
    // None of these three writes a versioned row of its own.
    expect(submission.envelope.expectedVersion).toBeUndefined();

    const payload = recordMovementLegPayload.parse(submission.payload);
    expect(payload.activityId).toBe(ACTIVITY_ID);
    // Two legs on the job, numbered 1 and 3: a count would have collided with 3.
    expect(payload.legNo).toBe(4);
    expect(payload.legId).toBe(GENERATED_IDS[0]);
    expect(payload.segmentId).toBe(OPEN_SEGMENT_ID);
    expect(payload.origin).toEqual({
      kind: "place",
      placeId: EDEA_PLACE_ID,
      name: "Edéa",
    });
    // Unknown to the workspace, so it travels with a freshly minted place id.
    expect(payload.destination).toMatchObject({ kind: "place", name: "Kribi" });
    expect(payload.distanceKm).toBe(116);
    expect(payload.departedAt).toMatch(/^2026-07-20T14:00:00[+-]\d{2}:\d{2}$/);
    expect(payload.arrivedAt).toBeUndefined();

    await waitFor(() =>
      expect(mocks.toastAdd).toHaveBeenCalledWith({
        type: "success",
        title: "Leg recorded",
      }),
    );
  });

  it("records a manual reading against the activity and surfaces a backwards meter", async () => {
    const user = userEvent.setup();
    const client = recordingClient(committed(["METER_READING_DECREASED"]));
    renderActions(openActivity, client);

    await user.click(screen.getByRole("button", { name: "Record odometer" }));
    const submit = () =>
      screen.getByRole("button", { name: "Record the reading" }) as HTMLButtonElement;
    expect(submit().disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "412000" } });
    fireEvent.change(screen.getByLabelText("Reading date and time"), {
      target: { value: "2026-07-20T15:30" },
    });
    await waitFor(() => expect(submit().disabled).toBe(false));
    await user.click(submit());

    await waitFor(() => expect(client.seen.length).toBe(1));
    const submission = client.seen[0]!;
    expect(submission.name).toBe("record-meter-reading");
    expect(submission.envelope.expectedVersion).toBeUndefined();

    const payload = recordMeterReadingPayload.parse(submission.payload);
    expect(payload.readingId).toBe(GENERATED_IDS[0]);
    // The still-running primary is preselected, not the trailer that ended.
    expect(payload.assetId).toBe(PRIMARY_ASSET_ID);
    expect(payload.readingType).toBe("ODOMETER");
    expect(payload.value).toBe(412_000);
    expect(payload.source).toBe("MANUAL");
    expect(payload.activityId).toBe(ACTIVITY_ID);
    expect(payload.observedAt).toMatch(/^2026-07-20T15:30:00[+-]\d{2}:\d{2}$/);

    // Warn, don't block: the reading is kept and the doubt is shown.
    await waitFor(() =>
      expect(mocks.toastAdd).toHaveBeenCalledWith({
        type: "success",
        title: "Reading recorded",
        description: "The reading is lower than the previous one",
      }),
    );
  });

  it.each(["Add a leg", "Record odometer", "Record expense"])(
    "titles the %s form with the words of the button that opened it (#401)",
    async (button) => {
      const user = userEvent.setup();
      renderActions(openActivity, recordingClient(committed()));
      await user.click(screen.getByRole("button", { name: button }));
      expect(await screen.findByRole("dialog", { name: button })).toBeTruthy();
    },
  );

  it("attributes a mid-trip expense to both the truck and the trip", async () => {
    const user = userEvent.setup();
    const client = recordingClient(committed());
    renderActions(openActivity, client);

    await user.click(screen.getByRole("button", { name: "Record expense" }));
    const submit = () =>
      screen.getByRole("button", { name: "Record the expense" }) as HTMLButtonElement;
    expect(submit().disabled).toBe(true);

    await openSelect(user, screen.getByLabelText("Category"));
    await user.keyboard("{ArrowDown}{Enter}");
    await user.type(screen.getByLabelText("Amount (FCFA)"), "40000");
    await waitFor(() => expect(submit().disabled).toBe(false));
    await user.click(submit());

    await waitFor(() => expect(client.seen.length).toBe(1));
    const submission = client.seen[0]!;
    expect(submission.name).toBe("record-expense");
    expect(submission.envelope.expectedVersion).toBeUndefined();

    const payload = recordExpensePayload.parse(submission.payload);
    expect(payload.entryId).toBe(GENERATED_IDS[0]);
    expect(payload.branchCode).toBe("DLA");
    expect(payload.categoryCode).toBe("FUEL");
    expect(payload.currency).toBe("XAF");
    // XAF has exponent 0 — 40 000 typed is 40 000 minor units, not 4 000 000.
    expect(payload.amountMinor).toBe(40_000);
    expect(payload.postings).toEqual([
      {
        assetId: PRIMARY_ASSET_ID,
        activityId: ACTIVITY_ID,
        amountMinor: 40_000,
        assetAttribution: "DIRECT",
      },
    ]);

    await waitFor(() =>
      expect(mocks.toastAdd).toHaveBeenCalledWith({
        type: "success",
        title: "Entry recorded",
      }),
    );
  });

  it("says an above-threshold expense is waiting for an approver instead of claiming it was posted", async () => {
    const user = userEvent.setup();
    renderActions(openActivity, recordingClient(committed([], "SUBMITTED")));

    await user.click(screen.getByRole("button", { name: "Record expense" }));
    await openSelect(user, screen.getByLabelText("Category"));
    await user.keyboard("{ArrowDown}{Enter}");
    await user.type(screen.getByLabelText("Amount (FCFA)"), "900000");
    await user.click(screen.getByRole("button", { name: "Record the expense" }));

    await waitFor(() =>
      expect(mocks.toastAdd).toHaveBeenCalledWith({
        type: "success",
        title: "Entry sent for approval",
      }),
    );
  });

  it("keeps the expense dialog open and names the failure instead of dropping the input", async () => {
    const user = userEvent.setup();
    renderActions(
      openActivity,
      recordingClient({ ok: false, code: "PERIOD_LOCKED" }),
    );

    await user.click(screen.getByRole("button", { name: "Record expense" }));
    await openSelect(user, screen.getByLabelText("Category"));
    await user.keyboard("{ArrowDown}{Enter}");
    await user.type(screen.getByLabelText("Amount (FCFA)"), "40000");
    await user.click(screen.getByRole("button", { name: "Record the expense" }));

    await waitFor(() =>
      expect(
        screen.getByText("This period is locked. No postings are possible."),
      ).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: "Record the expense" })).toBeTruthy();
    expect(mocks.toastAdd).not.toHaveBeenCalled();
  });
});
