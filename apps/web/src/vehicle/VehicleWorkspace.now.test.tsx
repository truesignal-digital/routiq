// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ASSET_ID, ME_ID, NOTE_ID, OTHER_ID, actor, attention, noteDetail } from "./test/fixtures.js";
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

async function todoCard() {
  const title = await screen.findByRole("heading", { level: 2, name: /^To do/ });
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
