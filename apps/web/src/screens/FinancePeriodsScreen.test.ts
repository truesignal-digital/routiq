// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { MeCtx, type MeContext } from "../auth/me.js";
import { i18n } from "../i18n/index.js";
import { FinancePeriodsScreen } from "./FinancePeriodsScreen.js";

const mocks = vi.hoisted(() => ({
  createCommandIntent: vi.fn(),
  usePeriods: vi.fn(),
  toastAdd: vi.fn(),
}));

vi.mock("@/components/ui/toast.js", () => ({
  toast: { add: mocks.toastAdd },
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("../commands/intent.js", () => ({
  createCommandIntent: mocks.createCommandIntent,
}));

vi.mock("../finance/usePeriods.js", () => ({
  usePeriods: mocks.usePeriods,
}));

/** The month the server says it is in the workspace's time zone (#591). */
const CURRENT = "2026-10";

const director: MeContext = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  principalId: "00000000-0000-4000-8000-000000000002",
  principalType: "HUMAN",
  membershipId: "00000000-0000-4000-8000-000000000003",
  displayName: "Sali Ahmadou",
  workspaceName: "Transports Ngwa",
  role: "DIRECTOR",
  branchScope: "ALL",
  enabledModules: ["CORE", "FINANCE"],
  enabledPresets: ["TRUCKING", "PASSENGER_TRANSPORT"],
  timezone: "Africa/Douala",
};

function renderScreen(me: MeContext = director, client = new QueryClient()) {
  return render(
    createElement(
      QueryClientProvider,
      { client },
      createElement(
        MeCtx.Provider,
        { value: me },
        createElement(FinancePeriodsScreen),
      ),
    ),
  );
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

/** jsdom never matches a width query; the table needs a nudge to render desktop. */
function mockDesktop() {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

/** Period codes top to bottom, read through each row's first cell. */
function periodCodesInOrder(): string[] {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell")[0]?.textContent ?? "");
}

/** Lock and reopen moved off the row into its ⋯ menu. Row 0 is the open
 * current period, row 1 the locked one. */
async function chooseRowAction(
  user: ReturnType<typeof userEvent.setup>,
  rowIndex: number,
  name: string,
) {
  await user.click(screen.getAllByRole("button", { name: "Actions" })[rowIndex]!);
  await user.click(await screen.findByRole("menuitem", { name }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDesktop();
  mocks.usePeriods.mockReturnValue({
    data: {
      currentPeriodCode: CURRENT,
      periods: [
        {
          periodCode: CURRENT,
          status: "OPEN",
          lockedAt: null,
          entryCount: 2,
          rowVersion: 1,
        },
        {
          periodCode: "2026-06",
          status: "LOCKED",
          lockedAt: "2026-07-01T10:00:00.000Z",
          entryCount: 4,
          rowVersion: 2,
        },
      ],
    },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
});

afterEach(cleanup);

describe("finance period command routing", () => {
  it("dispatches lock then reopen through their distinct commands", async () => {
    const submissionOrder: string[] = [];
    mocks.createCommandIntent.mockImplementation(
      (_client: unknown, commandName: string) => ({
        current: vi.fn(),
        submit: vi.fn(async () => {
          submissionOrder.push(commandName);
          return {
            ok: true,
            outcome: {
              commandId: crypto.randomUUID(),
              recordId: crypto.randomUUID(),
              rowVersion: 1,
              warnings: [],
              idempotentReplay: false,
            },
          };
        }),
      }),
    );
    const user = userEvent.setup();
    renderScreen();

    await chooseRowAction(user, 0, "Lock period");
    const dialog = screen.getByRole("alertdialog", { name: "Lock period" });
    expect(within(dialog).getAllByRole("button").map((button) => button.textContent))
      .toEqual(["Cancel", "Lock period"]);
    await user.click(screen.getByRole("button", { name: "Lock period" }));
    await waitFor(() => expect(submissionOrder).toEqual(["lock-period"]));
    expect(mocks.toastAdd).toHaveBeenCalledWith({
      type: "success",
      title: "Period locked",
    });

    await chooseRowAction(user, 1, "Reopen period");
    await user.type(screen.getByLabelText("Reason for reopening"), "Correction needed");
    await user.click(screen.getByRole("button", { name: "Reopen period" }));

    await waitFor(() =>
      expect(submissionOrder).toEqual(["lock-period", "reopen-period"]),
    );
  });

  // #571: both commands version-check a stored period row, so the screen must
  // send the row version it showed; without it the server answers
  // EXPECTED_VERSION_REQUIRED and the month never locks.
  it("sends the row version it shows with lock and reopen", async () => {
    const submits = new Map<string, ReturnType<typeof vi.fn>>();
    mocks.createCommandIntent.mockImplementation(
      (_client: unknown, commandName: string) => {
        const submit = vi.fn(async () => ({
          ok: true,
          outcome: {
            commandId: crypto.randomUUID(),
            recordId: crypto.randomUUID(),
            rowVersion: 9,
            warnings: [],
            idempotentReplay: false,
          },
        }));
        submits.set(commandName, submit);
        return { current: vi.fn(), submit };
      },
    );
    const user = userEvent.setup();
    renderScreen();

    await chooseRowAction(user, 0, "Lock period");
    await user.click(screen.getByRole("button", { name: "Lock period" }));
    await waitFor(() =>
      expect(submits.get("lock-period")).toHaveBeenCalledWith(
        { periodCode: CURRENT },
        { expectedVersion: 1 },
      ),
    );

    await chooseRowAction(user, 1, "Reopen period");
    await user.type(screen.getByLabelText("Reason for reopening"), "Correction needed");
    await user.click(screen.getByRole("button", { name: "Reopen period" }));
    await waitFor(() =>
      expect(submits.get("reopen-period")).toHaveBeenCalledWith(
        { periodCode: "2026-06", reason: "Correction needed" },
        { expectedVersion: 2 },
      ),
    );
  });

  it("locks the current month at version 0 when the server has no row for it yet", async () => {
    mocks.usePeriods.mockReturnValue({
      data: { periods: [], currentPeriodCode: CURRENT },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    const submit = vi.fn(async () => ({
      ok: true,
      outcome: {
        commandId: crypto.randomUUID(),
        recordId: crypto.randomUUID(),
        rowVersion: 2,
        warnings: [],
        idempotentReplay: false,
      },
    }));
    mocks.createCommandIntent.mockReturnValue({ current: vi.fn(), submit });
    const user = userEvent.setup();
    renderScreen();

    await chooseRowAction(user, 0, "Lock period");
    await user.click(screen.getByRole("button", { name: "Lock period" }));
    await waitFor(() =>
      expect(submit).toHaveBeenCalledWith(
        { periodCode: CURRENT },
        { expectedVersion: 0 },
      ),
    );
  });

  it("refetches the months after a version conflict so the next try sends the fresh version", async () => {
    const submit = vi.fn(async () => ({ ok: false, code: "VERSION_CONFLICT" }));
    mocks.createCommandIntent.mockReturnValue({ current: vi.fn(), submit });
    const queryClient = new QueryClient();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const user = userEvent.setup();
    renderScreen(director, queryClient);

    await chooseRowAction(user, 0, "Lock period");
    await user.click(screen.getByRole("button", { name: "Lock period" }));

    expect(
      await within(screen.getByRole("alertdialog")).findByText(
        "Someone else modified this record. Refresh, then reapply your changes.",
      ),
    ).toBeTruthy();
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["ws", undefined, "finance", "periods"],
    });
  });

  it("lets Finance lock a period but leaves reopening to the Director", async () => {
    const user = userEvent.setup();
    renderScreen({ ...director, role: "FINANCE" });

    const menus = screen.getAllByRole("button", { name: "Actions" });
    // Only the open period's row has a menu: the locked one offers Finance nothing.
    expect(menus).toHaveLength(1);
    await user.click(menus[0]!);
    expect(await screen.findByRole("menuitem", { name: "Lock period" })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: "Reopen period" })).toBeNull();
  });

  it.each(["ADMIN", "CASHIER", "TECHNICIAN", "DRIVER"] as const)(
    "shows %s no period actions at all",
    (role) => {
      renderScreen({ ...director, role });
      expect(screen.queryAllByRole("button", { name: "Actions" })).toHaveLength(0);
    },
  );

  it("cancels reopen without dispatching", async () => {
    const user = userEvent.setup();
    renderScreen();

    await chooseRowAction(user, 1, "Reopen period");
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).toBeNull(),
    );
    expect(mocks.createCommandIntent).not.toHaveBeenCalled();
  });

  // The periods read is unpaginated, so client-side sorting reorders the whole
  // list — the reason these headers carry a sort control and the entries table's
  // headers do not.
  it("reorders the whole list from a column header, newest period first by default", async () => {
    const user = userEvent.setup();
    renderScreen();

    expect(periodCodesInOrder()).toEqual([CURRENT, "2026-06"]);

    // Busiest period first: 2026-06 holds four entries, the current one two.
    await user.click(screen.getByRole("button", { name: "Entries" }));
    expect(periodCodesInOrder()).toEqual(["2026-06", CURRENT]);

    await user.click(screen.getByRole("button", { name: "Entries" }));
    expect(periodCodesInOrder()).toEqual([CURRENT, "2026-06"]);
  });

  it("uses the wide container the other finance list screens use", () => {
    const { container } = renderScreen();

    expect(container.querySelector("section")?.className).toContain("max-w-6xl");
  });

  // #585: a locked month still takes late entries, into the current month
  // (resolvePostingPeriod); only locking the current month stops posting.
  it("says what locking does to late entries, past month or current", async () => {
    mocks.usePeriods.mockReturnValue({
      data: {
        currentPeriodCode: CURRENT,
        periods: [
          { periodCode: CURRENT, status: "OPEN", lockedAt: null, entryCount: 2, rowVersion: 1 },
          { periodCode: "2026-05", status: "OPEN", lockedAt: null, entryCount: 3, rowVersion: 1 },
        ],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    const user = userEvent.setup();
    renderScreen();

    await chooseRowAction(user, 1, "Lock period");
    const past = screen.getByRole("alertdialog", { name: "Lock period" });
    expect(past.textContent).toContain(
      "Entries already posted in this month can no longer change. A late entry dated in this month posts in the current month and keeps its date.",
    );
    expect(past.textContent).not.toMatch(/no entries can be created/);
    await user.click(within(past).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    await chooseRowAction(user, 0, "Lock period");
    // #595: an entry dated in an earlier, still-open month still posts there.
    expect(screen.getByRole("alertdialog", { name: "Lock period" }).textContent).toContain(
      "Entries already posted in this month can no longer change, and entries dated this month can't post until it is reopened.",
    );
  });

  // #591: the server decides which month is current, in the workspace's time
  // zone. Here the device clock still says October while the workspace is
  // already in November.
  it("takes the current month from the server, not the device clock", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 31, 23, 30));
    mocks.usePeriods.mockReturnValue({
      data: {
        currentPeriodCode: "2026-11",
        periods: [
          { periodCode: "2026-10", status: "OPEN", lockedAt: null, entryCount: 3, rowVersion: 1 },
        ],
      },
      isPending: false,
      isError: false,
      refetch: vi.fn(),
    });
    try {
      const user = userEvent.setup();
      renderScreen();

      expect(periodCodesInOrder()).toEqual(["2026-11", "2026-10"]);

      await chooseRowAction(user, 1, "Lock period");
      const october = screen.getByRole("alertdialog", { name: "Lock period" });
      expect(october.textContent).toContain("A late entry dated in this month posts in the current month");
      await user.click(within(october).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

      await chooseRowAction(user, 0, "Lock period");
      expect(screen.getByRole("alertdialog", { name: "Lock period" }).textContent).toContain(
        "entries dated this month can't post until it is reopened",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("cancels lock from the overlay without dispatching", async () => {
    const user = userEvent.setup();
    renderScreen();

    await chooseRowAction(user, 0, "Lock period");
    const overlay = document.querySelector<HTMLElement>(
      '[data-slot="alert-dialog-overlay"]',
    );
    expect(overlay).not.toBeNull();
    await user.click(overlay!);

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(mocks.createCommandIntent).not.toHaveBeenCalled();
  });
});
