// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Role } from "@routiq/contracts";
import {
  ASSET_ID,
  ME_ID,
  OTHER_ISSUE_ID,
  WORK_ORDER_ID,
  actor,
  asset,
  attention,
  grounded,
  groundingWorkOrder,
  workOrderDetail,
} from "./test/fixtures.js";
import { closeVehicle, openVehicle, requested } from "./test/harness.js";

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
/** The grounding work order's number as each language prints it (#608). */
const WO_REF = "WO-0007";
const WO_REF_FR = "OT-0007";

/** The status block: the sentence, its notes and the role's step. */
async function sentence(): Promise<HTMLElement> {
  const lead = await screen.findByText(/Grounded for \d+ days|Immobilisé depuis \d+ jours/);
  return lead.closest("[role=status]") as HTMLElement;
}

describe("the status sentence and the step beside it, per role", () => {
  const cases: Array<{
    role: Role;
    button?: string;
    locked?: { button: string; reason: string };
    caption?: RegExp;
    doNotDrive?: boolean;
  }> = [
    { role: "DIRECTOR", locked: { button: "Release to service", reason: `Needs ${WO_REF} completed first.` } },
    { role: "ADMIN", locked: { button: "Release to service", reason: `Needs ${WO_REF} completed first.` } },
    { role: "TECHNICIAN", button: "Complete work" },
    // Work-order sign-off moved to the managers (ADR-0009): Finance and the counter only read.
    { role: "FINANCE" },
    { role: "CASHIER" },
    { role: "DRIVER", doNotDrive: true },
  ];

  it.each(cases)("$role", async ({ role, button, locked, caption, doNotDrive }) => {
    await openVehicle(`/assets/${ASSET_ID}`, { role, asset: inRepair });
    const block = within(await sentence());
    expect(block.getByText(/Brake pressure warning on the Kekem descent/)).toBeTruthy();
    expect(block.getByText(/Waiting on the workshop to finish the repair/)).toBeTruthy();
    if (button !== undefined) {
      const go = block.getByRole("button", { name: button }) as HTMLButtonElement;
      expect(go.disabled).toBe(false);
    } else if (locked !== undefined) {
      const release = block.getByRole("button", { name: locked.button }) as HTMLButtonElement;
      expect(release.disabled).toBe(true);
      expect(release.getAttribute("aria-describedby")).toBeTruthy();
      expect(document.getElementById(release.getAttribute("aria-describedby") ?? "")?.textContent).toBe(locked.reason);
      expect(block.queryByRole("button", { name: /Complete work/ })).toBeNull();
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
    await openVehicle(`/assets/${ASSET_ID}?panel=work_order:${WORK_ORDER_ID}`, {
      role: "ADMIN",
      asset: asset({ availability: grounded([mine]) }),
      workOrderDetails: [workOrderDetail("SUBMITTED", { createdBy: actor(ME_ID, "Awa") })],
    });
    const panel = await screen.findByRole("dialog", { name: /Brake repair/ });
    const authorize = (await within(panel).findByRole("button", { name: "Authorize work order" })) as HTMLButtonElement;
    expect(authorize.disabled).toBe(true);
    expect(within(panel).getByText(new RegExp(`You created ${WO_REF}; someone else authorizes it\\.`))).toBeTruthy();
  });

  it("offers the Administrateur the authorization, and Finance none", async () => {
    const submitted = { asset: asset({ availability: grounded([groundingWorkOrder("SUBMITTED")]) }) };
    const path = `/assets/${ASSET_ID}?panel=work_order:${WORK_ORDER_ID}`;
    await openVehicle(path, { role: "ADMIN", ...submitted, workOrderDetails: [workOrderDetail("SUBMITTED")] });
    let panel = await screen.findByRole("dialog", { name: /Brake repair/ });
    expect(((await within(panel).findByRole("button", { name: "Authorize work order" })) as HTMLButtonElement).disabled).toBe(false);
    cleanup();
    await openVehicle(path, { role: "FINANCE", ...submitted, workOrderDetails: [workOrderDetail("SUBMITTED")] });
    panel = await screen.findByRole("dialog", { name: /Brake repair/ });
    await within(panel).findByText(/Brake repair/);
    expect(within(panel).queryByRole("button", { name: "Authorize work order" })).toBeNull();
  });

  it("keeps Complete work for the managers in the work order's footer and the actions sheet", async () => {
    await openVehicle(`/assets/${ASSET_ID}?panel=work_order:${WORK_ORDER_ID}`, {
      role: "ADMIN",
      asset: inRepair,
      workOrderDetails: [workOrderDetail("APPROVED")],
    });
    const panel = await screen.findByRole("dialog", { name: /Brake repair/ });
    expect(await within(panel).findByRole("button", { name: "Complete work" })).toBeTruthy();
    cleanup();
    await openVehicle(`/assets/${ASSET_ID}`, { role: "ADMIN", asset: inRepair });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "More actions" }));
    const sheet = await screen.findByRole("dialog", { name: "All actions" });
    expect((within(sheet).getByRole("button", { name: /Complete work/ }) as HTMLButtonElement).disabled).toBe(false);
    const release = within(sheet).getByRole("button", { name: /Release to service/ }) as HTMLButtonElement;
    expect(release.disabled).toBe(true);
  });

  it("offers the release, then locks it for whoever vouched for the repair", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, {
      role: "ADMIN",
      asset: asset({ availability: grounded([groundingWorkOrder("COMPLETED")]) }),
    });
    expect(within(await sentence()).getByRole("button", { name: "Release to service" })).toBeTruthy();
    cleanup();
    await openVehicle(`/assets/${ASSET_ID}`, {
      role: "ADMIN",
      asset: asset({
        availability: grounded([groundingWorkOrder("COMPLETED", { completedBy: actor(ME_ID, "Boris") })]),
      }),
    });
    const block = within(await sentence());
    expect(block.getByText(/You vouched for the repair of a safety-critical problem/)).toBeTruthy();
    expect((block.getByRole("button", { name: "Release to service" }) as HTMLButtonElement).disabled).toBe(true);
  });

  describe("a completed repair waiting for release", () => {
    const done = asset({ availability: grounded([groundingWorkOrder("COMPLETED")]) });
    const event = (kind: string, minute: number) => ({
      eventId: `00000000-0000-4000-8000-0000000001${String(minute).padStart(2, "0")}`,
      kind,
      occurredAt: `2026-09-24T10:${String(minute).padStart(2, "0")}:00.000Z`,
      actor: actor(ME_ID, "Hervé"),
      note: null,
      noteCode: null,
    });
    const direct = workOrderDetail("COMPLETED", {
      chronologie: [event("work_order.created", 1), event("work_order.approved", 2), event("work_order.completed", 3)],
    });
    const signedOff = workOrderDetail("COMPLETED", {
      chronologie: [
        event("work_order.created", 1),
        event("work_order.approved", 2),
        event("work_order.completion_submitted", 3),
        event("work_order.completion_approved", 4),
      ],
    });

    it("says completed, never signed off, when the completion landed COMPLETED directly", async () => {
      await openVehicle(`/assets/${ASSET_ID}`, { role: "FINANCE", asset: done, workOrderDetails: [direct] });
      const block = await sentence();
      await waitFor(() =>
        expect(block.textContent).toContain(`The repair (${WO_REF}) is completed; waiting on a manager to release it.`),
      );
      expect(block.textContent).not.toMatch(/signed off/);
    });

    it("says signed off once a completion approval happened", async () => {
      await openVehicle(`/assets/${ASSET_ID}`, { role: "FINANCE", asset: done, workOrderDetails: [signedOff] });
      const block = await sentence();
      await waitFor(() =>
        expect(block.textContent).toContain(`The repair (${WO_REF}) is signed off; waiting on a manager to release it.`),
      );
    });

    it("says completed when the timeline cannot be read", async () => {
      await openVehicle(`/assets/${ASSET_ID}`, { role: "FINANCE", asset: done });
      const block = await sentence();
      await waitFor(() => expect(block.textContent).toContain(`The repair (${WO_REF}) is completed;`));
    });

    it("says it in French", async () => {
      await openVehicle(`/assets/${ASSET_ID}`, { role: "FINANCE", asset: done, workOrderDetails: [direct], locale: "fr-CM" });
      const block = await sentence();
      await waitFor(() =>
        expect(block.textContent).toContain(
          `La réparation (${WO_REF_FR}) est terminée ; en attente d'un responsable pour la remise en service.`,
        ),
      );
      expect(block.textContent).not.toMatch(/validée/);
    });
  });

  // #562: nobody can release while another safety-critical problem is open, so
  // the sentence names that problem instead of sending people to a manager.
  describe("another safety-critical problem still open", () => {
    const steering = { id: OTHER_ISSUE_ID, number: 5, description: "Steering locks on the left" };
    const OTHER_REF = "PRB-0005";
    const blocked = asset({ availability: grounded([groundingWorkOrder("COMPLETED")], {}, [steering]) });

    it("names the open problem, not a manager", async () => {
      await openVehicle(`/assets/${ASSET_ID}`, { role: "FINANCE", asset: blocked });
      const block = await sentence();
      await waitFor(() =>
        expect(block.textContent).toContain(
          `The repair (${WO_REF}) is completed, but another safety-critical problem is still open: “Steering locks on the left” (${OTHER_REF}). It must be closed before release.`,
        ),
      );
      expect(block.textContent).not.toMatch(/waiting on a manager/);
      // Each record links under its own number (#608).
      expect(within(block).getByRole("button", { name: WO_REF })).toBeTruthy();
      expect(within(block).getByRole("button", { name: OTHER_REF })).toBeTruthy();
    });

    it("says it in French", async () => {
      await openVehicle(`/assets/${ASSET_ID}`, { role: "FINANCE", asset: blocked, locale: "fr-CM" });
      const block = await sentence();
      await waitFor(() =>
        expect(block.textContent).toContain(
          `La réparation (${WO_REF_FR}) est terminée, mais un autre problème critique est encore ouvert : « Steering locks on the left » (PB-0005). Il doit être clos avant la remise en service.`,
        ),
      );
      expect(block.textContent).not.toMatch(/en attente d'un responsable/);
    });
  });

  it("gives the manager's locked release its reason in French", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, { role: "ADMIN", asset: inRepair, locale: "fr-CM" });
    const block = within(await sentence());
    const release = block.getByRole("button", { name: "Remettre en service" }) as HTMLButtonElement;
    expect(release.disabled).toBe(true);
    expect(document.getElementById(release.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
      `Il faut d'abord que ${WO_REF_FR} soit terminé.`,
    );
  });

  it("speaks French, quoting the report", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, { role: "ADMIN", asset: inRepair, locale: "fr-CM" });
    const block = within(await sentence());
    expect(block.getByText(/« Brake pressure warning on the Kekem descent »/)).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Vue d'ensemble/ })).toBeTruthy();
  });

  it("says an expired document by its date, never as a legal verdict", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, {
      role: "ADMIN",
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

  it("shows not-found at once, without retrying the 404", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}`, {
      role: "DRIVER",
      assetStatus: 404,
      defaultRetries: true,
    });
    // Well inside the first retry's 1 s backoff.
    expect(
      await screen.findByText("This vehicle does not exist or is outside your branches.", {}, { timeout: 500 }),
    ).toBeTruthy();
    expect(requested(recorded, `/v1/assets/${ASSET_ID}`)).toHaveLength(1);
  });

  it("retries any other failure twice before offering a retry", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}`, { role: "DRIVER", assetStatus: 500 });
    expect((await screen.findByRole("alert")).textContent).toContain("We couldn't load this asset.");
    expect(requested(recorded, `/v1/assets/${ASSET_ID}`)).toHaveLength(3);
  });

  it("says a vehicle outside the caller's branches is not found, and offers a retry on failure", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, { role: "DRIVER", assetStatus: 404 });
    expect(await screen.findByText("This vehicle does not exist or is outside your branches.")).toBeTruthy();
    cleanup();
    await openVehicle(`/assets/${ASSET_ID}`, { role: "DRIVER", assetStatus: 500 });
    expect((await screen.findByRole("alert")).textContent).toContain("We couldn't load this asset.");
  });
});

