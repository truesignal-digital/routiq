// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UseActivitiesParams } from "../activities/useActivities.js";

/** One record per distinct query key — an unchanged key is a cache hit. */
const issuedQueries: UseActivitiesParams[] = [];

function recordQuery(params: UseActivitiesParams): void {
  const previous = issuedQueries[issuedQueries.length - 1];
  if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(params)) return;
  issuedQueries.push(params);
}

vi.mock("react-i18next", async () => {
  const actual = await vi.importActual("react-i18next");
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) =>
        key === "activities.completeness.short"
          ? `${String(options?.["count"])} exceptions`
          : key,
      i18n: { language: "en", resolvedLanguage: "en", exists: () => true, t: (k: string) => k },
    }),
    initReactI18next: { type: "3rdParty", init: () => {} },
  };
});

const navigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
  useParams: () => ({}),
  Link: ({ to, children, ...props }: { to: string; children?: ReactNode }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

const activityRows = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    activityNumber: "DLA-2026-00042",
    activityType: { code: "HAULAGE_JOB", labelFr: "Job de halage", labelEn: "Haulage job" },
    status: "CLOSED" as const,
    completeness: "COMPLETE_WITH_EXCEPTIONS" as const,
    completenessCodes: ["ACTIVITY_MISSING_END_READING" as const],
    startedAt: "2026-07-14T06:10:00.000Z",
    endedAt: "2026-07-15T09:00:00.000Z",
    customerName: "Brasseries du Cameroun",
    clientReference: "WB-4471",
    branchId: "22222222-2222-4222-8222-222222222222",
    primaryAssetCode: "CMR-TR-014",
    legCount: 2,
    crewCount: 1,
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    activityNumber: "DLA-2026-00043",
    activityType: { code: "HAULAGE_JOB", labelFr: "Job de halage", labelEn: "Haulage job" },
    status: "OPEN" as const,
    completeness: null,
    completenessCodes: [],
    startedAt: "2026-07-16T06:00:00.000Z",
    endedAt: null,
    customerName: null,
    clientReference: null,
    branchId: "22222222-2222-4222-8222-222222222222",
    primaryAssetCode: "CMR-TR-009",
    legCount: 0,
    crewCount: 0,
  },
];

vi.mock("../activities/useActivities.js", () => ({
  useActivities: (params: UseActivitiesParams) => {
    recordQuery(params);
    return {
      data: { pages: [{ items: activityRows, nextCursor: null }] },
      isError: false,
      isPending: false,
      hasNextPage: false,
      isFetchingNextPage: false,
      fetchNextPage: vi.fn(),
      refetch: vi.fn(),
    };
  },
}));

vi.mock("../documents/useCategories.js", () => ({
  useCategories: () => ({
    data: [
      {
        code: "HAULAGE_JOB",
        labelFr: "Job de halage",
        labelEn: "Haulage job",
      },
    ],
  }),
}));

vi.mock("../assets/reference.js", () => ({
  useAssetRegistrationReference: () => ({
    data: {
      assetClasses: [],
      branches: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          code: "DLA",
          name: "Douala",
        },
      ],
    },
  }),
}));

vi.mock("../assets/useAssetOptions.js", () => ({
  useAssetOptions: () => [
    {
      value: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      label: "CMR-TR-014",
    },
  ],
}));

const me = {
  role: "OPS_MANAGER" as const,
  enabledModules: ["CORE", "ACTIVITIES"] as const,
};

vi.mock("../auth/me.js", async () => {
  const actual = await vi.importActual<typeof import("../auth/me.js")>("../auth/me.js");
  return { ...actual, useMeContext: () => meValue };
});

let meValue: unknown = me;

const { ActivitiesScreen } = await import("./ActivitiesScreen.js");

