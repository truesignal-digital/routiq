import { render } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { I18nextProvider } from "react-i18next";
import i18n from "i18next";
import { ErrorBanner } from "./error-banner.js";

describe("ErrorBanner", () => {
  beforeEach(() => {
    // Create a simple i18n instance for testing
    vi.clearAllMocks();
  });

  it("renders with message prop", () => {
    const { container } = render(
      <ErrorBanner message="Custom error message" />
    );
    expect(container.textContent).toContain("Custom error message");
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
  });

  it("renders alert icon", () => {
    const { container } = render(
      <ErrorBanner message="Error with icon" />
    );
    const icon = container.querySelector("svg");
    expect(icon).toBeTruthy();
  });

  it("renders with optional title", () => {
    const { container } = render(
      <ErrorBanner message="Error details" title="Error" />
    );
    expect(container.textContent).toContain("Error");
    expect(container.textContent).toContain("Error details");
  });

  it("has destructive variant styling", () => {
    const { container } = render(
      <ErrorBanner message="Test" />
    );
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.className).toContain("destructive");
  });
});