describe("header, phone bar and all-actions sheet, per role", () => {
  const header: Record<Role, string[]> = {
    DIRECTOR: ["Record expense", "More actions"],
    ADMIN: ["Record expense", "More actions"],
    FINANCE: ["Record expense", "More actions"],
    CASHIER: ["Record expense", "More actions"],
    TECHNICIAN: ["Report a problem", "More actions"],
    DRIVER: ["Log fuel", "Report a problem", "More actions"],
  };

  it.each(Object.entries(header) as Array<[Role, string[]]>)("%s header at 1280 px", async (role, labels) => {
    await openVehicle(`/assets/${ASSET_ID}`, { role });
    await screen.findByText("Available.");
    for (const label of labels) expect(screen.getByRole("button", { name: label }), label).toBeTruthy();
    const others = ["Log fuel", "Report a problem", "Record expense"].filter((label) => !labels.includes(label));
    for (const label of others) expect(screen.queryByRole("button", { name: label }), label).toBeNull();
  });

  const bar: Record<Role, string[]> = {
    DIRECTOR: ["Expense", "Problem", "Trip", "More"],
    ADMIN: ["Expense", "Problem", "Trip", "More"],
    FINANCE: ["Expense", "Cancel entry", "More"],
    CASHIER: ["Expense", "Revenue", "Note", "More"],
    TECHNICIAN: ["Work order", "Problem", "Note", "More"],
    DRIVER: ["Fuel", "Problem", "Odometer", "More"],
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

  it("lists Finance's own area first, locks what waits, and searches", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, { role: "FINANCE" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "More actions" }));
    const sheet = await screen.findByRole("dialog", { name: "All actions" });
    const groups = within(sheet).getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(groups[0]).toBe("Money");
    const review = within(sheet).getByRole("button", { name: /Review entry/ });
    expect((review as HTMLButtonElement).disabled).toBe(true);
    expect(review.textContent).toContain("Nothing waiting for review.");
    await user.type(within(sheet).getByRole("textbox", { name: "Search actions" }), "commission");
    await waitFor(() => expect(within(sheet).queryByRole("button", { name: /Review entry/ })).toBeNull());
    expect(within(sheet).getByText(/No action matches/)).toBeTruthy();
  });

  it("shows the workshop only what it may take", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, { role: "TECHNICIAN" });
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "More actions" }));
    const sheet = await screen.findByRole("dialog", { name: "All actions" });
    expect(within(sheet).getAllByRole("heading", { level: 3 })[0]?.textContent).toBe("Maintenance");
    expect(within(sheet).queryByRole("button", { name: /Record expense/ })).toBeNull();
    expect(within(sheet).queryByRole("button", { name: /Release to service/ })).toBeNull();
    expect(within(sheet).getByRole("button", { name: /Record odometer/ })).toBeTruthy();
  });
});