describe("ActivitiesScreen", () => {
  beforeEach(() => {
    issuedQueries.length = 0;
    navigate.mockClear();
    meValue = me;
  });
  afterEach(cleanup);

  it("lists jobs with their number and carrier", async () => {
    render(<ActivitiesScreen />);
    expect(await screen.findByText("DLA-2026-00042")).toBeTruthy();
    expect(screen.getByText("CMR-TR-014")).toBeTruthy();
    expect(screen.getByText("DLA-2026-00043")).toBeTruthy();
  });

  it("surfaces the exception count rather than hiding it behind the row", async () => {
    render(<ActivitiesScreen />);
    // §3.4 inv. 6 lets a job close with gaps; the list has to say so, or the
    // reader takes an incomplete record for a complete one.
    expect(await screen.findByText("1 exceptions")).toBeTruthy();
  });

  it("asks the server to filter rather than narrowing the loaded page", async () => {
    render(<ActivitiesScreen />);
    await screen.findByText("DLA-2026-00042");

    const status = screen.getByRole("combobox", { name: /status/i });
    await userEvent.click(status);
    await userEvent.click(await screen.findByRole("option", { name: "activities.status.OPEN" }));

    // Filtering client-side would describe the page, not the fleet.
    await waitFor(() => {
      expect(issuedQueries.some((query) => query.status === "OPEN")).toBe(true);
    });
  });

  it("sends every activity filter to the server query", async () => {
    render(<ActivitiesScreen />);
    await screen.findByText("DLA-2026-00042");

    await userEvent.click(
      screen.getByRole("combobox", { name: "activities.filters.activityType" }),
    );
    await userEvent.click(
      await screen.findByRole("option", { name: "Haulage job" }),
    );

    await userEvent.click(
      screen.getByRole("combobox", { name: "activities.filters.branch" }),
    );
    await userEvent.click(await screen.findByRole("option", { name: "Douala" }));

    await userEvent.click(
      screen.getByRole("combobox", { name: "activities.filters.asset" }),
    );
    await userEvent.click(
      await screen.findByRole("option", { name: "CMR-TR-014" }),
    );

    await userEvent.click(
      screen.getByRole("button", {
        name: "activities.filters.from – activities.filters.to",
      }),
    );

    const current = new Date();
    const rangeFrom = new Date(current.getFullYear(), current.getMonth(), 1);
    const rangeTo = new Date(current.getFullYear(), current.getMonth(), 2);
    const fullDate = new Intl.DateTimeFormat("en-US", { dateStyle: "full" });
    const isoDate = (date: Date) =>
      [
        String(date.getFullYear()).padStart(4, "0"),
        String(date.getMonth() + 1).padStart(2, "0"),
        String(date.getDate()).padStart(2, "0"),
      ].join("-");

    await userEvent.click(
      await screen.findByRole("button", { name: fullDate.format(rangeFrom) }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: fullDate.format(rangeTo) }),
    );

    await waitFor(() => {
      expect(issuedQueries.at(-1)).toMatchObject({
        activityTypeCode: "HAULAGE_JOB",
        branchId: "22222222-2222-4222-8222-222222222222",
        assetId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        from: isoDate(rangeFrom),
        to: isoDate(rangeTo),
      });
    });
  });

  it("offers ended date and crew count as toggleable columns", async () => {
    render(<ActivitiesScreen />);
    expect(
      await screen.findByRole("columnheader", { name: "activities.columns.endedAt" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("columnheader", { name: "activities.columns.crewCount" }),
    ).toBeTruthy();

    await userEvent.click(
      screen.getByRole("button", { name: "dataTable.view" }),
    );
    await userEvent.click(
      await screen.findByRole("menuitemcheckbox", {
        name: "activities.columns.endedAt",
      }),
    );
    await userEvent.click(
      await screen.findByRole("menuitemcheckbox", {
        name: "activities.columns.crewCount",
      }),
    );

    expect(
      screen.queryByRole("columnheader", { name: "activities.columns.endedAt" }),
    ).toBeNull();
    expect(
      screen.queryByRole("columnheader", { name: "activities.columns.crewCount" }),
    ).toBeNull();
  });

  it("sorts on the read's default order", () => {
    render(<ActivitiesScreen />);
    expect(issuedQueries[0]?.sort).toBe("startedAt:desc");
  });

  it("shows a denied surface when the module is off", async () => {
    meValue = { role: "OPS_MANAGER", enabledModules: ["CORE"] };
    render(<ActivitiesScreen />);
    expect(await screen.findByText("activities.title")).toBeTruthy();
    expect(screen.queryByText("DLA-2026-00042")).toBeNull();
  });
});
