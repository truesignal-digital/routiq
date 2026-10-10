// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OverviewNotice } from "@routiq/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MeCtx, type MeContext } from "@/auth/me.js";
import { i18n } from "@/i18n/index.js";
import { OverviewSummary } from "./overview-summary.js";
import { noticeReason, readClosedSummary, summaryStorageKey } from "./summary-notice.js";

const WORKSPACE = "00000000-0000-4000-8000-000000000001";
const SALI = "00000000-0000-4000-8000-000000000002";
const HERVE = "00000000-0000-4000-8000-000000000009";

function me(principalId = SALI): MeContext {
  return {
    workspaceId: WORKSPACE,
    principalId,
    principalType: "HUMAN",
    membershipId: "00000000-0000-4000-8000-000000000003",
    displayName: "Sali Ahmadou",
    workspaceName: "Transports Ngwa",
    role: "ADMIN",
    branchScope: "ALL",
    enabledModules: ["CORE", "ASSETS", "MAINTENANCE", "FINANCE"],
    enabledPresets: [],
    timezone: "Africa/Douala",
  };
}

const FRIDAY: OverviewNotice = { today: "2026-10-09", scheduledOn: "2026-10-05", scheduledToday: null, changes: [] };
const MONDAY: OverviewNotice = { today: "2026-10-05", scheduledOn: "2026-10-05", scheduledToday: "MONDAY", changes: [] };
const NEXT_MONDAY: OverviewNotice = { today: "2026-10-12", scheduledOn: "2026-10-12", scheduledToday: "MONDAY", changes: [] };
const FIRST: OverviewNotice = { today: "2026-11-01", scheduledOn: "2026-11-01", scheduledToday: "MONTH_START", changes: [] };
const grounding = (key: string, code: string) => ({
  kind: "VEHICLE_GROUNDED" as const,
  key,
  assetId: "bbbbbbbb-0000-4000-8000-000000000003",
  assetCode: code,
  since: "2026-10-07T08:00:00.000Z",
});

function Summary({ notice, principalId = SALI }: { notice: OverviewNotice | undefined; principalId?: string }) {
  return (
    <MeCtx.Provider value={me(principalId)}>
      <OverviewSummary
        page="dashboard"
        notice={notice}
        sentence="October so far: 1,870,000 XAF profit."
        details={["Spending on Fuel rose by 420,000 XAF."]}
        badge={<span>Behind September</span>}
        counted={<span>Counted: 84 posted entries.</span>}
      >
        <div data-slot="tiles">tiles</div>
      </OverviewSummary>
    </MeCtx.Provider>
  );
}

