// @vitest-environment jsdom
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ASSET_ID, attention } from "./test/fixtures.js";
import { closeVehicle, openVehicle } from "./test/harness.js";

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

// #90: the first tab is the Overview, and To do opens it, open by default,
// collapsible to its count, the choice kept per browser.
describe("the Overview tab and its To do section (#90)", () => {
  const scenario = { role: "FINANCE" as const, attention: [attention("ENTRY_AWAITING_REVIEW")] };
  const toggle = () => screen.getByRole("button", { name: /^To do/ });

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
    expect(toggle().textContent).toMatch(/To do\s*1$/);
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
