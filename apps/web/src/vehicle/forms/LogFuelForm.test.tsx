// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  recordExpensePayload,
  recordMeterReadingPayload,
  type CommandWarningCode,
} from "@routiq/contracts";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { sessionStore } from "../../auth/store.js";
import type { CommandClient, SubmitResult } from "../../commands/client.js";
import { i18n } from "../../i18n/index.js";
import { LogFuelForm } from "./LogFuelForm.js";

const mocks = vi.hoisted(() => ({ toastAdd: vi.fn() }));

vi.mock("@/components/ui/toast.js", () => ({ toast: { add: mocks.toastAdd } }));

const ASSET_ID = "00000000-0000-4000-8000-000000000004";
const sessionIdentity = { username: "moussa", workspaceSlug: "sotrafret" };

type Seen = { name: string; payload: unknown; envelope: { expectedVersion?: number } };

/** Answers each command from its own queue, in the order the form sends them. */
function scriptedClient(
  script: Record<string, SubmitResult[]>,
): CommandClient & { seen: Seen[] } {
  const seen: Seen[] = [];
  return {
    seen,
    submit: async (submission) => {
      seen.push(submission as Seen);
      const next = script[submission.name]?.shift();
      if (next === undefined) throw new Error(`unscripted ${submission.name}`);
      return next;
    },
  };
}

function committed(
  recordStatus?: "POSTED" | "SUBMITTED",
  warnings: CommandWarningCode[] = [],
): SubmitResult {
  return {
    ok: true,
    outcome: {
      commandId: crypto.randomUUID(),
      recordId: crypto.randomUUID(),
      rowVersion: 1,
      warnings,
      idempotentReplay: false,
      ...(recordStatus === undefined ? {} : { recordStatus }),
    },
  };
}

function renderForm(client: CommandClient, handlers = { onDone: vi.fn(), onDismiss: vi.fn() }) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Sheet open>
        <SheetContent>
          <LogFuelForm
            surface="panel"
            assetId={ASSET_ID}
            assetLabel="DLA-T-001 · Mercedes Actros"
            branchCode="DLA"
            lastReading={{ readingType: "ODOMETER", value: 412_000 }}
            back={{ label: "DLA-T-001", onBack: vi.fn() }}
            client={client}
            {...handlers}
          />
        </SheetContent>
      </Sheet>
    </QueryClientProvider>,
  );
  return handlers;
}

