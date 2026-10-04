// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { latestModelYear, type Role } from "@routiq/contracts";
import { ALL_MODULES, ASSET_ID, asset, historyItem } from "./test/fixtures.js";
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

const DETAILS = `/assets/${ASSET_ID}/details`;

async function startEditing(options: Parameters<typeof openVehicle>[1] = { role: "ADMIN" }) {
  const recorded = await openVehicle(DETAILS, options);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Edit details" }));
  await screen.findByRole("button", { name: "Save" });
  return { recorded, user };
}

const field = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;

describe("the Details card's edit mode", () => {
  it("turns the same card's descriptive values into inputs and leaves the rest as text", async () => {
    const { recorded, user } = await startEditing();
    expect(field("Plate").value).toBe("LT 482 AB");
    expect(field("Make").value).toBe("Mercedes-Benz");
    expect(field("Model").value).toBe("Actros 2644");
    expect(field("Year").value).toBe("2019");
    expect(field("Chassis number").value).toBe("WDB9634031L123456");
    expect(field("Axle count").value).toBe("3");
    expect(field("Body type").value).toBe("Tautliner");
    expect(screen.getByRole("button", { name: "Acquisition date" }).textContent).toContain("Mar 1, 2024");
    // Fleet code, class and the whole "Right now" column stay text.
    expect(screen.queryByRole("textbox", { name: "Fleet code" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Class" })).toBeNull();
    expect(screen.getByText("VH003", { selector: "span.font-medium" })).toBeTruthy();
    expect(screen.getByText("Changed through its own actions")).toBeTruthy();
    expect(screen.getByText("Sali since 8/1/26")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit details" })).toBeNull();

    await user.type(field("Plate"), " X");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(await screen.findByRole("button", { name: "Edit details" })).toBeTruthy();
    expect(screen.getByText("LT 482 AB", { selector: "dd" })).toBeTruthy();
    expect(recorded.commands).toEqual([]);
  });

  it("saves only what changed, against the version on screen, and returns to the card", async () => {
    const { recorded, user } = await startEditing({
      role: "ADMIN",
      assetReads: [asset(), asset({ registrationNumber: "LT 132 AB", rowVersion: 5 })],
    });
    await user.clear(field("Plate"));
    await user.type(field("Plate"), "  LT 132 AB ");
    await user.clear(field("Tonnage (t)"));
    await user.type(field("Tonnage (t)"), "26,5");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(recorded.commands).toHaveLength(1));
    const [command] = recorded.commands;
    expect(command?.name).toBe("update-asset-details");
    expect(command?.body.envelope["expectedVersion"]).toBe(4);
    expect(command?.body.payload).toEqual({
      assetId: ASSET_ID,
      registrationNumber: "LT 132 AB",
      customValues: { tonnageCapacity: 26.5 },
    });
    expect(await screen.findByText("Vehicle details saved.")).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Edit details" })).toBeTruthy();
    expect(await screen.findByText("LT 132 AB", { selector: "dd" })).toBeTruthy();
  });

  it("sends nothing when nothing changed", async () => {
    const { recorded, user } = await startEditing();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Nothing to save: no changes.")).toBeTruthy();
    expect(recorded.commands).toEqual([]);
    expect(await screen.findByRole("button", { name: "Edit details" })).toBeTruthy();
  });

  it("stops a second editor with the conflict message, and reloads the other person's values", async () => {
    const { recorded, user } = await startEditing({
      role: "ADMIN",
      assetReads: [asset(), asset({ registrationNumber: "LT 999 ZZ", rowVersion: 5 })],
      command: () => ({
        status: 409,
        body: { error: { code: "VERSION_CONFLICT", metadata: { expectedVersion: 4, currentVersion: 5 } } },
      }),
    });
    await user.clear(field("Model"));
    await user.type(field("Model"), "Actros 1845");
    await user.click(screen.getByRole("button", { name: "Save" }));

    const banner = await screen.findByRole("alert");
    expect(banner.textContent).toContain("Someone else changed this vehicle. Reload to see their changes.");
    expect(recorded.commands).toHaveLength(1);
    await user.click(within(banner).getByRole("button", { name: "Reload" }));
    await waitFor(() => expect(field("Plate").value).toBe("LT 999 ZZ"));
    expect(field("Model").value).toBe("Actros 2644");
    expect(screen.queryByText(/Someone else changed this vehicle/)).toBeNull();
  });

  it("keeps what is being typed when the vehicle is read again in the background", async () => {
    const { recorded, user } = await startEditing({
      role: "ADMIN",
      assetReads: [asset(), asset({ registrationNumber: "LT 999 ZZ", rowVersion: 5 })],
    });
    await user.clear(field("Model"));
    await user.type(field("Model"), "Actros 1845");
    await act(async () => {
      await recorded.client.invalidateQueries();
    });
    await waitFor(() => expect(screen.getAllByText("LT 999 ZZ").length).toBeGreaterThan(0));
    expect(field("Model").value).toBe("Actros 1845");
    expect(field("Plate").value).toBe("LT 482 AB");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(recorded.commands).toHaveLength(1));
    // Still versioned against what the editor started from.
    expect(recorded.commands[0]?.body.envelope["expectedVersion"]).toBe(4);
  });

  it("names each wrong field in the card's own words and sends nothing", async () => {
    const { recorded, user } = await startEditing();
    await user.clear(field("Year"));
    await user.type(field("Year"), "219");
    await user.type(field("Chassis number"), "99");
    await user.clear(field("Acquisition amount"));
    await user.type(field("Acquisition amount"), "45,000.50");
    await user.clear(field("Axle count"));
    await user.type(field("Axle count"), "three");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(`Enter a year between 1950 and ${latestModelYear()}.`)).toBeTruthy();
    expect(screen.getByText("The chassis number is too long (17 characters at most).")).toBeTruthy();
    expect(screen.getByText("Enter the amount in whole francs, without decimals.")).toBeTruthy();
    expect(screen.getByText("Enter a number.")).toBeTruthy();
    expect(screen.getByText("Fix the fields in red, then save again.")).toBeTruthy();
    expect(field("Year").getAttribute("aria-invalid")).toBe("true");
    expect(recorded.commands).toEqual([]);
  });

  it("asks for the date before an amount", async () => {
    const { recorded, user } = await startEditing({
      role: "ADMIN",
      asset: asset({ acquisitionDate: null, acquisitionAmountMinor: null }),
    });
    await user.type(field("Acquisition amount"), "12000000");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Add the acquisition date to record an amount.")).toBeTruthy();
    expect(recorded.commands).toEqual([]);
  });

  it("picks the acquisition date from the calendar, never a future day", async () => {
    const { recorded, user } = await startEditing({
      role: "ADMIN",
      asset: asset({ acquisitionDate: "2024-03-01" }),
    });
    expect(document.querySelector('input[type="date"]')).toBeNull();
    await user.click(screen.getByRole("button", { name: "Acquisition date" }));
    await user.click(await screen.findByRole("button", { name: "Previous month" }));
    await user.click(screen.getByRole("button", { name: "Thursday, February 15, 2024" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(recorded.commands).toHaveLength(1));
    expect(recorded.commands[0]?.body.payload).toEqual({ assetId: ASSET_ID, acquisitionDate: "2024-02-15" });

    cleanup();
    await closeVehicle();
    const again = await startEditing({ role: "ADMIN" });
    await again.user.click(screen.getByRole("button", { name: "Acquisition date" }));
    await again.user.click(await screen.findByRole("button", { name: "Next year" }));
    for (let step = 0; step < 3; step += 1) {
      await again.user.click(screen.getByRole("button", { name: "Next year" }));
    }
    const future = screen
      .getAllByRole("button")
      .find((button) => /, 2028$/.test(button.getAttribute("aria-label") ?? ""));
    expect((future as HTMLButtonElement | undefined)?.disabled).toBe(true);
  });

  it("puts the server's refusal on the field it is about", async () => {
    const { user } = await startEditing({
      role: "ADMIN",
      command: () => ({ status: 409, body: { error: { code: "DUPLICATE_REGISTRATION_NUMBER" } } }),
    });
    await user.clear(field("Plate"));
    await user.type(field("Plate"), "CE 777 AA");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Another vehicle already has this plate.")).toBeTruthy();
    expect(field("Plate").getAttribute("aria-invalid")).toBe("true");
  });

  it("shows the amount the same way in the card and in the field", async () => {
    await openVehicle(DETAILS, { role: "ADMIN" });
    const user = userEvent.setup();
    expect(await screen.findByText("3/1/24 · FCFA 45,000,000")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Edit details" }));
    const amount = await screen.findByRole("textbox", { name: "Acquisition amount" });
    expect((amount as HTMLInputElement).value).toBe("45,000,000");
    expect(amount.parentElement?.textContent).toContain("FCFA");
    // The symbol leads in English, as in the card.
    expect(amount.previousElementSibling?.textContent).toBe("FCFA");
  });
});

describe("who may edit", () => {
  it.each(["FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"] as Role[])(
    "%s reads the card without the button",
    async (role) => {
      await openVehicle(DETAILS, { role });
      expect(await screen.findByText("Chassis number")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Edit details" })).toBeNull();
    },
  );

  it.each(["DIRECTOR", "ADMIN"] as Role[])("offers %s the button, with its tooltip", async (role) => {
    await openVehicle(DETAILS, { role });
    const user = userEvent.setup();
    const button = await screen.findByRole("button", { name: "Edit details" });
    await user.hover(button);
    expect(await screen.findByText("Edit vehicle details")).toBeTruthy();
  });

  it("leaves the acquisition amount out where the books are not kept", async () => {
    await startEditing({ role: "ADMIN", modules: ALL_MODULES.filter((module) => module !== "FINANCE") });
    expect(screen.getByRole("button", { name: "Acquisition date" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Acquisition amount" })).toBeNull();
  });

  it.each([
    ["en", "SOLD", "This vehicle is sold; its details can't be changed."],
    ["en", "WRITTEN_OFF", "This vehicle is written off; its details can't be changed."],
    ["fr-CM", "RETIRED", "Ce véhicule est retiré du service ; ses informations ne peuvent plus être modifiées."],
  ] as const)("%s: a %s vehicle has no button, and says why", async (locale, status, message) => {
    await openVehicle(DETAILS, { role: "ADMIN", locale, asset: asset({ lifecycleStatus: status }) });
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Edit details|Modifier/ })).toBeNull();
  });

  it("fr-CM: Modifier, Enregistrer and Annuler", async () => {
    await openVehicle(DETAILS, { role: "ADMIN", locale: "fr-CM" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Modifier" }));
    expect(await screen.findByRole("button", { name: "Enregistrer" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Annuler" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Marque" })).toBeTruthy();
    expect(screen.getByText("Se modifie par ses propres actions")).toBeTruthy();
  });

  it("keeps Save and Cancel on the phone", async () => {
    await startEditing({ role: "ADMIN", width: 390 });
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
  });
});

describe("History", () => {
  it("shows a details edit as before and after, with the editor's name", async () => {
    await openVehicle(`/assets/${ASSET_ID}/history`, {
      role: "ADMIN",
      history: [
        historyItem({
          eventType: "asset.details_updated",
          kind: "LIFECYCLE",
          actor: { principalId: null, displayName: "Boris", scope: "WORKSPACE" },
          subject: { entityType: "asset", id: ASSET_ID, number: null },
          params: {},
          changes: [
            { field: "registrationNumber", kind: "VALUE", before: "LT 123 AB", after: "LT 132 AB" },
            { field: "acquisitionAmountMinor", kind: "MONEY", before: null, after: 45_000_000 },
            { field: "customValues", kind: "VALUE", before: { axleCount: 3 }, after: { axleCount: 4 } },
          ],
        }),
      ],
    });
    expect(await screen.findByText("Details edited")).toBeTruthy();
    const detail = screen.getByText(/Plate: LT 123 AB → LT 132 AB/);
    const text = detail.textContent?.replace(/[\u00a0\u202f]/g, " ");
    expect(text).toContain("Acquisition amount: Not recorded → FCFA 45,000,000");
    expect(text).toContain("Axle count: 3 → 4");
    expect(screen.getByText("Boris")).toBeTruthy();
  });
});
