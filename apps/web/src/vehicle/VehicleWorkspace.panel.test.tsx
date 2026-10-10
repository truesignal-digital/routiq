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
  attention,
  entryDetail,
  grounded,
  groundingWorkOrder,
  issueDetail,
  NOTE_ID,
  noteDetail,
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

it.each([
  ["work order", `panel=work_order:${WORK_ORDER_ID}`, /Brake repair/],
  ["problem", `panel=issue:${ISSUE_ID}`, /Kekem/],
] as const)("offers the same History button on the %s panel (#308)", async (_kind, panelParam, name) => {
  await openVehicle(`/assets/${ASSET_ID}/maintenance?${panelParam}`, scenario);
  const panel = await screen.findByRole("dialog", { name });
  expect(within(panel).getByRole("button", { name: "History" })).toBeTruthy();
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

describe("the invoice that arrives after the close (#82)", () => {
  const closedPending = {
    ...scenario,
    asset: asset({ availability: { state: "AVAILABLE", since: null } }),
    workOrders: [workOrderRow("COMPLETED")],
    workOrderDetails: [
      workOrderDetail("COMPLETED", {
        completedAt: "2026-09-30T10:00:00.000Z",
        actualCostMinor: 0,
        costOutcome: "INVOICE_PENDING",
        costToCome: { reason: "INVOICE_PENDING", awaitingApproval: false },
      }),
    ],
  };

  it("says the cost is still to come, and adds the invoice with a required reason", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}?panel=work_order:${WORK_ORDER_ID}`, closedPending);
    const user = userEvent.setup();
    const panel = await screen.findByRole("dialog", { name: /Brake repair/ });
    expect(
      within(panel).getByText("Cost to come: the work was closed before the invoice arrived."),
    ).toBeTruthy();

    await user.click(within(panel).getByRole("button", { name: "Record expense" }));
    const form = await screen.findByRole("dialog", { name: "Record expense" });
    expect(
      within(form).getByText("This work is completed: the invoice goes to approval, whatever its amount."),
    ).toBeTruthy();
    await openSelect(user, within(form).getByLabelText("Category"));
    await user.click(await screen.findByRole("option", { name: "Repairs" }));
    await user.type(within(form).getByLabelText("Amount (FCFA)"), "62000");
    const submit = within(form).getByRole("button", { name: "Record the expense" });
    // No reason, no invoice: the server would refuse it (LATE_COST_REASON_REQUIRED).
    expect(submit.hasAttribute("disabled")).toBe(true);
    await user.type(within(form).getByLabelText("Reason"), "Invoice received after the close");
    await user.click(submit);

    await waitFor(() => expect(recorded.commands).toHaveLength(1));
    expect(recorded.commands[0]?.name).toBe("record-expense");
    expect(recorded.commands[0]?.body.payload).toMatchObject({
      amountMinor: 62_000,
      categoryCode: "REPAIRS",
      description: "Invoice received after the close",
      postings: [{ assetId: ASSET_ID, workOrderId: WORK_ORDER_ID, amountMinor: 62_000 }],
    });
  });

  it("says when the invoice is in and waits for approval, and what a v1 close declared", async () => {
    await openVehicle(`/assets/${ASSET_ID}?panel=work_order:${WORK_ORDER_ID}`, {
      ...closedPending,
      workOrderDetails: [
        workOrderDetail("COMPLETED", {
          completedAt: "2026-09-30T10:00:00.000Z",
          actualCostMinor: 0,
          declaredCostMinor: 50_000,
          costToCome: {
            reason: "DECLARED_NOT_RECORDED",
            declaredCostMinor: 50_000,
            recordedCostMinor: 0,
            awaitingApproval: false,
          },
        }),
      ],
    });
    const panel = await screen.findByRole("dialog", { name: /Brake repair/ });
    expect(within(panel).getByText(/^Cost to come: declared FCFA\s50,000, recorded FCFA\s0\.$/)).toBeTruthy();
  });

  it("gives Finance no cost to add on it (#414)", async () => {
    await openVehicle(`/assets/${ASSET_ID}?panel=work_order:${WORK_ORDER_ID}`, {
      ...closedPending,
      role: "FINANCE",
    });
    const panel = await screen.findByRole("dialog", { name: /Brake repair/ });
    expect(within(panel).getByText(/^Cost to come/)).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: "Record expense" })).toBeNull();
  });
});

it("gives a driver the work order without its money: no cost facts, no cost lines (#390)", async () => {
  await openVehicle(`/assets/${ASSET_ID}?panel=work_order:${WORK_ORDER_ID}`, {
    ...scenario,
    role: "DRIVER",
    workOrders: [workOrderRow("APPROVED", { expectedCostMinor: null })],
    workOrderDetails: [
      workOrderDetail("APPROVED", { expectedCostMinor: null, costLines: null, pendingCostLines: null }),
    ],
  });
  const panel = await screen.findByRole("dialog", { name: /Brake repair/ });
  // Withheld is not "not recorded": the cost facts are left out (#306).
  expect(within(panel).queryByText("Expected cost")).toBeNull();
  expect(within(panel).queryByText("Actual cost")).toBeNull();
  expect(within(panel).queryByText("No estimate")).toBeNull();
  expect(within(panel).queryByText("Costs")).toBeNull();
  expect(within(panel).queryByText("No costs posted against this work order.")).toBeNull();
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

describe("the grounding note's tone agrees with the vehicle header (#500)", () => {
  const completed = {
    ...scenario,
    role: "ADMIN" as const,
    asset: asset({ availability: grounded([groundingWorkOrder("COMPLETED")]) }),
    workOrders: [workOrderRow("COMPLETED")],
    workOrderDetails: [workOrderDetail("COMPLETED", { completedAt: "2026-09-30T10:00:00.000Z" })],
  };
  const tones = async () => {
    const panel = await screen.findByRole("dialog", { name: /Brake repair/ });
    const note = within(panel).getByText(/^The work is done, but the vehicle stays grounded/).closest("[data-tone]");
    // The open panel hides the page from the accessibility tree; the header is still on screen.
    const header = screen.getAllByRole("status", { hidden: true }).find((el) => el.hasAttribute("data-tone"));
    return { note: note?.getAttribute("data-tone"), header: header?.getAttribute("data-tone") };
  };

  it("is amber, like the header, once the repair is done and only the release is left", async () => {
    await openVehicle(`/assets/${ASSET_ID}?panel=work_order:${WORK_ORDER_ID}`, {
      ...completed,
      attention: [attention("ASSET_AWAITING_RELEASE", { severity: "CRITICAL", partOfGrounding: true })],
    });
    await waitFor(async () => expect(await tones()).toEqual({ note: "warning", header: "waiting" }));
  });

  it("stays red, like the header, while the server withholds the release", async () => {
    await openVehicle(`/assets/${ASSET_ID}?panel=work_order:${WORK_ORDER_ID}`, completed);
    await waitFor(async () => expect(await tones()).toEqual({ note: "danger", header: "critical" }));
  });
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

it("changes the assigned driver through the member picker, and can clear it", async () => {
  const recorded = await openVehicle(`/assets/${ASSET_ID}`, { role: "ADMIN" });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "More actions" }));
  await user.click(within(await screen.findByRole("dialog", { name: "All actions" })).getByRole("button", { name: /Change assigned driver/ }));
  const form = await screen.findByRole("dialog", { name: "Change assigned driver" });
  expect(within(form).getByText("Current: Sali.")).toBeTruthy();
  expect(within(form).queryByLabelText("Assign to branch")).toBeNull();
  await openSelect(user, within(form).getByLabelText("New assigned driver"));
  await user.click(await screen.findByRole("option", { name: "Nobody (clear the assigned driver)" }));
  await user.click(within(form).getByRole("button", { name: "Change assigned driver" }));
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

it.each([
  ["FINANCE_APPROVES", "Waiting on Finance to review it."],
  ["FINANCE_PEER_APPROVES", "Waiting on another Finance member or the Director to review it."],
  ["DIRECTION_APPROVES", "Waiting on the Director to review it."],
] as const)("says who reviews a waiting entry on its record (#542, %s)", async (approver, sentence) => {
  await openVehicle(`/assets/${ASSET_ID}/money?panel=entry:${ENTRY_ID}`, {
    role: "ADMIN",
    entryDetails: [entryDetail({ approver, evidence: { state: "PAYMENT_REFERENCE", artifactCount: 0 } })],
  });
  const panel = await screen.findByRole("dialog", { name: /Repairs/ });
  expect(within(panel).getByText(new RegExp(`^${sentence}`))).toBeTruthy();
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
        note: null,
        noteCode: null,
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

describe("the safety-critical mark on a problem (#96)", () => {
  const notCritical = issueDetail({ safetyCritical: false, assetUnavailable: false, rowVersion: 2 });
  const available = asset();

  it("lets the driver mark a problem safety-critical, quoting its version", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}/maintenance?panel=issue:${ISSUE_ID}`, {
      role: "DRIVER",
      asset: available,
      issueDetails: [notCritical],
    });
    const user = userEvent.setup();
    const panel = await screen.findByRole("dialog", { name: /Kekem/ });
    expect(within(panel).queryByRole("button", { name: "Remove the safety-critical mark" })).toBeNull();

    await user.click(within(panel).getByRole("button", { name: "Mark as safety-critical" }));
    const form = await screen.findByRole("dialog", { name: "Mark as safety-critical" });
    expect(within(form).getByText(/grounded as soon as you save/)).toBeTruthy();
    await user.click(within(form).getByRole("button", { name: "Mark as safety-critical" }));

    await waitFor(() => expect(recorded.commands).toHaveLength(1));
    expect(recorded.commands[0]?.name).toBe("change-issue-severity");
    expect(recorded.commands[0]?.body.envelope["expectedVersion"]).toBe(2);
    expect(recorded.commands[0]?.body.payload).toEqual({ issueId: ISSUE_ID, safetyCritical: true });
  });

  it.each(["FINANCE", "CASHIER"] as const)("offers %s no change to the mark", async (role) => {
    await openVehicle(`/assets/${ASSET_ID}/maintenance?panel=issue:${ISSUE_ID}`, {
      role,
      asset: available,
      issueDetails: [notCritical],
    });
    const panel = await screen.findByRole("dialog", { name: /Kekem/ });
    expect(within(panel).queryByRole("button", { name: "Mark as safety-critical" })).toBeNull();
  });

  it("lets the Administrateur take the mark off with a reason, and not the driver", async () => {
    const critical = issueDetail({ rowVersion: 4 });
    const recorded = await openVehicle(`/assets/${ASSET_ID}/maintenance?panel=issue:${ISSUE_ID}`, {
      role: "ADMIN",
      issueDetails: [critical],
    });
    const user = userEvent.setup();
    const panel = await screen.findByRole("dialog", { name: /Kekem/ });
    expect(within(panel).queryByRole("button", { name: "Mark as safety-critical" })).toBeNull();
    await user.click(within(panel).getByRole("button", { name: "Remove the safety-critical mark" }));

    const form = await screen.findByRole("dialog", { name: "Remove the safety-critical mark" });
    expect(within(form).getByText(/stays grounded/)).toBeTruthy();
    const submit = within(form).getByRole("button", { name: "Remove the mark" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await user.type(within(form).getByRole("textbox"), "Seen at the garage: mirror only");
    await user.click(submit);

    await waitFor(() => expect(recorded.commands).toHaveLength(1));
    expect(recorded.commands[0]?.body.envelope["expectedVersion"]).toBe(4);
    expect(recorded.commands[0]?.body.payload).toEqual({
      issueId: ISSUE_ID,
      safetyCritical: false,
      reason: "Seen at the garage: mirror only",
    });

    cleanup();
    await closeVehicle();
    await openVehicle(`/assets/${ASSET_ID}/maintenance?panel=issue:${ISSUE_ID}`, {
      role: "DRIVER",
      issueDetails: [critical],
    });
    const driverPanel = await screen.findByRole("dialog", { name: /Kekem/ });
    expect(within(driverPanel).queryByRole("button", { name: "Remove the safety-critical mark" })).toBeNull();
  });
});

describe("Cancel entry from the vehicle panel (#426)", () => {
  const posted = () =>
    entryDetail({
      status: "POSTED",
      evidence: { state: "SUPPLIED", artifactCount: 1 },
      rowVersion: 2,
    });

  // The fixture entry is a work-order cost: Direction books those, so it records it again (#559).
  it("cancels for wrong details, then records again pre-filled through record-expense", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}/money?panel=entry:${ENTRY_ID}`, {
      role: "DIRECTOR",
      entryDetails: [posted()],
    });
    const user = userEvent.setup();
    const panel = await screen.findByRole("dialog", { name: /Repairs/ });
    await user.click(within(panel).getByRole("button", { name: "Cancel entry" }));

    const form = await screen.findByRole("dialog", { name: "Cancel entry" });
    await user.click(within(form).getByRole("radio", { name: "Wrong details, to record again" }));
    await user.click(within(form).getByRole("button", { name: "Cancel entry" }));

    await waitFor(() => expect(recorded.commands).toHaveLength(1));
    expect(recorded.commands[0]?.name).toBe("reverse-entry");
    expect(recorded.commands[0]?.body.version).toBe(2);
    expect(recorded.commands[0]?.body.payload).toEqual({
      reversalEntryId: expect.any(String),
      originalEntryId: ENTRY_ID,
      reasonCode: "WRONG_DETAILS",
    });

    await user.click(await screen.findByRole("button", { name: "Record again" }));
    const again = await screen.findByRole("dialog", { name: "Record expense" });
    const amount = within(again).getByLabelText("Amount (FCFA)") as HTMLInputElement;
    expect(amount.value).toMatch(/^310\s?000$/);
    await user.clear(amount);
    await user.type(amount, "300000");
    await user.click(within(again).getByRole("button", { name: "Record the expense" }));

    await waitFor(() => expect(recorded.commands).toHaveLength(2));
    expect(recorded.commands[1]?.name).toBe("record-expense");
    expect(recorded.commands[1]?.body.payload).toMatchObject({ amountMinor: 300_000 });
    expect(recorded.commands[1]?.body.payload).not.toMatchObject({ entryId: ENTRY_ID });
  });

  it("hands a work-order cost Finance cancelled for wrong details to the work order, never offering Record again (#559)", async () => {
    const recorded = await openVehicle(`/assets/${ASSET_ID}/money?panel=entry:${ENTRY_ID}`, {
      role: "FINANCE",
      entryDetails: [posted()],
      workOrders: [workOrderRow("COMPLETED")],
      workOrderDetails: [workOrderDetail("COMPLETED")],
    });
    const user = userEvent.setup();
    const panel = await screen.findByRole("dialog", { name: /Repairs/ });
    await user.click(within(panel).getByRole("button", { name: "Cancel entry" }));

    const form = await screen.findByRole("dialog", { name: "Cancel entry" });
    await user.click(within(form).getByRole("radio", { name: "Wrong details, to record again" }));
    // Said before the cancellation, not discovered after it.
    expect(within(form).getByText(/Only Direction, the Administrator or a technician books work-order costs/)).toBeTruthy();
    await user.click(within(form).getByRole("button", { name: "Cancel entry" }));

    await waitFor(() => expect(recorded.commands).toHaveLength(1));
    expect(recorded.commands[0]?.name).toBe("reverse-entry");
    const done = await screen.findByText(/Ask Direction, the Administrator or the work order's technician/);
    expect(screen.queryByRole("button", { name: "Record again" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Open the work order" }));
    await screen.findByRole("dialog", { name: /Brake repair/ });
    expect(decodeURIComponent(recorded.history.location.search)).toContain(`panel=work_order:${WORK_ORDER_ID}`);
    expect(done.isConnected).toBe(false);
    // Nothing else was sent: no record-expense the server would refuse.
    expect(recorded.commands).toHaveLength(1);
  });

  it("shows a cancelled entry's reason in words", async () => {
    await openVehicle(`/assets/${ASSET_ID}/money?panel=entry:${ENTRY_ID}`, {
      role: "FINANCE",
      entryDetails: [
        entryDetail({
          status: "REVERSED",
          cancellation: { reasonCode: "OTHER", reasonText: "Carte carburant remboursée" },
        }),
      ],
    });
    const panel = await screen.findByRole("dialog", { name: /Repairs/ });
    expect(within(panel).getByText("Carte carburant remboursée")).toBeTruthy();
    expect(within(panel).getByText("Cancelled")).toBeTruthy();
  });
});

describe("a note from Direction on its record (#98)", () => {
  const path = `/assets/${ASSET_ID}/history?panel=note:${NOTE_ID}`;

  it("offers Mark as seen to anyone but its author", async () => {
    const recorded = await openVehicle(path, { role: "TECHNICIAN", notes: [noteDetail()] });
    const user = userEvent.setup();
    const panel = await screen.findByRole("dialog", { name: "Note by Émilienne" });
    expect(within(panel).getByText("Note from Direction")).toBeTruthy();
    expect(within(panel).getByText(/Nobody has marked it as seen yet/)).toBeTruthy();
    await user.click(within(panel).getByRole("button", { name: "Mark as seen" }));
    const form = await screen.findByRole("dialog", { name: "Mark as seen" });
    await user.click(within(form).getByRole("button", { name: "Mark as seen" }));
    await waitFor(() => expect(recorded.commands).toHaveLength(1));
    expect(recorded.commands[0]?.body.payload).toEqual({ noteId: NOTE_ID });
  });

  it("offers nothing to its author", async () => {
    await openVehicle(path, { role: "DIRECTOR", notes: [noteDetail({ author: actor(ME_ID, "Émilienne") })] });
    const panel = await screen.findByRole("dialog", { name: "Note by Émilienne" });
    expect(within(panel).queryByRole("button", { name: "Mark as seen" })).toBeNull();
  });

  it.each([
    ["en", "Seen by Boris on "],
    ["fr-CM", "Vu par Boris le "],
  ] as const)("says who saw it once acknowledged (%s)", async (locale, seen) => {
    await openVehicle(path, {
      role: "DRIVER",
      locale,
      notes: [noteDetail({ acknowledgement: { by: actor(OTHER_ID, "Boris"), at: "2026-09-24T09:00:00.000Z" } })],
    });
    const panel = await screen.findByRole("dialog", { name: /Émilienne/ });
    expect(within(panel).getByText((text) => text.startsWith(seen))).toBeTruthy();
    expect(within(panel).queryByRole("button", { name: /seen|vu/i })).toBeNull();
  });

  it("offers nothing on a note that is not Direction's", async () => {
    await openVehicle(path, { role: "DRIVER", notes: [noteDetail({ authorRole: "ADMIN" })] });
    const panel = await screen.findByRole("dialog", { name: "Note by Émilienne" });
    expect(within(panel).queryByText("Note from Direction")).toBeNull();
    expect(within(panel).queryByRole("button", { name: "Mark as seen" })).toBeNull();
  });
});
