// @vitest-environment jsdom
import {
  HISTORY_CODE_SETS,
  HISTORY_ENTITY_TYPES,
  HISTORY_FIELD_SHAPES,
  type HistoryCodeSet,
  type HistoryDiffChange,
  type HistoryFieldShape,
  type HistoryItem,
} from "@routiq/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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
    // A fixture that names its own changed fields names its shown ones too.
    shownFields: overrides.changedFields === undefined ? ["status"] : [],
    note: null,
    noteCode: null,
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

/** Whether the trail was asked for: a closed sheet does not even mount the read. */
function lastEnabled(): boolean {
  const call = mocks.useHistory.mock.calls.at(-1);
  return call === undefined ? false : (call[2] as { enabled: boolean }).enabled;
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

function stubDiff(
  changes: HistoryDiffChange[],
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

  it("labels a known event and words the rest as Other change (#308)", async () => {
    stubHistory([
      event(),
      event({
        eventId: SECOND_EVENT_ID,
        eventType: "widget.frobnicated",
      }),
    ]);
    await openSheet();

    expect(screen.getByText("Activity closed")).toBeTruthy();
    // The event vocabulary is open: an unlabelled code reads "Other change"
    // and never shows itself raw.
    expect(screen.getByText("Other change")).toBeTruthy();
    expect(screen.queryByText("widget.frobnicated")).toBeNull();
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

  it("words a listed cancellation reason instead of showing its code (#426)", async () => {
    stubHistory([event({ eventType: "financial_entry.reversed", note: null, noteCode: "WRONG_DETAILS" })]);
    await openSheet();

    const line = screen.getByText("Entry cancelled").closest("li");
    expect(line?.textContent).toContain("Wrong details, to record again");
    expect(line?.textContent).not.toContain("WRONG_DETAILS");
  });

  it("shows the person's own words for Other", async () => {
    stubHistory([event({ eventType: "financial_entry.reversed", note: "Carte remboursée", noteCode: "OTHER" })]);
    await openSheet();

    const line = screen.getByText("Entry cancelled").closest("li");
    expect(line?.textContent).toContain("Carte remboursée");
    expect(line?.textContent).not.toContain("Other");
  });

  it("reads as one event: who, what, and the motif under the act", async () => {
    stubHistory([event({ note: "Fin de mission" })]);
    await openSheet();

    const line = screen.getByText("Activity closed").closest("li");
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
        // A financial entry's change list does show createdAt.
        shownFields: ["status", "createdAt"],
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

  it("names no columns when a PIN was reset, but keeps the event", async () => {
    stubHistory([
      event({
        eventType: "member.pin-reset",
        changedFields: ["pinHash", "failedAttempts", "lockedUntil"],
        shownFields: [],
      }),
    ]);
    await openSheet();

    // A reset is news; which credential columns it touched is not.
    expect(screen.getByText("Other change")).toBeTruthy();
    expect(screen.queryByText("pinHash")).toBeNull();
    expect(screen.queryByText("failedAttempts")).toBeNull();
    expect(screen.queryByText("lockedUntil")).toBeNull();
  });

  it("still chips lockedAt, which is when a period was locked", async () => {
    stubHistory([
      event({
        eventType: "posting_period.locked",
        changedFields: ["lockedAt", "status", "lockedByCommandId"],
        shownFields: ["status", "lockedAt"],
      }),
    ]);
    await openSheet();

    expect(screen.getByText("locked")).toBeTruthy();
    expect(screen.getByText("status")).toBeTruthy();
  });

  it("chips only the fields its change list shows (#465)", async () => {
    // A trip's creation records every column; most were empty and stayed so,
    // and its custom fields are never listed. The server says which fields the
    // change list shows, and the chips follow it.
    stubHistory([
      event({
        eventType: "activity.created",
        changedFields: ["status", "customValues", "plannedEndAt", "crew", "rowVersion"],
        shownFields: ["status"],
      }),
    ]);
    await openSheet();

    expect(screen.getByText("status")).toBeTruthy();
    expect(screen.queryByText("custom fields")).toBeNull();
    expect(screen.queryByText("planned end")).toBeNull();
    expect(screen.queryByText("crew")).toBeNull();
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

    expect(screen.queryByText("Other change")).toBeNull();
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
    expect(screen.getByText("Other change")).toBeTruthy();
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

    expect(screen.getByText("Other change")).toBeTruthy();
  });

  it("forgets show all once the sheet is closed and opened again", async () => {
    stubHistory([bookkeepingOnlyEvent()]);
    await openSheet();
    await userEvent.click(screen.getByRole("button", { name: "Show all" }));
    expect(screen.getByText("Other change")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Show all" })).toBeNull(),
    );

    await userEvent.click(screen.getByRole("button", { name: "History" }));
    expect(screen.queryByText("Other change")).toBeNull();
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
      { field: "description", kind: "VALUE", before: "Vidange", after: "Vidange et filtres" },
    ]);
    await expandRow();

    const row = screen.getByText("description").closest("div");
    expect(row?.textContent).toContain("Vidange");
    expect(row?.textContent).toContain("Vidange et filtres");
  });

  it("words a status with the badge's label, never the code (#110)", async () => {
    stubHistory([event({ changedFields: [] })]);
    stubDiff([
      { field: "status", kind: "CODE", codeSet: "workOrderStatus", before: "APPROVED", after: "COMPLETED" },
      { field: "costOutcome", kind: "CODE", codeSet: "costOutcome", before: null, after: "INVOICE_PENDING" },
    ]);
    await expandRow();

    const status = screen.getByText("status").closest("div");
    expect(status?.textContent).toContain(i18n.t("maintenance.workOrders.status.APPROVED"));
    expect(status?.textContent).toContain(i18n.t("maintenance.workOrders.status.COMPLETED"));
    expect(screen.getByText("Invoice not received yet")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/APPROVED|COMPLETED|INVOICE_PENDING/);
  });

  it("shows a category and a branch by name and the lines as a count and total (#119)", async () => {
    stubHistory([event({ changedFields: [] })]);
    stubDiff([
      { field: "categoryId", kind: "NAME", before: null, after: { fr: "Carburant", en: "Fuel" } },
      { field: "branchId", kind: "NAME", before: null, after: { fr: "Douala", en: "Douala" } },
      { field: "postings", kind: "LINES", before: { count: 1, totalMinor: 30_000 }, after: { count: 2, totalMinor: 45_000 } },
    ]);
    await expandRow();

    expect(screen.getByText("Fuel")).toBeTruthy();
    expect(screen.getByText("Douala")).toBeTruthy();
    expect(screen.getByText("1 line, FCFA 30,000")).toBeTruthy();
    expect(screen.getByText("2 lines, FCFA 45,000")).toBeTruthy();
  });

  it("says a change it cannot show is not available, rather than hiding it or inventing a value", async () => {
    stubHistory([event({ changedFields: [] })]);
    stubDiff([
      { field: "crew", kind: "UNAVAILABLE" },
      { field: "description", kind: "VALUE", before: null, after: "Vidange" },
    ]);
    await expandRow();

    const crew = screen.getByText("crew").closest("div");
    expect(crew?.textContent).toContain("Not available");
    expect(crew?.textContent).not.toContain("→");
    expect(document.querySelectorAll("dd")).toHaveLength(2);
  });

  it("words the placeholder in French too", async () => {
    stubHistory([event({ changedFields: [] })]);
    stubDiff([{ field: "categoryId", kind: "UNAVAILABLE" }]);
    await expandRow();
    try {
      await act(() => i18n.changeLanguage("fr-CM"));
      expect(await screen.findByText("Non disponible")).toBeTruthy();
    } finally {
      await act(() => i18n.changeLanguage("en"));
    }
  });

  it("counts the lines without a total when the reader may not see money", async () => {
    stubDiff([
      { field: "postings", kind: "LINES", before: null, after: { count: 3, totalMinor: null } },
    ]);
    await expandRow();

    expect(screen.getByText("3 lines")).toBeTruthy();
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

    expect(screen.getByText("Not recorded")).toBeTruthy();
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

/**
 * The guard for #110 and #119: every field the history can show, in every
 * shape the read sends, must reach the screen as words. A uuid, a bare enum
 * code or a JSON dump anywhere in the change list fails it.
 */
describe("record history sheet shows no raw values", () => {
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
  const ENUM_CODE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b|^[A-Z]{4,}$/;
  const JSONISH = /^[[{]|[{}"]/;
  /** An i18n key printed because its label is missing. */
  const MISSING_KEY = /^[a-z][\w-]*(?:\.[\w-]+)+$/;

  function rawValues(): string[] {
    return [...document.querySelectorAll("dd span")]
      .map((span) => span.textContent ?? "")
      .filter(
        (text) =>
          UUID.test(text) || ENUM_CODE.test(text) || JSONISH.test(text) || MISSING_KEY.test(text),
      );
  }

  const name = { fr: "Douala", en: "Douala" };

  function sample(field: string, shape: HistoryFieldShape, entityType: string): HistoryDiffChange[] {
    if (shape === "HIDDEN") return [];
    if (shape === "VALUE") return [{ field, kind: "VALUE", before: null, after: "Texte saisi" }];
    if (shape === "MONEY") return [{ field, kind: "MONEY", before: null, after: 45_000 }];
    if (shape === "COUNT") return [{ field, kind: "COUNT", before: 1, after: 2 }];
    if (shape === "LINES") return [{ field, kind: "LINES", before: null, after: { count: 2, totalMinor: 45_000 } }];
    if (shape === "CREW" || shape === "SEGMENT_ASSETS") return [{ field, kind: "NAMES", before: [], after: [name] }];
    if (shape === "INLINE_NAMES") return [{ field, kind: "NAMES", before: null, after: [name] }];
    if ("name" in shape) return [{ field, kind: "NAME", before: null, after: name }];
    const codeSet: HistoryCodeSet = "code" in shape ? shape.code : shape.codes;
    const codes = [...HISTORY_CODE_SETS[codeSet]];
    if ("codes" in shape) return [{ field, kind: "CODES", codeSet, before: [], after: codes }];
    // Every code of the set, one row each, so no label goes unchecked.
    return codes.map((code) => ({ field: `${entityType}.${field}.${code}`, kind: "CODE", codeSet, before: null, after: code }));
  }

  it.each(HISTORY_ENTITY_TYPES.filter((entityType) => Object.keys(HISTORY_FIELD_SHAPES[entityType]).length > 0))(
    "words every %s field",
    async (entityType) => {
      const shapes: Record<string, HistoryFieldShape> = HISTORY_FIELD_SHAPES[entityType];
      const changes = Object.entries(shapes).flatMap(([field, shape]) => sample(field, shape, entityType));
      stubHistory([event({ changedFields: [] })]);
      stubDiff(changes);
      renderSheet();
      await userEvent.click(screen.getByRole("button", { name: "History" }));
      await userEvent.click(screen.getByRole("button", { name: "Show changes" }));

      expect(document.querySelectorAll("dd").length).toBe(changes.length);
      expect(rawValues()).toEqual([]);
    },
  );

  it("catches the raw values the sheet used to print", async () => {
    // What develop rendered for #110 and #119, fed straight in: proves the
    // detector above is not blind.
    stubHistory([event({ changedFields: [] })]);
    stubDiff([
      { field: "status", kind: "VALUE", before: null, after: "INVOICE_PENDING" },
      { field: "direction", kind: "VALUE", before: null, after: "EXPENSE" },
      { field: "categoryId", kind: "VALUE", before: null, after: "99a0d46a-708a-4c8a-b41c-c5248619cfc0" },
      { field: "postings", kind: "VALUE", before: null, after: '[{"lineNo":1}]' },
      { field: "kind", kind: "CODE", codeSet: "costOutcome", before: null, after: "NOT_A_CODE" },
    ]);
    renderSheet();
    await userEvent.click(screen.getByRole("button", { name: "History" }));
    await userEvent.click(screen.getByRole("button", { name: "Show changes" }));

    expect(rawValues()).toHaveLength(5);
  });
});
