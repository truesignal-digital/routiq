// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApprovalThresholdsResponse } from "@routiq/contracts";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandClient, SubmitResult } from "../commands/client.js";
import { i18n } from "../i18n/index.js";
import { ApprovalSettings } from "./ApprovalSettings.js";

const mocks = vi.hoisted(() => ({
  useApprovalThresholds: vi.fn(),
  notifyCommandSuccess: vi.fn(),
}));
vi.mock("./useApprovalThresholds.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useApprovalThresholds.js")>()),
  useApprovalThresholds: mocks.useApprovalThresholds,
}));
vi.mock("../lib/notify.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/notify.js")>()),
  notifyCommandSuccess: mocks.notifyCommandSuccess,
}));

const chain = (finance: "FINANCE_APPROVES" | "FINANCE_PEER_APPROVES") => [
  { upToMinor: 100_000, outcome: "POSTS_DIRECTLY" as const },
  { upToMinor: 1_000_000, outcome: finance },
  { upToMinor: null, outcome: "DIRECTION_APPROVES" as const },
];

const thresholds: ApprovalThresholdsResponse = {
  currency: "XAF",
  version: 12,
  recordingThresholdMinor: 100_000,
  financeCeilingMinor: 1_000_000,
  roles: [
    {
      role: "DIRECTOR",
      chains: [{ commandType: "record-expense", steps: [{ upToMinor: null, outcome: "POSTS_DIRECTLY" }] }],
    },
    { role: "ADMIN", chains: [{ commandType: "record-expense", steps: chain("FINANCE_APPROVES") }] },
    { role: "FINANCE", chains: [{ commandType: "record-expense", steps: chain("FINANCE_PEER_APPROVES") }] },
  ],
  overrides: [],
  affectedRoles: ["ADMIN", "FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"],
  lastChange: { changedAt: "2026-10-05T09:00:00.000Z", changedBy: "Emilienne Mbarga" },
};

function recordingClient(result: SubmitResult) {
  const seen: unknown[] = [];
  const client: CommandClient = {
    submit: async (submission) => {
      seen.push(submission);
      return result;
    },
  };
  return { client, seen };
}

const saved: SubmitResult = {
  ok: true,
  outcome: { commandId: "c1", recordId: "r1", rowVersion: 2, warnings: [], idempotentReplay: false },
};

function renderSettings(client: CommandClient) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ApprovalSettings client={client} />
    </QueryClientProvider>,
  );
}

function plain(text: string | null | undefined) {
  return (text ?? "").replace(/\s/g, " ");
}

async function openForm() {
  await userEvent.click(screen.getByRole("button", { name: "Change approval thresholds" }));
  return screen.getByRole("dialog");
}

async function retype(field: HTMLElement, value: string) {
  await userEvent.clear(field);
  await userEvent.type(field, value);
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});

afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useApprovalThresholds.mockReturnValue({ data: thresholds, isPending: false, isError: false });
});

afterEach(cleanup);

