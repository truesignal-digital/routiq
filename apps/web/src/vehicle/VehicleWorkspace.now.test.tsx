// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ASSET_ID,
  ME_ID,
  NOTE_ID,
  OTHER_ID,
  TRIP_ID,
  WORK_ORDER_ID,
  actor,
  attention,
  noteDetail,
  workOrderDetail,
  workOrderRow,
} from "./test/fixtures.js";
import { closeVehicle, openVehicle } from "./test/harness.js";

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

const EMPTY = "Nothing needs you right now.";

async function todoCard(name = /^To do/) {
  const title = await screen.findByRole("heading", { level: 2, name });
  const card = title.closest<HTMLElement>("[data-slot=card]");
  if (card === null) throw new Error("To do card not found");
  return card;
}

describe("the To do card while its read is in flight (#148)", () => {
  it("shows a loading state, never the empty state, until the attention read answers", async () => {
    let answer: () => void = () => {};
    const attentionHeld = new Promise<void>((resolve) => {
      answer = resolve;
    });
    await openVehicle(`/assets/${ASSET_ID}`, {
      role: "FINANCE",
      attention: [attention("ENTRY_AWAITING_REVIEW")],
      attentionHeld,
    });

    const card = await todoCard();
    expect(card.getAttribute("aria-busy")).toBe("true");
    expect(card.querySelectorAll("[data-slot=skeleton]").length).toBeGreaterThan(0);
    expect(within(card).queryByText(EMPTY)).toBeNull();

    await act(async () => answer());
    expect(await within(card).findByText(/awaiting review$/)).toBeTruthy();
    expect(within(card).queryByText(EMPTY)).toBeNull();
    expect(card.querySelectorAll("[data-slot=skeleton]")).toHaveLength(0);
    expect(card.getAttribute("aria-busy")).toBeNull();
  });

  it("says nothing needs you only once the read has answered with nothing", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, { role: "ADMIN", attention: [] });
    const card = await todoCard();
    expect(await within(card).findByText(EMPTY)).toBeTruthy();
    expect(card.querySelectorAll("[data-slot=skeleton]")).toHaveLength(0);
  });

  it("says the to-dos could not load when the read fails, instead of claiming there are none", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, { role: "ADMIN", attentionStatus: 500 });
    const card = await todoCard();
    expect(await within(card).findByText("We couldn't load what needs you on this vehicle.")).toBeTruthy();
    expect(within(card).queryByText(EMPTY)).toBeNull();
    expect(card.querySelectorAll("[data-slot=skeleton]")).toHaveLength(0);
  });
});

