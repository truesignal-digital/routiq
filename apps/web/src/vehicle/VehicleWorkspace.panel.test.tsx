// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ASSET_ID,
  ENTRY_ID,
  ISSUE_ID,
  ME_ID,
  OTHER_ID,
  WORK_ORDER_ID,
  actor,
  asset,
  entryDetail,
  grounded,
  groundingWorkOrder,
  issueDetail,
  workOrderDetail,
  workOrderRow,
} from "./test/fixtures.js";
import { closeVehicle, openVehicle, requested } from "./test/harness.js";
import { openSelect } from "../test-select.js";
import { formatDateTime } from "../lib/format.js";

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

vi.mock("../components/ui/file-upload.js", () => ({ FileUpload: () => null }));

afterEach(async () => {
  cleanup();
  await closeVehicle();
});

const WO_REF = WORK_ORDER_ID.slice(0, 8).toUpperCase();
const ISSUE_REF = ISSUE_ID.slice(0, 8).toUpperCase();

const scenario = {
  role: "TECHNICIAN" as const,
  asset: asset({ availability: grounded([groundingWorkOrder("APPROVED")]) }),
  workOrders: [workOrderRow("APPROVED")],
  workOrderDetails: [workOrderDetail("APPROVED")],
  issueDetails: [issueDetail({ workOrders: [{ id: WORK_ORDER_ID, status: "APPROVED" }] })],
};

it("opens a record from the URL and keeps it across a reload", async () => {
  const path = `/assets/${ASSET_ID}/maintenance?panel=work_order:${WORK_ORDER_ID}`;
  await openVehicle(path, scenario);
  expect(await screen.findByRole("dialog", { name: "Brake repair: replace pads and air valve" })).toBeTruthy();
  cleanup();
  await openVehicle(path, scenario);
  expect(await screen.findByRole("dialog", { name: "Brake repair: replace pads and air valve" })).toBeTruthy();
});

it("follows a reference by pushing history, so Back returns to the record", async () => {
  const { history } = await openVehicle(`/assets/${ASSET_ID}?panel=work_order:${WORK_ORDER_ID}`, scenario);
  const user = userEvent.setup();
  const panel = await screen.findByRole("dialog", { name: /Brake repair/ });
  await user.click(within(panel).getByRole("button", { name: `From problem ${ISSUE_REF}` }));
  await screen.findByRole("dialog", { name: "Brake pressure warning on the Kekem descent" });
  expect(decodeURIComponent(history.location.search)).toContain(`panel=issue:${ISSUE_ID}`);
  await user.click(screen.getByRole("button", { name: `Back to work order ${WO_REF}` }));
  await screen.findByRole("dialog", { name: /Brake repair/ });
  expect(decodeURIComponent(history.location.search)).toContain(`panel=work_order:${WORK_ORDER_ID}`);
  // Browser Back does the same.
  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: `From problem ${ISSUE_REF}` }));
  await screen.findByRole("dialog", { name: /Kekem/ });
  await act(async () => history.back());
  await screen.findByRole("dialog", { name: /Brake repair/ });
});