/** "summary" or "tiles", in the order they sit on the page. */
function order(): string[] {
  return [...document.querySelectorAll('[data-slot="overview-summary"], [data-slot="tiles"], [data-summary="closed"]')].map(
    (node) => node.getAttribute("data-slot") === "overview-counted" ? "counted" : (node.getAttribute("data-slot") ?? ""),
  );
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

beforeEach(() => localStorage.clear());
afterEach(cleanup);

describe("noticeReason", () => {
  it("is due on a scheduled day not yet closed, and on a change the last close did not cover", () => {
    expect(noticeReason(MONDAY, undefined)).toBe("MONDAY");
    expect(noticeReason(FIRST, undefined)).toBe("MONTH_START");
    expect(noticeReason(MONDAY, { scheduledOn: "2026-10-05", changeKeys: [] })).toBeNull();
    expect(noticeReason(FRIDAY, undefined)).toBeNull();
    const changed = { ...FRIDAY, changes: [grounding("G1", "VH003")] };
    expect(noticeReason(changed, { scheduledOn: "2026-10-05", changeKeys: [] })).toBe("CHANGE");
    expect(noticeReason(changed, { scheduledOn: "2026-10-05", changeKeys: ["G1"] })).toBeNull();
  });
});

describe("OverviewSummary (#667)", () => {
  it("is hidden on a plain day: tiles first, then the counted line with Show summary", async () => {
    render(<Summary notice={FRIDAY} />);
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
    expect(order()).toEqual(["tiles", "counted"]);
    expect(screen.getByText("Counted: 84 posted entries.")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Show summary" }));
    expect(screen.getByRole("region", { name: "Summary" }).textContent).toContain("October so far: 1,870,000 XAF profit.");
    expect(order()).toEqual(["overview-summary", "tiles"]);
  });

  it("shows on Monday above the tiles, with what it counted inside, and stays closed after a reload", async () => {
    const { unmount } = render(<Summary notice={MONDAY} />);
    const region = screen.getByRole("region", { name: "Summary" });
    expect(region.querySelector('[data-slot="overview-summary-when"]')?.textContent).toBe("Monday summary · Monday, October 5");
    expect(region.textContent).toContain("Spending on Fuel rose by 420,000 XAF.");
    expect(region.textContent).toContain("Behind September");
    expect(region.querySelector('[data-summary="open"]')?.textContent).toBe("Counted: 84 posted entries.");
    expect(order()).toEqual(["overview-summary", "tiles"]);

    await userEvent.click(screen.getByRole("button", { name: "Close the summary" }));
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
    expect(order()).toEqual(["tiles", "counted"]);
    expect(readClosedSummary(summaryStorageKey(WORKSPACE, SALI, "dashboard"))).toEqual({
      scheduledOn: "2026-10-05",
      changeKeys: [],
    });

    unmount();
    render(<Summary notice={MONDAY} />);
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
  });

  it("comes back on the next scheduled day, and on the 1st talks of the month start", async () => {
    const { rerender } = render(<Summary notice={MONDAY} />);
    await userEvent.click(screen.getByRole("button", { name: "Close the summary" }));
    rerender(<Summary notice={FRIDAY} />);
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
    rerender(<Summary notice={NEXT_MONDAY} />);
    expect(screen.getByRole("region", { name: "Summary" })).toBeTruthy();
    rerender(<Summary notice={FIRST} />);
    expect(screen.getByRole("region", { name: "Summary" }).textContent).toContain("Start of the month summary · Sunday, November 1");
  });

  it("is each person's own: closing it for one leaves it open for another", async () => {
    render(<Summary notice={MONDAY} />);
    await userEvent.click(screen.getByRole("button", { name: "Close the summary" }));
    cleanup();
    render(<Summary notice={MONDAY} principalId={HERVE} />);
    expect(screen.getByRole("region", { name: "Summary" })).toBeTruthy();
  });

  it("shows on any day when a vehicle is grounded, until closed; a new grounding brings it back", async () => {
    const changed = { ...FRIDAY, changes: [grounding("G1", "VH003")] };
    const { rerender } = render(<Summary notice={changed} />);
    const region = screen.getByRole("region", { name: "Summary" });
    expect(region.textContent).toContain("Something changed · Friday, October 9");
    expect(region.textContent).toContain("VH003 was grounded on October 7 and is still off the road.");

    await userEvent.click(screen.getByRole("button", { name: "Close the summary" }));
    rerender(<Summary notice={{ ...changed }} />);
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();

    rerender(<Summary notice={{ ...FRIDAY, changes: [grounding("G1", "VH003"), grounding("G2", "VH007")] }} />);
    expect(screen.getByRole("region", { name: "Summary" }).textContent).toContain(
      "2 vehicles were grounded in the last 7 days and are still off the road: VH003 and VH007.",
    );
  });

  it("names expenses up only where the page asks for it", () => {
    const up = {
      ...FRIDAY,
      changes: [{ kind: "EXPENSES_UP" as const, key: "E", expenseMinor: 7_690_000, comparisonExpenseMinor: 6_100_000, percent: 26 }],
    };
    render(
      <MeCtx.Provider value={me()}>
        <OverviewSummary
          page="money"
          notice={up}
          sentence="October so far."
          counted={null}
          expensesUp={{ window: "soFar", comparisonMonth: "September" }}
        >
          <div data-slot="tiles" />
        </OverviewSummary>
      </MeCtx.Provider>,
    );
    expect(screen.getByRole("region", { name: "Summary" }).textContent).toContain(
      "Expenses are 26% above September at the same day.",
    );
  });

  it("draws nothing of its own while the read loads", () => {
    render(<Summary notice={undefined} />);
    expect(screen.queryByRole("region", { name: "Summary" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show summary" })).toBeNull();
    expect(screen.getByText("tiles")).toBeTruthy();
  });
});
