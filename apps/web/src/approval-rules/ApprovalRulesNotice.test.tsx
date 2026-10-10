// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ApprovalChainResponse } from "@routiq/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandClient, SubmitResult } from "../commands/client.js";
import { i18n } from "../i18n/index.js";
import { ApprovalRulesNotice } from "./ApprovalRulesNotice.js";

const mocks = vi.hoisted(() => ({ useApprovalChain: vi.fn() }));
vi.mock("./useApprovalChain.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useApprovalChain.js")>()),
  useApprovalChain: mocks.useApprovalChain,
}));

const CHANGE_ID = "00000000-0000-4000-8000-000000000422";

const changed: ApprovalChainResponse = {
  currency: "XAF",
  chains: [
    {
      commandType: "record-expense",
      steps: [
        { upToMinor: 150_000, outcome: "POSTS_DIRECTLY" },
        { upToMinor: 1_000_000, outcome: "FINANCE_APPROVES" },
        { upToMinor: null, outcome: "DIRECTION_APPROVES" },
      ],
    },
  ],
  notice: { changeId: CHANGE_ID, changedAt: "2026-10-05T09:00:00.000Z", changedBy: "Mme Ngo" },
};

function recordingClient(result: SubmitResult): CommandClient & { seen: Array<{ name: string; payload: unknown }> } {
  const seen: Array<{ name: string; payload: unknown }> = [];
  return {
    seen,
    submit: async (submission) => {
      seen.push(submission as { name: string; payload: unknown });
      return result;
    },
  };
}

const acknowledged: SubmitResult = {
  ok: true,
  outcome: { commandId: "c1", recordId: "a1", rowVersion: 1, warnings: [], idempotentReplay: false },
};

function renderNotice(client: CommandClient) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ApprovalRulesNotice client={client} />
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
});

afterEach(cleanup);

describe("ApprovalRulesNotice (#422)", () => {
  it("says who changed the rules, when, and the member's new chain in plain words", () => {
    mocks.useApprovalChain.mockReturnValue({ data: changed });
    renderNotice(recordingClient(acknowledged));

    expect(screen.getByText("The approval rules have changed")).toBeTruthy();
    expect(screen.getByText("Mme Ngo changed them on October 5, 2026.")).toBeTruthy();
    expect(screen.getByText("Your expenses")).toBeTruthy();
    const steps = screen
      .getAllByRole("listitem")
      .map((item) => item.textContent?.replace(/\s/g, " "));
    expect(steps).toEqual([
      "Up to FCFA 150,000: posts directly",
      "Up to FCFA 1,000,000: Finance approves",
      "Above FCFA 1,000,000: the Director approves",
    ]);
  });

  it("names ROUTIQ when a release changed the rules", () => {
    mocks.useApprovalChain.mockReturnValue({
      data: { ...changed, notice: { ...changed.notice!, changedBy: null } },
    });
    renderNotice(recordingClient(acknowledged));
    expect(screen.getByText("ROUTIQ updated them on October 5, 2026.")).toBeTruthy();
  });

  it("records the dismissal through acknowledge-approval-rules, then goes away", async () => {
    mocks.useApprovalChain.mockReturnValue({ data: changed });
    const client = recordingClient(acknowledged);
    renderNotice(client);

    await userEvent.click(screen.getByRole("button", { name: "Got it" }));

    expect(client.seen).toMatchObject([
      { name: "acknowledge-approval-rules", payload: { changeId: CHANGE_ID } },
    ]);
    expect(screen.queryByText("The approval rules have changed")).toBeNull();
  });

  it("stays, and says so, when the dismissal could not be recorded", async () => {
    mocks.useApprovalChain.mockReturnValue({ data: changed });
    renderNotice(recordingClient({ ok: false, code: "NETWORK_ERROR" }));

    await userEvent.click(screen.getByRole("button", { name: "Got it" }));

    expect(screen.getByText("The approval rules have changed")).toBeTruthy();
    expect(await screen.findByText(/could not be saved/i)).toBeTruthy();
  });

  it("shows nothing without a notice, or while the read is pending", () => {
    mocks.useApprovalChain.mockReturnValue({ data: { ...changed, notice: null } });
    const { container, rerender } = renderNotice(recordingClient(acknowledged));
    expect(container.textContent).toBe("");

    mocks.useApprovalChain.mockReturnValue({ data: undefined });
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <ApprovalRulesNotice client={recordingClient(acknowledged)} />
      </QueryClientProvider>,
    );
    expect(container.textContent).toBe("");
  });
});
