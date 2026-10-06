// @vitest-environment jsdom
import { act, cleanup, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ASSET_ID, attention } from "./test/fixtures.js";
import { closeVehicle, openVehicle } from "./test/harness.js";

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