it("opens a step's form inside the panel, submits it pinned to the record, and closes on success", async () => {
  const recorded = await openVehicle(`/assets/${ASSET_ID}?panel=work_order:${WORK_ORDER_ID}`, scenario);
  const user = userEvent.setup();
  const panel = await screen.findByRole("dialog", { name: /Brake repair/ });
  const detailReads = () => requested(recorded, `/v1/work-orders/${WORK_ORDER_ID}`).length;
  const before = detailReads();

  await user.click(within(panel).getByRole("button", { name: "Complete work" }));
  const form = await screen.findByRole("dialog", { name: "Complete work" });
  // One overlay: the form replaced the record's page, it did not stack a second dialog.
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  // The way back returns to the record, with nothing sent.
  await user.click(within(form).getByRole("button", { name: `Back to Work order ${WO_REF}` }));
  await screen.findByRole("dialog", { name: /Brake repair/ });
  expect(recorded.commands).toEqual([]);

  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Complete work" }));
  const again = await screen.findByRole("dialog", { name: "Complete work" });
  await user.type(within(again).getByLabelText("Work summary"), "Pads and air valve replaced");
  // Closing says what the repair cost; with nothing typed and nothing picked it stays shut.
  expect(within(again).getByRole("button", { name: "Complete work" }).hasAttribute("disabled")).toBe(true);
  await user.type(within(again).getByLabelText("How much did the repair cost?"), "50000");
  await user.click(within(again).getByRole("button", { name: "Complete work" }));

  await waitFor(() => expect(recorded.commands).toHaveLength(1));
  const [command] = recorded.commands;
  expect(command?.name).toBe("complete-work-order");
  expect(command?.body.payload).toMatchObject({
    workOrderId: WORK_ORDER_ID,
    summary: "Pads and air valve replaced",
    costOutcome: "LINES",
    costLines: [{ categoryCode: "REPAIRS", amountMinor: 50_000 }],
  });
  expect(command?.body.envelope["expectedVersion"]).toBe(3);
  // Back on the record, re-read from the server.
  await screen.findByRole("dialog", { name: /Brake repair/ });
  await waitFor(() => expect(detailReads()).toBeGreaterThan(before));
});

it("reads a close with the invoice still to come as such, not as a zero cost", async () => {
  await openVehicle(`/assets/${ASSET_ID}?panel=work_order:${WORK_ORDER_ID}`, {
    ...scenario,
    asset: asset({ availability: grounded([groundingWorkOrder("COMPLETED")]) }),
    workOrders: [workOrderRow("COMPLETED")],
    workOrderDetails: [
      workOrderDetail("COMPLETED", {
        completedAt: "2026-09-30T10:00:00.000Z",
        actualCostMinor: 0,
        costOutcome: "INVOICE_PENDING",
      }),
    ],
  });
  const panel = await screen.findByRole("dialog", { name: /Brake repair/ });
  expect(within(panel).getByText("Invoice not received yet")).toBeTruthy();
});

it("says the grounding order still has work to do while it is open (#109)", async () => {
  await openVehicle(`/assets/${ASSET_ID}?panel=work_order:${WORK_ORDER_ID}`, scenario);
  const panel = await screen.findByRole("dialog", { name: /Brake repair/ });
  expect(
    within(panel).getByText(
      "This work order keeps the vehicle grounded. Once it is completed, a manager releases it to service.",
    ),
  ).toBeTruthy();
});

it("says a completed grounding order waits for a manager's release, not its own completion (#109)", async () => {
  await openVehicle(`/assets/${ASSET_ID}?panel=work_order:${WORK_ORDER_ID}`, {
    ...scenario,
    asset: asset({ availability: grounded([groundingWorkOrder("COMPLETED")]) }),
    workOrders: [workOrderRow("COMPLETED")],
    workOrderDetails: [workOrderDetail("COMPLETED", { completedAt: "2026-09-30T10:00:00.000Z" })],
  });
  const panel = await screen.findByRole("dialog", { name: /Brake repair/ });
  expect(
    within(panel).getByText(
      "The work is done, but the vehicle stays grounded until a manager releases it to service.",
    ),
  ).toBeTruthy();
  expect(within(panel).queryByText(/Once it is completed/)).toBeNull();
});

