// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALL_MODULES,
  ASSET_ID,
  ENTRY_ID,
  WORK_ORDER_ID,
  WORK_ORDER_NUMBER,
  asset,
  documentRow,
  entryDetail,
  entryRow,
  finance,
  historyItem,
  issueRow,
  tripRow,
  workOrderDetail,
  workOrderRow,
} from "./test/fixtures.js";
import { closeVehicle, openVehicle, requested } from "./test/harness.js";

vi.mock("../commands/instance.js", async () => {
  const { createCommandClient } = await import("../commands/client.js");
  const { CommandStatusStore } = await import("../commands/store.js");
  const { sessionStore } = await import("../auth/store.js");
  const commandStatusStore = new CommandStatusStore();
  return {
    commandStatusStore,
    commandClient: createCommandClient({
      store: commandStatusStore,
      getToken: () => sessionStore.getToken(),
      fetchImpl: (input, init) => globalThis.fetch(input, init),
    }),
  };
});

afterEach(async () => {
  cleanup();
  await closeVehicle();
});

const tabNames = () => screen.getAllByRole("tab").map((tab) => tab.textContent?.replace(/\d+$/, "").trim());

describe("which sections a viewer gets", () => {
  it("gives every section to a manager with every module", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, { role: "ADMIN" });
    await screen.findByText("Available.");
    expect(tabNames()).toEqual(["Overview", "Maintenance", "Money", "Trips", "Documents", "History", "Details"]);
  });

  it("keeps the books from the workshop, and each module's section from a workspace without it", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, { role: "TECHNICIAN" });
    await screen.findByText("Available.");
    expect(tabNames()).toEqual(["Overview", "Maintenance", "Trips", "Documents", "History", "Details"]);
    cleanup();
    await openVehicle(`/assets/${ASSET_ID}`, { role: "ADMIN", modules: ["CORE", "ASSETS"] });
    await screen.findByText("Available.");
    expect(tabNames()).toEqual(["Overview", "History", "Details"]);
  });

  it("keeps the books from the counter and the drivers, and documents from the counter (#264)", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}`, { role: "CASHIER", asset: asset({ finance: undefined }) });
    await screen.findByText("Available.");
    expect(tabNames()).toEqual(["Overview", "Maintenance", "Trips", "History", "Details"]);
    expect(requested(recorded, `/v1/assets/${ASSET_ID}/documents`)).toEqual([]);
    expect(requested(recorded, `/v1/assets/${ASSET_ID}/finance`)).toEqual([]);
    cleanup();
    const driver = await openVehicle(`/assets/${ASSET_ID}`, { role: "DRIVER", asset: asset({ finance: undefined }) });
    await screen.findByText("Available.");
    expect(tabNames()).toEqual(["Overview", "Maintenance", "Trips", "Documents", "History", "Details"]);
    expect(requested(driver, `/v1/assets/${ASSET_ID}/finance`)).toEqual([]);
  });

  it("renders the workshop's header and Now without a money card, from a detail with no finance block", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}`, {
      role: "TECHNICIAN",
      asset: asset({ finance: undefined }),
    });
    expect(await screen.findByText("Available.")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("VH003");
    expect(screen.getByRole("button", { name: "Report a problem" })).toBeTruthy();
    expect(await screen.findByText("Recent")).toBeTruthy();
    expect(screen.queryByText("This vehicle's share")).toBeNull();
    expect(screen.queryByText(/Lifetime/)).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole("tab", { name: "Details" }));
    // The purchase price is money too: the date alone.
    expect(await screen.findByText("3/1/24")).toBeTruthy();
    expect(screen.queryByText(/45,000,000/)).toBeNull();
    expect(
      recorded.requests.some(({ url }) => url.pathname.startsWith("/v1/finance") || url.pathname.endsWith("/finance")),
    ).toBe(false);
  });

  it("denies a direct link to Money for the workshop without ever asking for money", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}/money`, { role: "TECHNICIAN" });
    expect(await screen.findByText("Your role does not allow this action.")).toBeTruthy();
    await screen.findByText("Available.");
    expect(recorded.requests.some(({ url }) => url.pathname.startsWith("/v1/finance") || url.pathname.endsWith("/finance"))).toBe(false);
    // Nor through the history: money kinds are not offered.
    expect(requested(recorded, `/v1/assets/${ASSET_ID}/history`).every((url) => url.searchParams.get("kind") !== "MONEY")).toBe(true);
  });

  it("denies the maintenance section when the module is off, without reading work orders", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}/maintenance`, {
      role: "ADMIN",
      modules: ALL_MODULES.filter((module) => module !== "MAINTENANCE"),
    });
    expect(await screen.findByText("This module is not enabled for your company.")).toBeTruthy();
    expect(requested(recorded, "/v1/work-orders")).toEqual([]);
    expect(requested(recorded, "/v1/issues")).toEqual([]);
  });

  it("keeps the old documents link: it opens the Documents section", async () => {
    await openVehicle(`/assets/${ASSET_ID}/documents`, { role: "DRIVER", documents: [documentRow()] });
    expect(await screen.findByRole("heading", { name: "Documents" })).toBeTruthy();
    expect(await screen.findByText("Technical inspection")).toBeTruthy();
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Documents", selected: true })).toBeTruthy();
  });
});

