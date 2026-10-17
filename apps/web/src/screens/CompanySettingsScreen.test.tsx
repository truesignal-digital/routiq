// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ModuleCode, Role } from "@routiq/contracts";
import { i18n } from "../i18n/index.js";

const me = vi.hoisted(() => ({ value: undefined as unknown }));
vi.mock("../auth/me.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../auth/me.js")>()),
  useMeContext: () => me.value,
}));
vi.mock("../settings/ApprovalSettings.js", () => ({
  ApprovalSettings: () => <section aria-label="approvals" />,
}));
vi.mock("../settings/SummaryScheduleSettings.js", () => ({
  SummaryScheduleSettings: () => <section aria-label="dashboard summary" />,
}));

const { CompanySettingsScreen } = await import("./CompanySettingsScreen.js");

function as(role: Role, enabledModules: ModuleCode[] = ["CORE", "FINANCE"]) {
  me.value = { role, enabledModules };
  render(<CompanySettingsScreen />);
}

beforeAll(async () => {
  await i18n.changeLanguage("en");
});
afterAll(async () => {
  await i18n.changeLanguage("fr-CM");
});
afterEach(cleanup);

describe("CompanySettingsScreen (#354, #669, #711)", () => {
  it.each(["DIRECTOR", "ADMIN"] as const)("shows %s the approvals and Dashboard summary sections (#711)", (role) => {
    as(role);
    expect(screen.getByRole("heading", { name: "Company settings" })).toBeTruthy();
    expect(
      screen.getByText("Rules that apply to everyone in the company. Only the Director and Administrators can change them."),
    ).toBeTruthy();
    expect(screen.getByRole("region", { name: "approvals" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "dashboard summary" })).toBeTruthy();
  });

  it.each(["FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"] as const)(
    "shows %s a denial and never the section, so the read is never asked for",
    (role) => {
      as(role);
      expect(screen.queryByRole("region", { name: "approvals" })).toBeNull();
      expect(screen.queryByRole("region", { name: "dashboard summary" })).toBeNull();
      expect(screen.getByText("Your role does not allow this action.")).toBeTruthy();
    },
  );

  // With Money off the shell never opens this page: modules/manifests.test.tsx.
});