it("shows a refusal in place and keeps the form", async () => {
  await openVehicle(`/assets/${ASSET_ID}?panel=work_order:${WORK_ORDER_ID}`, {
    ...scenario,
    command: () => ({ status: 409, body: { error: { code: "INVALID_STATE_TRANSITION" } } }),
  });
  const user = userEvent.setup();
  const panel = await screen.findByRole("dialog", { name: /Brake repair/ });
  await user.click(within(panel).getByRole("button", { name: "Cancel work order" }));
  const form = await screen.findByRole("dialog", { name: "Cancel work order" });
  await user.type(within(form).getByRole("textbox", { name: "Reason" }), "Truck sold as is");
  await user.click(within(form).getByRole("button", { name: "Cancel work order" }));
  expect(await within(form).findByText("This action is not possible in the record's current state.")).toBeTruthy();
  expect(screen.getByRole("dialog", { name: "Cancel work order" })).toBeTruthy();
});

it("adds a note on the vehicle from the all-actions sheet", async () => {
  const recorded = await openVehicle(`/assets/${ASSET_ID}`, { role: "ADMIN" });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "More actions" }));
  await user.click(within(await screen.findByRole("dialog", { name: "All actions" })).getByRole("button", { name: /Add note/ }));
  const form = await screen.findByRole("dialog", { name: "Add note" });
  await user.type(within(form).getByLabelText("Note"), "Spare wheel missing at handover");
  await user.click(within(form).getByRole("button", { name: "Add the note" }));
  await waitFor(() => expect(recorded.commands).toHaveLength(1));
  expect(recorded.commands[0]?.name).toBe("add-note");
  expect(recorded.commands[0]?.body.payload).toMatchObject({
    entityType: "asset",
    entityId: ASSET_ID,
    body: "Spare wheel missing at handover",
  });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add note" })).toBeNull());
});

it("reports a problem with the category's code and its safety default", async () => {
  const recorded = await openVehicle(`/assets/${ASSET_ID}`, { role: "DRIVER" });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Report a problem" }));
  const form = await screen.findByRole("dialog", { name: "Report a problem" });
  await user.type(within(form).getByLabelText("Description"), "Brakes pull to the left");
  await openSelect(user, within(form).getByLabelText("Category"));
  await user.keyboard("{ArrowDown}{Enter}");
  // Picking "Brakes" pre-ticked the box: the category's default is safety-critical.
  await waitFor(() =>
    expect(form.querySelector('[role="checkbox"][aria-label="Safety-critical"]')?.getAttribute("aria-checked")).toBe("true"),
  );
  await user.click(within(form).getByRole("button", { name: "Report the problem" }));
  await waitFor(() => expect(recorded.commands).toHaveLength(1));
  expect(recorded.commands[0]?.body.payload).toMatchObject({
    assetId: ASSET_ID,
    category: "BRAKES",
    safetyCritical: true,
  });
});

it("changes the custodian through the member picker, and can clear it", async () => {
  const recorded = await openVehicle(`/assets/${ASSET_ID}`, { role: "ADMIN" });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "More actions" }));
  await user.click(within(await screen.findByRole("dialog", { name: "All actions" })).getByRole("button", { name: /Change custodian/ }));
  const form = await screen.findByRole("dialog", { name: "Change custodian" });
  expect(within(form).getByText("Current: Sali.")).toBeTruthy();
  expect(within(form).queryByLabelText("Assign to branch")).toBeNull();
  await openSelect(user, within(form).getByLabelText("New custodian"));
  await user.click(await screen.findByRole("option", { name: "Nobody (clear the custodian)" }));
  await user.click(within(form).getByRole("button", { name: "Change custodian" }));
  await waitFor(() => expect(recorded.commands).toHaveLength(1));
  expect(recorded.commands[0]?.name).toBe("assign-asset");
  expect(recorded.commands[0]?.body.payload).toEqual({ assetId: ASSET_ID, custodianMembershipId: null });
});

