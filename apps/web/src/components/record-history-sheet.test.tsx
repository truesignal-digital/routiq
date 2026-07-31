// @vitest-environment jsdom
import type { HistoryItem } from "@routiq/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
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

const mocks = vi.hoisted(() => ({
  useHistory: vi.fn(),
  fetchNextPage: vi.fn(),
}));

vi.mock("../history/useHistory.js", () => ({ useHistory: mocks.useHistory }));

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

beforeEach(() => {
  vi.clearAllMocks();
  stubHistory([event()]);
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
        eventId: "00000000-0000-4000-8000-000000000022",
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

  it("chips the fields that changed and drops the bookkeeping ones", async () => {
    await openSheet();

    expect(screen.getByText("status")).toBeTruthy();
    expect(screen.queryByText("rowVersion")).toBeNull();
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
