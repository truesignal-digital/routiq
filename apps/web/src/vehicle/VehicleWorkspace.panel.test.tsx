// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import {
  ASSET_ID,
  ISSUE_ID,
  WORK_ORDER_ID,
  asset,
  grounded,
  groundingWorkOrder,
  issueDetail,
  workOrderDetail,
  workOrderRow,
} from "./test/fixtures.js";
import { closeVehicle, openVehicle, requested } from "./test/harness.js";
import { openSelect } from "../test-select.js";

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
  role: "MAINTENANCE" as const,
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
  const form = await screen.findByRole("dialog", { name: "Declare the work complete" });
  // One overlay: the form replaced the record's page, it did not stack a second dialog.
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  // The way back returns to the record, with nothing sent.
  await user.click(within(form).getByRole("button", { name: `Back to Work order ${WO_REF}` }));
  await screen.findByRole("dialog", { name: /Brake repair/ });
  expect(recorded.commands).toEqual([]);

  await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Complete work" }));
  const again = await screen.findByRole("dialog", { name: "Declare the work complete" });
  await user.type(within(again).getByLabelText("Work summary"), "Pads and air valve replaced");
  await user.click(within(again).getByRole("button", { name: "Declare complete" }));

  await waitFor(() => expect(recorded.commands).toHaveLength(1));
  const [command] = recorded.commands;
  expect(command?.name).toBe("complete-work-order");
  expect(command?.body.payload).toMatchObject({ workOrderId: WORK_ORDER_ID, summary: "Pads and air valve replaced" });
  expect(command?.body.envelope["expectedVersion"]).toBe(3);
  // Back on the record, re-read from the server.
  await screen.findByRole("dialog", { name: /Brake repair/ });
  await waitFor(() => expect(detailReads()).toBeGreaterThan(before));
});

it("shows a refusal in place and keeps the form", async () => {
  await openVehicle(`/assets/${ASSET_ID}?panel=work_order:${WORK_ORDER_ID}`, {
    ...scenario,
    command: () => ({ status: 409, body: { error: { code: "INVALID_STATE_TRANSITION" } } }),
  });
  const user = userEvent.setup();
  const panel = await screen.findByRole("dialog", { name: /Brake repair/ });
  await user.click(within(panel).getByRole("button", { name: "Cancel work order" }));
  const form = await screen.findByRole("dialog", { name: "Cancel the work order" });
  await user.type(within(form).getByLabelText("Reason"), "Truck sold as is");
  await user.click(within(form).getByRole("button", { name: "Cancel the work order" }));
  expect(await within(form).findByText("This action is not possible in the record's current state.")).toBeTruthy();
  expect(screen.getByRole("dialog", { name: "Cancel the work order" })).toBeTruthy();
});

it("adds a note on the vehicle from the all-actions sheet", async () => {
  const recorded = await openVehicle(`/assets/${ASSET_ID}`, { role: "OPS_MANAGER" });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "More actions" }));
  await user.click(within(await screen.findByRole("dialog", { name: "All actions" })).getByRole("button", { name: /Add note/ }));
  const form = await screen.findByRole("dialog", { name: "Add a note" });
  await user.type(within(form).getByLabelText("Note"), "Spare wheel missing at handover");
  await user.click(within(form).getByRole("button", { name: "Add note" }));
  await waitFor(() => expect(recorded.commands).toHaveLength(1));
  expect(recorded.commands[0]?.name).toBe("add-note");
  expect(recorded.commands[0]?.body.payload).toMatchObject({
    entityType: "asset",
    entityId: ASSET_ID,
    body: "Spare wheel missing at handover",
  });
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add a note" })).toBeNull());
});

it("reports a problem with the category's code and its safety default", async () => {
  const recorded = await openVehicle(`/assets/${ASSET_ID}`, { role: "FIELD_SUBMITTER" });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "Report a problem" }));
  const form = await screen.findByRole("dialog", { name: "New issue" });
  await user.type(within(form).getByLabelText("Description"), "Brakes pull to the left");
  await openSelect(user, within(form).getByLabelText("Category"));
  await user.keyboard("{ArrowDown}{Enter}");
  // Picking "Brakes" pre-ticked the box: the category's default is safety-critical.
  await waitFor(() =>
    expect(form.querySelector('[role="checkbox"][aria-label="Safety-critical"]')?.getAttribute("aria-checked")).toBe("true"),
  );
  await user.click(within(form).getByRole("button", { name: "Report issue" }));
  await waitFor(() => expect(recorded.commands).toHaveLength(1));
  expect(recorded.commands[0]?.body.payload).toMatchObject({
    assetId: ASSET_ID,
    category: "BRAKES",
    safetyCritical: true,
  });
});

it("changes the custodian through the member picker, and can clear it", async () => {
  const recorded = await openVehicle(`/assets/${ASSET_ID}`, { role: "OPS_MANAGER" });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "More actions" }));
  await user.click(within(await screen.findByRole("dialog", { name: "All actions" })).getByRole("button", { name: /Change custodian/ }));
  const form = await screen.findByRole("dialog", { name: "Change custodian" });
  expect(within(form).getByText("Current: Sali.")).toBeTruthy();
  expect(within(form).queryByLabelText("Assign to branch")).toBeNull();
  await openSelect(user, within(form).getByLabelText("New custodian"));
  await user.click(await screen.findByRole("option", { name: "Nobody (clear the custodian)" }));
  await user.click(within(form).getByRole("button", { name: "Confirm" }));
  await waitFor(() => expect(recorded.commands).toHaveLength(1));
  expect(recorded.commands[0]?.name).toBe("assign-asset");
  expect(recorded.commands[0]?.body.payload).toEqual({ assetId: ASSET_ID, custodianMembershipId: null });
});