describe("Direction's notes in the To do (#98)", () => {
  const BODY = "Why is this repair so expensive? Call me before paying the garage.";
  const fromDirection = (author = OTHER_ID) =>
    attention("DIRECTION_NOTE", {
      severity: "INFO",
      since: "2026-09-24T07:30:00.000Z",
      makerPrincipalIds: [author],
      params: { description: BODY, recordedBy: actor(author, "Émilienne") },
    });

  it("shows an open note from Direction with its author and a distinct style, and lets the driver mark it seen", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}`, {
      role: "DRIVER",
      attention: [fromDirection()],
      notes: [noteDetail()],
    });
    const card = await todoCard();
    const title = await within(card).findByRole("button", { name: BODY });
    const row = title.closest("li");
    expect(row?.className).toContain("bg-info/10");
    expect(within(row!).getByRole("img", { name: "Note from Direction" })).toBeTruthy();
    expect(within(row!).getByText(/^Note from Direction · Émilienne · /)).toBeTruthy();

    const user = userEvent.setup();
    await user.click(within(row!).getByRole("button", { name: "Mark as seen" }));
    const form = await screen.findByRole("dialog", { name: "Mark as seen" });
    await user.click(within(form).getByRole("button", { name: "Mark as seen" }));
    await waitFor(() => expect(recorded.commands).toHaveLength(1));
    expect(recorded.commands[0]?.name).toBe("acknowledge-note");
    expect(recorded.commands[0]?.body.payload).toEqual({ noteId: NOTE_ID });
  });

  it("leaves Direction's own note waiting on the team for its author", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, {
      role: "DIRECTOR",
      attention: [fromDirection(ME_ID)],
      notes: [noteDetail({ author: actor(ME_ID, "Émilienne") })],
    });
    const card = await todoCard();
    expect(await within(card).findByText(EMPTY)).toBeTruthy();
    expect(within(card).queryByRole("button", { name: "Mark as seen" })).toBeNull();
    expect(within(card).getByText("The team")).toBeTruthy();
  });
});

describe("a repair whose invoice is still to come (#82)", () => {
  const WO_REF = WORK_ORDER_ID.slice(0, 8).toUpperCase();

  it("asks the workshop to enter the invoice, and opens the late invoice form on the order", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, {
      role: "TECHNICIAN",
      attention: [
        attention("WORK_ORDER_COST_TO_COME", {
          params: { description: "Brake repair", currency: "XAF" },
        }),
      ],
      workOrders: [workOrderRow("COMPLETED")],
      workOrderDetails: [
        workOrderDetail("COMPLETED", {
          completedAt: "2026-09-30T10:00:00.000Z",
          costOutcome: "INVOICE_PENDING",
          costToCome: { reason: "INVOICE_PENDING", awaitingApproval: false },
        }),
      ],
    });
    const card = await todoCard();
    expect(await within(card).findByText(`Invoice for repair ${WO_REF} to enter`)).toBeTruthy();
    expect(within(card).getByText(/^Brake repair · closed before the invoice arrived/)).toBeTruthy();

    const user = userEvent.setup();
    await user.click(within(card).getByRole("button", { name: "Record expense" }));
    const form = await screen.findByRole("dialog", { name: "Record expense" });
    expect(within(form).getByLabelText("Reason")).toBeTruthy();
  });

  it("says what a v1 close declared against what the books hold", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, {
      role: "ADMIN",
      attention: [
        attention("WORK_ORDER_COST_TO_COME", {
          params: {
            description: "Brake repair",
            currency: "XAF",
            declaredCostMinor: 50_000,
            recordedCostMinor: 0,
          },
        }),
      ],
    });
    const card = await todoCard();
    expect(
      await within(card).findByText(/^Brake repair · declared FCFA\s50,000, recorded FCFA\s0/),
    ).toBeTruthy();
  });
});

// #90: the first tab is the Overview, and To do opens it, open by default,
// collapsible to its count, the choice kept per browser.
describe("the Overview tab and its To do section (#90)", () => {
  const scenario = { role: "FINANCE" as const, attention: [attention("ENTRY_AWAITING_REVIEW")] };
  const toggle = () => screen.getByRole("button", { name: "To do" });

  it.each([
    ["en", "Overview", /^To do/],
    ["fr-CM", "Vue d'ensemble", /^À faire/],
  ] as const)("names the default route's tab (%s: %s) and opens it with To do first", async (locale, label, todo) => {
    await openVehicle(`/assets/${ASSET_ID}`, { ...scenario, locale });
    const tab = await screen.findByRole("tab", { name: new RegExp(`^${label}`) });
    expect(tab.getAttribute("aria-selected")).toBe("true");
    const card = await todoCard(todo);
    const cards = document.querySelectorAll("main [data-slot=card]");
    expect(cards[0]).toBe(card);
  });

  it("starts open, collapses to its count, and remembers the choice", async () => {
    const user = userEvent.setup();
    await openVehicle(`/assets/${ASSET_ID}`, scenario);
    const card = await todoCard();
    expect(await within(card).findByText(/awaiting review$/)).toBeTruthy();
    expect(toggle().getAttribute("aria-expanded")).toBe("true");

    await user.click(toggle());
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    expect(within(card).queryByText(/awaiting review$/)).toBeNull();
    expect(within(card).getByRole("heading", { level: 2 }).textContent).toMatch(/To do\s*1$/);
    expect(localStorage.getItem("routiq-vehicle-todo")).toBe("collapsed");

    cleanup();
    await openVehicle(`/assets/${ASSET_ID}`, scenario);
    await todoCard();
    expect(toggle().getAttribute("aria-expanded")).toBe("false");
    await user.click(toggle());
    expect(await screen.findByText(/awaiting review$/)).toBeTruthy();
    expect(localStorage.getItem("routiq-vehicle-todo")).toBe("expanded");
  });

  it("still opens and collapses when the browser refuses storage", async () => {
    const user = userEvent.setup();
    // Only this preference's key is refused, so the signed-in session still works.
    const { getItem, setItem } = Storage.prototype;
    const refuse = (key: string) => {
      if (key === "routiq-vehicle-todo") throw new DOMException("denied", "SecurityError");
    };
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, key) {
      refuse(key);
      return getItem.call(this, key);
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      refuse(key);
      setItem.call(this, key, value);
    });
    try {
      await openVehicle(`/assets/${ASSET_ID}`, scenario);
      const card = await todoCard();
      expect(await within(card).findByText(/awaiting review$/)).toBeTruthy();
      await user.click(toggle());
      expect(toggle().getAttribute("aria-expanded")).toBe("false");
      expect(within(card).queryByText(/awaiting review$/)).toBeNull();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});

describe("a vehicle on two unfinished trips (#577)", () => {
  const doubleBooked = (tripNumbers: string[]) =>
    attention("VEHICLE_DOUBLE_BOOKED", { params: { tripNumbers } });

  it("flags the trip, names the other one, and opens the trip from the row", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}`, {
      role: "ADMIN",
      attention: [doubleBooked(["DLA-2026-00012"])],
    });
    const card = await todoCard();
    // Closing a trip happens on the trip, so the flag waits on operations.
    expect(await within(card).findByText(EMPTY)).toBeTruthy();
    const user = userEvent.setup();
    await user.click(await within(card).findByRole("button", { name: /Waiting on others/ }));
    const row = within(card).getByRole("button", { name: /Trip DLA-2026-00009 overlaps another open trip/ });
    expect(
      within(row).getByText("This truck is also on DLA-2026-00012. Close whichever trip has ended."),
    ).toBeTruthy();
    expect(within(row).getByText("Operations")).toBeTruthy();

    await user.click(row);
    await waitFor(() =>
      expect(recorded.requests.some(({ url }) => url.pathname === `/v1/activities/${TRIP_ID}`)).toBe(true),
    );
  });

  it("still says close the stale one when the other trip is not the reader's to see", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, { role: "DRIVER", attention: [doubleBooked([])] });
    const card = await todoCard();
    const user = userEvent.setup();
    await user.click(await within(card).findByRole("button", { name: /Waiting on others/ }));
    expect(
      within(card).getByText("This truck is also on another open trip. Close the one that has ended."),
    ).toBeTruthy();
  });

  // The harness workspace runs the trucking preset alone, so its words apply.
  it("speaks the preset's words in French", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, {
      role: "ADMIN",
      locale: "fr-CM",
      attention: [doubleBooked(["DLA-2026-00012", "DLA-2026-00014"])],
    });
    const card = await todoCard(/^À faire/);
    const user = userEvent.setup();
    await user.click(await within(card).findByRole("button", { name: /En attente des autres/ }));
    expect(within(card).getByText(/^Le trajet DLA-2026-00009 chevauche un autre trajet ouvert$/)).toBeTruthy();
    expect(
      within(card).getByText(
        "Ce camion est aussi sur DLA-2026-00012 et DLA-2026-00014. Clôturez le trajet terminé.",
      ),
    ).toBeTruthy();
  });
});
