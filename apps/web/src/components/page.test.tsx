// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmptyState, ErrorState, LoadingState, PageHeader } from "./page.js";

afterEach(cleanup);

describe("page scaffolds", () => {
  it("PageHeader renders its title, back action, and right-slot actions", async () => {
    const onBack = vi.fn();

    render(
      <PageHeader
        title="Asset documents"
        onBack={onBack}
        backLabel="Back to assets"
        actions={<button type="button">Add document</button>}
      />,
    );

    expect(screen.getByRole("heading", { name: "Asset documents" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add document" })).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Back to assets" }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it("EmptyState renders its icon, message, and CTA callback", async () => {
    const onAction = vi.fn();

    render(
      <EmptyState
        icon={<svg data-testid="empty-icon" />}
        message="No documents yet."
        action={{ label: "Add document", onClick: onAction }}
      />,
    );

    expect(screen.getByTestId("empty-icon")).toBeTruthy();
    expect(screen.getByText("No documents yet.")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Add document" }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("ErrorState renders its message and retry callback", async () => {
    const onRetry = vi.fn();

    render(
      <ErrorState message="The request failed." retryLabel="Try again" onRetry={onRetry} />,
    );

    expect(screen.getByRole("alert").textContent).toContain("The request failed.");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("LoadingState renders the requested number of vendored skeletons", () => {
    const { container } = render(<LoadingState label="Loading…" rows={4} />);

    expect(screen.getByRole("status").textContent).toContain("Loading…");
    expect(container.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(4);
  });
});
