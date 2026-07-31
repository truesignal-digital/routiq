// @vitest-environment jsdom
import type { HistoryFieldChange, HistoryItem } from "@routiq/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
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
import { i18n } from "../i18n/index.js";

const ENTITY_ID = "00000000-0000-4000-8000-000000000010";
const SECOND_EVENT_ID = "00000000-0000-4000-8000-000000000022";
const THIRD_EVENT_ID = "00000000-0000-4000-8000-000000000023";

const mocks = vi.hoisted(() => ({
  useHistory: vi.fn(),
  useHistoryEvent: vi.fn(),
  fetchNextPage: vi.fn(),
}));

vi.mock("../history/useHistory.js", () => ({
  useHistory: mocks.useHistory,
  useHistoryEvent: mocks.useHistoryEvent,
}));

const { RecordHistorySheet } = await import("./record-history-sheet.js");

function event(overrides: Partial<HistoryItem> = {}): HistoryItem {
  return {
    eventId: "00000000-0000-4000-8000-000000000021",
    eventType: "activity.closed",
    occurredAt: "2026-07-29T14:05:00.000Z",
    actor: {
      principalId: "00000000-0000-4000-8000-000000000002",
      displayName: "Amadou Bello",
      scope: "WORKSPACE",
    },
    command: {
      id: "00000000-0000-4000-8000-000000000031",
      name: "close-activity",
      version: "1",
      origin: "HUMAN_UI",
      clientOccurredAt: null,
    },
    changedFields: ["status", "rowVersion"],
    note: null,
    ...overrides,
  };
}

/** A role change that ended up moving nothing but the version counter. */
function bookkeepingOnlyEvent(): HistoryItem {
  return event({
    eventType: "member.role-updated",
    changedFields: ["rowVersion", "updatedAt"],
  });
}

function stubHistory(
  items: HistoryItem[],
  { hasNextPage = false }: { hasNextPage?: boolean } = {},
) {
  mocks.useHistory.mockReturnValue({
    data: { pages: [{ items, nextCursor: hasNextPage ? "page-2" : null }] },
    isPending: false,
    isError: false,
    hasNextPage,
    isFetchingNextPage: false,
    fetchNextPage: mocks.fetchNextPage,
    refetch: vi.fn(),
  });
}

function renderSheet() {
  return render(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(RecordHistorySheet, {
        entityType: "activity",
        entityId: ENTITY_ID,
      }),
    ),
  );
}

async function openSheet() {
  renderSheet();
  await userEvent.click(screen.getByRole("button", { name: "History" }));
}