// #92: after the repair, an amber middle state until a manager releases the vehicle.
describe("grounded → repaired, waiting for release → available", () => {
  const ready = attention("ASSET_AWAITING_RELEASE", { severity: "CRITICAL", partOfGrounding: true });
  const done = asset({ availability: grounded([groundingWorkOrder("COMPLETED")]) });
  const block = async (lead: RegExp) => (await screen.findByText(lead)).closest("[role=status]") as HTMLElement;
  const REPAIRED = /^Repair done — waiting for release to service\.$/;

  it("is red while the repair is open", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, {
      role: "ADMIN",
      asset: inRepair,
      attention: [attention("WORK_ORDER_IN_PROGRESS", { partOfGrounding: true })],
    });
    expect((await sentence()).dataset.tone).toBe("critical");
    expect(screen.queryByText(REPAIRED)).toBeNull();
  });

  it("turns amber once the repair is completed, and offers the release to who may release", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, { role: "ADMIN", asset: done, attention: [ready] });
    const status = await block(REPAIRED);
    expect(status.dataset.tone).toBe("waiting");
    expect(status.textContent).toContain(`The repair (${WO_REF}) is completed; waiting on a manager to release it.`);
    const release = within(status).getByRole("button", { name: "Release to service" }) as HTMLButtonElement;
    expect(release.disabled).toBe(false);
  });

  it("tells other roles who releases it, without the button", async () => {
    for (const role of ["TECHNICIAN", "FINANCE", "DRIVER"] as const) {
      await openVehicle(`/assets/${ASSET_ID}`, { role, asset: done, attention: [ready] });
      const status = await block(REPAIRED);
      expect(status.dataset.tone, role).toBe("waiting");
      expect(status.textContent, role).toContain("waiting on a manager to release it");
      expect(within(status).queryByRole("button", { name: "Release to service" }), role).toBeNull();
      cleanup();
      await closeVehicle();
    }
  });

  it("keeps the release locked for whoever completed the repair", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, {
      role: "ADMIN",
      asset: asset({
        availability: grounded([groundingWorkOrder("COMPLETED", { completedBy: actor(ME_ID, "Boris") })]),
      }),
      attention: [ready],
    });
    const status = await block(REPAIRED);
    expect(status.dataset.tone).toBe("waiting");
    expect((within(status).getByRole("button", { name: "Release to service" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(status).getByText(/You vouched for the repair of a safety-critical problem/)).toBeTruthy();
  });

  it("stays red while another safety-critical problem is open", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, {
      role: "ADMIN",
      asset: done,
      attention: [attention("ISSUE_UNPLANNED", { severity: "CRITICAL", params: { safetyCritical: true } })],
    });
    expect((await sentence()).dataset.tone).toBe("critical");
    expect(screen.queryByText(REPAIRED)).toBeNull();
  });

  it("is green once released", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, { role: "ADMIN" });
    expect((await block(/^Available\.$/)).dataset.tone).toBe("success");
  });

  it("says it in French", async () => {
    await openVehicle(`/assets/${ASSET_ID}`, { role: "ADMIN", asset: done, attention: [ready], locale: "fr-CM" });
    const status = await block(/^Réparation terminée — en attente de remise en service\.$/);
    expect(status.dataset.tone).toBe("waiting");
    expect(status.textContent).toContain("en attente d'un responsable pour la remise en service");
  });
});