it("opens a receipt through the entry's own route, never the generic artifact route", async () => {
  const open = vi.fn();
  vi.stubGlobal("open", open);
  const artifactId = "00000000-0000-4000-8000-0000000000fa";
  const recorded = await openVehicle(`/assets/${ASSET_ID}/money?panel=entry:${ENTRY_ID}`, {
    role: "FINANCE",
    entryDetails: [
      entryDetail({
        evidence: { state: "SUPPLIED", artifactCount: 1 },
        evidenceFiles: [
          {
            artifactId,
            mimeType: "image/jpeg",
            sizeBytes: 120_000,
            originalFileName: "recu-garage.jpg",
            sha256: "0".repeat(64),
            attachedAt: "2026-09-23T11:40:00.000Z",
            attachedBy: actor(null, "Hervé"),
            via: "ATTACHED",
          },
        ],
      }),
    ],
  });
  const user = userEvent.setup();
  const panel = await screen.findByRole("dialog", { name: /Repairs/ });
  expect(within(panel).getByText("recu-garage.jpg")).toBeTruthy();
  await user.click(within(panel).getByRole("button", { name: "Open the file" }));
  const path = `/v1/finance/entries/${ENTRY_ID}/evidence/${artifactId}/download-url`;
  await waitFor(() => expect(open).toHaveBeenCalledWith(`https://files.test${path}`, "_blank", "noopener"));
  expect(recorded.requests.some(({ url }) => url.pathname.startsWith("/v1/artifacts"))).toBe(false);
});

it("opens an issue's photo through the issue's own route", async () => {
  const open = vi.fn();
  vi.stubGlobal("open", open);
  const recorded = await openVehicle(`/assets/${ASSET_ID}/maintenance?panel=issue:${ISSUE_ID}`, scenario);
  const user = userEvent.setup();
  const panel = await screen.findByRole("dialog", { name: /Kekem/ });
  expect(within(panel).getByText("voyant-frein.jpg")).toBeTruthy();
  await user.click(within(panel).getAllByRole("button", { name: "Open the file" })[0]!);
  const path = `/v1/issues/${ISSUE_ID}/artifacts/00000000-0000-4000-8000-0000000000e1/download-url`;
  await waitFor(() => expect(open).toHaveBeenCalledWith(`https://files.test${path}`, "_blank", "noopener"));
  expect(recorded.requests.some(({ url }) => url.pathname.startsWith("/v1/artifacts"))).toBe(false);
});

describe("a problem reported before it was recorded (#396)", () => {
  const backdated = issueDetail({
    reportedAt: "2026-09-21T08:20:00.000Z",
    chronologie: [
      {
        eventId: "00000000-0000-4000-8000-0000000000c3",
        kind: "operational_issue.reported",
        occurredAt: "2026-09-22T09:24:00.000Z",
        actor: actor(OTHER_ID, "Sali"),
      },
    ],
  });

  it.each([
    ["en", "Reported", "Recorded "],
    ["fr-CM", "Signalé", "Enregistré le "],
  ] as const)("labels the chronology time as when it was recorded (%s)", async (locale, reported, recorded) => {
    await openVehicle(`/assets/${ASSET_ID}/maintenance?panel=issue:${ISSUE_ID}`, {
      ...scenario,
      issueDetails: [backdated],
      locale,
    });
    const panel = await screen.findByRole("dialog", { name: /Kekem/ });
    const reportedAt = formatDateTime("2026-09-21T08:20:00.000Z", locale);
    const recordedAt = formatDateTime("2026-09-22T09:24:00.000Z", locale);
    expect(within(panel).getByText(reported).nextElementSibling?.textContent).toContain(reportedAt);
    const time = panel.querySelector('time[datetime="2026-09-22T09:24:00.000Z"]');
    expect(time?.textContent).toBe(`${recorded}${recordedAt}`);
  });
});