function lastEnabled(): boolean {
  const call = mocks.useHistory.mock.calls.at(-1);
  return (call?.[2] as { enabled: boolean }).enabled;
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

function stubDiff(
  changes: HistoryFieldChange[],
  { currency = "XAF" }: { currency?: string } = {},
) {
  mocks.useHistoryEvent.mockReturnValue({
    data: { eventId: event().eventId, currency, changes },
    isPending: false,
    isError: false,
    refetch: vi.fn(),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  stubHistory([event()]);
  stubDiff([]);
});

afterEach(() => {
  cleanup();
});

describe("record history sheet", () => {
  it("asks for nothing until it is opened", async () => {
    renderSheet();
    expect(lastEnabled()).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "History" }));
    expect(lastEnabled()).toBe(true);
  });

  it("labels a known event and falls back to the raw code for the rest", async () => {
    stubHistory([
      event(),
      event({
        eventId: SECOND_EVENT_ID,
        eventType: "widget.frobnicated",
      }),
    ]);
    await openSheet();

    expect(screen.getByText("Activity closed")).toBeTruthy();
    // The event vocabulary is open: an unlabelled code shows itself rather than
    // inventing an English sentence.
    expect(screen.getByText("widget.frobnicated")).toBeTruthy();
  });

  it("names ROUTIQ as the actor on a platform event", async () => {
    stubHistory([
      event({
        eventType: "module.enabled",
        actor: { principalId: null, displayName: null, scope: "PLATFORM" },
      }),
    ]);
    await openSheet();

    const actor = screen.getByText("ROUTIQ");
    expect(actor.className).toContain("text-primary");
  });

  it("stamps the origin only when it is not the plain web app", async () => {
    await openSheet();
    expect(screen.queryByText("Offline")).toBeNull();

    cleanup();
    stubHistory([
      event({
        command: { ...event().command, origin: "OFFLINE_SYNC" },
      }),
    ]);
    await openSheet();
    expect(screen.getByText("Offline")).toBeTruthy();
  });

  it("shows the note a reopen or correction carried", async () => {
    stubHistory([
      event({
        eventType: "activity.reopened",
        note: "Kilométrage saisi à l'envers",
      }),
    ]);
    await openSheet();

    expect(screen.getByText("Kilométrage saisi à l'envers")).toBeTruthy();
  });

  it("reads as one line: who, what, and the motif", async () => {
    stubHistory([event({ note: "Fin de mission" })]);
    await openSheet();

    const line = screen.getByText("Activity closed").closest("p");
    expect(line?.textContent).toContain("Amadou Bello");
    expect(line?.textContent).toContain("Fin de mission");
  });

  it("chips the fields that changed and drops the bookkeeping ones", async () => {
    stubHistory([
      event({
        changedFields: [
          "status",
          "rowVersion",
          "createdAt",
          "updatedAt",
          "createdByCommandId",
        ],
      }),
    ]);
    await openSheet();

    expect(screen.getByText("status")).toBeTruthy();
    expect(screen.queryByText("rowVersion")).toBeNull();
    expect(screen.queryByText("createdByCommandId")).toBeNull();
    // Labelled bookkeeping is still bookkeeping.
    expect(screen.queryByText("created")).toBeNull();
    expect(screen.queryByText("updated")).toBeNull();
  });

  it("walks the keyset with load more", async () => {
    stubHistory([event()], { hasNextPage: true });
    await openSheet();

    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(mocks.fetchNextPage).toHaveBeenCalledTimes(1);
  });

  it("offers no load more on the last page", async () => {
    await openSheet();

    expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
  });
});

describe("record history, changes only", () => {
  it("hides an event that moved nothing but bookkeeping", async () => {
    stubHistory([bookkeepingOnlyEvent()]);
    await openSheet();

    expect(screen.queryByText("member.role-updated")).toBeNull();
  });

  it("says so rather than looking empty when the filter hid everything", async () => {
    stubHistory([bookkeepingOnlyEvent()]);
    await openSheet();

    expect(
      screen.getByText(
        "No data changes on this record. Show all to see every event.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("No history")).toBeNull();
    expect(screen.getByRole("button", { name: "Show all" })).toBeTruthy();
  });

  it("brings the hidden event back when show all is pressed", async () => {
    stubHistory([bookkeepingOnlyEvent()]);
    await openSheet();

    const toggle = screen.getByRole("button", { name: "Show all" });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");

    await userEvent.click(toggle);
    expect(screen.getByText("member.role-updated")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Show all" }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("keeps a lifecycle event whose fields are all bookkeeping", async () => {
    stubHistory([event({ changedFields: ["rowVersion"] })]);
    await openSheet();

    expect(screen.getByText("Activity closed")).toBeTruthy();
  });

  it("keeps an event type it has never seen before", async () => {
    stubHistory([
      event({ eventType: "widget.frobnicated", changedFields: ["rowVersion"] }),
    ]);
    await openSheet();

    expect(screen.getByText("widget.frobnicated")).toBeTruthy();
  });

  it("forgets show all once the sheet is closed and opened again", async () => {
    stubHistory([bookkeepingOnlyEvent()]);
    await openSheet();
    await userEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByText("member.role-updated")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Show all" })).toBeNull(),
    );

    await userEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.queryByText("member.role-updated")).toBeNull();
  });
});

describe("record history days", () => {
  it("puts each calendar day under its own heading", async () => {
    stubHistory([
      event({ occurredAt: new Date().toISOString() }),
      event({ eventId: SECOND_EVENT_ID, occurredAt: "2026-01-15T12:00:00.000Z" }),
    ]);
    await openSheet();

    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings).toHaveLength(2);
    expect(headings[0]?.textContent).toBe("Today");
    expect(headings[1]?.textContent).toMatch(/January 1[45], 2026/);
  });

  it("keeps a run of same-day events under a single heading", async () => {
    stubHistory([
      event({ occurredAt: "2026-07-29T14:05:00.000Z" }),
      event({ eventId: SECOND_EVENT_ID, occurredAt: "2026-07-29T18:00:00.000Z" }),
      event({ eventId: THIRD_EVENT_ID, occurredAt: "2026-07-28T18:00:00.000Z" }),
    ]);
    await openSheet();

    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
  });

  it("names yesterday rather than dating it", async () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    stubHistory([event({ occurredAt: yesterday.toISOString() })]);
    await openSheet();

    expect(screen.getByRole("heading", { level: 3 }).textContent).toBe("Yesterday");
  });
});