describe("Details", () => {
  it("is its own section after History, reached by a deep link, and the header no longer discloses it", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}/details`, { role: "ADMIN" });
    expect(await screen.findByRole("heading", { name: "Details" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Details", selected: true })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Right now" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Vehicle" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Specifications" })).toBeTruthy();
    expect(screen.getByText("Chassis number")).toBeTruthy();
    expect(screen.getByText(/45,000,000/)).toBeTruthy();
    // Identity stays on top; nothing there opens or hides the details any more.
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("VH003");
    expect(screen.queryByRole("button", { name: /Details/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Hide details" })).toBeNull();
    expect(recorded.history.location.pathname).toBe(`/assets/${ASSET_ID}/details`);
  });

  it("opens from its tab and keeps the month on the way", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}/money?period=2026-08`, { role: "ADMIN" });
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Money · August 2026" });
    await user.click(screen.getByRole("tab", { name: "Details" }));
    await waitFor(() => expect(recorded.history.location.pathname).toBe(`/assets/${ASSET_ID}/details`));
    expect(recorded.history.location.search).toContain("period=2026-08");
    expect(await screen.findByText("Chassis number")).toBeTruthy();
  });

  it.each([
    ["en", "Details"],
    ["fr-CM", "Détails"],
  ] as const)("%s: the phone's tab bar ends with %s", async (locale, name) => {
    await openVehicle(`/assets/${ASSET_ID}/details`, { role: "DRIVER", width: 390, locale });
    await screen.findByRole("tab", { name, selected: true });
    expect(tabNames().at(-1)).toBe(name);
  });
});

