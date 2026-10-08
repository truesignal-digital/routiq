// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { recordMeterReadingPayload } from "@routiq/contracts";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { sessionStore } from "../auth/store.js";
import type { CommandClient, SubmitResult } from "../commands/client.js";
import { i18n } from "../i18n/index.js";
import { ReadingForm } from "./ReadingForm.js";

const mocks = vi.hoisted(() => ({ toastAdd: vi.fn(), useAssets: vi.fn() }));

vi.mock("@/components/ui/toast.js", () => ({ toast: { add: mocks.toastAdd } }));
vi.mock("../assets/useAssets.js", () => ({ useAssets: mocks.useAssets }));

const ASSET_ID = "00000000-0000-4000-8000-000000000004";
const sessionIdentity = { username: "amina", workspaceSlug: "sotrafret" };

function recordingClient(result: SubmitResult): CommandClient & { seen: Array<{ name: string; payload: unknown }> } {
  const seen: Array<{ name: string; payload: unknown }> = [];
  return {
    seen,
    submit: async (submission) => {
      seen.push(submission);
      return result;
    },
  };
}

const committed: SubmitResult = {
  ok: true,
  outcome: {
    commandId: "c1",
    recordId: "r1",
    rowVersion: 1,
    warnings: [],
    idempotentReplay: false,
  },
};

function renderInPanel(node: ReactNode, queryClient = new QueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <Sheet open>
        <SheetContent>{node}</SheetContent>
      </Sheet>
    </QueryClientProvider>,
  );
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
  mocks.useAssets.mockReturnValue({
    data: {
      pages: [
        {
          items: [
            {
              id: ASSET_ID,
              assetCode: "DLA-T-001",
              registrationNumber: "LT 123 AB",
              manufacturer: "Mercedes",
              model: "Actros",
              lifecycleStatus: "IN_SERVICE",
              rowVersion: 2,
              category: { code: "TRUCK", labelFr: "Camion", labelEn: "Truck" },
              branch: { code: "DLA", name: "Douala" },
            },
          ],
          nextCursor: null,
        },
      ],
    },
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
  });
});

afterEach(() => {
  sessionStore.logout(sessionIdentity);
  cleanup();
});

describe("ReadingForm on a vehicle's record panel", () => {
  it("fixes the vehicle, needs no trip, and says what the meter last read", async () => {
    const client = recordingClient(committed);
    const onDone = vi.fn();
    const onDismiss = vi.fn();
    renderInPanel(
      <ReadingForm
        surface="panel"
        pinnedAssetId={ASSET_ID}
        lastReading={{ readingType: "ODOMETER", value: 412_000 }}
        back={{ label: "Now", onBack: vi.fn() }}
        client={client}
        onDone={onDone}
        onDismiss={onDismiss}
      />,
    );

    const panel = screen.getByRole("dialog", { name: "Record odometer" });
    // The vehicle is shown, not offered: there is no asset picker to change.
    expect(within(panel).getByText("Vehicle")).toBeTruthy();
    expect(within(panel).queryByRole("combobox", { name: "Asset" })).toBeNull();
    await waitFor(() =>
      expect(within(panel).getByText(/^DLA-T-001/)).toBeTruthy(),
    );
    expect(within(panel).getByText("Last reading: 412,000 km")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "412850" } });
    const submit = screen.getByRole("button", { name: "Record the reading" });
    expect(within(submit.parentElement!).getAllByRole("button").map((button) => button.textContent))
      .toEqual(["Cancel", "Record the reading"]);
    await userEvent.click(submit);

    await waitFor(() => expect(client.seen).toHaveLength(1));
    const payload = recordMeterReadingPayload.parse(client.seen[0]!.payload);
    expect(client.seen[0]!.name).toBe("record-meter-reading");
    expect(payload.assetId).toBe(ASSET_ID);
    expect(payload.value).toBe(412_850);
    expect(payload.source).toBe("MANUAL");
    // A standalone reading belongs to no trip, so the field is absent.
    expect("activityId" in (client.seen[0]!.payload as object)).toBe(false);
    await waitFor(() => expect(onDismiss).toHaveBeenCalledOnce());
    expect(onDone).toHaveBeenCalledOnce();
  });

  it("refreshes the vehicle's detail along with the activity reads", async () => {
    const queryClient = new QueryClient();
    const keys: unknown[][] = [];
    const original = queryClient.invalidateQueries.bind(queryClient);
    queryClient.invalidateQueries = ((filters?: { queryKey?: unknown[] }) => {
      if (filters?.queryKey !== undefined) keys.push(filters.queryKey);
      return original(filters);
    }) as QueryClient["invalidateQueries"];

    renderInPanel(
      <ReadingForm
        surface="panel"
        pinnedAssetId={ASSET_ID}
        pinnedAssetLabel="DLA-T-001"
        client={recordingClient(committed)}
        onDismiss={vi.fn()}
      />,
      queryClient,
    );

    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "5" } });
    await userEvent.click(screen.getByRole("button", { name: "Record the reading" }));

    await waitFor(() => expect(keys).toHaveLength(2));
    expect(keys).toEqual([
      ["ws", "sotrafret", "activities"],
      ["ws", "sotrafret", "asset", ASSET_ID],
    ]);
  });

  it("keeps the form and names the failure when the server refuses", async () => {
    const onDismiss = vi.fn();
    renderInPanel(
      <ReadingForm
        surface="panel"
        pinnedAssetId={ASSET_ID}
        pinnedAssetLabel="DLA-T-001"
        client={recordingClient({ ok: false, code: "ASSET_NOT_OPERATIONAL" })}
        onDismiss={onDismiss}
      />,
    );

    fireEvent.change(screen.getByLabelText("Value"), { target: { value: "5" } });
    await userEvent.click(screen.getByRole("button", { name: "Record the reading" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByLabelText("Value")).toBeTruthy();
    expect(onDismiss).not.toHaveBeenCalled();
    expect(mocks.toastAdd).not.toHaveBeenCalled();
  });
});