describe("record history diff", () => {
  async function expandRow() {
    await openSheet();
    await userEvent.click(screen.getByRole("button", { name: "Show changes" }));
  }

  it("asks for a diff only once its row is expanded", async () => {
    await openSheet();
    expect(mocks.useHistoryEvent).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: "Show changes" }));
    expect(mocks.useHistoryEvent).toHaveBeenCalledWith(
      "activity",
      ENTITY_ID,
      event().eventId,
      { enabled: true },
    );
  });

  it("shows each changed field as before then after", async () => {
    // No chips on this row: the same label would otherwise appear twice.
    stubHistory([event({ changedFields: [] })]);
    stubDiff([
      { field: "status", kind: "VALUE", before: "OPEN", after: "CLOSED" },
    ]);
    await expandRow();

    const row = screen.getByText("status").closest("div");
    expect(row?.textContent).toContain("OPEN");
    expect(row?.textContent).toContain("CLOSED");
  });

  it("labels a known field and falls back to the raw code for the rest", async () => {
    stubDiff([
      { field: "customerName", kind: "VALUE", before: null, after: "Brasseries" },
      { field: "sprocketTension", kind: "VALUE", before: 1, after: 2 },
    ]);
    await expandRow();

    expect(screen.getByText("customer")).toBeTruthy();
    expect(screen.getByText("sprocketTension")).toBeTruthy();
  });

  it("renders money through the money formatter, minor units undivided", async () => {
    stubDiff([
      { field: "amountMinor", kind: "MONEY", before: null, after: 125_000 },
    ]);
    await expandRow();

    // XAF has exponent 0 — 125 000 minor units is 125 000 francs.
    expect(screen.getByText("FCFA 125,000")).toBeTruthy();
  });

  it("leaves a non-money number alone however large it looks", async () => {
    stubDiff([
      { field: "value", kind: "VALUE", before: 410_000, after: 411_125 },
    ]);
    await expandRow();

    expect(screen.getByText("411125")).toBeTruthy();
  });

  it("marks an absent side rather than printing null", async () => {
    stubDiff([
      { field: "reason", kind: "VALUE", before: null, after: "Erreur de saisie" },
    ]);
    await expandRow();

    expect(screen.getByText("—")).toBeTruthy();
    expect(screen.queryByText("null")).toBeNull();
  });

  it("says nothing changed rather than showing an empty table", async () => {
    stubDiff([]);
    await expandRow();

    expect(screen.getByText("No detailed changes")).toBeTruthy();
  });

  it("collapses again, and stops asking", async () => {
    await expandRow();
    await userEvent.click(screen.getByRole("button", { name: "Hide changes" }));

    expect(screen.getByRole("button", { name: "Show changes" })).toBeTruthy();
  });

  it("offers a retry when the diff fails on its own", async () => {
    const refetch = vi.fn();
    mocks.useHistoryEvent.mockReturnValue({
      data: undefined,
      isPending: false,
      isError: true,
      refetch,
    });
    await expandRow();

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
