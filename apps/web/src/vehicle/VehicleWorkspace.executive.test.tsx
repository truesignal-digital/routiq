// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import {
  ASSET_ID,
  ENTRY_ID,
  WORK_ORDER_ID,
  asset,
  attention,
  entryDetail,
  entryRow,
  grounded,
  groundingWorkOrder,
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

const scenario = {
  role: "EXECUTIVE_VIEWER" as const,
  asset: asset({ availability: grounded([groundingWorkOrder("COMPLETION_SUBMITTED")]) }),
  attention: [attention("ENTRY_EVIDENCE_MISSING"), attention("DOCUMENT_EXPIRING", { params: { documentTypeLabelEn: "Insurance", documentTypeLabelFr: "Assurance", expiresAt: "2026-10-07", daysLeft: 12 } })],
  workOrders: [workOrderRow("COMPLETION_SUBMITTED")],
  workOrderDetails: [workOrderDetail("COMPLETION_SUBMITTED")],
  entries: [entryRow({ status: "POSTED", postingPeriodCode: "2026-09" })],
  entryDetails: [entryDetail({ status: "POSTED", postingPeriodCode: "2026-09" })],
};

/** Action labels that must never reach a read-only role, in any section. */
const ACTION_LABELS =
  /^(Log fuel|Record expense|Report a problem|Complete work|Sign off|Send back|Authorize|Refuse|Release to service|Reverse|Approve|Reject|Attach receipt|Renew|Add a cost|Create work order|Cancel work order|More actions|Start a trip|Add document)$/;

it.each([1280, 390])("an executive reads the whole vehicle without one action control (%i px)", async (width) => {
  const { requests } = await openVehicle(`/assets/${ASSET_ID}`, { ...scenario, width });
  const user = userEvent.setup();
  await screen.findByText(/Grounded for/);
  if (width >= 768) expect(screen.getByText("View only")).toBeTruthy();
  expect(screen.queryByRole("toolbar")).toBeNull();
  expect(screen.getByText("Needs attention")).toBeTruthy();

  for (const tab of ["Maintenance", "Money", "Trips", "Documents", "History", "Details"]) {
    await user.click(screen.getByRole("tab", { name: new RegExp(tab) }));
    await waitFor(() => expect(screen.getByRole("tab", { name: new RegExp(tab), selected: true })).toBeTruthy());
    expect(screen.queryAllByRole("button", { name: ACTION_LABELS }), tab).toEqual([]);
    // No row offers a "…" menu: there is nothing to do from one.
    expect(screen.queryAllByRole("button", { name: /^Actions for / }), tab).toEqual([]);
  }
  expect(requests.every(({ method }) => method === "GET")).toBe(true);
});

it("shows a panel footer that only says who the record waits on", async () => {
  await openVehicle(`/assets/${ASSET_ID}/maintenance?panel=work_order:${WORK_ORDER_ID}`, scenario);
  const panel = await screen.findByRole("dialog", { name: /Brake repair/ });
  expect(within(panel).getByText("Waiting on finance to sign off the work and its cost.")).toBeTruthy();
  expect(within(panel).queryAllByRole("button", { name: ACTION_LABELS })).toEqual([]);
});

it("offers no reversal on a posted entry reached by a deep link", async () => {
  const { requests } = await openVehicle(`/assets/${ASSET_ID}/money?panel=entry:${ENTRY_ID}`, scenario);
  const panel = await screen.findByRole("dialog", { name: /Repairs/ });
  expect(within(panel).getByText("DLA-2026-00006", { exact: false })).toBeTruthy();
  expect(within(panel).queryByRole("button", { name: "Reverse" })).toBeNull();
  expect(requests.every(({ method }) => method === "GET")).toBe(true);
});