describe("Money", () => {
  it("reads the month from the URL and names each chip's basis in its query", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}/money?period=2026-08`, {
      role: "FINANCE",
      entries: [entryRow({ status: "POSTED", postingPeriodCode: "2026-08" })],
    });
    const user = userEvent.setup();
    expect(await screen.findByRole("heading", { name: "Money · August 2026" })).toBeTruthy();
    await waitFor(() => expect(requested(recorded, `/v1/assets/${ASSET_ID}/finance`).at(-1)?.searchParams.get("periodCode")).toBe("2026-08"));
    const posted = requested(recorded, "/v1/finance/entries").at(-1);
    expect(posted?.searchParams.get("status")).toBe("LEDGER");
    expect(posted?.searchParams.get("periodCode")).toBe("2026-08");
    expect(posted?.searchParams.get("assetId")).toBe(ASSET_ID);

    await user.click(screen.getByRole("radio", { name: /Awaiting review/ }));
    await waitFor(() => expect(requested(recorded, "/v1/finance/entries").at(-1)?.searchParams.get("status")).toBe("SUBMITTED"));
    const review = requested(recorded, "/v1/finance/entries").at(-1);
    expect(review?.searchParams.get("economicMonth")).toBe("2026-08");
    expect(review?.searchParams.has("periodCode")).toBe(false);
    // The vehicle's page never narrows to the shell's agency.
    expect(requested(recorded, "/v1/finance/entries").every((url) => !url.searchParams.has("branchId"))).toBe(true);
    expect(recorded.history.location.search).toContain("entries=review");
  });

  // #639: with no month in the URL, the tab opens on the workspace's month, not the phone's.
  it("opens on the workspace's month when the device is still in the month before", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // Noon UTC on 30 September: 1 October already at UTC+14, still September on the device.
    vi.setSystemTime(new Date("2026-09-30T12:00:00Z"));
    try {
      const recorded = await openVehicle(`/assets/${ASSET_ID}/money`, {
        role: "FINANCE",
        timezone: "Pacific/Kiritimati",
      });
      expect(await screen.findByRole("heading", { name: "Money · October 2026" })).toBeTruthy();
      await waitFor(() =>
        expect(requested(recorded, `/v1/assets/${ASSET_ID}/finance`).at(-1)?.searchParams.get("periodCode")).toBe("2026-10"),
      );
      expect(requested(recorded, "/v1/finance/entries").at(-1)?.searchParams.get("periodCode")).toBe("2026-10");
      // October is the current month: there is no month after it to open.
      expect((screen.getByRole("button", { name: "Next month" }) as HTMLButtonElement).disabled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  describe("one name for the pending state", () => {
    const pending = workOrderDetail("APPROVED", {
      pendingCostLines: [
        {
          postingId: "00000000-0000-4000-8000-0000000000a7",
          entryId: ENTRY_ID,
          entryNumber: "DLA-2026-00006",
          description: "Air valve",
          amountMinor: 310_000,
          currency: "XAF",
          economicDate: "2026-09-23",
          entryStatus: "SUBMITTED",
        },
      ],
    });

    it.each([
      // The pending line is one of the order's costs, marked as awaiting review (#612).
      ["en", "Awaiting review", "Costs"],
      ["fr-CM", "En attente d'examen", "Coûts"],
    ] as const)("%s: Money, its entry badges and the work order's pending costs agree", async (locale, name, heading) => {
      await openVehicle(`/assets/${ASSET_ID}/money?period=2026-09&entries=review&panel=work_order:${WORK_ORDER_ID}`, {
        role: "FINANCE",
        locale,
        entries: [entryRow({ status: "SUBMITTED" })],
        workOrderDetails: [pending],
      });
      const panel = await screen.findByRole("dialog", { name: /Brake repair/ });
      expect(await within(panel).findByRole("heading", { name: heading })).toBeTruthy();
      expect(within(panel).getByText(name)).toBeTruthy();
      expect(within(panel).queryByText(/Pending|En attente$|approval|approbation/)).toBeNull();
      cleanup();
      await openVehicle(`/assets/${ASSET_ID}/money?period=2026-09&entries=review`, {
        role: "FINANCE",
        locale,
        entries: [entryRow({ status: "SUBMITTED" })],
      });
      await screen.findByText("DLA-2026-00006");
      expect(screen.getByRole("radio", { name: new RegExp(name) })).toBeTruthy();
      // The stat card, and the row's badge.
      expect(screen.getAllByText(name).length).toBeGreaterThanOrEqual(2);
      expect(screen.queryByText(/^Pending$|^En attente$/)).toBeNull();
    });
  });

  it("lists one line per event: a folded cancellation, a later month's, and a cancellation's own line (#427)", async () => {
    const cancellation = {
      entryId: "00000000-0000-4000-8000-0000000000e9",
      entryNumber: "DLA-2026-00009",
      postingPeriodCode: "2026-08",
      postedAt: "2026-08-20T10:00:00.000Z",
      reasonCode: null,
      reasonText: "Entered twice",
      recordedBy: { principalId: null, displayName: "Awa", scope: "WORKSPACE" as const },
      folded: true,
    };
    await openVehicle(`/assets/${ASSET_ID}/money?period=2026-08`, {
      role: "FINANCE",
      finance: (periodCode) =>
        finance(periodCode ?? "2026-08", {
          posted: { basis: "POSTING_PERIOD", expenseMinor: 310_000, revenueMinor: 0, entryCount: 4, eventCount: 3 },
        }),
      entries: [
        entryRow({ id: "00000000-0000-4000-8000-0000000000e1", entryNumber: "DLA-2026-00008", status: "REVERSED", postingPeriodCode: "2026-08", cancelledBy: cancellation }),
        entryRow({
          id: "00000000-0000-4000-8000-0000000000e2",
          entryNumber: "DLA-2026-00010",
          status: "REVERSED",
          postingPeriodCode: "2026-08",
          cancelledBy: { ...cancellation, entryNumber: "DLA-2026-00011", postingPeriodCode: "2026-09", folded: false },
        }),
        entryRow({
          id: "00000000-0000-4000-8000-0000000000e3",
          entryNumber: "DLA-2026-00012",
          status: "POSTED",
          amountMinor: -50_000,
          assetShareMinor: -50_000,
          postingPeriodCode: "2026-08",
          reversesEntryId: "00000000-0000-4000-8000-0000000000e4",
          cancels: { entryId: "00000000-0000-4000-8000-0000000000e4", entryNumber: "DLA-2026-00002", postingPeriodCode: "2026-07" },
        }),
      ],
    });
    const user = userEvent.setup();
    const folded = (await screen.findByText("DLA-2026-00008")).closest("li")!;
    const later = screen.getByText("DLA-2026-00010").closest("li")!;
    const own = screen.getByText("DLA-2026-00012").closest("li")!;

    // The chip counts the lines it lists, not the rows in the books.
    expect(screen.getByRole("radio", { name: /Posted/ }).textContent).toContain("3");
    expect(folded.querySelector(".line-through")).not.toBeNull();
    expect(later.querySelector(".line-through")).toBeNull();
    expect(within(later).getByText("Cancelled in September 2026")).toBeTruthy();
    expect(own.textContent).toContain("Cancellation of entry DLA-2026-00002 (July 2026)");

    await user.click(within(folded).getByRole("button", { name: "Show cancellation" }));
    expect(within(folded).getByText("Reason: Entered twice")).toBeTruthy();
    // Opening the details does not open the entry's panel.
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  describe("spending by category's shares", () => {
    const categoryCard = async () =>
      (await screen.findByText("Spending by category")).closest<HTMLElement>('[data-slot="card"]')!;

    it("gives each category its share of a month that spent", async () => {
      await openVehicle(`/assets/${ASSET_ID}/money?period=2026-09`, { role: "FINANCE" });
      const card = await categoryCard();
      // 421,000 and 240,000 of 661,000.
      expect(within(card).getByText("64%")).toBeTruthy();
      expect(within(card).getByText("36%")).toBeTruthy();
    });

    it("shows no share when a cancellation leaves the month negative (#472)", async () => {
      await openVehicle(`/assets/${ASSET_ID}/money?period=2026-10`, {
        role: "FINANCE",
        finance: (periodCode) =>
          finance(periodCode ?? "2026-10", {
            byCategory: [
              { code: "REPAIRS", labelFr: "Réparations", labelEn: "Repairs", layer: "MAINTENANCE", expenseMinor: -85_000 },
            ],
          }),
      });
      const card = await categoryCard();
      expect(within(card).getByText("Repairs")).toBeTruthy();
      expect(card.textContent).toContain("85,000");
      // It read "-8500000%" before.
      expect(card.textContent).not.toContain("%");
    });

    it("shows no share when the month nets to zero", async () => {
      await openVehicle(`/assets/${ASSET_ID}/money?period=2026-10`, {
        role: "FINANCE",
        finance: (periodCode) =>
          finance(periodCode ?? "2026-10", {
            byCategory: [
              { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel", layer: "DIRECT", expenseMinor: 40_000 },
              { code: "REPAIRS", labelFr: "Réparations", labelEn: "Repairs", layer: "MAINTENANCE", expenseMinor: -40_000 },
            ],
          }),
      });
      expect((await categoryCard()).textContent).not.toContain("%");
    });
  });

  it("asks for the receipt of a posted entry, not of one whose cancellation has posted (#473)", async () => {
    await openVehicle(`/assets/${ASSET_ID}/money?period=2026-08`, {
      role: "FINANCE",
      entries: [
        entryRow({
          id: "00000000-0000-4000-8000-0000000000e1",
          entryNumber: "DLA-2026-00008",
          status: "REVERSED",
          postingPeriodCode: "2026-08",
        }),
        entryRow({
          id: "00000000-0000-4000-8000-0000000000e2",
          entryNumber: "DLA-2026-00009",
          status: "POSTED",
          postingPeriodCode: "2026-08",
        }),
      ],
    });
    const cancelled = (await screen.findByText("DLA-2026-00008")).closest("li")!;
    const posted = screen.getByText("DLA-2026-00009").closest("li")!;
    expect(within(posted).getByText("No receipt")).toBeTruthy();
    expect(within(cancelled).queryByText("No receipt")).toBeNull();
  });

  it("steps back a month and keeps the lifetime figures at the foot", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}/money?period=2026-08`, { role: "ADMIN" });
    const user = userEvent.setup();
    await screen.findByRole("heading", { name: "Money · August 2026" });
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await screen.findByRole("heading", { name: "Money · July 2026" });
    expect(recorded.history.location.search).toContain("period=2026-07");
    expect(screen.getByText(/Lifetime, all posted entries since registration/).textContent).toMatch(/2,850,000/);
  });
});

