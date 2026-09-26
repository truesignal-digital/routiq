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
    await openVehicle(`/assets/${ASSET_ID}`, { role: "OPS_MANAGER" });
    await screen.findByText("Available.");
    expect(tabNames()).toEqual(["Now", "Maintenance", "Money", "Trips", "Documents", "History"]);
  });

  it("keeps the books from the workshop, and each module's section from a workspace without it", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, { role: "MAINTENANCE" });
    await screen.findByText("Available.");
    expect(tabNames()).toEqual(["Now", "Maintenance", "Trips", "Documents", "History"]);
    cleanup();
    await openVehicle(`/assets/${ASSET_ID}`, { role: "ADMIN", modules: ["CORE", "ASSETS"] });
    await screen.findByText("Available.");
    expect(tabNames()).toEqual(["Now", "History"]);
  });

  it("renders the workshop's header and Now without a money card, from a detail with no finance block", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}`, {
      role: "MAINTENANCE",
      asset: asset({ finance: undefined }),
    });
    expect(await screen.findByText("Available.")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("VH003");
    expect(screen.getByRole("button", { name: "Report a problem" })).toBeTruthy();
    expect(await screen.findByText("Recent")).toBeTruthy();
    expect(screen.queryByText("This vehicle's share")).toBeNull();
    expect(screen.queryByText(/Lifetime/)).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getAllByRole("button", { name: "Details" }).at(-1)!);
    // The purchase price is money too: the date alone.
    expect(await screen.findByText("3/1/24")).toBeTruthy();
    expect(screen.queryByText(/45,000,000/)).toBeNull();
    expect(
      recorded.requests.some(({ url }) => url.pathname.startsWith("/v1/finance") || url.pathname.endsWith("/finance")),
    ).toBe(false);
  });

  it("denies a direct link to Money for the workshop without ever asking for money", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}/money`, { role: "MAINTENANCE" });
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
    await openVehicle(`/assets/${ASSET_ID}/documents`, { role: "FIELD_SUBMITTER", documents: [documentRow()] });
    expect(await screen.findByRole("heading", { name: "Documents" })).toBeTruthy();
    expect(await screen.findByText("Technical inspection")).toBeTruthy();
    expect(screen.getByText("Expired")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Documents", selected: true })).toBeTruthy();
  });
});

describe("Money", () => {
  it("reads the month from the URL and names each chip's basis in its query", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}/money?period=2026-08`, {
      role: "FINANCE_APPROVER",
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
        role: "FINANCE_APPROVER",
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
        role: "FINANCE_APPROVER",
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
    const recorded = await openVehicle(`/assets/${ASSET_ID}/money?period=2026-08`, { role: "OPS_MANAGER" });
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
      role: "OPS_MANAGER",
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
      role: "MAINTENANCE",
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

  it("starts a trip on the sheet with this vehicle", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}/trips`, { role: "FIELD_SUBMITTER", trips: [tripRow()] });
    const user = userEvent.setup();
    expect(await screen.findByText("Douala → Yaoundé")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Start a trip" }));
    await waitFor(() => expect(recorded.history.location.pathname).toBe("/activities/record"));
    expect(recorded.history.location.search).toContain(`assetId=${ASSET_ID}`);
    await act(async () => {});
  });
});

