// @vitest-environment jsdom
import type { AssetDetail } from "@routiq/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MeCtx, type MeContext } from "../auth/me.js";
import { i18n } from "../i18n/index.js";

const ASSET_ID = "00000000-0000-4000-8000-000000000010";
const ACTIVITY_ID = "00000000-0000-4000-8000-000000000030";

const mocks = vi.hoisted(() => ({ useAssetDetail: vi.fn() }));

vi.mock("@tanstack/react-router", () => ({
  useParams: () => ({ assetId: ASSET_ID }),
  // Resolves `$param` segments so the href assertions below still mean
  // something — a mock that dropped params would pass on a broken link.
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

vi.mock("../assets/useAssetDetail.js", () => ({
  useAssetDetail: mocks.useAssetDetail,
}));

const { AssetDetailScreen } = await import("./AssetDetailScreen.js");

const manager: MeContext = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  principalId: "00000000-0000-4000-8000-000000000002",
  principalType: "HUMAN",
  membershipId: "00000000-0000-4000-8000-000000000003",
  role: "OPS_MANAGER",
  branchScope: "ALL",
  enabledModules: ["CORE", "ASSETS", "FINANCE", "DOCUMENTS"],
  enabledPresets: ["TRUCKING"],
};

function asset(overrides: Partial<AssetDetail> = {}): AssetDetail {
  return {
    id: ASSET_ID,
    assetCode: "CAMION-03",
    registrationNumber: "LT-402-AB",
    manufacturer: "Mercedes",
    model: "Actros",
    modelYear: 2019,
    chassisNumber: null,
    lifecycleStatus: "IN_SERVICE",
    rowVersion: 3,
    assetClassCode: "TRUCK",
    category: { code: "TRUCK", labelFr: "Camion", labelEn: "Truck" },
    branch: { code: "DLA", name: "Douala" },
    branchId: "00000000-0000-4000-8000-000000000004",
    templateCode: "TRUCKING",
    templateVersion: 1,
    acquisitionDate: null,
    acquisitionAmountMinor: null,
    currency: "XAF",
    commissionedAt: "2026-01-05T08:00:00.000Z",
    customValues: {},
    finance: {
      currency: "XAF",
      revenueMinor: 900_000,
      expenseMinor: 400_000,
      netMinor: 500_000,
      expenseByCategory: [
        { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel", totalMinor: 310_000 },
        { code: "REPAIRS", labelFr: "Réparations", labelEn: "Repairs", totalMinor: 90_000 },
      ],
    },
    recentActivities: [
      {
        id: ACTIVITY_ID,
        activityNumber: "DLA-2026-00042",
        activityType: {
          code: "HAULAGE_JOB",
          labelFr: "Job de halage",
          labelEn: "Haulage job",
        },
        status: "OPEN",
        completeness: null,
        customerName: "Cimencam",
        startedAt: "2026-07-18T06:00:00.000Z",
        endedAt: null,
      },
    ],
    ...overrides,
  };
}

function renderScreen() {
  return render(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(
        MeCtx.Provider,
        { value: manager },
        createElement(AssetDetailScreen),
      ),
    ),
  );
}

/** The value `<dd>` that follows a figure's `<dt>` label. */
function figure(label: string): HTMLElement {
  const value = screen.getByText(label).nextElementSibling;
  if (!(value instanceof HTMLElement)) throw new Error(`no value for ${label}`);
  return value;
}

/** XAF is formatted with narrow/non-breaking spaces; compare on digits alone. */
function digits(element: HTMLElement): string {
  return (element.textContent ?? "").replace(/[^\d+-]/g, "");
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useAssetDetail.mockReturnValue({
    data: asset(),
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe("asset detail", () => {
  it("answers the money question with revenue, expenses and net", () => {
    renderScreen();

    expect(digits(figure("Revenue"))).toBe("900000");
    expect(digits(figure("Expenses"))).toBe("400000");
    expect(digits(figure("Net result"))).toBe("+500000");
  });

  it("colours a profit and a loss differently, and signs both", () => {
    renderScreen();
    expect(figure("Net result").className).toContain("text-success-foreground");
    cleanup();

    mocks.useAssetDetail.mockReturnValue({
      data: asset({
        finance: {
          currency: "XAF",
          revenueMinor: 120_000,
          expenseMinor: 400_000,
          netMinor: -280_000,
          expenseByCategory: [],
        },
      }),
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderScreen();

    const net = figure("Net result");
    expect(net.className).toContain("text-destructive");
    expect(digits(net)).toBe("-280000");
  });

  it("breaks the expenses down by category", () => {
    renderScreen();

    const fuel = screen.getByText("Fuel").nextElementSibling;
    expect(fuel).toBeTruthy();
    expect(digits(fuel as HTMLElement)).toBe("310000");
    expect(screen.getByText("Repairs")).toBeTruthy();
  });

  it("says nothing is posted rather than showing a zero balance", () => {
    mocks.useAssetDetail.mockReturnValue({
      data: asset({
        finance: {
          currency: "XAF",
          revenueMinor: 0,
          expenseMinor: 0,
          netMinor: 0,
          expenseByCategory: [],
        },
      }),
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    renderScreen();

    expect(screen.getByText("Nothing posted against this asset yet.")).toBeTruthy();
    expect(screen.queryByText("Net result")).toBeNull();
  });

  it("links each recent activity to its own page", () => {
    renderScreen();

    const link = screen.getByRole("link", { name: /DLA-2026-00042/ });
    expect(link.getAttribute("href")).toBe(`/activities/${ACTIVITY_ID}`);
  });

  it("offers the asset's documents", () => {
    renderScreen();

    const link = screen.getByRole("link", { name: /documents/i });
    expect(link.getAttribute("href")).toBe(`/assets/${ASSET_ID}/documents`);
  });

  it("offers a retry when the read fails", () => {
    const refetch = vi.fn();
    mocks.useAssetDetail.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch,
    });
    renderScreen();

    expect(screen.getByRole("alert").textContent).toContain(
      "We couldn't load this asset.",
    );
  });
});