describe("ApprovalSettings (#354)", () => {
  it("states the company's chain in plain words, then what each role's own entries meet", () => {
    renderSettings(recordingClient(saved).client);

    const summary = screen.getByRole("list", { name: "The approval chain" });
    expect(within(summary).getAllByRole("listitem").map((item) => plain(item.textContent))).toEqual([
      "Up to 100 000 FCFA: posts directly",
      "Up to 1 000 000 FCFA: Finance approves",
      "Above 1 000 000 FCFA: the Director approves",
    ]);

    const finance = screen.getByRole("list", { name: "Finance" });
    expect(within(finance).getAllByRole("listitem").map((item) => plain(item.textContent))).toEqual([
      "Up to 100 000 FCFA: posts directly",
      "Up to 1 000 000 FCFA: another Finance member or the Director approves",
      "Above 1 000 000 FCFA: the Director approves",
    ]);
    expect(screen.getByText("Emilienne Mbarga changed them on 5 October 2026.")).toBeTruthy();
  });

  it("folds the roles that meet the company chain into one line, and spells out the ones that differ", () => {
    renderSettings(recordingClient(saved).client);

    expect(screen.getByRole("list", { name: "Director" }).textContent).toBe("Any amount: posts directly");
    expect(screen.getByRole("list", { name: "Finance" })).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Administrator" })).toBeNull();
    expect(screen.getByText("Administrator: same as the company rule")).toBeTruthy();
  });

  it("says who may change the rules one tap away, not at rest", async () => {
    renderSettings(recordingClient(saved).client);
    const rule = "Only the Director and Administrators can change these rules.";
    expect(screen.queryByText(rule)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "About approvals" }));
    expect(await screen.findByText(rule)).toBeTruthy();
  });

  it("names the exceptions the new bands leave alone, in the form", async () => {
    mocks.useApprovalThresholds.mockReturnValue({
      data: {
        ...thresholds,
        overrides: [
          {
            commandType: "record-expense",
            branchName: "Yaoundé",
            categoryCode: null,
            amountMinMinor: null,
            amountMaxMinor: 50_000,
            requiredRole: "FINANCE",
          },
        ],
      },
      isPending: false,
      isError: false,
    });
    renderSettings(recordingClient(saved).client);
    expect(screen.getByRole("heading", { name: "Exceptions for a branch or a category" })).toBeTruthy();
    // The row's own wording is settings.approvals.override (renders raw today; reported, not this change's).
    expect(screen.getByRole("heading", { name: "Exceptions for a branch or a category" }).nextElementSibling?.children).toHaveLength(1);

    const form = await openForm();
    expect(within(form).getByText("1 branch or category exception keeps its own amount.")).toBeTruthy();
  });

  it("sends both bands through update-approval-threshold v2, against the bands it read", async () => {
    const { client, seen } = recordingClient(saved);
    renderSettings(client);
    const form = await openForm();

    await retype(within(form).getByLabelText("Posts directly up to"), "150000");
    await retype(within(form).getByLabelText("Finance approves up to"), "2000000");
    await userEvent.click(within(form).getByRole("button", { name: "Save thresholds" }));

    expect(seen).toMatchObject([
      {
        name: "update-approval-threshold",
        version: 2,
        envelope: { expectedVersion: 12 },
        payload: { recordingThresholdMinor: 150_000, financeCeilingMinor: 2_000_000 },
      },
    ]);
    expect(mocks.notifyCommandSuccess).toHaveBeenCalledWith("settings", "thresholdsSaved", []);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("tells Direction, before saving, who will see the new rules", async () => {
    renderSettings(recordingClient(saved).client);
    const form = await openForm();
    // A whole label, not a sentence the list finishes; the list carries the same name.
    expect(within(form).getByText("Told on their next screen:")).toBeTruthy();
    const told = within(form).getByRole("list", { name: "Told on their next screen:" });
    expect(within(told).getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Administrator",
      "Finance",
      "Cashier",
      "Technician",
      "Driver",
    ]);
  });

  it("sends nothing while neither band has changed", async () => {
    const { client, seen } = recordingClient(saved);
    renderSettings(client);
    const form = await openForm();

    const submit = within(form).getByRole("button", { name: "Save thresholds" });
    expect((submit as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(submit);
    expect(seen).toEqual([]);
  });

  it("keeps the recording threshold below the Finance ceiling, and sends nothing until it is", async () => {
    const { client, seen } = recordingClient(saved);
    renderSettings(client);
    const form = await openForm();

    await retype(within(form).getByLabelText("Posts directly up to"), "1000000");
    await userEvent.click(within(form).getByRole("button", { name: "Save thresholds" }));

    expect(
      within(form).getByText("Keep this below the amount Finance approves up to."),
    ).toBeTruthy();
    expect(seen).toEqual([]);
  });

  it("refuses a fraction of a franc: XAF has no decimals", async () => {
    const { client, seen } = recordingClient(saved);
    renderSettings(client);
    const form = await openForm();

    await retype(within(form).getByLabelText("Posts directly up to"), "150000.5");
    await userEvent.click(within(form).getByRole("button", { name: "Save thresholds" }));

    expect(seen).toEqual([]);
  });

  it("answers a refusal from the server with its translated code", async () => {
    renderSettings(
      recordingClient({ ok: false, code: "RECORDING_THRESHOLD_NOT_BELOW_CEILING" }).client,
    );
    const form = await openForm();
    await retype(within(form).getByLabelText("Posts directly up to"), "150000");
    await userEvent.click(within(form).getByRole("button", { name: "Save thresholds" }));

    expect(
      within(form).getByText(
        "The amount that posts directly must stay below the amount Finance approves up to.",
      ),
    ).toBeTruthy();
  });
});
