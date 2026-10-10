// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CompanySettingsResponse } from "@routiq/contracts";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/index.js";
import { fakeClient } from "../test/form-harness.js";
import { SummaryScheduleSettings } from "./SummaryScheduleSettings.js";
import { isCompanySettingsResponse } from "./useCompanySettings.js";

const mocks = vi.hoisted(() => ({
  useCompanySettings: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("./useCompanySettings.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./useCompanySettings.js")>()),
  useCompanySettings: mocks.useCompanySettings,
  useInvalidateCompanySettings: () => mocks.invalidate,
}));

function show(data: CompanySettingsResponse | undefined, state: { isPending?: boolean; isError?: boolean } = {}) {
  mocks.useCompanySettings.mockReturnValue({
    data,
    isPending: state.isPending ?? false,
    isError: state.isError ?? false,
    refetch: vi.fn(),
  });
  const client = fakeClient();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <SummaryScheduleSettings client={client} />
    </QueryClientProvider>,
  );
  return client;
}

beforeAll(() => i18n.changeLanguage("en"));
afterAll(() => i18n.changeLanguage("fr-CM"));
afterEach(() => {
  cleanup();
  mocks.invalidate.mockReset();
});

describe("SummaryScheduleSettings (#669)", () => {
  it("names the schedule in force, and that each person can still close the summary", () => {
    show({ summarySchedule: "MONDAY_AND_MONTH_START", version: 0 });
    const section = screen.getByRole("region", { name: "Dashboard summary" });
    expect(section.textContent).toContain("Every Monday and on the 1st of the month");
    expect(section.textContent).toContain("Each person can still close it.");
  });

  it("changes it through the form and reloads what the setting moves", async () => {
    const client = show({ summarySchedule: "NEVER", version: 2 });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Change Dashboard summary" }));
    await user.click(screen.getByLabelText("On the 1st of the month only"));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(client.seen).toHaveLength(1));
    expect(client.seen[0]).toMatchObject({ payload: { schedule: "MONTH_START" }, envelope: { expectedVersion: 2 } });
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("offers no change while the setting loads or failed to load", () => {
    show(undefined, { isError: true });
    expect(screen.getByText("The Dashboard summary setting could not be loaded.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Change Dashboard summary" })).toBeNull();
  });
});

describe("isCompanySettingsResponse", () => {
  it("accepts the read's shape and refuses an unknown schedule", () => {
    expect(isCompanySettingsResponse({ summarySchedule: "MONDAY", version: 1 })).toBe(true);
    expect(isCompanySettingsResponse({ summarySchedule: "DAILY", version: 1 })).toBe(false);
    expect(isCompanySettingsResponse({ summarySchedule: "MONDAY" })).toBe(false);
    expect(isCompanySettingsResponse(null)).toBe(false);
  });
});
