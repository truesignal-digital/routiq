// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../i18n/index.js";
import { THEME_STORAGE_KEY, initTheme } from "../lib/theme.js";
import { ThemeToggle, ThemeToggleMenu } from "./theme-toggle.js";

/** jsdom evaluates no media queries; the OS preference is driven explicitly. */
function stubSystemPreference(prefersDark: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string) => ({
      matches: prefersDark,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  });
}

function renderToggle(ui: React.ReactElement) {
  return render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);
}

beforeEach(async () => {
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  document.documentElement.style.colorScheme = "";
  stubSystemPreference(false);
  initTheme();
  await i18n.changeLanguage("en");
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  initTheme();
});

describe("ThemeToggle", () => {
  it("offers the three modes and marks the active one", () => {
    renderToggle(<ThemeToggle />);

    const options = screen.getAllByRole("button");
    expect(options.map((option) => option.textContent)).toEqual([
      "Light",
      "Dark",
      "System",
    ]);
    expect(screen.getByRole("button", { name: "System" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("darkens the document and remembers the choice", async () => {
    renderToggle(<ThemeToggle />);

    await userEvent.click(screen.getByRole("button", { name: "Dark" }));

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(screen.getByRole("button", { name: "Dark" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
  });

  it("goes back to light", async () => {
    renderToggle(<ThemeToggle />);

    await userEvent.click(screen.getByRole("button", { name: "Dark" }));
    await userEvent.click(screen.getByRole("button", { name: "Light" }));

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("hands the system its say back", async () => {
    stubSystemPreference(true);
    renderToggle(<ThemeToggle />);

    await userEvent.click(screen.getByRole("button", { name: "Light" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "System" }));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("speaks French", async () => {
    await i18n.changeLanguage("fr-CM");
    renderToggle(<ThemeToggle />);

    expect(screen.getAllByRole("button").map((option) => option.textContent)).toEqual([
      "Clair",
      "Sombre",
      "Système",
    ]);
    expect(screen.getByRole("group").getAttribute("aria-label")).toBe("Thème");
  });
});

describe("ThemeToggleMenu", () => {
  it("labels its icon trigger and keeps a 44px touch target", () => {
    renderToggle(<ThemeToggleMenu />);

    const trigger = screen.getByRole("button", { name: "Theme" });
    expect(trigger.className).toContain("size-11");
  });

  it("picks a mode from the menu", async () => {
    renderToggle(<ThemeToggleMenu />);

    await userEvent.click(screen.getByRole("button", { name: "Theme" }));
    await userEvent.click(await screen.findByRole("menuitemradio", { name: "Dark" }));

    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });
});
