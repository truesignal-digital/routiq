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

describe("CompanySettingsScreen (#354)", () => {
  it("shows Direction the approvals section", () => {
    as("DIRECTOR");
    expect(screen.getByRole("heading", { name: "Company settings" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "approvals" })).toBeTruthy();
  });

  it.each(["ADMIN", "FINANCE", "CASHIER", "TECHNICIAN", "DRIVER"] as const)(
    "shows %s a denial and never the section, so the read is never asked for",
    (role) => {
      as(role);
      expect(screen.queryByRole("region", { name: "approvals" })).toBeNull();
      expect(screen.getByText("Your role does not allow this action.")).toBeTruthy();
    },
  );

  // With Money off the shell never opens this page: modules/manifests.test.tsx.
});
