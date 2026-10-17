// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { I18nextProvider } from "react-i18next";
import { MeCtx, type MeContext } from "../auth/me.js";
import { i18n } from "../i18n/index.js";
import { LANGUAGE_STORAGE_KEY } from "../i18n/language.js";
import { MySettingsScreen } from "./MySettingsScreen.js";

const me: MeContext = {
  workspaceId: "11111111-1111-4111-8111-111111111111",
  principalId: "22222222-2222-4222-8222-222222222222",
  principalType: "HUMAN",
  membershipId: "33333333-3333-4333-8333-333333333333",
  displayName: "Sali Ahmadou",
  workspaceName: "Transports Ngwa",
  role: "DRIVER",
  branchScope: "ALL",
  enabledModules: ["CORE"],
  enabledPresets: ["TRUCKING"],
  timezone: "Africa/Douala",
};

function renderSettings() {
  render(
    <I18nextProvider i18n={i18n}>
      <MeCtx.Provider value={me}>
        <MySettingsScreen />
      </MeCtx.Provider>
    </I18nextProvider>,
  );
}

afterEach(async () => {
  cleanup();
  localStorage.clear();
  await i18n.changeLanguage("fr-CM");
});

describe("My settings", () => {
  it("says who you are and where you work", async () => {
    renderSettings();
    expect(await screen.findByRole("heading", { level: 1, name: "Mes réglages" })).toBeTruthy();
    expect(screen.getByText("Sali Ahmadou")).toBeTruthy();
    expect(screen.getByText("Chauffeur · Toutes mes agences · Transports Ngwa")).toBeTruthy();
  });

  it("remembers the language picked here for the next load, on this device", async () => {
    renderSettings();

    await userEvent.click(await screen.findByRole("button", { name: "English" }));
    expect(await screen.findByRole("heading", { name: "Language" })).toBeTruthy();
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en");
    expect(screen.getByRole("button", { name: "English" }).getAttribute("aria-pressed")).toBe("true");

    await userEvent.click(screen.getByRole("button", { name: "Français" }));
    expect(await screen.findByRole("heading", { name: "Langue" })).toBeTruthy();
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("fr-CM");
  });

  it("offers Light, Dark and Same as phone under Appearance", async () => {
    await i18n.changeLanguage("en");
    renderSettings();
    const group = await screen.findByRole("group", { name: "Appearance" });
    expect([...group.querySelectorAll("button")].map((button) => button.textContent)).toEqual([
      "Light",
      "Dark",
      "Same as phone",
    ]);
  });

  it("has no Sign out of its own: that lives in the name menu", async () => {
    await i18n.changeLanguage("en");
    renderSettings();
    await screen.findByRole("heading", { name: "My settings" });
    expect(screen.queryByRole("button", { name: "Sign out" })).toBeNull();
  });
});
