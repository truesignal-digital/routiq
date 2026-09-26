// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@routiq/contracts";
import {
  ASSET_ID,
  ME_ID,
  actor,
  asset,
  attention,
  grounded,
  groundingWorkOrder,
} from "./test/fixtures.js";
import { closeVehicle, openVehicle } from "./test/harness.js";

// The shared command client captures `fetch` at import; route it through the stub.
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

const inRepair = asset({ availability: grounded([groundingWorkOrder("APPROVED")]) });
const WO_REF = groundingWorkOrder("APPROVED").id.slice(0, 8).toUpperCase();

/** The status block: the sentence, its notes and the role's step. */
async function sentence(): Promise<HTMLElement> {
  const lead = await screen.findByText(/Grounded for \d+ days|Immobilisé depuis \d+ jours/);
  return lead.closest("[role=status]") as HTMLElement;
}

describe("the status sentence and the step beside it, per role", () => {
  const cases: Array<{ role: Role; button?: string; caption?: RegExp; doNotDrive?: boolean }> = [
    { role: "ADMIN", button: "Complete work" },
    { role: "OPS_MANAGER", button: "Complete work" },
    { role: "MAINTENANCE", button: "Complete work" },
    { role: "FINANCE_APPROVER", caption: new RegExp(`Sign off · Needs ${WO_REF} completed first\\.`) },
    { role: "FIELD_SUBMITTER", doNotDrive: true },
    { role: "EXECUTIVE_VIEWER" },
  ];

  it.each(cases)("$role", async ({ role, button, caption, doNotDrive }) => {
    await openVehicle(`/assets/${ASSET_ID}`, { role, asset: inRepair });
    const block = within(await sentence());
    expect(block.getByText(/Brake pressure warning on the Kekem descent/)).toBeTruthy();
    expect(block.getByText(/Waiting on the workshop to finish the repair/)).toBeTruthy();
    if (button !== undefined) {
      expect(block.getByRole("button", { name: button })).toBeTruthy();
    } else {
      expect(block.queryByRole("button", { name: /Complete work|Release|Authorize|Sign off/ })).toBeNull();
    }
    if (caption !== undefined) {
      expect(block.getByText(caption)).toBeTruthy();
      expect(block.getByRole("button", { name: `Open work order ${WO_REF}` })).toBeTruthy();
    }
    expect(block.queryByText("Do not drive it until a manager releases it to service.") !== null).toBe(
      doNotDrive === true,
    );
  });

  it("names the maker lock instead of offering the authorization", async () => {
    const mine = groundingWorkOrder("SUBMITTED", { createdBy: actor(ME_ID, "Awa") });
    await openVehicle(`/assets/${ASSET_ID}`, {
      role: "FINANCE_APPROVER",
      asset: asset({ availability: grounded([mine]) }),
    });
    const block = within(await sentence());
    expect(block.getByText(new RegExp(`You created ${WO_REF}; someone else authorizes it\\.`))).toBeTruthy();
    expect(block.queryByRole("button", { name: "Authorize" })).toBeNull();
  });

  it("offers the release, then locks it for whoever vouched for the repair", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, {
      role: "OPS_MANAGER",
      asset: asset({ availability: grounded([groundingWorkOrder("COMPLETED")]) }),
    });
    expect(within(await sentence()).getByRole("button", { name: "Release to service" })).toBeTruthy();
    cleanup();
    await openVehicle(`/assets/${ASSET_ID}`, {
      role: "OPS_MANAGER",
      asset: asset({
        availability: grounded([groundingWorkOrder("COMPLETED", { completedBy: actor(ME_ID, "Boris") })]),
      }),
    });
    const block = within(await sentence());
    expect(block.getByText(/You vouched for the repair of a safety-critical problem/)).toBeTruthy();
  });

  it("speaks French, quoting the report", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, { role: "OPS_MANAGER", asset: inRepair, locale: "fr-CM" });
    const block = within(await sentence());
    expect(block.getByText(/« Brake pressure warning on the Kekem descent »/)).toBeTruthy();
    expect(screen.getByRole("tab", { name: /En ce moment/ })).toBeTruthy();
  });

  it("says an expired document by its date, never as a legal verdict", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, {
      role: "OPS_MANAGER",
      attention: [
        attention("DOCUMENT_EXPIRED", {
          params: { documentTypeLabelFr: "Visite technique", documentTypeLabelEn: "Technical inspection", expiresAt: "2026-09-23", daysLeft: -2 },
        }),
      ],
    });
    const block = (await screen.findByText("Available.")).closest("[role=status]") as HTMLElement;
    await waitFor(() => expect(block.textContent).toMatch(/Also: Technical inspection expired on 9\/23\/26\./));
    expect(within(block).getByRole("button", { name: "Technical inspection" })).toBeTruthy();
    expect(block.textContent).not.toMatch(/legally/);
  });

  it("reads NOT_ASSESSED when the maintenance module is off", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, {
      role: "ADMIN",
      modules: ["CORE", "ASSETS", "FINANCE", "DOCUMENTS", "ACTIVITIES"],
      asset: asset({ availability: { state: "NOT_ASSESSED" } }),
    });
    expect(await screen.findByText("Availability not assessed.")).toBeTruthy();
    expect(screen.queryByRole("tab", { name: /Maintenance/ })).toBeNull();
  });

  it("says a vehicle outside the caller's branches is not found, and offers a retry on failure", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, { role: "FIELD_SUBMITTER", assetStatus: 404 });
    expect(await screen.findByText("This vehicle does not exist or is outside your branches.")).toBeTruthy();
    cleanup();
    await openVehicle(`/assets/${ASSET_ID}`, { role: "FIELD_SUBMITTER", assetStatus: 500 });
    expect((await screen.findByRole("alert")).textContent).toContain("We couldn't load this asset.");
  });
});