describe("the author's own pending entry (#85)", () => {
  const fuel = { code: "FUEL", labelFr: "Carburant", labelEn: "Fuel" };
  const mine = (overrides: Parameters<typeof entryDetail>[0] = {}) =>
    entryDetail({
      recordedBy: actor(ME_ID, "Amina"),
      category: { ...fuel, layer: "DIRECT" },
      amountMinor: 145_000,
      rowVersion: 3,
      postings: [
        {
          lineNo: 1,
          amountMinor: 145_000,
          assetId: ASSET_ID,
          assetCode: "VH003",
          assetAttribution: "DIRECT",
          activityId: null,
          workOrderId: WORK_ORDER_ID,
          category: fuel,
        },
      ],
      ...overrides,
    });

  it("offers Edit to the author and saves the pre-filled form with update-pending-entry", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}/history?panel=entry:${ENTRY_ID}`, {
      role: "DRIVER",
      entryDetails: [mine()],
    });
    const user = userEvent.setup();
    const panel = await screen.findByRole("dialog", { name: /Fuel/ });

    await user.click(within(panel).getByRole("button", { name: "Edit entry" }));

    const form = await screen.findByRole("dialog", { name: "Edit entry DLA-2026-00006" });
    const amount = within(form).getByLabelText("Amount (FCFA)") as HTMLInputElement;
    expect(amount.value).toMatch(/^145\s?000$/);
    await user.clear(amount);
    await user.type(amount, "54000");
    await user.click(within(form).getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(recorded.commands).toHaveLength(1));
    expect(recorded.commands[0]?.name).toBe("update-pending-entry");
    expect(recorded.commands[0]?.body.envelope["expectedVersion"]).toBe(3);
    expect(recorded.commands[0]?.body.payload).toMatchObject({
      entryId: ENTRY_ID,
      amountMinor: 54_000,
      postings: [{ assetId: ASSET_ID, workOrderId: WORK_ORDER_ID, amountMinor: 54_000 }],
    });
    expect(recorded.commands[0]?.body.payload).not.toHaveProperty("branchCode");
  });

  it("offers no Edit to anyone else, the Director included", async () => {
    await openVehicle(`/assets/${ASSET_ID}/money?panel=entry:${ENTRY_ID}`, {
      role: "DIRECTOR",
      entryDetails: [mine({ recordedBy: actor(OTHER_ID, "Hervé") })],
    });
    const panel = await screen.findByRole("dialog", { name: /Fuel/ });
    expect(within(panel).getByRole("button", { name: "Approve entry" })).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Edit entry" })).toBeNull();
  });

  it.each(["FINANCE", "DIRECTOR"] as const)("lets %s approve someone else's entry", async (role) => {
    await openVehicle(`/assets/${ASSET_ID}/money?panel=entry:${ENTRY_ID}`, {
      role,
      entryDetails: [mine({ recordedBy: actor(OTHER_ID, "Hervé") })],
    });
    const panel = await screen.findByRole("dialog", { name: /Fuel/ });
    expect(within(panel).getByRole("button", { name: "Approve entry" })).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Reject entry" })).toBeTruthy();
  });

  it("leaves the Administrateur no approval on an entry", async () => {
    await openVehicle(`/assets/${ASSET_ID}/money?panel=entry:${ENTRY_ID}`, {
      role: "ADMIN",
      entryDetails: [mine({ recordedBy: actor(OTHER_ID, "Hervé") })],
    });
    const panel = await screen.findByRole("dialog", { name: /Fuel/ });
    await within(panel).findByText(/Fuel/);
    expect(within(panel).queryByRole("button", { name: "Approve entry" })).toBeNull();
    expect(within(panel).queryByRole("button", { name: "Reject entry" })).toBeNull();
  });

  it("offers no Edit once the entry is decided", async () => {
    await openVehicle(`/assets/${ASSET_ID}/history?panel=entry:${ENTRY_ID}`, {
      role: "DRIVER",
      entryDetails: [mine({ status: "POSTED", postingPeriodCode: "2026-09" })],
    });
    const panel = await screen.findByRole("dialog", { name: /Fuel/ });
    expect(within(panel).queryByRole("button", { name: "Edit entry" })).toBeNull();
  });
});