async function fill({ amount, odometer }: { amount: string; odometer?: string }) {
  await userEvent.type(screen.getByLabelText("Amount paid (XAF)"), amount);
  fireEvent.change(screen.getByLabelText("Date and time"), {
    target: { value: "2026-09-25T07:40" },
  });
  if (odometer !== undefined) {
    fireEvent.change(screen.getByLabelText("Odometer in km (optional)"), {
      target: { value: odometer },
    });
  }
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

beforeEach(() => {
  vi.clearAllMocks();
  sessionStore.save({
    ...sessionIdentity,
    token: "token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
});

afterEach(() => {
  sessionStore.logout(sessionIdentity);
  cleanup();
});

describe("LogFuelForm", () => {
  it("records the FUEL expense, then the odometer, as two commands in that order", async () => {
    const client = scriptedClient({
      "record-expense": [committed("POSTED")],
      "record-meter-reading": [committed()],
    });
    const { onDone, onDismiss } = renderForm(client);

    const panel = screen.getByRole("dialog", { name: "Log fuel" });
    expect(within(panel).getByText("DLA-T-001 · Mercedes Actros")).toBeTruthy();
    expect(within(panel).getByText("Last reading: 412,000 km")).toBeTruthy();

    await fill({ amount: "45000", odometer: "412850" });
    await userEvent.click(screen.getByRole("button", { name: "Save fuel" }));

    await waitFor(() => expect(onDismiss).toHaveBeenCalledOnce());
    expect(client.seen.map((submission) => submission.name)).toEqual([
      "record-expense",
      "record-meter-reading",
    ]);

    const expense = recordExpensePayload.parse(client.seen[0]!.payload);
    expect(expense.categoryCode).toBe("FUEL");
    expect(expense.branchCode).toBe("DLA");
    expect(expense.economicDate).toBe("2026-09-25");
    // XAF has exponent 0: 45 000 typed is 45 000 minor units.
    expect(expense.amountMinor).toBe(45_000);
    expect(expense.postings).toEqual([
      { assetId: ASSET_ID, amountMinor: 45_000, assetAttribution: "DIRECT" },
    ]);

    const reading = recordMeterReadingPayload.parse(client.seen[1]!.payload);
    expect(reading.assetId).toBe(ASSET_ID);
    expect(reading.readingType).toBe("ODOMETER");
    expect(reading.value).toBe(412_850);
    expect(reading.observedAt).toMatch(/^2026-09-25T07:40:00[+-]\d{2}:\d{2}$/);
    expect("activityId" in (client.seen[1]!.payload as object)).toBe(false);

    // One fill-up, one toast.
    expect(mocks.toastAdd).toHaveBeenCalledOnce();
    expect(mocks.toastAdd).toHaveBeenCalledWith({
      type: "success",
      title: "Expense recorded",
      description: "Odometer reading saved",
    });
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("sends the expense alone when no odometer was read", async () => {
    const client = scriptedClient({ "record-expense": [committed("SUBMITTED")] });
    const { onDismiss } = renderForm(client);

    await fill({ amount: "250000" });
    await userEvent.click(screen.getByRole("button", { name: "Save fuel" }));

    await waitFor(() => expect(onDismiss).toHaveBeenCalledOnce());
    expect(client.seen.map((submission) => submission.name)).toEqual(["record-expense"]);
    // Above the threshold it waits for an approver, and the toast says so.
    expect(mocks.toastAdd).toHaveBeenCalledWith({
      type: "success",
      title: "Expense sent for approval",
    });
  });

  it("keeps the expense when the reading is refused, says so, and retries only the reading", async () => {
    const client = scriptedClient({
      "record-expense": [committed("POSTED")],
      "record-meter-reading": [
        { ok: false, code: "VALIDATION_FAILED" },
        committed(undefined, ["METER_READING_DECREASED"]),
      ],
    });
    const { onDone, onDismiss } = renderForm(client);

    await fill({ amount: "45000", odometer: "41285" });
    await userEvent.click(screen.getByRole("button", { name: "Save fuel" }));

    await waitFor(() =>
      expect(
        screen.getByText(
          "The fuel expense is recorded. The odometer reading was not saved.",
        ),
      ).toBeTruthy(),
    );
    expect(screen.getByRole("alert")).toBeTruthy();
    // The expense stands: its fields are closed, and nothing was announced yet.
    expect((screen.getByLabelText("Amount paid (XAF)") as HTMLInputElement).disabled).toBe(
      true,
    );
    expect(onDismiss).not.toHaveBeenCalled();
    expect(mocks.toastAdd).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Odometer in km (optional)"), {
      target: { value: "412850" },
    });
    await userEvent.click(screen.getByRole("button", { name: "Record the reading" }));

    await waitFor(() => expect(onDismiss).toHaveBeenCalledOnce());
    // The retry replays the reading; the expense is never sent a second time.
    expect(client.seen.map((submission) => submission.name)).toEqual([
      "record-expense",
      "record-meter-reading",
      "record-meter-reading",
    ]);
    const retried = recordMeterReadingPayload.parse(client.seen[2]!.payload);
    expect(retried.value).toBe(412_850);
    expect(retried.readingId).toBe(
      recordMeterReadingPayload.parse(client.seen[1]!.payload).readingId,
    );
    expect(mocks.toastAdd).toHaveBeenCalledWith({
      type: "success",
      title: "Expense recorded",
      description: "The reading is lower than the previous one\nOdometer reading saved",
    });
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("lets the operator close after a refused reading, leaving the expense recorded", async () => {
    const client = scriptedClient({
      "record-expense": [committed("POSTED")],
      "record-meter-reading": [{ ok: false, code: "ASSET_NOT_OPERATIONAL" }],
    });
    const { onDone, onDismiss } = renderForm(client);

    await fill({ amount: "45000", odometer: "412850" });
    await userEvent.click(screen.getByRole("button", { name: "Save fuel" }));
    await screen.findByText(
      "The fuel expense is recorded. The odometer reading was not saved.",
    );

    const close = screen
      .getAllByRole("button", { name: "Close" })
      .find((button) => button.getAttribute("data-slot") !== "sheet-close");
    await userEvent.click(close!);

    expect(onDismiss).toHaveBeenCalledOnce();
    // The host still refreshes: a recorded expense is there to show.
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("sends no reading when the expense itself is refused", async () => {
    const client = scriptedClient({
      "record-expense": [{ ok: false, code: "PERIOD_LOCKED" }],
    });
    const { onDismiss } = renderForm(client);

    await fill({ amount: "45000", odometer: "412850" });
    await userEvent.click(screen.getByRole("button", { name: "Save fuel" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(client.seen.map((submission) => submission.name)).toEqual(["record-expense"]);
    expect(screen.getByRole("button", { name: "Save fuel" })).toBeTruthy();
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
