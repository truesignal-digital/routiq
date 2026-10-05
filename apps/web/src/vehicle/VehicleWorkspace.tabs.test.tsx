// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ALL_MODULES,
  ASSET_ID,
  ENTRY_ID,
  WORK_ORDER_ID,
  asset,
  documentRow,
  entryRow,
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
    expect(tabNames()).toEqual(["Now", "Maintenance", "Money", "Trips", "Documents", "History", "Details"]);
  });

  it("keeps the books from the workshop, and each module's section from a workspace without it", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, { role: "TECHNICIAN" });
    await screen.findByText("Available.");
    expect(tabNames()).toEqual(["Now", "Maintenance", "Trips", "Documents", "History", "Details"]);
    cleanup();
    await openVehicle(`/assets/${ASSET_ID}`, { role: "ADMIN", modules: ["CORE", "ASSETS"] });
    await screen.findByText("Available.");
    expect(tabNames()).toEqual(["Now", "History", "Details"]);
  });

  it("keeps the books from the counter and the drivers, and documents from the counter (#264)", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}`, { role: "CASHIER", asset: asset({ finance: undefined }) });
    await screen.findByText("Available.");
    expect(tabNames()).toEqual(["Now", "Maintenance", "Trips", "History", "Details"]);
    expect(requested(recorded, `/v1/assets/${ASSET_ID}/documents`)).toEqual([]);
    expect(requested(recorded, `/v1/assets/${ASSET_ID}/finance`)).toEqual([]);
    cleanup();
    const driver = await openVehicle(`/assets/${ASSET_ID}`, { role: "DRIVER", asset: asset({ finance: undefined }) });
    await screen.findByText("Available.");
    expect(tabNames()).toEqual(["Now", "Maintenance", "Trips", "Documents", "History", "Details"]);
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
    expect(await screen.findByText("This module is not enabled for your workspace.")).toBeTruthy();
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
      ["en", "Awaiting review", "Costs awaiting review"],
      ["fr-CM", "En attente d'examen", "Coûts en attente d'examen"],
    ] as const)("%s: Money, its entry badges and the work order's pending costs agree", async (locale, name, heading) => {
      await openVehicle(`/assets/${ASSET_ID}/money?period=2026-09&entries=review&panel=work_order:${WORK_ORDER_ID}`, {
        role: "FINANCE",
        locale,
        entries: [entryRow({ status: "SUBMITTED" })],
        workOrderDetails: [pending],
      });
      const panel = await screen.findByRole("dialog", { name: /Brake repair/ });
      expect(await within(panel).findByText(heading)).toBeTruthy();
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
});

describe("Maintenance and Trips", () => {
  it("lists work in progress and unplanned problems, with the role's step marked", async () => {
    await openVehicle(`/assets/${ASSET_ID}/maintenance`, {
      role: "TECHNICIAN",
      workOrders: [workOrderRow("APPROVED")],
      issues: [
        issueRow({ workOrders: [{ id: workOrderRow("APPROVED").id, status: "APPROVED" }] }),
        issueRow({ id: "00000000-0000-4000-8000-00000000c009", description: "Rear mudguard cracked", safetyCritical: false, category: "BODYWORK" }),
      ],
    });
    expect(await screen.findByText("Brake repair: replace pads and air valve")).toBeTruthy();
    expect(screen.getByText("Next step is yours")).toBeTruthy();
    expect(screen.getByText("Rear mudguard cracked")).toBeTruthy();
    // The problem already in a work order is not "new".
    expect(screen.queryByText("Brake pressure warning on the Kekem descent")).toBeNull();
    expect(await screen.findByText("Bodywork")).toBeTruthy();
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
    expect(within(open).getByText("Ended —")).toBeTruthy();
    expect(within(open).queryByText(/still open/i)).toBeNull();

    expect(within(closed).getByText("Closed")).toBeTruthy();
    expect(within(closed).getByText(/^Ended \d/)).toBeTruthy();
    expect(within(closed).queryByText("On the road")).toBeNull();
  });

  it("starts a trip on the sheet with this vehicle", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}/trips`, { role: "DRIVER", trips: [tripRow()] });
    const user = userEvent.setup();
    expect(await screen.findByText("Douala → Yaoundé")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Start a trip" }));
    await waitFor(() => expect(recorded.history.location.pathname).toBe("/activities/record"));
    expect(recorded.history.location.search).toContain(`assetId=${ASSET_ID}`);
    await act(async () => {});
  });
});

