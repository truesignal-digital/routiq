// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/index.js";
import { describeCommandForm, fakeClient } from "../test/form-harness.js";
import { SummaryScheduleForm } from "./SummaryScheduleForm.js";

const current = { schedule: "MONDAY_AND_MONTH_START" as const, version: 4 };

describeCommandForm("SummaryScheduleForm", {
  command: "set-summary-schedule",
  render: ({ client, onDismiss }) => <SummaryScheduleForm current={current} client={client} onDismiss={onDismiss} />,
  opened: () => {
    expect(
      screen.getByText("Every Monday and on the 1st of the month", { selector: "[data-slot=form-pinned] *" }),
    ).toBeTruthy();
    const radios = screen.getAllByRole("radio") as HTMLInputElement[];
    expect(radios).toHaveLength(4);
    expect(radios.every((radio) => !radio.checked)).toBe(true);
  },
  fill: async (user) => {
    await user.click(screen.getByLabelText("Every Monday"));
  },
  payload: { schedule: "MONDAY" },
});

describe("SummaryScheduleForm (#669)", () => {
  beforeAll(() => i18n.changeLanguage("en"));
  afterAll(() => i18n.changeLanguage("fr-CM"));
  afterEach(cleanup);

  it("offers the four schedules in the mockup's words and order", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SummaryScheduleForm current={current} client={fakeClient()} onDismiss={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getAllByRole("radio").map((radio) => radio.closest("label")?.textContent)).toEqual([
      "Every Monday and on the 1st of the month",
      "Every Monday",
      "On the 1st of the month only",
      "Never: tiles only",
    ]);
  });

  it("sends the choice at the version it was read, so a stale screen cannot overwrite a newer change", async () => {
    const client = fakeClient();
    const onDone = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <SummaryScheduleForm current={current} client={client} onDone={onDone} onDismiss={vi.fn()} />
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await user.click(screen.getByLabelText("Never: tiles only"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(client.seen).toHaveLength(1));
    expect(client.seen[0]).toMatchObject({
      name: "set-summary-schedule",
      version: 1,
      payload: { schedule: "NEVER" },
      envelope: { expectedVersion: 4 },
    });
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