describe("header, phone bar and all-actions sheet, per role", () => {
  const header: Record<Role, string[]> = {
    FIELD_SUBMITTER: ["Log fuel", "Report a problem", "More actions"],
    MAINTENANCE: ["Report a problem", "More actions"],
    ADMIN: ["Record expense", "More actions"],
    OPS_MANAGER: ["Record expense", "More actions"],
    FINANCE_APPROVER: ["Record expense", "More actions"],
    EXECUTIVE_VIEWER: [],
  };

  it.each(Object.entries(header) as Array<[Role, string[]]>)("%s header at 1280 px", async (role, labels) => {
    await openVehicle(`/assets/${ASSET_ID}`, { role });
    await screen.findByText("Available.");
    for (const label of labels) expect(screen.getByRole("button", { name: label }), label).toBeTruthy();
    const others = ["Log fuel", "Report a problem", "Record expense"].filter((label) => !labels.includes(label));
    for (const label of others) expect(screen.queryByRole("button", { name: label }), label).toBeNull();
    expect(screen.queryByText("View only") !== null).toBe(role === "EXECUTIVE_VIEWER");
  });

  const bar: Record<Role, string[]> = {
    FIELD_SUBMITTER: ["Fuel", "Problem", "Odometer", "More"],
    MAINTENANCE: ["Work order", "Problem", "Note", "More"],
    ADMIN: ["Expense", "Problem", "Trip", "More"],
    OPS_MANAGER: ["Expense", "Problem", "Trip", "More"],
    FINANCE_APPROVER: ["Expense", "Reverse", "More"],
    EXECUTIVE_VIEWER: [],
  };

  it.each(Object.entries(bar) as Array<[Role, string[]]>)("%s phone bar at 390 px", async (role, labels) => {
    await openVehicle(`/assets/${ASSET_ID}`, { role, width: 390 });
    await screen.findByText("Available.");
    const toolbar = screen.queryByRole("toolbar", { name: "Quick actions" });
    if (labels.length === 0) {
      expect(toolbar).toBeNull();
      return;
    }
    expect(within(toolbar as HTMLElement).getAllByRole("button").map((b) => b.textContent)).toEqual(labels);
  });

  it("lists the finance approver's own area first, locks what waits, and searches", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, { role: "FINANCE_APPROVER" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "More actions" }));
    const sheet = await screen.findByRole("dialog", { name: "All actions" });
    const groups = within(sheet).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(groups[0]).toBe("Money");
    const review = within(sheet).getByRole("button", { name: /Review entry/ });
    expect((review as HTMLButtonElement).disabled).toBe(true);
    expect(review.textContent).toContain("Nothing waiting for review.");
    await user.type(within(sheet).getByRole("textbox", { name: "Search actions" }), "renew");
    await waitFor(() => expect(within(sheet).queryByRole("button", { name: /Review entry/ })).toBeNull());
    expect(within(sheet).getByText(/No action matches/)).toBeTruthy();
  });

  it("shows the workshop only what it may take", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, { role: "MAINTENANCE" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "More actions" }));
    const sheet = await screen.findByRole("dialog", { name: "All actions" });
    expect(within(sheet).getAllByRole("heading", { level: 3 })[0]?.textContent).toBe("Maintenance");
    expect(within(sheet).queryByRole("button", { name: /Record expense/ })).toBeNull();
    expect(within(sheet).queryByRole("button", { name: /Release to service/ })).toBeNull();
    expect(within(sheet).getByRole("button", { name: /Record odometer/ })).toBeTruthy();
  });
});