describe("one sign rule for DLA-2026-00008 (E2.8)", () => {
  const fuel = {
    entryNumber: "DLA-2026-00008",
    status: "POSTED",
    category: { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel", layer: null },
    amountMinor: 86_000,
    postingPeriodCode: "2026-08",
  } as const;
  const posted = historyItem({
    eventType: "financial_entry.posted",
    kind: "MONEY",
    subject: { entityType: "financial_entry", id: ENTRY_ID, number: "DLA-2026-00008" },
    amountMinor: 86_000,
    currency: "XAF",
    params: { direction: "EXPENSE", entryNumber: "DLA-2026-00008", categoryLabelFr: "Carburant", categoryLabelEn: "Fuel", status: "POSTED" },
  });
  const flat = (text: string | null | undefined) => (text ?? "").replace(/\s/g, " ");

  it.each([
    ["en", "−FCFA 86,000", "FCFA 86,000"],
    ["fr-CM", "−86 000 FCFA", "86 000 FCFA"],
  ] as const)("%s: minus on Money and History, unsigned on the entry's own panel", async (locale, signed, unsigned) => {
    await openVehicle(`/assets/${ASSET_ID}/money?period=2026-08`, {
      role: "FINANCE",
      locale,
      entries: [entryRow({ ...fuel, assetShareMinor: 86_000 })],
    });
    await screen.findByText("DLA-2026-00008");
    expect(screen.getAllByText((_, element) => flat(element?.textContent) === signed && element?.children.length === 0)).toHaveLength(1);
    cleanup();
    await closeVehicle();

    await openVehicle(`/assets/${ASSET_ID}/history`, { role: "FINANCE", locale, history: [posted] });
    expect(await screen.findByText((_, element) => flat(element?.textContent) === signed && element?.children.length === 0)).toBeTruthy();
    cleanup();
    await closeVehicle();

    await openVehicle(`/assets/${ASSET_ID}/money?period=2026-08&panel=entry:${ENTRY_ID}`, {
      role: "FINANCE",
      locale,
      entryDetails: [
        entryDetail({
          ...fuel,
          postings: entryDetail().postings.map((line) => ({ ...line, amountMinor: 86_000 })),
        }),
      ],
    });
    const panel = await screen.findByRole("dialog", { name: /Fuel|Carburant/ });
    expect(within(panel).getAllByText((_, element) => flat(element?.textContent) === unsigned && element?.children.length === 0).length).toBeGreaterThan(0);
    expect(within(panel).queryByText((_, element) => flat(element?.textContent) === signed)).toBeNull();
  });

  it("signs a reversal's split share on the ledger and keeps the whole entry unsigned", async () => {
    await openVehicle(`/assets/${ASSET_ID}/money?period=2026-08`, {
      role: "FINANCE",
      locale: "en",
      entries: [entryRow({ ...fuel, entryNumber: "DLA-2026-00009", amountMinor: -86_000, assetShareMinor: -43_000 })],
    });
    await screen.findByText("DLA-2026-00009");
    const exact = (text: string) => (_: string, element: Element | null) =>
      flat(element?.textContent) === text && element?.children.length === 0;
    expect(screen.getByText(exact("+FCFA 43,000"))).toBeTruthy();
    expect(screen.getByText(exact("of a FCFA 86,000 entry"))).toBeTruthy();
  });
});

describe("History", () => {
  it("filters by kind through the URL and loads more with the cursor", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}/history?kind=MAINTENANCE`, {
      role: "ADMIN",
      history: [historyItem()],
      historyNextCursor: "next-page",
    });
    const user = userEvent.setup();
    expect(await screen.findByText("Problem reported")).toBeTruthy();
    expect(requested(recorded, `/v1/assets/${ASSET_ID}/history`).some((url) => url.searchParams.get("kind") === "MAINTENANCE")).toBe(true);
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() =>
      expect(requested(recorded, `/v1/assets/${ASSET_ID}/history`).some((url) => url.searchParams.get("cursor") === "next-page")).toBe(true),
    );
    await user.click(screen.getByRole("radio", { name: "Money" }));
    await waitFor(() => expect(recorded.history.location.search).toContain("kind=MONEY"));
  });

  // A phone wraps "Leg recorded on trip DLA-2026-" / "00003" at the hyphen
  // unless the number is its own unbreakable run (#430).
  const recordNumbers = (root: HTMLElement) =>
    [...root.querySelectorAll("[data-record-number]")]
      .filter((node) => node.classList.contains("whitespace-nowrap"))
      .map((node) => node.textContent);

  it.each(["en", "fr-CM"] as const)("%s: keeps trip numbers in event titles on one line (#430)", async (locale) => {
    await openVehicle(`/assets/${ASSET_ID}/history?kind=TRIPS`, {
      role: "ADMIN",
      locale,
      history: [
        historyItem({
          eventId: "00000000-0000-4000-8000-0000000000e1",
          eventType: "movement_leg.recorded",
          kind: "TRIPS",
          subject: { entityType: "movement_leg", id: "00000000-0000-4000-8000-0000000000e2", number: "DLA-2026-00003" },
          params: {},
        }),
        historyItem({
          eventId: "00000000-0000-4000-8000-0000000000e3",
          eventType: "activity.created",
          kind: "TRIPS",
          subject: { entityType: "activity", id: "00000000-0000-4000-8000-0000000000e4", number: "DLA-2026-00004" },
          params: {},
        }),
      ],
    });
    const list = (await screen.findByText(/DLA-2026-00003/)).closest("ol");
    if (list === null) throw new Error("no history list");
    expect(recordNumbers(list)).toEqual(["DLA-2026-00003", "DLA-2026-00004"]);
  });

  it("keeps the trip number on one line in a Money row's trip link (#430)", async () => {
    await openVehicle(`/assets/${ASSET_ID}/money?period=2026-09`, {
      role: "FINANCE",
      entries: [
        entryRow({
          status: "POSTED",
          assetLinks: {
            activityId: "00000000-0000-4000-8000-0000000000e4",
            activityNumber: "DLA-2026-00004",
            workOrderId: null,
            workOrderNumber: null,
          },
        }),
      ],
    });
    const link = await screen.findByRole("button", { name: "for trip DLA-2026-00004" });
    expect(recordNumbers(link)).toEqual(["DLA-2026-00004"]);
  });

  it("names a Money row's work order by its number, kept on one line (#608)", async () => {
    await openVehicle(`/assets/${ASSET_ID}/money?period=2026-09`, {
      role: "FINANCE",
      entries: [entryRow({ status: "POSTED" })],
    });
    const link = await screen.findByRole("button", { name: "for work order WO-0007" });
    expect(recordNumbers(link)).toEqual(["WO-0007"]);
  });
});

describe("Maintenance and Trips", () => {
  it("lists work in progress and unplanned problems, with the role's step marked", async () => {
    await openVehicle(`/assets/${ASSET_ID}/maintenance`, {
      role: "TECHNICIAN",
      workOrders: [workOrderRow("APPROVED")],
      issues: [
        issueRow({ workOrders: [{ id: workOrderRow("APPROVED").id, number: WORK_ORDER_NUMBER, status: "APPROVED" }] }),
        issueRow({ id: "00000000-0000-4000-8000-00000000c009", description: "Rear mudguard cracked", safetyCritical: false, category: "BODYWORK" }),
      ],
    });
    expect(await screen.findByText("Brake repair: replace pads and air valve")).toBeTruthy();
    expect(screen.getByText("Next step is yours")).toBeTruthy();
    expect(screen.getByText("Rear mudguard cracked")).toBeTruthy();
    // The problem already in a work order is not "new".
    expect(screen.queryByText("Brake pressure warning on the Kekem descent")).toBeNull();
    expect(await screen.findByText("Bodywork")).toBeTruthy();
    // Each row reads by its number (#608).
    const orderRow = screen.getByText("Brake repair: replace pads and air valve").closest("li")!;
    expect(within(orderRow).getByText("WO-0007")).toBeTruthy();
    expect(orderRow.textContent).toContain("from problem PRB-0003");
    expect(within(screen.getByText("Rear mudguard cracked").closest("li")!).getByText("PRB-0003")).toBeTruthy();
  });

  it("lists a driver's work orders without an amount or a missing estimate (#390)", async () => {
    await openVehicle(`/assets/${ASSET_ID}/maintenance`, {
      role: "DRIVER",
      workOrders: [workOrderRow("APPROVED", { expectedCostMinor: null })],
    });
    const title = await screen.findByText("Brake repair: replace pads and air valve");
    const item = within(title.closest("li")!);
    expect(item.queryByText("No estimate")).toBeNull();
    expect(item.queryByText(/planned/)).toBeNull();
  });

  it("keeps the estimate but shows no actual cost or cost lines while FINANCE is off (#640)", async () => {
    // What the API sends with FINANCE off: the estimate, and no Finance figure.
    const hidden = { actualCostMinor: null, declaredCostMinor: null, costToCome: null };
    await openVehicle(`/assets/${ASSET_ID}/maintenance?panel=work_order:${WORK_ORDER_ID}`, {
      role: "DIRECTOR",
      modules: ALL_MODULES.filter((code) => code !== "FINANCE"),
      workOrders: [workOrderRow("APPROVED", hidden)],
      workOrderDetails: [
        workOrderDetail("APPROVED", { ...hidden, costLines: null, pendingCostLines: null, otherBranchesCostMinor: null }),
      ],
    });
    const dialog = await screen.findByRole("dialog", { name: "Brake repair: replace pads and air valve" });
    expect(within(dialog).getByText("Expected cost")).toBeTruthy();
    expect(within(dialog).queryByText("Actual cost")).toBeNull();
    expect(within(dialog).queryByRole("heading", { name: "Costs" })).toBeNull();
    const item = within(screen.getAllByText("Brake repair: replace pads and air valve").find((el) => el.closest("li"))!.closest("li")!);
    expect(item.getByText(/planned/)).toBeTruthy();
  });

  it("says Money is not included when FINANCE is off, without reading the books", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}/money`, {
      role: "DIRECTOR",
      modules: ALL_MODULES.filter((code) => code !== "FINANCE"),
    });
    expect(await screen.findByText("This module is not enabled for your workspace.")).toBeTruthy();
    expect(
      recorded.requests.some(({ url }) => url.pathname.startsWith("/v1/finance") || url.pathname.endsWith("/finance")),
    ).toBe(false);
  });

  it("says what a closed order's cost is instead of inventing a zero (#131)", async () => {
    const done = (id: string, description: string, overrides: Parameters<typeof workOrderRow>[1]) =>
      workOrderRow("COMPLETED", {
        id,
        description,
        issue: null,
        completedAt: "2026-09-30T10:00:00.000Z",
        ...overrides,
      });
    await openVehicle(`/assets/${ASSET_ID}/maintenance`, {
      role: "TECHNICIAN",
      workOrders: [
        done("00000000-0000-4000-8000-00000000d101", "Weld the rear mudguard bracket", {
          costOutcome: "INVOICE_PENDING",
          actualCostMinor: 0,
          costToCome: { reason: "INVOICE_PENDING", awaitingApproval: false },
        }),
        done("00000000-0000-4000-8000-00000000d102", "Replace the right rear tyre valve", {
          costOutcome: "NO_COST",
          actualCostMinor: 0,
        }),
        done("00000000-0000-4000-8000-00000000d103", "Recharge the A/C", {
          costOutcome: "LINES",
          actualCostMinor: 55_000,
        }),
      ],
    });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /^Done/ }));
    const row = (description: string) => {
      const item = screen.getByText(description).closest("li");
      if (item === null) throw new Error(`no row for ${description}`);
      return within(item);
    };
    expect(row("Weld the rear mudguard bracket").getByText("Invoice not received yet")).toBeTruthy();
    // The invoice is still to come (#82); the other two closed with their cost settled.
    expect(row("Weld the rear mudguard bracket").getByText("Cost to come")).toBeTruthy();
    expect(screen.getAllByText("Cost to come")).toHaveLength(1);
    expect(row("Replace the right rear tyre valve").getByText("No cost")).toBeTruthy();
    expect(row("Recharge the A/C").getByText(/55,000/)).toBeTruthy();
    expect(screen.queryByText(/FCFA\s0$/)).toBeNull();
  });

  it("gives each trip one state and shows its start and end as times (#94)", async () => {
    await openVehicle(`/assets/${ASSET_ID}/trips`, {
      role: "ADMIN",
      trips: [
        tripRow(),
        tripRow({
          id: "00000000-0000-4000-8000-0000000000b8",
          activityNumber: "DLA-2026-00001",
          status: "CLOSED",
          completeness: "COMPLETE",
          endedAt: "2026-07-15T17:20:00.000Z",
          destinationName: "Garoua",
        }),
      ],
    });
    const open = (await screen.findByText("Douala → Yaoundé")).closest("li");
    const closed = screen.getByText("Douala → Garoua").closest("li");
    if (!(open instanceof HTMLElement) || !(closed instanceof HTMLElement)) throw new Error("no trip rows");

    expect(within(open).getByText("On the road")).toBeTruthy();
    expect(within(open).getByText("Ended: Not recorded")).toBeTruthy();
    expect(within(open).queryByText(/still open/i)).toBeNull();

    expect(within(closed).getByText("Closed")).toBeTruthy();
    expect(within(closed).getByText(/^Ended: \d/)).toBeTruthy();
    expect(within(closed).queryByText("On the road")).toBeNull();
  });

  it("starts a trip on the sheet with this vehicle", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}/trips`, { role: "DRIVER", trips: [tripRow()] });
    const user = userEvent.setup();
    expect(await screen.findByText("Douala → Yaoundé")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Record a sheet" }));
    await waitFor(() => expect(recorded.history.location.pathname).toBe("/activities/record"));
    expect(recorded.history.location.search).toContain(`assetId=${ASSET_ID}`);
    await act(async () => {});
  });
});

